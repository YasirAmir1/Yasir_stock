import React, { useState, useEffect, useMemo } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, updateDoc, doc, writeBatch, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { RouteItem, DebtItem } from '../types';
import { CheckCircle2, Circle, AlertCircle, ArrowUp, Upload, CheckSquare, Square, ShoppingBag, MapPin, Phone, User, CreditCard, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getFormattedWeekday } from '../utils/dateUtils';

export const RoutesScreen: React.FC = () => {
  const salesContext = useSales();
  const { currentUser, delegatesList = [], delegateAccounts = [], isDarkMode, setPrefilledEntryData, setShowQuickAdd, setActiveTab, salesEntries, allSalesEntries, addToast } = salesContext;
  const productsList = salesContext.productsList || [];

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
    });
    return () => unsubDebts();
  }, [currentUser]);
  
  const [selectedDebt, setSelectedDebt] = useState<DebtItem | null>(null);
  const [paymentModalDebt, setPaymentModalDebt] = useState<DebtItem | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [debtSearch, setDebtSearch] = useState('');

  const handleSavePayment = async () => {
    if (!paymentModalDebt) return;
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
          const filterLower = selectedDelegateFilter.toLowerCase();
          const targetAcc = delegateAccounts.find(
            a => (a.delegateCode && a.delegateCode.toLowerCase() === filterLower) ||
                 (a.username && a.username.toLowerCase() === filterLower) ||
                 (a.delegateName && a.delegateName.toLowerCase() === filterLower)
          );
          const matchCode = targetAcc?.delegateCode?.toLowerCase() || filterLower;
          const matchUser = targetAcc?.username?.toLowerCase() || filterLower;
          const matchName = targetAcc?.delegateName?.toLowerCase() || filterLower;

          result = result.filter(d => {
            const dCode = (d.delegateCode || '').toLowerCase();
            const dName = (d.delegateName || '').toLowerCase();
            return dCode === matchCode || dCode === matchUser || dCode === filterLower ||
                   dName === matchName || dName === matchUser || dName === filterLower;
          });
      }
      return result.filter(d => {
          const searchLower = debtSearch.toLowerCase();
          const delegateName = delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || d.delegateCode || '';
          return (d.customerName || '').toLowerCase().includes(searchLower) ||
                 (d.customerCode || '').toLowerCase().includes(searchLower) ||
                 delegateName.toLowerCase().includes(searchLower) ||
                 (d.invoiceDate || '').toLowerCase().includes(searchLower) ||
                 (d.paymentDueDate || '').toLowerCase().includes(searchLower);
      });
  }, [debts, debtSearch, selectedDelegateFilter, delegateAccounts]);

  const exportDebtsToExcel = () => {
      const worksheet = XLSX.utils.json_to_sheet(debts.map(d => ({
          'اسم الزبون': d.customerName,
          'كود الزبون': d.customerCode,
          'المبلغ': d.amountDue,
          'كود المندوب': d.delegateCode,
          'اسم المندوب': delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || '',
          'تاريخ الفاتورة': d.invoiceDate,
          'تاريخ السداد': d.paymentDueDate
      })));
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

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[700px] text-[9px] sm:text-[10px] text-right whitespace-nowrap">
            <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
              <tr>
                {currentUser?.isAdmin && <th className="px-2 py-2 border-b dark:border-slate-700">المندوب</th>}
                <th className="px-2 py-2 border-b dark:border-slate-700">الاسم</th>
                <th className="px-2 py-2 border-b dark:border-slate-700">الكود</th>
                <th className="px-2 py-2 border-b dark:border-slate-700">المبلغ</th>
                <th className="px-2 py-2 border-b dark:border-slate-700">ت. الفاتورة</th>
                <th className="px-2 py-2 border-b dark:border-slate-700">ت. السداد</th>
                <th className="px-2 py-2 border-b dark:border-slate-700">مستحقة</th>
                <th className="px-2 py-2 border-b dark:border-slate-700">باقي</th>
                <th className="px-2 py-2 border-b dark:border-slate-700">تسديد</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
              {filteredDebts.sort((a,b) => new Date(a.paymentDueDate).getTime() - new Date(b.paymentDueDate).getTime()).map(d => {
                const invDate = new Date(d.invoiceDate || Date.now());
                const payDate = new Date(d.paymentDueDate || Date.now());
                const now = new Date();
                const msPerDay = 1000 * 3600 * 24;
                
                const diffInDays = Math.round((payDate.getTime() - now.getTime()) / msPerDay);
                
                const mustahaqa = payDate.getTime() > now.getTime() ? 0 : diffInDays;
                const baqia = now.getTime() > payDate.getTime() ? 0 : diffInDays;
                
                const daysOld = Math.round((now.getTime() - invDate.getTime()) / msPerDay);
                const isOldDebt = daysOld > 11;

                const isRed = diffInDays <= 1;
                const isGreen = diffInDays > 5;
                const rowBgClass = isRed ? 'bg-red-100 dark:bg-red-900/30' : isGreen ? 'bg-emerald-100 dark:bg-emerald-900/30' : '';
                
                const handlePay = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setPaymentModalDebt(d);
                    setPaymentAmountInput(d.amountDue.toString());
                };

                return (
                  <tr key={d.id} className={`${rowBgClass} hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'} cursor-pointer`} onClick={() => setSelectedDebt(d)}>
                    {currentUser?.isAdmin && (
                        <td className="px-2 py-2 flex items-center gap-1">
                            {delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || d.delegateCode}
                            {isOldDebt && <span className="text-[8px] bg-amber-500 text-white px-1 rounded-full">قديم</span>}
                        </td>
                    )}
                    <td className="px-2 py-2">{d.customerName}</td>
                    <td className="px-2 py-2">{d.customerCode}</td>
                    <td className="px-2 py-2">{d.amountDue.toLocaleString()}</td>
                    <td className="px-2 py-2">{d.invoiceDate}</td>
                    <td className="px-2 py-2">{d.paymentDueDate}</td>
                    <td className="px-2 py-2 text-center">{mustahaqa}</td>
                    <td className="px-2 py-2 text-center">{baqia}</td>
                    <td className="px-2 py-2">
                        <button onClick={handlePay} className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[9px] font-bold">تسديد</button>
                    </td>
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
    const q = query(collection(db, 'daily_sales_completion'), where('date', '==', today));
    const unsub = onSnapshot(q, (snap) => {
      const completed: Record<string, boolean> = {};
      snap.forEach(d => {
        completed[d.id] = true;
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

  const [routeFilterDelegate, setRouteFilterDelegate] = useState(currentUser?.isAdmin ? '' : currentUser?.delegateCode || '');
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
    
    let routesQ;
    if (currentUser.isAdmin) {
        routesQ = query(collection(db, 'routes'));
    } else {
        const delegateName = String(currentUser.name || '').trim();
        
        if (delegateName) {
            routesQ = query(collection(db, 'routes'), where('delegateName', '==', delegateName));
        } else {
            setRoutes([]);
            return;
        }
    }

    const unsubRoutes = onSnapshot(routesQ, (snap) => {
      const loaded: RouteItem[] = [];
      snap.forEach(d => loaded.push({ id: d.id, ...d.data() } as RouteItem));
      setRoutes(loaded);
    });
    return () => unsubRoutes();
  }, [currentUser]);

  const currentDay = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(new Date());
  const isCompleted = completedDelegates[currentUser?.name || ''] || false;

  const isVisited = React.useCallback((r: RouteItem) => {
    const customerEntries = allSalesEntries.filter(e => e.customerCode === r.customerCode);
    const todayStr = new Date().toISOString().split('T')[0];
    const hasSale = customerEntries.some(e => e.dateString === todayStr);
    return hasSale || !!manualVisits[r.customerCode];
  }, [allSalesEntries, manualVisits]);

  const filteredRoutes = useMemo(() => {
    return routes.filter(r => {
      // Delegate matching for Admin
      let delegateMatch = true;
      if (currentUser?.isAdmin && routeFilterDelegate) {
        const filterVal = routeFilterDelegate.trim().toLowerCase();
        
        const matchedAccount = delegateAccounts.find(
          a => (a.delegateCode && a.delegateCode.toLowerCase() === filterVal) ||
               (a.username && a.username.toLowerCase() === filterVal) ||
               (a.delegateName && a.delegateName.trim().toLowerCase() === filterVal)
        );

        const rDelegateName = String(r.delegateName || '').trim().toLowerCase();
        const rDelegateCode = String(r.delegateCode || '').trim().toLowerCase();

        const matchCode = matchedAccount?.delegateCode?.toLowerCase() || '';
        const matchName = matchedAccount?.delegateName?.trim().toLowerCase() || '';
        const matchUser = matchedAccount?.username?.toLowerCase() || '';

        delegateMatch = 
          (rDelegateName !== '' && (
            rDelegateName === filterVal ||
            (matchName !== '' && rDelegateName === matchName) ||
            (matchUser !== '' && rDelegateName === matchUser) ||
            rDelegateName.includes(filterVal)
          )) ||
          (rDelegateCode !== '' && (
            rDelegateCode === filterVal ||
            (matchCode !== '' && rDelegateCode === matchCode) ||
            (matchUser !== '' && rDelegateCode === matchUser)
          ));
      }

      const dayMatch = currentUser?.isAdmin
          ? (routeFilterDay ? r.path?.includes(routeFilterDay) : true)
          : r.path?.includes(currentDay);

      const searchMatch = searchQuery 
        ? ((r.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
           (r.delegateName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
           (r.customerCode || '').toLowerCase().includes(searchQuery.toLowerCase()))
        : true;

      return delegateMatch && dayMatch && searchMatch;
    }).sort((a, b) => {
      // Primary: Position (descending, latest moved to top)
      const aPos = a.position || 0;
      const bPos = b.position || 0;
      if (aPos !== bPos) return bPos - aPos;

      // Secondary: Visited
      const aVisited = isVisited(a);
      const bVisited = isVisited(b);
      if (aVisited === bVisited) return 0;
      // Unvisited (false) should come before Visited (true)
      return aVisited ? 1 : -1;
    });
  }, [routes, currentUser, routeFilterDelegate, delegateAccounts, routeFilterDay, currentDay, searchQuery, isVisited]);

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
  if (!currentUser?.isAdmin && !effectiveDelegateCode) {
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
      <div className={`p-3 rounded-xl border flex flex-col sm:flex-row gap-2 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          <input 
            type="text" 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)} 
            placeholder="بحث عن زبون..." 
            className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}
          />
          {currentUser?.isAdmin && (
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
      
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap"><thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}><tr><th className="px-3 py-2 border-b dark:border-slate-700">كود الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">اسم الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">العنوان</th><th className="px-3 py-2 border-b dark:border-slate-700">المسار</th><th className="px-3 py-2 border-b dark:border-slate-700">نوع الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">اسم المندوب</th></tr></thead><tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
            {finalRoutes.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-500 font-bold">لا توجد محلات مجدولة لهذا اليوم.</td>
              </tr>
            ) : (
              Object.entries(finalRoutes.slice(0, displayLimit).reduce((acc, r) => {
                const day = r.path || 'غير مصنف';
                if (!acc[day]) acc[day] = [];
                acc[day].push(r);
                return acc;
              }, {} as Record<string, RouteItem[]>))
              .sort((a, b) => a[0].localeCompare(b[0])) // Sort paths (days) alphabetically
              .map(([day, dayRoutes]) => (
                <React.Fragment key={day}>
                  <tr>
                    <td colSpan={6} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                      {day}
                    </td>
                  </tr>
                  {dayRoutes.sort((a, b) => String(a.delegateCode || '').localeCompare(String(b.delegateCode || ''))).map(r => { // Sort routes by delegate code
                    const customerEntries = allSalesEntries.filter(e => e.customerCode === r.customerCode);
                    const todayStr = new Date().toISOString().split('T')[0];
                    
                    const isHidden = allSalesEntries.some(e => String(e.customerCode) === String(r.customerCode) && (Date.now() - e.timestamp < 12 * 60 * 60 * 1000));
                    const hasOrderIn12Hours = allSalesEntries.some(e => String(e.customerCode) === String(r.customerCode) && (Date.now() - e.timestamp < 12 * 60 * 60 * 1000));
                    
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
      {displayLimit < filteredRoutes.length && (
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
            </div>
            <div className="flex gap-2 pt-2">
                <button 
                    onClick={() => setSelectedDebt(null)}
                    className="flex-1 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition-colors cursor-pointer"
                >
                    إغلاق
                </button>
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
            </div>
          </div>
        </div>
      )}

      {/* Debt Settlement Modal (Centered with Blurred Backdrop) */}
      {paymentModalDebt && (
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

    </div>
  );
};
