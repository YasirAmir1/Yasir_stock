import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import {
  TrendingUp,
  Calendar,
  Search,
  RefreshCw,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Boxes,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  BarChart3,
  ShoppingBag,
  Sparkles,
  X
} from 'lucide-react';
import { db } from '../lib/firebase';
import { isGlobalQuotaExceeded, logFirestoreErrorGracefully } from '../lib/firestoreUtils';
import { ProductItem, SalesEntry } from '../types';

interface LiveStockInfo {
  totalUnits: number;
  cartons: number;
  pieces: number;
  unitsPerCarton: number;
  soldToday: number;
}

interface AdminProductDemandPanelProps {
  productsList: ProductItem[];
  allSalesEntries: SalesEntry[];
  isDarkMode: boolean;
  getProductLiveStock: (prod: ProductItem) => LiveStockInfo;
  isStandalonePage?: boolean;
}

interface WeekBucket {
  index: number;
  key: string;
  label: string;
  shortRange: string;
  start: string;
  end: string;
  daysCount: number;
}

interface ProductDemandRow {
  productKey: string;
  productName: string;
  productCode: string;
  categoryName: string;
  imageUrl?: string;
  unitsPerCarton: number;
  totalPieces: number;
  totalCartons: number;
  retailCartons: number;
  wholesaleCartons: number;
  soldCartons: number;
  giftCartons: number;
  dailyAvgCartons: number;
  dailyAvgPieces: number;
  dailyAvgRetailCartons: number;
  dailyAvgRetailPieces: number;
  dailyAvgWholesaleCartons: number;
  dailyAvgWholesalePieces: number;
  weeklyAvgCartons: number;
  invoiceCount: number;
  customerCount: number;
  currentStockCartons: number;
  currentStockUnits: number;
  coverageWeeks: number;
  suggestedOrderCartons: number;
  purchaseUrgency: 'urgent' | 'soon' | 'ok';
  weekCartons: Record<string, number>;
  topDelegates: { name: string; cartons: number }[];
  topCustomers: { name: string; cartons: number }[];
}

type SortKey =
  | 'productName'
  | 'productCode'
  | 'totalCartons'
  | 'dailyAvgCartons'
  | 'dailyAvgRetailCartons'
  | 'dailyAvgWholesaleCartons'
  | 'weeklyAvgCartons'
  | 'invoiceCount'
  | 'currentStockCartons'
  | 'coverageWeeks'
  | `week_${string}`;

const formatYMDLocal = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addDaysYMD = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split('T')[0];
};

const diffDaysInclusive = (startYMD: string, endYMD: string): number => {
  const [sy, sm, sd] = startYMD.split('-').map(Number);
  const [ey, em, ed] = endYMD.split('-').map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const e = Date.UTC(ey, em - 1, ed);
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
};

