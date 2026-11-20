import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertOctagon,
  AlertTriangle,
  Calendar,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileX,
  Filter,
  Image as ImageIcon,
  Layers,
  MapPin,
  Phone,
  Search,
  Store,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  DailyUnvisitedSnapshot,
  EndOfDayUnvisitedShop,
  UnsuccessfulVisit,
} from '../types';
import { formatEnglishDate } from '../utils/dateUtils';

interface UnsuccessfulVisitsSectionProps {
  visits: UnsuccessfulVisit[];
  onDeleteVisit: (visitId: string) => Promise<void> | void;
  todayDateString: string;
  todayRouteDayName: string;
  formattedClosingTime: string;
  isPastClosing: boolean;
  completedDelegatesCount: number;
  todayLiveRedShops: EndOfDayUnvisitedShop[];
  savedRedSnapshots: DailyUnvisitedSnapshot[];
  onDeleteRedShopRow: (dateString: string, shopId: string) => Promise<void> | void;
  onDeleteRedDaySnapshot: (dateString: string) => Promise<void> | void;
  isDarkMode?: boolean;
  onNotify?: (title: string, message: string, type?: 'success' | 'reminder' | 'info') => void;
}

interface CustomerUnsuccessfulGroup {
  shopKey: string;
  customerCode: string;
  customerName: string;
  customerAddress: string;
  customerType: string;
  delegateName: string;
  delegateCode: string;
  routeDay: string;
  visits: UnsuccessfulVisit[]; // sorted chronologically (oldest -> newest)
  latestTimestamp: number;
}

interface CustomerRedGroup {
  shopKey: string;
  customerCode: string;
  customerName: string;
  customerAddress: string;
  customerType: string;
  phone: string;
  delegateName: string;
  delegateCode: string;
  routeDay: string;
  latitude?: number | null;
  longitude?: number | null;
  hasMapLocation: boolean;
  records: EndOfDayUnvisitedShop[]; // sorted chronologically by dateString (oldest -> newest)
  latestDate: string;
}

const PAGE_SIZE = 10;

const normalizeStr = (val?: string | null): string =>
  String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/\s+/g, ' ');

const buildShopKey = (customerCode?: string, customerName?: string, delegateName?: string): string => {
  const code = String(customerCode || '').trim();
  if (code) return `code::${code.toLowerCase()}`;
  return `name::${normalizeStr(customerName)}::${normalizeStr(delegateName)}`;
};

const getBaghdadDateKeyFromTs = (ts: number): string => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Baghdad',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ts));
    const y = parts.find((p) => p.type === 'year')?.value || '';
    const m = parts.find((p) => p.type === 'month')?.value || '';
    const d = parts.find((p) => p.type === 'day')?.value || '';
    return y && m && d ? `${y}-${m}-${d}` : '';
  } catch {
    return '';
  }
};

const isVisitTodayBaghdad = (visit: UnsuccessfulVisit, todayIso: string): boolean => {
  const todayFormatted = formatEnglishDate(new Date());
  if (visit.date && (visit.date === todayIso || visit.date === todayFormatted)) return true;
  if (visit.timestamp && getBaghdadDateKeyFromTs(visit.timestamp) === todayIso) return true;
  if (visit.createdAt) {
    try {
      const ts = new Date(visit.createdAt).getTime();
      if (!isNaN(ts) && getBaghdadDateKeyFromTs(ts) === todayIso) return true;
    } catch {}
  }
  return false;
};

const getClosureReasonLabel = (reason: EndOfDayUnvisitedShop['closureReason']): string => {
  if (reason === 'delegate_completed_sales') return 'أكمل المندوب يومه بدون زيارة';
  if (reason === 'closing_time_expired') return 'انتهى وقت الإغلاق بدون زيارة';
  return 'لم يصل المندوب لحد الآن';
};

