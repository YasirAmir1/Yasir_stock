import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Clock, FileText, Filter, X } from 'lucide-react';
import { SalesEntry } from '../types';
import { normalizeArabicText, useSales } from '../context/SalesContext';
import { computeUnifiedDelegateInvoiceStats, parseEntryTimestamp } from '../utils/salesAnalysisUtils';

interface HeaderDelegateActivityBarProps {
  delegatesList: string[];
  allSalesEntries: SalesEntry[];
  salesEntries: SalesEntry[];
  isDarkMode: boolean;
  selectedDelegate: string;
  onSelectDelegate?: (delegateName: string) => void;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

type ActivityLevel = 'high' | 'medium' | 'low' | 'idle';

interface DelegateHourlyStats {
  name: string;
  invoiceCount: number;
  level: ActivityLevel;
  levelLabel: string;
  lastInvoiceTs: number | null;
  lastCustomerName: string;
}

function getActivityLevel(count: number): { level: ActivityLevel; label: string } {
  if (count >= 10) return { level: 'high', label: 'نشاط مرتفع (+10)' };
  if (count >= 7) return { level: 'medium', label: 'نشاط جيد (7+)' };
  if (count >= 3) return { level: 'low', label: 'نشاط خفيف (3+)' };
  if (count >= 1) return { level: 'low', label: 'نشاط خفيف' };
  return { level: 'idle', label: 'خامل (0 فواتير)' };
}

export const HeaderDelegateActivityBar: React.FC<HeaderDelegateActivityBarProps> = ({
  delegatesList,
  allSalesEntries,
  salesEntries,
  isDarkMode,
  selectedDelegate,
  onSelectDelegate,
}) => {
  const { selectedDate } = useSales();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [inspectedDelegate, setInspectedDelegate] = useState<string | null>(null);

  // Refresh every 30 seconds so activity drops smoothly once invoices age past 60 minutes
  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, [allSalesEntries, salesEntries]);

  const delegateStats = useMemo<DelegateHourlyStats[]>(() => {
    // Deduplicate sales entries from both allSalesEntries and salesEntries by entry.id
    const mergedById = new Map<string, SalesEntry>();
    allSalesEntries.forEach((e) => {
      if (e && e.id) mergedById.set(e.id, e);
    });
    salesEntries.forEach((e) => {
      if (e && e.id) mergedById.set(e.id, e);
    });
    const allEntriesArray = Array.from(mergedById.values());

    const statsMap = computeUnifiedDelegateInvoiceStats(
      allEntriesArray,
      delegatesList,
      selectedDate || new Date().toISOString().split('T')[0],
      nowMs,
      ONE_HOUR_MS
    );

    const lastCustomerMap = new Map<string, string>();
    const lastTsMap = new Map<string, number>();

    mergedById.forEach((entry) => {
      if (!entry || entry.status === 'cancelled') return;
      const delName = (entry.delegateName || '').trim();
      const matchedDel =
        delegatesList.find(
          (d) => normalizeArabicText(d) === normalizeArabicText(delName)
        ) || delName;
      if (!matchedDel || !delegatesList.includes(matchedDel)) return;

      const ts = parseEntryTimestamp(entry);
      const currentLast = lastTsMap.get(matchedDel) || 0;
      if (ts > currentLast) {
        lastTsMap.set(matchedDel, ts);
        lastCustomerMap.set(matchedDel, (entry.customerName || '').trim());
      }
    });

    return delegatesList.map((del) => {
      const cleanName = del.trim();
      const entryMetrics = statsMap[cleanName] || {
        todayCount: 0,
        lastHourCount: 0,
        lastInvoiceTimestamp: null,
      };
      const count = entryMetrics.lastHourCount;
      const { level, label } = getActivityLevel(count);
      return {
        name: cleanName,
        invoiceCount: count,
        level,
        levelLabel: label,
        lastInvoiceTs: entryMetrics.lastInvoiceTimestamp,
        lastCustomerName: lastCustomerMap.get(cleanName) || '',
      };
    });
  }, [delegatesList, allSalesEntries, salesEntries, selectedDate, nowMs]);

  const inspectedStat = useMemo(() => {
    if (!inspectedDelegate) return null;
    return delegateStats.find((d) => d.name === inspectedDelegate) || null;
  }, [delegateStats, inspectedDelegate]);

  if (delegatesList.length === 0) return null;

  const formatShortTime = (ts: number | null) => {
    if (!ts) return '---';
    try {
      return new Date(ts).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '---';
    }
  };

