import React, { useState, useEffect, useMemo } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, updateDoc, doc, writeBatch, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { RouteItem, DebtItem, SalesEntry } from '../types';
import { CheckCircle2, Circle, AlertCircle, ArrowUp, Upload, CheckSquare, Square, ShoppingBag, MapPin, Phone, User, CreditCard, Save, Search, X, FileSpreadsheet, Download, Calendar, Users, XCircle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
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

  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [manualVisits, setManualVisits] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!currentUser) return;
    
    let debtsQ;
    if (currentUser.isAdmin) {
        debtsQ = query(collection(db, 'debts'));
    } else if (currentUser.delegateCode) {
        debtsQ = query(collection(db, 'debts'), where('delegateCode', '==', currentUser.delegateCode));
    } else {
        debtsQ = query(collection(db, 'debts'), where('delegateCode', '==', 'NONE_MATCH'));
    }
    
    const unsubDebts = onSnapshot(debtsQ, (snap) => {
      const loaded: DebtItem[] = [];
      snap.forEach(d => loaded.push({id: d.id, ...d.data()} as DebtItem));
      setDebts(loaded);
    }, (err) => {
      console.error('Debts listener error:', err);
    });
    return () => unsubDebts();
  }, [currentUser]);
  
  const [selectedDebt, setSelectedDebt] = useState<DebtItem | null>(null);
  const [paymentModalDebt, setPaymentModalDebt] = useState<DebtItem | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [debtSearch, setDebtSearch] = useState('');

  // Monthly Customer Reports States (Admin only)
  const [monthlyReportMonth, setMonthlyReportMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [monthlyOrderedSearch, setMonthlyOrderedSearch] = useState<string>('');
  const [monthlyOrderedDelegate, setMonthlyOrderedDelegate] = useState<string>('الكل');
  const [monthlyOrderedShowAll, setMonthlyOrderedShowAll] = useState<boolean>(false);
  const [monthlyUnorderedSearch, setMonthlyUnorderedSearch] = useState<string>('');
  const [monthlyUnorderedDelegate, setMonthlyUnorderedDelegate] = useState<string>('الكل');
  const [monthlyUnorderedShowAll, setMonthlyUnorderedShowAll] = useState<boolean>(false);

  // Configurable auto-lock closing time (default 15:00 / 3:00 PM) & real-time clock tick
  const [targetAutoLockTime, setTargetAutoLockTime] = useState<string>('15:00');
  const [timeTick, setTimeTick] = useState<number>(Date.now());

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (docSnap) => {
        if (docSnap.exists() && docSnap.data()?.time) {
          setTargetAutoLockTime(docSnap.data().time);
        }
      },
      (err) => {
        console.error('Error listening to auto_lock_time in RoutesScreen:', err);
      }
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
  const [selectedDelegateFilter, setSelectedDelegateFilter] = useState<string | null>(null);

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
      if (!q) return result;

      return result.filter(d => {
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
  }, [debts, debtSearch, selectedDelegateFilter, delegateAccounts]);

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

  const exportDebtsToExcel = () => {
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
              <h3 className="text-emerald-800 dark:text-emerald-200 font-black text-lg text-center">الديون المستحقة</h3>
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
                {currentUser?.isAdmin && <th className="px-2.5 py-2.5 text-center">تسديد</th>}
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-slate-200 bg-white text-slate-900'}`}>
              {filteredDebts.sort((a,b) => {
                const payA = parseDateToMidnight(a.paymentDueDate)?.getTime() || 0;
                const payB = parseDateToMidnight(b.paymentDueDate)?.getTime() || 0;
                return payA - payB;
              }).map(d => {
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
                      <td className="px-2.5 py-2 text-center">
                          <button onClick={handlePay} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-lg text-[10px] font-black shadow-xs transition-all cursor-pointer">تسديد</button>
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
    const unsub = onSnapshot(q, (snap) => {
      const completed: Record<string, boolean> = {};
      snap.forEach(d => {
        completed[d.id] = true;
        const data = d.data();
        if (data.delegate) completed[data.delegate] = true;
        if (data.delegateName) completed[data.delegateName] = true;
        if (data.delegateCode) completed[data.delegateCode] = true;
      });
      setCompletedDelegates(completed);
    });
    
    // Load manual visits
    const delegateCode = String(effectiveDelegateCode || '').trim();
    if (delegateCode) {
        const visitsQ = query(collection(db, 'daily_visits'), where('date', '==', today), where('delegateCode', '==', delegateCode));
        const unsubVisits = onSnapshot(visitsQ, (snap) => {
            const v: Record<string, boolean> = {};
            snap.forEach(d => {
                v[d.data().customerCode] = true;
            });
            setManualVisits(v);
        });
        return () => { unsub(); unsubVisits(); };
    }
    
    return () => unsub();
  }, [currentUser]);

  const [routeFilterDelegate, setRouteFilterDelegate] = useState((currentUser?.isAdmin || isDataEntry) ? '' : currentUser?.delegateCode || '');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
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

    const unsubRoutes = onSnapshot(routesQ, (snap) => {
      const loaded: RouteItem[] = [];
      snap.forEach(d => {
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
    }, (err) => {
      console.error('Routes listener error:', err);
    });
    return () => unsubRoutes();
  }, [currentUser]);

  const currentDay = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(new Date());
  const isCompleted = completedDelegates[currentUser?.name || ''] || false;

  const isVisited = React.useCallback((r: RouteItem) => {
    const cCode = String(r.customerCode ?? '').trim();
    const customerEntries = allSalesEntries.filter(e => String(e.customerCode ?? '').trim() === cCode);
    const todayStr = new Date().toISOString().split('T')[0];
    const hasSale = customerEntries.some(e => e.dateString === todayStr);
    return hasSale || !!manualVisits[cCode];
  }, [allSalesEntries, manualVisits]);

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

  const todayOrders = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const orders: Record<string, any> = {};
    allSalesEntries
      .filter(e => e.dateString === today)
      .forEach(entry => {
        const key = entry.customerCode || entry.customerName;
        if (!orders[key]) {
            orders[key] = {
                customerName: entry.customerName,
                customerCode: entry.customerCode || '',
                totalWeight: 0,
                totalAmount: 0,
                customerType: entry.customerType || 'مفرد',
                customerAddress: entry.customerAddress || ''
            };
        }
        orders[key].totalWeight += entry.totalWeightKg;
        
        // Find product price
        const prod = productsList.find(p => p.productName === entry.productName);
        const price = prod ? (entry.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
        orders[key].totalAmount += (price * entry.quantity);
      });
    return Object.values(orders);
  }, [allSalesEntries]);

  const effectiveDelegateCode = useMemo(() => {
      if (currentUser?.delegateCode) return currentUser.delegateCode;
      const account = delegateAccounts.find(a => a.delegateName === currentUser?.name || a.username === currentUser?.username);
      return account?.delegateCode;
  }, [currentUser, delegateAccounts]);

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

  const handleRowClickOrder = (order: any) => {
    setSelectedInvoice(order);
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

  // 1. Monthly Ordered Customers Data (Strictly deduplicated by customer code across the entire month)
  const monthlyOrderedData = useMemo(() => {
    if (!canViewMonthlyReports) return { list: [], totalWeight: 0, totalAmount: 0, totalInvoices: 0 };

    // Combine all sales entry sources to guarantee no monthly record is missed
    const allEntriesMap = new Map<string, SalesEntry>();
    if (Array.isArray(allSalesEntries)) {
      allSalesEntries.forEach(e => { if (e && (e.id || e.customerCode || e.customerName)) allEntriesMap.set(e.id || `${e.dateString}_${e.customerCode}_${e.productName}`, e); });
    }
    if (Array.isArray(salesEntries)) {
      salesEntries.forEach(e => { if (e && (e.id || e.customerCode || e.customerName)) allEntriesMap.set(e.id || `${e.dateString}_${e.customerCode}_${e.productName}`, e); });
    }
    const combinedEntries = Array.from(allEntriesMap.values());

    // Robust Date Normalizer to ISO YYYY-MM-DD
    const normalizeDateStr = (dateStr?: any): string => {
      if (!dateStr) return '';
      const eng = String(dateStr)
        .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x06f0))
        .replace(/\//g, '-')
        .trim();
      const parts = eng.split('-').map(p => p.trim());
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        } else if (parts[2].length === 4) {
          return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      }
      return eng;
    };

    // Matches any entry belonging to the selected month (from day 01 to the last day)
    const isEntryInSelectedMonth = (dateStr?: string) => {
      if (!dateStr) return false;
      const clean = normalizeDateStr(dateStr);
      return clean.startsWith(monthlyReportMonth);
    };

    const monthEntries = combinedEntries.filter((e) => isEntryInSelectedMonth(e.dateString));

    // Lookup caches from routes to correlate customerCode <-> customerName and address
    const codeToRoute = new Map<string, RouteItem>();
    const nameToRoute = new Map<string, RouteItem>();
    routes.forEach(r => {
      const c = String(r.customerCode ?? '').trim();
      const n = (r.customerName || '').trim();
      if (c && !codeToRoute.has(c.toLowerCase())) codeToRoute.set(c.toLowerCase(), r);
      if (n && !nameToRoute.has(n.toLowerCase())) nameToRoute.set(n.toLowerCase(), r);
    });

    // Helper to verify if an invoice entry is adopted according to the conditional calculation trigger:
    // - Past days: adopted (day has officially closed)
    // - Future days: not yet adopted
    // - Today: adopted if representative clicked "I have completed today's sales" OR official closing time reached
    const isEntryAdopted = (dateStr?: string, delName?: string, delCode?: string) => {
      if (!dateStr) return false;
      const cleanDate = normalizeDateStr(dateStr);
      const { todayBaghdad, isPastClosing } = baghdadStatus;

      // 1. Past dates in the month: closing time has already passed
      if (cleanDate < todayBaghdad) {
        return true;
      }

      // 2. Future dates: not reached yet
      if (cleanDate > todayBaghdad) {
        return false;
      }

      // 3. Current day (today):
      // If official closing time has been reached, automatically adopt all active remaining invoices in the system
      if (isPastClosing) {
        return true;
      }

      // Otherwise, only adopt if the representative has clicked "I have completed today's sales"
      return isDelegateCompletedToday(delName, delCode);
    };

    // Filter entries to only those that meet the adoption trigger condition
    const adoptedMonthEntries = monthEntries.filter(entry => {
      return isEntryAdopted(entry.dateString, entry.delegateName, (entry as any).delegateCode);
    });

    const map = new Map<string, {
      customerCode: string;
      customerName: string;
      customerAddress: string;
      delegateName: string;
      totalWeight: number;
      totalAmount: number;
      invoicesCount: number;
      invoiceDates: Set<string>;
    }>();

    // 1. Process adopted daily sales entries
    adoptedMonthEntries.forEach((entry) => {
      let code = String(entry.customerCode ?? '').trim();
      let name = (entry.customerName || '').trim();

      // If code is missing, correlate from routes via customerName
      if (!code && name && nameToRoute.has(name.toLowerCase())) {
        code = String(nameToRoute.get(name.toLowerCase())?.customerCode ?? '').trim();
      }
      // If name is missing, correlate from routes via customerCode
      if (!name && code && codeToRoute.has(code.toLowerCase())) {
        name = (codeToRoute.get(code.toLowerCase())?.customerName || '').trim();
      }

      // PRIMARY DEDUPLICATION KEY: Strictly customerCode if available, otherwise customerName
      const key = code ? `code_${code.toLowerCase()}` : (name ? `name_${name.toLowerCase()}` : '');
      if (!key) return;

      if (!map.has(key)) {
        const routeMatch = (code ? codeToRoute.get(code.toLowerCase()) : undefined) || (name ? nameToRoute.get(name.toLowerCase()) : undefined);
        map.set(key, {
          customerCode: code || String(routeMatch?.customerCode ?? '').trim(),
          customerName: name || (routeMatch?.customerName || '').trim() || 'غير محدد',
          customerAddress: (entry.customerAddress || '').trim() || (routeMatch?.customerAddress || '').trim() || 'غير محدد',
          delegateName: (entry.delegateName || '').trim() || (routeMatch?.delegateName || '').trim() || 'غير محدد',
          totalWeight: 0,
          totalAmount: 0,
          invoicesCount: 0,
          invoiceDates: new Set<string>()
        });
      }

      const item = map.get(key)!;
      if (!item.customerName || item.customerName === 'غير محدد') if (name) item.customerName = name;
      if (!item.customerCode) if (code) item.customerCode = code;
      if ((item.customerAddress === 'غير محدد' || !item.customerAddress) && entry.customerAddress?.trim()) {
        item.customerAddress = entry.customerAddress.trim();
      }
      if ((item.delegateName === 'غير محدد' || !item.delegateName) && entry.delegateName?.trim()) {
        item.delegateName = entry.delegateName.trim();
      }

      // Monthly accumulated weight
      item.totalWeight += (entry.totalWeightKg || 0);

      // Monthly accumulated amount
      const prod = productsList.find((p) => p.productName === entry.productName);
      const price = prod ? (entry.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
      item.totalAmount += (price * (entry.quantity || 0));

      // Strictly count each invoice on each day from month start to month end
      if (entry.dateString) {
        const cleanDate = normalizeDateStr(entry.dateString);
        if (cleanDate) {
          const invSubKey = entry.invoiceId || (entry as any).invoiceNumber
            ? `${cleanDate}_${entry.invoiceId || (entry as any).invoiceNumber}` 
            : cleanDate;
          item.invoiceDates.add(invSubKey);
        }
      }
      item.invoicesCount = item.invoiceDates.size;
    });

    // 2. Incorporate invoice records from debts for the current month (each distinct day counts as an invoice)
    if (Array.isArray(debts)) {
      debts.forEach((debt) => {
        let code = String(debt.customerCode ?? '').trim();
        let name = (debt.customerName || '').trim();
        const normDebtDate = normalizeDateStr(debt.invoiceDate);

        if (!normDebtDate.startsWith(monthlyReportMonth)) return;

        // If code is missing, correlate from routes via customerName
        if (!code && name && nameToRoute.has(name.toLowerCase())) {
          code = String(nameToRoute.get(name.toLowerCase())?.customerCode ?? '').trim();
        }
        // If name is missing, correlate from routes via customerCode
        if (!name && code && codeToRoute.has(code.toLowerCase())) {
          name = (codeToRoute.get(code.toLowerCase())?.customerName || '').trim();
        }

        const key = code ? `code_${code.toLowerCase()}` : (name ? `name_${name.toLowerCase()}` : '');
        if (!key) return;

        if (!map.has(key)) {
          const routeMatch = (code ? codeToRoute.get(code.toLowerCase()) : undefined) || (name ? nameToRoute.get(name.toLowerCase()) : undefined);
          map.set(key, {
            customerCode: code || String(routeMatch?.customerCode ?? '').trim(),
            customerName: name || (routeMatch?.customerName || '').trim() || 'غير محدد',
            customerAddress: (routeMatch?.customerAddress || '').trim() || 'غير محدد',
            delegateName: (debt.delegateName || '').trim() || (routeMatch?.delegateName || '').trim() || 'غير محدد',
            totalWeight: 0,
            totalAmount: 0,
            invoicesCount: 0,
            invoiceDates: new Set<string>()
          });
        }

        const item = map.get(key)!;
        if (!item.customerName || item.customerName === 'غير محدد') if (name) item.customerName = name;
        if (!item.customerCode) if (code) item.customerCode = code;
        if ((item.delegateName === 'غير محدد' || !item.delegateName) && debt.delegateName?.trim()) {
          item.delegateName = debt.delegateName.trim();
        }

        // Each distinct invoice date/debt is counted as an independent invoice
        const debtInvKey = debt.id ? `${normDebtDate}_debt_${debt.id}` : `${normDebtDate}_debt`;
        if (!item.invoiceDates.has(debtInvKey)) {
          item.totalAmount += (Number(debt.amountDue) || 0);
          item.invoiceDates.add(debtInvKey);
        }
        item.invoicesCount = item.invoiceDates.size;
      });
    }

    const list = Array.from(map.values()).sort((a, b) => {
      if (b.invoicesCount !== a.invoicesCount) {
        return b.invoicesCount - a.invoicesCount;
      }
      return b.totalAmount - a.totalAmount;
    });
    const totalWeight = list.reduce((sum, item) => sum + item.totalWeight, 0);
    const totalAmount = list.reduce((sum, item) => sum + item.totalAmount, 0);
    const totalInvoices = list.reduce((sum, item) => sum + item.invoicesCount, 0);

    return { list, totalWeight, totalAmount, totalInvoices };
  }, [allSalesEntries, salesEntries, debts, monthlyReportMonth, routes, productsList, canViewMonthlyReports, baghdadStatus, completedDelegates]);

  // Filtered Monthly Ordered Customers
  const filteredMonthlyOrdered = useMemo(() => {
    return monthlyOrderedData.list.filter((c) => {
      const matchDelegate = monthlyOrderedDelegate === 'الكل' || c.delegateName === monthlyOrderedDelegate;
      if (!matchDelegate) return false;

      if (!monthlyOrderedSearch.trim()) return true;
      const q = normalizeArabic(monthlyOrderedSearch);
      return (
        normalizeArabic(c.customerName).includes(q) ||
        normalizeArabic(c.customerCode).includes(q) ||
        normalizeArabic(c.customerAddress).includes(q) ||
        normalizeArabic(c.delegateName).includes(q)
      );
    });
  }, [monthlyOrderedData.list, monthlyOrderedDelegate, monthlyOrderedSearch]);

  // 2. Customers with NO orders throughout the entire month (Compared strictly by customer code)
  const monthlyUnorderedCustomers = useMemo(() => {
    if (!canViewMonthlyReports) return [];

    // Set of customer codes and names that have orders in the month
    const orderedCodes = new Set<string>();
    const orderedNames = new Set<string>();
    monthlyOrderedData.list.forEach((c) => {
      if (c.customerCode) orderedCodes.add(c.customerCode.trim().toLowerCase());
      if (c.customerName) orderedNames.add(c.customerName.trim().toLowerCase());
    });

    // Deduplicate routes strictly by customerCode so each customer appears only ONCE
    const uniqueMap = new Map<string, RouteItem>();
    routes.forEach((r) => {
      const code = (r.customerCode || '').trim();
      const name = (r.customerName || '').trim();
      if (!code && !name) return;

      // Comparison based on customer code (or customer name if no code)
      const hasOrderedInMonth = (code && orderedCodes.has(code.toLowerCase())) ||
                                (!code && name && orderedNames.has(name.toLowerCase()));

      if (hasOrderedInMonth) return;

      // Deduplicate strictly by customer code (or name if no code)
      const key = code ? `code_${code.toLowerCase()}` : `name_${name.toLowerCase()}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, r);
      }
    });

    return Array.from(uniqueMap.values()).sort((a, b) => (a.customerName || '').localeCompare(b.customerName || '', 'ar'));
  }, [routes, monthlyOrderedData.list, canViewMonthlyReports]);

  // Filtered Unordered Customers
  const filteredMonthlyUnordered = useMemo(() => {
    return monthlyUnorderedCustomers.filter((r) => {
      const matchDelegate = monthlyUnorderedDelegate === 'الكل' || r.delegateName === monthlyUnorderedDelegate;
      if (!matchDelegate) return false;

      if (!monthlyUnorderedSearch.trim()) return true;
      const q = normalizeArabic(monthlyUnorderedSearch);
      return (
        normalizeArabic(r.customerName).includes(q) ||
        normalizeArabic(r.customerCode).includes(q) ||
        normalizeArabic(r.customerAddress).includes(q) ||
        normalizeArabic(r.delegateName).includes(q)
      );
    });
  }, [monthlyUnorderedCustomers, monthlyUnorderedDelegate, monthlyUnorderedSearch]);

  const exportMonthlyOrderedExcel = () => {
    const data = filteredMonthlyOrdered.map((c, idx) => {
      const row: Record<string, any> = {
        'ت': idx + 1,
        'اسم الزبون': c.customerName,
        'كود الزبون': c.customerCode,
        'عنوان الزبون': c.customerAddress,
        'اسم المندوب': c.delegateName,
      };
      if (!isDataEntry) {
        row['عدد الفواتير الشهرية'] = c.invoicesCount;
        row['الوزن الكلي الشهري (كجم)'] = Number(c.totalWeight.toFixed(2));
        row['المبلغ الكلي الشهري (د.ع)'] = Math.round(c.totalAmount);
      }
      row['الشهر المالي'] = monthlyReportMonth;
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'فواتير الزبائن الشهرية');
    XLSX.writeFile(workbook, `تقرير_فواتير_الزبائن_الشهرية_${monthlyReportMonth}.xlsx`);
  };

  const exportMonthlyUnorderedExcel = () => {
    const data = filteredMonthlyUnordered.map((r, idx) => ({
      'ت': idx + 1,
      'اسم الزبون': r.customerName,
      'كود الزبون': r.customerCode,
      'عنوان الزبون': r.customerAddress || 'غير محدد',
      'اسم المندوب': r.delegateName,
      'حالة الشهر': 'لم يتم طلب أي فاتورة طوال هذا الشهر',
      'الشهر المالي': monthlyReportMonth
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'زبائن بدون فواتير شهرية');
    XLSX.writeFile(workbook, `زبائن_بدون_فواتير_شهرية_${monthlyReportMonth}.xlsx`);
  };

  const renderMonthlyCustomerReports = () => {
    if (!canViewMonthlyReports) return null;

    const delegateOptions = [
      'الكل',
      ...Array.from(new Set(delegateAccounts.map(a => a.delegateName).filter(Boolean)))
    ];

    const currentFilteredWeight = filteredMonthlyOrdered.reduce((sum, c) => sum + c.totalWeight, 0);
    const currentFilteredAmount = filteredMonthlyOrdered.reduce((sum, c) => sum + c.totalAmount, 0);
    const currentFilteredInvoices = filteredMonthlyOrdered.reduce((sum, c) => sum + c.invoicesCount, 0);

    const displayedMonthlyOrdered = monthlyOrderedShowAll 
      ? filteredMonthlyOrdered 
      : filteredMonthlyOrdered.slice(0, 20);

    const displayedMonthlyUnordered = monthlyUnorderedShowAll 
      ? filteredMonthlyUnordered 
      : filteredMonthlyUnordered.slice(0, 20);

    return (
      <div className="space-y-4 mt-6">
        {/* Main Section Header Card */}
        <div className={`p-2.5 sm:p-3.5 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5">
                <div className="p-1.5 rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
                  <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                  تقارير فواتير وطلبات الزبائن الشهرية (تراكمي شهر {monthlyReportMonth})
                </h3>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                {isDataEntry 
                  ? 'حسابات شهرية تراكمية بدون تكرار الزبون وبالمقارنة حسب كود الزبون'
                  : 'حسابات شهرية تراكمية بدون تكرار الزبون وبالمقارنة حسب كود الزبون (العدد + الوزن + المبلغ)'}
              </p>
            </div>

            {/* Month Picker Control */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">الشهر:</span>
              <input
                type="month"
                value={monthlyReportMonth}
                onChange={(e) => setMonthlyReportMonth(e.target.value)}
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded border focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer ${
                  isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                }`}
              />
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className={`grid gap-1.5 sm:gap-2 mt-2.5 ${isDataEntry ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-5'}`}>
            <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">الزبائن أصحاب الفواتير</span>
              <div className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                {monthlyOrderedData.list.length.toLocaleString()} زبون
              </div>
            </div>

            {!isDataEntry && (
              <>
                <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">عدد الفواتير الكلي للشهر</span>
                  <div className="text-xs sm:text-sm font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
                    {monthlyOrderedData.totalInvoices.toLocaleString()} فاتورة
                  </div>
                </div>

                <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">الوزن الشهري التراكمي</span>
                  <div className="text-xs sm:text-sm font-black text-slate-900 dark:text-white mt-0.5">
                    {monthlyOrderedData.totalWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} كجم
                  </div>
                </div>

                <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">المبلغ الشهري التراكمي</span>
                  <div className="text-xs sm:text-sm font-black text-blue-600 dark:text-blue-400 mt-0.5">
                    {Math.round(monthlyOrderedData.totalAmount).toLocaleString()} د.ع
                  </div>
                </div>
              </>
            )}

            <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDataEntry ? '' : 'col-span-2 sm:col-span-1'} ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">زبائن بدون فواتير بالشهر</span>
              <div className="text-xs sm:text-sm font-black text-amber-600 dark:text-amber-400 mt-0.5">
                {monthlyUnorderedCustomers.length.toLocaleString()} زبون
              </div>
            </div>
          </div>

          {/* Conditional Trigger Adoption Status Info */}
          <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-bold">
            <div className="flex items-center gap-1.5">
              {baghdadStatus.isPastClosing ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  تم بلوغ وقت الإغلاق الرسمي ({formattedTargetTime}) — تم اعتماد كافة الفواتير والطلبات المتبقية في النظام تلقائياً
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  شرط الاعتماد اليومي: تُعتمد فواتير اليوم فور ضغط المندوب على «لقد أكملت مبيعات اليوم» أو تلقائياً عند الإغلاق الرسمي ({formattedTargetTime})
                </span>
              )}
            </div>
            <div className="text-slate-500 dark:text-slate-400 text-[9px] font-mono">
              توقيت تكريت: {baghdadStatus.todayBaghdad}
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* TABLE 1: Customers with Orders in Current Month */}
        {/* ======================================================== */}
        <div className={`p-2.5 sm:p-3.5 rounded-xl border shadow-sm space-y-2.5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h4 className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <span>🛒</span>
                <span>جدول فواتير وطلبات الزبائن في الشهر الحالي ({monthlyReportMonth})</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                  {filteredMonthlyOrdered.length} زبون
                </span>
              </h4>
              <p className="text-[10px] text-slate-500 font-bold">
                حسابات تراكمية شهرية تجمع جميع الفواتير الصادرة لكل زبون بدون تكرار
              </p>
            </div>

            {/* Export Excel Button */}
            <button
              onClick={exportMonthlyOrderedExcel}
              disabled={filteredMonthlyOrdered.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold shadow-sm transition-all cursor-pointer"
              title="تصدير جدول طلبات الزبائن الشهرية كملف إكسل"
            >
              <Download className="w-3 h-3" />
              <span>تصدير التقرير (Excel)</span>
            </button>
          </div>

          {/* Filters Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div className="relative">
              <Search className="w-3 h-3 absolute right-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={monthlyOrderedSearch}
                onChange={(e) => setMonthlyOrderedSearch(e.target.value)}
                placeholder="بحث باسم الزبون، الكود، العنوان، أو المندوب..."
                className={`w-full pr-7 pl-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
              />
            </div>

            <select
              value={monthlyOrderedDelegate}
              onChange={(e) => setMonthlyOrderedDelegate(e.target.value)}
              className={`w-full py-1 px-2 rounded-lg border text-[11px] font-bold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              <option value="الكل">جميع المندوبين (الكل)</option>
              {delegateOptions.filter(d => d !== 'الكل').map((delName) => (
                <option key={`ordered-del-${delName}`} value={delName}>
                  {delName}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-800 shadow-xs">
            <table className={`w-full ${isDataEntry ? 'min-w-[480px]' : 'min-w-[650px]'} text-[10px] sm:text-[11px] text-right whitespace-nowrap`}>
              <thead className={`font-black ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/90 text-slate-900 border-b border-slate-300'}`}>
                <tr>
                  <th className="px-2.5 py-2 text-center w-8">ت</th>
                  <th className="px-2.5 py-2">اسم الزبون</th>
                  <th className="px-2.5 py-2">كود الزبون</th>
                  <th className="px-2.5 py-2">عنوان الزبون</th>
                  <th className="px-2.5 py-2">اسم المندوب</th>
                  {!isDataEntry && <th className="px-2.5 py-2 text-center">عدد الفواتير</th>}
                  {!isDataEntry && <th className="px-2.5 py-2 text-center">الوزن الكلي</th>}
                  {!isDataEntry && <th className="px-2.5 py-2 text-center">المبلغ الكلي</th>}
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-slate-200 bg-white text-slate-900'}`}>
                {filteredMonthlyOrdered.length === 0 ? (
                  <tr>
                    <td colSpan={isDataEntry ? 5 : 8} className="py-6 text-center text-slate-500 dark:text-slate-400 font-bold">
                      لا توجد فواتير أو طلبات مسجلة للزبائن في هذا الشهر حسب معايير البحث.
                    </td>
                  </tr>
                ) : (
                  displayedMonthlyOrdered.map((c, idx) => (
                    <tr key={`ordered-${c.customerCode}-${idx}`} className="hover:bg-emerald-50/50 dark:hover:bg-slate-800/60 transition-colors font-bold">
                      <td className="px-2.5 py-2 text-center font-bold text-slate-500 dark:text-slate-400">{idx + 1}</td>
                      <td className="px-2.5 py-2 font-black text-slate-900 dark:text-white text-xs">{c.customerName}</td>
                      <td className="px-2.5 py-2 font-mono text-[9px]">
                        <span className="px-1.5 py-0.5 rounded font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          {c.customerCode || '-'}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-slate-700 dark:text-slate-300 font-medium max-w-[170px] truncate" title={c.customerAddress}>{c.customerAddress}</td>
                      <td className="px-2.5 py-2 font-extrabold text-slate-800 dark:text-slate-200">{c.delegateName}</td>
                      {!isDataEntry && (
                        <td className="px-2.5 py-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-md font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 shadow-2xs">
                            {c.invoicesCount}
                          </span>
                        </td>
                      )}
                      {!isDataEntry && (
                        <td className="px-2.5 py-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-md font-black text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
                            {c.totalWeight.toFixed(1)} كجم
                          </span>
                        </td>
                      )}
                      {!isDataEntry && (
                        <td className="px-2.5 py-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-md font-black text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 shadow-2xs">
                            {Math.round(c.totalAmount).toLocaleString()} د.ع
                          </span>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {filteredMonthlyOrdered.length > 0 && (
                <tfoot className={`font-black border-t-2 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-200/90 border-slate-300 text-slate-950'}`}>
                  <tr>
                    <td colSpan={5} className="px-2.5 py-2 font-black text-emerald-700 dark:text-emerald-300 text-xs">
                      {isDataEntry ? `إجمالي الزبائن أصحاب الفواتير: (${filteredMonthlyOrdered.length} زبون)` : `المجموع (${filteredMonthlyOrdered.length} زبون)`}
                    </td>
                    {!isDataEntry && (
                      <>
                        <td className="px-2.5 py-2 text-center font-black text-indigo-700 dark:text-indigo-300 text-xs">
                          {currentFilteredInvoices.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2 text-center font-black text-emerald-700 dark:text-emerald-300 text-xs">
                          {currentFilteredWeight.toFixed(1)} كجم
                        </td>
                        <td className="px-2.5 py-2 text-center font-black text-blue-700 dark:text-blue-300 text-xs">
                          {Math.round(currentFilteredAmount).toLocaleString()} د.ع
                        </td>
                      </>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {filteredMonthlyOrdered.length > 20 && (
            <div className="pt-2 flex justify-center">
              <button
                onClick={() => setMonthlyOrderedShowAll(!monthlyOrderedShowAll)}
                className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                  isDarkMode 
                    ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/60' 
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}
              >
                {monthlyOrderedShowAll ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span>عرض أقل (أول 20 زبون فقط)</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span>المزيد (+{filteredMonthlyOrdered.length - 20} زبون)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* SEPARATING LINE BETWEEN THE TWO REPORTS */}
        {/* ======================================================== */}
        <div className="relative py-2 flex items-center justify-center">
          <div className="w-full border-t border-dashed border-slate-300 dark:border-slate-700"></div>
          <div className="absolute bg-slate-100 dark:bg-slate-950 px-3 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black text-amber-600 dark:text-amber-400 border border-amber-500/40 shadow-xs flex items-center gap-1">
            <span>⚠️</span>
            <span>فاصل: زبائن لحد الان لم يتم طلب فاتورة لهم ({monthlyReportMonth})</span>
          </div>
        </div>

        {/* ======================================================== */}
        {/* TABLE 2: Customers with NO Orders this Month */}
        {/* ======================================================== */}
        <div className={`p-2.5 sm:p-3.5 rounded-xl border shadow-sm space-y-2.5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h4 className="text-xs sm:text-sm font-black text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <span>⚠️</span>
                <span>زبائن لحد الان لم يتم طلب فاتورة لهم ({monthlyReportMonth})</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
                  {filteredMonthlyUnordered.length} زبون
                </span>
              </h4>
              <p className="text-[10px] text-slate-500 font-bold">
                الزبائن المسجلون الذين لم يتم طلب أي فاتورة لهم ولا يملكون وزن أو مبلغ في الشهر الحالي
              </p>
            </div>

            {/* Export Excel Button */}
            <button
              onClick={exportMonthlyUnorderedExcel}
              disabled={filteredMonthlyUnordered.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 active:scale-95 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold shadow-sm transition-all cursor-pointer"
              title="تصدير قائمة الزبائن الذين لم يطلبوا كملف إكسل"
            >
              <Download className="w-3 h-3" />
              <span>تصدير الزبائن غير الطالبين (Excel)</span>
            </button>
          </div>

          {/* Filters Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div className="relative">
              <Search className="w-3 h-3 absolute right-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={monthlyUnorderedSearch}
                onChange={(e) => setMonthlyUnorderedSearch(e.target.value)}
                placeholder="بحث باسم الزبون، الكود، العنوان، أو المندوب..."
                className={`w-full pr-7 pl-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
              />
            </div>

            <select
              value={monthlyUnorderedDelegate}
              onChange={(e) => setMonthlyUnorderedDelegate(e.target.value)}
              className={`w-full py-1 px-2 rounded-lg border text-[11px] font-bold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              <option value="الكل">جميع المندوبين (الكل)</option>
              {delegateOptions.filter(d => d !== 'الكل').map((delName) => (
                <option key={`unordered-del-${delName}`} value={delName}>
                  {delName}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-800 shadow-xs">
            <table className="w-full min-w-[650px] text-[10px] sm:text-[11px] text-right whitespace-nowrap">
              <thead className={`font-black ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/90 text-slate-900 border-b border-slate-300'}`}>
                <tr>
                  <th className="px-2.5 py-2 text-center w-8">ت</th>
                  <th className="px-2.5 py-2">اسم الزبون</th>
                  <th className="px-2.5 py-2">كود الزبون</th>
                  <th className="px-2.5 py-2">عنوان الزبون</th>
                  <th className="px-2.5 py-2">اسم المندوب</th>
                  <th className="px-2.5 py-2 text-center">حالة الشهر</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-slate-200 bg-white text-slate-900'}`}>
                {filteredMonthlyUnordered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500 dark:text-slate-400 font-bold">
                      {monthlyUnorderedCustomers.length === 0
                        ? 'ممتاز! تم طلب فواتير لجميع الزبائن المسجلين في هذا الشهر 🎉'
                        : 'لا توجد نتائج تطابق معايير البحث الحالية.'}
                    </td>
                  </tr>
                ) : (
                  displayedMonthlyUnordered.map((r, idx) => (
                    <tr key={`unordered-${r.customerCode}-${idx}`} className="hover:bg-amber-50/40 dark:hover:bg-slate-800/60 transition-colors font-bold">
                      <td className="px-2.5 py-2 text-center font-bold text-slate-500 dark:text-slate-400">{idx + 1}</td>
                      <td className="px-2.5 py-2 font-black text-slate-900 dark:text-white text-xs">{r.customerName}</td>
                      <td className="px-2.5 py-2 font-mono text-[9px]">
                        <span className="px-1.5 py-0.5 rounded font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          {r.customerCode || '-'}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-slate-700 dark:text-slate-300 font-medium max-w-[170px] truncate" title={r.customerAddress}>{r.customerAddress || 'غير محدد'}</td>
                      <td className="px-2.5 py-2 font-extrabold text-slate-800 dark:text-slate-200">{r.delegateName || 'غير محدد'}</td>
                      <td className="px-2.5 py-2 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700 shadow-2xs">
                          <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                          لم يطلب
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredMonthlyUnordered.length > 0 && (
                <tfoot className={`font-black border-t-2 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-200/90 border-slate-300 text-slate-950'}`}>
                  <tr>
                    <td colSpan={5} className="px-2.5 py-2 font-black text-amber-700 dark:text-amber-300 text-xs">
                      مجموع الزبائن غير الطالبين ({filteredMonthlyUnordered.length} زبون)
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {filteredMonthlyUnordered.length > 20 && (
            <div className="pt-2 flex justify-center">
              <button
                onClick={() => setMonthlyUnorderedShowAll(!monthlyUnorderedShowAll)}
                className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                  isDarkMode 
                    ? 'bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-800/60' 
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {monthlyUnorderedShowAll ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span>عرض أقل (أول 20 زبون فقط)</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span>المزيد (+{filteredMonthlyUnordered.length - 20} زبون)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h2 className="text-emerald-800 dark:text-emerald-200 font-black text-lg mb-4 text-center">المسارات</h2>
      
      {/* Dashboard Widget */}
      {(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        const scheduledToday = filteredRoutes.length;
        const invoicesToday = new Set(salesEntries.filter(e => e.dateString === todayStr).map(e => e.customerCode)).size;

        return (
            <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="text-center">
                    <div className="text-[10px] font-bold text-slate-500 mb-1">زبائن اليوم</div>
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
            {finalRoutes.length === 0 ? (
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
              Object.entries(
                (searchQuery.trim() ? finalRoutes : finalRoutes.slice(0, displayLimit)).reduce((acc, r) => {
                  const day = r.path || 'غير مصنف';
                  if (!acc[day]) acc[day] = [];
                  acc[day].push(r);
                  return acc;
                }, {} as Record<string, RouteItem[]>)
              )
              .sort((a, b) => a[0].localeCompare(b[0])) // Sort paths (days) alphabetically
              .map(([day, dayRoutes]) => (
                <React.Fragment key={day}>
                  <tr>
                    <td colSpan={6} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                      {day}
                    </td>
                  </tr>
                  {dayRoutes.sort((a, b) => {
                    const aInvoices = getRouteItemInvoicesCount(a);
                    const bInvoices = getRouteItemInvoicesCount(b);
                    if (aInvoices !== bInvoices) return bInvoices - aInvoices;
                    return String(a.delegateCode || '').localeCompare(String(b.delegateCode || ''));
                  }).map(r => {
                    const customerEntries = allSalesEntries.filter(e => e.customerCode === r.customerCode);
                    const todayStr = new Date().toISOString().split('T')[0];
                    
                    const isSearching = searchQuery.trim().length > 0;
                    const hasOrderIn12Hours = allSalesEntries.some(e => String(e.customerCode) === String(r.customerCode) && (Date.now() - e.timestamp < 12 * 60 * 60 * 1000));
                    const isHidden = !isSearching && !currentUser?.isAdmin && hasOrderIn12Hours;
                    
                    const totalWeightToday = customerEntries.filter(e => e.dateString === todayStr).reduce((sum, e) => sum + e.totalWeightKg, 0);

                    if (isHidden) return null;

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
                              {!debts.some(d => String(d.customerCode) === String(r.customerCode)) && !completedDelegates[r.delegateName || ''] && (
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

      {/* Today's Orders Table */}
      <div className="mt-8">
            <h3 className="text-emerald-800 dark:text-emerald-200 font-black text-lg mb-4 text-center">طلبات اليوم للمندوبين</h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap">
                    <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                        <tr>
                            <th className="px-3 py-2 border-b dark:border-slate-700">اسم الزبون</th>
                            <th className="px-3 py-2 border-b dark:border-slate-700">كود الزبون</th>
                            <th className="px-3 py-2 border-b dark:border-slate-700">الوزن الكلي للفاتورة (كجم)</th>
                            <th className="px-3 py-2 border-b dark:border-slate-700">عنوان الزبون</th>
                        </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
                        {todayOrders.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="text-center py-6 text-slate-500 font-bold">لا توجد طلبات اليوم.</td>
                            </tr>
                        ) : (
                            todayOrders.map((order: any, idx: number) => (
                                <tr key={idx} onClick={() => handleRowClickOrder(order)} className={`cursor-pointer transition-all hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'} ${selectedInvoice?.customerCode === order.customerCode ? 'bg-red-100 dark:bg-red-900/30' : ''}`}>
                                    <td className="px-3 py-2">{order.customerName}</td>
                                    <td className="px-3 py-2">{order.customerCode}</td>
                                    <td className="px-3 py-2">{order.totalWeight.toFixed(2)}</td>
                                    <td className="px-3 py-2">{order.customerAddress}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
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

      {/* Invoice Details Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedInvoice(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-emerald-800 dark:text-emerald-200 mb-4">تفاصيل الفاتورة</h3>
            <div className="space-y-3 text-sm">
                <p className="flex items-center gap-2"><span className="font-bold text-slate-500">اسم الزبون:</span> {selectedInvoice.customerName}
                {selectedInvoice.customerPhone && (
                  <a href={`tel:${selectedInvoice.customerPhone}`} className="text-emerald-600 hover:text-emerald-500">
                    <Phone className="w-4 h-4" />
                  </a>
                )}</p>
                <p><span className="font-bold text-slate-500">كود الزبون:</span> {selectedInvoice.customerCode}</p>
                <p><span className="font-bold text-slate-500">الوزن الكلي:</span> {selectedInvoice.totalWeight.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} كجم</p>
                <p><span className="font-bold text-slate-500">مبلغ الفاتورة الكلي:</span> {selectedInvoice.totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                <p><span className="font-bold text-slate-500">العنوان:</span> {selectedInvoice.customerAddress}</p>
            </div>
            <button 
                onClick={() => setSelectedInvoice(null)}
                className="w-full mt-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors"
            >
                إغلاق
            </button>
          </div>
        </div>
      )}
      
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
                  <button 
                      onClick={() => {
                          const target = selectedDebt;
                          setSelectedDebt(null);
                          setPaymentModalDebt(target);
                          setPaymentAmountInput(target.amountDue.toString());
                      }}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                      <CreditCard className="w-4 h-4" />
                      <span>تسديد الدين</span>
                  </button>
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

      <div className="mt-8">
        {renderDebtsTable()}
      </div>

      {canViewMonthlyReports && (
        <div className="mt-10">
          {renderMonthlyCustomerReports()}
        </div>
      )}

    </div>
  );
};