export const UnsuccessfulVisitsSection: React.FC<UnsuccessfulVisitsSectionProps> = ({
  visits,
  onDeleteVisit,
  todayDateString,
  todayRouteDayName,
  formattedClosingTime,
  isPastClosing,
  completedDelegatesCount,
  todayLiveRedShops,
  savedRedSnapshots,
  onDeleteRedShopRow,
  onDeleteRedDaySnapshot,
  isDarkMode = false,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [delegateFilter, setDelegateFilter] = useState<string>('');
  const [activeSubView, setActiveSubView] = useState<'both' | 'unsuccessful' | 'red'>('both');
  const [redScopeFilter, setRedScopeFilter] = useState<'all_cumulative' | 'today_only'>('all_cumulative');
  const [onlyPinnedOnMap, setOnlyPinnedOnMap] = useState<boolean>(false);
  const [isSectionCollapsed, setIsSectionCollapsed] = useState<boolean>(false);

  // Pagination counts (always start at first 10 customers, then "عرض المزيد")
  const [todayUnsuccessfulLimit, setTodayUnsuccessfulLimit] = useState<number>(PAGE_SIZE);
  const [cumulativeUnsuccessfulLimit, setCumulativeUnsuccessfulLimit] = useState<number>(PAGE_SIZE);
  const [redShopsLimit, setRedShopsLimit] = useState<number>(PAGE_SIZE);

  // Interactive modals & delete states
  const [selectedShopKey, setSelectedShopKey] = useState<string | null>(null);
  const [confirmDeleteVisitId, setConfirmDeleteVisitId] = useState<string | null>(null);
  const [isDeletingVisitId, setIsDeletingVisitId] = useState<string | null>(null);
  const [confirmDeleteRedKey, setConfirmDeleteRedKey] = useState<string | null>(null);
  const [isDeletingRedKey, setIsDeletingRedKey] = useState<string | null>(null);
  const [confirmClearRedDay, setConfirmClearRedDay] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; title: string; subtitle?: string } | null>(null);

  // Reset pagination to 10 whenever filters change
  useEffect(() => {
    setTodayUnsuccessfulLimit(PAGE_SIZE);
    setCumulativeUnsuccessfulLimit(PAGE_SIZE);
    setRedShopsLimit(PAGE_SIZE);
  }, [searchQuery, delegateFilter, redScopeFilter, onlyPinnedOnMap]);

  // Combine today's live red shops + saved historical red snapshots (respecting dismissed IDs for today)
  const allRedRecordsCombined = useMemo<EndOfDayUnvisitedShop[]>(() => {
    const byDateAndShop = new Map<string, EndOfDayUnvisitedShop>();
    const todaySavedSnap = savedRedSnapshots.find((s) => s.dateString === todayDateString);
    const todayDismissedSet = new Set<string>(todaySavedSnap?.dismissedShopIds || []);

    // 1. Add all historical saved days (excluding today — today comes from live calculation)
    savedRedSnapshots.forEach((snap) => {
      if (!snap.dateString || snap.dateString === todayDateString) return;
      (snap.shops || []).forEach((shop) => {
        const sKey = `${shop.dateString || snap.dateString}::${buildShopKey(shop.customerCode, shop.customerName, shop.delegateName)}`;
        byDateAndShop.set(sKey, { ...shop, dateString: shop.dateString || snap.dateString });
      });
    });

    // 2. Add today's live red shops (filtering out any row explicitly dismissed by Admin today)
    todayLiveRedShops.forEach((shop) => {
      if (todayDismissedSet.has(shop.id)) return;
      const sKey = `${todayDateString}::${buildShopKey(shop.customerCode, shop.customerName, shop.delegateName)}`;
      byDateAndShop.set(sKey, { ...shop, dateString: todayDateString });
    });

    return Array.from(byDateAndShop.values());
  }, [savedRedSnapshots, todayLiveRedShops, todayDateString]);

  // All unique delegates across BOTH unsuccessful visits and red unvisited shops
  const delegatesList = useMemo(() => {
    const set = new Set<string>();
    visits.forEach((v) => {
      if (v.delegateName?.trim()) set.add(v.delegateName.trim());
    });
    allRedRecordsCombined.forEach((r) => {
      if (r.delegateName?.trim()) set.add(r.delegateName.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [visits, allRedRecordsCombined]);

  // Filtered unsuccessful visits
  const filteredVisits = useMemo(() => {
    const q = normalizeStr(searchQuery);
    const delNorm = normalizeStr(delegateFilter);
    return visits.filter((v) => {
      if (delNorm && normalizeStr(v.delegateName) !== delNorm) return false;
      if (!q) return true;
      const hay = `${v.customerName} ${v.customerCode} ${v.delegateName} ${v.reason} ${v.customerAddress || ''} ${v.routeDay || ''} ${v.date || ''}`;
      return normalizeStr(hay).includes(q);
    });
  }, [visits, searchQuery, delegateFilter]);

  // Today's unsuccessful visits (newest first)
  const todayVisits = useMemo(() => {
    return filteredVisits
      .filter((v) => isVisitTodayBaghdad(v, todayDateString))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [filteredVisits, todayDateString]);

  // Cumulative unsuccessful visits grouped BY SHOP (today + all previous days!)
  // Inside each shop, visits are sorted chronologically: Visit 1, Visit 2, Visit 3...
  const cumulativeUnsuccessfulGroups = useMemo<CustomerUnsuccessfulGroup[]>(() => {
    const map = new Map<string, CustomerUnsuccessfulGroup>();

    filteredVisits.forEach((v) => {
      const shopKey = buildShopKey(v.customerCode, v.customerName, v.delegateName);
      let group = map.get(shopKey);
      if (!group) {
        group = {
          shopKey,
          customerCode: String(v.customerCode || '').trim(),
          customerName: v.customerName || 'غير مسمى',
          customerAddress: v.customerAddress || '',
          customerType: v.customerType || 'مفرد',
          delegateName: v.delegateName || '',
          delegateCode: v.delegateCode || '',
          routeDay: v.routeDay || '',
          visits: [],
          latestTimestamp: 0,
        };
        map.set(shopKey, group);
      }
      group.visits.push(v);
      const ts = v.timestamp || (v.createdAt ? new Date(v.createdAt).getTime() : 0) || 0;
      if (ts > group.latestTimestamp) {
        group.latestTimestamp = ts;
        if (v.customerAddress) group.customerAddress = v.customerAddress;
        if (v.delegateName) group.delegateName = v.delegateName;
        if (v.routeDay) group.routeDay = v.routeDay;
      }
    });

    const list = Array.from(map.values());
    list.forEach((g) => {
      // Chronological order: 1st visit -> 2nd visit -> 3rd visit
      g.visits.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    });
    // Sort shops by most visits first, then most recent visit
    list.sort((a, b) => {
      if (b.visits.length !== a.visits.length) return b.visits.length - a.visits.length;
      return b.latestTimestamp - a.latestTimestamp;
    });
    return list;
  }, [filteredVisits]);

  // Max visit columns across currently displayed cumulative unsuccessful shops (at least 2 for clarity when data exists)
  const displayedCumulativeUnsuccessful = useMemo(
    () => cumulativeUnsuccessfulGroups.slice(0, cumulativeUnsuccessfulLimit),
    [cumulativeUnsuccessfulGroups, cumulativeUnsuccessfulLimit]
  );

  const maxUnsuccessfulColumns = useMemo(() => {
    if (displayedCumulativeUnsuccessful.length === 0) return 0;
    return Math.max(1, ...displayedCumulativeUnsuccessful.map((g) => g.visits.length));
  }, [displayedCumulativeUnsuccessful]);

  // Filtered RED (unvisited — neither successful nor unsuccessful) records
  const filteredRedRecords = useMemo(() => {
    const q = normalizeStr(searchQuery);
    const delNorm = normalizeStr(delegateFilter);
    return allRedRecordsCombined.filter((r) => {
      if (redScopeFilter === 'today_only' && r.dateString !== todayDateString) return false;
      if (onlyPinnedOnMap && !r.hasMapLocation) return false;
      if (delNorm && normalizeStr(r.delegateName) !== delNorm) return false;
      if (!q) return true;
      const hay = `${r.customerName} ${r.customerCode} ${r.delegateName} ${r.delegateCode || ''} ${r.customerAddress || ''} ${r.routeDay || ''} ${r.dateString || ''}`;
      return normalizeStr(hay).includes(q);
    });
  }, [allRedRecordsCombined, redScopeFilter, todayDateString, onlyPinnedOnMap, delegateFilter, searchQuery]);

  // Group RED records BY SHOP (accumulates today + previous days per shop!)
  const groupedRedShops = useMemo<CustomerRedGroup[]>(() => {
    const map = new Map<string, CustomerRedGroup>();

    filteredRedRecords.forEach((rec) => {
      const shopKey = buildShopKey(rec.customerCode, rec.customerName, rec.delegateName);
      let group = map.get(shopKey);
      if (!group) {
        group = {
          shopKey,
          customerCode: String(rec.customerCode || '').trim(),
          customerName: rec.customerName || 'غير مسمى',
          customerAddress: rec.customerAddress || '',
          customerType: rec.customerType || 'مفرد',
          phone: rec.phone || '',
          delegateName: rec.delegateName || '',
          delegateCode: rec.delegateCode || '',
          routeDay: rec.routeDay || '',
          latitude: rec.latitude ?? null,
          longitude: rec.longitude ?? null,
          hasMapLocation: Boolean(rec.hasMapLocation),
          records: [],
          latestDate: rec.dateString || '',
        };
        map.set(shopKey, group);
      }
      group.records.push(rec);
      if ((rec.dateString || '') >= group.latestDate) {
        group.latestDate = rec.dateString || group.latestDate;
        if (rec.customerAddress) group.customerAddress = rec.customerAddress;
        if (rec.phone) group.phone = rec.phone;
        if (rec.hasMapLocation && rec.latitude != null && rec.longitude != null) {
          group.hasMapLocation = true;
          group.latitude = rec.latitude;
          group.longitude = rec.longitude;
        }
      }
    });

    const list = Array.from(map.values());
    list.forEach((g) => {
      // Chronological order: 1st missed day -> 2nd missed day -> ...
      g.records.sort((a, b) => (a.dateString || '').localeCompare(b.dateString || ''));
    });
    // Sort by latest date desc, then most missed times desc, then delegate
    list.sort((a, b) => {
      const dateCmp = b.latestDate.localeCompare(a.latestDate);
      if (dateCmp !== 0) return dateCmp;
      if (b.records.length !== a.records.length) return b.records.length - a.records.length;
      return a.delegateName.localeCompare(b.delegateName, 'ar');
    });
    return list;
  }, [filteredRedRecords]);

  const displayedRedGroups = useMemo(
    () => groupedRedShops.slice(0, redShopsLimit),
    [groupedRedShops, redShopsLimit]
  );

  const maxRedColumns = useMemo(() => {
    if (displayedRedGroups.length === 0) return 0;
    return Math.max(1, ...displayedRedGroups.map((g) => g.records.length));
  }, [displayedRedGroups]);

  // Delegate breakdown for RED shops
  const redDelegateBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    groupedRedShops.forEach((g) => {
      const name = (g.delegateName || 'غير محدد').trim();
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [groupedRedShops]);

  // Selected shop full details (combines ALL unsuccessful visits + ALL red missed days for that shop)
  const selectedShopDetails = useMemo(() => {
    if (!selectedShopKey) return null;

    const shopVisits = visits
      .filter((v) => buildShopKey(v.customerCode, v.customerName, v.delegateName) === selectedShopKey)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const shopRedRecords = allRedRecordsCombined
      .filter((r) => buildShopKey(r.customerCode, r.customerName, r.delegateName) === selectedShopKey)
      .sort((a, b) => (a.dateString || '').localeCompare(b.dateString || ''));

    if (shopVisits.length === 0 && shopRedRecords.length === 0) return null;

    const latestVisit = shopVisits[shopVisits.length - 1];
    const latestRed = shopRedRecords[shopRedRecords.length - 1];

    return {
      shopKey: selectedShopKey,
      customerName: latestVisit?.customerName || latestRed?.customerName || '',
      customerCode: latestVisit?.customerCode || latestRed?.customerCode || '',
      customerAddress: latestVisit?.customerAddress || latestRed?.customerAddress || '',
      customerType: latestVisit?.customerType || latestRed?.customerType || 'مفرد',
      phone: latestRed?.phone || '',
      delegateName: latestVisit?.delegateName || latestRed?.delegateName || '',
      delegateCode: latestVisit?.delegateCode || latestRed?.delegateCode || '',
      routeDay: latestVisit?.routeDay || latestRed?.routeDay || '',
      latitude: latestRed?.latitude ?? latestVisit?.latitude ?? null,
      longitude: latestRed?.longitude ?? latestVisit?.longitude ?? null,
      visits: shopVisits,
      redRecords: shopRedRecords,
    };
  }, [selectedShopKey, visits, allRedRecordsCombined]);

  const handleDeleteVisitConfirm = async (visitId: string) => {
    try {
      setIsDeletingVisitId(visitId);
      await onDeleteVisit(visitId);
      setConfirmDeleteVisitId(null);
    } finally {
      setIsDeletingVisitId(null);
    }
  };

  const handleDeleteRedConfirm = async (dateString: string, shopId: string) => {
    const key = `${dateString}__${shopId}`;
    try {
      setIsDeletingRedKey(key);
      await onDeleteRedShopRow(dateString, shopId);
      setConfirmDeleteRedKey(null);
    } finally {
      setIsDeletingRedKey(null);
    }
  };

  const handleExportUnsuccessfulExcel = () => {
    if (cumulativeUnsuccessfulGroups.length === 0) return;
    try {
      const maxCols = Math.max(1, ...cumulativeUnsuccessfulGroups.map((g) => g.visits.length));
      const rows = cumulativeUnsuccessfulGroups.map((g, idx) => {
        const row: Record<string, string | number> = {
          'ت': idx + 1,
          'اسم المحل / الزبون': g.customerName,
          'كود الزبون': g.customerCode || '-',
          'النوع': g.customerType || 'مفرد',
          'العنوان': g.customerAddress || '-',
          'المندوب': g.delegateName || '-',
          'المسار': g.routeDay || '-',
          'عدد الزيارات غير الناجحة': g.visits.length,
        };
        for (let i = 0; i < maxCols; i++) {
          const v = g.visits[i];
          row[`تاريخ الزيارة ${i + 1}`] = v ? `${v.date}${v.timeFormatted ? ` (${v.timeFormatted})` : ''}` : '-';
          row[`سبب الزيارة ${i + 1}`] = v ? v.reason : '-';
        }
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الزيارات غير الناجحة');
      XLSX.writeFile(wb, `الزيارات_غير_الناجحة_للمحلات_${todayDateString}.xlsx`);
      onNotify?.('تم التصدير بنجاح 📥', `تم تصدير سجل ${cumulativeUnsuccessfulGroups.length} محل إلى Excel.`, 'success');
    } catch (err) {
      console.error('Export unsuccessful visits error:', err);
    }
  };

  const handleExportRedShopsExcel = () => {
    if (groupedRedShops.length === 0) return;
    try {
      const maxCols = Math.max(1, ...groupedRedShops.map((g) => g.records.length));
      const rows = groupedRedShops.map((g, idx) => {
        const row: Record<string, string | number> = {
          'ت': idx + 1,
          'اسم المحل / الزبون': g.customerName,
          'كود الزبون': g.customerCode || '-',
          'النوع': g.customerType || 'مفرد',
          'العنوان': g.customerAddress || '-',
          'الهاتف': g.phone || '-',
          'المندوب': g.delegateName || '-',
          'المسار': g.routeDay || '-',
          'عدد مرات عدم الزيارة (أحمر)': g.records.length,
        };
        for (let i = 0; i < maxCols; i++) {
          const rec = g.records[i];
          row[`تاريخ عدم الزيارة ${i + 1}`] = rec ? rec.dateString : '-';
          row[`الحالة ${i + 1}`] = rec ? getClosureReasonLabel(rec.closureReason) : '-';
        }
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'المحلات الحمراء غير المزارة');
      XLSX.writeFile(wb, `المحلات_الحمراء_غير_المزارة_${todayDateString}.xlsx`);
      onNotify?.('تم التصدير بنجاح 📥', `تم تصدير ${groupedRedShops.length} محل أحمر غير مُزار إلى Excel.`, 'success');
    } catch (err) {
      console.error('Export red shops error:', err);
    }
  };

  const todayRedCount = useMemo(
    () => allRedRecordsCombined.filter((r) => r.dateString === todayDateString).length,
    [allRedRecordsCombined, todayDateString]
  );

  return (
    <section
      id="unsuccessful-visits-section"
      className={`rounded-3xl border shadow-xl p-4 sm:p-6 my-6 transition-all text-right space-y-6 ${
        isDarkMode
          ? 'bg-slate-900/95 border-amber-900/40 shadow-black/40'
          : 'bg-gradient-to-b from-white to-amber-50/20 border-amber-200/80 shadow-amber-900/5'
      }`}
      dir="rtl"
    >
      {/* Main Section Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shadow-sm shadow-amber-500/20 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                معلومات الزيارات غير الناجحة للمحلات
              </h3>
              <span className="text-xs font-black px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                خاص بالأدمن فقط 🛡️
              </span>
              <span className="text-xs font-mono font-black px-2.5 py-0.5 rounded-full bg-amber-600 text-white">
                غير ناجحة: {cumulativeUnsuccessfulGroups.length} محل ({filteredVisits.length} زيارة)
              </span>
              <span className="text-xs font-mono font-black px-2.5 py-0.5 rounded-full bg-rose-600 text-white">
                حمراء لم تُزار: {groupedRedShops.length} محل
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">
              يُحدَّث تلقائياً كل يوم لإضافة محلات المسار الحالي مع المسارات السابقة (الزيارات الناجحة بفاتورة لا تُدرج هنا أبداً). اضغط على أي محل لعرض كامل تاريخه وعدد زياراته.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsSectionCollapsed((prev) => !prev)}
          className="self-end sm:self-auto px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          {isSectionCollapsed ? (
            <>
              <span>عرض القسم</span>
              <ChevronDown className="w-4 h-4" />
            </>
          ) : (
            <>
              <span>طي القسم</span>
              <ChevronUp className="w-4 h-4" />
            </>
          )}
        </button>
      </div>

      {!isSectionCollapsed && (
        <>
          {/* Shared Controls: Sub-section Switcher, Search, Delegate Filter */}
          <div className="space-y-3">
            {/* 2-Paragraph View Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveSubView('both')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubView === 'both'
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>عرض الفقرتين معاً</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubView('unsuccessful')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubView === 'unsuccessful'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-amber-300/70 dark:border-amber-800 hover:bg-amber-100'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-white/60" />
                <span>1- المحلات الغير ناجحة زيارتهم ({cumulativeUnsuccessfulGroups.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubView('red')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubView === 'red'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border-rose-300/70 dark:border-rose-800 hover:bg-rose-100'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 border border-white/60" />
                <span>2- المحلات الحمراء بدون زيارة ({groupedRedShops.length})</span>
              </button>
            </div>

            {/* Search & Delegate Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث باسم المحل، كود الزبون، المندوب، السبب، المسار أو التاريخ..."
                  className="w-full pr-10 pl-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {delegatesList.length > 0 && (
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                  <select
                    value={delegateFilter}
                    onChange={(e) => setDelegateFilter(e.target.value)}
                    className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none transition-all cursor-pointer"
                  >
                    <option value="">جميع المندوبين ({delegatesList.length})</option>
                    {delegatesList.map((del) => (
                      <option key={del} value={del}>
                        {del}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* ===================================================================== */}
          {/* الفقرة 1: المحلات الغير ناجحة زيارتهم (اليوم + السجل التراكمي بالجدول) */}
          {/* ===================================================================== */}
          {(activeSubView === 'both' || activeSubView === 'unsuccessful') && (
            <div
              className={`rounded-2xl border p-4 sm:p-5 space-y-5 ${
                isDarkMode
                  ? 'bg-slate-950/50 border-amber-900/50'
                  : 'bg-amber-50/35 border-amber-200/90'
              }`}
            >
              {/* Sub-section 1 Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-amber-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="w-7 h-7 rounded-xl bg-amber-500 text-white font-black text-xs flex items-center justify-center shadow-xs shrink-0">
                    1
                  </span>
                  <div>
                    <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                      <span>الفقرة الأولى: المحلات الغير ناجحة زيارتهم</span>
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                        {cumulativeUnsuccessfulGroups.length} محل • {filteredVisits.length} زيارة
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                      يعرض زيارات اليوم + السجل التراكمي للمحلات مع كل زيارة (التاريخ والسبب) جنباً إلى جنب. اضغط على أي محل لمعرفة كامل زياراته.
                    </p>
                  </div>
                </div>

                {cumulativeUnsuccessfulGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportUnsuccessfulExcel}
                    className="self-end sm:self-auto px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تصدير Excel</span>
                  </button>
                )}
              </div>

              {/* 1-A: زيارات المسار اليوم (Today's Unsuccessful Visits Table) */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                    <h5 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-100">
                      زيارات المسار اليوم ({todayRouteDayName})
                    </h5>
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                      {todayVisits.length} زيارة اليوم
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-slate-400" dir="ltr">
                    {todayDateString}
                  </span>
                </div>

                {todayVisits.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-amber-300/70 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 text-center">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      لا توجد زيارات غير ناجحة مسجلة لمسار اليوم حتى الآن.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-2xl border border-amber-200 dark:border-slate-700 shadow-xs">
                      <table className="w-full text-right border-collapse text-xs">
                        <thead>
                          <tr className="bg-amber-600 dark:bg-amber-900/90 text-white">
                            <th className="py-2.5 px-3 font-black text-center w-10">ت</th>
                            <th className="py-2.5 px-3 font-black min-w-[175px]">اسم المحل / الزبون</th>
                            <th className="py-2.5 px-3 font-black whitespace-nowrap">كود الزبون</th>
                            <th className="py-2.5 px-3 font-black whitespace-nowrap">المندوب</th>
                            <th className="py-2.5 px-3 font-black whitespace-nowrap">التاريخ والوقت</th>
                            <th className="py-2.5 px-3 font-black min-w-[200px]">السبب</th>
                            <th className="py-2.5 px-3 font-black text-center whitespace-nowrap">صورة البراد</th>
                            <th className="py-2.5 px-3 font-black text-center whitespace-nowrap">إجراء</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                          {todayVisits.slice(0, todayUnsuccessfulLimit).map((visit, idx) => {
                            const shopKey = buildShopKey(visit.customerCode, visit.customerName, visit.delegateName);
                            const isConfirming = confirmDeleteVisitId === visit.id;
                            const isDeleting = isDeletingVisitId === visit.id;

                            return (
                              <tr
                                key={visit.id}
                                className="hover:bg-amber-50/70 dark:hover:bg-amber-950/20 transition-colors"
                              >
                                <td className="py-2.5 px-3 text-center font-mono font-black text-slate-500">
                                  {idx + 1}
                                </td>
                                <td className="py-2.5 px-3">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedShopKey(shopKey)}
                                    className="text-right group cursor-pointer"
                                  >
                                    <div className="font-black text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 underline-offset-2 group-hover:underline">
                                      {visit.customerName}
                                    </div>
                                    {visit.customerAddress && (
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                                        {visit.customerAddress}
                                      </div>
                                    )}
                                  </button>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span className="font-mono font-black text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                    {visit.customerCode || '-'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap font-bold text-slate-800 dark:text-slate-200">
                                  {visit.delegateName}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                  {visit.date} {visit.timeFormatted ? `• ${visit.timeFormatted}` : ''}
                                </td>
                                <td className="py-2.5 px-3 font-bold text-amber-900 dark:text-amber-200">
                                  {visit.reason}
                                </td>
                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  {visit.refrigeratorPhoto ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setLightboxImage({
                                          src: visit.refrigeratorPhoto!,
                                          title: `صورة براد: ${visit.customerName}`,
                                          subtitle: `المندوب: ${visit.delegateName} | السبب: ${visit.reason}`,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-[10px] font-black cursor-pointer"
                                    >
                                      <ImageIcon className="w-3.5 h-3.5" />
                                      <span>معاينة</span>
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">بدون صورة</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedShopKey(shopKey)}
                                      className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 text-[10px] font-black cursor-pointer"
                                      title="فتح سجل المحل الكامل"
                                    >
                                      التفاصيل
                                    </button>
                                    {isConfirming ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={isDeleting}
                                          onClick={() => handleDeleteVisitConfirm(visit.id)}
                                          className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black cursor-pointer"
                                        >
                                          {isDeleting ? '...' : 'حذف'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteVisitId(null)}
                                          className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold cursor-pointer"
                                        >
                                          إلغاء
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteVisitId(visit.id)}
                                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                        title="حذف هذه الزيارة"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination for Today's Unsuccessful Visits (First 10 -> عرض المزيد) */}
                    {todayVisits.length > PAGE_SIZE && (
                      <div className="flex items-center justify-center gap-2 pt-1">
                        {todayUnsuccessfulLimit < todayVisits.length ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setTodayUnsuccessfulLimit((prev) => prev + PAGE_SIZE)}
                              className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-black shadow-xs cursor-pointer transition-colors"
                            >
                              عرض المزيد (المتبقي {todayVisits.length - todayUnsuccessfulLimit} زبون)
                            </button>
                            <button
                              type="button"
                              onClick={() => setTodayUnsuccessfulLimit(todayVisits.length)}
                              className="px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-950/30 cursor-pointer"
                            >
                              عرض الكل ({todayVisits.length})
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setTodayUnsuccessfulLimit(PAGE_SIZE)}
                            className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
                          >
                            عرض أول 10 زبائن فقط
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 1-B: الزيارات القديمة والتراكمية حسب المحل (المحل وأمامه الزيارة 1، الزيارة 2، الزيارة 3...) */}
              <div className="space-y-2.5 pt-3 border-t border-amber-200/70 dark:border-slate-800">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <h5 className="font-black text-xs sm:text-sm text-slate-900 dark:text-white">
                      الزيارات القديمة والحالية حسب المحل (تراكمي — المسار الحالي + المسارات السابقة)
                    </h5>
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {cumulativeUnsuccessfulGroups.length} محل
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                    انقر على أي محل لفتح تفاصيله وعدد زياراته الكاملة
                  </span>
                </div>

                {cumulativeUnsuccessfulGroups.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/40 text-center">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      لا توجد زيارات غير ناجحة مسجلة في السجل التراكمي حتى الآن.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-2xl border border-amber-200/90 dark:border-slate-700 shadow-xs">
                      <table className="w-full text-right border-collapse text-xs">
                        <thead>
                          <tr className="bg-[#1f4e78] text-white">
                            <th className="py-2.5 px-3 font-black text-center w-10 sticky right-0 bg-[#1f4e78] z-10">ت</th>
                            <th className="py-2.5 px-3 font-black min-w-[185px]">اسم المحل / الزبون</th>
                            <th className="py-2.5 px-3 font-black whitespace-nowrap">المندوب / المسار</th>
                            <th className="py-2.5 px-3 font-black text-center whitespace-nowrap">عدد الزيارات</th>
                            {Array.from({ length: maxUnsuccessfulColumns }).map((_, colIdx) => (
                              <th
                                key={`visit_col_${colIdx}`}
                                className="py-2.5 px-3 font-black min-w-[200px] border-r border-white/15 whitespace-nowrap"
                              >
                                الزيارة {colIdx + 1} (السبب والتاريخ)
                              </th>
                            ))}
                            <th className="py-2.5 px-3 font-black text-center whitespace-nowrap border-r border-white/15">
                              سجل المحل
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                          {displayedCumulativeUnsuccessful.map((group, idx) => (
                            <tr
                              key={group.shopKey}
                              onClick={() => setSelectedShopKey(group.shopKey)}
                              className="hover:bg-amber-50/70 dark:hover:bg-amber-950/20 transition-colors cursor-pointer"
                            >
                              <td className="py-2.5 px-3 text-center font-mono font-black text-slate-500">
                                {idx + 1}
                              </td>

                              {/* Shop Name + Code */}
                              <td className="py-2.5 px-3">
                                <div className="font-black text-slate-900 dark:text-white text-xs sm:text-[13px] flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                  <span className="hover:text-amber-600 dark:hover:text-amber-400">
                                    {group.customerName}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  {group.customerCode && (
                                    <span className="font-mono text-[10px] font-black px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                      كود: {group.customerCode}
                                    </span>
                                  )}
                                  {group.customerAddress && (
                                    <span className="text-[10px] text-slate-400 truncate max-w-[160px]" title={group.customerAddress}>
                                      {group.customerAddress}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Delegate & Route */}
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <div className="font-black text-slate-800 dark:text-slate-200">
                                  {group.delegateName || '-'}
                                </div>
                                {group.routeDay && (
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                                    مسار: {group.routeDay}
                                  </div>
                                )}
                              </td>

                              {/* Total Unsuccessful Visits Count */}
                              <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/35 font-black text-[11px]">
                                  {group.visits.length} {group.visits.length === 1 ? 'زيارة' : group.visits.length === 2 ? 'زيارتان' : 'زيارات'}
                                </span>
                              </td>

                              {/* Side-by-side Visits Columns: Visit 1, Visit 2, Visit 3... */}
                              {Array.from({ length: maxUnsuccessfulColumns }).map((_, colIdx) => {
                                const v = group.visits[colIdx];
                                if (!v) {
                                  return (
                                    <td
                                      key={`${group.shopKey}_empty_${colIdx}`}
                                      className="py-2.5 px-3 text-center text-slate-300 dark:text-slate-700 border-r border-slate-100 dark:border-slate-800"
                                    >
                                      —
                                    </td>
                                  );
                                }
                                return (
                                  <td
                                    key={v.id}
                                    className="py-2 px-3 align-top border-r border-slate-100 dark:border-slate-800 max-w-[240px]"
                                  >
                                    <div className="p-2 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/50 space-y-1">
                                      <div className="flex items-center justify-between gap-1 text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">
                                        <span className="flex items-center gap-1">
                                          <Calendar className="w-3 h-3 text-amber-500 shrink-0" />
                                          <span>{v.date}</span>
                                        </span>
                                        {v.refrigeratorPhoto && (
                                          <span
                                            className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-black"
                                            title="توجد صورة للبراد"
                                          >
                                            <Camera className="w-3 h-3" />
                                          </span>
                                        )}
                                      </div>
                                      <p
                                        className="text-[11px] font-black text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug"
                                        title={v.reason}
                                      >
                                        {v.reason}
                                      </p>
                                    </div>
                                  </td>
                                );
                              })}

                              {/* Open Details Button */}
                              <td
                                className="py-2.5 px-3 text-center whitespace-nowrap border-r border-slate-100 dark:border-slate-800"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => setSelectedShopKey(group.shopKey)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#1f4e78] hover:bg-[#173a5a] text-white text-[11px] font-black shadow-xs cursor-pointer transition-colors"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>فتح السجل</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination for Cumulative Unsuccessful Visits (First 10 -> عرض المزيد) */}
                    {cumulativeUnsuccessfulGroups.length > PAGE_SIZE && (
                      <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          يتم عرض {displayedCumulativeUnsuccessful.length} من أصل {cumulativeUnsuccessfulGroups.length} زبون
                        </span>
                        {cumulativeUnsuccessfulLimit < cumulativeUnsuccessfulGroups.length ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setCumulativeUnsuccessfulLimit((prev) => prev + PAGE_SIZE)}
                              className="px-4 py-1.5 rounded-xl bg-[#1f4e78] hover:bg-[#173a5a] text-white text-xs font-black shadow-xs cursor-pointer transition-colors"
                            >
                              عرض المزيد (+{Math.min(PAGE_SIZE, cumulativeUnsuccessfulGroups.length - cumulativeUnsuccessfulLimit)})
                            </button>
                            <button
                              type="button"
                              onClick={() => setCumulativeUnsuccessfulLimit(cumulativeUnsuccessfulGroups.length)}
                              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              عرض الكل
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCumulativeUnsuccessfulLimit(PAGE_SIZE)}
                            className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
                          >
                            تقليص إلى أول 10 زبائن
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* الفقرة 2: المحلات التي بقيت بدون زيارة (حمراء في الخريطة — لم يصل لها المندوب) */}
          {/* ===================================================================== */}
          {(activeSubView === 'both' || activeSubView === 'red') && (
            <div
              className={`rounded-2xl border p-4 sm:p-5 space-y-4 ${
                isDarkMode
                  ? 'bg-slate-950/60 border-rose-900/50'
                  : 'bg-rose-50/40 border-rose-200/90'
              }`}
            >
              {/* Sub-section 2 Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-rose-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-xl bg-rose-600 text-white font-black text-xs flex items-center justify-center shadow-xs shrink-0">
                    2
                  </span>
                  <div>
                    <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                      <span>
                        الفقرة الثانية: المحلات التي بقيت بدون زيارة ناجحة أو غير ناجحة وبقيت بلون أحمر في الخريطة
                      </span>
                      <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-rose-600 text-white">
                        {groupedRedShops.length} محل ({filteredRedRecords.length} سجل)
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                      المحلات التي لم يصل إليها المندوب لحد الآن (بدون فاتورة وبدون زيارة غير ناجحة) — تتراكم يومياً مع المسارات السابقة وتختفي تلقائياً من مسار اليوم فور إصدار فاتورة أو توثيق زيارة.
                    </p>
                  </div>
                </div>

                {groupedRedShops.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportRedShopsExcel}
                    className="self-end sm:self-auto px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تصدير Excel</span>
                  </button>
                )}
              </div>

              {/* Status & Scope Filter Bar for Sub-section 2 */}
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRedScopeFilter('all_cumulative')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                      redScopeFilter === 'all_cumulative'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    المسار الحالي + المسارات السابقة (تراكمي)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRedScopeFilter('today_only')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                      redScopeFilter === 'today_only'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    مسار اليوم فقط ({todayRouteDayName} — {todayRedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyPinnedOnMap((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer flex items-center gap-1 ${
                      onlyPinnedOnMap
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{onlyPinnedOnMap ? 'المثبتة بالخريطة فقط ✓' : 'المثبتة بالخريطة فقط'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isPastClosing ? 'bg-rose-600' : 'bg-red-500 animate-pulse'
                    }`}
                  />
                  <span>
                    {isPastClosing
                      ? `بعد الإغلاق الرسمي (${formattedClosingTime})`
                      : completedDelegatesCount > 0
                      ? `مندوبون أكملوا اليوم: ${completedDelegatesCount} • الإغلاق: ${formattedClosingTime}`
                      : `متابعة مباشرة لمسار اليوم (${todayRouteDayName}) • الإغلاق: ${formattedClosingTime}`}
                  </span>
                </div>
              </div>

              {/* Delegate Breakdown Chips */}
              {redDelegateBreakdown.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-black text-slate-500 dark:text-slate-400">
                    المحلات الحمراء حسب المندوب:
                  </span>
                  {redDelegateBreakdown.map(([del, count]) => {
                    const isSelected = normalizeStr(delegateFilter) === normalizeStr(del);
                    return (
                      <button
                        key={del}
                        type="button"
                        onClick={() => setDelegateFilter(isSelected ? '' : del)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-rose-600 text-white border-rose-600'
                            : isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-rose-500'
                            : 'bg-white border-rose-200 text-slate-800 hover:border-rose-400'
                        }`}
                      >
                        <User className="w-3 h-3 opacity-75" />
                        <span>{del}</span>
                        <span
                          className={`px-1.5 rounded font-mono text-[10px] ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Red Shops Cumulative Table (First 10 -> عرض المزيد) */}
              {groupedRedShops.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-rose-300/70 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 text-center space-y-1">
                  <AlertOctagon className="w-7 h-7 text-emerald-500 mx-auto" />
                  <p className="text-xs font-black text-slate-700 dark:text-slate-200">
                    لا توجد محلات متبقية باللون الأحمر تطابق الفلاتر الحالية ✅
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-2xl border border-rose-200/90 dark:border-slate-700 shadow-xs">
                    <table className="w-full text-right border-collapse text-xs">
                      <thead>
                        <tr className="bg-rose-700 dark:bg-rose-950 text-white">
                          <th className="py-2.5 px-3 font-black text-center w-10">ت</th>
                          <th className="py-2.5 px-3 font-black whitespace-nowrap">الحالة بالخريطة</th>
                          <th className="py-2.5 px-3 font-black min-w-[185px]">اسم المحل / الزبون</th>
                          <th className="py-2.5 px-3 font-black whitespace-nowrap">المندوب / المسار</th>
                          <th className="py-2.5 px-3 font-black text-center whitespace-nowrap">عدد مرات عدم الزيارة</th>
                          {Array.from({ length: maxRedColumns }).map((_, colIdx) => (
                            <th
                              key={`red_col_${colIdx}`}
                              className="py-2.5 px-3 font-black min-w-[170px] border-r border-white/15 whitespace-nowrap"
                            >
                              عدم زيارة {colIdx + 1} (التاريخ والحالة)
                            </th>
                          ))}
                          <th className="py-2.5 px-3 font-black text-center whitespace-nowrap border-r border-white/15">
                            سجل المحل
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {displayedRedGroups.map((group, idx) => (
                          <tr
                            key={group.shopKey}
                            onClick={() => setSelectedShopKey(group.shopKey)}
                            className="hover:bg-rose-50/70 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
                          >
                            <td className="py-2.5 px-3 text-center font-mono font-black text-slate-500">
                              {idx + 1}
                            </td>

                            {/* Map Status (Red) */}
                            <td className="py-2.5 px-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col gap-1 items-start">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-600/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 font-black text-[10px]">
                                  <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" />
                                  <span>لم يُزار (أحمر)</span>
                                </span>
                                {group.hasMapLocation && group.latitude != null && group.longitude != null ? (
                                  <a
                                    href={`https://www.google.com/maps?q=${group.latitude},${group.longitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 hover:underline"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>فتح بالخريطة</span>
                                  </a>
                                ) : (
                                  <span className="text-[10px] text-slate-400">بدون موقع GPS</span>
                                )}
                              </div>
                            </td>

                            {/* Shop Name + Code + Address */}
                            <td className="py-2.5 px-3">
                              <div className="font-black text-slate-900 dark:text-white text-xs sm:text-[13px] hover:text-rose-600 dark:hover:text-rose-400">
                                {group.customerName}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {group.customerCode && (
                                  <span className="font-mono text-[10px] font-black px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    كود: {group.customerCode}
                                  </span>
                                )}
                                {group.customerAddress && (
                                  <span className="text-[10px] text-slate-400 truncate max-w-[160px]" title={group.customerAddress}>
                                    {group.customerAddress}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Delegate & Route */}
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <div className="font-black text-slate-800 dark:text-slate-200">
                                {group.delegateName || '-'}
                              </div>
                              {group.routeDay && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                                  مسار: {group.routeDay}
                                </div>
                              )}
                            </td>

                            {/* Total Missed Count */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/35 font-black text-[11px]">
                                {group.records.length} {group.records.length === 1 ? 'مرة' : group.records.length === 2 ? 'مرتان' : 'مرات'}
                              </span>
                            </td>

                            {/* Side-by-side Missed Day Columns */}
                            {Array.from({ length: maxRedColumns }).map((_, colIdx) => {
                              const rec = group.records[colIdx];
                              if (!rec) {
                                return (
                                  <td
                                    key={`${group.shopKey}_red_empty_${colIdx}`}
                                    className="py-2.5 px-3 text-center text-slate-300 dark:text-slate-700 border-r border-rose-100/70 dark:border-slate-800"
                                  >
                                    —
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={`${rec.dateString}_${rec.id}`}
                                  className="py-2 px-3 align-top border-r border-rose-100/70 dark:border-slate-800"
                                >
                                  <div className="p-2 rounded-xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/50 space-y-1">
                                    <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-rose-700 dark:text-rose-300">
                                      <Calendar className="w-3 h-3 shrink-0" />
                                      <span dir="ltr">{rec.dateString}</span>
                                      {rec.dateString === todayDateString && (
                                        <span className="px-1 rounded bg-rose-600 text-white text-[9px] font-black">
                                          اليوم
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                                      {getClosureReasonLabel(rec.closureReason)}
                                    </p>
                                  </div>
                                </td>
                              );
                            })}

                            {/* Open Details Button */}
                            <td
                              className="py-2.5 px-3 text-center whitespace-nowrap border-r border-rose-100/70 dark:border-slate-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedShopKey(group.shopKey)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black shadow-xs cursor-pointer transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>فتح السجل</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination for Red Shops Table (First 10 -> عرض المزيد) */}
                  {groupedRedShops.length > PAGE_SIZE && (
                    <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        يتم عرض {displayedRedGroups.length} من أصل {groupedRedShops.length} زبون
                      </span>
                      {redShopsLimit < groupedRedShops.length ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setRedShopsLimit((prev) => prev + PAGE_SIZE)}
                            className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow-xs cursor-pointer transition-colors"
                          >
                            عرض المزيد (+{Math.min(PAGE_SIZE, groupedRedShops.length - redShopsLimit)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setRedShopsLimit(groupedRedShops.length)}
                            className="px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                          >
                            عرض الكل
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRedShopsLimit(PAGE_SIZE)}
                          className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
                        >
                          تقليص إلى أول 10 زبائن
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Saved Past Days Management Strip (Admin can clear a specific saved day) */}
              {savedRedSnapshots.length > 0 && (
                <div className="pt-2 border-t border-rose-200/60 dark:border-slate-800 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-black text-slate-500 dark:text-slate-400">
                    سجلات الأيام المحفوظة للمحلات الحمراء:
                  </span>
                  {savedRedSnapshots.slice(0, 10).map((snap) => {
                    const isConfirmingDay = confirmClearRedDay === snap.dateString;
                    return (
                      <div
                        key={snap.dateString}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]"
                      >
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300" dir="ltr">
                          {snap.dateString}
                        </span>
                        <span className="text-slate-400">({snap.shops?.length || 0})</span>
                        {isConfirmingDay ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteRedDaySnapshot(snap.dateString);
                                setConfirmClearRedDay(null);
                              }}
                              className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black cursor-pointer"
                            >
                              تأكيد
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmClearRedDay(null)}
                              className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-bold cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmClearRedDay(snap.dateString)}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                            title={`مسح سجل يوم ${snap.dateString}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ===================================================================== */}
      {/* Shop Full History Modal (عند فتح أي محل: كم زيارة غير ناجحة + كل زيارة بتاريخها وسببها + الأيام الحمراء) */}
      {/* ===================================================================== */}
      {selectedShopDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedShopKey(null)}
          dir="rtl"
        >
          <div
            className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/50">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                  <Store className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                      {selectedShopDetails.customerName}
                    </h3>
                    {selectedShopDetails.customerCode && (
                      <span className="font-mono text-xs font-black px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        كود: {selectedShopDetails.customerCode}
                      </span>
                    )}
                    {selectedShopDetails.customerType && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {selectedShopDetails.customerType}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mt-1 text-xs text-slate-500 dark:text-slate-400 font-bold">
                    <span className="inline-flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-amber-500" />
                      <span>المندوب: {selectedShopDetails.delegateName || '-'}</span>
                    </span>
                    {selectedShopDetails.routeDay && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>المسار: {selectedShopDetails.routeDay}</span>
                      </span>
                    )}
                    {selectedShopDetails.customerAddress && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{selectedShopDetails.customerAddress}</span>
                      </span>
                    )}
                    {selectedShopDetails.phone && (
                      <a
                        href={`tel:${selectedShopDetails.phone}`}
                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-mono"
                        dir="ltr"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{selectedShopDetails.phone}</span>
                      </a>
                    )}
                    {selectedShopDetails.latitude != null && selectedShopDetails.longitude != null && (
                      <a
                        href={`https://www.google.com/maps?q=${selectedShopDetails.latitude},${selectedShopDetails.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>موقع المحل على الخريطة</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedShopKey(null)}
                className="p-1.5 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                      إجمالي الزيارات غير الناجحة
                    </p>
                    <p className="text-2xl font-black text-amber-700 dark:text-amber-400 font-mono mt-0.5">
                      {selectedShopDetails.visits.length}
                    </p>
                  </div>
                  <AlertTriangle className="w-7 h-7 text-amber-500 opacity-80" />
                </div>

                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-rose-800 dark:text-rose-300">
                      عدد مرات عدم الزيارة (أحمر)
                    </p>
                    <p className="text-2xl font-black text-rose-700 dark:text-rose-400 font-mono mt-0.5">
                      {selectedShopDetails.redRecords.length}
                    </p>
                  </div>
                  <AlertOctagon className="w-7 h-7 text-rose-500 opacity-80" />
                </div>
              </div>

              {/* Part 1 inside Modal: Complete Unsuccessful Visits Timeline */}
              <div className="space-y-3">
                <h4 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span>سجل الزيارات غير الناجحة للمحل ({selectedShopDetails.visits.length})</span>
                </h4>

                {selectedShopDetails.visits.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-center">
                    لا توجد زيارات غير ناجحة مسجلة لهذا المحل.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedShopDetails.visits.map((v, idx) => {
                      const isConfirming = confirmDeleteVisitId === v.id;
                      const isDeleting = isDeletingVisitId === v.id;
                      return (
                        <div
                          key={v.id}
                          className={`p-3.5 rounded-2xl border space-y-2.5 ${
                            isDarkMode
                              ? 'bg-slate-800/60 border-amber-900/50'
                              : 'bg-amber-50/40 border-amber-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2.5 py-0.5 rounded-lg bg-amber-600 text-white font-black text-[11px]">
                                الزيارة غير الناجحة #{idx + 1}
                              </span>
                              <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                                <span>{v.date}</span>
                                {v.timeFormatted && <span>• {v.timeFormatted}</span>}
                              </span>
                              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                ({v.delegateName})
                              </span>
                            </div>

                            <div>
                              {isConfirming ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={isDeleting}
                                    onClick={() => handleDeleteVisitConfirm(v.id)}
                                    className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black cursor-pointer"
                                  >
                                    {isDeleting ? '...' : 'تأكيد الحذف'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteVisitId(null)}
                                    className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-[10px] font-bold cursor-pointer"
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteVisitId(v.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                                  title="حذف هذه الزيارة"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/70 dark:border-slate-700">
                            <span className="text-[11px] font-black text-amber-700 dark:text-amber-400 block mb-0.5">
                              السبب:
                            </span>
                            <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
                              {v.reason}
                            </p>
                          </div>

                          {v.refrigeratorPhoto ? (
                            <div
                              onClick={() =>
                                setLightboxImage({
                                  src: v.refrigeratorPhoto!,
                                  title: `صورة براد: ${v.customerName} (الزيارة #${idx + 1})`,
                                  subtitle: `التاريخ: ${v.date} | المندوب: ${v.delegateName} | السبب: ${v.reason}`,
                                })
                              }
                              className="group relative max-h-40 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-black cursor-pointer flex items-center justify-center"
                            >
                              <img
                                src={v.refrigeratorPhoto}
                                alt={`براد ${v.customerName}`}
                                className="max-h-40 w-full object-contain"
                              />
                              <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black gap-1.5">
                                <Eye className="w-4 h-4" />
                                <span>عرض بالحجم الكامل</span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400 flex items-center gap-1 font-bold">
                              <FileX className="w-3.5 h-3.5" />
                              <span>بدون صورة براد مرفقة</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Part 2 inside Modal: Days Shop Stayed Red (Unvisited) */}
              <div className="space-y-2.5">
                <h4 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
                  <span>الأيام التي بقي فيها المحل بدون زيارة (أحمر في الخريطة) ({selectedShopDetails.redRecords.length})</span>
                </h4>

                {selectedShopDetails.redRecords.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-center">
                    لا توجد أيام مسجلة بقي فيها هذا المحل بدون زيارة (باللون الأحمر).
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedShopDetails.redRecords.map((rec, idx) => {
                      const redKey = `${rec.dateString}__${rec.id}`;
                      const isConfirming = confirmDeleteRedKey === redKey;
                      const isDeleting = isDeletingRedKey === redKey;
                      return (
                        <div
                          key={redKey}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-2 flex-wrap ${
                            isDarkMode
                              ? 'bg-rose-950/25 border-rose-900/50'
                              : 'bg-rose-50/60 border-rose-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white font-black text-[10px]">
                              #{idx + 1}
                            </span>
                            <span className="font-mono font-black text-slate-800 dark:text-slate-100" dir="ltr">
                              {rec.dateString}
                            </span>
                            {rec.routeDay && (
                              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                ({rec.routeDay})
                              </span>
                            )}
                            <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{getClosureReasonLabel(rec.closureReason)}</span>
                            </span>
                          </div>

                          <div>
                            {isConfirming ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => handleDeleteRedConfirm(rec.dateString, rec.id)}
                                  className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black cursor-pointer"
                                >
                                  {isDeleting ? '...' : 'حذف'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteRedKey(null)}
                                  className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-[10px] font-bold cursor-pointer"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRedKey(redKey)}
                                className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="حذف هذا السجل"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-end bg-slate-50/70 dark:bg-slate-950/50">
              <button
                type="button"
                onClick={() => setSelectedShopKey(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black cursor-pointer hover:opacity-90"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox High-Resolution Image Preview Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setLightboxImage(null)}
          dir="rtl"
        >
          <div
            className={`w-full max-w-3xl rounded-3xl p-4 sm:p-5 shadow-2xl border text-right space-y-3 relative my-auto animate-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">
                  {lightboxImage.title}
                </h3>
                {lightboxImage.subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                    {lightboxImage.subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative flex-1 min-h-[300px] max-h-[70vh] rounded-2xl overflow-hidden bg-black flex items-center justify-center p-2">
              <img
                src={lightboxImage.src}
                alt={lightboxImage.title}
                className="max-h-[68vh] max-w-full object-contain mx-auto rounded-lg shadow-lg"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400 font-medium">
                معاينة عالية الدقة لفحص البراد
              </span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="py-1.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-black transition-colors cursor-pointer"
              >
                إغلاق المعاينة
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default UnsuccessfulVisitsSection;
