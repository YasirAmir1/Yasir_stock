import React, { useState, useMemo, useEffect } from 'react';
import { useSales, DEFAULT_CATEGORIES_LIST } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, doc, setDoc } from 'firebase/firestore';
import { formatWithCommas, parseArabicDigits } from '../utils/numberUtils';
import { Award, RotateCcw, AlertTriangle, Shield, Check, Filter, Calendar, TrendingUp, Pencil, Trash2, X, Package } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { PullToRefresh } from './PullToRefresh';

// --- Daily Admin Report Component ---
const DailyAdminReport: React.FC<{ salesEntries: any[], productsList: any[], currentUser: any }> = ({ salesEntries, productsList, currentUser }) => {
  const today = new Date().toISOString().split('T')[0];
  const entriesToday = salesEntries.filter(e => e.dateString === today);
  
  const getDelegateSales = (priceMode: 'retail' | 'wholesale') => {
    const data: Record<string, { count: number, weight: number, amount: number }> = {};
    
    entriesToday.forEach(e => {
        if (e.priceMode !== priceMode) return;
        
        const prod = productsList.find(p => p.productName === e.productName);
        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
        
        if (!data[e.delegateName]) {
            data[e.delegateName] = { count: 0, weight: 0, amount: 0 };
        }
        
        // Simplified approach: just count entries for now as invoice grouping is complex.
    });
    return data;
  };

  // Re-thinking invoice counting:
  const getGroupedSales = (priceMode: 'retail' | 'wholesale') => {
      const grouped = entriesToday.filter(e => e.priceMode === priceMode);
      const delegates: Record<string, { invoices: Set<string>, weight: number, amount: number }> = {};
      
      grouped.forEach(e => {
          const invId = e.invoiceId || e.id;
          if (!delegates[e.delegateName]) {
              delegates[e.delegateName] = { invoices: new Set(), weight: 0, amount: 0 };
          }
          delegates[e.delegateName].invoices.add(invId);
          delegates[e.delegateName].weight += (e.totalWeightKg || 0);
          
          const prod = productsList.find(p => p.productName === e.productName);
          const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
          delegates[e.delegateName].amount += (price * (e.quantity || 0));
      });
      
      return Object.entries(delegates).map(([name, data]) => ({
          name,
          count: data.invoices.size,
          weight: data.weight,
          amount: data.amount
      }));
  };

  const retailSales = getGroupedSales('retail');
  const wholesaleSales = getGroupedSales('wholesale');

  return (
    <div className="space-y-4 p-4">
        {/* Retail Sales Table */}
        <div className="bg-slate-800 rounded-xl p-4 text-white">
            <h3 className="font-bold mb-2">جدول مبيعات المفرد (لليوم)</h3>
            <table className="w-full text-xs text-center border-collapse">
                <thead>
                    <tr className="border-b border-slate-600 text-slate-400">
                        <th className="p-2">المندوب</th>
                        <th className="p-2">عدد الفواتير</th>
                        <th className="p-2">الوزن (كجم)</th>
                        <th className="p-2">المبلغ</th>
                    </tr>
                </thead>
                <tbody>
                    {retailSales.map(s => (
                        <tr key={s.name} className="border-b border-slate-700">
                            <td className="p-2">{s.name}</td>
                            <td className="p-2">{s.count}</td>
                            <td className="p-2">{s.weight.toFixed(1)}</td>
                            <td className="p-2">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {/* Wholesale Sales Table */}
        <div className="bg-slate-800 rounded-xl p-4 text-white">
            <h3 className="font-bold mb-2">جدول مبيعات الجملة (لليوم)</h3>
            <table className="w-full text-xs text-center border-collapse">
                <thead>
                    <tr className="border-b border-slate-600 text-slate-400">
                        <th className="p-2">المندوب</th>
                        <th className="p-2">عدد الفواتير</th>
                        <th className="p-2">الوزن (كجم)</th>
                        <th className="p-2">المبلغ</th>
                    </tr>
                </thead>
                <tbody>
                    {wholesaleSales.map(s => (
                        <tr key={s.name} className="border-b border-slate-700">
                            <td className="p-2">{s.name}</td>
                            <td className="p-2">{s.count}</td>
                            <td className="p-2">{s.weight.toFixed(1)}</td>
                            <td className="p-2">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {/* Specific Categories Sales Table */}
        {currentUser.isAdmin && (
        <div className="bg-indigo-900 rounded-xl p-4 text-white">
            <h3 className="font-bold mb-2">مبيعات أصناف مختارة (مفرد/جملة)</h3>
            <table className="w-full text-xs text-center border-collapse">
                <thead>
                    <tr className="border-b border-indigo-700 text-indigo-300">
                        <th className="p-2" rowSpan={2}>الصنف</th>
                        <th className="p-2" colSpan={2}>مفرد</th>
                        <th className="p-2" colSpan={2}>جملة</th>
                    </tr>
                    <tr className="border-b border-indigo-700 text-indigo-400">
                        <th className="p-1">وزن</th>
                        <th className="p-1">مبلغ</th>
                        <th className="p-1">وزن</th>
                        <th className="p-1">مبلغ</th>
                    </tr>
                </thead>
                <tbody>
                    {['صوصج', 'مقرمش', 'جبن بيتزا', 'بيتزا جاهز وبركر ومقرمش', 'خضراوات مجمدة و فنكر'].map(catName => {
                        const getStats = (mode: 'retail' | 'wholesale') => {
                            const entries = entriesToday.filter(e => e.categoryName === catName && e.priceMode === mode);
                            const weight = entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                            const amount = entries.reduce((sum, e) => {
                                const prod = productsList.find(p => p.productName === e.productName);
                                const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                                return sum + (price * e.quantity);
                            }, 0);
                            return { weight, amount };
                        };

                        const retail = getStats('retail');
                        const wholesale = getStats('wholesale');

                        return (
                            <tr key={catName} className="border-b border-indigo-800">
                                <td className="p-2 font-bold">{catName}</td>
                                <td className="p-2">{retail.weight.toFixed(1)}</td>
                                <td className="p-2">{formatWithCommas(retail.amount, true)}</td>
                                <td className="p-2">{wholesale.weight.toFixed(1)}</td>
                                <td className="p-2">{formatWithCommas(wholesale.amount, true)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
        )}
    </div>
  );
};

export const ReportsScreen: React.FC = () => {
  // Added state for Sales History move
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [savedEntriesFilterDelegate, setSavedEntriesFilterDelegate] = useState<string>('الكل');
  const [savedEntriesFilterPriceMode, setSavedEntriesFilterPriceMode] = useState<'الكل' | 'retail' | 'wholesale'>('الكل');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<{
    productName: string;
    categoryName: string;
    quantity: string;
    pieceWeightKg: string;
  }>({
    productName: '',
    categoryName: '',
    quantity: '0',
    pieceWeightKg: '0',
  });

  const {
    currentUser,
    selectedDelegate,
    setSelectedDelegate,
    categoryReports,
    delegatesList,
    selectedDate,
    setSelectedDate,
    dailyEvaluationsHistory,
    salesEntries,
    delegateTargets,
    syncData,
    updateSalesEntry,
    deleteSalesEntry,
    setUserMessage,
    isDarkMode, // Added
    productsList, // Added
  } = useSales();

  const [showCompletionConfirmModal, setShowCompletionConfirmModal] = useState(false);
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});

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

  const getProductCode = (productName: string) => {
    const p = productsList.find(p => p.productName === productName);
    return p ? p.productCode : '000';
  };

  const handleStartEdit = (entry: any) => {
    setEditingEntryId(entry.id);
    setEditFormData({
      productName: entry.productName,
      categoryName: entry.categoryName,
      quantity: String(entry.quantity),
      pieceWeightKg: String(Math.round(entry.pieceWeightKg * 1000)),
    });
  };

  const handleSaveEdit = (id: string) => {
    const q = parseInt(parseArabicDigits(editFormData.quantity), 10) || 0;
    const wGrams = parseFloat(parseArabicDigits(editFormData.pieceWeightKg)) || 0;
    
    updateSalesEntry(id, {
      productName: editFormData.productName.trim(),
      categoryName: editFormData.categoryName,
      quantity: q,
      pieceWeightKg: wGrams / 1000,
      totalWeightKg: (q * wGrams) / 1000,
    });
    setEditingEntryId(null);
  };

  // Date Range state for custom period reports
  const [startDate, setStartDate] = useState<string>(selectedDate);
  const [endDate, setEndDate] = useState<string>(selectedDate);
  const [useRange, setUseRange] = useState<boolean>(false);

  // Filter saved entries for today
  const todayStr = new Date().toISOString().split('T')[0];
  const todaysEntries = salesEntries.filter(e => e.dateString === todayStr);
  const uniqueCustomerNames = Array.from(new Set(todaysEntries.map(e => e.customerName).filter(Boolean))).sort();
  const achievedCategories = useMemo(() => {
    return categoryReports.filter((r) => r.isAchieved && r.dailyTargetWeightKg > 0);
  }, [categoryReports]);

  // Overall totals
  const activeDelegateName = currentUser.isAdmin ? selectedDelegate : currentUser.name;

  const { modalTotalWeight, modalTotalPrice } = useMemo(() => {
    const delegateEntries = salesEntries.filter(e => e.delegateName === activeDelegateName && e.dateString === new Date().toISOString().split('T')[0]);
    const weight = delegateEntries.reduce((sum, e) => sum + e.totalWeightKg, 0);
    const price = delegateEntries.reduce((sum, e) => {
      const prod = productsList.find(p => p.productName === e.productName);
      const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
      return sum + (price * e.quantity);
    }, 0);
    return { modalTotalWeight: weight, modalTotalPrice: price };
  }, [salesEntries, activeDelegateName, productsList]);

  const handleConfirmCompletion = async () => {
    const today = new Date().toISOString().split('T')[0];
    await setDoc(doc(db, 'daily_sales_completion', activeDelegateName || 'عام'), {
      delegate: activeDelegateName,
      date: today,
      completedAt: new Date().toISOString(),
    });
    setUserMessage('تم إكمال مبيعات اليوم بنجاح! ✅');
    setShowCompletionConfirmModal(false);
  };

  // Filter sales entries and evaluations for Date Range if enabled
  const rangeFilteredSales = useMemo(() => {
    if (!useRange) {
      return salesEntries.filter((e) => e.dateString === selectedDate);
    }
    return salesEntries.filter((e) => e.dateString && e.dateString >= startDate && e.dateString <= endDate);
  }, [salesEntries, useRange, selectedDate, startDate, endDate]);

  const rangeFilteredDailyEvals = useMemo(() => {
    if (!useRange) {
      return dailyEvaluationsHistory.filter((r) => r.dateString === selectedDate);
    }
    return dailyEvaluationsHistory.filter((r) => r.dateString && r.dateString >= startDate && r.dateString <= endDate);
  }, [dailyEvaluationsHistory, useRange, selectedDate, startDate, endDate]);

  const { totalSalesWeight } = useMemo(() => {
    const relevant = activeDelegateName === 'الكل'
      ? rangeFilteredSales
      : rangeFilteredSales.filter((e) => e.delegateName?.trim().toLowerCase() === activeDelegateName.trim().toLowerCase());
      
    const weight = relevant.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
    return { totalSalesWeight: weight };
  }, [rangeFilteredSales, activeDelegateName]);

  const totalTargetWeight = useMemo(() => {
    if (useRange) {
      // Calculate active days count in range
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const targets = activeDelegateName === 'الكل'
        ? delegatesList.reduce((sum, del) => {
            return sum + DEFAULT_CATEGORIES_LIST.reduce((catSum, cat) => {
              const found = delegateTargets.find(t => 
                t.delegateName?.trim().toLowerCase() === del.trim().toLowerCase() &&
                t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
              );
              return catSum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
            }, 0);
          }, 0)
        : DEFAULT_CATEGORIES_LIST.reduce((sum, cat) => {
            const found = delegateTargets.find(t => 
              t.delegateName?.trim().toLowerCase() === activeDelegateName.trim().toLowerCase() &&
              t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
            );
            return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
          }, 0);
      return targets * diffDays;
    }
    return categoryReports.reduce((sum, r) => sum + r.dailyTargetWeightKg, 0);
  }, [useRange, startDate, endDate, activeDelegateName, delegateTargets, categoryReports, delegatesList]);

  const totalPct = totalTargetWeight > 0 ? (totalSalesWeight / totalTargetWeight) * 100 : 0;

  // Admin Comparison data across delegates in range or selected date
  const adminComparisonData = useMemo(() => {
    if (!currentUser.isAdmin) return [];
    return delegatesList.map((del) => {
      const delSales = rangeFilteredSales.filter((e) => e.delegateName?.trim().toLowerCase() === del.trim().toLowerCase());
      const delKg = delSales.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
      const delPieces = delSales.reduce((sum, e) => sum + (e.quantity || 0), 0);

      const delEvals = rangeFilteredDailyEvals.filter((r) => r.delegateName.trim().toLowerCase() === del.trim().toLowerCase());
      const avgScore = delEvals.length > 0
        ? Math.round(delEvals.reduce((s, r) => s + r.totalScore, 0) / delEvals.length)
        : delKg > 0 ? Math.min(100, Math.round((delKg / 800) * 80 + 20)) : 0;

      return {
        delegateName: del,
        totalKg: Number(delKg.toFixed(1)),
        totalPieces: delPieces,
        score: avgScore,
        entriesCount: delSales.length,
      };
    }).sort((a, b) => b.totalKg - a.totalKg);
  }, [currentUser.isAdmin, delegatesList, rangeFilteredSales, rangeFilteredDailyEvals]);

  // Compute weekly sales progress data (last 7 days up to selectedDate)
  const weeklyChartData = useMemo(() => {
    const dates: string[] = [];
    const baseDate = new Date(selectedDate || new Date().toISOString().slice(0, 10));
    for (let i = 6; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    return dates.map((dateStr) => {
      const savedForDate = dailyEvaluationsHistory.filter(
        (r) => r.dateString === dateStr && (activeDelegateName === 'الكل' || r.delegateName.trim().toLowerCase() === activeDelegateName.trim().toLowerCase())
      );

      let totalKg = 0;
      let totalScore = 0;

      if (savedForDate.length > 0) {
        totalKg = savedForDate.reduce((sum, r) => sum + (r.totalWeightKg || 0), 0);
        totalScore = Math.round(savedForDate.reduce((sum, r) => sum + (r.totalScore || 0), 0) / savedForDate.length);
      } else {
        const entriesForDate = salesEntries.filter(
          (e) => e.dateString === dateStr && (activeDelegateName === 'الكل' || e.delegateName?.trim().toLowerCase() === activeDelegateName.trim().toLowerCase())
        );
        totalKg = entriesForDate.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
        totalScore = totalKg > 0 ? Math.min(100, Math.round((totalKg / 800) * 80 + 20)) : 0;
      }

      const dateObj = new Date(dateStr);
      const dayLabel = dateObj.toLocaleDateString('ar-IQ', { weekday: 'short', month: 'numeric', day: 'numeric' });

      return {
        date: dayLabel,
        fullDate: dateStr,
        mabayatKg: Number(totalKg.toFixed(1)),
        score: totalScore,
      };
    });
  }, [selectedDate, activeDelegateName, dailyEvaluationsHistory, salesEntries]);

  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="p-3 sm:p-4 max-w-5xl mx-auto space-y-4 dir-rtl text-slate-900">
      
      {/* Reports Content */}
      {currentUser.isAdmin && <DailyAdminReport salesEntries={salesEntries} productsList={productsList} currentUser={currentUser} />}
      {/* 100% Achievement Notification Banner */}
      {achievedCategories.length > 0 && (
        <div className="bg-amber-400 border-2 border-amber-500 rounded-2xl p-4 shadow-xl text-slate-950 space-y-2 animate-bounce-short print:hidden">
          <div className="flex items-center gap-2 font-extrabold text-base sm:text-lg">
            <Award className="w-6 h-6 text-slate-950" />
            <span>🏆 إشعار إنجاز الهدف (100%) - تهانينا!</span>
          </div>

          <p className="text-[10px] sm:text-xs font-bold text-slate-900">
            قام المندوب ({activeDelegateName}) بتجاوز أو تحقيق الهدف 100% في الأصناف التالية:
          </p>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {achievedCategories.map((c) => (
              <span
                key={c.categoryName}
                className="px-3 py-1 bg-slate-950 text-amber-300 font-extrabold text-xs rounded-full shadow"
              >
                {c.categoryName} ({c.percentage.toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Admin Delegate Switcher */}
      {currentUser.isAdmin && (
        <div className="bg-emerald-950 border border-emerald-800 rounded-xl p-3 text-white space-y-2 shadow-md print:hidden">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
            <Filter className="w-4 h-4" />
            <span>عرض تقرير المندوب (لوحة الأدمن):</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedDelegate('الكل')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedDelegate === 'الكل'
                  ? 'bg-amber-400 text-slate-950 shadow-md scale-105'
                  : 'bg-emerald-900/60 text-slate-200 hover:bg-emerald-800'
              }`}
            >
              جميع المندوبين (إجمالي)
            </button>

            {delegatesList.map((del) => (
              <button
                key={del}
                onClick={() => setSelectedDelegate(del)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  selectedDelegate === del
                    ? 'bg-emerald-500 text-slate-950 shadow-md scale-105'
                    : 'bg-emerald-900/60 text-slate-200 hover:bg-emerald-800'
                }`}
              >
                {del}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Date Filter & Range Picker Bar [HIDDEN]
      <div className="bg-emerald-900/60 border border-emerald-500/40 rounded-2xl p-4 shadow-lg text-white space-y-3 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <span>نظام نطاق التواريخ والتقارير:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseRange(!useRange)}
              className={`px-3 py-1 rounded-xl text-xs font-black transition-all ${
                useRange ? 'bg-amber-400 text-slate-950 shadow-md' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {useRange ? '✓ تفعيل نطاق زمني مخصص' : 'تفعيل نطاق زمني مخصص'}
            </button>
          </div>
        </div>

        {useRange ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-800/80">
            <div className="space-y-1">
              <label className="text-[11px] text-emerald-300 font-bold">من تاريخ:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-900 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-emerald-300 font-bold">إلى تاريخ:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-900 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-400"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-2 border-t border-emerald-800/80">
            <span className="text-xs text-emerald-300 font-bold">التاريخ المختار:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-900 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-400"
            />
          </div>
        )}
      </div>
      */}



      {/* Summary Metrics Banner */}
      <div className="bg-emerald-950 border-2 border-emerald-500 rounded-2xl p-4 text-white shadow-xl space-y-3 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base sm:text-lg font-black text-white">
            تقرير مبيعات ({activeDelegateName})
          </h2>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-emerald-500 text-slate-950 font-black text-xs rounded-full">
              نسبة الإنجاز الكلية: {totalPct.toFixed(1)}%
            </span>
          </div>
        </div>

        <hr className="border-emerald-800" />

        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="bg-emerald-900/50 p-3 rounded-xl border border-emerald-800">
            <div className="text-xs font-bold text-slate-300">إجمالي المبيعات اليوم</div>
            <div className="text-xl sm:text-2xl font-black text-emerald-300 mt-1">
              {totalSalesWeight.toFixed(1)} كجم
            </div>
          </div>

          <div className="bg-emerald-900/50 p-3 rounded-xl border border-emerald-800">
            <div className="text-xs font-bold text-slate-300">إجمالي التاركت المطلوب</div>
            <div className="text-xl sm:text-2xl font-black text-white mt-1">
              {totalTargetWeight.toFixed(1)} كجم
            </div>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="space-y-1">
          <div className="w-full bg-emerald-900 rounded-full h-3 overflow-hidden p-0.5 border border-emerald-700">
            <div
              className="bg-emerald-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, totalPct))}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Total Saved Weight Summary Card */}
      <div className="bg-white border-2 border-emerald-600 rounded-xl p-4 shadow-md text-center space-y-3">
        <h2 className="font-extrabold text-slate-900 text-base flex items-center justify-center gap-2">
          مجموع وزن إدخالات ({activeDelegateName})
        </h2>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-12">
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-500 mb-1">الوزن الكلي</span>
            <div className="text-3xl font-black text-slate-900">
              {formatWithCommas(parseFloat(totalSalesWeight.toFixed(2)), true)} كجم
            </div>
          </div>
          
          <div className="hidden sm:block w-px h-12 bg-slate-200"></div>
          <div className="block sm:hidden w-full h-px bg-slate-200"></div>
          
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-500 mb-1">المبلغ الكلي</span>
            <div className="text-3xl font-black text-emerald-600">
              {formatWithCommas(rangeFilteredSales.reduce((sum, e) => {
                const prod = productsList.find(p => p.productName === e.productName);
                const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                return sum + (price * e.quantity);
              }, 0), true)} د.ع
            </div>
          </div>
        </div>
      </div>

      {/* Daily Reset Info Banner */}
      <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 text-white shadow-md space-y-2 print:hidden">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-emerald-400" />
          <h3 className="font-bold text-sm text-emerald-200">
            نظام التقرير والمبيعات اليومية
          </h3>
        </div>

        <p className="text-xs text-slate-300 font-semibold leading-relaxed">
          * يتم تصفير المبيعات وبدء يوم عمل جديد تلقائياً في الساعة 12:00 منتصف الليل (12:00 AM) من كل يوم، مع المحافظة التامة على قيم التاركت التراكمي.
        </p>
      </div>

      {/* Weekly Sales Progress Interactive Chart (Recharts) [HIDDEN]
      <div className="bg-emerald-950 border-2 border-emerald-500 rounded-2xl p-4 text-white shadow-xl space-y-4 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-800/80 rounded-xl text-emerald-300">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-white text-sm sm:text-base">
                تطور المبيعات الأسبوعي للمندوب ({activeDelegateName})
              </h3>
              <p className="text-[11px] text-emerald-300/80 font-bold">
                عرض تفاعلي لأداء مبيعات الكيلوجرامات خلال الأيام الـ 7 الأخيرة
              </p>
            </div>
          </div>
          <span className="text-xs font-bold bg-emerald-800 text-emerald-200 px-3 py-1 rounded-full border border-emerald-600">
            مخطط Recharts التفاعلي
          </span>
        </div>

        <div className="w-full h-64 bg-slate-900/90 rounded-2xl p-3 border border-emerald-800/80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeklyChartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="mabayatGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#059669',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '12px',
                  direction: 'rtl',
                }}
                formatter={(value: any) => [`${value} كجم`, 'مبيعات الكيلوجرامات']}
                labelStyle={{ fontWeight: 'bold', color: '#34d399', marginBottom: '4px' }}
              />
              <Area
                type="monotone"
                dataKey="mabayatKg"
                name="مبيعات الكيلو"
                stroke="#34d399"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#mabayatGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      */}

      {/* Category Reports Table */}
      <div className="bg-white border-2 border-emerald-600 rounded-2xl overflow-hidden shadow-xl space-y-0">
        <div className="bg-emerald-950 p-3.5 border-b border-emerald-800 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-extrabold text-white text-sm sm:text-base">
              تفاصيل المبيعات والتاركت حسب الأصناف (16 صنف)
            </h3>
            <p className="text-[11px] text-emerald-300/90 font-bold mt-0.5">
              مرتبة تصاعدياً من الأصناف الأقل تحقيقاً (0%) إلى الأعلى إنجازاً (100%)
            </p>
          </div>
          <span className="text-xs font-bold text-emerald-400 bg-emerald-900/60 px-2.5 py-1 rounded-lg border border-emerald-700/50">
            {achievedCategories.length} أصناف محققة
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead className={`font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
              <tr>
                <th className="py-3 px-3 w-[33%]">الصنف</th>
                <th className="py-3 px-3 text-center w-[20%]">المبيعات (كجم)</th>
                <th className="py-3 px-3 text-center w-[20%]">التاركت (كجم)</th>
                <th className="py-3 px-3 text-center w-[27%]">نسبة الإنجاز %</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
              {categoryReports.map((item, idx) => (
                <tr
                  key={item.categoryName}
                  className={`hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}
                >
                  <td className="py-3 px-3 font-bold">
                    <div className="flex items-center gap-1.5">
                      <span>{item.categoryName}</span>
                      {item.isAchieved && (
                        <span className="px-2 py-0.5 bg-amber-400 text-slate-950 font-black text-[10px] rounded-full shadow-sm">
                          🏆 100%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center font-extrabold text-sm">
                    {item.dailySalesWeightKg.toFixed(1)}
                  </td>
                  <td className="py-3 px-3 text-center font-bold text-sm">
                    {item.dailyTargetWeightKg.toFixed(1)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span>{item.percentage.toFixed(0)}%</span>
                        {item.isAchieved ? (
                          <span className="text-emerald-500 flex items-center gap-0.5">
                            <Check className="w-3 h-3 inline" /> مكتمل
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            متبقي: {item.remainingWeightKg.toFixed(1)} كجم
                          </span>
                        )}
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            item.isAchieved ? 'bg-amber-500' : 'bg-emerald-600'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
                        ></div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sales Daily Completion Card */}
      <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500 rounded-xl p-4 text-center">
        {showCompletionConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className={`p-5 rounded-2xl shadow-xl w-full max-w-sm border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h2 className={`text-lg font-black mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>تأكيد إنهاء مبيعات اليوم</h2>
              <p className={`mb-4 text-sm font-bold ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>هل أنت متأكد من إكمال مبيعات اليوم؟ لا يمكن التراجع عن هذا الإجراء.</p>
              <div className={`flex flex-col gap-2 p-3 rounded-xl mb-4 text-sm font-black ${isDarkMode ? 'bg-slate-900 text-emerald-300' : 'bg-emerald-50 text-emerald-950'}`}>
                <div className="flex justify-between">
                  <span>إجمالي الوزن:</span>
                  <span>{modalTotalWeight.toFixed(2)} كجم</span>
                </div>
                <div className="flex justify-between">
                  <span>إجمالي المبلغ:</span>
                  <span>{formatWithCommas(modalTotalPrice, true)}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowCompletionConfirmModal(false)} className={`flex-1 p-3 rounded-xl font-black text-sm border ${isDarkMode ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-slate-200 text-slate-700 border-slate-300'}`}>إلغاء</button>
                <button onClick={handleConfirmCompletion} className="flex-1 p-3 bg-red-600 hover:bg-red-700 text-white font-black text-sm rounded-xl border border-red-800">تأكيد</button>
              </div>
            </div>
          </div>
        )}
        {!completedDelegates[activeDelegateName || ''] && (
          <button
            onClick={() => setShowCompletionConfirmModal(true)}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-black text-sm shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 w-full"
          >
            <Check className="w-5 h-5" />
            <span>لقد أكملت مبيعات اليوم</span>
          </button>
        )}
        {completedDelegates[activeDelegateName || ''] && (
            <div className="text-emerald-600 font-black text-sm">تم إكمال مبيعات اليوم بنجاح ✅</div>
        )}
      </div>

    </div>
    </PullToRefresh>
  );
};