const formatShortDate = (ymd: string): string => {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}`;
};

const formatCartons = (val: number): string => {
  if (Math.abs(val) < 0.05) return '0';
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
};

const getEntryPriceMode = (entry: SalesEntry): 'retail' | 'wholesale' => {
  if (entry.priceMode === 'wholesale' || entry.customerType === 'جملة') {
    return 'wholesale';
  }
  return 'retail';
};

export const AdminProductDemandPanel: React.FC<AdminProductDemandPanelProps> = ({
  productsList,
  allSalesEntries,
  isDarkMode,
  getProductLiveStock,
  isStandalonePage = false
}) => {
  const todayStr = useMemo(() => formatYMDLocal(new Date()), []);
  const defaultStartStr = useMemo(() => addDaysYMD(todayStr, -27), [todayStr]); // 28 days (4 full weeks)

  // Date inputs (draft) vs executed search range
  const [startDateInput, setStartDateInput] = useState<string>(defaultStartStr);
  const [endDateInput, setEndDateInput] = useState<string>(todayStr);
  const [executedRange, setExecutedRange] = useState<{ start: string; end: string }>({
    start: defaultStartStr,
    end: todayStr
  });

  // Firestore query state
  const [fetchedEntries, setFetchedEntries] = useState<SalesEntry[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dataSourceInfo, setDataSourceInfo] = useState<{
    source: 'firestore' | 'cache';
    fetchedCount: number;
    lastUpdatedAt: number;
  } | null>(null);

  // Dynamic table controls
  const [priceModeFilter, setPriceModeFilter] = useState<'all' | 'retail' | 'wholesale'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('الكل');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'urgent' | 'soon' | 'ok'>('all');
  const [excludeGifts, setExcludeGifts] = useState<boolean>(false);
  const [showWeeklyColumns, setShowWeeklyColumns] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<SortKey>('totalCartons');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedProductKey, setExpandedProductKey] = useState<string | null>(null);
  const [coverageTargetWeeks, setCoverageTargetWeeks] = useState<number>(4);

  // Execute search against Firestore (sales_entries + sales_entries_archive) between two dates
  const executeSearchBetweenDates = useCallback(
    async (start: string, end: string) => {
      if (!start || !end) {
        setSearchError('يرجى تحديد تاريخ البدء وتاريخ الانتهاء قبل تنفيذ البحث.');
        return;
      }
      if (start > end) {
        setSearchError('تاريخ البدء يجب أن يكون أقدم من أو مساوياً لتاريخ الانتهاء.');
        return;
      }

      setSearchError(null);
      setIsSearching(true);
      setExecutedRange({ start, end });

      const mergeWithLocalFallback = (remoteEntries: SalesEntry[], source: 'firestore' | 'cache') => {
        const entryMap = new Map<string, SalesEntry>();
        // 1. Add remote Firestore docs first
        remoteEntries.forEach((e) => {
          if (e && e.id) entryMap.set(e.id, e);
        });
        // 2. Supplement with any matching local/allSalesEntries within [start, end] not yet in remoteMap
        (allSalesEntries || []).forEach((e) => {
          if (!e || !e.id || !e.dateString) return;
          if (e.dateString >= start && e.dateString <= end && !entryMap.has(e.id)) {
            entryMap.set(e.id, e);
          }
        });

        setFetchedEntries(Array.from(entryMap.values()));
        setDataSourceInfo({
          source,
          fetchedCount: entryMap.size,
          lastUpdatedAt: Date.now()
        });
      };

      if (!navigator.onLine || isGlobalQuotaExceeded()) {
        mergeWithLocalFallback([], 'cache');
        setIsSearching(false);
        return;
      }

      try {
        const activeQuery = query(
          collection(db, 'sales_entries'),
          where('dateString', '>=', start),
          where('dateString', '<=', end)
        );
        const archiveQuery = query(
          collection(db, 'sales_entries_archive'),
          where('dateString', '>=', start),
          where('dateString', '<=', end)
        );

        const [activeRes, archiveRes] = await Promise.allSettled([
          getDocs(activeQuery),
          getDocs(archiveQuery)
        ]);

        const combinedRemote = new Map<string, SalesEntry>();
        let anySucceeded = false;

        if (archiveRes.status === 'fulfilled') {
          anySucceeded = true;
          archiveRes.value.forEach((docSnap) => {
            const data = docSnap.data() as SalesEntry;
            combinedRemote.set(data.id || docSnap.id, { ...data, id: data.id || docSnap.id });
          });
        } else {
          logFirestoreErrorGracefully(archiveRes.reason, 'admin_demand_archive');
        }

        if (activeRes.status === 'fulfilled') {
          anySucceeded = true;
          activeRes.value.forEach((docSnap) => {
            const data = docSnap.data() as SalesEntry;
            combinedRemote.set(data.id || docSnap.id, { ...data, id: data.id || docSnap.id });
          });
        } else {
          logFirestoreErrorGracefully(activeRes.reason, 'admin_demand_active');
        }

        if (anySucceeded) {
          mergeWithLocalFallback(Array.from(combinedRemote.values()), 'firestore');
        } else {
          mergeWithLocalFallback([], 'cache');
        }
      } catch (err) {
        logFirestoreErrorGracefully(err, 'admin_demand_search');
        mergeWithLocalFallback([], 'cache');
      } finally {
        setIsSearching(false);
      }
    },
    [allSalesEntries]
  );

  // Initial automatic query on mount for default 4-week range
  useEffect(() => {
    executeSearchBetweenDates(defaultStartStr, todayStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also keep in sync if allSalesEntries gets new live records within executedRange
  const effectiveEntriesInRange = useMemo(() => {
    const map = new Map<string, SalesEntry>();
    fetchedEntries.forEach((e) => {
      if (e && e.id) map.set(e.id, e);
    });
    (allSalesEntries || []).forEach((e) => {
      if (!e || !e.id || !e.dateString) return;
      if (e.dateString >= executedRange.start && e.dateString <= executedRange.end) {
        if (!map.has(e.id)) {
          map.set(e.id, e);
        }
      }
    });
    return Array.from(map.values()).filter((e) => {
      if (e.status === 'cancelled') return false;
      if (!e.dateString || !e.productName) return false;
      if (e.dateString < executedRange.start || e.dateString > executedRange.end) return false;
      if (excludeGifts && e.isGift) return false;
      if (priceModeFilter !== 'all' && getEntryPriceMode(e) !== priceModeFilter) return false;
      return true;
    });
  }, [fetchedEntries, allSalesEntries, executedRange, excludeGifts, priceModeFilter]);

  // Quick date preset handler
  const applyPresetAndSearch = (preset: '7d' | '14d' | '28d' | 'thisMonth' | 'lastMonth') => {
    const now = new Date();
    const end = formatYMDLocal(now);
    let start = end;

    if (preset === '7d') {
      start = addDaysYMD(end, -6);
    } else if (preset === '14d') {
      start = addDaysYMD(end, -13);
    } else if (preset === '28d') {
      start = addDaysYMD(end, -27);
    } else if (preset === 'thisMonth') {
      start = `${end.slice(0, 8)}01`;
    } else if (preset === 'lastMonth') {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
      const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
      const s = formatYMDLocal(firstOfPrevMonth);
      const e = formatYMDLocal(lastOfPrevMonth);
      setStartDateInput(s);
      setEndDateInput(e);
      executeSearchBetweenDates(s, e);
      return;
    }

    setStartDateInput(start);
    setEndDateInput(end);
    executeSearchBetweenDates(start, end);
  };

  // Build dynamic week buckets spanning [executedRange.start, executedRange.end]
  const totalDaysSpan = useMemo(
    () => diffDaysInclusive(executedRange.start, executedRange.end),
    [executedRange]
  );

  const weekBuckets: WeekBucket[] = useMemo(() => {
    const buckets: WeekBucket[] = [];
    let cursor = executedRange.start;
    let idx = 1;

    while (cursor <= executedRange.end && idx <= 26) {
      const candidateEnd = addDaysYMD(cursor, 6);
      const bucketEnd = candidateEnd > executedRange.end ? executedRange.end : candidateEnd;
      const daysCount = diffDaysInclusive(cursor, bucketEnd);
      buckets.push({
        index: idx,
        key: `w${idx}`,
        label: `أسبوع ${idx}`,
        shortRange: `${formatShortDate(cursor)} - ${formatShortDate(bucketEnd)}`,
        start: cursor,
        end: bucketEnd,
        daysCount
      });
      cursor = addDaysYMD(bucketEnd, 1);
      idx += 1;
    }
    // مسح أسبوع 2 و 3 و 4 بناءً على طلب المستخدم
    return buckets.filter((b) => b.index !== 2 && b.index !== 3 && b.index !== 4);
  }, [executedRange]);

  const effectiveWeeksSpan = useMemo(() => Math.max(1, totalDaysSpan / 7), [totalDaysSpan]);

  // Product lookup map for fast matching
  const productCatalogMap = useMemo(() => {
    const byName = new Map<string, ProductItem>();
    productsList.forEach((p) => {
      if (p.productName) {
        byName.set(p.productName.trim().toLowerCase(), p);
      }
    });
    return byName;
  }, [productsList]);

  // Aggregate demand rows per product
  const aggregatedRows: ProductDemandRow[] = useMemo(() => {
    interface MutableAcc {
      productKey: string;
      productName: string;
      matchedProd?: ProductItem;
      totalPieces: number;
      retailPieces: number;
      wholesalePieces: number;
      soldPieces: number;
      giftPieces: number;
      invoiceIds: Set<string>;
      customers: Map<string, number>;
      delegates: Map<string, number>;
      weekPieces: Record<string, number>;
    }

    const accMap = new Map<string, MutableAcc>();

    effectiveEntriesInRange.forEach((entry) => {
      const rawName = entry.productName.trim();
      const key = rawName.toLowerCase();
      const matchedProd = productCatalogMap.get(key);
      const unitsPerCarton = Number(matchedProd?.cartonQuantity || matchedProd?.unitsPerCarton) || 12;

      // In this app, entry.quantity is ALWAYS stored in total pieces
      const qtyPieces =
        Number(entry.quantity) > 0
          ? Number(entry.quantity)
          : entry.entryUnit === 'carton'
          ? Number(entry.enteredQuantity || 0) * unitsPerCarton
          : Number(entry.enteredQuantity || 0);

      if (qtyPieces <= 0) return;

      let acc = accMap.get(key);
      if (!acc) {
        acc = {
          productKey: key,
          productName: matchedProd?.productName || rawName,
          matchedProd,
          totalPieces: 0,
          retailPieces: 0,
          wholesalePieces: 0,
          soldPieces: 0,
          giftPieces: 0,
          invoiceIds: new Set<string>(),
          customers: new Map<string, number>(),
          delegates: new Map<string, number>(),
          weekPieces: {}
        };
        accMap.set(key, acc);
      }

      acc.totalPieces += qtyPieces;
      if (getEntryPriceMode(entry) === 'wholesale') {
        acc.wholesalePieces += qtyPieces;
      } else {
        acc.retailPieces += qtyPieces;
      }
      if (entry.isGift) {
        acc.giftPieces += qtyPieces;
      } else {
        acc.soldPieces += qtyPieces;
      }

      const invKey = entry.invoiceId || `${entry.dateString}_${entry.customerName || ''}_${entry.id}`;
      acc.invoiceIds.add(invKey);

      const delName = (entry.delegateName || 'غير محدد').trim();
      acc.delegates.set(delName, (acc.delegates.get(delName) || 0) + qtyPieces);

      const custName = (entry.customerName || 'زبون عام').trim();
      acc.customers.set(custName, (acc.customers.get(custName) || 0) + qtyPieces);

      // Assign to matching week bucket
      for (const wb of weekBuckets) {
        if (entry.dateString >= wb.start && entry.dateString <= wb.end) {
          acc.weekPieces[wb.key] = (acc.weekPieces[wb.key] || 0) + qtyPieces;
          break;
        }
      }
    });

    const rows: ProductDemandRow[] = [];
    accMap.forEach((acc) => {
      const matched = acc.matchedProd;
      const unitsPerCarton = Number(matched?.cartonQuantity || matched?.unitsPerCarton) || 12;
      const totalCartons = acc.totalPieces / unitsPerCarton;
      const retailCartons = acc.retailPieces / unitsPerCarton;
      const wholesaleCartons = acc.wholesalePieces / unitsPerCarton;
      const soldCartons = acc.soldPieces / unitsPerCarton;
      const giftCartons = acc.giftPieces / unitsPerCarton;
      const weeklyAvgCartons = totalCartons / effectiveWeeksSpan;
      const totalDays = Math.max(1, totalDaysSpan);
      const dailyAvgCartons = totalCartons / totalDays;
      const dailyAvgPieces = acc.totalPieces / totalDays;
      const dailyAvgRetailCartons = retailCartons / totalDays;
      const dailyAvgRetailPieces = acc.retailPieces / totalDays;
      const dailyAvgWholesaleCartons = wholesaleCartons / totalDays;
      const dailyAvgWholesalePieces = acc.wholesalePieces / totalDays;

      const liveStock = matched ? getProductLiveStock(matched) : null;
      const currentStockUnits = liveStock ? liveStock.totalUnits : 0;
      const currentStockCartons = liveStock ? liveStock.totalUnits / unitsPerCarton : 0;

      const coverageWeeks =
        weeklyAvgCartons > 0.05 ? currentStockCartons / weeklyAvgCartons : 99;
      const neededForTarget = Math.max(0, weeklyAvgCartons * coverageTargetWeeks - currentStockCartons);
      const suggestedOrderCartons = Math.ceil(neededForTarget);

      let purchaseUrgency: 'urgent' | 'soon' | 'ok' = 'ok';
      if (weeklyAvgCartons > 0.1) {
        if (coverageWeeks < 1.2) purchaseUrgency = 'urgent';
        else if (coverageWeeks < 2.5) purchaseUrgency = 'soon';
      }

      const weekCartons: Record<string, number> = {};
      weekBuckets.forEach((wb) => {
        weekCartons[wb.key] = (acc.weekPieces[wb.key] || 0) / unitsPerCarton;
      });

      const topDelegates = Array.from(acc.delegates.entries())
        .map(([name, pcs]) => ({ name, cartons: pcs / unitsPerCarton }))
        .sort((a, b) => b.cartons - a.cartons)
        .slice(0, 5);

      const topCustomers = Array.from(acc.customers.entries())
        .map(([name, pcs]) => ({ name, cartons: pcs / unitsPerCarton }))
        .sort((a, b) => b.cartons - a.cartons)
        .slice(0, 5);

      rows.push({
        productKey: acc.productKey,
        productName: acc.productName,
        productCode: matched?.productCode || '-',
        categoryName: matched?.categoryName || 'غير مصنف',
        imageUrl: matched?.imageUrl,
        unitsPerCarton,
        totalPieces: acc.totalPieces,
        totalCartons,
        retailCartons,
        wholesaleCartons,
        soldCartons,
        giftCartons,
        dailyAvgCartons,
        dailyAvgPieces,
        dailyAvgRetailCartons,
        dailyAvgRetailPieces,
        dailyAvgWholesaleCartons,
        dailyAvgWholesalePieces,
        weeklyAvgCartons,
        invoiceCount: acc.invoiceIds.size,
        customerCount: acc.customers.size,
        currentStockCartons,
        currentStockUnits,
        coverageWeeks,
        suggestedOrderCartons,
        purchaseUrgency,
        weekCartons,
        topDelegates,
        topCustomers
      });
    });

    return rows;
  }, [
    effectiveEntriesInRange,
    productCatalogMap,
    weekBuckets,
    effectiveWeeksSpan,
    getProductLiveStock,
    coverageTargetWeeks
  ]);

  // Available categories from aggregated rows
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    aggregatedRows.forEach((r) => {
      if (r.categoryName) set.add(r.categoryName);
    });
    return ['الكل', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'))];
  }, [aggregatedRows]);

  // Top Most Demanded Products (always sorted by totalCartons desc across the searched range)
  const topDemandedProducts = useMemo(() => {
    return [...aggregatedRows]
      .filter((r) => categoryFilter === 'الكل' || r.categoryName === categoryFilter)
      .sort((a, b) => b.totalCartons - a.totalCartons)
      .slice(0, 6);
  }, [aggregatedRows, categoryFilter]);

  const maxTopCartons = useMemo(
    () => (topDemandedProducts.length > 0 ? Math.max(1, topDemandedProducts[0].totalCartons) : 1),
    [topDemandedProducts]
  );

  // Filtered & Dynamically Sorted Rows for the Weekly Table
  const filteredAndSortedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = aggregatedRows.filter((row) => {
      if (categoryFilter !== 'الكل' && row.categoryName !== categoryFilter) return false;
      if (urgencyFilter !== 'all' && row.purchaseUrgency !== urgencyFilter) return false;
      if (q) {
        const matchName = row.productName.toLowerCase().includes(q);
        const matchCode = row.productCode.toLowerCase().includes(q);
        const matchCat = row.categoryName.toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchCat) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'productName') {
        cmp = a.productName.localeCompare(b.productName, 'ar');
      } else if (sortKey === 'productCode') {
        cmp = a.productCode.localeCompare(b.productCode);
      } else if (sortKey.startsWith('week_')) {
        const wKey = sortKey.replace('week_', '');
        cmp = (a.weekCartons[wKey] || 0) - (b.weekCartons[wKey] || 0);
      } else {
        const numericKey = sortKey as Exclude<SortKey, 'productName' | 'productCode' | `week_${string}`>;
        cmp = a[numericKey] - b[numericKey];
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [aggregatedRows, searchQuery, categoryFilter, urgencyFilter, sortKey, sortDir]);

  // Summary metrics
  const summaryStats = useMemo(() => {
    const totalCartons = aggregatedRows.reduce((s, r) => s + r.totalCartons, 0);
    const totalPieces = aggregatedRows.reduce((s, r) => s + r.totalPieces, 0);
    const urgentCount = aggregatedRows.filter((r) => r.purchaseUrgency === 'urgent').length;
    const uniqueInvoices = new Set<string>();
    effectiveEntriesInRange.forEach((e) => {
      uniqueInvoices.add(e.invoiceId || `${e.dateString}_${e.customerName || ''}_${e.id}`);
    });
    return {
      productCount: aggregatedRows.length,
      totalCartons,
      totalPieces,
      urgentCount,
      invoiceCount: uniqueInvoices.size
    };
  }, [aggregatedRows, effectiveEntriesInRange]);

  // Footer totals for currently filtered rows
  const tableFooterTotals = useMemo(() => {
    const weekSums: Record<string, number> = {};
    weekBuckets.forEach((wb) => {
      weekSums[wb.key] = 0;
    });
    let totalCartons = 0;
    let totalDailyAvg = 0;
    let totalDailyRetailAvg = 0;
    let totalDailyWholesaleAvg = 0;
    let totalWeeklyAvg = 0;
    let totalStockCartons = 0;
    let totalSuggested = 0;

    filteredAndSortedRows.forEach((r) => {
      totalCartons += r.totalCartons;
      totalDailyAvg += r.dailyAvgCartons;
      totalDailyRetailAvg += r.dailyAvgRetailCartons;
      totalDailyWholesaleAvg += r.dailyAvgWholesaleCartons;
      totalWeeklyAvg += r.weeklyAvgCartons;
      totalStockCartons += r.currentStockCartons;
      totalSuggested += r.suggestedOrderCartons;
      weekBuckets.forEach((wb) => {
        weekSums[wb.key] += r.weekCartons[wb.key] || 0;
      });
    });

    return {
      totalCartons,
      totalDailyAvg,
      totalDailyRetailAvg,
      totalDailyWholesaleAvg,
      totalWeeklyAvg,
      totalStockCartons,
      totalSuggested,
      weekSums
    };
  }, [filteredAndSortedRows, weekBuckets]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'productName' || key === 'productCode' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3.5 h-3.5 opacity-40 shrink-0" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
    );
  };

  const priceModeLabel =
    priceModeFilter === 'retail'
      ? 'مفرد'
      : priceModeFilter === 'wholesale'
      ? 'جملة'
      : 'الكل (مفرد + جملة)';

  const hasActiveTableFilters =
    priceModeFilter !== 'all' ||
    searchQuery.trim() !== '' ||
    categoryFilter !== 'الكل' ||
    urgencyFilter !== 'all' ||
    excludeGifts;

  const resetTableFilters = () => {
    setPriceModeFilter('all');
    setSearchQuery('');
    setCategoryFilter('الكل');
    setUrgencyFilter('all');
    setExcludeGifts(false);
  };

  // Export filtered & sorted dynamic table to native Excel (.xlsx)
  const handleExportExcel = () => {
    if (filteredAndSortedRows.length === 0) return;

    const headers = [
      '#',
      'اسم المنتج',
      'الكود',
      'الصنف',
      'نوع البيع المفلتر',
      'تعبئة الكارتون',
      'إجمالي الطلب (كارتون)',
      'المعدل اليومي (كارتون/يوم)',
      'المعدل اليومي (مفرد)',
      'المعدل اليومي (جملة)',
      'المعدل الأسبوعي (كارتون/أسبوع)',
      'مفرد (كارتون)',
      'جملة (كارتون)',
      'هدايا (كارتون)',
      ...weekBuckets.map((wb) => `${wb.label} (${wb.shortRange})`),
      'عدد الفواتير',
      'المخزون الحالي (كارتون)',
      'كفاية المخزون (أسابيع)',
      `مقترح الشراء لتغطية ${coverageTargetWeeks} أسابيع (كارتون)`
    ];

    const dataRows = filteredAndSortedRows.map((row, idx) => [
      idx + 1,
      row.productName,
      row.productCode,
      row.categoryName,
      priceModeLabel,
      row.unitsPerCarton,
      Number(row.totalCartons.toFixed(1)),
      Number(row.dailyAvgCartons.toFixed(1)),
      Number(row.dailyAvgRetailCartons.toFixed(1)),
      Number(row.dailyAvgWholesaleCartons.toFixed(1)),
      Number(row.weeklyAvgCartons.toFixed(1)),
      Number(row.retailCartons.toFixed(1)),
      Number(row.wholesaleCartons.toFixed(1)),
      Number(row.giftCartons.toFixed(1)),
      ...weekBuckets.map((wb) => Number((row.weekCartons[wb.key] || 0).toFixed(1))),
      row.invoiceCount,
      Number(row.currentStockCartons.toFixed(1)),
      row.coverageWeeks >= 90 ? 'كفاية طويلة' : Number(row.coverageWeeks.toFixed(1)),
      row.suggestedOrderCartons
    ]);

    const retailSum = filteredAndSortedRows.reduce((s, r) => s + r.retailCartons, 0);
    const wholesaleSum = filteredAndSortedRows.reduce((s, r) => s + r.wholesaleCartons, 0);
    const giftSum = filteredAndSortedRows.reduce((s, r) => s + r.giftCartons, 0);

    const totalsRow = [
      '',
      `الإجمالي (${filteredAndSortedRows.length} صنف)`,
      '',
      categoryFilter === 'الكل' ? 'كل الأصناف' : categoryFilter,
      priceModeLabel,
      '',
      Number(tableFooterTotals.totalCartons.toFixed(1)),
      Number(tableFooterTotals.totalDailyAvg.toFixed(1)),
      Number(tableFooterTotals.totalDailyRetailAvg.toFixed(1)),
      Number(tableFooterTotals.totalDailyWholesaleAvg.toFixed(1)),
      Number(tableFooterTotals.totalWeeklyAvg.toFixed(1)),
      Number(retailSum.toFixed(1)),
      Number(wholesaleSum.toFixed(1)),
      Number(giftSum.toFixed(1)),
      ...weekBuckets.map((wb) => Number((tableFooterTotals.weekSums[wb.key] || 0).toFixed(1))),
      summaryStats.invoiceCount,
      Number(tableFooterTotals.totalStockCartons.toFixed(1)),
      '',
      tableFooterTotals.totalSuggested
    ];

    const sheetData = [
      [
        `تقرير المنتجات الأكثر طلباً أسبوعياً (بالكارتون) — ${priceModeLabel} — الفترة: ${executedRange.start} إلى ${executedRange.end}`
      ],
      headers,
      ...dataRows,
      totalsRow
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!views'] = [{ rightToLeft: true }];
    ws['!cols'] = [
      { wch: 5 },
      { wch: 28 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 },
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 20 },
      ...weekBuckets.map(() => ({ wch: 16 })),
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الأكثر طلباً');
    const modeSlug =
      priceModeFilter === 'retail' ? 'مفرد' : priceModeFilter === 'wholesale' ? 'جملة' : 'الكل';
    XLSX.writeFile(
      wb,
      `الاكثر_طلبا_كارتون_${modeSlug}_${executedRange.start}_الى_${executedRange.end}.xlsx`
    );
  };

  // Export filtered & sorted dynamic table to CSV (UTF-8 BOM)
  const handleExportCsv = () => {
    if (filteredAndSortedRows.length === 0) return;

    const headers = [
      '#',
      'اسم المنتج',
      'الكود',
      'الصنف',
      'نوع البيع',
      'تعبئة الكارتون',
      'إجمالي الطلب (كارتون)',
      'المعدل اليومي (كارتون/يوم)',
      'المعدل اليومي (مفرد)',
      'المعدل اليومي (جملة)',
      'الطلب الأسبوعي (كارتون/أسبوع)',
      'مفرد (كارتون)',
      'جملة (كارتون)',
      ...weekBuckets.map((wb) => `${wb.label} (${wb.shortRange})`),
      'عدد الفواتير',
      'المخزون الحالي (كارتون)',
      'كفاية المخزون (أسابيع)',
      `مقترح الشراء لتغطية ${coverageTargetWeeks} أسابيع (كارتون)`
    ];

    const lines = filteredAndSortedRows.map((row, idx) => {
      const cells = [
        idx + 1,
        `"${row.productName.replace(/"/g, '""')}"`,
        `"${row.productCode}"`,
        `"${row.categoryName}"`,
        `"${priceModeLabel}"`,
        row.unitsPerCarton,
        row.totalCartons.toFixed(1),
        row.dailyAvgCartons.toFixed(1),
        row.dailyAvgRetailCartons.toFixed(1),
        row.dailyAvgWholesaleCartons.toFixed(1),
        row.weeklyAvgCartons.toFixed(1),
        row.retailCartons.toFixed(1),
        row.wholesaleCartons.toFixed(1),
        ...weekBuckets.map((wb) => (row.weekCartons[wb.key] || 0).toFixed(1)),
        row.invoiceCount,
        row.currentStockCartons.toFixed(1),
        row.coverageWeeks >= 90 ? 'كفاية طويلة' : row.coverageWeeks.toFixed(1),
        row.suggestedOrderCartons
      ];
      return cells.join(',');
    });

    const retailSum = filteredAndSortedRows.reduce((s, r) => s + r.retailCartons, 0);
    const wholesaleSum = filteredAndSortedRows.reduce((s, r) => s + r.wholesaleCartons, 0);
    const totalLine = [
      '',
      `"الإجمالي (${filteredAndSortedRows.length} صنف)"`,
      '""',
      `"${categoryFilter}"`,
      `"${priceModeLabel}"`,
      '',
      tableFooterTotals.totalCartons.toFixed(1),
      tableFooterTotals.totalDailyAvg.toFixed(1),
      tableFooterTotals.totalDailyRetailAvg.toFixed(1),
      tableFooterTotals.totalDailyWholesaleAvg.toFixed(1),
      tableFooterTotals.totalWeeklyAvg.toFixed(1),
      retailSum.toFixed(1),
      wholesaleSum.toFixed(1),
      ...weekBuckets.map((wb) => (tableFooterTotals.weekSums[wb.key] || 0).toFixed(1)),
      summaryStats.invoiceCount,
      tableFooterTotals.totalStockCartons.toFixed(1),
      '',
      tableFooterTotals.totalSuggested
    ].join(',');

    const csvContent = '\uFEFF' + [headers.join(','), ...lines, totalLine].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const modeSlug =
      priceModeFilter === 'retail' ? 'مفرد' : priceModeFilter === 'wholesale' ? 'جملة' : 'الكل';
    link.setAttribute(
      'download',
      `الاكثر_طلبا_كارتون_${modeSlug}_${executedRange.start}_الى_${executedRange.end}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const canShowInlineWeeks = showWeeklyColumns && weekBuckets.length > 0 && weekBuckets.length <= 8;

  return (
    <div
      className={`${isStandalonePage ? 'mt-2' : 'mt-8'} p-4 sm:p-6 rounded-3xl border-2 shadow-xl space-y-6 ${
        isDarkMode
          ? 'bg-slate-900/95 border-emerald-500/40 text-white'
          : 'bg-white border-emerald-600/30 text-slate-900'
      }`}
      dir="rtl"
    >
      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-lg shrink-0">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-black text-base sm:text-xl text-emerald-600 dark:text-emerald-400">
                {isStandalonePage ? 'لوحة فوركاست — المنتجات الأكثر طلباً (بالكارتون)' : 'المنتجات الأكثر طلباً (بالكارتون) — لوحة الأدمن'}
              </h3>
              <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                خاصة بالأدمن فقط 🔒
              </span>
            </div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">
              جرد وتحليل الطلب الأسبوعي بالكارتون من فواتير Firestore الحية والأرشيف لتسهيل قرارات الشراء وإعادة التعبئة
            </p>
          </div>
        </div>

        {/* Source & Last Query Status Badge */}
        {dataSourceInfo && (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border ${
                dataSourceInfo.source === 'firestore'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  dataSourceInfo.source === 'firestore' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {dataSourceInfo.source === 'firestore'
                ? `تم الجرد من Firestore (${dataSourceInfo.fetchedCount} بند)`
                : `الذاكرة المحلية (${dataSourceInfo.fetchedCount} بند)`}
            </span>
          </div>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block truncate">
              إجمالي الطلب (كارتون)
            </span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
              {formatCartons(summaryStats.totalCartons)} كارتون
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/25 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block truncate">
              الأصناف المطلوبة
            </span>
            <span className="text-lg font-black text-sky-600 dark:text-sky-400">
              {summaryStats.productCount} صنف
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/25 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block truncate">
              الفترة المحللة ({totalDaysSpan} يوم)
            </span>
            <span className="text-xs sm:text-sm font-black text-purple-600 dark:text-purple-400 block">
              {summaryStats.invoiceCount} فاتورة • {weekBuckets.length} {weekBuckets.length === 1 ? 'أسبوع' : 'أسابيع'}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block truncate">
              أصناف تحتاج شراء عاجل
            </span>
            <span className="text-lg font-black text-rose-600 dark:text-rose-400">
              {summaryStats.urgentCount} صنف
            </span>
          </div>
        </div>
      </div>

      {/* Retail / Wholesale Segmented Filter Banner (فلترة الجداول حسب نوع الفاتورة: الكل / مفرد / جملة) */}
      <div
        className={`p-3 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isDarkMode
            ? 'bg-slate-800/60 border-slate-700'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-2 text-xs font-black text-slate-700 dark:text-slate-200">
          <Filter className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>فلترة الجداول حسب نوع البيع (مفرد / جملة):</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all' as const, label: 'الكل (مفرد + جملة)' },
            { id: 'retail' as const, label: 'مفرد فقط' },
            { id: 'wholesale' as const, label: 'جملة فقط' }
          ].map((opt) => {
            const active = priceModeFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPriceModeFilter(opt.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border ${
                  active
                    ? opt.id === 'wholesale'
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                      : opt.id === 'retail'
                      ? 'bg-amber-600 text-white border-amber-500 shadow-md'
                      : 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                    : isDarkMode
                    ? 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 1: المنتجات الأكثر طلباً (بالكارتون) - Top Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="font-black text-sm sm:text-base flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <Sparkles className="w-4 h-4" />
            المنتجات الأكثر طلباً بالكارتون ({priceModeLabel}) • {executedRange.start} ← {executedRange.end}
          </h4>
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
            أعلى {topDemandedProducts.length} أصناف طلباً
          </span>
        </div>

        {isSearching && topDemandedProducts.length === 0 ? (
          <div className="py-8 flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            جاري استعلام وجرد الفواتير من Firestore...
          </div>
        ) : topDemandedProducts.length === 0 ? (
          <div className="py-8 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 font-bold text-sm">
            لا توجد بيانات طلب مسجلة بين {executedRange.start} و {executedRange.end}.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topDemandedProducts.map((item, idx) => {
              const pct = Math.min(100, Math.round((item.totalCartons / maxTopCartons) * 100));
              const medalColors = [
                'bg-amber-500 text-white',
                'bg-slate-400 text-white',
                'bg-orange-600 text-white',
                'bg-emerald-600 text-white',
                'bg-sky-600 text-white',
                'bg-indigo-600 text-white'
              ];
              return (
                <button
                  key={item.productKey}
                  type="button"
                  onClick={() => {
                    setExpandedProductKey((prev) => (prev === item.productKey ? null : item.productKey));
                    setSearchQuery(item.productName);
                  }}
                  className={`text-right p-3.5 rounded-2xl border transition-all cursor-pointer group ${
                    isDarkMode
                      ? 'bg-slate-800/70 border-slate-700 hover:border-emerald-500/60'
                      : 'bg-slate-50/90 border-slate-200 hover:border-emerald-500/60 hover:bg-emerald-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-7 h-7 rounded-xl text-xs font-black flex items-center justify-center shrink-0 shadow-sm ${
                          medalColors[idx] || 'bg-slate-600 text-white'
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="font-black text-xs sm:text-sm truncate text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                          {item.productName}
                        </div>
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          كود: {item.productCode} • {item.categoryName}
                        </div>
                      </div>
                    </div>
                    <span className="text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 shrink-0">
                      {formatCartons(item.totalCartons)} <span className="text-[10px]">كارتون</span>
                    </span>
                  </div>

                  {/* Proportional Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-teal-400 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className="text-sky-600 dark:text-sky-400">
                      يومياً: {formatCartons(item.dailyAvgCartons)} • أسبوعياً: {formatCartons(item.weeklyAvgCartons)} كارتون
                    </span>
                    <span
                      className={
                        item.purchaseUrgency === 'urgent'
                          ? 'text-rose-600 dark:text-rose-400'
                          : item.purchaseUrgency === 'soon'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      المخزن: {formatCartons(item.currentStockCartons)} كارتون
                      {item.purchaseUrgency === 'urgent' ? ' 🔴' : item.purchaseUrgency === 'soon' ? ' 🟡' : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Date Range Selector Bar DIRECTLY ABOVE Weekly Table */}
      <div
        className={`p-4 rounded-2xl border-2 space-y-3 ${
          isDarkMode
            ? 'bg-slate-800/70 border-sky-500/30'
            : 'bg-sky-50/70 border-sky-200'
        }`}
      >
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
            <div>
              <h4 className="font-black text-sm text-slate-900 dark:text-white">
                تحديد يوم البدء والانتهاء لجرد البيانات بين التاريخين (بالكارتون)
              </h4>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                اختر فترة سريعة أو حدد التاريخين يدوياً ثم اضغط "تنفيذ البحث" لتحليل الفواتير من Firestore
              </p>
            </div>
          </div>

          {/* Quick Range Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: '7d' as const, label: 'آخر أسبوع (7 أيام)' },
              { id: '14d' as const, label: 'أسبوعين (14 يوم)' },
              { id: '28d' as const, label: '4 أسابيع (28 يوم)' },
              { id: 'thisMonth' as const, label: 'هذا الشهر' },
              { id: 'lastMonth' as const, label: 'الشهر الماضي' }
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={isSearching}
                onClick={() => applyPresetAndSearch(p.id)}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-50 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 hover:border-sky-500 text-slate-200'
                    : 'bg-white border-slate-300 hover:border-sky-500 text-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Manual Start Date + End Date + Execute Firestore Search Button */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-3 pt-1">
          <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
            <label className="text-[11px] font-black text-slate-600 dark:text-slate-300">
              يوم البدء (من تاريخ):
            </label>
            <input
              type="date"
              value={startDateInput}
              max={endDateInput || todayStr}
              onChange={(e) => setStartDateInput(e.target.value)}
              className={`px-3 py-2 rounded-xl border text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500 ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white'
                  : 'bg-white border-slate-300 text-slate-900'
              }`}
            />
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
            <label className="text-[11px] font-black text-slate-600 dark:text-slate-300">
              يوم الانتهاء (إلى تاريخ):
            </label>
            <input
              type="date"
              value={endDateInput}
              min={startDateInput}
              max={todayStr}
              onChange={(e) => setEndDateInput(e.target.value)}
              className={`px-3 py-2 rounded-xl border text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500 ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white'
                  : 'bg-white border-slate-300 text-slate-900'
              }`}
            />
          </div>

          <button
            type="button"
            disabled={isSearching}
            onClick={() => executeSearchBetweenDates(startDateInput, endDateInput)}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs sm:text-sm font-black shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
          >
            {isSearching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري الجرد والبحث في Firestore...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                تنفيذ البحث بين التاريخين
              </>
            )}
          </button>
        </div>

        {searchError && (
          <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-600 dark:text-rose-400 text-xs font-bold">
            ⚠️ {searchError}
          </div>
        )}
      </div>

      {/* Section 2: جدول الأكثر طلباً أسبوعياً (الديناميكي) */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h4 className="font-black text-sm sm:text-base flex items-center gap-2 text-slate-900 dark:text-white">
              <BarChart3 className="w-5 h-5 text-emerald-500" />
              جدول الأكثر طلباً أسبوعياً (بالكارتون)
            </h4>
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              اضغط على عنوان أي عمود للترتيب تصاعدياً أو تنازلياً، أو اضغط على أي منتج لعرض تفاصيل الأسابيع والمندوبين والزبائن
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={filteredAndSortedRows.length === 0}
              className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40"
              title="تحميل الجدول بعد الفلترة والترتيب بصيغة Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4" />
              تحميل الجدول Excel ({filteredAndSortedRows.length} صنف)
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredAndSortedRows.length === 0}
              className={`px-3 py-2 rounded-xl text-xs font-black border flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
              }`}
              title="تحميل الجدول بعد الفلترة بصيغة CSV"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>

        {/* Dynamic Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Dynamic Text Filter */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث ديناميكي باسم المنتج أو الكود أو الصنف..."
              className={`w-full pr-9 pl-8 py-2 rounded-xl border text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500 ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-400'
                  : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                title="مسح البحث"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={`px-3 py-2 rounded-xl border text-xs font-bold outline-none cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white'
                  : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            >
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'الكل' ? 'كل الأصناف' : cat}
                </option>
              ))}
            </select>
          </div>

          {/* Retail / Wholesale Select (Quick Sync inside Table Filter Toolbar) */}
          <select
            value={priceModeFilter}
            onChange={(e) => setPriceModeFilter(e.target.value as 'all' | 'retail' | 'wholesale')}
            className={`px-3 py-2 rounded-xl border text-xs font-bold outline-none cursor-pointer ${
              priceModeFilter !== 'all'
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-600 dark:text-indigo-300'
                : isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white'
                : 'bg-slate-50 border-slate-300 text-slate-900'
            }`}
          >
            <option value="all">مفرد + جملة (الكل)</option>
            <option value="retail">مفرد فقط</option>
            <option value="wholesale">جملة فقط</option>
          </select>

          {/* Purchase Urgency Filter */}
          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value as any)}
            className={`px-3 py-2 rounded-xl border text-xs font-bold outline-none cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white'
                : 'bg-slate-50 border-slate-300 text-slate-900'
            }`}
          >
            <option value="all">كل حالات المخزون</option>
            <option value="urgent">🔴 يحتاج شراء عاجل</option>
            <option value="soon">🟡 طلب قريب</option>
            <option value="ok">🟢 مخزون كافٍ</option>
          </select>

          {/* Target Coverage Weeks Selector */}
          <select
            value={coverageTargetWeeks}
            onChange={(e) => setCoverageTargetWeeks(Number(e.target.value))}
            title="حساب الكمية المقترحة للشراء لتغطية عدد أسابيع محدد"
            className={`px-3 py-2 rounded-xl border text-xs font-bold outline-none cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white'
                : 'bg-slate-50 border-slate-300 text-slate-900'
            }`}
          >
            <option value={2}>تغطية شراء: أسبوعين</option>
            <option value={4}>تغطية شراء: 4 أسابيع</option>
            <option value={6}>تغطية شراء: 6 أسابيع</option>
            <option value={8}>تغطية شراء: 8 أسابيع</option>
          </select>

          {/* Include/Exclude Gifts */}
          <button
            type="button"
            onClick={() => setExcludeGifts((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              excludeGifts
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
                : isDarkMode
                ? 'bg-slate-800 border-slate-700 text-slate-300'
                : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            {excludeGifts ? 'مبيعات فقط (بدون الهدايا)' : 'شامل المبيعات + الهدايا'}
          </button>

          {/* Toggle Weekly Columns if <= 8 weeks */}
          {weekBuckets.length > 0 && weekBuckets.length <= 8 && (
            <button
              type="button"
              onClick={() => setShowWeeklyColumns((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                showWeeklyColumns
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-600 dark:text-sky-400'
                  : isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300'
                  : 'bg-slate-50 border-slate-300 text-slate-700'
              }`}
            >
              {showWeeklyColumns
                ? weekBuckets.length === 1
                  ? 'عمود أسبوع 1 ✓'
                  : `أعمدة الأسابيع (${weekBuckets.length}) ✓`
                : weekBuckets.length === 1
                ? 'إظهار عمود أسبوع 1'
                : 'إظهار أعمدة الأسابيع'}
            </button>
          )}

          {/* Reset Filters Button */}
          {hasActiveTableFilters && (
            <button
              type="button"
              onClick={resetTableFilters}
              className="px-3 py-2 rounded-xl text-xs font-bold border border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              إلغاء الفلترة
            </button>
          )}
        </div>

        {/* Dynamic Weekly Table */}
        {filteredAndSortedRows.length === 0 ? (
          <div className="py-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 font-bold text-sm">
            {isSearching
              ? 'جاري تحميل البيانات من Firestore...'
              : 'لا توجد نتائج مطابقة لمعايير البحث أو الفلترة المحددة.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <table className="w-full text-right text-xs border-collapse">
              <thead
                className={`border-b font-black select-none ${
                  isDarkMode
                    ? 'bg-slate-800/90 border-slate-700 text-slate-200'
                    : 'bg-slate-100/90 border-slate-200 text-slate-700'
                }`}
              >
                <tr>
                  <th className="p-3 text-center w-10">#</th>
                  <th className="p-3 min-w-[180px]">
                    <button
                      type="button"
                      onClick={() => handleSort('productName')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black"
                    >
                      اسم المنتج
                      {renderSortIcon('productName')}
                    </button>
                  </th>
                  <th className="p-3">
                    <button
                      type="button"
                      onClick={() => handleSort('productCode')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black"
                    >
                      الكود
                      {renderSortIcon('productCode')}
                    </button>
                  </th>
                  <th className="p-3">
                    <button
                      type="button"
                      onClick={() => handleSort('totalCartons')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black text-amber-600 dark:text-amber-400"
                    >
                      إجمالي الطلب (كارتون)
                      {renderSortIcon('totalCartons')}
                    </button>
                  </th>
                  <th className="p-3">
                    <button
                      type="button"
                      onClick={() => handleSort('dailyAvgCartons')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black text-teal-600 dark:text-teal-400"
                    >
                      المعدل اليومي
                      {renderSortIcon('dailyAvgCartons')}
                    </button>
                  </th>
                  <th className="p-3">
                    <button
                      type="button"
                      onClick={() => handleSort('dailyAvgRetailCartons')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black text-amber-600 dark:text-amber-400"
                    >
                      المعدل اليومي (مفرد)
                      {renderSortIcon('dailyAvgRetailCartons')}
                    </button>
                  </th>
                  <th className="p-3">
                    <button
                      type="button"
                      onClick={() => handleSort('dailyAvgWholesaleCartons')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black text-indigo-600 dark:text-indigo-400"
                    >
                      المعدل اليومي (جملة)
                      {renderSortIcon('dailyAvgWholesaleCartons')}
                    </button>
                  </th>
                  <th className="p-3">
                    <button
                      type="button"
                      onClick={() => handleSort('weeklyAvgCartons')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black text-sky-600 dark:text-sky-400"
                    >
                      المعدل الأسبوعي
                      {renderSortIcon('weeklyAvgCartons')}
                    </button>
                  </th>

                  {/* Dynamic Week Columns */}
                  {canShowInlineWeeks &&
                    weekBuckets.map((wb) => (
                      <th key={wb.key} className="p-2.5 text-center min-w-[92px]">
                        <button
                          type="button"
                          onClick={() => handleSort(`week_${wb.key}`)}
                          className="inline-flex flex-col items-center hover:text-emerald-500 cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-1 font-black">
                            {wb.label}
                            {renderSortIcon(`week_${wb.key}`)}
                          </span>
                          <span className="text-[10px] font-normal text-slate-400">
                            {wb.shortRange}
                          </span>
                        </button>
                      </th>
                    ))}

                  <th className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleSort('invoiceCount')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black"
                    >
                      الفواتير
                      {renderSortIcon('invoiceCount')}
                    </button>
                  </th>
                  <th className="p-3">
                    <button
                      type="button"
                      onClick={() => handleSort('currentStockCartons')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black"
                    >
                      المخزن (كارتون)
                      {renderSortIcon('currentStockCartons')}
                    </button>
                  </th>
                  <th className="p-3 min-w-[140px]">
                    <button
                      type="button"
                      onClick={() => handleSort('coverageWeeks')}
                      className="inline-flex items-center gap-1 hover:text-emerald-500 cursor-pointer font-black"
                    >
                      قرار الشراء ({coverageTargetWeeks} أسابيع)
                      {renderSortIcon('coverageWeeks')}
                    </button>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-bold">
                {filteredAndSortedRows.map((row, idx) => {
                  const isExpanded = expandedProductKey === row.productKey;
                  const maxRowWeek = Math.max(
                    0.1,
                    ...weekBuckets.map((wb) => row.weekCartons[wb.key] || 0)
                  );
                  const colSpanTotal = 11 + (canShowInlineWeeks ? weekBuckets.length : 0);

                  return (
                    <React.Fragment key={row.productKey}>
                      <tr
                        onClick={() =>
                          setExpandedProductKey((prev) =>
                            prev === row.productKey ? null : row.productKey
                          )
                        }
                        className={`transition-colors cursor-pointer ${
                          isExpanded
                            ? isDarkMode
                              ? 'bg-emerald-950/40'
                              : 'bg-emerald-50/80'
                            : isDarkMode
                            ? 'hover:bg-slate-800/60'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="p-3 text-center font-mono text-slate-400">
                          {idx + 1}
                        </td>

                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div>
                              <div className="font-black text-emerald-600 dark:text-emerald-400">
                                {row.productName}
                              </div>
                              <div className="text-[10px] text-slate-400 font-bold">
                                {row.categoryName} • {row.unitsPerCarton} قطعة/كارتون
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="p-3 font-mono text-slate-500 dark:text-slate-300">
                          {row.productCode}
                        </td>

                        <td className="p-3">
                          <div className="font-black text-amber-600 dark:text-amber-400 text-sm">
                            {formatCartons(row.totalCartons)} كارتون
                          </div>
                          <div className="text-[10px] text-slate-400 font-normal">
                            {row.totalPieces} قطعة
                            {row.giftCartons > 0
                              ? ` (منها ${formatCartons(row.giftCartons)} هدايا)`
                              : ''}
                          </div>
                          {priceModeFilter === 'all' && (row.retailCartons > 0 || row.wholesaleCartons > 0) && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                              مفرد: {formatCartons(row.retailCartons)} • جملة: {formatCartons(row.wholesaleCartons)}
                            </div>
                          )}
                        </td>

                        <td className="p-3">
                          <span className="px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-black inline-block">
                            {formatCartons(row.dailyAvgCartons)} / يوم
                          </span>
                          <span className="block text-[10px] text-slate-400 font-normal">
                            ({row.dailyAvgPieces < 1 ? row.dailyAvgPieces.toFixed(1) : Math.round(row.dailyAvgPieces)} قطعة/يوم)
                          </span>
                        </td>

                        <td className="p-3">
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-black inline-block">
                            {formatCartons(row.dailyAvgRetailCartons)} / يوم
                          </span>
                          <span className="block text-[10px] text-slate-400 font-normal">
                            ({row.dailyAvgRetailPieces < 1 ? row.dailyAvgRetailPieces.toFixed(1) : Math.round(row.dailyAvgRetailPieces)} قطعة/يوم)
                          </span>
                        </td>

                        <td className="p-3">
                          <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-black inline-block">
                            {formatCartons(row.dailyAvgWholesaleCartons)} / يوم
                          </span>
                          <span className="block text-[10px] text-slate-400 font-normal">
                            ({row.dailyAvgWholesalePieces < 1 ? row.dailyAvgWholesalePieces.toFixed(1) : Math.round(row.dailyAvgWholesalePieces)} قطعة/يوم)
                          </span>
                        </td>

                        <td className="p-3">
                          <span className="px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 font-black inline-block">
                            {formatCartons(row.weeklyAvgCartons)} / أسبوع
                          </span>
                        </td>

                        {canShowInlineWeeks &&
                          weekBuckets.map((wb) => {
                            const val = row.weekCartons[wb.key] || 0;
                            const intensity = val > 0 ? Math.max(0.15, val / maxRowWeek) : 0;
                            return (
                              <td key={wb.key} className="p-2.5 text-center font-mono">
                                {val > 0 ? (
                                  <span
                                    className="px-2 py-1 rounded-lg font-black inline-block text-emerald-700 dark:text-emerald-300"
                                    style={{
                                      backgroundColor: `rgba(16, 185, 129, ${(intensity * 0.25).toFixed(2)})`
                                    }}
                                  >
                                    {formatCartons(val)}
                                  </span>
                                ) : (
                                  <span className="text-slate-400/60">0</span>
                                )}
                              </td>
                            );
                          })}

                        <td className="p-3 text-center font-mono">
                          {row.invoiceCount}
                        </td>

                        <td className="p-3 font-mono">
                          <span
                            className={
                              row.currentStockCartons <= 0
                                ? 'text-rose-500 font-black'
                                : 'text-slate-700 dark:text-slate-200 font-black'
                            }
                          >
                            {formatCartons(row.currentStockCartons)}
                          </span>
                        </td>

                        <td className="p-3">
                          {row.purchaseUrgency === 'urgent' ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[10px] font-black">
                                <AlertTriangle className="w-3 h-3" />
                                شراء عاجل (يكفي {row.coverageWeeks.toFixed(1)} أسبوع)
                              </span>
                              {row.suggestedOrderCartons > 0 && (
                                <div className="text-[10px] text-rose-500 font-black">
                                  يُنصح بطلب: +{row.suggestedOrderCartons} كارتون
                                </div>
                              )}
                            </div>
                          ) : row.purchaseUrgency === 'soon' ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-black">
                                <Clock className="w-3 h-3" />
                                طلب قريب (يكفي {row.coverageWeeks.toFixed(1)} أسبوع)
                              </span>
                              {row.suggestedOrderCartons > 0 && (
                                <div className="text-[10px] text-amber-600 dark:text-amber-400 font-black">
                                  مقترح: +{row.suggestedOrderCartons} كارتون
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-black">
                              <CheckCircle2 className="w-3 h-3" />
                              {row.coverageWeeks >= 90
                                ? 'مخزون آمن'
                                : `يكفي ${row.coverageWeeks.toFixed(1)} أسبوع`}
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Interactive Expanded Row Drawer: Weekly Trend Bars + Top Delegates & Customers */}
                      {isExpanded && (
                        <tr
                          className={
                            isDarkMode ? 'bg-slate-900/90' : 'bg-emerald-50/40'
                          }
                        >
                          <td colSpan={colSpanTotal} className="p-4">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                              {/* Weekly Demand Bar Chart */}
                              <div
                                className={`p-3.5 rounded-2xl border ${
                                  isDarkMode
                                    ? 'bg-slate-800/80 border-slate-700'
                                    : 'bg-white border-slate-200'
                                }`}
                              >
                                <div className="font-black text-xs mb-3 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                                  <BarChart3 className="w-4 h-4" />
                                  توزيع الطلب أسبوعياً (بالكارتون)
                                </div>
                                <div className="space-y-2">
                                  {weekBuckets.map((wb) => {
                                    const wVal = row.weekCartons[wb.key] || 0;
                                    const wPct = Math.round((wVal / maxRowWeek) * 100);
                                    return (
                                      <div key={wb.key} className="space-y-1">
                                        <div className="flex items-center justify-between text-[11px]">
                                          <span className="font-bold text-slate-600 dark:text-slate-300">
                                            {wb.label} ({wb.shortRange})
                                          </span>
                                          <span className="font-black text-emerald-600 dark:text-emerald-400">
                                            {formatCartons(wVal)} كارتون
                                          </span>
                                        </div>
                                        <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                          <div
                                            className="h-full rounded-full bg-emerald-500 transition-all"
                                            style={{ width: `${wPct}%` }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Top Delegates */}
                              <div
                                className={`p-3.5 rounded-2xl border ${
                                  isDarkMode
                                    ? 'bg-slate-800/80 border-slate-700'
                                    : 'bg-white border-slate-200'
                                }`}
                              >
                                <div className="font-black text-xs mb-3 flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
                                  <TrendingUp className="w-4 h-4" />
                                  أكثر المندوبين طلباً للصنف
                                </div>
                                {row.topDelegates.length === 0 ? (
                                  <div className="text-xs text-slate-400">لا توجد بيانات</div>
                                ) : (
                                  <div className="space-y-2">
                                    {row.topDelegates.map((d, di) => (
                                      <div
                                        key={d.name}
                                        className="flex items-center justify-between text-xs py-1 border-b last:border-b-0 border-slate-100 dark:border-slate-700/60"
                                      >
                                        <span className="font-bold">
                                          {di + 1}. {d.name}
                                        </span>
                                        <span className="font-black text-sky-600 dark:text-sky-400">
                                          {formatCartons(d.cartons)} كارتون
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Top Customers & Purchase Decision Summary */}
                              <div
                                className={`p-3.5 rounded-2xl border ${
                                  isDarkMode
                                    ? 'bg-slate-800/80 border-slate-700'
                                    : 'bg-white border-slate-200'
                                }`}
                              >
                                <div className="font-black text-xs mb-3 flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                                  <ShoppingBag className="w-4 h-4" />
                                  أكثر المحلات طلباً ({row.customerCount} زبون)
                                </div>
                                <div className="space-y-2">
                                  {row.topCustomers.map((c, ci) => (
                                    <div
                                      key={c.name}
                                      className="flex items-center justify-between text-xs py-1 border-b last:border-b-0 border-slate-100 dark:border-slate-700/60"
                                    >
                                      <span className="font-bold truncate max-w-[180px]">
                                        {ci + 1}. {c.name}
                                      </span>
                                      <span className="font-black text-purple-600 dark:text-purple-400">
                                        {formatCartons(c.cartons)} كارتون
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>

              {/* Dynamic Totals Footer */}
              <tfoot
                className={`border-t-2 font-black ${
                  isDarkMode
                    ? 'bg-slate-800/95 border-slate-700 text-white'
                    : 'bg-slate-100 border-slate-300 text-slate-900'
                }`}
              >
                <tr>
                  <td className="p-3" colSpan={3}>
                    الإجمالي ({filteredAndSortedRows.length} صنف)
                  </td>
                  <td className="p-3 text-amber-600 dark:text-amber-400">
                    {formatCartons(tableFooterTotals.totalCartons)} كارتون
                  </td>
                  <td className="p-3 text-teal-600 dark:text-teal-400">
                    {formatCartons(tableFooterTotals.totalDailyAvg)} / يوم
                  </td>
                  <td className="p-3 text-amber-600 dark:text-amber-400">
                    {formatCartons(tableFooterTotals.totalDailyRetailAvg)} / يوم
                  </td>
                  <td className="p-3 text-indigo-600 dark:text-indigo-400">
                    {formatCartons(tableFooterTotals.totalDailyWholesaleAvg)} / يوم
                  </td>
                  <td className="p-3 text-sky-600 dark:text-sky-400">
                    {formatCartons(tableFooterTotals.totalWeeklyAvg)} / أسبوع
                  </td>
                  {canShowInlineWeeks &&
                    weekBuckets.map((wb) => (
                      <td key={wb.key} className="p-2.5 text-center font-mono text-emerald-600 dark:text-emerald-400">
                        {formatCartons(tableFooterTotals.weekSums[wb.key] || 0)}
                      </td>
                    ))}
                  <td className="p-3 text-center font-mono">
                    {summaryStats.invoiceCount}
                  </td>
                  <td className="p-3 font-mono">
                    {formatCartons(tableFooterTotals.totalStockCartons)}
                  </td>
                  <td className="p-3 text-rose-600 dark:text-rose-400">
                    {tableFooterTotals.totalSuggested > 0
                      ? `مجموع المقترح: +${tableFooterTotals.totalSuggested} كارتون`
                      : 'المخزون متوازن'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
