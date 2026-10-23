import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { useSales, DEFAULT_CATEGORIES_LIST } from '../context/SalesContext';
import { RouteItem } from '../types';
import { db } from '../lib/firebase';
import { collection, writeBatch, doc, getDocs, setDoc, query, onSnapshot, deleteDoc, where } from 'firebase/firestore';
import { parseArabicDigits, parseArabicNumber, formatWithCommas } from '../utils/numberUtils';
import { PullToRefresh } from './PullToRefresh';
import { CollapsibleCard } from './admin/CollapsibleCard';
import { showConfirm } from '../utils/dialogService';
import {
  Lock,
  Unlock,
  Shield,
  User,
  Key,
  Save,
  Check,
  Eye,
  EyeOff,
  Clock,
  Calendar,
  HardDrive,
  RefreshCw,
  FileSpreadsheet,
  Upload,
  Download,
  Trash2,
  TrendingUp,
  Map as MapIcon,
  ClipboardList,
  Bell,
  ChevronDown,
  ChevronUp,
  FileText
} from 'lucide-react';


interface DebtItem {
  id: string;
  customerCode: string;
  customerName: string;
  amountDue: number;
  invoiceDate: string;
  paymentDueDate: string;
  delegateName: string;
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

export const AdminScreen: React.FC = () => {
  const {
    currentUser,
    rawSavedEntries,
    delegateTargets,
    delegateAccounts,
    delegatesList,
    saveDelegateAccount,
    addDelegateAccount,
    updateDelegateIdentity,
    resetDelegateAccount,
    deleteDelegateAccount,
    batchUpdateDelegateTargets,
    getDelegateLockStatus,
    unlockDelegateTargetManually,
    exportBackupData,
    restoreBackupData,
    isDarkMode,
    syncData,
    allSalesEntries,
    selectedDate,
    isPowerSavingMode,
    togglePowerSavingMode
  } = useSales();

  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [editingDebt, setEditingDebt] = useState<DebtItem | null>(null);
  const [editDebtValues, setEditDebtValues] = useState<Partial<DebtItem>>({});

  const handleSaveDailyTask = async () => {
    if (!dailyTaskDelegate || !dailyTaskText.trim()) {
      setDailyTaskMessage('يرجى اختيار المندوب وكتابة المهمة');
      return;
    }
    try {
      await setDoc(doc(db, 'dailyTasks', dailyTaskDelegate), {
        delegateName: dailyTaskDelegate,
        taskText: dailyTaskText.trim(),
        updatedAt: Date.now()
      });
      setDailyTaskMessage('تم حفظ المهمة اليومية بنجاح ✅');
      setDailyTaskText('');
    } catch (e) {
      console.error(e);
      setDailyTaskMessage('حدث خطأ أثناء الحفظ');
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'debts'));
    const unsub = onSnapshot(q, (snap) => {
        const arr: DebtItem[] = [];
        snap.forEach(d => arr.push({ id: d.id, ...d.data() } as DebtItem));
        setDebts(arr);
    });
    return unsub;
  }, []);


  // --- Route Management State ---
  const [routeUploadMessage, setRouteUploadMessage] = useState<string | null>(null);
  const [dailyTaskDelegate, setDailyTaskDelegate] = useState<string>('');
  const [dailyTaskText, setDailyTaskText] = useState<string>('');
  const [dailyTaskMessage, setDailyTaskMessage] = useState<string | null>(null);

  // --- Admin Note State ---
  const [noteCustomerCode, setNoteCustomerCode] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteExpiryHours, setNoteExpiryHours] = useState('');
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  
  const handleSaveAdminNote = async () => {
    if (!noteCustomerCode || !noteContent || !noteExpiryHours) {
        setNoteMessage('يرجى ملء جميع الحقول');
        return;
    }
    const expiryTimestamp = Date.now() + parseInt(noteExpiryHours) * 60 * 60 * 1000;
    await setDoc(doc(collection(db, 'admin_notes')), {
        customerCode: noteCustomerCode,
        note: noteContent,
        expiryTimestamp: expiryTimestamp
    });
    setNoteMessage('تم حفظ الملاحظة');
    setNoteCustomerCode('');
    setNoteContent('');
    setNoteExpiryHours('');
    setTimeout(() => setNoteMessage(null), 3000);
  };
  const [newDelegateData, setNewDelegateData] = useState({ oldName: '', oldUsername: '', newName: '', newUsername: '', newPassword: '' });
  const [backupStatusMsg, setBackupStatusMsg] = useState<string | null>(null);

  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [allAlerts, setAllAlerts] = useState<AlertItem[]>([]);
  const [allNotes, setAllNotes] = useState<NoteItem[]>([]);
  const [routeFilterDelegate, setRouteFilterDelegate] = useState('');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof RouteItem; direction: 'asc' | 'desc' } | null>(null);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;
  
  const filteredRoutes = routes.filter(r => 
    (routeFilterDelegate ? r.delegateName.trim() === routeFilterDelegate.trim() : true) && 
    (routeFilterDay ? r.path?.includes(routeFilterDay) : true) &&
    (searchQuery ? r.customerName.includes(searchQuery) : true)
  );

  const sortedRoutes = filteredRoutes.sort((a, b) => {
    if (!sortConfig) return 0;
    const aVal = a[sortConfig.key] || '';
    const bVal = b[sortConfig.key] || '';
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const paginatedRoutes = sortedRoutes.slice(0, currentPage * rowsPerPage);

  const handleSort = (key: keyof RouteItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  const exportRoutesToExcel = () => {
    const data = filteredRoutes.map(r => ({
      'كود الزبون': r.customerCode,
      'اسم الزبون': r.customerName,
      'العنوان': r.customerAddress,
      'المسار': r.path,
      'حالة الزيارة': allSalesEntries.some(e => e.customerName === r.customerName && e.dateString === selectedDate) ? 'تمت الزيارة' : 'لم تتم'
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Routes");
    XLSX.writeFile(workbook, `routes_export_${selectedDate}.xlsx`);
  };

  const [globalNotifText, setGlobalNotifText] = useState<string>('');
  const [globalNotifMessage, setGlobalNotifMessage] = useState<string | null>(null);


  const handleRouteFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRouteUploadMessage('جاري معالجة ورفع مسارات المندوبين...');
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      if (jsonData.length <= 1) {
        setRouteUploadMessage('الملف فارغ أو لا يحتوي على بيانات صحيحة.');
        return;
      }

      const batch = writeBatch(db);
      
      const oldRoutes = await getDocs(collection(db, 'routes'));
      oldRoutes.docs.forEach((docSnap) => batch.delete(docSnap.ref));

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        const docRef = doc(collection(db, 'routes'));
        batch.set(docRef, {
          customerCode: row[0] || '',
          customerName: row[1] || '',
          customerAddress: row[2] || '',
          path: row[3] || '',
          customerType: row[4] || 'مفرد',
          delegateName: row[5] || '',
        });
      }
      
      await batch.commit();
      setRouteUploadMessage('تم رفع وتحديث المسارات بنجاح!');
      e.target.value = '';
    } catch (err) {
      console.error(err);
      setRouteUploadMessage('حدث خطأ أثناء الرفع.');
    }
  };

  const handleSaveDebt = async (debt: DebtItem) => {
    try {
      const docRef = doc(db, 'debts', debt.id);
      await setDoc(docRef, editDebtValues, { merge: true });
      setEditingDebt(null);
      setEditDebtValues({});
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteDebt = async (debtId: string) => {
    if (!(await showConfirm("هل أنت متأكد من حذف هذا الدين؟"))) return;
    try {
      await deleteDoc(doc(db, 'debts', debtId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveGlobalNotification = async () => {
    if (!globalNotifText) {
      setGlobalNotifMessage('يرجى كتابة نص الإشعار.');
      return;
    }
    setGlobalNotifMessage('جاري الإرسال...');
    try {
      const notifId = `notif_${Date.now()}`;
      await setDoc(doc(db, 'admin_notifications', notifId), {
        text: globalNotifText,
        timestamp: Date.now()
      });
      setGlobalNotifMessage('تم إرسال الإشعار لجميع المندوبين بنجاح!');
      setGlobalNotifText('');
    } catch (err) {
      console.error(err);
      setGlobalNotifMessage('حدث خطأ أثناء إرسال الإشعار.');
    }
  };

  // Fetch Routes and Delegate Data
  useEffect(() => {
    // Make sure we are fetching ALL routes for admin to display in list,
    // and correctly filtering for delegates
    const q = query(collection(db, 'routes'));
    const unsubRoutes = onSnapshot(q, (snap) => {
      const arr: RouteItem[] = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() } as RouteItem));
      console.log('Fetched routes:', arr.length);
      setRoutes(arr);
    });

    const alertsQ = query(collection(db, 'delegate_alerts'));
    const unsubAlerts = onSnapshot(alertsQ, (snap) => {
      const arr: AlertItem[] = [];
      snap.forEach(d => arr.push(d.data() as AlertItem));
      setAllAlerts(arr);
    });

    const notesQ = query(collection(db, 'delegate_notes'));
    const unsubNotes = onSnapshot(notesQ, (snap) => {
      const arr: NoteItem[] = [];
      snap.forEach(d => arr.push(d.data() as NoteItem));
      setAllNotes(arr);
    });

    return () => {
      unsubRoutes();
      unsubAlerts();
      unsubNotes();
    };
  }, []);

  const handleJsonBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsedData = JSON.parse(text);
        const success = restoreBackupData(parsedData);
        if (success) {
          setBackupStatusMsg('تمت استعادة ملف النسخة الاحتياطية بنجاح ✅');
        } else {
          setBackupStatusMsg('فشلت قراءة ملف النسخة الاحتياطية. يرجى التأكد من اختيار ملف صحيح.');
        }
      } catch (err) {
        setBackupStatusMsg('ملف غير صالح أو تالف.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };


  const [isAuthenticated, setIsAuthenticated] = useState(() => !!currentUser?.isAdmin);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const [selectedAdminDelegate, setSelectedAdminDelegate] = useState<string>('الكل');

  const getDelegateTotalTarget = (delName: string) => {
    return DEFAULT_CATEGORIES_LIST.reduce((sum, cat) => {
      const found = delegateTargets.find(t => 
        t.delegateName?.trim().toLowerCase() === delName.trim().toLowerCase() &&
        t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
      );
      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
    }, 0);
  };

  const totalAllTarget = delegatesList.reduce((sum, del) => sum + getDelegateTotalTarget(del), 0);

  const getCategoryAllTarget = (catName: string) => {
    return delegatesList.reduce((sum, del) => {
      const found = delegateTargets.find(t => 
        t.delegateName?.trim().toLowerCase() === del.trim().toLowerCase() &&
        t.categoryName?.trim().toLowerCase() === catName.trim().toLowerCase()
      );
      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
    }, 0);
  };

  // Input states for targets map (key: `${delegateName}_${categoryName}`)
  const [targetInputs, setTargetInputs] = useState<Record<string, string>>({});
  const [saveFeedbackMessage, setSaveFeedbackMessage] = useState<string | null>(null);
  const [allowForceOverride, setAllowForceOverride] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const container = e.currentTarget.closest('table, .grid-container');
      if (!container) return;
      const focusableElements = Array.from(
        container.querySelectorAll('input:not([disabled]), select:not([disabled])')
      ) as HTMLElement[];
      const index = focusableElements.indexOf(e.currentTarget);
      if (index > -1 && index + 1 < focusableElements.length) {
        focusableElements[index + 1].focus();
      } else if (index === focusableElements.length - 1) {
        const saveBtn = container.querySelector('button.save-btn') as HTMLElement;
        if (saveBtn) saveBtn.focus();
      }
    }
  };

  // Delegate credentials management state
  const [accountDelNameInput, setAccountDelNameInput] = useState('');
  const [accountUsernameInput, setAccountUsernameInput] = useState('');
  const [accountPasswordInput, setAccountPasswordInput] = useState('');
  const [accountDelegateCodeInput, setAccountDelegateCodeInput] = useState('');
  const [editingAccountUsername, setEditingAccountUsername] = useState<string | null>(null);
  const [editingIsAdmin, setEditingIsAdmin] = useState(false);

  const rafatCurrentAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'rafatdata' || d.role === 'dataEntry');
  const [rafatUsernameInput, setRafatUsernameInput] = useState(rafatCurrentAcc?.username || 'rafatdata');
  const [rafatPasswordInput, setRafatPasswordInput] = useState(rafatCurrentAcc?.password || '10001');

  const mohammedCurrentAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'mohammedsauce' || d.role === 'sauceOnly');
  const [mohammedUsernameInput, setMohammedUsernameInput] = useState(mohammedCurrentAcc?.username || 'mohammedsauce');
  const [mohammedPasswordInput, setMohammedPasswordInput] = useState(mohammedCurrentAcc?.password || 'm12343');

  useEffect(() => {
    if (rafatCurrentAcc) {
      setRafatUsernameInput(rafatCurrentAcc.username);
      setRafatPasswordInput(rafatCurrentAcc.password);
    }
  }, [rafatCurrentAcc?.username, rafatCurrentAcc?.password]);

  useEffect(() => {
    if (mohammedCurrentAcc) {
      setMohammedUsernameInput(mohammedCurrentAcc.username);
      setMohammedPasswordInput(mohammedCurrentAcc.password);
    }
  }, [mohammedCurrentAcc?.username, mohammedCurrentAcc?.password]);

  // Lock status for currently selected delegate
  const lockStatus = selectedAdminDelegate === 'الكل'
    ? { isLocked: false, daysRemaining: 0, setDateStr: '', unlockDateStr: '' }
    : getDelegateLockStatus(selectedAdminDelegate);

  // Overall metrics
  const totalCompanySalesWeight = rawSavedEntries.reduce((sum, e) => sum + e.totalWeightKg, 0);
  const totalCompanyTargetWeight = selectedAdminDelegate === 'الكل'
    ? totalAllTarget
    : getDelegateTotalTarget(selectedAdminDelegate);

  // Active targets for selected delegate
  const activeTargets = selectedAdminDelegate === 'الكل'
    ? []
    : delegateTargets.filter((t) => t.delegateName === selectedAdminDelegate);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const u = usernameInput.trim();
    const p = passwordInput.trim();

    const matchedAccount = delegateAccounts.find(
      (it) =>
        (it.username.toLowerCase() === u.toLowerCase() ||
          it.delegateName.toLowerCase() === u.toLowerCase()) &&
        it.password === p
    );

    const isDefaultAdmin =
      u.toLowerCase() === 'yasir' && p === '377377';

    if ((matchedAccount && matchedAccount.isAdmin) || isDefaultAdmin) {
      setIsAuthenticated(true);
      setLoginError(null);
    } else {
      setLoginError('اسم المستخدم أو الرمز السري غير صحيح');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4 dir-rtl">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-500/40 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-6 text-slate-800 dark:text-white transition-colors">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
              <Lock className="w-8 h-8" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">تسجيل دخول لوحة الأدمن</h2>
            <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
              يرجى إدخال اسم المستخدم والرمز السري للوصول للوحة التحكم
            </p>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">اسم المستخدم</label>
              <div className="relative">
                <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => {
                    setUsernameInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="اسم المستخدم"
                  className="w-full pl-3 pr-10 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-sm font-bold focus:border-emerald-500 dark:focus:border-emerald-400 focus:outline-none transition-colors"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">الرمز السري (كلمة المرور)</label>
              <div className="relative">
                <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="الرمز السري"
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-sm font-bold focus:border-emerald-500 dark:focus:border-emerald-400 focus:outline-none transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white p-1"
                >
                  {isPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-200 text-xs font-bold text-center">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition-all cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>تسجيل الدخول</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleSaveTargets = () => {
    const targetsList: { categoryName: string; targetKg: number }[] = [];

    DEFAULT_CATEGORIES_LIST.forEach((catName) => {
      const key = `${selectedAdminDelegate}_${catName}`;
      const inputVal = targetInputs[key];
      const activeObj = activeTargets.find(
        (t) => t.categoryName.toLowerCase() === catName.toLowerCase()
      );
      const defaultKg = activeObj?.dailyTargetWeightKg ?? 50.0;
      const targetKg = inputVal !== undefined ? parseArabicNumber(inputVal) : defaultKg;

      if (!isNaN(targetKg) && targetKg >= 0) {
        targetsList.push({ categoryName: catName, targetKg });
      }
    });

    const success = batchUpdateDelegateTargets(
      selectedAdminDelegate,
      targetsList,
      undefined,
      allowForceOverride
    );

    if (success) {
      setAllowForceOverride(false);
      setSaveFeedbackMessage(
        `✔️ تم تثبيت وحفظ التاركت لـ (${selectedAdminDelegate}) لمدة 31 يوماً بنجاح! التاركت محفوظ بصفة دائمية في جهاز الأدمن بالنظام ولن يضيع عند إطفاء الموقع.`
      );
    }
  };

  const handleStartEditAccount = (acc: { username: string; password: string; delegateName: string; isAdmin: boolean; delegateCode?: string }) => {
    setAccountDelNameInput(acc.delegateName);
    setAccountUsernameInput(acc.username);
    setAccountPasswordInput(acc.password);
    setAccountDelegateCodeInput(acc.delegateCode || '');
    setEditingAccountUsername(acc.username);
    setEditingIsAdmin(acc.isAdmin);
  };

  const handleCancelEditAccount = () => {
    setAccountDelNameInput('');
    setAccountUsernameInput('');
    setAccountPasswordInput('');
    setAccountDelegateCodeInput('');
    setEditingAccountUsername(null);
    setEditingIsAdmin(false);
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const delName = accountDelNameInput.trim();
    const u = accountUsernameInput.trim();
    const p = accountPasswordInput.trim();

    if (delName && u && p) {
      // If we were editing an existing account and the username changed, remove the old one first
      if (editingAccountUsername && editingAccountUsername !== u) {
        deleteDelegateAccount(editingAccountUsername);
      }

      saveDelegateAccount({
        username: u,
        password: p,
        delegateName: delName,
        monthlyTargetKg: 0,
        isAdmin: editingIsAdmin,
        delegateCode: accountDelegateCodeInput.trim() || undefined,
      });

      setSaveFeedbackMessage(
        editingAccountUsername
          ? `✔️ تم تحديث بيانات الدخول لـ (${delName}) بنجاح!`
          : `✔️ تم إنشاء وتخزين حساب جديد لـ (${delName}) بنجاح!`
      );

      handleCancelEditAccount();
    }
  };

  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="p-3 sm:p-4 max-w-5xl mx-auto space-y-5 dir-rtl text-slate-800 dark:text-slate-100 transition-colors">
        
      {/* Top Banner with Lock Button */}
      <div className="bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 border border-emerald-600/40 dark:border-emerald-500/30 rounded-3xl p-5 text-white shadow-xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
              <Shield className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white">
                لوحة تحكم الأدمن | إدارة الأهداف والتاركت
              </h2>
              <p className="text-xs text-emerald-200/80 font-medium">مراقبة الأداء وتعيين الأهداف والحسابات</p>
            </div>
          </div>

          <button
            onClick={() => {
              setIsAuthenticated(false);
              setPasswordInput('');
            }}
            className="px-3.5 py-2 bg-white/15 hover:bg-white/25 border border-white/20 rounded-xl text-xs font-black text-white flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>قفل الصفحة</span>
          </button>
        </div>

        <hr className="border-white/15" />

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-2xl bg-black/20 border border-white/10">
            <div className="text-emerald-200/90 font-bold mb-1">إجمالي مبيعات المناديب اليوم:</div>
            <div className="text-xl sm:text-2xl font-black text-emerald-300 tracking-tight">
              {formatWithCommas(parseFloat(totalCompanySalesWeight.toFixed(1)), true)} كجم
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-black/20 border border-white/10 text-left dir-ltr">
            <div className="text-slate-200/90 font-bold mb-1 dir-rtl">إجمالي التاركت المطلوب:</div>
            <div className="text-xl sm:text-2xl font-black text-white dir-rtl tracking-tight">
              {formatWithCommas(parseFloat(totalCompanyTargetWeight.toFixed(1)), true)} كجم
            </div>
          </div>
        </div>
      </div>


      {/* 1. Delegate Picker Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 text-slate-800 dark:text-white space-y-3 shadow-sm dark:shadow-md transition-colors">
        <h3 className="text-xs sm:text-sm font-black text-emerald-800 dark:text-emerald-300">
          1. اختر المندوب أو (الكل - الإدارة) لعرض وتحديد الأهداف وتاركت الأصناف:
        </h3>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setSelectedAdminDelegate('الكل');
              setSaveFeedbackMessage(null);
            }}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer ${
              selectedAdminDelegate === 'الكل'
                ? 'bg-amber-500 text-slate-950 shadow-md scale-105'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>الكل (نظرة عامة للإدارة)</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/10 dark:bg-emerald-950/80 text-slate-900 dark:text-amber-300 font-mono font-bold">
              {totalAllTarget} كجم
            </span>
          </button>

          {delegatesList.map((delName) => {
            const isSelected = selectedAdminDelegate === delName;
            const delTot = getDelegateTotalTarget(delName);
            return (
              <button
                key={delName}
                onClick={() => {
                  setSelectedAdminDelegate(delName);
                  setSaveFeedbackMessage(null);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-md scale-105 font-black'
                    : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>{delName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-900/80 text-emerald-700 dark:text-emerald-300 font-mono font-bold">
                  {delTot} كجم
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feedback Banner */}
      {saveFeedbackMessage && (
        <div className="p-3 bg-emerald-900 border border-emerald-400 text-white font-bold text-xs rounded-xl text-center shadow-md">
          {saveFeedbackMessage}
        </div>
      )}

      {/* 2. Target Dashboard (Admin / All vs Individual Delegate) */}
      {selectedAdminDelegate === 'الكل' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-black text-slate-900 dark:text-amber-200">
                لوحة الأهداف الكلية - الإدارة (الكل):
              </h3>
            </div>
            <div className="text-xs text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/80 px-3.5 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-700">
              إجمالي التاركت لكل المناديب: <span className="text-emerald-700 dark:text-white font-black text-sm">{totalAllTarget} كجم</span>
            </div>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
            يتم حساب إجمالي تاركت الإدارة ("الكل") وتاركت كل صنف ديناميكياً وبدقة تامة من مجموع أهداف المناديب الفردية. أي تعديل يتم على تاركت أي مندوب ينعكس فوراً على الإجمالي العام وتاركت الصنف المرتبط.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Delegates Breakdown Summary */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-3.5 space-y-3">
              <h4 className="text-xs font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>إجمالي تاركت كل مندوب (مجموع الأصناف):</span>
              </h4>
              <div className="space-y-2">
                {delegatesList.map((del) => {
                  const delT = getDelegateTotalTarget(del);
                  return (
                    <div key={del} className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs shadow-xs">
                      <div className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <button
                          onClick={() => setSelectedAdminDelegate(del)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-[11px] font-bold shadow-xs transition-all cursor-pointer"
                        >
                          تعديل أهداف المندوب ✏️
                        </button>
                        <span>{del}</span>
                      </div>
                      <div className="font-black text-emerald-700 dark:text-emerald-300 font-mono text-sm">
                        {delT} كجم
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Categories Admin / All Summary Table */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-3.5 space-y-3">
              <h4 className="text-xs font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>تاركت الأصناف لإدارة (الكل - مجموع المناديب):</span>
              </h4>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {DEFAULT_CATEGORIES_LIST.map((catName) => {
                  const catAllT = getCategoryAllTarget(catName);
                  return (
                    <div key={catName} className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs shadow-xs">
                      <span className="font-bold text-slate-700 dark:text-slate-200">{catName}</span>
                      <span className="font-black text-amber-600 dark:text-amber-300 font-mono">{catAllT} كجم</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
          {/* 31-Day Fixation Info Card */}
          <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-500/30 rounded-2xl p-4 text-xs space-y-3 shadow-inner">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-slate-600 dark:text-slate-300">حالة تثبيت التاركت للمندوب: </span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-black text-sm">{selectedAdminDelegate}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-[11px] font-black text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-300 dark:border-emerald-500/30 shadow-xs">
                  إجمالي تاركت المندوب الحالي: {getDelegateTotalTarget(selectedAdminDelegate)} كجم
                </span>
              </div>
            </div>

            {lockStatus.isLocked ? (
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-500/40 rounded-xl space-y-2.5 text-amber-950 dark:text-amber-100">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 font-black text-amber-800 dark:text-amber-300">
                    <Lock className="w-4 h-4" />
                    <span>التاركت مثبت لمدة 31 يوماً من الأدمن</span>
                  </div>
                  <div className="bg-amber-500 text-white dark:bg-amber-500/20 dark:text-amber-200 px-3 py-1 rounded-full font-black text-xs border border-amber-400/40 shadow-xs">
                    متبقي {lockStatus.daysRemaining} يوماً لإمكانية إعادة التعديل
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>تاريخ بدء التثبيت: </span>
                    <strong className="text-slate-900 dark:text-white font-black">{lockStatus.setDateStr}</strong>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>تاريخ انتهاء القفل والتعديل القادم: </span>
                    <strong className="text-slate-900 dark:text-white font-black">{lockStatus.unlockDateStr}</strong>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between flex-wrap gap-2 border-t border-amber-200 dark:border-amber-800/60">
                  <span className="text-[11px] text-amber-900 dark:text-amber-200/80 font-medium">
                    التاركت مثبت لمنع التغيير العشوائي، وسيكون متاحاً للتعديل التلقائي بعد 31 يوماً.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        unlockDelegateTargetManually(selectedAdminDelegate);
                        setSaveFeedbackMessage(`تم إلغاء القفل لـ (${selectedAdminDelegate}) بنجاح.`);
                      }}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>فصل القفل يدوياً</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllowForceOverride(!allowForceOverride)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        allowForceOverride
                          ? 'bg-rose-600 border-rose-400 text-white shadow-xs'
                          : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {allowForceOverride ? 'وضع التجاوز نشط' : 'تعديل استثنائي'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-500/40 rounded-xl space-y-1 text-emerald-950 dark:text-emerald-100">
                <div className="flex items-center gap-1.5 font-black text-emerald-800 dark:text-emerald-300">
                  <Unlock className="w-4 h-4" />
                  <span>التاركت متاح للتعديل الآن!</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                  عند الضغط على "تثبيت وحفظ التاركت"، سيتم قفل التاركت تلقائياً لمدة 31 يوماً، وحفظه بصفة دائمية في الجهاز ولن ينمسح عند إغلاق أو إطفاء الموقع.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
              تحديد التاركت اليومي لأصناف المندوب ({selectedAdminDelegate}) - إجمالي المندوب: {getDelegateTotalTarget(selectedAdminDelegate)} كجم:
            </h3>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedAdminDelegate('الكل')}
                className="px-3 py-2 bg-slate-100 dark:bg-emerald-900/80 hover:bg-slate-200 dark:hover:bg-emerald-800 text-slate-800 dark:text-emerald-200 rounded-xl text-xs font-bold border border-slate-300 dark:border-emerald-700 transition-colors cursor-pointer"
              >
                العودة لنظرة الإدارة الكلية (الكل)
              </button>
              <button
                onClick={handleSaveTargets}
                disabled={lockStatus.isLocked && !allowForceOverride}
                className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer ${
                  lockStatus.isLocked && !allowForceOverride
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-300 dark:border-slate-700'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <Save className="w-4 h-4" />
                <span>
                  {lockStatus.isLocked && !allowForceOverride
                    ? 'التاركت مثبت لمدة 31 يوماً'
                    : 'تثبيت وحفظ التاركت (31 يوماً)'}
                </span>
              </button>
            </div>
          </div>

        <div className="border border-slate-200 dark:border-emerald-800/60 rounded-xl overflow-hidden bg-white dark:bg-slate-900/80 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
            <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-800'}`}>
              <tr>
                <th className="py-2.5 px-3 w-[10%]">#</th>
                <th className="py-2.5 px-3 w-[35%]">اسم الصنف</th>
                <th className="py-2.5 px-3 text-center w-[30%]">التاركت اليومي (كجم)</th>
                <th className="py-2.5 px-3 text-left w-[25%]">مبيعات اليوم</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
                {DEFAULT_CATEGORIES_LIST.map((catName, idx) => {
                  const currentObj = activeTargets.find(
                    (t) => t.categoryName.toLowerCase() === catName.toLowerCase()
                  );
                  const dbTargetKg = currentObj?.dailyTargetWeightKg ?? 50.0;

                  const key = `${selectedAdminDelegate}_${catName}`;
                  const currentInputValue =
                    targetInputs[key] !== undefined ? targetInputs[key] : String(dbTargetKg);

                  const delSalesToday = rawSavedEntries
                    .filter(
                      (e) =>
                        e.delegateName === selectedAdminDelegate &&
                        e.categoryName.toLowerCase() === catName.toLowerCase()
                    )
                    .reduce((sum, e) => sum + e.totalWeightKg, 0);

                  const isAchieved = delSalesToday >= dbTargetKg && dbTargetKg > 0;
                  const isInputDisabled = lockStatus.isLocked && !allowForceOverride;

                  return (
                    <tr key={catName} className={`transition-colors ${idx % 2 === 0 ? (isDarkMode ? 'bg-slate-800/40' : 'bg-slate-50') : (isDarkMode ? 'bg-slate-900/90' : 'bg-white')} hover:${isDarkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                      <td className="py-2.5 px-3 font-bold text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                        <div>{catName}</div>
                        {isAchieved && (
                          <span className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <Check className="w-3 h-3" /> مُحقق 100%
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={isInputDisabled}
                          value={currentInputValue}
                          onKeyDown={handleKeyDown}
                          onChange={(e) => {
                            setTargetInputs({
                              ...targetInputs,
                              [key]: parseArabicDigits(e.target.value),
                            });
                          }}
                          className={`w-24 px-2 py-1.5 border rounded-lg font-bold text-center text-xs focus:outline-none transition-colors ${
                            isInputDisabled
                              ? 'bg-slate-100 dark:bg-slate-950/80 border-slate-300 dark:border-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-white dark:bg-slate-950 border-emerald-600 dark:border-emerald-700/80 text-slate-900 dark:text-white focus:border-emerald-500'
                          }`}
                        />
                      </td>
                      <td className="py-2.5 px-3 text-left font-black text-emerald-700 dark:text-emerald-300">
                        {formatWithCommas(parseFloat(delSalesToday.toFixed(1)), true)} كجم
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* 4. Delegate & Admin Credentials Management */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
              4. إدارة تعديل اسم المستخدم والرمز السري لكل حساب:
            </h3>
          </div>

          {editingAccountUsername && (
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-500/60 px-3 py-1 rounded-xl text-xs">
              <span className="text-amber-900 dark:text-amber-200 font-bold">جارٍ تعديل الحساب ({editingAccountUsername})</span>
              <button
                type="button"
                onClick={handleCancelEditAccount}
                className="text-amber-700 dark:text-amber-400 hover:underline font-black text-[11px] cursor-pointer"
              >
                إلغاء التعديل
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
          يمكنك إضافة حسابات جديدة أو التعديل على اسم المستخدم والرمز السري لأي حساب مسجل بسهولة.
        </p>

        <form onSubmit={handleSaveAccount} className="space-y-3 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">اسم المندوب / الحساب</label>
              <input
                type="text"
                value={accountDelNameInput}
                onChange={(e) => setAccountDelNameInput(e.target.value)}
                placeholder="اسم المندوب"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">اسم المستخدم</label>
              <input
                type="text"
                value={accountUsernameInput}
                onChange={(e) => setAccountUsernameInput(e.target.value)}
                placeholder="اسم المستخدم"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">الرمز السري</label>
              <input
                type="text"
                value={accountPasswordInput}
                onChange={(e) => setAccountPasswordInput(e.target.value)}
                placeholder="الرمز السري"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
                required
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">كود المندوب</label>
            <input
              type="text"
              value={accountDelegateCodeInput}
              onChange={(e) => setAccountDelegateCodeInput(e.target.value)}
              placeholder="كود المندوب"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              className={`flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 cursor-pointer ${
                editingAccountUsername
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              <Save className="w-4 h-4" />
              <span>{editingAccountUsername ? 'تحديث بيانات الحساب' : 'حفظ بيانات الحساب الجديد'}</span>
            </button>

            {editingAccountUsername && (
              <button
                type="button"
                onClick={async () => {
                  if (await showConfirm('هل أنت متأكد من حذف حساب المندوب هذا تماماً من النظام؟')) {
                    deleteDelegateAccount(editingAccountUsername);
                    handleCancelEditAccount();
                  }
                }}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                حذف الحساب
              </button>
            )}

            {editingAccountUsername && (
              <button
                type="button"
                onClick={handleCancelEditAccount}
                className="px-4 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-xl font-bold text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            )}
          </div>
        </form>

        {/* Existing Accounts List */}
        <div className="pt-3 space-y-2.5 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-black text-emerald-800 dark:text-emerald-300">قائمة الحسابات المسجلة:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {delegateAccounts.map((acc) => (
              <div
                key={acc.username}
                className={`p-3.5 border rounded-2xl flex items-center justify-between text-xs transition-all shadow-xs ${
                  editingAccountUsername === acc.username
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400'
                    : 'bg-slate-50 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div>
                  <div className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>{acc.delegateName}</span>
                    {acc.isAdmin && (
                      <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold rounded-md border border-emerald-300 dark:border-emerald-700">
                        الأدمن
                      </span>
                    )}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 mt-1 font-medium">
                    مستخدم: <strong className="text-slate-800 dark:text-slate-200 font-mono">{acc.username}</strong> | رمز: <strong className="text-slate-800 dark:text-slate-200 font-mono">{acc.password}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStartEditAccount(acc)}
                    className="px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <span>تعديل</span>
                  </button>

                  {!acc.isAdmin && (
                    <button
                      type="button"
                      onClick={async () => { if(await showConfirm('هل أنت متأكد من حذف حساب المندوب هذا؟')) deleteDelegateAccount(acc.username) }}
                      className="px-2.5 py-1.5 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-800 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                    >
                      حذف
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. JSON Backup Export & Import */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <HardDrive className="w-4 h-4" />
          </div>
          <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
            5. النسخ الاحتياطي وتخزين البيانات الحالية (JSON):
          </h3>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
          تتيح هذه الميزة للأدمن تحميل جميع بيانات Firestore الحالية (المبيعات، المخزن، التاركت، الحسابات) في ملف JSON موحد ومحمي.
        </p>

        {backupStatusMsg && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-500 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-200 text-center">
            {backupStatusMsg}
          </div>
        )}

        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            onClick={exportBackupData}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تنزيل نسخة بيانات كاملة</span>
          </button>

          <label className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-xs">
            <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>استعادة نسخة بيانات كاملة من ملف JSON</span>
            <input
              type="file"
              accept=".json"
              onChange={handleJsonBackupImport}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* 9. Data Saver Mode Toggle */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
            <Shield className="w-4 h-4" />
          </div>
          <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
            9. وضع توفير البيانات (Data Saver Mode):
          </h3>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
          تفعيل وضع توفير الطاقة لتقليل استهلاك موارد الجهاز والإنترنت للمندوبين (يقوم بتقليل مزامنة الخلفية التلقائية وتحديثات الصور غير الضرورية).
        </p>
        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-950/80 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
            حالة وضع توفير الطاقة: <span className={isPowerSavingMode ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-slate-500 font-bold'}>{isPowerSavingMode ? 'مفعل (نشط)' : 'معطل'}</span>
          </span>
          <button
            onClick={togglePowerSavingMode}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 cursor-pointer shadow-xs ${
              isPowerSavingMode ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isPowerSavingMode ? 'إيقاف وضع توفير الطاقة' : 'تفعيل وضع توفير الطاقة'}
          </button>
        </div>
      </div>

      {/* Admin Note Section */}
      <CollapsibleCard title="إدارة ملاحظات المندوبين" icon={<Bell className="w-5 h-5 text-amber-500 dark:text-amber-300" />}>
        <div className="space-y-3">
          <input
            placeholder="كود الزبون"
            value={noteCustomerCode}
            onChange={(e) => setNoteCustomerCode(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
          />
          <textarea
            placeholder="نص الملاحظة"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            rows={3}
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
          />
          <input
            type="number"
            placeholder="مدة الصلاحية (بالساعات)"
            value={noteExpiryHours}
            onChange={(e) => setNoteExpiryHours(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
          />
          <button
            onClick={handleSaveAdminNote}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-98"
          >
            حفظ الملاحظة
          </button>
          {noteMessage && <p className="text-center text-xs text-emerald-700 dark:text-emerald-300 font-bold">{noteMessage}</p>}
        </div>
      </CollapsibleCard>


      {/* 12. Manage Delegate Accounts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Shield className="w-4 h-4" />
          </div>
          <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
            إدارة حسابات خاصة (تعديل الاسم والرمز):
          </h3>
        </div>
        
        {/* Rafat Account Card */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-4 space-y-3">
          <label className="text-xs font-black text-emerald-800 dark:text-emerald-300">التحكم بحساب مدخل البيانات (رأفت جمال):</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input 
              type="text" placeholder="اسم المستخدم" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={rafatUsernameInput} onChange={e => setRafatUsernameInput(e.target.value)}
            />
            <input 
              type="text" placeholder="كلمة المرور" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={rafatPasswordInput} onChange={e => setRafatPasswordInput(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              const u = rafatUsernameInput.trim().toLowerCase();
              const p = rafatPasswordInput.trim();
              if (!u || !p) {
                alert('يرجى ملء اسم المستخدم وكلمة المرور لمدخل البيانات');
                return;
              }

              const rafatAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'rafatdata' || d.role === 'dataEntry') || {
                username: 'rafatdata',
                password: '10001',
                delegateName: 'رأفت جمال',
                monthlyTargetKg: 0,
                isAdmin: true,
                role: 'dataEntry' as const,
              };

              const updatedRafat = { 
                ...rafatAcc, 
                username: u, 
                password: p,
                delegateName: 'رأفت جمال',
                isAdmin: true,
                role: 'dataEntry' as const,
              };
              saveDelegateAccount(updatedRafat);
              
              if (rafatAcc.username && rafatAcc.username.toLowerCase() !== u) {
                deleteDelegateAccount(rafatAcc.username);
              }

              setSaveFeedbackMessage('تم تحديث بيانات مدخل البيانات بنجاح.');
              setTimeout(() => setSaveFeedbackMessage(null), 3000);
            }}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-black shadow-md cursor-pointer transition-all"
          >
            حفظ بيانات مدخل البيانات
          </button>
          {saveFeedbackMessage && <div className="text-[10px] text-emerald-600 dark:text-emerald-400 text-center font-bold">{saveFeedbackMessage}</div>}
          
          <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 space-y-1 border border-slate-200 dark:border-slate-700 shadow-xs">
              <p>اسم المستخدم: <span className="text-slate-900 dark:text-white font-black font-mono">{rafatUsernameInput}</span></p>
              <p>كلمة المرور: <span className="text-slate-900 dark:text-white font-black font-mono">{rafatPasswordInput}</span></p>
          </div>
        </div>

        {/* Mohammed Sauce User Account Management */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-4 space-y-3">
          <label className="text-xs font-black text-amber-800 dark:text-amber-300">التحكم بحساب المستخدم (mohammedsauce):</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input 
              type="text" placeholder="اسم المستخدم" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={mohammedUsernameInput} onChange={e => setMohammedUsernameInput(e.target.value)}
            />
            <input 
              type="text" placeholder="كلمة المرور" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={mohammedPasswordInput} onChange={e => setMohammedPasswordInput(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              const u = mohammedUsernameInput.trim().toLowerCase();
              const p = mohammedPasswordInput.trim();
              if (!u || !p) {
                alert('يرجى ملء اسم المستخدم وكلمة المرور للمستخدم mohammedsauce');
                return;
              }

              const mohammedAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'mohammedsauce' || d.role === 'sauceOnly') || {
                username: 'mohammedsauce',
                password: 'm12343',
                delegateName: 'محمد الصلصات',
                monthlyTargetKg: 0,
                isAdmin: false,
                role: 'sauceOnly' as const,
              };

              const updatedMohammed = { 
                ...mohammedAcc, 
                username: u, 
                password: p,
                delegateName: 'محمد الصلصات',
                isAdmin: false,
                role: 'sauceOnly' as const,
              };
              saveDelegateAccount(updatedMohammed);
              
              if (mohammedAcc.username && mohammedAcc.username.toLowerCase() !== u) {
                deleteDelegateAccount(mohammedAcc.username);
              }

              setSaveFeedbackMessage('تم تحديث بيانات المستخدم mohammedsauce بنجاح.');
              setTimeout(() => setSaveFeedbackMessage(null), 3000);
            }}
            className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-500 active:scale-95 text-white rounded-xl text-xs font-black shadow-md cursor-pointer transition-all"
          >
            حفظ بيانات المستخدم mohammedsauce
          </button>
          <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 space-y-1 border border-slate-200 dark:border-slate-700 shadow-xs">
              <p>اسم المستخدم: <span className="text-slate-900 dark:text-white font-black font-mono">{mohammedUsernameInput}</span></p>
              <p>كلمة المرور: <span className="text-slate-900 dark:text-white font-black font-mono">{mohammedPasswordInput}</span></p>
              <p className="text-amber-600 dark:text-amber-400 font-bold">الصلاحيات: مخصص لصفحة المنتجات (الصلصات فقط) وصفحة متابعة الأصناف.</p>
          </div>
        </div>
      </div>

      {/* 10. Route Management */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <MapIcon className="w-4 h-4" />
            </div>
            <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
              10. إدارة المسارات والمهام اليومية:
            </h3>
          </div>
          <a href="/templates/routes_template.xlsx" className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-bold">تحميل نموذج مسارات</a>
        </div>

        {/* Upload Route Excel */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-4 space-y-3">
          <label className="text-xs font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            رفع ملف مسارات المندوبين (Excel)
          </label>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 font-medium">
            <p>يجب أن يحتوي الملف على الأعمدة التالية بالترتيب:</p>
            <p className="font-bold text-slate-700 dark:text-slate-300">كود الزبون | اسم الزبون | العنوان | المندوب | المسار (مثال: السبت)</p>
          </div>
          {routeUploadMessage && (
            <div className={`p-2.5 rounded-xl border text-xs font-bold text-center ${routeUploadMessage.includes('بنجاح') ? 'bg-emerald-50 dark:bg-emerald-900/50 border-emerald-300 dark:border-emerald-500 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-900/50 border-amber-300 dark:border-amber-500 text-amber-800 dark:text-amber-200'}`}>
              {routeUploadMessage}
            </div>
          )}
          <input
            type="file"
            accept=".xlsx, .xls"
            onChange={handleRouteFileUpload}
            className="w-full text-xs text-slate-600 dark:text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer"
          />
        </div>


        {/* View Routes */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-4 space-y-3.5">
          <div className="grid grid-cols-3 gap-2 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
            {(() => {
              const currentMonth = new Date().toISOString().slice(0, 7);
              const entriesInMonth = allSalesEntries.filter(e => e.dateString?.startsWith(currentMonth));
              
              const visitedCustomers = new Set();
              entriesInMonth.forEach(e => visitedCustomers.add(e.customerName));
              
              const totalCustomers = routes.length || 1;
              const visitedCount = visitedCustomers.size;
              const notVisitedCount = Math.max(0, totalCustomers - visitedCount);
              const percentage = Math.round((visitedCount / totalCustomers) * 100);

              return (
                <>
                  <div className="text-center">
                    <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">إجمالي الزبائن</div>
                    <div className="text-lg font-black text-slate-900 dark:text-white">{totalCustomers}</div>
                  </div>
                  <div className="text-center border-l border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">الزيارات (تمت/لم تتم)</div>
                    <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">{visitedCount} / {notVisitedCount}</div>
                  </div>
                  <div className="text-center border-l border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">نسبة الإنجاز</div>
                    <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">{percentage}%</div>
                  </div>
                </>
              );
            })()}
          </div>
          <label className="text-xs font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            استعراض وفلترة المسارات
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={routeFilterDelegate} onChange={e => setRouteFilterDelegate(e.target.value)} className="flex-1 p-2 rounded-xl border text-xs font-bold bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white">
              <option value="">كل المندوبين</option>
              {delegatesList.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select value={routeFilterDay} onChange={e => setRouteFilterDay(e.target.value)} className="flex-1 p-2 rounded-xl border text-xs font-bold bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white">
              <option value="">كل الأيام</option>
              <option value="السبت">السبت</option>
              <option value="الاحد">الاحد</option>
              <option value="الاثنين">الاثنين</option>
              <option value="الثلاثاء">الثلاثاء</option>
              <option value="الاربعاء">الاربعاء</option>
              <option value="الخميس">الخميس</option>
            </select>
            <div className="flex w-full sm:w-auto gap-2">
              <input 
                type="text" 
                value={searchQuery} 
                onChange={e => setSearchQuery(e.target.value)} 
                placeholder="بحث عن اسم محل..." 
                className="flex-1 sm:w-48 p-2 rounded-xl border text-xs font-bold bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white"
              />
              <button onClick={exportRoutesToExcel} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer shrink-0">تصدير المسار</button>
            </div>
          </div>
          
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs">
            <table className="w-full text-[9px] sm:text-[10px] text-right whitespace-nowrap">
              <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                <tr>
                  <th className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 cursor-pointer" onClick={() => handleSort('customerCode')}>الكود</th>
                  <th className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 cursor-pointer" onClick={() => handleSort('customerName')}>الاسم ({filteredRoutes.length})</th>
                  <th className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 cursor-pointer" onClick={() => handleSort('customerAddress')}>العنوان</th>
                  <th className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 cursor-pointer" onClick={() => handleSort('path')}>المسار</th>
                  <th className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 cursor-pointer" onClick={() => handleSort('customerType')}>نوع الزبون</th>
                  <th className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 cursor-pointer" onClick={() => handleSort('delegateName')}>اسم المندوب</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300">
                {Object.entries(paginatedRoutes.reduce((acc, r) => {
                  const day = r.path || 'غير مصنف';
                  if (!acc[day]) acc[day] = [];
                  acc[day].push(r);
                  return acc;
                }, {} as Record<string, RouteItem[]>)).map(([day, dayRoutes]) => (
                  <React.Fragment key={day}>
                    <tr>
                      <td colSpan={6} className="px-2 py-1.5 bg-emerald-50 dark:bg-slate-800/90 text-emerald-800 dark:text-emerald-400 font-black border-y border-emerald-200 dark:border-slate-700">
                        {day}
                      </td>
                    </tr>
                    {dayRoutes.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                        <td className="px-2 py-1.5 font-mono font-medium">{r.customerCode}</td>
                        <td className="px-2 py-1.5 font-bold text-slate-900 dark:text-white">{r.customerName}</td>
                        <td className="px-2 py-1.5">{r.customerAddress}</td>
                        <td className="px-2 py-1.5">{r.path}</td>
                        <td className="px-2 py-1.5">{r.customerType}</td>
                        <td className="px-2 py-1.5 font-semibold text-emerald-700 dark:text-emerald-300">{r.delegateName}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {currentPage * rowsPerPage < sortedRoutes.length && (
            <button 
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="w-full p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-emerald-700 dark:text-emerald-400 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            >
              عرض المزيد
            </button>
          )}
        </div>

        {/* View Delegate Notifications */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800 rounded-xl p-3.5 space-y-3">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <Bell className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            تنبيهات وملاحظات المندوبين
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-300">التنبيهات:</h4>
              {allAlerts.map(a => (
                <div key={a.id} className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs shadow-xs">
                  <span className="font-bold text-slate-900 dark:text-white">{a.delegateName}: </span>
                  <span className="text-slate-700 dark:text-slate-300">{a.note}</span>
                  <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1">{new Date(a.targetTime).toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-300">الملاحظات:</h4>
              {allNotes.map(n => (
                <div key={n.id} className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs shadow-xs">
                  <span className="font-bold text-slate-900 dark:text-white">{n.delegateName}: </span>
                  <span className="text-slate-700 dark:text-slate-300">{n.content}</span>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{new Date(n.createdAt).toLocaleDateString('en-GB')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Assign Daily Task */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800 rounded-xl p-3.5 space-y-3">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            تعيين المهام اليومية للمندوب
          </label>
          {dailyTaskMessage && (
            <div className={`p-2.5 rounded-xl border text-xs font-bold text-center ${dailyTaskMessage.includes('بنجاح') ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'}`}>
              {dailyTaskMessage}
            </div>
          )}
          <select
            value={dailyTaskDelegate}
            onChange={(e) => setDailyTaskDelegate(e.target.value)}
            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none"
          >
            <option value="">-- اختر المندوب --</option>
            {delegatesList.map((del) => (
              <option key={del} value={del}>{del}</option>
            ))}
          </select>
          <textarea
            value={dailyTaskText}
            onChange={(e) => setDailyTaskText(e.target.value)}
            placeholder="اكتب المهام اليومية هنا..."
            rows={3}
            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleSaveDailyTask}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
          >
            <Check className="w-4 h-4" /> حفظ المهمة اليومية
          </button>
        </div>
      </div>

      {/* 11. Global Notifications Management */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 text-slate-800 dark:text-white space-y-3 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-emerald-200">
            11. إرسال إشعارات عامة للمندوبين:
          </h3>
        </div>
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800 rounded-xl p-3.5 space-y-3">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <Bell className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            نص الإشعار الجديد
          </label>
          {globalNotifMessage && (
            <div className={`p-2.5 rounded-xl border text-xs font-bold text-center ${globalNotifMessage.includes('بنجاح') ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'}`}>
              {globalNotifMessage}
            </div>
          )}
          <textarea
            value={globalNotifText}
            onChange={(e) => setGlobalNotifText(e.target.value)}
            placeholder="اكتب الإشعار هنا وسيظهر لجميع المندوبين..."
            rows={3}
            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleSaveGlobalNotification}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
          >
            <Check className="w-4 h-4" /> حفظ وإرسال الإشعار
          </button>
        </div>
      </div>

      {/* 13. Manage Debts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 text-slate-800 dark:text-white space-y-3 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-emerald-200">
            13. إدارة الديون:
          </h3>
        </div>
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800 rounded-xl p-3.5 space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                  <th className="p-2 font-bold">الاسم</th>
                  <th className="p-2 font-bold">الكود</th>
                  <th className="p-2 font-bold">المبلغ</th>
                  <th className="p-2 font-bold">تاريخ الفاتورة</th>
                  <th className="p-2 font-bold">تاريخ التسديد</th>
                  <th className="p-2 font-bold">اسم المندوب</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950">
                {debts.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs font-medium" defaultValue={d.customerName} id={`name-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs font-mono" defaultValue={d.customerCode} id={`code-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs font-bold" defaultValue={d.amountDue} type="number" id={`amount-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs" defaultValue={d.invoiceDate} type="date" id={`invDate-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs" defaultValue={d.paymentDueDate} type="date" id={`payDate-${d.id}`} /></td>
                    <td className="p-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{d.delegateName}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <button onClick={async() => {
                            const name = (document.getElementById(`name-${d.id}`) as HTMLInputElement).value;
                            const code = (document.getElementById(`code-${d.id}`) as HTMLInputElement).value;
                            const amount = parseFloat((document.getElementById(`amount-${d.id}`) as HTMLInputElement).value);
                            const invDate = (document.getElementById(`invDate-${d.id}`) as HTMLInputElement).value;
                            const payDate = (document.getElementById(`payDate-${d.id}`) as HTMLInputElement).value;
                            await setDoc(doc(db, 'debts', d.id), { customerName: name, customerCode: code, amountDue: amount, invoiceDate: invDate, paymentDueDate: payDate, delegateName: d.delegateName });
                            alert('تم التحديث');
                        }} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95">حفظ</button>
                        <button onClick={async() => {
                            if(await showConfirm('هل أنت متأكد من الحذف؟')) await deleteDoc(doc(db, 'debts', d.id));
                        }} className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-emerald-500/80 bg-emerald-50/50 dark:bg-slate-900/50">
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg placeholder:text-slate-400" placeholder="الاسم" id="new-debt-name" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg placeholder:text-slate-400 font-mono" placeholder="الكود" id="new-debt-code" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg placeholder:text-slate-400 font-bold" placeholder="المبلغ" type="number" id="new-debt-amount" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg" type="date" id="new-debt-inv-date" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg" type="date" id="new-debt-pay-date" /></td>
                    <td className="p-2">
                        <select className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg mb-1 font-semibold" id="new-debt-delegate">
                            {delegatesList.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <button onClick={async () => {
                             const name = (document.getElementById('new-debt-name') as HTMLInputElement).value;
                             const code = (document.getElementById('new-debt-code') as HTMLInputElement).value;
                             const amount = parseFloat((document.getElementById('new-debt-amount') as HTMLInputElement).value);
                             const invDate = (document.getElementById('new-debt-inv-date') as HTMLInputElement).value;
                             const payDate = (document.getElementById('new-debt-pay-date') as HTMLInputElement).value;
                             const delegate = (document.getElementById('new-debt-delegate') as HTMLSelectElement).value;
                             
                             if (!code || !name || isNaN(amount) || !invDate || !payDate || !delegate) return alert('يرجى ملء كافة البيانات');
                             
                             await setDoc(doc(collection(db, 'debts')), { customerName: name, customerCode: code, amountDue: amount, invoiceDate: invDate, paymentDueDate: payDate, delegateName: delegate });
                             alert('تم الإضافة');
                             (document.getElementById('new-debt-name') as HTMLInputElement).value = '';
                             (document.getElementById('new-debt-code') as HTMLInputElement).value = '';
                             (document.getElementById('new-debt-amount') as HTMLInputElement).value = '';
                        }} className="text-white font-bold bg-emerald-600 hover:bg-emerald-500 p-1.5 rounded-lg w-full text-xs shadow-xs transition-all cursor-pointer">إضافة</button>
                    </td>
                    <td className="p-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      </div>
    </PullToRefresh>
  );
};
