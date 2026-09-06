import React, { useState, useEffect } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { RouteItem } from '../types';

export const RoutesScreen: React.FC = () => {
  const { currentUser, delegatesList = [], isDarkMode, setPrefilledEntryData, setShowQuickAdd, setActiveTab } = useSales();
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [routeFilterDelegate, setRouteFilterDelegate] = useState(currentUser?.isAdmin ? '' : currentUser?.name || '');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

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
  });

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
              <th className="px-3 py-2 border-b dark:border-slate-700">الكود</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">النوع</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">الاسم ({filteredRoutes.length})</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">العنوان</th>
              <th className="px-3 py-2 border-b dark:border-slate-700">المسار</th>
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
                  <td colSpan={5} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                    {day}
                  </td>
                </tr>
                {dayRoutes.map(r => (
                  <tr 
                    key={r.id} 
                    onClick={() => handleRowClick(r)}
                    className={`cursor-pointer transition-all ${selectedRowId === r.id ? 'bg-red-100 font-black' : `hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}`}
                  >
                    <td className="px-3 py-2">{r.customerCode}</td>
                    <td className="px-3 py-2">{r.customerType}</td>
                    <td className={`px-3 py-2 ${selectedRowId === r.id ? 'text-red-700 font-black' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span>{r.customerName}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOrderClick(r);
                          }}
                          className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[9px] font-black hover:bg-emerald-500"
                        >
                          طلب
                        </button>
                      </div>
                    </td>
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
  );
};
