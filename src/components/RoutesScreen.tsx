import React, { useState, useEffect } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { RouteItem } from '../types';
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';

export const RoutesScreen: React.FC = () => {
  const { currentUser, delegatesList = [], isDarkMode, setPrefilledEntryData, setShowQuickAdd, setActiveTab, salesEntries, addToast } = useSales();
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [hideVisited, setHideVisited] = useState(false);

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

  const isVisited = (r: RouteItem) => {
    const customerEntries = salesEntries.filter(e => e.customerCode === r.customerCode);
    const todayStr = new Date().toISOString().split('T')[0];
    return customerEntries.some(e => e.dateString === todayStr);
  };

  const filteredRoutes = routes.filter(r => {
    if (currentUser?.isAdmin) {
       return (routeFilterDelegate ? r.delegateName.trim() === routeFilterDelegate.trim() : true) && 
              (routeFilterDay ? r.path?.includes(routeFilterDay) : true) &&
              (searchQuery ? r.customerName.includes(searchQuery) : true);
    } else {
       return r.delegateName.trim() === currentUser?.name.trim() &&
              r.path?.includes(currentDay) &&
              (searchQuery ? r.customerName.includes(searchQuery) : true);
    }
  }).sort((a, b) => {
    const aVisited = isVisited(a);
    const bVisited = isVisited(b);
    if (aVisited === bVisited) return 0;
    // Unvisited (false) should come before Visited (true)
    return aVisited ? 1 : -1;
  });

  const finalRoutes = hideVisited ? filteredRoutes.filter(r => !isVisited(r)) : filteredRoutes;

  const handleRowClick = (r: RouteItem) => {
    setSelectedRowId(r.id);
  };

  const handleOrderClick = (r: RouteItem) => {
    setSelectedRowId(r.id);
    setPrefilledEntryData({
      customerCode: r.customerCode,
      customerName: r.customerName,
      customerAddress: r.customerAddress,
      customerType: r.customerType
    });
    setShowQuickAdd(true);
    setActiveTab('products');
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h2 className="text-emerald-800 dark:text-emerald-200 font-black text-lg mb-4 text-center">المسارات</h2>
      
      {/* Summary Card */}
      {(() => {
        const visitedCount = filteredRoutes.filter(isVisited).length;
        const totalCount = filteredRoutes.length;
        const remainingCount = totalCount - visitedCount;

        return (
          <div className={`grid grid-cols-3 gap-2 p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
            <div className="text-center p-2 rounded-lg bg-slate-100 dark:bg-slate-900">
                <div className="text-[10px] sm:text-xs font-bold text-slate-500 mb-1">إجمالي المسار</div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{totalCount}</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                <div className="text-[10px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">تمت الزيارة</div>
                <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">{visitedCount}</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20">
                <div className="text-[10px] sm:text-xs font-bold text-orange-600 dark:text-orange-400 mb-1">متبقي</div>
                <div className="text-xl sm:text-2xl font-black text-orange-600 dark:text-orange-400">{remainingCount}</div>
            </div>
          </div>
        );
      })()}

      <div className={`p-3 rounded-xl border flex flex-col sm:flex-row gap-2 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          <button 
            onClick={() => setHideVisited(!hideVisited)}
            className={`p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'} ${hideVisited ? 'bg-emerald-600 text-white' : ''}`}
          >
            {hideVisited ? 'إظهار الكل' : 'إخفاء المزار' }
          </button>
      </div>

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
        <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap">
          <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
            <tr>
              <th className="px-3 py-2 border-b dark:border-slate-700">الاسم ({finalRoutes.length})</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">العنوان</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">الكود</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">النوع</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">المسار</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
            {Object.entries(finalRoutes.slice(0, displayLimit).reduce((acc, r) => {
              const day = r.path || 'غير مصنف';
              if (!acc[day]) acc[day] = [];
              acc[day].push(r);
              return acc;
            }, {} as Record<string, RouteItem[]>)).map(([day, dayRoutes]) => (
              <React.Fragment key={day}>
                <tr>
                  <td colSpan={5} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                    {day}
                  </td>
                </tr>
                {dayRoutes.map(r => {
                  const customerEntries = salesEntries.filter(e => e.customerCode === r.customerCode);
                  const lastEntry = customerEntries.sort((a,b) => b.timestamp - a.timestamp)[0];
                  const todayStr = new Date().toISOString().split('T')[0];
                  const isVisitedToday = lastEntry && lastEntry.dateString === todayStr;
                  const totalWeightToday = customerEntries.filter(e => e.dateString === todayStr).reduce((sum, e) => sum + e.totalWeightKg, 0);
                  
                  const statusIcon = isVisitedToday 
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    : <Circle className="w-5 h-5 text-slate-400" />;

                  const daysSinceLastVisit = lastEntry ? Math.floor((new Date().getTime() - lastEntry.timestamp) / (1000 * 60 * 60 * 24)) : 999;
                  
                  return (
                    <tr 
                      key={r.id} 
                      onClick={() => handleRowClick(r)}
                      className={`cursor-pointer transition-all ${isVisitedToday ? (isDarkMode ? 'bg-emerald-900/30' : 'bg-emerald-100') : selectedRowId === r.id ? 'bg-red-100 font-black' : `hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}`}
                    >
                      <td className={`px-3 py-2 ${selectedRowId === r.id ? 'text-red-700 font-black' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            {statusIcon}
                            <span>{r.customerName}</span>
                            {totalWeightToday > 0 && (
                                <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-[9px] font-black">
                                    {totalWeightToday.toFixed(1)} كجم
                                </span>
                            )}
                            {daysSinceLastVisit > 3 && (
                                <span className="flex items-center justify-center w-5 h-5 bg-red-600 text-white rounded-full text-[8px] font-black">
                                    {daysSinceLastVisit}
                                </span>
                            )}
                          </div>
                          {!isVisitedToday && !(completedDelegates[currentUser?.name || ''] || false) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOrderClick(r);
                              }}
                              className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[9px] font-black hover:bg-emerald-500"
                            >
                              طلب
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">{r.customerAddress}</td>
                      <td className="px-3 py-2">{r.customerCode}</td>
                      <td className="px-3 py-2">{r.customerType}</td>
                      <td className="px-3 py-2">{r.path}</td>
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
    </div>
  );
};
