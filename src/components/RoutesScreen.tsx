import React, { useState, useEffect } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, updateDoc, doc } from 'firebase/firestore';
import { RouteItem } from '../types';
import { CheckCircle2, Circle, AlertCircle, ArrowUp } from 'lucide-react';

export const RoutesScreen: React.FC = () => {
  const { currentUser, delegatesList = [], isDarkMode, setPrefilledEntryData, setShowQuickAdd, setActiveTab, salesEntries, allSalesEntries, addToast } = useSales();
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});

  /*
  useEffect(() => {
    if (!currentUser || currentUser.isAdmin) return;
    
    const today = new Date().toISOString().split('T')[0];
    const currentDayName = new Date().toLocaleDateString('ar-EG', { weekday: 'long' });

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
    return () => unsub();
  }, []);
  const [routeFilterDelegate, setRouteFilterDelegate] = useState(currentUser?.isAdmin ? '' : currentUser?.name || '');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(20);

  useEffect(() => {
    const routesQ = query(collection(db, 'routes'));
    const unsubRoutes = onSnapshot(routesQ, (snap) => {
      const loaded: RouteItem[] = [];
      snap.forEach(d => loaded.push({ id: d.id, ...d.data() } as RouteItem));
      setRoutes(loaded);
    });
    return () => unsubRoutes();
  }, []);

  const currentDay = new Date().toLocaleDateString('ar-EG', { weekday: 'long' });
  const isCompleted = completedDelegates[currentUser?.name || ''] || false;

  const isVisited = (r: RouteItem) => {
    const customerEntries = allSalesEntries.filter(e => e.customerCode === r.customerCode);
    const todayStr = new Date().toISOString().split('T')[0];
    return customerEntries.some(e => e.dateString === todayStr);
  };

  const filteredRoutes = routes.filter(r => {
    if (currentUser?.isAdmin) {
       return (routeFilterDelegate ? r.delegateName.trim() === routeFilterDelegate.trim() : true) && 
              (routeFilterDay ? r.path?.includes(routeFilterDay) : true) &&
              (searchQuery ? r.customerName.includes(searchQuery) : true);
    } else {
       // Strict matching using delegateCode as the primary identifier
       const currentDelegateCode = String(currentUser?.delegateCode || '').trim();
       
       if (!currentDelegateCode) {
           // If delegate code is missing, do not show any routes
           return false;
       }

       return String(r.delegateCode || '').trim() === currentDelegateCode &&
              r.path?.includes(currentDay) &&
              (searchQuery ? r.customerName.includes(searchQuery) : true);
    }
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

  const finalRoutes = filteredRoutes;

  const handleRowClick = (r: RouteItem) => {
    setSelectedRowId(r.id);
  };

  const moveToTop = async (r: RouteItem) => {
    try {
      await updateDoc(doc(db, 'routes', r.id), { position: Date.now() });
      addToast({ message: 'تم تصعيد المحل للأعلى بنجاح', type: 'success' });
    } catch (e) {
      addToast({ message: 'حدث خطأ أثناء التصعيد', type: 'info' });
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
      
      {currentUser?.isAdmin && (
        <div className={`p-3 rounded-xl border flex flex-col sm:flex-row gap-2 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          <select value={routeFilterDelegate} onChange={e => setRouteFilterDelegate(e.target.value)} className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}>
            <option value="">كل المندوبين</option>
            {delegatesList.map(d => (
              <option key={d} value={d}>{d}</option>
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
          <input 
            type="text" 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)} 
            placeholder="بحث عن اسم محل..." 
            className={`flex-1 p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}
          />
        </div>
      )}
      
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap"><thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}><tr><th className="px-3 py-2 border-b dark:border-slate-700">الاسم ({finalRoutes.length})</th><th className="px-3 py-2 border-b dark:border-slate-700">العنوان</th><th className="px-3 py-2 border-b dark:border-slate-700">الكود</th><th className="px-3 py-2 border-b dark:border-slate-700">النوع</th><th className="px-3 py-2 border-b dark:border-slate-700">المسار</th><th className="px-3 py-2 border-b dark:border-slate-700">المندوب</th></tr></thead><tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
            {Object.entries(finalRoutes.slice(0, displayLimit).reduce((acc, r) => {
              const day = r.path || 'غير مصنف';
              if (!acc[day]) acc[day] = [];
              acc[day].push(r);
              return acc;
            }, {} as Record<string, RouteItem[]>))
            .sort((a, b) => a[0].localeCompare(b[0])) // Sort paths (days) alphabetically
            .map(([day, dayRoutes]) => (
              <React.Fragment key={day}>
                <tr>
                  <td colSpan={5} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                    {day}
                  </td>
                </tr>
                {dayRoutes.sort((a, b) => a.delegateName.localeCompare(b.delegateName)).map(r => { // Sort routes by delegate name
                  const customerEntries = allSalesEntries.filter(e => e.customerCode === r.customerCode);
                  const lastEntry = customerEntries.sort((a,b) => b.timestamp - a.timestamp)[0];
                  const todayStr = new Date().toISOString().split('T')[0];
                  
                  // The hiding logic is reactive because it depends on allSalesEntries,
                  // which comes from useSales() and causes a re-render when it updates.
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
                            <button 
                              onClick={(e) => { e.stopPropagation(); moveToTop(r); }} 
                              className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}
                              title="تصعيد للأعلى"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <span>{r.customerName}</span>
                            {totalWeightToday > 0 && (
                                <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-[9px] font-black">
                                    {totalWeightToday.toFixed(1)} كجم
                                </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">{r.customerAddress}</td>
                      <td className="px-3 py-2">{r.customerCode}</td>
                      <td className="px-3 py-2">{r.customerType}</td>
                      <td className="px-3 py-2">{r.path}</td>
                      <td className="px-3 py-2 text-[9px] text-slate-500">{r.delegateName}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
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

      {/* Recent Orders Summary Card */}
      <div className="mt-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <h3 className={`p-3 font-black text-sm ${isDarkMode ? 'bg-slate-700 text-slate-100' : 'bg-slate-100 text-slate-800'}`}>
          طلبات اليوم
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
              <tr>
                <th className="px-3 py-2">اسم الزبون</th>
                <th className="px-3 py-2">كود</th>
                <th className="px-3 py-2">الوزن (كجم)</th>
                <th className="px-3 py-2">العنوان</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
              {allSalesEntries
                .filter(e => Date.now() - e.timestamp < 12 * 60 * 60 * 1000)
                .reduce((acc, e) => {
                  const existing = acc.find(item => item.customerCode === e.customerCode);
                  if (existing) {
                    existing.totalWeightKg += e.totalWeightKg;
                  } else {
                    acc.push({ customerName: e.customerName, customerCode: e.customerCode, totalWeightKg: e.totalWeightKg, customerAddress: e.customerAddress, customerType: e.customerType });
                  }
                  return acc;
                }, [] as any[])
                .sort((a, b) => a.totalWeightKg - b.totalWeightKg)
                .map((item, idx) => (
                  <tr key={idx} className={`hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                    <td className="px-3 py-2">{item.customerName}</td>
                    <td className="px-3 py-2">{item.customerCode}</td>
                    <td className="px-3 py-2 font-mono">{item.totalWeightKg.toFixed(1)}</td>
                    <td className="px-3 py-2">{item.customerAddress}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
