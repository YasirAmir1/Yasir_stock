import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  BarChart3,
  Store,
  ChevronDown,
  ChevronUp,
  FileText,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { CustomerInfoNote, RouteItem, SalesEntry } from '../types';
import { normalizeTrackingText } from '../lib/fleetTrackingService';
import { getEffectiveRouteDay } from '../utils/routeUtils';
import { formatEnglishTime } from '../utils/dateUtils';

interface EndOfDayRouteReportProps {
  routes: RouteItem[];
  salesEntries: SalesEntry[];
  customerNotes: CustomerInfoNote[];
  manualVisits: Record<string, boolean>;
  currentDay: string;
  delegateName?: string;
  delegateCode?: string;
  username?: string;
  isPrivilegedUser?: boolean;
  selectedDelegateFilter?: string;
  selectedDayFilter?: string;
  isCompletedToday?: boolean;
  isDarkMode?: boolean;
}

interface RecordedVisit {
  key: string;
  customerCode: string;
  customerName: string;
  timestamp: number | null;
  visitType: 'invoice' | 'note' | 'manual';
  inPlan: boolean;
  totalWeightKg?: number;
  noteOption?: string;
  durationMinutes: number | null;
  delegateName?: string;
}

const formatHourLabelArabic = (hour24: number): string => {
  if (hour24 === 0) return '12 ص';
  if (hour24 < 12) return `${hour24} ص`;
  if (hour24 === 12) return '12 م';
  return `${hour24 - 12} م`;
};

const formatVisitTimeArabic = (ts: number): string => {
  return formatEnglishTime(ts, false, '-');
};

const formatDurationMinutesArabic = (mins: number | null): string => {
  if (mins === null) return '—';
  if (mins < 60) return `${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} س ${m} د` : `${h} ساعة`;
};