  return (
    <div
      className={`border-b transition-colors ${
        isDarkMode
          ? 'bg-slate-950/90 border-slate-800/90 text-slate-200'
          : 'bg-slate-50/95 border-slate-200 text-slate-800'
      }`}
    >
      <div className="max-w-5xl mx-auto px-2 sm:px-5 py-1 sm:py-1.5 flex items-center gap-1.5 sm:gap-2">
        {/* Compact Title */}
        <div
          className={`flex items-center gap-1 shrink-0 text-[9px] sm:text-[11px] font-black pl-1 sm:pl-2 border-l ${
            isDarkMode
              ? 'border-slate-800 text-emerald-400'
              : 'border-slate-300 text-emerald-800'
          }`}
          title="مؤشر نشاط المندوبين المباشر بناءً على عدد الفواتير المنشأة خلال آخر 60 دقيقة"
        >
          <Activity className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
          <span className="whitespace-nowrap hidden sm:inline">نشاط آخر ساعة</span>
          <span className="whitespace-nowrap sm:hidden">النشاط</span>
        </div>

        {/* Delegates Activity Strip (Wrapped, No Horizontal Scroll) */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap flex-1 py-0.5">
          {onSelectDelegate && selectedDelegate && selectedDelegate !== 'الكل' && (
            <button
              type="button"
              onClick={() => {
                onSelectDelegate('الكل');
                setInspectedDelegate(null);
              }}
              title={`إلغاء تصفية المندوب (${selectedDelegate}) وعرض جميع المندوبين`}
              className={`inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border text-[10px] sm:text-xs font-black transition-all shrink-0 cursor-pointer ${
                isDarkMode
                  ? 'bg-rose-950/80 border-rose-500/60 text-rose-200 hover:bg-rose-900/80'
                  : 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100'
              }`}
            >
              <X className="w-3 h-3 shrink-0" />
              <span className="whitespace-nowrap">إلغاء التصفية</span>
            </button>
          )}
          {delegateStats.map((del) => {
            const isSelected = selectedDelegate === del.name;

            const containerTheme =
              del.level === 'high'
                ? isDarkMode
                  ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-100 hover:bg-emerald-900/70'
                  : 'bg-emerald-50 border-emerald-400/80 text-emerald-950 hover:bg-emerald-100'
                : del.level === 'medium'
                ? isDarkMode
                  ? 'bg-sky-950/60 border-sky-500/45 text-sky-100 hover:bg-sky-900/60'
                  : 'bg-sky-50 border-sky-300 text-sky-950 hover:bg-sky-100'
                : del.level === 'low'
                ? isDarkMode
                  ? 'bg-amber-950/50 border-amber-500/45 text-amber-100 hover:bg-amber-900/50'
                  : 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100'
                : isDarkMode
                ? 'bg-slate-900/80 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100';

            const countColor =
              del.level === 'high'
                ? isDarkMode
                  ? 'text-emerald-300'
                  : 'text-emerald-800'
                : del.level === 'medium'
                ? isDarkMode
                  ? 'text-sky-300'
                  : 'text-sky-800'
                : del.level === 'low'
                ? isDarkMode
                  ? 'text-amber-300'
                  : 'text-amber-800'
                : isDarkMode
                ? 'text-slate-500'
                : 'text-slate-400';

            const barActiveClass =
              del.level === 'high'
                ? 'bg-emerald-500 dark:bg-emerald-400'
                : del.level === 'medium'
                ? 'bg-sky-500 dark:bg-sky-400'
                : del.level === 'low'
                ? 'bg-amber-500 dark:bg-amber-400'
                : 'bg-slate-300 dark:bg-slate-700';

            const barMutedClass = isDarkMode ? 'bg-slate-700/80' : 'bg-slate-300/80';
            const activeBars =
              del.level === 'high' ? 3 : del.level === 'medium' ? 2 : del.level === 'low' ? 1 : 0;

            return (
              <button
                key={del.name}
                type="button"
                onClick={() =>
                  setInspectedDelegate((prev) => (prev === del.name ? null : del.name))
                }
                title={`${del.name}: ${del.invoiceCount} ${del.invoiceCount === 1 ? 'فاتورة' : 'فواتير'} في آخر ساعة (${del.levelLabel})${del.lastInvoiceTs ? ` • آخر فاتورة: ${formatShortTime(del.lastInvoiceTs)}` : ''}`}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border text-[10px] sm:text-xs font-extrabold transition-all shrink-0 cursor-pointer ${containerTheme} ${
                  isSelected
                    ? isDarkMode
                      ? 'ring-2 ring-emerald-400/80'
                      : 'ring-2 ring-emerald-600/80'
                    : ''
                }`}
              >
                {/* Live Pulse / Status Dot */}
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                  {del.level === 'high' && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      del.level === 'high'
                        ? 'bg-emerald-500'
                        : del.level === 'medium'
                        ? 'bg-sky-500'
                        : del.level === 'low'
                        ? 'bg-amber-500'
                        : isDarkMode
                        ? 'bg-slate-600'
                        : 'bg-slate-400'
                    }`}
                  />
                </span>

                {/* Delegate Name */}
                <span className="whitespace-nowrap leading-none">{del.name}</span>

                {/* 3-Bar Visual Intensity Signal */}
                <span className="inline-flex items-end gap-[1.5px] h-2.5 shrink-0" aria-hidden="true">
                  <span
                    className={`w-[2.5px] h-1 rounded-xs ${
                      activeBars >= 1 ? barActiveClass : barMutedClass
                    }`}
                  />
                  <span
                    className={`w-[2.5px] h-1.5 rounded-xs ${
                      activeBars >= 2 ? barActiveClass : barMutedClass
                    }`}
                  />
                  <span
                    className={`w-[2.5px] h-2.5 rounded-xs ${
                      activeBars >= 3 ? barActiveClass : barMutedClass
                    }`}
                  />
                </span>

                {/* Exact Last-Hour Invoice Count */}
                <span className={`font-mono font-black text-[10px] sm:text-[11px] leading-none ${countColor}`}>
                  {del.invoiceCount}
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend Hint on Desktop */}
        <div
          className={`hidden md:flex items-center gap-2 shrink-0 text-[9px] font-bold pr-2 border-r ${
            isDarkMode ? 'border-slate-800 text-slate-400' : 'border-slate-300 text-slate-500'
          }`}
          title="مستويات النشاط: 0 خامل • 3+ خفيف • 7+ جيد • 10+ مرتفع"
        >
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>10+</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
            <span>7+</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>3+</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-600" />
            <span>0</span>
          </span>
        </div>
      </div>

      {/* Compact Inspected Delegate Detail Strip */}
      {inspectedStat && (
        <div
          className={`border-t text-[10px] sm:text-xs font-bold ${
            isDarkMode
              ? 'bg-slate-900/95 border-slate-800 text-slate-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="max-w-5xl mx-auto px-2.5 sm:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="font-black text-emerald-600 dark:text-emerald-400">
                {inspectedStat.name}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileText className="w-3 h-3 text-slate-400" />
                <span>
                  فواتير آخر ساعة:{' '}
                  <strong className="font-mono">{inspectedStat.invoiceCount}</strong>
                </span>
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                  inspectedStat.level === 'high'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : inspectedStat.level === 'medium'
                    ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                    : inspectedStat.level === 'low'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                }`}
              >
                {inspectedStat.levelLabel}
              </span>
              {inspectedStat.lastInvoiceTs && (
                <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <Clock className="w-3 h-3" />
                  <span>آخر فاتورة:</span>
                  <span className="font-mono" dir="ltr">
                    {formatShortTime(inspectedStat.lastInvoiceTs)}
                  </span>
                  {inspectedStat.lastCustomerName && (
                    <span className="truncate max-w-[140px]">
                      ({inspectedStat.lastCustomerName})
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {onSelectDelegate && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectDelegate(
                      selectedDelegate === inspectedStat.name ? 'الكل' : inspectedStat.name
                    );
                    setInspectedDelegate(null);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-black cursor-pointer transition-colors ${
                    selectedDelegate === inspectedStat.name
                      ? isDarkMode
                        ? 'bg-rose-950/70 border-rose-500/50 text-rose-200 hover:bg-rose-900/70'
                        : 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100'
                      : isDarkMode
                      ? 'bg-emerald-900/50 border-emerald-600/50 text-emerald-300 hover:bg-emerald-800/60'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  {selectedDelegate === inspectedStat.name ? (
                    <X className="w-2.5 h-2.5" />
                  ) : (
                    <Filter className="w-2.5 h-2.5" />
                  )}
                  <span>
                    {selectedDelegate === inspectedStat.name
                      ? 'إلغاء التصفية'
                      : 'تصفية لهذا المندوب'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setInspectedDelegate(null)}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                title="إغلاق"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
