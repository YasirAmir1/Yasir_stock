import React, { useState, useEffect } from 'react';
import { X, Bell, FileText, Info, Trash2 } from 'lucide-react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDocs, getDoc } from 'firebase/firestore';

interface DelegatePanelModalProps {
  onClose: () => void;
  isDarkMode: boolean;
}

interface AlertItem {
  id: string;
  delegateName: string;
  note: string;
  targetTime: number; // timestamp
  createdAt: number;
}

interface NoteItem {
  id: string;
  delegateName: string;
  content: string;
  createdAt: number;
}

interface RouteItem {
  id: string;
  customerCode: string;
  customerName: string;
  customerAddress: string;
  delegateName: string;
  path: string;
}

export const DelegatePanelModal: React.FC<DelegatePanelModalProps> = ({ onClose, isDarkMode }) => {
  const { currentUser, productsList = [], delegatesList = [] } = useSales();
  const [activeTab, setActiveTab] = useState<'alerts' | 'notes' | 'notifications' | 'route' | 'tasks'>('alerts');
  
  // Alerts State
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertNote, setAlertNote] = useState('');
  const [alertDate, setAlertDate] = useState('');
  const [alertHour, setAlertHour] = useState('12');
  const [alertMinute, setAlertMinute] = useState('00');
  
  // Notes State
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [newNote, setNewNote] = useState('');

  // Route & Tasks States
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [routeFilterDelegate, setRouteFilterDelegate] = useState(currentUser?.isAdmin ? '' : currentUser?.name || '');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [dailyTask, setDailyTask] = useState('');

  // Notifications State
  const [globalNotifs, setGlobalNotifs] = useState<any[]>([]);
  const [readsMap, setReadsMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!currentUser || currentUser.isAdmin) return;
    
    const delegateName = currentUser.name;
    
    // Load Alerts
    const alertsQ = query(collection(db, 'delegate_alerts'), where('delegateName', '==', delegateName));
    const unsubAlerts = onSnapshot(alertsQ, (snap) => {
      const loaded: AlertItem[] = [];
      snap.forEach(d => loaded.push(d.data() as AlertItem));
      setAlerts(loaded.sort((a, b) => a.targetTime - b.targetTime));
    });

    // Load Notes
    const notesQ = query(collection(db, 'delegate_notes'), where('delegateName', '==', delegateName));
    const unsubNotes = onSnapshot(notesQ, (snap) => {
      const loaded: NoteItem[] = [];
      snap.forEach(d => loaded.push(d.data() as NoteItem));
      setNotes(loaded.sort((a, b) => b.createdAt - a.createdAt));
    });

    // Load Global Notifications
    const notifsQ = query(collection(db, 'admin_notifications'));
    const unsubNotifs = onSnapshot(notifsQ, (snap) => {
      const loaded: any[] = [];
      snap.forEach(d => loaded.push({ id: d.id, ...d.data() }));
      setGlobalNotifs(loaded.sort((a, b) => b.timestamp - a.timestamp));
    });

    // Load Reads
    const readsQ = query(collection(db, 'delegate_notification_reads'), where('delegateName', '==', delegateName));
    const unsubReads = onSnapshot(readsQ, (snap) => {
      const rm: Record<string, number> = {};
      snap.forEach(d => {
        rm[d.data().notificationId] = d.data().readAt;
      });
      setReadsMap(rm);
    });

    return () => {
      unsubAlerts();
      unsubNotes();
      unsubNotifs();
      unsubReads();
    };
  }, [currentUser]);

  // Fetch Routes and Tasks
  useEffect(() => {
    const q = query(collection(db, 'routes'));
    const unsubRoutes = onSnapshot(q, (snap) => {
      const arr: RouteItem[] = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() } as RouteItem));
      setRoutes(arr);
    });

    let unsubTask = () => {};
    if (currentUser?.name) {
      unsubTask = onSnapshot(doc(db, 'admin_daily_tasks', currentUser.name), (dSnap) => {
        if (dSnap.exists()) {
          setDailyTask(dSnap.data().taskText || '');
        } else {
          setDailyTask('');
        }
      });
      
      // Mark task as read when opening tasks tab
      if (activeTab === 'tasks') {
        setDoc(doc(db, 'delegate_task_reads', currentUser.name), {
          lastReadTimestamp: Date.now()
        }, { merge: true }).catch(console.error);
      }
    }

    return () => {
      unsubRoutes();
      unsubTask();
    };
  }, [currentUser]);

  const handleSaveAlert = async () => {
    if (!alertNote.trim() || !alertDate) {
      alert('يرجى كتابة الملاحظة واختيار التاريخ');
      return;
    }
    const [year, month, day] = alertDate.split('-');
    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(alertHour), parseInt(alertMinute));
    
    const newAlert: AlertItem = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
      delegateName: currentUser.name,
      note: alertNote.trim(),
      targetTime: dateObj.getTime(),
      createdAt: Date.now()
    };
    
    try {
      await setDoc(doc(db, 'delegate_alerts', newAlert.id), newAlert);
      setAlertNote('');
    } catch (e) {
      console.error('Error saving alert:', e);
    }
  };

  const handleSaveNote = async () => {
    if (!newNote.trim()) return;
    
    const noteObj: NoteItem = {
      id: `note_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
      delegateName: currentUser.name,
      content: newNote.trim(),
      createdAt: Date.now()
    };
    
    try {
      await setDoc(doc(db, 'delegate_notes', noteObj.id), noteObj);
      setNewNote('');
    } catch (e) {
      console.error('Error saving note:', e);
    }
  };

  const handleDeleteNote = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'delegate_notes', id));
    } catch (e) {
      console.error('Error deleting note:', e);
    }
  };
  
  const handleDeleteAlert = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'delegate_alerts', id));
    } catch (e) {
      console.error('Error deleting alert:', e);
    }
  };

  if (currentUser?.isAdmin) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className={`w-full max-w-md p-6 rounded-2xl shadow-xl border ${isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-black">المندوب</h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-center font-bold">هذه الميزة خاصة بالمندوبين فقط.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
      <div className={`w-full max-w-xl h-[80vh] flex flex-col rounded-2xl shadow-xl border overflow-hidden ${isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
        
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-slate-800 bg-slate-800/50' : 'border-slate-100 bg-slate-50'}`}>
          <h2 className="text-lg font-black flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-500" />
            <span>لوحة المندوب: {currentUser?.name}</span>
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center p-4 gap-2 border-b border-slate-200 dark:border-slate-700">
          <button onClick={() => setActiveTab('alerts')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${activeTab === 'alerts' ? 'bg-emerald-500 text-white' : (isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')}`}>
            تنبيهاتي
          </button>
          <button onClick={() => setActiveTab('notes')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${activeTab === 'notes' ? 'bg-emerald-500 text-white' : (isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')}`}>
            ملاحظاتي
          </button>
          <button onClick={() => setActiveTab('notifications')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${activeTab === 'notifications' ? 'bg-emerald-500 text-white' : (isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')}`}>
            إشعارات
          </button>
          <button onClick={() => setActiveTab('route')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${activeTab === 'route' ? 'bg-emerald-500 text-white' : (isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')}`}>
            المسار
          </button>
          <button onClick={() => setActiveTab('tasks')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${activeTab === 'tasks' ? 'bg-emerald-500 text-white' : (isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')}`}>
            المهام اليومية
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'alerts' && (
            <div className="space-y-6">
              <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <h3 className="font-bold mb-3 text-sm flex items-center gap-2"><Bell className="w-4 h-4" /> إضافة تنبيه جديد</h3>
                <textarea 
                  value={alertNote}
                  onChange={(e) => setAlertNote(e.target.value)}
                  placeholder="اكتب التنبيه هنا..."
                  className={`w-full p-3 rounded-lg border text-sm mb-3 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
                  rows={2}
                />
                <div className="flex flex-wrap gap-3 mb-3">
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-[10px] mb-1 opacity-70">التاريخ</label>
                    <input type="date" value={alertDate} onChange={e => setAlertDate(e.target.value)} className={`w-full p-2 rounded-lg border text-sm ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`} />
                  </div>
                  <div className="w-[80px]">
                    <label className="block text-[10px] mb-1 opacity-70">الساعة</label>
                    <select value={alertHour} onChange={e => setAlertHour(e.target.value)} className={`w-full p-2 rounded-lg border text-sm ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}>
                      {Array.from({length: 24}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                    </select>
                  </div>
                  <div className="w-[80px]">
                    <label className="block text-[10px] mb-1 opacity-70">الدقيقة</label>
                    <select value={alertMinute} onChange={e => setAlertMinute(e.target.value)} className={`w-full p-2 rounded-lg border text-sm ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}>
                      {Array.from({length: 60}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={handleSaveAlert} className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg transition-colors text-sm">
                  حفظ التنبيه
                </button>
              </div>
              
              <div className="space-y-3">
                <h3 className="font-bold text-sm opacity-80">التنبيهات المحفوظة</h3>
                {alerts.length === 0 ? <p className="text-xs opacity-50 text-center py-4">لا توجد تنبيهات محفوظة</p> : alerts.map(a => (
                  <div key={a.id} className={`p-3 rounded-lg border flex items-start justify-between gap-3 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                    <div className="flex-1">
                      <p className="font-bold text-sm mb-1">{a.note}</p>
                      <p className="text-[10px] opacity-70 text-emerald-500 font-bold">{new Date(a.targetTime).toLocaleString('en-GB')}</p>
                    </div>
                    <button onClick={() => handleDeleteAlert(a.id)} className="p-1.5 rounded-md hover:bg-red-100 text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-6">
              <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <h3 className="font-bold mb-3 text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> إضافة ملاحظة</h3>
                <textarea 
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="اكتب ملاحظتك هنا (لا تحذف أو تعدل تلقائياً)..."
                  className={`w-full p-3 rounded-lg border text-sm mb-3 min-h-[100px] ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
                />
                <button onClick={handleSaveNote} className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg transition-colors text-sm">
                  حفظ الملاحظة
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-sm opacity-80">ملاحظاتي المحفوظة</h3>
                {notes.length === 0 ? <p className="text-xs opacity-50 text-center py-4">لا توجد ملاحظات محفوظة</p> : notes.map(n => (
                  <div key={n.id} className={`p-3 rounded-lg border relative ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-amber-50 border-amber-200'}`}>
                    <button onClick={() => handleDeleteNote(n.id)} className="absolute top-2 left-2 p-1 rounded-md hover:bg-red-100 text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                    <p className="font-bold text-sm pr-6 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                    <p className="text-[10px] opacity-60 mt-3">{new Date(n.createdAt).toLocaleDateString('en-GB')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4">
              {globalNotifs.length === 0 && <p className="text-center p-4 text-xs opacity-60">لا توجد إشعارات</p>}
              {globalNotifs.map((notif) => {
                const readAt = readsMap[notif.id];
                const isRead = !!readAt;
                const twelveHoursMs = 12 * 60 * 60 * 1000;
                
                // If it's read and 12 hours have passed, it disappears completely
                if (isRead && Date.now() - readAt > twelveHoursMs) {
                  return null;
                }

                return (
                  <div 
                    key={notif.id} 
                    onClick={async () => {
                      if (!isRead) {
                        try {
                          await setDoc(doc(db, 'delegate_notification_reads', `${currentUser?.name}_${notif.id}`), {
                            delegateName: currentUser?.name,
                            notificationId: notif.id,
                            readAt: Date.now()
                          });
                        } catch(e) {
                          console.error(e);
                        }
                      }
                    }}
                    className={`p-4 rounded-xl border flex items-start gap-4 cursor-pointer transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className={`p-3 rounded-lg ${isRead ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                      <Info className="w-6 h-6" />
                    </div>
                    <div className="flex-1 mt-1">
                      <p 
                        className={`transition-all duration-300 whitespace-pre-wrap ${isRead ? 'font-normal text-sm opacity-90' : 'font-black text-lg blur-[3px] opacity-70 select-none'}`}
                      >
                        {notif.text}
                      </p>
                      {!isRead && (
                        <p className="text-[10px] text-blue-500 font-bold mt-2">انقر للقراءة</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'route' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-xl border flex flex-col sm:flex-row gap-2 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <select value={routeFilterDelegate} onChange={e => setRouteFilterDelegate(e.target.value)} className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}>
                  <option value="">كل المندوبين</option>
                  {delegatesList.map(d => (
                    <option key={d} value={d === "شرقاط" ? "صباح فرحان" : d}>{d === "شرقاط" ? "صباح فرحان" : d}</option>
                  ))}
                </select>
                <select value={routeFilterDay} onChange={e => setRouteFilterDay(e.target.value)} className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}>
                  <option value="">كل الأيام</option>
                  <option value="السبت">السبت</option>
                  <option value="الأحد">الأحد</option>
                  <option value="الإثنين">الإثنين</option>
                  <option value="الثلاثاء">الثلاثاء</option>
                  <option value="الأربعاء">الأربعاء</option>
                  <option value="الخميس">الخميس</option>
                </select>
              </div>
              
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap">
                  <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                    <tr>
                      <th className="px-3 py-2 border-b dark:border-slate-700">الكود</th>
                      <th className="px-3 py-2 border-b dark:border-slate-700">الاسم</th>
                      <th className="px-3 py-2 border-b dark:border-slate-700">العنوان</th>
                      <th className="px-3 py-2 border-b dark:border-slate-700">المندوب</th>
                      <th className="px-3 py-2 border-b dark:border-slate-700">المسار</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
                    {routes.filter(r => 
                      (routeFilterDelegate ? r.delegateName.trim() === (routeFilterDelegate === "صباح فرحان" ? "شرقاط" : routeFilterDelegate).trim() : true) && 
                      (routeFilterDay ? r.path?.includes(routeFilterDay) : true)
                    ).map(r => (
                      <tr key={r.id} className={`hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'} transition-colors`}>
                        <td className="px-3 py-2">{r.customerCode}</td>
                        <td className="px-3 py-2">{r.customerName}</td>
                        <td className="px-3 py-2">{r.customerAddress}</td>
                        <td className="px-3 py-2">{r.delegateName}</td>
                        <td className="px-3 py-2">{r.path}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="flex flex-col items-center justify-center min-h-[200px] p-6 rounded-2xl bg-gradient-to-br from-emerald-50 to-green-100 dark:from-emerald-950 dark:to-green-900 border-2 border-emerald-200 dark:border-emerald-800 shadow-inner">
              <h3 className="text-emerald-800 dark:text-emerald-200 font-black text-lg mb-4 text-center">المهام اليومية المسندة إليك</h3>
              <p className="text-center font-bold text-sm sm:text-base whitespace-pre-wrap text-emerald-900 dark:text-emerald-100 bg-white/50 dark:bg-black/20 p-4 rounded-xl w-full shadow-sm">
                {dailyTask || "لا توجد مهام مسندة لهذا اليوم."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