export const EndOfDayRouteReport: React.FC<EndOfDayRouteReportProps> = ({
  routes,
  salesEntries,
  customerNotes,
  manualVisits,
  currentDay,
  delegateName = '',
  delegateCode = '',
  username = '',
  isPrivilegedUser = false,
  selectedDelegateFilter = '',
  selectedDayFilter = '',
  isCompletedToday = false,
  isDarkMode = false,
}) => {
  const [showVisitsBreakdown, setShowVisitsBreakdown] = useState<boolean>(false);
  const [selectedHourInfo, setSelectedHourInfo] = useState<{
    hour: number;
    label: string;
    visits: number;
  } | null>(null);

  const todayIso = new Date().toISOString().split('T')[0];

  const reportData = useMemo(() => {
    const activeDay = (isPrivilegedUser ? selectedDayFilter || currentDay : currentDay) || currentDay;
    const normActiveDay = normalizeTrackingText(activeDay);

    const targetDelName = isPrivilegedUser
      ? normalizeTrackingText(selectedDelegateFilter)
      : normalizeTrackingText(delegateName);
    const targetDelCode = isPrivilegedUser
      ? normalizeTrackingText(selectedDelegateFilter)
      : normalizeTrackingText(delegateCode);
    const targetUsername = isPrivilegedUser ? '' : normalizeTrackingText(username);

    const matchesTargetDelegate = (rDelNameRaw?: string, rDelCodeRaw?: string): boolean => {
      if (isPrivilegedUser && !selectedDelegateFilter) return true;
      const rDelName = normalizeTrackingText(rDelNameRaw);
      const rDelCode = normalizeTrackingText(rDelCodeRaw);
      return (
        (targetDelName !== '' &&
          (rDelName === targetDelName ||
            rDelName.includes(targetDelName) ||
            targetDelName.includes(rDelName))) ||
        (targetDelCode !== '' &&
          (rDelCode === targetDelCode || rDelName.includes(targetDelCode))) ||
        (targetUsername !== '' &&
          (rDelName.includes(targetUsername) || rDelCode === targetUsername))
      );
    };

    // 1. Build today's planned routes for this delegate/day (distinct customers)
    const plannedMap = new Map<string, RouteItem>();
    routes.forEach((r) => {
      if (!matchesTargetDelegate(r.delegateName, r.delegateCode)) return;
      if (normActiveDay) {
        const effDay = normalizeTrackingText(getEffectiveRouteDay(r));
        if (!effDay.includes(normActiveDay) && !normActiveDay.includes(effDay)) return;
      }
      const key = String(r.customerCode || '').trim() || normalizeTrackingText(r.customerName) || r.id;
      if (!plannedMap.has(key)) {
        plannedMap.set(key, r);
      }
    });

    const plannedList = Array.from(plannedMap.values());
    const plannedKeysSet = new Set<string>(plannedMap.keys());
    const plannedNamesSet = new Set<string>(
      plannedList.map((r) => normalizeTrackingText(r.customerName)).filter(Boolean)
    );

    const isShopInPlan = (code: string, nameNorm: string): boolean =>
      Boolean((code && plannedKeysSet.has(code)) || (nameNorm && plannedNamesSet.has(nameNorm)));

    // 2. Gather today's recorded visits from salesEntries + customerNotes + manualVisits
    const visitsByCustomer = new Map<string, Omit<RecordedVisit, 'durationMinutes'>>();

    salesEntries.forEach((e) => {
      if (e.status === 'cancelled' || e.dateString !== todayIso) return;
      if (!matchesTargetDelegate(e.delegateName, '')) return;

      const cCode = String(e.customerCode || '').trim();
      const cNameNorm = normalizeTrackingText(e.customerName);
      const key = cCode || cNameNorm || e.id;
      if (!key) return;

      const ts = Number(e.timestamp) || null;
      const existing = visitsByCustomer.get(key);
      if (!existing) {
        visitsByCustomer.set(key, {
          key,
          customerCode: cCode || '-',
          customerName: e.customerName || 'محل غير مسمى',
          timestamp: ts,
          visitType: 'invoice',
          inPlan: isShopInPlan(cCode, cNameNorm),
          totalWeightKg: Number(e.totalWeightKg) || 0,
          delegateName: e.delegateName || '-',
        });
      } else {
        existing.totalWeightKg = (existing.totalWeightKg || 0) + (Number(e.totalWeightKg) || 0);
        if (ts && (!existing.timestamp || ts < existing.timestamp)) {
          existing.timestamp = ts;
        }
      }
    });

    customerNotes.forEach((note) => {
      const noteDate =
        note.dateString ||
        (note.timestamp ? new Date(note.timestamp).toISOString().split('T')[0] : '');
      if (noteDate !== todayIso) return;
      if (!matchesTargetDelegate(note.delegateName, note.delegateCode)) return;

      const cCode = String(note.customerCode || '').trim();
      const cNameNorm = normalizeTrackingText(note.customerName);
      const key = cCode || cNameNorm || note.id || '';
      if (!key || visitsByCustomer.has(key)) return;

      visitsByCustomer.set(key, {
        key,
        customerCode: cCode || '-',
        customerName: note.customerName || 'محل غير مسمى',
        timestamp: Number(note.timestamp) || null,
        visitType: 'note',
        inPlan: isShopInPlan(cCode, cNameNorm),
        noteOption: note.selectedOption,
        delegateName: note.delegateName || '-',
      });
    });

    plannedList.forEach((r) => {
      const cCode = String(r.customerCode || '').trim();
      const cNameNorm = normalizeTrackingText(r.customerName);
      const key = cCode || cNameNorm || r.id;
      if (key && !visitsByCustomer.has(key) && cCode && manualVisits[cCode]) {
        visitsByCustomer.set(key, {
          key,
          customerCode: cCode,
          customerName: r.customerName,
          timestamp: null,
          visitType: 'manual',
          inPlan: true,
          delegateName: r.delegateName || '-',
        });
      }
    });

    // 3. Sort timed visits chronologically & compute duration between consecutive visits
    const allVisitsRaw = Array.from(visitsByCustomer.values());
    const timedVisitsRaw = allVisitsRaw
      .filter((v) => v.timestamp !== null && Number.isFinite(v.timestamp))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const untimedVisitsRaw = allVisitsRaw.filter((v) => v.timestamp === null);

    const timedVisits: RecordedVisit[] = timedVisitsRaw.map((v, idx) => {
      let durationMinutes: number | null = null;
      if (idx > 0 && v.timestamp && timedVisitsRaw[idx - 1].timestamp) {
        durationMinutes = Math.max(
          1,
          Math.round((v.timestamp - timedVisitsRaw[idx - 1].timestamp!) / 60000)
        );
      }
      return { ...v, durationMinutes };
    });

    const untimedVisits: RecordedVisit[] = untimedVisitsRaw.map((v) => ({
      ...v,
      durationMinutes: null,
    }));

    const chronologicalVisits = [...timedVisits, ...untimedVisits];

    const durationGaps = timedVisits
      .map((v) => v.durationMinutes)
      .filter((d): d is number => d !== null);
    const avgVisitMinutes =
      durationGaps.length > 0
        ? Math.round(durationGaps.reduce((s, d) => s + d, 0) / durationGaps.length)
        : null;
    const totalActiveSpanMinutes =
      timedVisits.length >= 2 && timedVisits[0].timestamp && timedVisits[timedVisits.length - 1].timestamp
        ? Math.max(
            1,
            Math.round(
              (timedVisits[timedVisits.length - 1].timestamp! - timedVisits[0].timestamp!) / 60000
            )
          )
        : null;

    // 4. Plan completion counts
    const plannedCount = plannedList.length;
    const visitedInPlanCount = allVisitsRaw.filter((v) => v.inPlan).length;
    const totalVisitedCount = allVisitsRaw.length;
    const extraOutOfPlanCount = Math.max(0, totalVisitedCount - visitedInPlanCount);
    const completionPct =
      plannedCount > 0 ? Math.min(100, Math.round((visitedInPlanCount / plannedCount) * 100)) : 0;

    // 5. Build Hourly Visit Rate chart buckets (7 AM to 6 PM)
    const hourCounts = new Map<number, number>();
    timedVisits.forEach((v) => {
      if (!v.timestamp) return;
      const h = new Date(v.timestamp).getHours();
      hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
    });

    const hourlyChartData: Array<{ hour: number; label: string; visits: number }> = [];
    for (let h = 7; h <= 18; h++) {
      hourlyChartData.push({
        hour: h,
        label: formatHourLabelArabic(h),
        visits: hourCounts.get(h) || 0,
      });
    }

    const maxHourlyVisits = hourlyChartData.reduce((m, item) => Math.max(m, item.visits), 0);
    const peakHourItem =
      maxHourlyVisits > 0
        ? hourlyChartData.find((item) => item.visits === maxHourlyVisits) || null
        : null;

    return {
      activeDay,
      plannedCount,
      visitedInPlanCount,
      totalVisitedCount,
      extraOutOfPlanCount,
      remainingInPlanCount: Math.max(0, plannedCount - visitedInPlanCount),
      completionPct,
      avgVisitMinutes,
      totalActiveSpanMinutes,
      firstVisitTs: timedVisits[0]?.timestamp || null,
      lastVisitTs: timedVisits[timedVisits.length - 1]?.timestamp || null,
      chronologicalVisits,
      hourlyChartData,
      maxHourlyVisits,
      peakHourItem,
    };
  }, [
    routes,
    salesEntries,
    customerNotes,
    manualVisits,
    currentDay,
    delegateName,
    delegateCode,
    username,
    isPrivilegedUser,
    selectedDelegateFilter,
    selectedDayFilter,
    todayIso,
  ]);

  return (
    <section
      className={`mt-6 rounded-2xl border shadow-sm overflow-hidden transition-colors ${
        isDarkMode
          ? 'bg-slate-900 border-slate-700 text-white'
          : 'bg-white border-slate-200 text-slate-900'
      }`}
      dir="rtl"
    >
      {/* Header */}
      <div
        className={`px-4 py-3.5 border-b flex flex-wrap items-center justify-between gap-2 ${
          isCompletedToday
            ? isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/50'
              : 'bg-emerald-50 border-emerald-200'
            : isDarkMode
            ? 'bg-slate-800/70 border-slate-700'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-black text-sm sm:text-base flex items-center gap-2">
              <span>تقرير نهاية اليوم — خلاصة الزيارات والأداء</span>
              {isCompletedToday && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white">
                  مكتمل ✅
                </span>
              )}
            </h3>
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              مسار {reportData.activeDay} • مقارنة الزيارات الفعلية مع خطة اليوم{isPrivilegedUser ? ' والوقت المستغرق' : ''}
            </p>
          </div>
        </div>

        {reportData.peakHourItem && (
          <div className="px-2.5 py-1 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 text-[11px] font-black flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>
              ذروة الزيارات: {reportData.peakHourItem.label} ({reportData.peakHourItem.visits}{' '}
              {reportData.peakHourItem.visits === 1 ? 'محل' : 'محلات'})
            </span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-5">
        {/* Top KPI Cards */}
        <div className={`grid grid-cols-1 ${isPrivilegedUser ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
          {/* Card 1: Visited vs Plan */}
          <div
            className={`p-3.5 rounded-2xl border space-y-2 ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>المحلات المزارة مقابل الخطة</span>
              </span>
              <span className="font-black text-emerald-600 dark:text-emerald-400 font-mono">
                {reportData.completionPct}%
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                {reportData.visitedInPlanCount}
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                من أصل <b className="font-mono text-slate-700 dark:text-slate-200">{reportData.plannedCount}</b> محل
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                style={{ width: `${reportData.completionPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
              <span>المتبقي ضمن الخطة: {reportData.remainingInPlanCount}</span>
              {reportData.extraOutOfPlanCount > 0 && (
                <span className="text-sky-600 dark:text-sky-400">
                  +{reportData.extraOutOfPlanCount} خارج الخطة
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Average Time Per Visit (Admin Only) */}
          {isPrivilegedUser && (
            <div
              className={`p-3.5 rounded-2xl border space-y-2 ${
                isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                  <span>متوسط الوقت لكل زيارة</span>
                </span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-sky-600 dark:text-sky-400 font-mono">
                  {reportData.avgVisitMinutes !== null ? reportData.avgVisitMinutes : '—'}
                </span>
                {reportData.avgVisitMinutes !== null && (
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">دقيقة / محل</span>
                )}
              </div>

              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {reportData.firstVisitTs && reportData.lastVisitTs
                  ? `من ${formatVisitTimeArabic(reportData.firstVisitTs)} إلى ${formatVisitTimeArabic(
                      reportData.lastVisitTs
                    )}`
                  : 'يُحتسب تلقائياً عند تسجيل أكثر من زيارة في اليوم'}
              </p>

              {reportData.totalActiveSpanMinutes !== null && (
                <div className="text-[11px] font-black text-sky-700 dark:text-sky-300">
                  إجمالي فترة العمل: {formatDurationMinutesArabic(reportData.totalActiveSpanMinutes)}
                </div>
              )}
            </div>
          )}

          {/* Card 3: Total Visits Summary */}
          <div
            className={`p-3.5 rounded-2xl border space-y-2 ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <span>إجمالي المحلات التي تمت زيارتها</span>
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-teal-600 dark:text-teal-400 font-mono">
                {reportData.totalVisitedCount}
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {reportData.totalVisitedCount === 1 ? 'محل اليوم' : 'محلات اليوم'}
              </span>
            </div>

            <div className="flex items-center gap-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 pt-1">
              <span className="flex items-center gap-1">
                <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
                فواتير:{' '}
                <b className="text-slate-800 dark:text-slate-200">
                  {reportData.chronologicalVisits.filter((v) => v.visitType === 'invoice').length}
                </b>
              </span>
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                ملاحظات:{' '}
                <b className="text-slate-800 dark:text-slate-200">
                  {reportData.chronologicalVisits.filter((v) => v.visitType === 'note').length}
                </b>
              </span>
            </div>
          </div>
        </div>

        {/* Hourly Visit Rate Simple Bar Chart (Pure React/Tailwind - zero external hook issues) */}
        <div
          className={`p-3.5 sm:p-4 rounded-2xl border ${
            isDarkMode ? 'bg-slate-800/40 border-slate-700/80' : 'bg-slate-50/70 border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="font-black text-xs sm:text-sm flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>معدل الزيارات خلال ساعات اليوم</span>
            </h4>
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
              {selectedHourInfo ? (
                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-black">
                  الساعة {selectedHourInfo.label}: {selectedHourInfo.visits}{' '}
                  {selectedHourInfo.visits === 1 ? 'محل' : 'محلات'}
                </span>
              ) : (
                <span>عدد المحلات المزارة في كل ساعة</span>
              )}
            </div>
          </div>

          <div className="relative pt-5 pb-1 overflow-x-auto">
            <div className="min-w-[340px]">
              {/* Chart Plot Area */}
              <div className="relative h-40 flex items-end justify-between gap-1.5 sm:gap-2 px-1 border-b border-slate-300 dark:border-slate-700">
                {/* Subtle horizontal grid lines */}
                <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex flex-col justify-between">
                  <div className="border-t border-dashed border-slate-200 dark:border-slate-700/70" />
                  <div className="border-t border-dashed border-slate-200 dark:border-slate-700/70" />
                  <div className="border-t border-dashed border-slate-200 dark:border-slate-700/70" />
                  <div />
                </div>

                {reportData.hourlyChartData.map((entry) => {
                  const maxVal = Math.max(1, reportData.maxHourlyVisits);
                  const heightPct =
                    entry.visits > 0 ? Math.max(14, Math.round((entry.visits / maxVal) * 100)) : 5;
                  const isPeak =
                    reportData.maxHourlyVisits > 0 && entry.visits === reportData.maxHourlyVisits;
                  const isSelected = selectedHourInfo?.hour === entry.hour;

                  return (
                    <button
                      key={`hour-col-${entry.hour}`}
                      type="button"
                      onMouseEnter={() => setSelectedHourInfo(entry)}
                      onMouseLeave={() => setSelectedHourInfo(null)}
                      onClick={() =>
                        setSelectedHourInfo((prev) => (prev?.hour === entry.hour ? null : entry))
                      }
                      className="relative z-10 flex-1 h-full flex flex-col items-center justify-end group cursor-pointer focus:outline-none"
                      title={`${entry.label}: ${entry.visits} ${entry.visits === 1 ? 'محل' : 'محلات'}`}
                    >
                      {entry.visits > 0 && (
                        <span
                          className={`mb-1 text-[10px] font-black font-mono transition-transform ${
                            isPeak
                              ? 'text-emerald-700 dark:text-emerald-300 scale-110'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {entry.visits}
                        </span>
                      )}
                      <div
                        className={`w-full max-w-[26px] rounded-t-lg transition-all duration-300 ${
                          entry.visits === 0
                            ? isDarkMode
                              ? 'bg-slate-700/60 group-hover:bg-slate-600'
                              : 'bg-slate-200 group-hover:bg-slate-300'
                            : isPeak
                            ? 'bg-emerald-600 group-hover:bg-emerald-500 shadow-sm shadow-emerald-600/30'
                            : 'bg-teal-500 group-hover:bg-teal-400'
                        } ${isSelected ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </button>
                  );
                })}
              </div>

              {/* X-Axis Hour Labels */}
              <div className="flex items-center justify-between gap-1.5 sm:gap-2 px-1 pt-2">
                {reportData.hourlyChartData.map((entry) => (
                  <div
                    key={`hour-lbl-${entry.hour}`}
                    className={`flex-1 text-center text-[10px] sm:text-[11px] font-bold whitespace-nowrap ${
                      entry.visits > 0
                        ? 'text-slate-800 dark:text-slate-200 font-black'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {entry.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Per-Visit Time Breakdown List (Admin Only) */}
        {isPrivilegedUser && (
          <div
            className={`rounded-2xl border overflow-hidden ${
              isDarkMode ? 'border-slate-700 bg-slate-800/30' : 'border-slate-200 bg-slate-50/40'
            }`}
          >
            <button
              type="button"
              onClick={() => setShowVisitsBreakdown((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-xs sm:text-sm font-black cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span>تفاصيل الوقت المستغرق لكل زيارة ({reportData.chronologicalVisits.length})</span>
              </span>
              {showVisitsBreakdown ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {showVisitsBreakdown && (
              <div className="border-t border-slate-200 dark:border-slate-700 overflow-x-auto">
                {reportData.chronologicalVisits.length === 0 ? (
                  <div className="p-6 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                    لم يتم تسجيل زيارات أو فواتير لهذا المسار اليوم بعد.
                  </div>
                ) : (
                  <table className="w-full text-right text-xs">
                    <thead
                      className={`font-bold ${
                        isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      <tr>
                        <th className="px-3 py-2 border-b dark:border-slate-700">#</th>
                        <th className="px-3 py-2 border-b dark:border-slate-700">اسم المحل</th>
                        <th className="px-3 py-2 border-b dark:border-slate-700">المندوب</th>
                        <th className="px-3 py-2 border-b dark:border-slate-700">الإجراء</th>
                        <th className="px-3 py-2 border-b dark:border-slate-700">وقت الزيارة</th>
                        <th className="px-3 py-2 border-b dark:border-slate-700">الوقت المستغرق</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {reportData.chronologicalVisits.map((visit, idx) => (
                        <tr
                          key={`${visit.key}-${idx}`}
                          className={isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}
                        >
                          <td className="px-3 py-2 font-mono font-bold text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2 font-black">
                            <div>{visit.customerName}</div>
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <span className="font-mono">{visit.customerCode}</span>
                              <span>•</span>
                              <span className={visit.inPlan ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-600 dark:text-sky-400'}>
                                {visit.inPlan ? 'ضمن الخطة' : 'خارج الخطة'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                            {visit.delegateName || '-'}
                          </td>
                          <td className="px-3 py-2">
                            {visit.visitType === 'invoice' ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                فاتورة {visit.totalWeightKg ? `(${visit.totalWeightKg.toFixed(1)} كجم)` : ''}
                              </span>
                            ) : visit.visitType === 'note' ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                                ملاحظة
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-500/15 text-slate-600 dark:text-slate-300">
                                زيارة يدوية
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono font-bold whitespace-nowrap">
                            {visit.timestamp ? formatVisitTimeArabic(visit.timestamp) : 'غير محدد'}
                          </td>
                          <td className="px-3 py-2 font-black whitespace-nowrap">
                            {idx === 0 && visit.timestamp ? (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                                أول زيارة اليوم
                              </span>
                            ) : (
                              <span className="text-sky-700 dark:text-sky-300">
                                {formatDurationMinutesArabic(visit.durationMinutes)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
