import React, { useState, useMemo } from 'react';
import { useSales } from '../context/SalesContext';
import {
  Award,
  Trophy,
  Calendar,
  Sparkles,
  TrendingUp,
  Boxes,
  Scale,
  Star,
  Users,
  Search,
  Clock,
  BarChart2,
  Layers,
  Table as TableIcon,
  LayoutGrid,
  Eye,
  X,
  FileText
} from 'lucide-react';

export const EvaluationsScreen: React.FC = () => {
  const { getDelegateEvaluations, rawSavedEntries, currentUser, isDarkMode, dailyEvaluationsHistory, saveDailyEvaluationsToFirestore } = useSales();
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [periodType, setPeriodType] = useState<'daily' | 'weekly'>('daily');
  const [activeModalDelegate, setActiveModalDelegate] = useState<string | null>(null);
  
  // حالة للتبديل بين عرض البطاقات أو الجدول
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const { evaluations, bestDelegate } = useMemo(() => {
    const res = getDelegateEvaluations(selectedDate, periodType);
    if (Array.isArray(res)) {
      return { evaluations: res, bestDelegate: res[0] || null };
    }
    return {
      evaluations: res?.evaluations || [],
      bestDelegate: res?.bestDelegate || null
    };
  }, [getDelegateEvaluations, selectedDate, periodType]);

  const selectedDelegateAch = useMemo(() => {
    if (!activeModalDelegate) return null;
    const targetEval = evaluations.find(
      (d) => d.delegateName.trim().toLowerCase() === activeModalDelegate.trim().toLowerCase()
    );
    const entries = rawSavedEntries.filter(
      (e) =>
        e.delegateName?.trim().toLowerCase() === activeModalDelegate.trim().toLowerCase() &&
        e.dateString === selectedDate
    );
    let totalKg = entries.reduce((sum, en) => sum + (en.totalWeightKg || 0), 0);
    let totalPieces = entries.reduce((sum, en) => sum + (en.quantity || 0), 0);

    return {
      delegateName: activeModalDelegate,
      totalKg: targetEval?.totalKg || totalKg,
      totalPieces: targetEval?.totalPieces || totalPieces,
      breakdown: targetEval?.breakdown || {
        timeScore: 0,
        salesScore: 0,
        itemsScore: 0,
        piecesScore: 0,
        cartonsScore: 0,
        targetCategoriesScore: 0,
      },
      totalScore: targetEval?.totalScore || 0,
    };
  }, [activeModalDelegate, evaluations, rawSavedEntries, selectedDate]);

  const filteredEvaluations = useMemo(() => {
    return evaluations.filter((del) =>
      del.delegateName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [evaluations, searchTerm]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 p-2 text-right" dir="rtl">
      
      {/* 1. HEADER BANNER */}
      <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl border border-indigo-500/30 text-white shadow-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/20 border border-amber-500/40 rounded-2xl text-amber-400 shadow-inner">
              <Award className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2">
                <span>تقييمات وأداء المندوبين</span>
                <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 font-semibold mt-1">
                نظام تقييم معتمد بناءً على 6 معايير (الوقت - المبيعات - الايتمات - القطع - الكراتين - الأصناف)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-1 bg-slate-800/90 rounded-2xl border border-slate-700 shadow-md">
              <button
                onClick={() => setPeriodType('daily')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  periodType === 'daily' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>يومي</span>
              </button>
              <button
                onClick={() => setPeriodType('weekly')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  periodType === 'weekly' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-300 hover:text-white'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                <span>أسبوعي</span>
              </button>
            </div>

            <div className="flex items-center gap-2 bg-slate-800/80 p-2.5 rounded-2xl border border-slate-700 shadow-md">
              <Calendar className="w-5 h-5 text-amber-400 shrink-0" />
              <span className="text-xs font-bold text-slate-300">التاريخ:</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-900 text-amber-300 font-black text-xs px-3 py-1.5 rounded-xl border border-amber-500/40 focus:outline-none focus:border-amber-400 cursor-pointer"
              />
            </div>


          </div>
        </div>
      </div>

      {/* 2. البطاقات الست المعبرة عن المعايير وأوزانها في الأعلى */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-2xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] text-cyan-400 font-bold">وزن 10%</span>
            <span className="text-xs font-bold text-white block">وقت الإدخال</span>
          </div>
          <Clock className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-2xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] text-purple-400 font-bold">وزن 20%</span>
            <span className="text-xs font-bold text-white block">حجم المبيعات</span>
          </div>
          <Scale className="w-4 h-4 text-purple-400" />
        </div>
        <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-2xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] text-blue-400 font-bold">وزن 20%</span>
            <span className="text-xs font-bold text-white block">عدد الايتمات</span>
          </div>
          <Boxes className="w-4 h-4 text-blue-400" />
        </div>
        <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-2xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] text-emerald-400 font-bold">وزن 20%</span>
            <span className="text-xs font-bold text-white block">عدد القطع</span>
          </div>
          <Layers className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-2xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] text-amber-400 font-bold">وزن 20%</span>
            <span className="text-xs font-bold text-white block">الكراتين المباعة</span>
          </div>
          <TrendingUp className="w-4 h-4 text-amber-400" />
        </div>
        <div className="bg-slate-900/70 border border-slate-800 p-3 rounded-2xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] text-rose-400 font-bold">وزن 30%</span>
            <span className="text-xs font-bold text-white block">أصناف 100%+</span>
          </div>
          <Award className="w-4 h-4 text-rose-400" />
        </div>
      </div>

      {/* 3. المندوب الأول في اليوم */}
      {bestDelegate ? (
        <div className="relative overflow-hidden p-6 rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 text-white border-2 border-emerald-500 shadow-2xl space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-emerald-800/80">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-emerald-800/60 border border-emerald-500/50 rounded-2xl text-emerald-300 shadow-lg shrink-0">
                <Trophy className="w-10 h-10 animate-bounce" />
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-800/60 text-emerald-200 border border-emerald-500/40 font-black text-xs">
                  <Star className="w-3.5 h-3.5 fill-emerald-300 text-emerald-200" />
                  <span>المندوب الأول ({selectedDate})</span>
                </div>
                <h2 className="text-2xl font-black text-white">{bestDelegate.delegateName}</h2>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveModalDelegate(bestDelegate.delegateName)}
                className="px-4 py-2 bg-emerald-800/60 hover:bg-emerald-700/60 text-emerald-100 border border-emerald-500/50 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <FileText className="w-4 h-4" />
                <span>عرض تفاصيل المعايير</span>
              </button>
              <div className="bg-emerald-950/90 text-white p-4 rounded-2xl border border-emerald-700 shadow-xl text-center">
                <div className="text-[11px] font-bold text-emerald-300">نسبة التقييم الكلي</div>
                <div className="text-3xl font-black text-emerald-400 font-mono">{bestDelegate.totalScore}%</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 4. قسم التحكم في عرض النتائج (بطاقات أو جدول) + البحث */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-3 text-white font-black text-base">
            <Users className="w-5 h-5 text-indigo-500" />
            <h3>قائمة تقييم أداء المندوبين ({selectedDate})</h3>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {/* أزرار التبديل بين البطاقات والجدول */}
            <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'cards' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>بطاقات</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'table' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>جدول تفصيلي</span>
              </button>
            </div>

            {/* مربع البحث */}
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="بحث باسم المندوب..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-3 pr-9 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* عرض البطاقات (Grid Cards) */}
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredEvaluations.map((item, idx) => {
              const rank = idx + 1;
              const isTop = rank === 1;

              const timeScore = Math.min(Math.max(item.breakdown?.timeScore || 0, 0), 100);
              const salesScore = Math.min(Math.max(item.breakdown?.salesScore || 0, 0), 100);
              const itemsScore = Math.min(Math.max(item.breakdown?.itemsScore || 0, 0), 100);
              const piecesScore = Math.min(Math.max(item.breakdown?.piecesScore || 0, 0), 100);
              const cartonsScore = Math.min(Math.max(item.breakdown?.cartonsScore || 0, 0), 100);
              const targetCategoriesScore = Math.min(Math.max(item.breakdown?.targetCategoriesScore || 0, 0), 100);

              return (
                <div
                  key={`card_${item.delegateName}_${idx}`}
                  className={`p-4 rounded-2xl border transition-all shadow-md space-y-3 ${
                    isTop 
                      ? 'bg-emerald-950/60 border-emerald-500/60 ring-1 ring-emerald-500/40 shadow-emerald-950/30' 
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* رأس البطاقة */}
                  <div className={`flex items-center justify-between border-b pb-2.5 ${isTop ? 'border-emerald-800/80' : 'border-slate-800'}`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                        rank === 1 ? 'bg-emerald-600 text-white shadow-md' :
                        rank === 2 ? 'bg-slate-300 text-slate-950' :
                        rank === 3 ? 'bg-amber-700 text-white' : 'bg-slate-800 text-slate-300'
                      }`}>
                        #{rank}
                      </div>
                      <div>
                        <h4 className="font-black text-sm text-white flex items-center gap-2">
                          {item.delegateName}
                          {isTop && <span className="text-[9px] bg-emerald-800/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/40">الأول</span>}
                        </h4>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-sm font-black font-mono text-amber-400 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                        {item.totalScore}%
                      </div>
                    </div>
                  </div>

                  {/* أشرطة التقدم لكل معيار */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-0.5">
                    <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="text-[9px] text-slate-400 truncate text-center">الوقت ({timeScore}%)</div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-cyan-400 h-full transition-all duration-500" style={{ width: `${timeScore}%` }}></div>
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="text-[9px] text-slate-400 truncate text-center">المبيعات ({salesScore}%)</div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-purple-400 h-full transition-all duration-500" style={{ width: `${salesScore}%` }}></div>
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="text-[9px] text-slate-400 truncate text-center">الايتمات ({itemsScore}%)</div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-blue-400 h-full transition-all duration-500" style={{ width: `${itemsScore}%` }}></div>
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="text-[9px] text-slate-400 truncate text-center">القطع ({piecesScore}%)</div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-emerald-400 h-full transition-all duration-500" style={{ width: `${piecesScore}%` }}></div>
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="text-[9px] text-slate-400 truncate text-center">الكراتين ({cartonsScore}%)</div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-amber-400 h-full transition-all duration-500" style={{ width: `${cartonsScore}%` }}></div>
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="text-[9px] text-slate-400 truncate text-center">أصناف 100% ({targetCategoriesScore}%)</div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-rose-400 h-full transition-all duration-500" style={{ width: `${targetCategoriesScore}%` }}></div>
                      </div>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        ) : (
          /* عرض الجدول التفصيلي الجديد (Detailed Table) */
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 text-[11px] font-bold border-b border-slate-800">
                    <th className="p-3.5">المرتبة</th>
                    <th className="p-3.5">اسم المندوب</th>
                    <th className="p-3.5 text-center">الوقت (10%)</th>
                    <th className="p-3.5 text-center">المبيعات (20%)</th>
                    <th className="p-3.5 text-center">الايتمات (20%)</th>
                    <th className="p-3.5 text-center">القطع (20%)</th>
                    <th className="p-3.5 text-center">الكراتين (20%)</th>
                    <th className="p-3.5 text-center">أصناف 100% (30%)</th>
                    <th className="p-3.5 text-center">النتيجة الكلية</th>
                    <th className="p-3.5 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs font-semibold text-slate-200">
                  {filteredEvaluations.map((item, idx) => {
                    const rank = idx + 1;
                    const isTop = rank === 1;

                    return (
                      <tr 
                        key={`table_${item.delegateName}_${idx}`} 
                        className={`transition-colors hover:bg-slate-800/50 ${isTop ? 'bg-emerald-950/40 border-b border-emerald-800/60' : ''}`}
                      >
                        <td className="p-3.5">
                          <span className={`w-6 h-6 rounded-lg inline-flex items-center justify-center font-black text-xs ${
                            rank === 1 ? 'bg-emerald-600 text-white shadow-sm' :
                            rank === 2 ? 'bg-slate-300 text-slate-950' :
                            rank === 3 ? 'bg-amber-700 text-white' : 'bg-slate-800 text-slate-300'
                          }`}>
                            #{rank}
                          </span>
                        </td>
                        <td className="p-3.5 font-bold text-white flex items-center gap-2">
                          {item.delegateName}
                          {isTop && <span className="text-[9px] bg-emerald-800/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/40">الأول</span>}
                        </td>
                        <td className="p-3.5 text-center font-mono text-cyan-400">{item.breakdown?.timeScore || 0}%</td>
                        <td className="p-3.5 text-center font-mono text-purple-400">{item.breakdown?.salesScore || 0}%</td>
                        <td className="p-3.5 text-center font-mono text-blue-400">{item.breakdown?.itemsScore || 0}%</td>
                        <td className="p-3.5 text-center font-mono text-emerald-400">{item.breakdown?.piecesScore || 0}%</td>
                        <td className="p-3.5 text-center font-mono text-amber-400">{item.breakdown?.cartonsScore || 0}%</td>
                        <td className="p-3.5 text-center font-mono text-rose-400">{item.breakdown?.targetCategoriesScore || 0}%</td>
                        <td className="p-3.5 text-center">
                          <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-xl font-black font-mono text-amber-400 text-sm">
                            {item.totalScore}%
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <button
                            onClick={() => setActiveModalDelegate(item.delegateName)}
                            className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>التفاصيل</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 5. نافذة منبثقة (Modal) لعرض تفاصيل كل المعايير لكل مندوب */}
      {activeModalDelegate && selectedDelegateAch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-5 shadow-2xl text-right max-h-[90vh] overflow-y-auto">
            
            {/* رأس النافذة */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/20 border border-indigo-500/40 rounded-xl text-indigo-400">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">{selectedDelegateAch.delegateName}</h3>
                  <p className="text-xs text-slate-400 font-medium">تفاصيل المعايير للفترة المحددة (التاريخ: {selectedDate})</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModalDelegate(null)}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* إحصائيات عامة سريعة */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 text-center space-y-1">
                <div className="text-[11px] text-slate-400 font-bold">إجمالي الوزن</div>
                <div className="text-base font-black font-mono text-amber-400">{selectedDelegateAch.totalKg.toLocaleString()} كغ</div>
              </div>
              <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 text-center space-y-1">
                <div className="text-[11px] text-slate-400 font-bold">إجمالي القطع</div>
                <div className="text-base font-black font-mono text-emerald-400">{selectedDelegateAch.totalPieces.toLocaleString()}</div>
              </div>
              <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 text-center space-y-1">
                <div className="text-[11px] text-slate-400 font-bold">النتيجة الكلية</div>
                <div className="text-base font-black font-mono text-indigo-400">{selectedDelegateAch.totalScore}%</div>
              </div>
            </div>

            {/* تفاصيل المعايير الستة للمندوب */}
            <div className="space-y-3">
              <h4 className="text-sm font-black text-white">تفاصيل درجات المعايير:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold text-slate-300">وقت الإدخال (10%)</span>
                  </div>
                  <span className="text-sm font-black font-mono text-cyan-400">{selectedDelegateAch.breakdown.timeScore}%</span>
                </div>

                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scale className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold text-slate-300">حجم المبيعات (20%)</span>
                  </div>
                  <span className="text-sm font-black font-mono text-purple-400">{selectedDelegateAch.breakdown.salesScore}%</span>
                </div>

                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Boxes className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold text-slate-300">عدد الايتمات (20%)</span>
                  </div>
                  <span className="text-sm font-black font-mono text-blue-400">{selectedDelegateAch.breakdown.itemsScore}%</span>
                </div>

                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-300">عدد القطع (20%)</span>
                  </div>
                  <span className="text-sm font-black font-mono text-emerald-400">{selectedDelegateAch.breakdown.piecesScore}%</span>
                </div>

                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-slate-300">الكراتين المباعة (20%)</span>
                  </div>
                  <span className="text-sm font-black font-mono text-amber-400">{selectedDelegateAch.breakdown.cartonsScore}%</span>
                </div>

                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-rose-400" />
                    <span className="text-xs font-bold text-slate-300">أصناف 100%+ (30%)</span>
                  </div>
                  <span className="text-sm font-black font-mono text-rose-400">{selectedDelegateAch.breakdown.targetCategoriesScore}%</span>
                </div>

              </div>
            </div>

            {/* تذييل النافذة */}
            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setActiveModalDelegate(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                إغلاق
              </button>
            </div>

          </div>
        </div>
      )}



    </div>
  );
};