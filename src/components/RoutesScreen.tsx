import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSales, getFixedDelegatePhone } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { logFirestoreErrorGracefully, isGlobalQuotaExceeded } from '../lib/firestoreUtils';
import { collection, query, where, updateDoc, doc, writeBatch, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { safeOnSnapshot } from '../lib/firestoreUtils';
import { RouteItem, DebtItem, SalesEntry, DamagedProductItem, DamagedProductStatus } from '../types';
import { CheckCircle2, Circle, AlertCircle, AlertTriangle, ArrowUp, Upload, CheckSquare, Square, ShoppingBag, MapPin, Phone, User, CreditCard, Save, Search, X, FileSpreadsheet, Download, Calendar, Users, XCircle, ChevronDown, ChevronUp, Clock, Pause, Play, MessageCircle } from 'lucide-react';
import { getFormattedWeekday } from '../utils/dateUtils';


// Helper for comprehensive Arabic text normalization and digit conversion
const normalizeArabic = (text: any): string => {
  if (text === null || text === undefined) return '';
  return String(text)
    .trim()
    .toLowerCase()
    // Replace Arabic-Indic digits with standard digits (e.g. ١٢٣ -> 123)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    // Remove diacritics / tashkeel
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize Alefs
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize Ta Marbuta to Ha
    .replace(/ة/g, 'ه')
    // Normalize Ya and Alef Maqsura
    .replace(/[يى]/g, 'ي')
    // Remove tatweel (kashida)
    .replace(/ـ/g, '')
    // Collapse multiple whitespace
    .replace(/\s+/g, ' ');
};

export const RoutesScreen: React.FC = () => {
  const salesContext = useSales();
  const { currentUser, delegatesList = [], delegateAccounts = [], isDarkMode, setPrefilledEntryData, setShowQuickAdd, setActiveTab, salesEntries, allSalesEntries, addToast } = salesContext;
  const productsList = salesContext.productsList || [];

  // Data Entry account check
  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.name?.includes('مدخل') ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );

  // Monthly reports visible for Data Entry and Admin, strictly hidden from delegates
  const canViewMonthlyReports = Boolean(
    (currentUser?.isAdmin || isDataEntry) && currentUser?.role !== 'delegate'
  );

  const effectiveDelegateCode = useMemo(() => {
    if (currentUser?.delegateCode) return String(currentUser.delegateCode).trim();
    const account = delegateAccounts.find(
      (a) =>
        (a.delegateName && currentUser?.name && normalizeArabic(a.delegateName) === normalizeArabic(currentUser?.name)) ||
        (a.username && currentUser?.username && a.username.toLowerCase() === currentUser?.username.toLowerCase())
    );
    return account?.delegateCode ? String(account.delegateCode).trim() : undefined;
  }, [currentUser, delegateAccounts]);

  const parseDateToMidnight = (dateStr?: string) => {
    if (!dateStr) return null;
    const parts = String(dateStr).trim().split(/[-/]/);
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return new Date(y, m, d, 0, 0, 0, 0);
      }
    }
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime())) return null;
    dt.setHours(0, 0, 0, 0);
    return dt;
  };

  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [routesLoaded, setRoutesLoaded] = useState<boolean>(false);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [debtsLoaded, setDebtsLoaded] = useState<boolean>(false);
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [manualVisits, setManualVisits] = useState<Record<string, boolean>>({});

  // Overdue Debts Auto-Dismissing Alert Modal State
  const [showOverdueAlertModal, setShowOverdueAlertModal] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(3);
  const [isCountdownPaused, setIsCountdownPaused] = useState<boolean>(false);
  const hasTriggeredAlertOnEntryRef = useRef<boolean>(false);

  useEffect(() => {
    if (!currentUser) return;

    const activeCode = currentUser.delegateCode ? String(currentUser.delegateCode).trim() : effectiveDelegateCode;
    
    let debtsQ;
    if (currentUser.isAdmin) {
      debtsQ = query(collection(db, 'debts'));
    } else if (activeCode) {
      debtsQ = query(collection(db, 'debts'), where('delegateCode', '==', activeCode));
    } else {
      debtsQ = query(collection(db, 'debts'), where('delegateCode', '==', 'NONE_MATCH'));
    }
    
    const unsubDebts = safeOnSnapshot(debtsQ, (snap: any) => {
      const loaded: DebtItem[] = [];
      snap.forEach((d: any) => loaded.push({ id: d.id, ...d.data() } as DebtItem));
      setDebts(loaded);
      setDebtsLoaded(true);
    }, (err: any) => {
      logFirestoreErrorGracefully(err, 'debts in RoutesScreen');
      setDebtsLoaded(true);
    }, 'RoutesScreen-debts');
    return () => unsubDebts();
  }, [currentUser, effectiveDelegateCode]);

  const [selectedDelegateFilter, setSelectedDelegateFilter] = useState<string | null>(null);

  // Compute overdue debts strictly belonging to the logged-in representative with Due Days > 1
  const representativeOverdueDebts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    const msPerDay = 1000 * 3600 * 24;

    const targetCode = String(currentUser?.delegateCode || effectiveDelegateCode || '').trim().toLowerCase();
    const targetName = normalizeArabic(currentUser?.name || currentUser?.delegateName || '');
    const targetUsername = String(currentUser?.username || '').trim().toLowerCase();

    return debts
      .filter((item) => {
        // If not admin, enforce strict role isolation to representative's assigned customers
        if (!currentUser?.isAdmin) {
          const itemCode = String(item.delegateCode || '').trim().toLowerCase();
          const itemName = normalizeArabic(item.delegateName || '');
          const matches =
            (targetCode && itemCode === targetCode) ||
            (targetUsername && itemCode === targetUsername) ||
            (targetName && itemName === targetName);
          if (!matches) return false;
        } else if (selectedDelegateFilter) {
          const filterNorm = normalizeArabic(selectedDelegateFilter);
          const targetAcc = delegateAccounts.find(
            (a) =>
              (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
              (a.delegateName && normalizeArabic(a.delegateName) === filterNorm) ||
              (a.username && a.username.toLowerCase() === selectedDelegateFilter.toLowerCase())
          );
          const matchCode = targetAcc?.delegateCode ? normalizeArabic(targetAcc.delegateCode) : filterNorm;
          const dCode = normalizeArabic(item.delegateCode);
          const dName = normalizeArabic(item.delegateName);
          if (dCode !== matchCode && dName !== filterNorm) return false;
        }
        return true;
      })
      .map((item) => {
        const payDateObj = parseDateToMidnight(item.paymentDueDate);
        let dueDays = 0;
        if (payDateObj) {
          const payDateTime = payDateObj.getTime();
          if (todayTime > payDateTime) {
            dueDays = Math.round((todayTime - payDateTime) / msPerDay);
          }
        }
        return {
          ...item,
          dueDays,
        };
      })
      .filter((item) => item.dueDays > 1)
      .sort((a, b) => b.dueDays - a.dueDays);
  }, [debts, currentUser, effectiveDelegateCode, selectedDelegateFilter, delegateAccounts]);

  // Trigger overdue debts modal alert upon entering Routes page for Representatives
  useEffect(() => {
    if (!debtsLoaded || hasTriggeredAlertOnEntryRef.current) return;

    const isRep = Boolean(
      !currentUser?.isAdmin &&
      !isDataEntry
    );

    if (isRep && representativeOverdueDebts.length > 0) {
      hasTriggeredAlertOnEntryRef.current = true;
      setShowOverdueAlertModal(true);
      setCountdownSeconds(3);
      setIsCountdownPaused(false);
    }
  }, [debtsLoaded, representativeOverdueDebts, currentUser, isDataEntry]);

  // Auto-dismiss countdown timer (3 seconds) & manual close / pause handling
  useEffect(() => {
    if (!showOverdueAlertModal) {
      setIsCountdownPaused(false);
      return;
    }

    if (isCountdownPaused) {
      return;
    }

    const intervalId = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          setShowOverdueAlertModal(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [showOverdueAlertModal, isCountdownPaused]);
  
  const [selectedDebt, setSelectedDebt] = useState<DebtItem | null>(null);
  const [paymentModalDebt, setPaymentModalDebt] = useState<DebtItem | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [debtSearch, setDebtSearch] = useState('');

  // WhatsApp Alert to Delegate Modal state
  const [whatsappModalDebt, setWhatsappModalDebt] = useState<DebtItem | null>(null);
  const [delegatePhoneInput, setDelegatePhoneInput] = useState<string>('');

  const handleOpenWhatsAppModal = (debt: DebtItem) => {
    setWhatsappModalDebt(debt);
    const matchedAccount = delegateAccounts.find(
      (acc) =>
        (debt.delegateCode && acc.delegateCode && String(acc.delegateCode).trim() === String(debt.delegateCode).trim()) ||
        (debt.delegateName && acc.delegateName && normalizeArabic(acc.delegateName) === normalizeArabic(debt.delegateName))
    );
    const delKey = debt.delegateCode || debt.delegateName || '';
    const fixedPhone = getFixedDelegatePhone(debt.delegateName, debt.delegateCode, matchedAccount?.username);
    const existingPhone = fixedPhone || (matchedAccount as any)?.phone || localStorage.getItem(`del_phone_${delKey}`) || '';
    setDelegatePhoneInput(existingPhone);
  };

  const formatWhatsAppPhone = (phone: string): string => {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('00964')) {
      cleaned = '964' + cleaned.substring(5);
    } else if (cleaned.startsWith('07')) {
      cleaned = '964' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') && cleaned.length === 10) {
      cleaned = '964' + cleaned;
    }
    return cleaned;
  };

  const handleSendWhatsAppAlert = () => {
    if (!whatsappModalDebt) return;
    const debt = whatsappModalDebt;
    const matchedAccount = delegateAccounts.find(
      (acc) =>
        (debt.delegateCode && acc.delegateCode && String(acc.delegateCode).trim() === String(debt.delegateCode).trim()) ||
        (debt.delegateName && acc.delegateName && normalizeArabic(acc.delegateName) === normalizeArabic(debt.delegateName))
    );
    const delName = matchedAccount?.delegateName || debt.delegateName || debt.delegateCode || 'المندوب';
    const delKey = debt.delegateCode || debt.delegateName || '';
    const fixedPhone = getFixedDelegatePhone(debt.delegateName, debt.delegateCode, matchedAccount?.username);

    // Guaranteed fixed phone cannot be altered
    const cleanRawPhone = (fixedPhone || delegatePhoneInput).trim();
    if (cleanRawPhone) {
      try {
        localStorage.setItem(`del_phone_${delKey}`, cleanRawPhone);
        if (matchedAccount?.username) {
          setDoc(doc(db, 'delegate_accounts', matchedAccount.username.toLowerCase()), { phone: cleanRawPhone }, { merge: true }).catch(() => {});
        }
      } catch {}
    }

    const payDateObj = parseDateToMidnight(debt.paymentDueDate);
    let dueStatusText = 'غير محدد';
    if (payDateObj) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.round((today.getTime() - payDateObj.getTime()) / (1000 * 3600 * 24));
      if (today.getTime() >= payDateObj.getTime()) {
        dueStatusText = `مستحقة (تأخير ${diffDays} يوم)`;
      } else {
        dueStatusText = `غير مستحقة (NT) • متبقي ${Math.abs(diffDays)} يوم على موعد السداد`;
      }
    }

    const message = `⚠️ *تنبيه دين مستحق للمندوب* ⚠️

👤 *المندوب:* ${delName}
🏬 *اسم الزبون:* ${debt.customerName}
🔢 *كود الزبون:* ${debt.customerCode}
${debt.customerAddress ? `📍 *عنوان الزبون:* ${debt.customerAddress}\n` : ''}💰 *المبلغ المستحق:* ${debt.amountDue.toLocaleString()} د.ع
📅 *تاريخ الفاتورة:* ${debt.invoiceDate}
⏰ *تاريخ السداد:* ${debt.paymentDueDate}
📌 *حالة الاستحقاق:* ${dueStatusText}

يرجى متابعة واستحصال المبلغ المستحق من الزبون وإبلاغ الإدارة فور الاستلام.`;

    const formattedPhone = formatWhatsAppPhone(cleanRawPhone);
    const whatsappUrl = formattedPhone 
      ? `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
    setWhatsappModalDebt(null);
    if (addToast) {
      addToast({
        title: 'تم تجهيز الرسالة',
        message: `تم فتح واتساب لإرسال تنبيه الدين للمندوب (${delName})`,
        type: 'success'
      });
    }
  };





  // Configurable auto-lock closing time (default 15:00 / 3:00 PM) & real-time clock tick
  const [targetAutoLockTime, setTargetAutoLockTime] = useState<string>('15:00');
  const [timeTick, setTimeTick] = useState<number>(Date.now());

  useEffect(() => {
    const unsub = safeOnSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (docSnap: any) => {
        if (docSnap.exists() && docSnap.data()?.time) {
          setTargetAutoLockTime(docSnap.data().time);
        }
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'auto_lock_time in RoutesScreen');
      },
      'RoutesScreen-auto-lock'
    );
    return () => unsub();
  }, []);

  // Live timer tick every 10 seconds to detect closing time trigger in real-time
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeTick(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Format targetAutoLockTime for Arabic display (e.g. 15:00 -> 03:00 م)
  const formattedTargetTime = useMemo(() => {
    try {
      const [hStr, mStr] = targetAutoLockTime.split(':');
      let h = parseInt(hStr || '15', 10);
      const m = mStr || '00';
      const ampm = h >= 12 ? 'م' : 'ص';
      h = h % 12;
      h = h ? h : 12;
      return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
    } catch {
      return '03:00 م';
    }
  }, [targetAutoLockTime]);

  // Current Baghdad date info & whether official closing time has been reached
  const baghdadStatus = useMemo(() => {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Baghdad',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const todayBaghdad = formatter.format(now); // "YYYY-MM-DD"

      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baghdad',
        hour12: false,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
      const parts = timeFormatter.formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);

      const currentSeconds = hour * 3600 + minute * 60 + second;

      const [hStr, mStr] = targetAutoLockTime.split(':');
      const targetHours = parseInt(hStr || '15', 10);
      const targetMinutes = parseInt(mStr || '00', 10);
      const targetSeconds = targetHours * 3600 + targetMinutes * 60;

      const isPastClosing = currentSeconds >= targetSeconds;

      return { todayBaghdad, isPastClosing };
    } catch {
      const todayBaghdad = new Date().toISOString().split('T')[0];
      return { todayBaghdad, isPastClosing: false };
    }
  }, [targetAutoLockTime, timeTick]);

  // Check if a representative has marked today's sales as completed
  const isDelegateCompletedToday = (delName?: string, delCode?: string) => {
    if (!delName && !delCode) return false;
    const nName = delName ? normalizeArabic(delName) : '';
    const nCode = delCode ? normalizeArabic(delCode) : '';

    for (const [key, val] of Object.entries(completedDelegates)) {
      if (!val) continue;
      const nKey = normalizeArabic(key);
      if (nName && (nKey === nName || nKey.includes(nName) || nName.includes(nKey))) return true;
      if (nCode && nKey === nCode) return true;
    }
    return false;
  };

  const handleSavePayment = async () => {
    if (!paymentModalDebt || !currentUser?.isAdmin) return;
    const paidAmount = parseFloat(paymentAmountInput);
    if (isNaN(paidAmount) || paidAmount <= 0) {
      alert('يرجى إدخال مبلغ تسديد صحيح أكبر من الصفر');
      return;
    }

    setIsProcessingPayment(true);
    try {
      if (paidAmount >= paymentModalDebt.amountDue) {
        // Full settlement
        await deleteDoc(doc(db, 'debts', paymentModalDebt.id));
        addToast({
          message: `تم تسديد كامل دين الزبون (${paymentModalDebt.customerName}) بمبلغ ${paidAmount.toLocaleString()} د.ع بنجاح`,
          type: 'success',
          delegateName: currentUser?.name || '',
          title: 'تسديد الدين',
          percentage: 0
        });
      } else {
        // Partial settlement
        const remainingAmount = paymentModalDebt.amountDue - paidAmount;
        await setDoc(doc(db, 'debts', paymentModalDebt.id), {
          amountDue: remainingAmount
        }, { merge: true });
        addToast({
          message: `تم تسديد ${paidAmount.toLocaleString()} د.ع من دين الزبون (${paymentModalDebt.customerName})، المتبقي: ${remainingAmount.toLocaleString()} د.ع`,
          type: 'success',
          delegateName: currentUser?.name || '',
          title: 'تسديد جزئي',
          percentage: 0
        });
      }
      setPaymentModalDebt(null);
      setPaymentAmountInput('');
    } catch (error) {
      console.error('Error settling debt:', error);
      alert('حدث خطأ أثناء حفظ التسديد. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const totalDebts = useMemo(() => debts.reduce((sum, d) => sum + (Number(d.amountDue) || 0), 0), [debts]);
  const totalCustomers = useMemo(() => new Set(debts.map(d => d.customerCode)).size, [debts]);

  const getDelegateTotalDebt = useMemo(() => {
    return (delegate: { delegateCode?: string; username?: string; delegateName?: string }) => {
      const targetCode = (delegate.delegateCode || '').trim().toLowerCase();
      const targetUser = (delegate.username || '').trim().toLowerCase();
      const targetName = (delegate.delegateName || '').trim().toLowerCase();

      return debts.reduce((sum, item) => {
        const itemCode = (item.delegateCode || '').trim().toLowerCase();
        const itemName = (item.delegateName || '').trim().toLowerCase();

        const matchCode = targetCode !== '' && (itemCode === targetCode || itemName === targetCode);
        const matchUser = targetUser !== '' && (itemCode === targetUser || itemName === targetUser);
        const matchName = targetName !== '' && (itemName === targetName || itemCode === targetName);

        if (matchCode || matchUser || matchName) {
          return sum + (Number(item.amountDue) || 0);
        }
        return sum;
      }, 0);
    };
  }, [debts]);

  const filteredDebts = useMemo(() => {
      let result = debts;
      if (selectedDelegateFilter) {
          const filterNorm = normalizeArabic(selectedDelegateFilter);
          const targetAcc = delegateAccounts.find(
            a => (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
                 (a.username && normalizeArabic(a.username) === filterNorm) ||
                 (a.delegateName && normalizeArabic(a.delegateName) === filterNorm)
          );
          const matchCode = targetAcc?.delegateCode ? normalizeArabic(targetAcc.delegateCode) : filterNorm;
          const matchUser = targetAcc?.username ? normalizeArabic(targetAcc.username) : filterNorm;
          const matchName = targetAcc?.delegateName ? normalizeArabic(targetAcc.delegateName) : filterNorm;

          result = result.filter(d => {
            const dCode = normalizeArabic(d.delegateCode);
            const dName = normalizeArabic(d.delegateName);
            return dCode === matchCode || dCode === matchUser || dCode === filterNorm ||
                   dName === matchName || dName === matchUser || dName === filterNorm;
          });
      }

      const q = normalizeArabic(debtSearch);
      if (q) {
        result = result.filter(d => {
            const delegateName = delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || d.delegateCode || '';
            const searchable = [
              normalizeArabic(d.customerName),
              normalizeArabic(d.customerCode),
              normalizeArabic(delegateName),
              normalizeArabic(d.invoiceDate),
              normalizeArabic(d.paymentDueDate)
            ].join(' ');
            return searchable.includes(q);
        });
      }

      return [...result].sort((a, b) => {
        const payA = parseDateToMidnight(a.paymentDueDate)?.getTime() || 0;
        const payB = parseDateToMidnight(b.paymentDueDate)?.getTime() || 0;
        return payA - payB;
      });
  }, [debts, debtSearch, selectedDelegateFilter, delegateAccounts]);

  const exportDebtsToExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const msPerDay = 1000 * 3600 * 24;

      const worksheet = XLSX.utils.json_to_sheet(debts.map(d => {
          const payDateObj = parseDateToMidnight(d.paymentDueDate);
          let mustahaqaVal: string | number = 'NT';
          let baqiaVal = 0;
          if (payDateObj) {
            if (today.getTime() >= payDateObj.getTime()) {
              mustahaqaVal = Math.round((today.getTime() - payDateObj.getTime()) / msPerDay);
              baqiaVal = 0;
            } else {
              mustahaqaVal = 'NT';
              baqiaVal = Math.round((payDateObj.getTime() - today.getTime()) / msPerDay);
            }
          }
          return {
              'اسم الزبون': d.customerName,
              'كود الزبون': d.customerCode,
              'المبلغ': d.amountDue,
              'كود المندوب': d.delegateCode,
              'اسم المندوب': delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || '',
              'تاريخ الفاتورة': d.invoiceDate,
              'تاريخ السداد': d.paymentDueDate,
              'مستحقة': mustahaqaVal,
              'باقي': baqiaVal
          };
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'الديون');
      XLSX.writeFile(workbook, 'الديون.xlsx');
    } catch (err) {
      console.error('Error exporting debts to Excel:', err);
      alert('حدث خطأ أثناء تصدير ملف الإكسل');
    }
  };

  const renderDebtsTable = () => {
    return (
      <div className="space-y-4">
        {currentUser?.isAdmin && (
          <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="text-center">
                  <div className="text-[10px] font-bold text-slate-500 mb-1">إجمالي الديون المستحقة</div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">{totalDebts.toLocaleString()}</div>
              </div>
              <div className="text-center">
                  <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">عدد الزبائن</div>
                  <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">{totalCustomers}</div>
              </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-emerald-800 dark:text-emerald-200 font-black text-lg text-center">الديون المستحقة</h3>
                {representativeOverdueDebts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverdueAlertModal(true);
                      setCountdownSeconds(3);
                      setIsCountdownPaused(false);
                    }}
                    data-testid="open-overdue-debts-modal-btn"
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 rounded-lg text-xs font-black transition-all cursor-pointer shadow-xs active:scale-95"
                    title="تنبيه الديون المتأخرة المستحقة (> 1 يوم)"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 animate-pulse" />
                    <span>تنبيه الديون المتأخرة</span>
                    <span className="bg-rose-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-black">
                      {representativeOverdueDebts.length}
                    </span>
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {currentUser?.isAdmin && (
                    <button onClick={exportDebtsToExcel} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700">تصدير Excel</button>
                )}
                {currentUser?.isAdmin && (
                    <label className="flex items-center gap-2 px-3 py-1 bg-emerald-600 text-white rounded-lg cursor-pointer text-xs font-bold hover:bg-emerald-700">
                    <Upload className="w-4 h-4" />
                    استيراد
                    <input type="file" className="hidden" onChange={handleImportDebts} accept=".xlsx, .xls" />
                    </label>
                )}
              </div>
            </div>

            {currentUser?.isAdmin && (
                <div className="flex flex-wrap gap-2 pt-1 pb-1">
                    {/* All Button */}
                    <button 
                      key="filter-all-delegates" 
                      onClick={() => setSelectedDelegateFilter(null)} 
                      className={`px-3 py-1.5 rounded-xl text-center transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center min-w-[70px] ${
                        !selectedDelegateFilter 
                          ? 'bg-emerald-600 text-white shadow-emerald-600/30' 
                          : isDarkMode 
                            ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700' 
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      <span className="text-xs font-black leading-tight">الكل</span>
                      <span className={`text-[10px] font-bold mt-0.5 leading-tight ${!selectedDelegateFilter ? 'text-emerald-100' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {totalDebts.toLocaleString()} <span className="text-[8px]">د.ع</span>
                      </span>
                    </button>

                    {/* Delegate Buttons */}
                    {delegateAccounts.map((d, idx) => {
                      const filterKey = d.delegateCode || d.username;
                      const isSelected = selectedDelegateFilter === filterKey || (selectedDelegateFilter && (d.delegateName === selectedDelegateFilter || d.username === selectedDelegateFilter));
                      const delegateTotal = getDelegateTotalDebt(d);

                      return (
                        <button 
                          key={d.username || d.delegateCode || `debts-filter-${idx}`} 
                          onClick={() => setSelectedDelegateFilter(filterKey || null)} 
                          className={`px-3 py-1.5 rounded-xl text-center transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center min-w-[80px] ${
                            isSelected 
                              ? 'bg-emerald-600 text-white shadow-emerald-600/30 ring-2 ring-emerald-500/50' 
                              : isDarkMode 
                                ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700' 
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                          }`}
                        >
                          <span className="text-xs font-black leading-tight truncate max-w-[130px]">
                            {d.delegateName || d.username}
                          </span>
                          <span className={`text-[10px] font-bold mt-0.5 leading-tight ${
                            isSelected 
                              ? 'text-emerald-100' 
                              : delegateTotal > 0 
                                ? 'text-amber-600 dark:text-amber-400 font-black' 
                                : 'text-slate-400 dark:text-slate-500'
                          }`}>
                            {delegateTotal.toLocaleString()} <span className="text-[8px]">د.ع</span>
                          </span>
                        </button>
                      );
                    })}
                </div>
            )}
        </div>

        <input 
          type="text" 
          value={debtSearch} 
          onChange={e => setDebtSearch(e.target.value)} 
          placeholder="بحث (اسم، كود، مندوب، أو تاريخ)..." 
          className={`w-full p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}
        />

        <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700 shadow-xs">
          <table className="w-full min-w-[700px] text-[10px] sm:text-[11px] text-right whitespace-nowrap">
            <thead className={`font-black ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/90 text-slate-900 border-b border-slate-300'}`}>
              <tr>
                {currentUser?.isAdmin && <th className="px-2.5 py-2.5">المندوب</th>}
                <th className="px-2.5 py-2.5">الاسم</th>
                <th className="px-2.5 py-2.5">الكود</th>
                <th className="px-2.5 py-2.5">المبلغ</th>
                <th className="px-2.5 py-2.5">ت. الفاتورة</th>
                <th className="px-2.5 py-2.5">ت. السداد</th>
                <th className="px-2.5 py-2.5 text-center">مستحقة</th>
                <th className="px-2.5 py-2.5 text-center">باقي</th>
                {currentUser?.isAdmin && <th className="px-2.5 py-2.5 text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-slate-200 bg-white text-slate-900'}`}>
              {!debtsLoaded ? (
                // Skeleton Loader
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse">
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    {currentUser?.isAdmin && <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>}
                  </tr>
                ))
              ) : filteredDebts.map(d => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayTime = today.getTime();
                const msPerDay = 1000 * 3600 * 24;
                
                const payDateObj = parseDateToMidnight(d.paymentDueDate);
                const invDateObj = parseDateToMidnight(d.invoiceDate);
                
                let mustahaqaDisplay: string | number = 'NT';
                let isDue = false;
                let baqia = 0;
                
                if (payDateObj) {
                  const payDateTime = payDateObj.getTime();
                  if (todayTime >= payDateTime) {
                    // تاريخ السداد واصل / مستحق -> تجمع عدد الأيام بين تاريخ السداد وتاريخ اليوم
                    isDue = true;
                    mustahaqaDisplay = Math.round((todayTime - payDateTime) / msPerDay);
                    baqia = 0;
                  } else {
                    // تاريخ السداد غير واصل (غير مستحق) -> NT
                    mustahaqaDisplay = 'NT';
                    baqia = Math.round((payDateTime - todayTime) / msPerDay);
                  }
                } else {
                  mustahaqaDisplay = 'NT';
                  baqia = 0;
                }
                
                const daysOld = invDateObj ? Math.round((todayTime - invDateObj.getTime()) / msPerDay) : 0;
                const isOldDebt = daysOld > 11;

                const isRed = isDue || (mustahaqaDisplay === 'NT' && baqia <= 1);
                const isGreen = !isDue && baqia > 5;
                const rowBgClass = isRed 
                  ? (isDarkMode ? 'bg-rose-950/40 text-rose-100 hover:bg-rose-900/50' : 'bg-rose-50 text-rose-950 hover:bg-rose-100/90') 
                  : isGreen 
                  ? (isDarkMode ? 'bg-emerald-950/30 text-emerald-100 hover:bg-emerald-900/40' : 'bg-emerald-50/70 text-slate-900 hover:bg-emerald-100/80') 
                  : (isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100/70');
                
                const handlePay = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setPaymentModalDebt(d);
                    setPaymentAmountInput(d.amountDue.toString());
                };

                return (
                  <tr key={d.id} className={`${rowBgClass} transition-colors cursor-pointer font-bold`} onClick={() => setSelectedDebt(d)}>
                    {currentUser?.isAdmin && (
                        <td className="px-2.5 py-2 font-extrabold text-slate-800 dark:text-slate-200">
                            <span>{delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || d.delegateCode}</span>
                        </td>
                    )}
                    <td className="px-2.5 py-2 font-black text-slate-900 dark:text-white">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{d.customerName}</span>
                        {typeof mustahaqaDisplay === 'number' && mustahaqaDisplay > 1 && (
                          <span className="text-[9px] font-black bg-rose-500 text-white px-1.5 py-0.5 rounded-full shadow-xs shrink-0">
                            مستحق
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-2 font-mono text-[10px] text-slate-700 dark:text-slate-300">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {d.customerCode}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 font-black text-emerald-700 dark:text-emerald-300 font-mono text-xs">
                      {d.amountDue.toLocaleString()} <span className="text-[9px] font-sans">د.ع</span>
                    </td>
                    <td className="px-2.5 py-2 font-mono text-slate-700 dark:text-slate-300 text-[10px]">{d.invoiceDate}</td>
                    <td className="px-2.5 py-2 font-mono text-slate-700 dark:text-slate-300 text-[10px]">{d.paymentDueDate}</td>
                    <td className="px-2.5 py-2 text-center font-mono">
                      {mustahaqaDisplay === 'NT' ? (
                        <span className="px-1.5 py-0.5 rounded font-black text-[10px] bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                          NT
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded font-black text-[10px] bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                          {mustahaqaDisplay}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-center">
                      {baqia > 0 ? (
                        <span className="px-1.5 py-0.5 rounded font-black text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono">
                          {baqia}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-[10px]">0</span>
                      )}
                    </td>
                    {currentUser?.isAdmin && (
                      <td className="px-2.5 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenWhatsAppModal(d);
                            }} 
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-lg text-[10px] font-black shadow-xs transition-all cursor-pointer flex items-center gap-1"
                            title="إرسال رسالة تنبيه بالدين إلى واتساب المندوب"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>واتساب</span>
                          </button>
                          <button 
                            type="button"
                            onClick={handlePay} 
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-lg text-[10px] font-black shadow-xs transition-all cursor-pointer"
                            title="تسديد دين الزبون"
                          >
                            تسديد
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const handleImportDebts = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 });

      const batch = writeBatch(db);
      const debtsSnap = await getDocs(collection(db, 'debts'));
      debtsSnap.forEach(d => batch.delete(d.ref));

      // New format: Name, Code, Amount, DelegateCode, InvoiceDate, PaymentDate
      jsonData.slice(1).forEach((row: any) => {
        if (!row[0]) return;
        
        // Helper to convert Excel serial date to YYYY-MM-DD string
        const excelDateToJSDate = (serial: any) => {
            if (typeof serial === 'number') {
                const utc_days = Math.floor(serial - 25569);
                const utc_value = utc_days * 86400;
                const date_info = new Date(utc_value * 1000);
                return date_info.toISOString().split('T')[0];
            }
            return serial; // Assume it's already a string
        };

        const newDebt = {
          customerName: row[0] || '',
          customerCode: row[1] || '',
          amountDue: parseFloat(row[2] || 0),
          delegateCode: String(row[3] || '').trim(),
          invoiceDate: excelDateToJSDate(row[4]),
          paymentDueDate: excelDateToJSDate(row[5]),
          delegateName: '', // Name might be unknown at this point
        };
        
        const debtRef = doc(collection(db, 'debts'));
        batch.set(debtRef, newDebt);
      });
      
      await batch.commit();
      addToast({ message: 'تم استيراد الديون بنجاح ✅', type: 'success', delegateName: currentUser?.name || '', title: 'استيراد', percentage: 0 });
    } catch (e) {
      console.error('Error importing debts:', e);
      addToast({ message: 'فشل استيراد الديون.', type: 'info', delegateName: currentUser?.name || '', title: 'خطأ', percentage: 0 });
    }
  };

  /*
  useEffect(() => {
    if (!currentUser || currentUser.isAdmin) return;
    
    const today = new Date().toISOString().split('T')[0];
    const currentDayName = getFormattedWeekday();

    const delegateRoutes = routes.filter(r =>
        r.delegateName.trim() === currentUser.name.trim() &&
        r.path?.includes(currentDayName)
    );

    const unvisitedCount = delegateRoutes.filter(r => {
        const customerEntries = salesEntries.filter(e => e.customerCode === r.customerCode);
        return !customerEntries.some(e => e.dateString === today);
    }).length;

    if (unvisitedCount > 0) {
        addToast({ message: `تذكير: لديك ${unvisitedCount} زبون لم تتم زيارتهم بعد اليوم.`, type: 'info' });
    }
  }, [routes, salesEntries, currentUser]);
  */

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const baghdadToday = baghdadStatus.todayBaghdad;
    const queryDates = Array.from(new Set([today, baghdadToday]));
    const q = query(collection(db, 'daily_sales_completion'), where('date', 'in', queryDates));
    const unsub = safeOnSnapshot(
      q, 
      (snap: any) => {
        const completed: Record<string, boolean> = {};
        snap.forEach((d: any) => {
          completed[d.id] = true;
          const data = d.data();
          if (data.delegate) completed[data.delegate] = true;
          if (data.delegateName) completed[data.delegateName] = true;
          if (data.delegateCode) completed[data.delegateCode] = true;
        });
        setCompletedDelegates(completed);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'daily_sales_completion in RoutesScreen');
      },
      'RoutesScreen-completion'
    );
    
    // Load manual visits
    const delegateCode = String(effectiveDelegateCode || '').trim();
    if (delegateCode) {
        const visitsQ = query(collection(db, 'daily_visits'), where('date', '==', today), where('delegateCode', '==', delegateCode));
        const unsubVisits = safeOnSnapshot(
          visitsQ, 
          (snap: any) => {
            const v: Record<string, boolean> = {};
            snap.forEach((d: any) => {
              v[d.data().customerCode] = true;
            });
            setManualVisits(v);
          },
          (err: any) => {
            logFirestoreErrorGracefully(err, 'daily_visits in RoutesScreen');
          },
          'RoutesScreen-manual-visits'
        );
        return () => { unsub(); unsubVisits(); };
    }
    
    return () => unsub();
  }, [currentUser, effectiveDelegateCode, baghdadStatus.todayBaghdad]);

  const [routeFilterDelegate, setRouteFilterDelegate] = useState((currentUser?.isAdmin || isDataEntry) ? '' : currentUser?.delegateCode || '');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(20);

  // Available delegates for the filter dropdown
  const allAvailableDelegates = useMemo(() => {
    const list: { key: string; value: string; label: string }[] = [];
    const seen = new Set<string>();

    // 1. From delegateAccounts
    delegateAccounts.forEach((acc, idx) => {
      const name = (acc.delegateName || acc.username || '').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        list.push({
          key: acc.username || acc.delegateCode || `del-acc-${idx}`,
          value: name,
          label: acc.delegateName ? `${acc.delegateName} (${acc.delegateCode || acc.username})` : acc.username
        });
      }
    });

    // 2. From delegatesList
    delegatesList.forEach((name, idx) => {
      const cleanName = (name || '').trim();
      if (cleanName && !seen.has(cleanName.toLowerCase())) {
        seen.add(cleanName.toLowerCase());
        list.push({
          key: `del-list-${idx}`,
          value: cleanName,
          label: cleanName
        });
      }
    });

    // 3. From routes themselves
    routes.forEach((r, idx) => {
      const cleanName = (r.delegateName || '').trim();
      if (cleanName && !seen.has(cleanName.toLowerCase())) {
        seen.add(cleanName.toLowerCase());
        list.push({
          key: `route-del-${idx}`,
          value: cleanName,
          label: cleanName
        });
      }
    });

    return list.sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [delegateAccounts, delegatesList, routes]);

  useEffect(() => {
    if (!currentUser) return;
    
    // Always load all routes; permissions are granted in rules and delegate filtering is handled securely in memory
    const routesQ = query(collection(db, 'routes'));

    const unsubRoutes = safeOnSnapshot(routesQ, (snap: any) => {
      const loaded: RouteItem[] = [];
      snap.forEach((d: any) => {
        const data = d.data();
        loaded.push({
          id: d.id,
          ...data,
          customerName: String(data.customerName ?? '').trim(),
          customerCode: String(data.customerCode ?? '').trim(),
          customerAddress: String(data.customerAddress ?? '').trim(),
          customerPhone: data.customerPhone ? String(data.customerPhone).trim() : '',
          delegateName: String(data.delegateName ?? '').trim(),
          delegateCode: String(data.delegateCode ?? '').trim(),
          path: String(data.path ?? '').trim(),
          customerType: data.customerType || 'مفرد',
          position: typeof data.position === 'number' ? data.position : 0,
        } as RouteItem);
      });
      setRoutes(loaded);
      setRoutesLoaded(true);
    }, (err: any) => {
      logFirestoreErrorGracefully(err, 'routes in RoutesScreen');
      setRoutesLoaded(true);
    }, 'RoutesScreen-routes');
    return () => unsubRoutes();
  }, [currentUser]);

  // Real-time Baghdad time & active route day calculation
  // At 6:00 PM (18:00) Baghdad time daily, the active route switches to tomorrow's route
  const [nowDate, setNowDate] = useState(() => new Date());

  useEffect(() => {
    // Tick every 30 seconds to catch the 6:00 PM (18:00) shift accurately
    const timer = setInterval(() => {
      setNowDate(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const routeDayInfo = useMemo(() => {
    try {
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baghdad',
        hour12: false,
        hour: 'numeric',
        minute: 'numeric',
      });
      const parts = timeFormatter.formatToParts(nowDate);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

      // Check if current Baghdad time is 6:00 PM (18:00) or later
      const isPast6PM = hour > 18 || (hour === 18 && minute >= 0);

      // Today in Baghdad
      const todayDayName = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(nowDate);

      // Tomorrow in Baghdad
      const tomorrowDate = new Date(nowDate.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowDayName = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(tomorrowDate);

      const activeDay = isPast6PM ? tomorrowDayName : todayDayName;

      return {
        isPast6PM,
        todayDayName,
        tomorrowDayName,
        activeDay
      };
    } catch {
      const fallbackDay = new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(nowDate);
      return {
        isPast6PM: false,
        todayDayName: fallbackDay,
        tomorrowDayName: fallbackDay,
        activeDay: fallbackDay
      };
    }
  }, [nowDate]);

  const currentDay = routeDayInfo.activeDay;
  const isCompleted = completedDelegates[currentUser?.name || ''] || false;

  // Set of customer codes that have debts for O(1) instant lookup
  const customerDebtsSet = useMemo(() => {
    const set = new Set<string>();
    debts.forEach(d => {
      const code = String(d.customerCode ?? '').trim();
      if (code) set.add(code);
    });
    return set;
  }, [debts]);

  // Pre-indexed summary of customer sales (visited today, weight today, recent order) for O(1) instant lookup
  const customerSalesSummaryMap = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    const summary = new Map<string, { visitedToday: boolean; totalWeightToday: number; hasOrderIn12Hours: boolean }>();

    allSalesEntries.forEach(e => {
      const cCode = String(e.customerCode ?? '').trim();
      if (!cCode) return;

      let item = summary.get(cCode);
      if (!item) {
        item = { visitedToday: false, totalWeightToday: 0, hasOrderIn12Hours: false };
        summary.set(cCode, item);
      }

      if (e.dateString === todayStr) {
        item.visitedToday = true;
        item.totalWeightToday += (e.totalWeightKg || 0);
      }
      if (e.timestamp && e.timestamp >= twelveHoursAgo) {
        item.hasOrderIn12Hours = true;
      }
    });

    return summary;
  }, [allSalesEntries]);

  const isVisited = React.useCallback((r: RouteItem) => {
    const cCode = String(r.customerCode ?? '').trim();
    const summary = customerSalesSummaryMap.get(cCode);
    return Boolean(summary?.visitedToday || manualVisits[cCode]);
  }, [customerSalesSummaryMap, manualVisits]);

  // Precompute distinct invoice counts per customer code/name
  const customerInvoicesCountMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    allSalesEntries.forEach(e => {
      const cCode = (e.customerCode || '').trim().toLowerCase();
      const cName = (e.customerName || '').trim().toLowerCase();
      const invKey = e.invoiceId || `${e.dateString}_${e.delegateName || ''}_${cCode || cName}`;
      if (cCode) {
        if (!map.has(cCode)) map.set(cCode, new Set());
        map.get(cCode)!.add(invKey);
      }
      if (cName) {
        if (!map.has(cName)) map.set(cName, new Set());
        map.get(cName)!.add(invKey);
      }
    });
    return map;
  }, [allSalesEntries]);

  const getRouteItemInvoicesCount = React.useCallback((r: RouteItem) => {
    const cCode = (r.customerCode || '').trim().toLowerCase();
    const cName = (r.customerName || '').trim().toLowerCase();
    const byCode = cCode ? customerInvoicesCountMap.get(cCode)?.size : 0;
    const byName = cName ? customerInvoicesCountMap.get(cName)?.size : 0;
    return byCode || byName || 0;
  }, [customerInvoicesCountMap]);

  const filteredRoutes = useMemo(() => {
    const rawQuery = searchQuery.trim();
    const normalizedQuery = normalizeArabic(rawQuery);
    const searchTerms = normalizedQuery.split(' ').filter(Boolean);
    const isSearching = searchTerms.length > 0;

    return routes.filter(r => {
      // 1. Delegate matching
      let delegateMatch = true;
      if (currentUser?.isAdmin || isDataEntry) {
        if (routeFilterDelegate) {
          const filterNorm = normalizeArabic(routeFilterDelegate);
          const rDelName = normalizeArabic(r.delegateName);
          const rDelCode = normalizeArabic(r.delegateCode);

          const matchedAccount = delegateAccounts.find(
            a => (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
                 (a.username && normalizeArabic(a.username) === filterNorm) ||
                 (a.delegateName && normalizeArabic(a.delegateName) === filterNorm)
          );

          const matchCode = matchedAccount?.delegateCode ? normalizeArabic(matchedAccount.delegateCode) : '';
          const matchName = matchedAccount?.delegateName ? normalizeArabic(matchedAccount.delegateName) : '';
          const matchUser = matchedAccount?.username ? normalizeArabic(matchedAccount.username) : '';

          delegateMatch = 
            (rDelName !== '' && (
              rDelName === filterNorm ||
              rDelName.includes(filterNorm) ||
              filterNorm.includes(rDelName) ||
              (matchName !== '' && (rDelName === matchName || rDelName.includes(matchName))) ||
              (matchUser !== '' && (rDelName === matchUser || rDelName.includes(matchUser)))
            )) ||
            (rDelCode !== '' && (
              rDelCode === filterNorm ||
              rDelCode.includes(filterNorm) ||
              (matchCode !== '' && (rDelCode === matchCode || rDelCode.includes(matchCode))) ||
              (matchUser !== '' && (rDelCode === matchUser || rDelCode.includes(matchUser)))
            ));
        }
      } else {
        // Non-admin delegate: match only their own routes
        const currentName = normalizeArabic(currentUser?.name);
        const currentCode = normalizeArabic(currentUser?.delegateCode);
        const currentUsername = normalizeArabic(currentUser?.username);
        const rDelName = normalizeArabic(r.delegateName);
        const rDelCode = normalizeArabic(r.delegateCode);

        delegateMatch = (currentName !== '' && (rDelName.includes(currentName) || currentName.includes(rDelName))) ||
                        (currentCode !== '' && (rDelCode === currentCode || rDelName.includes(currentCode))) ||
                        (currentUsername !== '' && (rDelName.includes(currentUsername) || rDelCode === currentUsername));
      }

      if (!delegateMatch) return false;

      // 2. Day / Active Route matching (Strictly restricted to currently active/selected route)
      let dayMatch = true;
      if (currentUser?.isAdmin || isDataEntry) {
        if (routeFilterDay) {
          dayMatch = normalizeArabic(r.path).includes(normalizeArabic(routeFilterDay));
        }
      } else {
        // For delegate / representative: restricted strictly to today's active route
        const normCurrentDay = normalizeArabic(currentDay);
        const normPath = normalizeArabic(r.path);
        dayMatch = normPath.includes(normCurrentDay) || normCurrentDay.includes(normPath);
      }

      if (!dayMatch) return false;

      // 3. Search matching across customer fields
      if (isSearching) {
        const searchableText = [
          normalizeArabic(r.customerName),
          normalizeArabic(r.customerCode),
          normalizeArabic(r.customerAddress),
          normalizeArabic(r.customerPhone),
          normalizeArabic(r.path),
          normalizeArabic(r.delegateName),
          normalizeArabic(r.delegateCode),
          normalizeArabic(r.customerType)
        ].join(' ');

        const matchesAll = searchTerms.every(term => searchableText.includes(term));
        if (!matchesAll) return false;
      }

      return true;
    }).sort((a, b) => {
      // 1. Total invoices count (descending: highest to lowest)
      const aInvoices = getRouteItemInvoicesCount(a);
      const bInvoices = getRouteItemInvoicesCount(b);
      if (aInvoices !== bInvoices) return bInvoices - aInvoices;

      // 2. Primary: Position (descending, latest moved to top)
      const aPos = a.position || 0;
      const bPos = b.position || 0;
      if (aPos !== bPos) return bPos - aPos;

      // 3. Secondary: Visited
      const aVisited = isVisited(a);
      const bVisited = isVisited(b);
      if (aVisited === bVisited) return 0;
      // Unvisited (false) should come before Visited (true)
      return aVisited ? 1 : -1;
    });
  }, [routes, currentUser, routeFilterDelegate, delegateAccounts, routeFilterDay, currentDay, searchQuery, isVisited, getRouteItemInvoicesCount]);

  const finalRoutes = filteredRoutes;

  // Group routes by path/day in a single pass without re-sorting inline in JSX
  const groupedRoutesByDay = useMemo(() => {
    const listToDisplay = searchQuery.trim() ? finalRoutes : finalRoutes.slice(0, displayLimit);
    const groups: Record<string, RouteItem[]> = {};
    for (const r of listToDisplay) {
      const day = r.path || 'غير مصنف';
      if (!groups[day]) groups[day] = [];
      groups[day].push(r);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }, [finalRoutes, searchQuery, displayLimit]);

  // Optionally keep a check, but inform instead of block, or just rely on the effective code
  if (!currentUser?.isAdmin && !isDataEntry && !effectiveDelegateCode) {
      return (
          <div className="text-center py-10">
            <AlertCircle className="w-12 h-12 mx-auto text-amber-500 mb-2" />
            <p className="text-slate-600 dark:text-slate-400 font-bold">لا يتوفر كود مندوب لهذا المستخدم.</p>
          </div>
      );
  }

  const handleRowClick = (r: RouteItem) => {
    setSelectedRowId(r.id);
  };

  const moveToTop = async (r: RouteItem) => {
    try {
      await updateDoc(doc(db, 'routes', r.id), { position: Date.now() });
      addToast({ message: 'تم تصعيد المحل للأعلى بنجاح', type: 'success', delegateName: currentUser?.name || '', title: 'تصعيد', percentage: 0 });
    } catch (e) {
      addToast({ message: 'حدث خطأ أثناء التصعيد', type: 'info', delegateName: currentUser?.name || '', title: 'خطأ', percentage: 0 });
    }
  };

  const handleOrderClick = (r: RouteItem) => {
    setSelectedRowId(r.id);
    
    const todayStr = new Date().toISOString().split('T')[0];
    const customerEntries = allSalesEntries.filter(e => e.customerCode === r.customerCode);
    const lastInvoiceToday = customerEntries
        .filter(e => e.dateString === todayStr)
        .sort((a,b) => b.timestamp - a.timestamp)[0];

    setPrefilledEntryData({
      customerCode: r.customerCode,
      customerName: r.customerName,
      customerAddress: r.customerAddress,
      customerType: r.customerType,
      lastInvoiceToday: lastInvoiceToday
    });
    setShowQuickAdd(true);
    setActiveTab('products');
  };

  const handleUploadRoutes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

      const batch = writeBatch(db);
      const routesSnap = await getDocs(collection(db, 'routes'));
      routesSnap.forEach(r => batch.delete(r.ref));

      jsonData.forEach((row: any) => {
        const keys = Object.keys(row);
        const newRoute = {
          customerName: row[keys[0]] || '',
          customerCode: row[keys[1]] || '',
          path: row[keys[2]] || '',
          delegateName: row[keys[3]] || '',
          customerType: row[keys[4]] || 'مفرد',
          customerAddress: row[keys[5]] || '',
          delegateCode: String(row[keys[6]] || '').trim(), // Column G
        };
        
        const routeRef = doc(collection(db, 'routes'));
        batch.set(routeRef, newRoute);
      });
      
      await batch.commit();
      addToast({ message: 'تم استيراد المسارات بنجاح ✅', type: 'success', delegateName: currentUser?.name || '', title: 'استيراد', percentage: 0 });
    } catch (e) {
      console.error('Error importing routes:', e);
      addToast({ message: 'فشل استيراد المسارات.', type: 'info', delegateName: currentUser?.name || '', title: 'خطأ', percentage: 0 });
    }
  };



  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h2 className="text-emerald-800 dark:text-emerald-200 font-black text-xl">المسارات</h2>
        
        {/* Damaged Products (منتجات تالفة) Button - navigates to QC tab */}
        <button
          type="button"
          onClick={() => {
            setActiveTab('qc');
          }}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs sm:text-sm shadow-md shadow-rose-600/20 active:scale-95 transition-all cursor-pointer"
          title="الانتقال إلى صفحة منتجات تالفة (QC)"
        >
          <AlertTriangle className="w-4 h-4" />
          <span>منتجات تالفة (QC)</span>
        </button>
      </div>
      
      {/* Active Route Day Notice / Indicator */}
      {(!currentUser?.isAdmin && !isDataEntry) && (
        <div className={`p-2.5 sm:p-3 rounded-xl border flex items-center justify-between gap-2 shadow-xs ${
          routeDayInfo.isPast6PM 
            ? 'bg-gradient-to-r from-amber-500/15 via-emerald-500/10 to-teal-500/15 border-amber-500/30 text-amber-900 dark:text-amber-200' 
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-900 dark:text-emerald-200'
        }`}>
          <div className="flex items-center gap-2 text-xs sm:text-sm font-black">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              مسار اليوم المعروض: <span className="underline decoration-2 decoration-emerald-500 text-emerald-700 dark:text-emerald-300 font-extrabold">{currentDay}</span>
            </span>
          </div>
          {routeDayInfo.isPast6PM ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black bg-amber-500 text-slate-950 shadow-xs">
              مسار الغد (تحديث 6:00 م) 🌙
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold bg-emerald-600 text-white shadow-xs">
              مسار اليوم ☀️
            </span>
          )}
        </div>
      )}

      {/* Dashboard Widget */}
      {(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        const scheduledToday = filteredRoutes.length;
        const invoicesToday = new Set(salesEntries.filter(e => e.dateString === todayStr).map(e => e.customerCode)).size;

        return (
            <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="text-center">
                    <div className="text-[10px] font-bold text-slate-500 mb-1">
                      {routeDayInfo.isPast6PM && !currentUser?.isAdmin && !isDataEntry ? `زبائن مسار ${currentDay}` : 'زبائن اليوم'}
                    </div>
                    <div className="text-lg font-black text-slate-900 dark:text-white">{scheduledToday}</div>
                </div>
                <div className="text-center">
                    <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">فواتير اليوم</div>
                    <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">{invoicesToday}</div>
                </div>
            </div>
        );
      })()}
      
      {/* Search and Filters */}
      <div className={`p-3 rounded-xl border flex flex-col gap-2 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
            <input 
              type="text" 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              placeholder="بحث عن زبون (الاسم، الكود، العنوان، الهاتف، المسار)..." 
              className={`w-full pr-9 pl-8 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')} 
                className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold p-0.5"
                title="مسح البحث"
              >
                ✕
              </button>
            )}
          </div>
          {(currentUser?.isAdmin || isDataEntry) && (
            <>
              <select 
                value={routeFilterDelegate} 
                onChange={e => setRouteFilterDelegate(e.target.value)} 
                className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}
              >
                <option key="all-delegates" value="">كل المندوبين</option>
                {allAvailableDelegates && allAvailableDelegates.length > 0 ? (
                  allAvailableDelegates.map((d) => (
                    <option key={d.key} value={d.value}>{d.label}</option>
                  ))
                ) : (
                  <option key="no-delegates" disabled>لا يوجد مندوبون</option>
                )}
              </select>
              <select key="route-filter-day-select" value={routeFilterDay} onChange={e => setRouteFilterDay(e.target.value)} className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}>
                <option key="all-days" value="">كل الأيام</option>
                <option key="day-sat" value="السبت">السبت</option>
                <option key="day-sun" value="الأحد">الأحد</option>
                <option key="day-mon" value="الاثنين">الاثنين</option>
                <option key="day-tue" value="الثلاثاء">الثلاثاء</option>
                <option key="day-wed" value="الاربعاء">الاربعاء</option>
                <option key="day-thu" value="الخميس">الخميس</option>
              </select>
            </>
          )}
        </div>
        {searchQuery.trim() && (
          <div className="flex items-center justify-between text-[11px] font-bold text-emerald-600 dark:text-emerald-400 px-1">
            <span>نتائج البحث: تم العثور على {finalRoutes.length} زبون</span>
            <button 
              type="button" 
              onClick={() => setSearchQuery('')}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
            >
              إلغاء البحث
            </button>
          </div>
        )}
      </div>
      
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap"><thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}><tr><th className="px-3 py-2 border-b dark:border-slate-700">كود الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">اسم الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">العنوان</th><th className="px-3 py-2 border-b dark:border-slate-700">المسار</th><th className="px-3 py-2 border-b dark:border-slate-700">نوع الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">اسم المندوب</th></tr></thead><tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
            {!routesLoaded ? (
              // Skeleton Loader
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`route-skeleton-${i}`} className="animate-pulse">
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                </tr>
              ))
            ) : finalRoutes.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-500 font-bold">
                  {searchQuery.trim() ? (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Search className="w-8 h-8 text-slate-400" />
                      <span>لا توجد نتائج مطابقة لبحثك عن "{searchQuery}"</span>
                      <button 
                        type="button" 
                        onClick={() => setSearchQuery('')}
                        className="text-emerald-600 hover:underline text-xs"
                      >
                        مسح البحث وعرض الكل
                      </button>
                    </div>
                  ) : (
                    'لا توجد محلات مجدولة لهذا اليوم.'
                  )}
                </td>
              </tr>
            ) : (
              groupedRoutesByDay.map(([day, dayRoutes]) => (
                <React.Fragment key={day}>
                  <tr>
                    <td colSpan={6} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                      {day}
                    </td>
                  </tr>
                  {dayRoutes.map(r => {
                    const cCode = String(r.customerCode ?? '').trim();
                    const summary = customerSalesSummaryMap.get(cCode);
                    const hasOrderIn12Hours = summary?.hasOrderIn12Hours || false;
                    const totalWeightToday = summary?.totalWeightToday || 0;
                    
                    const isSearching = searchQuery.trim().length > 0;
                    const isHidden = !isSearching && !currentUser?.isAdmin && hasOrderIn12Hours;
                    
                    if (isHidden) return null;

                    const hasDebt = customerDebtsSet.has(cCode);

                    return (
                      <tr 
                        key={r.id} 
                        onClick={() => handleRowClick(r)}
                        className={`cursor-pointer transition-all ${hasOrderIn12Hours ? (isDarkMode ? 'bg-emerald-900/80' : 'bg-emerald-200') : selectedRowId === r.id ? 'bg-red-100 font-black' : `hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}`}
                      >
                        <td className={`px-3 py-2 ${selectedRowId === r.id ? 'text-red-700 font-black' : ''}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              {r.customerPhone && (
                                <a 
                                  href={`tel:${r.customerPhone}`}
                                  className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}
                                  title="اتصل بالزبون"
                                >
                                  <Phone className="w-3 h-3" />
                                </a>
                              )}
                              {r.customerCode}
                            </div>
                            <div className="flex items-center gap-1">
                              {!hasDebt && !completedDelegates[r.delegateName || ''] && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleOrderClick(r); }}
                                  className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-600`}
                                  title="طلب جديد"
                                >
                                  <ShoppingBag className="w-4 h-4" />
                                </button>
                              )}
                              
                              {totalWeightToday > 0 && (
                                  <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-[9px] font-black">
                                      {totalWeightToday.toFixed(1)} كجم
                                  </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">{r.customerName}</td>
                        <td className="px-3 py-2">{r.customerAddress}</td>
                        <td className="px-3 py-2">{r.path}</td>
                        <td className="px-3 py-2">{r.customerType}</td>
                        <td className="px-3 py-2">{r.delegateName}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!searchQuery.trim() && displayLimit < finalRoutes.length && (
        <button
          onClick={() => setDisplayLimit(l => l + 20)}
          className="w-full p-3 text-center bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 font-black text-xs rounded-xl"
        >
          عرض المزيد
        </button>
      )}

      {/* Summary Card removed */}

      {/* Debts Table rendered first */}
      <div className="mt-8">
        {renderDebtsTable()}
      </div>

      {/* Admin Monthly Stats Card */}
      {currentUser?.isAdmin && (() => {
        const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
        const successfulVisits = new Set(
          allSalesEntries
            .filter(e => e.dateString && e.dateString.startsWith(currentMonth))
            .map(e => e.customerCode)
        ).size;
        const plannedVisits = new Set(routes.map(r => r.customerCode)).size;

        return (
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 text-center shadow-sm">
                <div className="text-[10px] text-emerald-700 dark:text-emerald-300 mb-1">زيارات ناجحة (هذا الشهر)</div>
                <div className="text-sm font-black text-emerald-900 dark:text-emerald-100">{successfulVisits}</div>
            </div>
            <div className="bg-sky-50 dark:bg-sky-900/20 p-3 rounded-xl border border-sky-200 dark:border-sky-800 text-center shadow-sm">
                <div className="text-[10px] text-sky-700 dark:text-sky-300 mb-1">زيارات مخططة (الكل)</div>
                <div className="text-sm font-black text-sky-900 dark:text-sky-100">{plannedVisits}</div>
            </div>
          </div>
        );
      })()}

      {/* Debt Details Modal */}
      {selectedDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={() => setSelectedDebt(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-amber-600 dark:text-amber-400 text-center">تنبيه دين مستحق</h3>
            <div className="space-y-3 text-sm">
                <p><span className="font-bold text-slate-500">اسم الزبون:</span> {selectedDebt.customerName}</p>
                <p><span className="font-bold text-slate-500">كود الزبون:</span> {selectedDebt.customerCode}</p>
                <p><span className="font-bold text-slate-500">تاريخ الفاتورة:</span> {selectedDebt.invoiceDate}</p>
                <p><span className="font-bold text-slate-500">تاريخ السداد:</span> {selectedDebt.paymentDueDate}</p>
                <p><span className="font-bold text-slate-500">المبلغ المستحق:</span> {selectedDebt.amountDue.toLocaleString()} د.ع</p>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs border border-slate-200 dark:border-slate-700">
                  <span className="font-bold text-slate-600 dark:text-slate-400">حالة الاستحقاق (مستحقة):</span>
                  {(() => {
                    const payDateObj = parseDateToMidnight(selectedDebt.paymentDueDate);
                    if (!payDateObj) return <span className="font-mono font-bold text-slate-500">NT</span>;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const diff = Math.round((today.getTime() - payDateObj.getTime()) / (1000 * 3600 * 24));
                    if (today.getTime() >= payDateObj.getTime()) {
                      return <span className="font-black text-rose-600 dark:text-rose-400 font-mono">مستحقة ({diff} يوم)</span>;
                    }
                    const remaining = Math.round((payDateObj.getTime() - today.getTime()) / (1000 * 3600 * 24));
                    return <span className="font-bold text-slate-500 font-mono">غير مستحقة (NT) • باقي {remaining} يوم</span>;
                  })()}
                </div>
            </div>
            <div className="flex gap-2 pt-2">
                <button 
                    onClick={() => setSelectedDebt(null)}
                    className="flex-1 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition-colors cursor-pointer"
                >
                    إغلاق
                </button>
                {currentUser?.isAdmin && (
                  <>
                    <button 
                        onClick={() => {
                            const target = selectedDebt;
                            setSelectedDebt(null);
                            handleOpenWhatsAppModal(target);
                        }}
                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                        <MessageCircle className="w-4 h-4" />
                        <span>واتساب</span>
                    </button>
                    <button 
                        onClick={() => {
                            const target = selectedDebt;
                            setSelectedDebt(null);
                            setPaymentModalDebt(target);
                            setPaymentAmountInput(target.amountDue.toString());
                        }}
                        className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                        <CreditCard className="w-4 h-4" />
                        <span>تسديد الدين</span>
                    </button>
                  </>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Debt Settlement Modal (Centered with Blurred Backdrop) - Admin Only */}
      {paymentModalDebt && currentUser?.isAdmin && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => !isProcessingPayment && setPaymentModalDebt(null)}
          dir="rtl"
        >
          <div 
            className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl border text-center space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-emerald-500/40 text-white shadow-emerald-950/20' : 'bg-white border-emerald-200 text-slate-900 shadow-slate-300/50'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header Icon */}
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shadow-inner border border-emerald-500/30">
              <CreditCard className="w-7 h-7" />
            </div>

            {/* Title & Customer Info */}
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                تسديد دين الزبون
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {paymentModalDebt.customerName} ({paymentModalDebt.customerCode})
              </p>
            </div>

            {/* Input field */}
            <div className="space-y-1.5 text-right">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                أدخل المبلغ المطلوب تسديده:
              </label>
              <div className="relative">
                <input
                  type="number"
                  dir="ltr"
                  autoFocus
                  value={paymentAmountInput}
                  onChange={(e) => setPaymentAmountInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSavePayment();
                    }
                  }}
                  className="w-full text-center text-xl font-black py-2.5 px-3 rounded-xl border border-emerald-500/50 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all shadow-inner"
                  placeholder="المبلغ المسدد..."
                />
              </div>

              {/* Sub-text: required amount and status */}
              <div className="text-center pt-1 space-y-0.5">
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  المبلغ المطلوب: <span className="font-black text-emerald-600 dark:text-emerald-400">{paymentModalDebt.amountDue.toLocaleString()} د.ع</span>
                </p>
                {(() => {
                  const val = parseFloat(paymentAmountInput) || 0;
                  if (val > 0 && val < paymentModalDebt.amountDue) {
                    return (
                      <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        المتبقي في ذمة الزبون بعد التسديد: {(paymentModalDebt.amountDue - val).toLocaleString()} د.ع
                      </p>
                    );
                  }
                  if (val >= paymentModalDebt.amountDue && val > 0) {
                    return (
                      <p className="text-[10px] font-bold text-emerald-500">
                        ✓ سيتم تسديد وإغلاق الدين بالكامل
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={isProcessingPayment}
                onClick={() => setPaymentModalDebt(null)}
                className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border transition-all active:scale-95 cursor-pointer ${
                  isDarkMode 
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={isProcessingPayment}
                onClick={handleSavePayment}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white rounded-xl font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                {isProcessingPayment ? (
                  <span>جاري الحفظ...</span>
                ) : (
                  <>
                    <Save className="w-4 h-4 shrink-0" />
                    <span>حفظ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Debt Alert to Delegate Modal - Admin Only */}
      {whatsappModalDebt && currentUser?.isAdmin && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setWhatsappModalDebt(null)}
          dir="rtl"
        >
          <div 
            className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border text-center space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-emerald-500/40 text-white shadow-emerald-950/20' : 'bg-white border-emerald-200 text-slate-900 shadow-slate-300/50'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header Icon */}
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shadow-inner border border-emerald-500/30">
              <MessageCircle className="w-7 h-7" />
            </div>

            {/* Title & Info */}
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                إرسال تنبيه دين للمندوب عبر واتساب
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                سيتم إرسال رسالة تنبيه مفصلة بالدين لمندوب الزبون للمتابعة والاستحصال
              </p>
            </div>

            {/* Summary Box */}
            <div className="text-right p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">المندوب المسؤول:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {(() => {
                    const acc = delegateAccounts.find(
                      a => (whatsappModalDebt.delegateCode && a.delegateCode && String(a.delegateCode).trim() === String(whatsappModalDebt.delegateCode).trim()) ||
                           (whatsappModalDebt.delegateName && a.delegateName && normalizeArabic(a.delegateName) === normalizeArabic(whatsappModalDebt.delegateName))
                    );
                    return acc?.delegateName || whatsappModalDebt.delegateName || whatsappModalDebt.delegateCode || 'غير محدد';
                  })()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">الزبون:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {whatsappModalDebt.customerName} ({whatsappModalDebt.customerCode})
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">المبلغ المستحق:</span>
                <span className="font-black text-rose-600 dark:text-rose-400">
                  {whatsappModalDebt.amountDue.toLocaleString()} د.ع
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">تاريخ السداد:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                  {whatsappModalDebt.paymentDueDate}
                </span>
              </div>
            </div>

            {/* Phone Input field */}
            {(() => {
              const matchedAccount = delegateAccounts.find(
                (acc) =>
                  (whatsappModalDebt.delegateCode && acc.delegateCode && String(acc.delegateCode).trim() === String(whatsappModalDebt.delegateCode).trim()) ||
                  (whatsappModalDebt.delegateName && acc.delegateName && normalizeArabic(acc.delegateName) === normalizeArabic(whatsappModalDebt.delegateName))
              );
              const isFixed = Boolean(getFixedDelegatePhone(whatsappModalDebt.delegateName, whatsappModalDebt.delegateCode, matchedAccount?.username));

              return (
                <div className="space-y-1.5 text-right">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      رقم هاتف المندوب على واتساب:
                    </label>
                    {isFixed && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/60 px-2 py-0.5 rounded-full">
                        <span>🔒 رقم ثابت ومحفوظ</span>
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="tel"
                      dir="ltr"
                      autoFocus={!isFixed}
                      readOnly={isFixed}
                      value={delegatePhoneInput}
                      onChange={(e) => !isFixed && setDelegatePhoneInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSendWhatsAppAlert();
                        }
                      }}
                      className={`w-full text-center text-base font-bold py-2 px-3 rounded-xl border ${
                        isFixed
                          ? 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 select-all cursor-default'
                          : 'border-emerald-500/50 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500'
                      } transition-all shadow-inner`}
                      placeholder="مثال: 07701234567 أو 9647701234567"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center">
                    {isFixed
                      ? 'تم تثبيت وحفظ هذا الرقم للمندوب بصورة دائمة ومحمية من التغيير.'
                      : 'يمكن إدخال الرقم للإرسال المباشر، أو تركه فارغاً لاختيار المحادثة من واتساب مباشرة.'}
                  </p>
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setWhatsappModalDebt(null)}
                className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border transition-all active:scale-95 cursor-pointer ${
                  isDarkMode 
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={handleSendWhatsAppAlert}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 shrink-0" />
                <span>إرسال واتساب</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Dismissing Overdue Debts Modal Alert */}
      {showOverdueAlertModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="overdue-debts-modal-title"
          data-testid="overdue-debts-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowOverdueAlertModal(false);
            }
          }}
          dir="rtl"
        >
          <div
            className={`relative w-full max-w-[90%] sm:max-w-md max-h-[80vh] flex flex-col rounded-xl shadow-xl overflow-hidden border border-rose-300 dark:border-rose-900/60 ${
              isDarkMode ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 3-Second Auto-Dismiss Countdown Progress Bar */}
            <div className="w-full bg-rose-100 dark:bg-rose-950/60 h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${isCountdownPaused ? 'bg-amber-500' : 'bg-rose-600'}`}
                style={{ width: isCountdownPaused ? '100%' : `${Math.max(0, (countdownSeconds / 3) * 100)}%` }}
              />
            </div>

            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-rose-100 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/30">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500 text-white shadow-md shadow-rose-500/30 shrink-0">
                  <AlertTriangle className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 id="overdue-debts-modal-title" className="text-base sm:text-lg font-black text-rose-700 dark:text-rose-300">
                      تنبيه: ديون مستحقة متأخرة
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-xs">
                      {representativeOverdueDebts.length} زبائن
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-0.5">
                    ديون تجاوزت مدة استحقاقها يوماً واحداً (&gt; 1 يوم) لزبائنك المسندين إليك
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Countdown / Paused badge */}
                <span className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border ${
                  isCountdownPaused
                    ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800'
                    : 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/50 border-rose-200 dark:border-rose-800'
                }`}>
                  {isCountdownPaused ? <Pause className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  <span>{isCountdownPaused ? 'العداد متوقف' : `يغلق خلال ${countdownSeconds} ثوانٍ`}</span>
                </span>

                {/* Manual close button (X) */}
                <button
                  type="button"
                  onClick={() => setShowOverdueAlertModal(false)}
                  data-testid="close-overdue-modal-x"
                  aria-label="Close"
                  title="إغلاق"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-100/60 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Content Table */}
            <div className="p-4 overflow-y-auto max-h-[55vh]">
              <div className="overflow-x-auto rounded-xl border border-rose-200 dark:border-rose-900/60 shadow-xs">
                <table data-testid="overdue-debts-table" className="w-full text-right text-xs">
                  <thead className={`font-black ${isDarkMode ? 'bg-slate-800 text-rose-200 border-b border-rose-900/50' : 'bg-rose-50 text-rose-900 border-b border-rose-200'}`}>
                    <tr>
                      <th className="px-3.5 py-2.5 text-center">#</th>
                      <th className="px-3.5 py-2.5">اسم الزبون (Customer Name)</th>
                      <th className="px-3.5 py-2.5 text-left">المبلغ المطلوب (Required Amount)</th>
                      <th className="px-3.5 py-2.5 text-center">المدة المستحقة (Due Days)</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y font-bold ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-rose-100 bg-white text-slate-900'}`}>
                    {representativeOverdueDebts.map((debt, idx) => (
                      <tr key={debt.id || `overdue-debt-${idx}`} className={`hover:bg-rose-500/10 transition-colors ${isDarkMode ? 'odd:bg-slate-900 even:bg-slate-800/40' : 'odd:bg-white even:bg-rose-50/30'}`}>
                        <td className="px-3.5 py-2.5 text-center font-mono text-[11px] text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="px-3.5 py-2.5 font-black text-slate-900 dark:text-white">
                          <div className="flex flex-col">
                            <span className="font-black text-sm">{debt.customerName}</span>
                            {debt.customerCode && (
                              <span className="text-[10px] text-slate-400 font-mono">كود الزبون: {debt.customerCode}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-left font-mono font-black text-rose-600 dark:text-rose-400 text-sm whitespace-nowrap">
                          {Number(debt.amountDue || 0).toLocaleString()} <span className="text-[10px] font-sans">د.ع</span>
                        </td>
                        <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-500 text-white shadow-xs">
                            <Clock className="w-3 h-3" />
                            <span>{debt.dueDays} يوم</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className={`font-black text-xs border-t ${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-50 text-slate-800 border-slate-200'}`}>
                    <tr>
                      <td colSpan={2} className="px-3.5 py-2.5">
                        إجمالي الديون المتأخرة المستحقة ({representativeOverdueDebts.length} زبائن)
                      </td>
                      <td className="px-3.5 py-2.5 text-left font-mono font-black text-rose-600 dark:text-rose-400 text-sm whitespace-nowrap">
                        {representativeOverdueDebts.reduce((sum, it) => sum + (Number(it.amountDue) || 0), 0).toLocaleString()} <span className="text-[10px] font-sans">د.ع</span>
                      </td>
                      <td className="px-3.5 py-2.5 text-center text-[10px] text-slate-400 font-bold">&gt; 1 يوم</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Modal Footer with Pause Counter Button & Manual Close ("Close" / "إغلاق") Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
              <div className="text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5">
                {isCountdownPaused ? (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-black">
                    <Pause className="w-4 h-4 shrink-0" />
                    <span>تم إيقاف العداد (يمكنك قراءة الديون بدون إغلاق تلقائي)</span>
                  </span>
                ) : (
                  <>
                    <Clock className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>يغلق تلقائياً بعد {countdownSeconds} ثوانٍ</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 justify-end">
                {/* Pause / Resume Button adjacent to the Close button */}
                <button
                  type="button"
                  onClick={() => setIsCountdownPaused((prev) => !prev)}
                  data-testid="pause-overdue-modal-countdown-btn"
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs ${
                    isCountdownPaused
                      ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                      : 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700'
                  }`}
                  title={isCountdownPaused ? 'استئناف العداد التلقائي' : 'إيقاف العداد لقراءة الديون'}
                >
                  {isCountdownPaused ? (
                    <>
                      <Play className="w-4 h-4 shrink-0 fill-current" />
                      <span>استئناف العداد</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4 shrink-0 fill-current" />
                      <span>إيقاف العداد</span>
                    </>
                  )}
                </button>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setShowOverdueAlertModal(false)}
                  data-testid="close-overdue-modal-btn"
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs"
                >
                  <X className="w-4 h-4" />
                  <span>إغلاق (Close)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      
      <div className="mt-8">
      </div>





    </div>
  );
};
