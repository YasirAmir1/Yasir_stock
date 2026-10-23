import React, { useState, useEffect } from 'react';
import { X, Bell, FileText, Info, Trash2, Edit2 } from 'lucide-react';
import { useSales } from '../context/SalesContext';
import { DebtItem } from '../types';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, updateDoc, onSnapshot, query, where, getDocs, getDoc } from 'firebase/firestore';

interface DelegatePanelModalProps {
  onClose: () => void;
  isDarkMode: boolean;
}

interface AlertItem {
  id: string;
  delegateName?: string;
  authorName?: string;
  authorRole?: string;
  note: string;
  targetTime: number; // timestamp
  createdAt: number;
}

interface NoteItem {
  id: string;
  delegateName?: string;
  authorName?: string;
  authorRole?: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
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

  const isAdmin = Boolean(currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.name === 'الأدمن');
  const isDataEntry = Boolean(currentUser?.role === 'dataEntry' || currentUser?.username?.toLowerCase() === 'rafatdata' || currentUser?.name?.includes('مدخل'));
  const isAdminOrDataEntry = isAdmin || isDataEntry;

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
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState<string>('');

  // Route & Tasks States
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [routeFilterDelegate, setRouteFilterDelegate] = useState(currentUser?.isAdmin ? '' : currentUser?.name || '');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dailyTask, setDailyTask] = useState<string>('');
  const [completedTasks, setCompletedTasks] = useState<Record<number, boolean>>({});
  const [completionTimes, setCompletionTimes] = useState<Record<number, number>>({});
  const [sortConfig, setSortConfig] = useState<{ key: keyof RouteItem; direction: 'asc' | 'desc' } | null>(null);

  const filteredRoutes = routes.filter(r => 
    (routeFilterDelegate ? r.delegateName.trim() === routeFilterDelegate.trim() : true) && 
    (routeFilterDay ? r.path?.includes(routeFilterDay) : true) &&
    (searchQuery ? r.customerName.includes(searchQuery) : true)
  );

  const handleSort = (key: keyof RouteItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Notifications State
  const [globalNotifs, setGlobalNotifs] = useState<any[]>([]);
  const [readsMap, setReadsMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!currentUser) return;

    if (isAdminOrDataEntry) {
      // Shared real-time Alerts for Admin & Data Entry
      const alertsQ = collection(db, 'admin_data_entry_alerts');
      const unsubAlerts = onSnapshot(alertsQ, (snap) => {
        const loaded: AlertItem[] = [];
        snap.forEach(d => loaded.push({ id: d.id, ...d.data() } as AlertItem));
        setAlerts(loaded.sort((a, b) => a.targetTime - b.targetTime));
      });

      // Shared real-time Notes for Admin & Data Entry
      const notesQ = collection(db, 'admin_data_entry_notes');
      const unsubNotes = onSnapshot(notesQ, (snap) => {
        const loaded: NoteItem[] = [];
        snap.forEach(d => loaded.push({ id: d.id, ...d.data() } as NoteItem));
        setNotes(loaded.sort((a, b) => b.createdAt - a.createdAt));
      });

      return () => {
        unsubAlerts();
        unsubNotes();
      };
    } else {
      // Delegate-specific alerts and notes
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

      // Load Reads
      const readsQ = query(collection(db, 'delegate_notification_reads'), where('delegateName', '==', delegateName));
      const unsubReads = onSnapshot(readsQ, (snap) => {
        const rm: Record<string, number> = {};
        snap.forEach(d => {
          rm[d.data().notificationId] = d.data().readAt;
        });
        setReadsMap(rm);
      });

      // Load Global Notifications
      const notifsQ = query(collection(db, 'admin_notifications'));
      const unsubNotifs = onSnapshot(notifsQ, (snap) => {
        const loaded: any[] = [];
        snap.forEach(d => loaded.push({ id: d.id, ...d.data() }));
        setGlobalNotifs(loaded.sort((a, b) => b.timestamp - a.timestamp));
      });

      return () => {
        unsubAlerts();
        unsubNotes();
        unsubNotifs();
        unsubReads();
      };
    }
  }, [currentUser, isAdminOrDataEntry]);

  useEffect(() => {
    if (currentUser?.name && !isAdminOrDataEntry) {
      const taskDocRef = doc(db, 'admin_daily_tasks', currentUser.name);
      
      const unsub = onSnapshot(taskDocRef, (dSnap) => {
        if (dSnap.exists()) {
          const data = dSnap.data();
          setDailyTask(data.taskText || '');
          setCompletedTasks(data.completedTasks || {});
          setCompletionTimes(data.completionTimes || {});
        } else {
          setDailyTask('');
          setCompletedTasks({});
          setCompletionTimes({});
        }
      });
      
      return () => unsub();
    }
  }, [currentUser, isAdminOrDataEntry]);

  const toggleTaskCompletion = async (index: number, isComplete: boolean) => {
    if (!currentUser?.name) return;
    
    const newCompleted = { ...completedTasks, [index]: isComplete };
    const newCompletionTimes = { ...completionTimes, [index]: isComplete ? Date.now() : 0 };
    setCompletedTasks(newCompleted);
    setCompletionTimes(newCompletionTimes);

    try {
      await setDoc(doc(db, 'admin_daily_tasks', currentUser.name), {
        taskText: dailyTask,
        completedTasks: newCompleted,
        completionTimes: newCompletionTimes
      }, { merge: true });
    } catch (e) {
      console.error('Error toggling task:', e);
      setCompletedTasks(completedTasks); // Revert
      setCompletionTimes(completionTimes);
    }
  };

  const handleSaveAlert = async () => {
    if (!alertNote.trim() || !alertDate) {
      alert('يرجى كتابة الملاحظة واختيار التاريخ');
      return;
    }
    const [year, month, day] = alertDate.split('-');
    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(alertHour), parseInt(alertMinute));
    
    if (isAdminOrDataEntry) {
      const alertId = `ad_alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const newAlert: AlertItem = {
        id: alertId,
        authorName: currentUser.name || (isAdmin ? 'الأدمن' : 'مدخل البيانات'),
        authorRole: isAdmin ? 'الأدمن' : 'مدخل البيانات',
        note: alertNote.trim(),
        targetTime: dateObj.getTime(),
        createdAt: Date.now()
      };
      
      try {
        await setDoc(doc(db, 'admin_data_entry_alerts', alertId), newAlert);
        setAlertNote('');
      } catch (e) {
        console.error('Error saving shared alert:', e);
      }
    } else {
      const newAlert: AlertItem = {
        id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
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
    }
  };

  const handleSaveNote = async () => {
    if (!newNote.trim()) return;
    
    if (isAdminOrDataEntry) {
      const noteId = `ad_note_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const noteObj: NoteItem = {
        id: noteId,
        authorName: currentUser.name || (isAdmin ? 'الأدمن' : 'مدخل البيانات'),
        authorRole: isAdmin ? 'الأدمن' : 'مدخل البيانات',
        content: newNote.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      try {
        await setDoc(doc(db, 'admin_data_entry_notes', noteId), noteObj);
        setNewNote('');
      } catch (e) {
        console.error('Error saving shared note:', e);
      }
    } else {
      const noteObj: NoteItem = {
        id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
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
    }
  };

  const handleUpdateNote = async (id: string) => {
    if (!editingNoteContent.trim()) return;
    try {
      if (isAdminOrDataEntry) {
        await updateDoc(doc(db, 'admin_data_entry_notes', id), {
          content: editingNoteContent.trim(),
          updatedAt: Date.now()
        });
      } else {
        await updateDoc(doc(db, 'delegate_notes', id), {
          content: editingNoteContent.trim(),
          updatedAt: Date.now()
        });
      }
      setEditingNoteId(null);
      setEditingNoteContent('');
    } catch (e) {
      console.error('Error updating note:', e);
    }
  };

  const handleDeleteNote = async (id: string) => {
    try {
      if (isAdminOrDataEntry) {
        await deleteDoc(doc(db, 'admin_data_entry_notes', id));
      } else {
        await deleteDoc(doc(db, 'delegate_notes', id));
      }
    } catch (e) {
      console.error('Error deleting note:', e);
    }
  };
  
  const handleDeleteAlert = async (id: string) => {
    try {
      if (isAdminOrDataEntry) {
        await deleteDoc(doc(db, 'admin_data_entry_alerts', id));
      } else {
        await deleteDoc(doc(db, 'delegate_alerts', id));
      }
    } catch (e) {
      console.error('Error deleting alert:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
      <div className={`w-[95%] sm:w-full max-w-md sm:max-w-xl h-[75vh] sm:h-[82vh] max-h-[620px] sm:max-h-[800px] flex flex-col rounded-2xl shadow-2xl border overflow-hidden ${isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
        
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-2.5 sm:px-6 sm:py-3.5 border-b shrink-0 ${isDarkMode ? 'border-slate-800 bg-slate-800/60' : 'border-slate-100 bg-slate-50'}`}>
          <h2 className="text-sm sm:text-base font-black flex items-center gap-2">
            <div className="relative">
              <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
              {(() => {
                const count = alerts.length + notes.length + (!isAdminOrDataEntry ? globalNotifs.filter(n => !readsMap[n.id]).length : 0);
                return count > 0 ? (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full w-3.5 h-3.5 sm:w-4 sm:h-4 flex items-center justify-center font-bold">{count}</span>
                ) : null;
              })()}
            </div>
            <span className="truncate">
              {isAdmin 
                ? 'إشعارات وتنبيهات الأدمن' 
                : isDataEntry 
                ? 'إشعارات وتنبيهات مدخل البيانات' 
                : `لوحة المندوب: ${currentUser?.name}`}
            </span>
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Tabs - Hiding daily tasks and notifications for Admin and Data Entry */}
        <div className="flex items-center p-2 sm:p-3 gap-1.5 sm:gap-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <button 
            onClick={() => setActiveTab('alerts')} 
            className={`flex-1 py-1.5 sm:py-2 rounded-lg font-bold text-[11px] sm:text-xs transition-colors flex items-center justify-center gap-1 sm:gap-1.5 ${
              activeTab === 'alerts' 
                ? 'bg-emerald-500 text-white shadow-sm' 
                : (isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
            }`}
          >
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>{isAdminOrDataEntry ? 'التنبيهات المشتركة' : 'تنبيهاتي'}</span>
            {alerts.length > 0 && (
              <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.2 rounded-full font-black">
                {alerts.length}
              </span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab('notes')} 
            className={`flex-1 py-1.5 sm:py-2 rounded-lg font-bold text-[11px] sm:text-xs transition-colors flex items-center justify-center gap-1 sm:gap-1.5 ${
              activeTab === 'notes' 
                ? 'bg-emerald-500 text-white shadow-sm' 
                : (isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
            }`}
          >
            <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>{isAdminOrDataEntry ? 'الملاحظات المشتركة' : 'ملاحظاتي'}</span>
            {notes.length > 0 && (
              <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.2 rounded-full font-black">
                {notes.length}
              </span>
            )}
          </button>

          {/* Daily tasks and Notifications are ONLY for delegates */}
          {!isAdminOrDataEntry && (
            <>
              <button 
                onClick={() => setActiveTab('notifications')} 
                className={`flex-1 py-1.5 sm:py-2 rounded-lg font-bold text-[11px] sm:text-xs transition-colors ${
                  activeTab === 'notifications' 
                    ? 'bg-emerald-500 text-white' 
                    : (isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')
                }`}
              >
                إشعارات
              </button>
              <button 
                onClick={() => setActiveTab('tasks')} 
                className={`flex-1 py-1.5 sm:py-2 rounded-lg font-bold text-[11px] sm:text-xs transition-colors ${
                  activeTab === 'tasks' 
                    ? 'bg-emerald-500 text-white' 
                    : (isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')
                }`}
              >
                المهام اليومية
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5">
          {activeTab === 'alerts' && (
            <div className="space-y-4 sm:space-y-5">
              <div className={`p-3 sm:p-4 rounded-xl border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <h3 className="font-bold mb-2 text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2">
                  <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500" />
                  <span>{isAdminOrDataEntry ? 'إضافة تنبيه يظهر للأدمن ومدخل البيانات فوراً' : 'إضافة تنبيه جديد'}</span>
                </h3>
                <textarea 
                  value={alertNote}
                  onChange={(e) => setAlertNote(e.target.value)}
                  placeholder={isAdminOrDataEntry ? "اكتب التنبيه هنا (سيظهر للأدمن ومدخل البيانات فوراً)..." : "اكتب التنبيه هنا..."}
                  className={`w-full p-2.5 rounded-lg border text-xs sm:text-sm mb-2.5 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
                  rows={2}
                />
                <div className="flex flex-wrap gap-2 mb-2.5">
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[9px] sm:text-[10px] mb-0.5 opacity-70">التاريخ</label>
                    <input type="date" value={alertDate} onChange={e => setAlertDate(e.target.value)} className={`w-full p-1.5 sm:p-2 rounded-lg border text-xs ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`} />
                  </div>
                  <div className="w-[68px] sm:w-[80px]">
                    <label className="block text-[9px] sm:text-[10px] mb-0.5 opacity-70">الساعة</label>
                    <select value={alertHour} onChange={e => setAlertHour(e.target.value)} className={`w-full p-1.5 sm:p-2 rounded-lg border text-xs ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}>
                      {Array.from({length: 24}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                    </select>
                  </div>
                  <div className="w-[68px] sm:w-[80px]">
                    <label className="block text-[9px] sm:text-[10px] mb-0.5 opacity-70">الدقيقة</label>
                    <select value={alertMinute} onChange={e => setAlertMinute(e.target.value)} className={`w-full p-1.5 sm:p-2 rounded-lg border text-xs ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}>
                      {Array.from({length: 60}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={handleSaveAlert} className="w-full py-1.5 sm:py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors text-xs sm:text-sm shadow-sm cursor-pointer">
                  حفظ التنبيه
                </button>
              </div>
              
              <div className="space-y-2.5">
                <h3 className="font-bold text-xs sm:text-sm opacity-80 flex items-center justify-between">
                  <span>التنبيهات المحفوظة</span>
                  <span className="text-[11px] opacity-60">({alerts.length})</span>
                </h3>
                {alerts.length === 0 ? (
                  <p className="text-xs opacity-50 text-center py-4">لا توجد تنبيهات محفوظة</p>
                ) : alerts.map(a => (
                  <div key={a.id} className={`p-2.5 sm:p-3.5 rounded-xl border flex items-start justify-between gap-2.5 shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                    <div className="flex-1">
                      {isAdminOrDataEntry && (
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] sm:text-[10px] font-black ${
                            (a.authorRole === 'الأدمن' || a.authorName === 'الأدمن')
                              ? 'bg-purple-600 text-white'
                              : 'bg-blue-600 text-white'
                          }`}>
                            بواسطة: {a.authorRole || a.authorName || 'تنبيه'}
                          </span>
                        </div>
                      )}
                      <p className="font-bold text-xs sm:text-sm mb-0.5 leading-relaxed">{a.note}</p>
                      <p className="text-[9px] sm:text-[10px] opacity-70 text-emerald-500 font-bold">
                        موعد التنبيه: {new Date(a.targetTime).toLocaleString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                      </p>
                    </div>
                    <button 
                      onClick={() => handleDeleteAlert(a.id)} 
                      className="p-1 rounded-md hover:bg-red-500/10 text-red-500 transition-colors flex items-center gap-1 text-[11px] font-bold shrink-0 cursor-pointer"
                      title="مسح التنبيه"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>مسح</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-4 sm:space-y-5">
              <div className={`p-3 sm:p-4 rounded-xl border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <h3 className="font-bold mb-2 text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2">
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500" />
                  <span>{isAdminOrDataEntry ? 'إضافة ملاحظة تظهر للأدمن ومدخل البيانات فوراً' : 'إضافة ملاحظة'}</span>
                </h3>
                <textarea 
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={isAdminOrDataEntry ? "اكتب ملاحظتك هنا (ستظهر مباشرة للأدمن ومدخل البيانات)..." : "اكتب ملاحظتك هنا..."}
                  className={`w-full p-2.5 rounded-lg border text-xs sm:text-sm mb-2.5 min-h-[75px] sm:min-h-[90px] ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
                />
                <button onClick={handleSaveNote} className="w-full py-1.5 sm:py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors text-xs sm:text-sm shadow-sm cursor-pointer">
                  حفظ الملاحظة
                </button>
              </div>

              <div className="space-y-2.5">
                <h3 className="font-bold text-xs sm:text-sm opacity-80 flex items-center justify-between">
                  <span>الملاحظات المحفوظة</span>
                  <span className="text-[11px] opacity-60">({notes.length})</span>
                </h3>

                {notes.length === 0 ? (
                  <p className="text-xs opacity-50 text-center py-4">لا توجد ملاحظات محفوظة</p>
                ) : notes.map(n => (
                  <div 
                    key={n.id} 
                    className={`p-2.5 sm:p-3.5 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${
                      isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-amber-50/80 border-amber-200'
                    }`}
                  >
                    {/* Header above the note: Author + Edit and Delete buttons (تعديل أو مسح) */}
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/50 dark:border-slate-700/60">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.2 rounded text-[9px] sm:text-[10px] font-black ${
                          (n.authorRole === 'الأدمن' || n.authorName === 'الأدمن')
                            ? 'bg-purple-600 text-white'
                            : 'bg-blue-600 text-white'
                        }`}>
                          {n.authorRole || n.authorName || 'ملاحظة'}
                        </span>
                        <span className="text-[9px] sm:text-[10px] opacity-60 font-bold">
                          {new Date(n.createdAt).toLocaleDateString('ar-EG')} - {new Date(n.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {n.updatedAt && n.updatedAt !== n.createdAt && (
                          <span className="text-[8px] text-amber-500 font-bold">(معدلة)</span>
                        )}
                      </div>

                      {/* Action buttons: تعديل او مسح فوق الملاحظة */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingNoteId(n.id);
                            setEditingNoteContent(n.content);
                          }}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white transition-all shadow-sm active:scale-95 cursor-pointer"
                          title="تعديل الملاحظة"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>

                        <button
                          onClick={() => handleDeleteNote(n.id)}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-bold bg-red-500 hover:bg-red-600 text-white transition-all shadow-sm active:scale-95 cursor-pointer"
                          title="مسح الملاحظة"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>مسح</span>
                        </button>
                      </div>
                    </div>

                    {/* Content of the note or Edit Form */}
                    {editingNoteId === n.id ? (
                      <div className="flex flex-col gap-1.5 mt-1">
                        <textarea
                          value={editingNoteContent}
                          onChange={(e) => setEditingNoteContent(e.target.value)}
                          className={`w-full p-2 rounded-lg border text-xs sm:text-sm font-bold ${
                            isDarkMode ? 'bg-slate-900 border-slate-600 text-white' : 'bg-white border-amber-300 text-slate-800'
                          }`}
                          rows={3}
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleUpdateNote(n.id)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg transition-all shadow-sm cursor-pointer"
                          >
                            حفظ التعديل
                          </button>
                          <button
                            onClick={() => {
                              setEditingNoteId(null);
                              setEditingNoteContent('');
                            }}
                            className="px-2.5 py-1 bg-slate-500 hover:bg-slate-600 text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="font-bold text-xs sm:text-sm leading-relaxed whitespace-pre-wrap text-slate-900 dark:text-slate-100 pr-0.5">
                        {n.content}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'notifications' && !isAdminOrDataEntry && (
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
                <select disabled={!currentUser?.isAdmin} value={routeFilterDelegate} onChange={e => setRouteFilterDelegate(e.target.value)} className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'} ${!currentUser?.isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <option value="">كل المندوبين</option>
                  {delegatesList.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <select value={routeFilterDay} onChange={e => setRouteFilterDay(e.target.value)} className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}>
                  <option value="">كل الأيام</option>
                  <option value="السبت">السبت</option>
                  <option value="الاحد">الاحد</option>
                  <option value="الاثنين">الاثنين</option>
                  <option value="الثلاثاء">الثلاثاء</option>
                  <option value="الاربعاء">الاربعاء</option>
                  <option value="الخميس">الخميس</option>
                </select>
                <input 
                  type="text" 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  placeholder="بحث عن اسم محل..." 
                  className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}
                />
              </div>
              
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap">
                  <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                    <tr>
                      <th className="px-3 py-2 border-b dark:border-slate-700 cursor-pointer" onClick={() => handleSort('customerCode')}>الكود</th>
                      <th className="px-3 py-2 border-b dark:border-slate-700 cursor-pointer" onClick={() => handleSort('customerName')}>الاسم ({filteredRoutes.length})</th>
                      <th className="px-3 py-2 border-b dark:border-slate-700 cursor-pointer" onClick={() => handleSort('customerAddress')}>العنوان</th>
                      <th className="px-3 py-2 border-b dark:border-slate-700 cursor-pointer" onClick={() => handleSort('path')}>المسار</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
                    {Object.entries(filteredRoutes.reduce((acc, r) => {
                      const day = r.path || 'غير مصنف';
                      if (!acc[day]) acc[day] = [];
                      acc[day].push(r);
                      return acc;
                    }, {} as Record<string, RouteItem[]>)).map(([day, dayRoutes]) => (
                      <React.Fragment key={day}>
                        <tr>
                          <td colSpan={4} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                            {day}
                          </td>
                        </tr>
                        {dayRoutes.map(r => (
                          <tr key={r.id} className={`hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'} transition-colors`}>
                            <td className="px-3 py-2">{r.customerCode}</td>
                            <td className="px-3 py-2">{r.customerName}</td>
                            <td className="px-3 py-2">{r.customerAddress}</td>
                            <td className="px-3 py-2">{r.path}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && !isAdminOrDataEntry && (
            <div className="space-y-4">
              <h3 className="text-emerald-800 dark:text-emerald-200 font-black text-lg mb-4 text-center">المهام اليومية المسندة إليك</h3>
              {dailyTask ? (
                dailyTask.split('\n').filter(t => t.trim() !== '').map((task, index) => {
                  const isCompleted = completedTasks[index];
                  const completionTime = completionTimes[index] || 0;
                  const sixHoursMs = 6 * 60 * 60 * 1000;
                  
                  if (isCompleted && Date.now() - completionTime > sixHoursMs) {
                    return null;
                  }

                  return (
                    <div key={index} className="flex items-center p-4 bg-white dark:bg-slate-800 rounded-xl border border-emerald-100 dark:border-emerald-900 shadow-sm gap-3">
                      <div className="flex gap-1">
                        <button 
                          onClick={() => toggleTaskCompletion(index, true)}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                            isCompleted
                              ? 'bg-emerald-500 text-white' 
                              : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          }`}
                        >
                          ✓
                        </button>
                        <button 
                          onClick={() => toggleTaskCompletion(index, false)}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                            !isCompleted
                              ? 'bg-red-500 text-white' 
                              : 'bg-red-100 text-red-700 hover:bg-red-200'
                          }`}
                        >
                          ✗
                        </button>
                      </div>
                      <div className="flex-1 text-right">
                        <p className="font-bold text-sm sm:text-base text-emerald-900 dark:text-emerald-100">
                          {task}
                        </p>
                        {isCompleted && (
                          <p className="text-[10px] text-emerald-600 font-bold mt-1">
                            مكتملة في: {new Date(completionTime).toLocaleString('ar-EG')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center font-bold text-sm sm:text-base text-emerald-900 dark:text-emerald-100 bg-white/50 dark:bg-black/20 p-4 rounded-xl w-full shadow-sm">
                  لا توجد مهام مسندة لهذا اليوم.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
