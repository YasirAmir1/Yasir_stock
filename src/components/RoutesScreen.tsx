import React, { useState, useEffect, useMemo } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, updateDoc, doc, writeBatch, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { RouteItem } from '../types';
import { CheckCircle2, Circle, AlertCircle, ArrowUp, Upload, CheckSquare, Square, ShoppingBag, MapPin, Phone, User } from 'lucide-react';
import * as XLSX from 'xlsx';

export const RoutesScreen: React.FC = () => {
  const { currentUser, delegatesList = [], isDarkMode, setPrefilledEntryData, setShowQuickAdd, setActiveTab, salesEntries, allSalesEntries, addToast } = useSales();
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [manualVisits, setManualVisits] = useState<Record<string, boolean>>({});

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
    
    // Load manual visits
    const delegateCode = String(currentUser?.delegateCode || '').trim();
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
  const [displayLimit, setDisplayLimit] = useState(20);

  useEffect(() => {
    if (!currentUser) return;
    
    let routesQ;
    if (currentUser.isAdmin) {
        routesQ = query(collection(db, 'routes'));
    } else {
        const delegateCode = String(currentUser.delegateCode || '').trim();
        if (!delegateCode) {
            setRoutes([]);
            return;
        }
        routesQ = query(collection(db, 'routes'), where('delegateCode', '==', delegateCode));
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
      // Delegate matching is now handled by the Firestore query for non-admins
      const dayMatch = currentUser?.isAdmin
          ? (routeFilterDay ? r.path?.includes(routeFilterDay) : true)
          : r.path?.includes(currentDay);

      const searchMatch = searchQuery ? (r.customerName?.includes(searchQuery) || r.delegateName?.includes(searchQuery)) : true;

      return dayMatch && searchMatch;
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
  }, [routes, currentUser, routeFilterDay, currentDay, searchQuery, isVisited]);

  const finalRoutes = filteredRoutes;

  if (!currentUser?.isAdmin && !currentUser?.delegateCode) {
      return (
          <div className="text-center py-10">
            <AlertCircle className="w-12 h-12 mx-auto text-amber-500 mb-2" />
            <p className="text-slate-600 dark:text-slate-400 font-bold">لا يتوفر كود مندوب لهذا المستخدم.</p>
          </div>
      );
  }

  const toggleVisit = async (r: RouteItem) => {
    const today = new Date().toISOString().split('T')[0];
    const delegateCode = String(currentUser?.delegateCode || '').trim();
    if (!delegateCode) return;

    const docId = `${delegateCode}_${today}_${r.customerCode}`;
    const docRef = doc(db, 'daily_visits', docId);

    if (manualVisits[r.customerCode]) {
        // Remove visit
        await deleteDoc(docRef);
        addToast({ message: 'تم إلغاء الزيارة', type: 'info' });
    } else {
        // Add visit
        await setDoc(docRef, {
            date: today,
            delegateCode,
            customerCode: r.customerCode
        });
        addToast({ message: 'تم تسجيل الزيارة', type: 'success' });
    }
  };

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
      addToast({ message: 'تم استيراد المسارات بنجاح ✅', type: 'success' });
    } catch (e) {
      console.error('Error importing routes:', e);
      addToast({ message: 'فشل استيراد المسارات.', type: 'info' });
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h2 className="text-emerald-800 dark:text-emerald-200 font-black text-lg mb-4 text-center">المسارات</h2>
      
      {currentUser?.isAdmin && (
        <div className="flex justify-center mb-4">
          <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold cursor-pointer">
            <Upload className="w-4 h-4" />
            رفع المسار
            <input type="file" accept=".xlsx, .xls" onChange={handleUploadRoutes} className="hidden" />
          </label>
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
            {delegatesList && delegatesList.length > 0 ? (
              delegatesList.map(d => (
                <option key={d.delegateCode} value={d.delegateCode}>{d.delegateName}</option>
              ))
            ) : (
              <option disabled>لا يوجد مندوبون</option>
            )}
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
        <table className="w-full text-[10px] sm:text-xs text-right whitespace-nowrap"><thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}><tr><th className="px-3 py-2 border-b dark:border-slate-700">كود الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">اسم الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">العنوان</th><th className="px-3 py-2 border-b dark:border-slate-700">المسار</th><th className="px-3 py-2 border-b dark:border-slate-700">نوع الزبون</th><th className="px-3 py-2 border-b dark:border-slate-700">كود المندوب</th><th className="px-3 py-2 border-b dark:border-slate-700">اسم المندوب</th></tr></thead><tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
            {finalRoutes.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-500 font-bold">لا توجد محلات مجدولة لهذا اليوم.</td>
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
                    <td colSpan={7} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'} flex items-center justify-between`}>
                      {day}
                      <button 
                        onClick={() => {
                          const addresses = dayRoutes.map(r => encodeURIComponent(r.customerAddress)).join('|');
                          window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dayRoutes[0]?.customerAddress || '')}&waypoints=${addresses}`, '_blank');
                        }}
                        className="p-1 bg-emerald-600 text-white rounded-full"
                      >
                        <MapPin className="w-4 h-4" />
                      </button>
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
                              <button 
                                onClick={(e) => { e.stopPropagation(); moveToTop(r); }} 
                                className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}
                                title="تصعيد للأعلى"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); toggleVisit(r); }}
                                className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${isVisited(r) ? 'text-emerald-500' : 'text-slate-400'}`}
                                title="تبديل حالة الزيارة"
                              >
                                {isVisited(r) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleOrderClick(r); }}
                                className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-600`}
                                title="طلب جديد"
                              >
                                <ShoppingBag className="w-4 h-4" />
                              </button>
                              
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
                        <td className="px-3 py-2">{r.delegateCode}</td>
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
