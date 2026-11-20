import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSales } from '../context/SalesContext';
import { useDebounce } from '../hooks/useDebounce';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { db } from '../lib/firebase';
import { logFirestoreErrorGracefully, clearGlobalQuotaExceeded, isQuotaExceededError, safeOnSnapshot } from '../lib/firestoreUtils';
import {
  collection,
  getDocs,
  query,
  doc,
  writeBatch,
  where,
  setDoc,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { SalesEntry, RouteItem, DebtItem } from '../types';
import { parseArabicDigits, parseArabicNumber } from '../utils/numberUtils';
import html2canvas from 'html2canvas-pro';
import { captureInvoiceToBlob, shareOrDownloadInvoice } from '../utils/invoiceCapture';
import { printInvoiceDirectly } from '../utils/directInvoicePrint';
import { 
  FileText, 
  Search, 
  Calendar, 
  Printer, 
  MessageCircle,
  Download, 
  ShoppingCart, 
  Package, 
  ShieldAlert, 
  Store, 
  User, 
  ChevronDown, 
  ChevronUp, 
  RotateCcw,
  RefreshCw,
  Sparkles,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  XCircle,
  Scale,
  Phone,
  Loader2,
  ArrowUp
} from 'lucide-react';
import { formatWithCommas } from '../utils/numberUtils';
import logoImg from '../assets/images/logo.png';
import * as XLSX from 'xlsx';

// Helper to normalize Arabic text for resilient matching
const normalizeArabic = (text: string) => {
  if (!text) return '';
  return text
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
};

// Helper to normalize date strings to YYYY-MM-DD
const normalizeDateStr = (raw: string): string => {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/\//g, '-');
  const parts = cleaned.split('-');
  if (parts.length === 3) {
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return cleaned;
};

const ARCHIVE_PAGE_SIZE = 200;

const buildMonthsBetween = (earliestDate?: string, latestDate?: string): string[] => {
  if (!earliestDate || !latestDate) return [];
  const startNorm = normalizeDateStr(earliestDate);
  const endNorm = normalizeDateStr(latestDate);
  const [sy, sm] = startNorm.split('-').map((n) => parseInt(n, 10));
  const [ey, em] = endNorm.split('-').map((n) => parseInt(n, 10));
  if (!sy || !sm || !ey || !em) return [];
  const months: string[] = [];
  let y = ey;
  let m = em;
  let guard = 0;
  while ((y > sy || (y === sy && m >= sm)) && guard < 120) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    guard += 1;
  }
  return months;
};

export const OldInvoicesScreen: React.FC = () => {
  const { 
    currentUser, 
    allSalesEntries = [], 
    salesEntries = [],
    productsList = [], 
    delegatesList = [], 
    delegateAccounts = [],
    routes: contextRoutes = [],
    isDarkMode, 
    setActiveTab,
    addToast
  } = useSales();

  // Strict Admin Access Check
  if (!currentUser?.isAdmin) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6 text-center">
        <div className={`p-8 rounded-2xl border-2 shadow-xl space-y-4 ${isDarkMode ? 'bg-slate-900 border-rose-500/50 text-white' : 'bg-white border-rose-400 text-slate-900'}`}>
          <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 mx-auto flex items-center justify-center">
            <ShieldAlert className="w-10 h-10" />
          </div>
          <h2 className="text-xl font-black text-rose-600 dark:text-rose-400">
            غير مصرح بالدخول (Admin Only)
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto font-bold">
            صفحة الفواتير القديمة مخصصة حصرياً للمدراء لعرض وتدقيق الأرشيف التاريخي لمبيعات المندوبين.
          </p>
          <button
            onClick={() => setActiveTab('entry')}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-md transition-all cursor-pointer"
          >
            العودة لصفحة الفواتير
          </button>
        </div>
      </div>
    );
  }

  // State for search and filters
  const [shopSearchTerm, setShopSearchTerm] = useState('');
  const debouncedShopSearchTerm = useDebounce(shopSearchTerm, 400);
  const [selectedDelegate, setSelectedDelegate] = useState<string>('الكل');
  const [selectedPriceMode, setSelectedPriceMode] = useState<'الكل' | 'retail' | 'wholesale'>('الكل');
  const [selectedMonth, setSelectedMonth] = useState<string>('الكل');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<string>('الكل');
  const [archivedEntries, setArchivedEntries] = useState<SalesEntry[]>([]);
  const [isLoadingArchive, setIsLoadingArchive] = useState(true);
  const [isFetchingMoreArchive, setIsFetchingMoreArchive] = useState(false);
  const [hasMoreArchiveFromServer, setHasMoreArchiveFromServer] = useState(true);
  const [archiveFetchError, setArchiveFetchError] = useState<string | null>(null);
  const [totalArchiveDocsCount, setTotalArchiveDocsCount] = useState<number | null>(null);
  const [archiveMonthRange, setArchiveMonthRange] = useState<string[]>([]);
  const [deletingInvoiceKey, setDeletingInvoiceKey] = useState<string | null>(null);
  const [isSharingWhatsApp, setIsSharingWhatsApp] = useState<string | null>(null);

  const lastArchiveDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const archiveFetchInFlightRef = useRef<boolean>(false);
  const archiveRequestIdRef = useRef<number>(0);

  // Auto-lock closing time (default 21:00 / 9:00 PM) & real-time clock tick
  const [targetAutoLockTime, setTargetAutoLockTime] = useState<string>('21:00');
  const [timeTick, setTimeTick] = useState<number>(Date.now());
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});

  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [monthlyReportMonth, setMonthlyReportMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [monthlyOrderedSearch, setMonthlyOrderedSearch] = useState<string>('');
  const [monthlyOrderedDelegate, setMonthlyOrderedDelegate] = useState<string>('الكل');
  const [monthlyUnorderedSearch, setMonthlyUnorderedSearch] = useState<string>('');
  const [monthlyUnorderedDelegate, setMonthlyUnorderedDelegate] = useState<string>('الكل');

  const monthlyOrderedScrollContainerRef = useRef<HTMLDivElement>(null);
  const monthlyUnorderedScrollContainerRef = useRef<HTMLDivElement>(null);
  const archiveSectionTopRef = useRef<HTMLDivElement>(null);

  const [routes, setRoutes] = useState<RouteItem[]>(() => contextRoutes);

  useEffect(() => {
    if (contextRoutes.length > 0) {
      setRoutes(contextRoutes);
    }
  }, [contextRoutes]);

  useEffect(() => {
    const q = query(collection(db, 'debts'));
    const unsub = safeOnSnapshot(
      q, 
      (snap: any) => {
        const loaded: DebtItem[] = [];
        snap.forEach((d: any) => loaded.push({ id: d.id, ...d.data() } as DebtItem));
        setDebts(loaded);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'debts in OldInvoicesScreen');
      },
      'OldInvoices-debts'
    );
    return () => unsub();
  }, []);

  // Real-time listener for configurable auto_lock_time setting
  useEffect(() => {
    const unsub = safeOnSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (docSnap: any) => {
        if (docSnap.exists() && docSnap.data()?.time) {
          setTargetAutoLockTime(docSnap.data().time);
        }
      },
      (err: any) => {
        console.error('Error listening to auto_lock_time in OldInvoicesScreen:', err);
      },
      'OldInvoices-auto-lock'
    );
    return () => unsub();
  }, []);

  // Timer tick every 10 seconds to update closing time trigger in real-time
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeTick(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Format targetAutoLockTime for Arabic display (e.g. 15:00 -> 03:00 م)
  const formattedTargetTime = useMemo(() => {
    try {
      const [hStr, mStr] = targetAutoLockTime.split(':');
      let h = parseInt(hStr || '15', 10);
      const m = mStr || '00';
      const ampm = h >= 12 ? 'م' : 'ص';
      h = h % 12;
      h = h ? h : 12;
      return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
    } catch {
      return '03:00 م';
    }
  }, [targetAutoLockTime]);

  // Current Baghdad date info & whether official closing time has been reached
  const baghdadStatus = useMemo(() => {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Baghdad',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const todayBaghdad = formatter.format(now); // "YYYY-MM-DD"

      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baghdad',
        hour12: false,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
      const parts = timeFormatter.formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);

      const currentSeconds = hour * 3600 + minute * 60 + second;

      const [hStr, mStr] = targetAutoLockTime.split(':');
      const targetHours = parseInt(hStr || '15', 10);
      const targetMinutes = parseInt(mStr || '00', 10);
      const targetSeconds = targetHours * 3600 + targetMinutes * 60;

      const isPastClosing = currentSeconds >= targetSeconds;

      return { todayBaghdad, isPastClosing };
    } catch {
      const todayBaghdad = new Date().toISOString().split('T')[0];
      return { todayBaghdad, isPastClosing: false };
    }
  }, [targetAutoLockTime, timeTick]);

  // Real-time listener for today's daily_sales_completion
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const baghdadToday = baghdadStatus.todayBaghdad;
    const queryDates = Array.from(new Set([today, baghdadToday]));
    const q = query(collection(db, 'daily_sales_completion'), where('date', 'in', queryDates));
    const unsub = safeOnSnapshot(
      q,
      (snap: any) => {
        const completed: Record<string, boolean> = {};
        snap.forEach((d: any) => {
          completed[d.id] = true;
          const data = d.data();
          if (data.delegate) completed[data.delegate] = true;
          if (data.delegateName) completed[data.delegateName] = true;
          if (data.delegateCode) completed[data.delegateCode] = true;
        });
        setCompletedDelegates(completed);
      },
      (err: any) => {
        console.error('Error listening to daily_sales_completion in OldInvoicesScreen:', err);
      },
      'OldInvoices-completion'
    );
    return () => unsub();
  }, [baghdadStatus.todayBaghdad]);

  // Lightweight archive metadata fetch (3 reads total) for total count & month dropdown
  useEffect(() => {
    let cancelled = false;
    const colRef = collection(db, 'sales_entries_archive');

    Promise.all([
      getCountFromServer(colRef).catch(() => null),
      getDocs(query(colRef, orderBy('dateString', 'asc'), limit(1))).catch(() => null),
      getDocs(query(colRef, orderBy('dateString', 'desc'), limit(1))).catch(() => null),
    ]).then(([countSnap, earliestSnap, latestSnap]) => {
      if (cancelled) return;
      if (countSnap) {
        setTotalArchiveDocsCount(countSnap.data().count);
      }
      const earliestDate = earliestSnap?.docs[0]?.data()?.dateString;
      const latestDate = latestSnap?.docs[0]?.data()?.dateString;
      if (earliestDate && latestDate) {
        setArchiveMonthRange(buildMonthsBetween(earliestDate, latestDate));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Server-side cursor-paginated fetcher for `sales_entries_archive` (200 docs/page instead of loading 27k+ docs at once)
  const fetchArchivePage = useCallback(
    async (isInitial: boolean, pageSizeOverride?: number) => {
      if (!isInitial && (archiveFetchInFlightRef.current || !hasMoreArchiveFromServer)) {
        return;
      }

      const requestId = isInitial ? ++archiveRequestIdRef.current : archiveRequestIdRef.current;
      const pageSize = pageSizeOverride || ARCHIVE_PAGE_SIZE;

      archiveFetchInFlightRef.current = true;
      if (isInitial) {
        setIsLoadingArchive(true);
        setArchiveFetchError(null);
        lastArchiveDocRef.current = null;
        setHasMoreArchiveFromServer(true);
      } else {
        setIsFetchingMoreArchive(true);
      }

      try {
        const colRef = collection(db, 'sales_entries_archive');
        const cursor = !isInitial ? lastArchiveDocRef.current : null;
        let q;

        if (selectedDate) {
          q = cursor
            ? query(colRef, where('dateString', '==', selectedDate), startAfter(cursor), limit(pageSize))
            : query(colRef, where('dateString', '==', selectedDate), limit(pageSize));
        } else if (selectedMonth !== 'الكل') {
          const monthStart = `${selectedMonth}-01`;
          const monthEnd = `${selectedMonth}-31`;
          q = cursor
            ? query(
                colRef,
                where('dateString', '>=', monthStart),
                where('dateString', '<=', monthEnd),
                orderBy('dateString', 'desc'),
                startAfter(cursor),
                limit(pageSize)
              )
            : query(
                colRef,
                where('dateString', '>=', monthStart),
                where('dateString', '<=', monthEnd),
                orderBy('dateString', 'desc'),
                limit(pageSize)
              );
        } else if (selectedDelegate !== 'الكل') {
          q = cursor
            ? query(
                colRef,
                where('delegateName', '==', selectedDelegate),
                orderBy('timestamp', 'desc'),
                startAfter(cursor),
                limit(pageSize)
              )
            : query(
                colRef,
                where('delegateName', '==', selectedDelegate),
                orderBy('timestamp', 'desc'),
                limit(pageSize)
              );
        } else {
          q = cursor
            ? query(colRef, orderBy('timestamp', 'desc'), startAfter(cursor), limit(pageSize))
            : query(colRef, orderBy('timestamp', 'desc'), limit(pageSize));
        }

        const snap = await getDocs(q);
        if (requestId !== archiveRequestIdRef.current) return;

        const batchList: SalesEntry[] = [];
        snap.forEach((d) => {
          const raw = d.data() as SalesEntry;
          batchList.push({ ...raw, id: raw?.id || d.id } as SalesEntry);
        });

        lastArchiveDocRef.current = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : lastArchiveDocRef.current;
        setHasMoreArchiveFromServer(snap.docs.length >= pageSize);
        setArchiveFetchError(null);

        if (isInitial) {
          setArchivedEntries(batchList);
        } else if (batchList.length > 0) {
          setArchivedEntries((prev) => {
            const merged = new Map<string, SalesEntry>();
            prev.forEach((item) => {
              if (item?.id) merged.set(item.id, item);
            });
            batchList.forEach((item) => {
              if (item?.id) merged.set(item.id, item);
            });
            return Array.from(merged.values());
          });
        }
      } catch (err: any) {
        if (requestId !== archiveRequestIdRef.current) return;
        console.error('Error fetching paginated sales_entries_archive:', err);
        if (isQuotaExceededError(err)) {
          setArchiveFetchError('تم الوصول مؤقتاً إلى حد قراءة قاعدة البيانات اليومي. يرجى المحاولة لاحقاً.');
        } else {
          setArchiveFetchError('تعذر الاتصال بسجل الأرشيف حالياً. يرجى الضغط على إعادة المحاولة.');
        }
        setHasMoreArchiveFromServer(false);
      } finally {
        if (requestId === archiveRequestIdRef.current) {
          archiveFetchInFlightRef.current = false;
          setIsLoadingArchive(false);
          setIsFetchingMoreArchive(false);
        }
      }
    },
    [selectedDate, selectedMonth, selectedDelegate, hasMoreArchiveFromServer]
  );

  // Trigger initial server page load whenever server-side archive filters change
  useEffect(() => {
    fetchArchivePage(true);
  }, [selectedDate, selectedMonth, selectedDelegate]);

  // Helper to check if a representative has marked today's sales as completed
  const isDelegateCompletedToday = (delName?: string, delCode?: string) => {
    if (!delName && !delCode) return false;
    const nName = delName ? normalizeArabic(delName) : '';
    const nCode = delCode ? normalizeArabic(delCode) : '';

    for (const [key, val] of Object.entries(completedDelegates)) {
      if (!val) continue;
      const nKey = normalizeArabic(key);
      if (nName && (nKey === nName || nKey.includes(nName) || nName.includes(nKey))) return true;
      if (nCode && nKey === nCode) return true;
    }
    return false;
  };

  // Helper to verify if an active (non-archived) invoice entry is eligible into "Old Invoices"
  const isEntryEligibleForOldInvoices = (entry: SalesEntry): boolean => {
    if (!entry.dateString) return true;
    const cleanDate = normalizeDateStr(entry.dateString);
    const { todayBaghdad, isPastClosing } = baghdadStatus;

    // 1. Past dates in history: closing time has already passed
    if (cleanDate < todayBaghdad) {
      return true;
    }

    // 2. Future dates: not reached yet
    if (cleanDate > todayBaghdad) {
      return false;
    }

    // 3. Current day (today):
    if (isPastClosing) {
      return true;
    }

    return isDelegateCompletedToday(entry.delegateName, (entry as any).delegateCode);
  };

  // Background archiving synchronization:
  // Only archive eligible entries from active today's `salesEntries` (avoids re-writing historical docs)
  useEffect(() => {
    if (!salesEntries || salesEntries.length === 0) return;
    const archivedIds = new Set(archivedEntries.map((e) => e.id));
    const entriesToArchive = salesEntries.filter(
      (e) => e.id && !archivedIds.has(e.id) && isEntryEligibleForOldInvoices(e)
    );

    if (entriesToArchive.length > 0) {
      const chunks: SalesEntry[][] = [];
      for (let i = 0; i < entriesToArchive.length; i += 400) {
        chunks.push(entriesToArchive.slice(i, i + 400));
      }
      chunks.forEach(async (chunk) => {
        try {
          const batch = writeBatch(db);
          chunk.forEach((entry) => {
            if (entry.id) {
              const archiveRef = doc(db, 'sales_entries_archive', entry.id);
              batch.set(
                archiveRef,
                {
                  ...entry,
                  archivedAt: new Date().toISOString(),
                  archiveReason: baghdadStatus.isPastClosing ? 'closing_time_expired' : 'delegate_completed_sales',
                },
                { merge: true }
              );
            }
          });
          await batch.commit();
        } catch (err) {
          console.error('Error auto-syncing eligible invoices to archive:', err);
        }
      });
    }
  }, [salesEntries, archivedEntries, baghdadStatus, completedDelegates]);

  // Merge paginated archived entries (always included) + eligible recent/today entries without duplicates
  const allEntriesCombined = useMemo(() => {
    const map = new Map<string, SalesEntry>();
    // Active / context entries must satisfy daily closing/completion rule
    allSalesEntries.forEach((e) => {
      if (e && e.id && isEntryEligibleForOldInvoices(e)) {
        map.set(e.id, e);
      }
    });
    // Entries loaded from `sales_entries_archive` are already archived historical records
    archivedEntries.forEach((e) => {
      if (e && e.id) {
        map.set(e.id, e);
      }
    });
    return Array.from(map.values());
  }, [allSalesEntries, archivedEntries, baghdadStatus, completedDelegates]);

  // Extract available months for filtering (sorted descending) — includes full server archive range
  const availableMonths = useMemo(() => {
    const months = new Set<string>(archiveMonthRange);
    allEntriesCombined.forEach(e => {
      if (e.dateString) {
        const parts = e.dateString.replace(/\//g, '-').split('-');
        if (parts.length >= 2) {
          months.add(`${parts[0]}-${parts[1].padStart(2, '0')}`);
        }
      }
    });
    return Array.from(months).sort().reverse();
  }, [allEntriesCombined, archiveMonthRange]);

  // Count of completed delegates for UI badge
  const completedDelegatesCount = useMemo(() => {
    return delegatesList.filter((name) => isDelegateCompletedToday(name)).length;
  }, [delegatesList, completedDelegates]);

  // Dynamic list of unique product names from catalog and entries
  const availableProductsList = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(productsList)) {
      productsList.forEach(p => {
        const name = (p?.productName || '').trim();
        if (name) set.add(name);
      });
    }
    if (Array.isArray(allEntriesCombined)) {
      allEntriesCombined.forEach(e => {
        const name = (e?.productName || '').trim();
        if (name) set.add(name);
      });
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [productsList, allEntriesCombined]);

  // Fast O(1) Product & Route lookup maps to accelerate grouping and infinite scroll rendering
  const productsByNameMap = useMemo(() => {
    const map = new Map<string, (typeof productsList)[number]>();
    productsList.forEach((p) => {
      if (p?.productName) {
        map.set(p.productName, p);
      }
    });
    return map;
  }, [productsList]);

  const { routePhoneByCode, routePhoneByName } = useMemo(() => {
    const byCode = new Map<string, string>();
    const byName = new Map<string, string>();
    contextRoutes.forEach((r) => {
      const phone = r.customerPhone ? String(r.customerPhone).trim() : '';
      if (!phone) return;
      const code = String(r.customerCode || '').trim();
      const name = (r.customerName || '').trim();
      if (code && !byCode.has(code)) byCode.set(code, phone);
      if (name && !byName.has(name)) byName.set(name, phone);
    });
    return { routePhoneByCode: byCode, routePhoneByName: byName };
  }, [contextRoutes]);

  // Product Code lookup helper
  const getProductCode = (productName: string) => {
    const prod = productsByNameMap.get(productName);
    return prod?.productCode || '---';
  };

  // Group historical entries into distinct invoices:
  // Key = dateString + customerCode/Name + delegateName + priceMode (+ invoiceId if present)
  const groupedOldInvoices = useMemo(() => {
    const term = debouncedShopSearchTerm.trim().toLowerCase();

    // Filter entries first
    const filtered = allEntriesCombined.filter(e => {
      // 1. Search by Store / Shop Name (اسم المحل) or Customer Code
      if (term) {
        const cName = (e.customerName || '').toLowerCase();
        const cCode = String(e.customerCode || '').toLowerCase();
        const pName = (e.productName || '').toLowerCase();
        if (!cName.includes(term) && !cCode.includes(term) && !pName.includes(term)) {
          return false;
        }
      }

      // 2. Filter by Delegate
      if (selectedDelegate !== 'الكل') {
        if ((e.delegateName || '').trim() !== selectedDelegate.trim()) {
          return false;
        }
      }

      // 3. Filter by Price Mode (مفرد / جملة)
      if (selectedPriceMode !== 'الكل') {
        if (e.priceMode !== selectedPriceMode) {
          return false;
        }
      }

      // 4. Filter by Date (exact)
      if (selectedDate) {
        if (e.dateString !== selectedDate) {
          return false;
        }
      }

      // 5. Filter by Month
      if (!selectedDate && selectedMonth !== 'الكل') {
        if (!e.dateString || !e.dateString.startsWith(selectedMonth)) {
          return false;
        }
      }

      // 6. Filter by Product
      if (selectedProduct !== 'الكل') {
        if ((e.productName || '').trim() !== selectedProduct.trim()) {
          return false;
        }
      }

      return true;
    });

    // Grouping
    const groups: Record<string, {
      invoiceKey: string;
      customerName: string;
      customerCode: string;
      customerAddress: string;
      delegateName: string;
      dateString: string;
      timestamp: number;
      priceMode: 'retail' | 'wholesale';
      entries: SalesEntry[];
      totalWeight: number;
      totalAmount: number;
    }> = {};

    filtered.forEach(entry => {
      const cName = entry.customerName || 'بدون اسم محل';
      const cCode = String(entry.customerCode || '').trim();
      const dDate = entry.dateString || 'تاريخ غير محدد';
      const del = entry.delegateName || 'غير محدد';
      const mode = entry.priceMode || 'retail';
      const invId = entry.invoiceId || '';

      const groupKey = `${dDate}_${cCode || cName}_${del}_${mode}${invId ? `_${invId}` : ''}`;

      if (!groups[groupKey]) {
        groups[groupKey] = {
          invoiceKey: groupKey,
          customerName: cName,
          customerCode: cCode,
          customerAddress: entry.customerAddress || '',
          delegateName: del,
          dateString: dDate,
          timestamp: entry.timestamp || (entry.dateString ? new Date(entry.dateString).getTime() : 0),
          priceMode: mode,
          entries: [],
          totalWeight: 0,
          totalAmount: 0,
        };
      }

      const grp = groups[groupKey];
      grp.entries.push(entry);
      grp.totalWeight += (entry.totalWeightKg || 0);

      const prod = productsByNameMap.get(entry.productName);
      const unitPrice = prod 
        ? (mode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) 
        : 0;
      grp.totalAmount += (unitPrice * (entry.quantity || 0));
    });

    // Sort invoices by date / timestamp descending (newest first)
    return Object.values(groups).sort((a, b) => {
      if (b.dateString !== a.dateString) {
        return b.dateString.localeCompare(a.dateString);
      }
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
  }, [allEntriesCombined, debouncedShopSearchTerm, selectedDelegate, selectedPriceMode, selectedMonth, selectedDate, selectedProduct, productsByNameMap]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalInvoices = groupedOldInvoices.length;
    const totalWeight = groupedOldInvoices.reduce((sum, inv) => sum + inv.totalWeight, 0);
    const totalAmount = groupedOldInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const uniqueShops = new Set(groupedOldInvoices.map(inv => inv.customerCode || inv.customerName)).size;
    return { totalInvoices, totalWeight, totalAmount, uniqueShops };
  }, [groupedOldInvoices]);

  const getCustomerPhoneForOldInvoice = (inv: typeof groupedOldInvoices[0]): string => {
    if (inv.entries[0]?.customerPhone && String(inv.entries[0].customerPhone).trim()) {
      return String(inv.entries[0].customerPhone).trim();
    }
    const cCode = inv.customerCode ? String(inv.customerCode).trim() : '';
    if (cCode) {
      const matchedPhone = routePhoneByCode.get(cCode);
      if (matchedPhone) return matchedPhone;
    }
    const cleanName = inv.customerName?.trim() || '';
    if (cleanName) {
      const matchedByName = routePhoneByName.get(cleanName);
      if (matchedByName) return matchedByName;
    }
    const phoneRegex = /(?:\+964|0)?7[3-9]\d[\s-]?\d{3}[\s-]?\d{4}/;
    const phoneMatch = cleanName.match(phoneRegex);
    if (phoneMatch) return phoneMatch[0].trim();
    return '';
  };

  // Exact Match Receipt Thermal Printing & WhatsApp image sharing (matches image_3f678d98.png)
  const handleWhatsAppInvoice = async (inv: typeof groupedOldInvoices[0], targetPhoneOverride?: string) => {
    const invoiceKey = inv.invoiceKey;
    const delegateName = inv.entries[0]?.delegateName || 'غير محدد';
    const customerAddress = inv.customerAddress || inv.entries[0]?.customerAddress || '';
    
    // Clean the customer name for the filename and message
    const phoneRegex = /(?:\+964|0)?7[3-9]\d[\s-]?\d{3}[\s-]?\d{4}/;
    let actualCustomerName = inv.customerName || 'زبون';
    actualCustomerName = actualCustomerName.replace(phoneRegex, '').replace(/[|\\/?:*"><]/g, '').replace(/^[\s-–—:]+|[\s-–—:]+$/g, '').trim() || 'زبون';
    
    let customerPhone = targetPhoneOverride || getCustomerPhoneForOldInvoice(inv);
    const phoneMatch = (inv.customerName || '').match(phoneRegex);
    if (phoneMatch && !customerPhone) {
      customerPhone = phoneMatch[0];
    }

    const invoicePriceModeStr = inv.entries[0]?.priceMode === 'wholesale' ? 'جملة' : 'مفرد';
    const entryDate = inv.entries[0]?.timestamp ? new Date(inv.entries[0].timestamp) : new Date();
    const day = String(entryDate.getDate()).padStart(2, '0');
    const month = String(entryDate.getMonth() + 1).padStart(2, '0');
    const year = entryDate.getFullYear();
    const hours = String(entryDate.getHours()).padStart(2, '0');
    const minutes = String(entryDate.getMinutes()).padStart(2, '0');
    const seconds = String(entryDate.getSeconds()).padStart(2, '0');
    const formattedDate = `${day}/${month}/${year}`;
    const formattedTime = `${hours}:${minutes}:${seconds}`;

    setIsSharingWhatsApp(invoiceKey);

    // Defer the heavy work to the next frame to allow the loading state to render first
    await new Promise(resolve => setTimeout(resolve, 100));

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '-9999px';
    container.style.left = '-9999px';
    container.style.width = '350px';
    container.style.background = '#ffffff';
    container.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
    container.style.padding = '14px 16px';
    container.style.color = '#000000';
    container.style.direction = 'rtl';
    container.style.boxSizing = 'border-box';
    container.style.border = '1px solid #000';

    let rowsHtml = '';
    let totalPrice = 0;
    
    inv.entries.forEach((e, idx) => {
      const isGift = Boolean(e.isGift);
      const prod = productsList.find(p => p.productName === e.productName);
      const price = prod && !isGift ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
      const rowPrice = price * e.quantity;
      totalPrice += rowPrice;
      
      const cartonQty = Number(prod?.cartonQuantity) || 1;
      let qtyMain = `${e.quantity} قطعة`;
      let qtySub = '';

      if (cartonQty > 1) {
        if (e.quantity % cartonQty === 0) {
          const cartons = e.quantity / cartonQty;
          qtyMain = `${cartons} كارتون`;
          qtySub = `(${e.quantity} قطعة)`;
        } else if (e.quantity >= cartonQty) {
          const fullCartons = Math.floor(e.quantity / cartonQty);
          const remainder = e.quantity % cartonQty;
          qtyMain = `${fullCartons} كارتون`;
          if (remainder > 0) {
            qtyMain += ` و ${remainder} ق`;
          }
          qtySub = `(${e.quantity} قطعة)`;
        } else {
          qtyMain = `${e.quantity} قطعة`;
          qtySub = '';
        }
      }

      // Column order in visual (RTL): # (right), Product, Quantity, Price (left)
      rowsHtml += `
        <tr style="border-bottom: 1px dashed #bbb;">
          <td style="padding: 7px 2px; text-align: center; font-size: 13px; font-weight: bold; color: #000; width: 8%;">
            ${idx + 1}
          </td>
          <td style="padding: 7px 4px; text-align: right; font-size: 12px; font-weight: bold; line-height: 1.25; color: #000; width: 42%;">
            ${isGift ? '<span style="color: #b45309;">[هدية] </span>' : ''}${e.productName}
          </td>
          <td style="padding: 7px 2px; text-align: center; font-size: 12px; line-height: 1.2; width: 25%;">
            <div style="font-weight: 900; color: #000;">${qtyMain}</div>
            ${qtySub ? `<div style="font-size: 10px; color: #444; font-weight: bold;">${qtySub}</div>` : ''}
          </td>
          <td style="padding: 7px 2px; text-align: left; font-size: 13px; font-weight: bold; white-space: nowrap; width: 25%;">
            ${formatWithCommas(rowPrice, true)} د.ع
          </td>
        </tr>
      `;
    });

    const displayPhone = customerPhone ? parseArabicDigits(customerPhone).replace(/\D/g, '') : '';

    container.innerHTML = `
      <div style="text-align: center; margin-bottom: 4px;">
        <img src="${logoImg}" style="height: 48px; max-width: 100px; object-fit: contain; margin: 0 auto 4px auto; display: block;" />
        <div style="font-size: 16px; font-weight: 900; color: #000; text-align: center;">تطبيق ياسر للمبيعات | كالة فرع صلاح الدين</div>
      </div>
      <div style="border-top: 1.5px dashed #000; margin: 8px 0;"></div>
      
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div style="text-align: left; font-family: monospace; font-size: 11px; font-weight: bold; color: #000; line-height: 1.3; direction: ltr;">
          ,${formattedDate}<br/>${formattedTime}
        </div>
        <div style="text-align: right; flex: 1;">
          <div style="font-size: 20px; font-weight: 900; color: #000;">اسم الزبون: ${actualCustomerName}</div>
          ${displayPhone ? `
            <div style="font-size: 22px; font-weight: 900; font-family: monospace; direction: ltr; text-align: right; margin-top: 2px; color: #000;">${displayPhone}-</div>
            <div style="text-align: right; margin-top: 4px;">
              <span style="border: 2px solid #000; border-radius: 6px; padding: 2px 10px; font-size: 14px; font-weight: 900; font-family: monospace; background: #fff; display: inline-block; direction: ltr;">${displayPhone}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div style="font-size: 13px; font-weight: bold; color: #000; line-height: 1.5; margin-bottom: 6px;">
        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 4px;">
          <span>${delegateName || 'غير محدد'}</span>
          <span style="font-weight: 900;">:اسم المندوب</span>
          <span style="font-size: 11px; color: #444; font-weight: normal; margin-right: 4px;">(غير محدد)</span>
        </div>
        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 4px;">
          <span>${customerAddress || 'غير محدد'}</span>
          <span style="font-weight: 900;">:عنوان الزبون</span>
        </div>
      </div>

      <div style="border-top: 1.5px dashed #000; margin: 8px 0;"></div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px;">
        <thead>
          <tr style="border-top: 2px solid #000; border-bottom: 2px solid #000;">
            <th style="padding: 6px 2px; text-align: center; font-size: 13px; font-weight: 900; width: 8%;">#</th>
            <th style="padding: 6px 4px; text-align: right; font-size: 13px; font-weight: 900; width: 42%;">المنتج</th>
            <th style="padding: 6px 2px; text-align: center; font-size: 13px; font-weight: 900; width: 25%;">الكمية</th>
            <th style="padding: 6px 2px; text-align: left; font-size: 13px; font-weight: 900; width: 25%;">السعر (${invoicePriceModeStr})</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 8px 4px; display: flex; justify-content: space-between; align-items: center; margin: 6px 0 10px 0;">
        <div style="font-size: 19px; font-weight: 900; text-align: left;">${formatWithCommas(totalPrice, true)} د.ع</div>
        <div style="font-size: 18px; font-weight: 900; text-align: right;">الإجمالي</div>
      </div>

      <div style="border: 1.5px solid #000; padding: 6px 8px; text-align: center; font-size: 12px; font-weight: 900; color: #000; margin-bottom: 8px;">ملاحظة: قد تختلف الكميات اعلاه لنفاد المخزون.</div>
      <div style="border: 1.5px solid #0b3b8c; padding: 6px 8px; text-align: center; font-size: 13px; font-weight: 900; color: #000;">رقم المبيعات : 07718458337</div>
    `;

    try {
      const fileName = `فاتورة-${actualCustomerName.replace(/\s+/g, '-')}.jpg`;
      const blob = await captureInvoiceToBlob(container, {
        scale: 1.6,
        quality: 0.78,
        maxWidth: 720,
      });

      const message = `🧾 *فاتورة مبيعات - تطبيق كالة*\n👤 *الزبون:* ${actualCustomerName}\n💰 *الإجمالي:* ${formatWithCommas(totalPrice, true)} د.ع\n*(صورة الفاتورة مرفقة)*`;

      await shareOrDownloadInvoice({
        blob,
        fileName,
        message,
        customerPhone,
        actualCustomerName,
        addToast,
      });
    } catch (err) {
      if (container.parentNode) document.body.removeChild(container);
      console.error('Error generating image:', err);
      alert('حدث خطأ أثناء توليد صورة الفاتورة');
    } finally {
      setIsSharingWhatsApp(null);
    }
  };

  const handlePrintInvoice = (inv: typeof groupedOldInvoices[0]) => {
    const actualCustomerName = inv.customerName;
    const customerPhone = getCustomerPhoneForOldInvoice(inv);
    const entries = inv.entries;
    const delegateName = entries[0]?.delegateName || 'غير محدد';
    const customerAddress = inv.customerAddress || entries[0]?.customerAddress || '';
    const customerCode = inv.customerCode || entries[0]?.customerCode || (actualCustomerName.includes('كود:') ? actualCustomerName.split('كود: ')[1].split(' |')[0] : '');
    const priceMode = entries[0]?.priceMode === 'wholesale' ? 'wholesale' : 'retail';

    printInvoiceDirectly({
      customerName: actualCustomerName,
      customerCode,
      customerPhone,
      customerAddress,
      delegateName,
      timestamp: entries[0]?.timestamp || Date.now(),
      priceMode,
      entries: entries.map((e) => ({
        productName: e.productName,
        quantity: e.entryUnit === 'carton' ? (e.quantity || 0) : (e.enteredQuantity || e.quantity || 0),
        enteredQuantity: e.enteredQuantity,
        entryUnit: e.entryUnit,
        isGift: Boolean(e.isGift),
        priceMode: e.priceMode,
      })),
      productsList,
    });
  };


  // Manual deletion of an old/historical invoice (Admin only, never automatic)
  const handleDeleteOldInvoice = async (inv: typeof groupedOldInvoices[0]) => {
    if (!currentUser?.isAdmin) return;
    const ok = window.confirm(
      `هل أنت متأكد من حذف هذه الفاتورة القديمة للزبون (${inv.customerName} - ${inv.dateString}) نهائياً؟\nسيتم حذف جميع الأصناف المسجلة بها (${inv.entries.length} صنف) من السجلات.`
    );
    if (!ok) return;

    try {
      setDeletingInvoiceKey(inv.invoiceKey);
      const batch = writeBatch(db);
      for (const entry of inv.entries) {
        if (entry.id) {
          batch.delete(doc(db, 'sales_entries', entry.id));
          batch.delete(doc(db, 'sales_entries_archive', entry.id));
        }
      }
      await batch.commit();

      setArchivedEntries(prev => prev.filter(e => !inv.entries.some(ie => ie.id === e.id)));
      if (addToast) {
        addToast({
          title: 'تم حذف الفاتورة بالكامل 🗑️⚠️',
          message: `تم حذف الفاتورة القديمة للزبون (${inv.customerName}) بجميع أصنافها (${inv.entries.length} صنف)`,
          type: 'info',
          delegateName: inv.entries[0]?.delegateName || '',
        });
      }
      alert(`تم حذف الفاتورة القديمة للزبون (${inv.customerName}) بنجاح.`);
    } catch (err) {
      console.error('Error deleting old invoice:', err);
      alert('حدث خطأ أثناء حذف الفاتورة القديمة.');
    } finally {
      setDeletingInvoiceKey(null);
    }
  };

  // Comprehensive Excel Export Functionality:
  // Exports all old/historical invoices for all representatives across the entire system,
  // without filtering or limiting to a single representative, search term, or screen view.
  const exportToExcel = () => {
    if (allEntriesCombined.length === 0) {
      alert('لا توجد فواتير قديمة أو تاريخية لتصديرها.');
      return;
    }

    // Group all entries into distinct invoices across the entire system
    const allGroups: Record<string, {
      invoiceKey: string;
      customerName: string;
      customerCode: string;
      customerAddress: string;
      delegateName: string;
      dateString: string;
      timestamp: number;
      priceMode: 'retail' | 'wholesale';
      entries: SalesEntry[];
      totalWeight: number;
      totalAmount: number;
    }> = {};

    allEntriesCombined.forEach(entry => {
      const cName = entry.customerName || 'بدون اسم محل';
      const cCode = String(entry.customerCode ?? '').trim();
      const dDate = entry.dateString || 'تاريخ غير محدد';
      const del = entry.delegateName || 'غير محدد';
      const mode = entry.priceMode || 'retail';
      const invId = entry.invoiceId || '';

      const groupKey = `${dDate}_${cCode || cName}_${del}_${mode}${invId ? `_${invId}` : ''}`;

      if (!allGroups[groupKey]) {
        allGroups[groupKey] = {
          invoiceKey: groupKey,
          customerName: cName,
          customerCode: cCode,
          customerAddress: entry.customerAddress || '',
          delegateName: del,
          dateString: dDate,
          timestamp: entry.timestamp || (entry.dateString ? new Date(entry.dateString).getTime() : 0),
          priceMode: mode,
          entries: [],
          totalWeight: 0,
          totalAmount: 0,
        };
      }

      const grp = allGroups[groupKey];
      grp.entries.push(entry);
      grp.totalWeight += (entry.totalWeightKg || 0);

      if (!entry.isGift) {
        const prod = productsList.find(p => p.productName === entry.productName);
        const unitPrice = prod 
          ? (mode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) 
          : 0;
        grp.totalAmount += (unitPrice * (entry.quantity || 0));
      }
    });

    // Sort invoices by date descending, then delegate name, then customer name
    const sortedInvoices = Object.values(allGroups).sort((a, b) => {
      if (b.dateString !== a.dateString) {
        return b.dateString.localeCompare(a.dateString);
      }
      if (a.delegateName !== b.delegateName) {
        return a.delegateName.localeCompare(b.delegateName);
      }
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    const data: any[] = [];
    sortedInvoices.forEach(inv => {
      inv.entries.forEach(e => {
        if (e.isGift) return; // skip gifts
        const prod = productsList.find(p => p.productName === e.productName);
        const unitPrice = prod 
          ? (inv.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) 
          : 0;
        data.push({
          'تاريخ الفاتورة': inv.dateString,
          'اسم المندوب': inv.delegateName,
          'اسم المحل / الزبون': inv.customerName,
          'كود الزبون': inv.customerCode || '---',
          'عنوان الزبون': inv.customerAddress || '---',
          'نوع الفاتورة': inv.priceMode === 'wholesale' ? 'جملة' : 'مفرد',
          'اسم المنتج': e.productName,
          'الصنف': e.categoryName || '---',
          'كود المنتج': getProductCode(e.productName),
          'الكمية (قطع)': e.quantity,
          'الوزن الكلي (كجم)': e.totalWeightKg,
          'سعر البيع (د.ع)': unitPrice,
          'المبلغ الإجمالي (د.ع)': (unitPrice * e.quantity),
          'ملاحظات': 'بيع اعتيادي'
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'كافة الفواتير التاريخية');
    const todayStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `سجل_الفواتير_القديمة_الشامل_لكل_المندوبين_${todayStr}.xlsx`);
  };

  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.name?.includes('مدخل') ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );

  const canViewMonthlyReports = true;

  const isEntryAdopted = (dateStr?: string, delName?: string, delCode?: string) => {
    if (!dateStr) return false;
    const cleanDate = normalizeDateStr(dateStr);
    const { todayBaghdad, isPastClosing } = baghdadStatus;
    if (cleanDate < todayBaghdad) return true;
    if (cleanDate > todayBaghdad) return false;
    if (isPastClosing) return true;
    return isDelegateCompletedToday(delName, delCode);
  };

  const monthlyOrderedData = useMemo(() => {
    if (!canViewMonthlyReports) return { list: [], totalWeight: 0, totalAmount: 0, totalInvoices: 0 };

    const monthEntries = allEntriesCombined.filter((e) => {
      if (!e.dateString) return false;
      const cleanDate = normalizeDateStr(e.dateString);
      return cleanDate.startsWith(monthlyReportMonth);
    });

    const codeToRoute = new Map<string, RouteItem>();
    const nameToRoute = new Map<string, RouteItem>();
    routes.forEach((r) => {
      const c = (r.customerCode || '').trim();
      const n = (r.customerName || '').trim();
      if (c && !codeToRoute.has(c.toLowerCase())) codeToRoute.set(c.toLowerCase(), r);
      if (n && !nameToRoute.has(n.toLowerCase())) nameToRoute.set(n.toLowerCase(), r);
    });

    const adoptedMonthEntries = monthEntries.filter(entry => {
      return isEntryAdopted(entry.dateString, entry.delegateName, (entry as any).delegateCode);
    });

    const map = new Map<string, {
      customerCode: string;
      customerName: string;
      customerAddress: string;
      delegateName: string;
      totalWeight: number;
      totalAmount: number;
      invoicesCount: number;
      invoiceDates: Set<string>;
    }>();

    adoptedMonthEntries.forEach((entry) => {
      let code = String(entry.customerCode ?? '').trim();
      let name = (entry.customerName || '').trim();

      if (!code && name && nameToRoute.has(name.toLowerCase())) {
        code = String(nameToRoute.get(name.toLowerCase())?.customerCode ?? '').trim();
      }
      if (!name && code && codeToRoute.has(code.toLowerCase())) {
        name = (codeToRoute.get(code.toLowerCase())?.customerName || '').trim();
      }

      const key = code ? `code_${code.toLowerCase()}` : (name ? `name_${name.toLowerCase()}` : '');
      if (!key) return;

      if (!map.has(key)) {
        const routeMatch = (code ? codeToRoute.get(code.toLowerCase()) : undefined) || (name ? nameToRoute.get(name.toLowerCase()) : undefined);
        map.set(key, {
          customerCode: code || String(routeMatch?.customerCode ?? '').trim(),
          customerName: name || (routeMatch?.customerName || '').trim() || 'غير محدد',
          customerAddress: (entry.customerAddress || '').trim() || (routeMatch?.customerAddress || '').trim() || 'غير محدد',
          delegateName: (entry.delegateName || '').trim() || (routeMatch?.delegateName || '').trim() || 'غير محدد',
          totalWeight: 0,
          totalAmount: 0,
          invoicesCount: 0,
          invoiceDates: new Set<string>()
        });
      }

      const item = map.get(key)!;
      if (!item.customerName || item.customerName === 'غير محدد') if (name) item.customerName = name;
      if (!item.customerCode) if (code) item.customerCode = code;
      if ((item.customerAddress === 'غير محدد' || !item.customerAddress) && entry.customerAddress?.trim()) {
        item.customerAddress = entry.customerAddress.trim();
      }
      if ((item.delegateName === 'غير محدد' || !item.delegateName) && entry.delegateName?.trim()) {
        item.delegateName = entry.delegateName.trim();
      }

      item.totalWeight += (entry.totalWeightKg || 0);

      const prod = productsList.find((p) => p.productName === entry.productName);
      const price = prod ? (entry.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
      item.totalAmount += (price * (entry.quantity || 0));

      if (entry.dateString) {
        const cleanDate = normalizeDateStr(entry.dateString);
        if (cleanDate) {
          const invSubKey = entry.invoiceId || (entry as any).invoiceNumber
            ? `${cleanDate}_${entry.invoiceId || (entry as any).invoiceNumber}` 
            : cleanDate;
          item.invoiceDates.add(invSubKey);
        }
      }
      item.invoicesCount = item.invoiceDates.size;
    });

    if (Array.isArray(debts)) {
      debts.forEach((debt) => {
        let code = String(debt.customerCode ?? '').trim();
        let name = (debt.customerName || '').trim();
        const normDebtDate = normalizeDateStr(debt.invoiceDate);

        if (!normDebtDate.startsWith(monthlyReportMonth)) return;

        if (!code && name && nameToRoute.has(name.toLowerCase())) {
          code = String(nameToRoute.get(name.toLowerCase())?.customerCode ?? '').trim();
        }
        if (!name && code && codeToRoute.has(code.toLowerCase())) {
          name = (codeToRoute.get(code.toLowerCase())?.customerName || '').trim();
        }

        const key = code ? `code_${code.toLowerCase()}` : (name ? `name_${name.toLowerCase()}` : '');
        if (!key) return;

        if (!map.has(key)) {
          const routeMatch = (code ? codeToRoute.get(code.toLowerCase()) : undefined) || (name ? nameToRoute.get(name.toLowerCase()) : undefined);
          map.set(key, {
            customerCode: code || String(routeMatch?.customerCode ?? '').trim(),
            customerName: name || (routeMatch?.customerName || '').trim() || 'غير محدد',
            customerAddress: (routeMatch?.customerAddress || '').trim() || 'غير محدد',
            delegateName: (debt.delegateName || '').trim() || (routeMatch?.delegateName || '').trim() || 'غير محدد',
            totalWeight: 0,
            totalAmount: 0,
            invoicesCount: 0,
            invoiceDates: new Set<string>()
          });
        }

        const item = map.get(key)!;
        if (!item.customerName || item.customerName === 'غير محدد') if (name) item.customerName = name;
        if (!item.customerCode) if (code) item.customerCode = code;
        if ((item.delegateName === 'غير محدد' || !item.delegateName) && debt.delegateName?.trim()) {
          item.delegateName = debt.delegateName.trim();
        }

        const debtInvKey = debt.id ? `${normDebtDate}_debt_${debt.id}` : `${normDebtDate}_debt`;
        if (!item.invoiceDates.has(debtInvKey)) {
          item.totalAmount += (Number(debt.amountDue) || 0);
          item.invoiceDates.add(debtInvKey);
        }
        item.invoicesCount = item.invoiceDates.size;
      });
    }

    const list = Array.from(map.values()).sort((a, b) => {
      if (b.invoicesCount !== a.invoicesCount) {
        return b.invoicesCount - a.invoicesCount;
      }
      return b.totalAmount - a.totalAmount;
    });
    const totalWeight = list.reduce((sum, item) => sum + item.totalWeight, 0);
    const totalAmount = list.reduce((sum, item) => sum + item.totalAmount, 0);
    const totalInvoices = list.reduce((sum, item) => sum + item.invoicesCount, 0);

    return { list, totalWeight, totalAmount, totalInvoices };
  }, [allEntriesCombined, salesEntries, debts, monthlyReportMonth, routes, productsList, baghdadStatus, completedDelegates]);

  const filteredMonthlyOrdered = useMemo(() => {
    return monthlyOrderedData.list.filter((c) => {
      const matchDelegate = monthlyOrderedDelegate === 'الكل' || c.delegateName === monthlyOrderedDelegate;
      if (!matchDelegate) return false;

      if (!monthlyOrderedSearch.trim()) return true;
      const q = normalizeArabic(monthlyOrderedSearch);
      return (
        normalizeArabic(c.customerName).includes(q) ||
        normalizeArabic(c.customerCode).includes(q) ||
        normalizeArabic(c.customerAddress).includes(q) ||
        normalizeArabic(c.delegateName).includes(q)
      );
    });
  }, [monthlyOrderedData.list, monthlyOrderedDelegate, monthlyOrderedSearch]);

  const monthlyUnorderedCustomers = useMemo(() => {
    if (!canViewMonthlyReports) return [];

    const orderedCodes = new Set<string>();
    const orderedNames = new Set<string>();
    monthlyOrderedData.list.forEach((c) => {
      if (c.customerCode) orderedCodes.add(c.customerCode.trim().toLowerCase());
      if (c.customerName) orderedNames.add(c.customerName.trim().toLowerCase());
    });

    const uniqueMap = new Map<string, RouteItem>();
    routes.forEach((r) => {
      const code = (r.customerCode || '').trim();
      const name = (r.customerName || '').trim();
      if (!code && !name) return;

      const hasOrderedInMonth = (code && orderedCodes.has(code.toLowerCase())) ||
                                (!code && name && orderedNames.has(name.toLowerCase()));

      if (hasOrderedInMonth) return;

      const key = code ? `code_${code.toLowerCase()}` : `name_${name.toLowerCase()}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, r);
      }
    });

    return Array.from(uniqueMap.values()).sort((a, b) => (a.customerName || '').localeCompare(b.customerName || '', 'ar'));
  }, [routes, monthlyOrderedData.list, canViewMonthlyReports]);

  const filteredMonthlyUnordered = useMemo(() => {
    return monthlyUnorderedCustomers.filter((r) => {
      const matchDelegate = monthlyUnorderedDelegate === 'الكل' || r.delegateName === monthlyUnorderedDelegate;
      if (!matchDelegate) return false;

      if (!monthlyUnorderedSearch.trim()) return true;
      const q = normalizeArabic(monthlyUnorderedSearch);
      return (
        normalizeArabic(r.customerName).includes(q) ||
        normalizeArabic(r.customerCode).includes(q) ||
        normalizeArabic(r.customerAddress).includes(q) ||
        normalizeArabic(r.delegateName).includes(q)
      );
    });
  }, [monthlyUnorderedCustomers, monthlyUnorderedDelegate, monthlyUnorderedSearch]);

  const exportMonthlyOrderedExcel = () => {
    const data = filteredMonthlyOrdered.map((c, idx) => {
      const row: Record<string, any> = {
        'ت': idx + 1,
        'اسم الزبون': c.customerName,
        'كود الزبون': c.customerCode,
        'عنوان الزبون': c.customerAddress,
        'اسم المندوب': c.delegateName,
      };
      if (!isDataEntry) {
        row['عدد الفواتير الشهرية'] = c.invoicesCount;
        row['الوزن الكلي الشهري (كجم)'] = Number(c.totalWeight.toFixed(0));
        row['المبلغ الكلي الشهري (د.ع)'] = Math.round(c.totalAmount);
      }
      row['الشهر المالي'] = monthlyReportMonth;
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'فواتير الزبائن الشهرية');
    XLSX.writeFile(workbook, `تقرير_فواتير_الزبائن_الشهرية_${monthlyReportMonth}.xlsx`);
  };

  const exportMonthlyUnorderedExcel = () => {
    const data = filteredMonthlyUnordered.map((r, idx) => ({
      'ت': idx + 1,
      'اسم الزبون': r.customerName,
      'كود الزبون': r.customerCode,
      'عنوان الزبون': r.customerAddress || 'غير محدد',
      'اسم المندوب': r.delegateName,
      'حالة الشهر': 'لم يتم طلب أي فاتورة طوال هذا الشهر',
      'الشهر المالي': monthlyReportMonth
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'زبائن بدون فواتير شهرية');
    XLSX.writeFile(workbook, `زبائن_بدون_فواتير_شهرية_${monthlyReportMonth}.xlsx`);
  };

  // Infinite Scroll controllers for archive tables & old sales history
  const monthlyOrderedScroll = useInfiniteScroll({
    totalItems: filteredMonthlyOrdered.length,
    initialCount: 25,
    batchSize: 25,
    rootMargin: '180px 0px',
    scrollContainerRef: monthlyOrderedScrollContainerRef,
    resetKey: `${monthlyReportMonth}|${monthlyOrderedSearch}|${monthlyOrderedDelegate}`,
  });

  const monthlyUnorderedScroll = useInfiniteScroll({
    totalItems: filteredMonthlyUnordered.length,
    initialCount: 25,
    batchSize: 25,
    rootMargin: '180px 0px',
    scrollContainerRef: monthlyUnorderedScrollContainerRef,
    resetKey: `${monthlyReportMonth}|${monthlyUnorderedSearch}|${monthlyUnorderedDelegate}`,
  });

  const handleLoadNextArchivePage = useCallback(() => {
    fetchArchivePage(false);
  }, [fetchArchivePage]);

  const oldInvoicesScroll = useInfiniteScroll({
    totalItems: groupedOldInvoices.length,
    initialCount: 20,
    batchSize: 20,
    rootMargin: '450px 0px',
    resetKey: `${debouncedShopSearchTerm}|${selectedDelegate}|${selectedPriceMode}|${selectedMonth}|${selectedDate}|${selectedProduct}`,
    hasMoreExternal: hasMoreArchiveFromServer,
    isLoadingExternal: isFetchingMoreArchive,
    onReachEnd: handleLoadNextArchivePage,
  });

  const renderMonthlyCustomerReports = () => {
    if (!canViewMonthlyReports) return null;

    const delegateOptions: string[] = [
      'الكل',
      ...Array.from(new Set(delegateAccounts.map((a: any) => a.delegateName).filter(Boolean))) as string[]
    ];

    const currentFilteredWeight = filteredMonthlyOrdered.reduce((sum, c) => sum + c.totalWeight, 0);
    const currentFilteredAmount = filteredMonthlyOrdered.reduce((sum, c) => sum + c.totalAmount, 0);
    const currentFilteredInvoices = filteredMonthlyOrdered.reduce((sum, c) => sum + c.invoicesCount, 0);

    const displayedMonthlyOrdered = filteredMonthlyOrdered.slice(0, monthlyOrderedScroll.visibleCount);
    const displayedMonthlyUnordered = filteredMonthlyUnordered.slice(0, monthlyUnorderedScroll.visibleCount);

    return (
      <div className="space-y-4 mb-6">
        {/* Main Section Header Card */}
        <div className={`p-2.5 sm:p-3.5 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5">
                <div className="p-1.5 rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
                  <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                  تقارير فواتير وطلبات الزبائن الشهرية (تراكمي شهر {monthlyReportMonth})
                </h3>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                حسابات شهرية تراكمية بدون تكرار الزبون وبالمقارنة حسب كود الزبون (العدد + الوزن + المبلغ)
              </p>
            </div>

            {/* Month Picker Control */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">الشهر:</span>
              <input
                type="month"
                value={monthlyReportMonth}
                onChange={(e) => setMonthlyReportMonth(e.target.value)}
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded border focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer ${
                  isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                }`}
              />
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid gap-1.5 sm:gap-2 mt-2.5 grid-cols-2 sm:grid-cols-5">
            <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">الزبائن أصحاب الفواتير</span>
              <div className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                {monthlyOrderedData.list.length.toLocaleString()} زبون
              </div>
            </div>

            <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">عدد الفواتير الكلي للشهر</span>
              <div className="text-xs sm:text-sm font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
                {monthlyOrderedData.totalInvoices.toLocaleString()} فاتورة
              </div>
            </div>

            <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">الوزن الشهري التراكمي</span>
              <div className="text-xs sm:text-sm font-black text-slate-900 dark:text-white mt-0.5">
                {monthlyOrderedData.totalWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} كجم
              </div>
            </div>

            <div className={`p-1.5 sm:p-2 rounded-lg border text-center ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">المبلغ الشهري التراكمي</span>
              <div className="text-xs sm:text-sm font-black text-blue-600 dark:text-blue-400 mt-0.5">
                {Math.round(monthlyOrderedData.totalAmount).toLocaleString()} د.ع
              </div>
            </div>

            <div className={`p-1.5 sm:p-2 rounded-lg border text-center col-span-2 sm:col-span-1 ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">زبائن بدون فواتير بالشهر</span>
              <div className="text-xs sm:text-sm font-black text-amber-600 dark:text-amber-400 mt-0.5">
                {monthlyUnorderedCustomers.length.toLocaleString()} زبون
              </div>
            </div>
          </div>

          {/* Conditional Trigger Adoption Status Info */}
          <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-bold">
            <div className="flex items-center gap-1.5">
              {baghdadStatus.isPastClosing ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  تم بلوغ وقت الإغلاق الرسمي ({formattedTargetTime}) — تم اعتماد كافة الفواتير والطلبات المتبقية في النظام تلقائياً
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  شرط الاعتماد اليومي: تُعتمد فواتير اليوم فور ضغط المندوب على «لقد أكملت مبيعات اليوم» أو تلقائياً عند الإغلاق الرسمي ({formattedTargetTime})
                </span>
              )}
            </div>
            <div className="text-slate-500 dark:text-slate-400 text-[9px] font-mono">
              توقيت تكريت: {baghdadStatus.todayBaghdad}
            </div>
          </div>
        </div>

        {/* TABLE 1: Customers with Orders in Current Month */}
        <div className={`p-2.5 sm:p-3.5 rounded-xl border shadow-sm space-y-2.5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h4 className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <span>🛒</span>
                <span>جدول فواتير وطلبات الزبائن في الشهر الحالي ({monthlyReportMonth})</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                  {filteredMonthlyOrdered.length} زبون
                </span>
              </h4>
              <p className="text-[10px] text-slate-500 font-bold">
                حسابات تراكمية شهرية تجمع جميع الفواتير الصادرة لكل زبون بدون تكرار
              </p>
            </div>

            <button
              onClick={exportMonthlyOrderedExcel}
              disabled={filteredMonthlyOrdered.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold shadow-sm transition-all cursor-pointer"
              title="تصدير جدول طلبات الزبائن الشهرية كملف إكسل"
            >
              <Download className="w-3 h-3" />
              <span>تصدير التقرير (Excel)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div className="relative">
              <Search className="w-3 h-3 absolute right-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={monthlyOrderedSearch}
                onChange={(e) => setMonthlyOrderedSearch(e.target.value)}
                placeholder="بحث باسم الزبون، الكود، العنوان، أو المندوب..."
                className={`w-full pr-7 pl-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
              />
            </div>

            <select
              value={monthlyOrderedDelegate}
              onChange={(e) => setMonthlyOrderedDelegate(e.target.value)}
              className={`w-full py-1 px-2 rounded-lg border text-[11px] font-bold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              <option value="الكل">جميع المندوبين (الكل)</option>
              {delegateOptions.filter(d => d !== 'الكل').map((delName) => (
                <option key={`ordered-del-${delName}`} value={delName}>
                  {delName}
                </option>
              ))}
            </select>
          </div>

          <div
            ref={monthlyOrderedScrollContainerRef}
            className="overflow-x-auto overflow-y-auto max-h-[440px] rounded-xl border border-slate-300 dark:border-slate-800 shadow-xs"
          >
            <table className="w-full min-w-[650px] text-[10px] sm:text-[11px] text-right whitespace-nowrap">
              <thead className={`sticky top-0 z-10 font-black ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/95 text-slate-900 border-b border-slate-300'}`}>
                <tr>
                  <th className="px-2.5 py-2 text-center w-8">ت</th>
                  <th className="px-2.5 py-2">اسم الزبون</th>
                  <th className="px-2.5 py-2">كود الزبون</th>
                  <th className="px-2.5 py-2">عنوان الزبون</th>
                  <th className="px-2.5 py-2">اسم المندوب</th>
                  <th className="px-2.5 py-2 text-center">عدد الفواتير</th>
                  <th className="px-2.5 py-2 text-center">الوزن الكلي</th>
                  <th className="px-2.5 py-2 text-center">المبلغ الكلي</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-slate-200 bg-white text-slate-900'}`}>
                {filteredMonthlyOrdered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500 dark:text-slate-400 font-bold">
                      لا توجد فواتير أو طلبات مسجلة للزبائن في هذا الشهر حسب معايير البحث.
                    </td>
                  </tr>
                ) : (
                  displayedMonthlyOrdered.map((c, idx) => (
                    <tr key={`ordered-${c.customerCode}-${idx}`} className="hover:bg-emerald-50/50 dark:hover:bg-slate-800/60 transition-colors font-bold">
                      <td className="px-2.5 py-2 text-center font-bold text-slate-500 dark:text-slate-400">{idx + 1}</td>
                      <td className="px-2.5 py-2 font-black text-slate-900 dark:text-white text-xs">{c.customerName}</td>
                      <td className="px-2.5 py-2 font-mono text-[9px]">
                        <span className="px-1.5 py-0.5 rounded font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          {c.customerCode || '-'}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-slate-700 dark:text-slate-300 font-medium max-w-[170px] truncate" title={c.customerAddress}>{c.customerAddress}</td>
                      <td className="px-2.5 py-2 font-extrabold text-slate-800 dark:text-slate-200">{c.delegateName}</td>
                      <td className="px-2.5 py-2 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-md font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 shadow-2xs">
                          {c.invoicesCount}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-md font-black text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
                          {c.totalWeight.toFixed(0)} كجم
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-md font-black text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 shadow-2xs">
                          {Math.round(c.totalAmount).toLocaleString()} د.ع
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredMonthlyOrdered.length > 0 && (
                <tfoot className={`sticky bottom-0 z-10 font-black border-t-2 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-200/95 border-slate-300 text-slate-950'}`}>
                  <tr>
                    <td colSpan={5} className="px-2.5 py-2 font-black text-emerald-700 dark:text-emerald-300 text-xs">
                      المجموع ({filteredMonthlyOrdered.length} زبون)
                    </td>
                    <td className="px-2.5 py-2 text-center font-black text-indigo-700 dark:text-indigo-300 text-xs">
                      {currentFilteredInvoices.toLocaleString()}
                    </td>
                    <td className="px-2.5 py-2 text-center font-black text-emerald-700 dark:text-emerald-300 text-xs">
                      {currentFilteredWeight.toFixed(0)} كجم
                    </td>
                    <td className="px-2.5 py-2 text-center font-black text-blue-700 dark:text-blue-300 text-xs">
                      {Math.round(currentFilteredAmount).toLocaleString()} د.ع
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>

            {monthlyOrderedScroll.hasMore && (
              <div
                ref={monthlyOrderedScroll.sentinelRef}
                className="py-2.5 flex items-center justify-center gap-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50/40 dark:bg-slate-800/40"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>جاري تحميل المزيد تلقائياً...</span>
              </div>
            )}
          </div>

          {filteredMonthlyOrdered.length > 0 && (
            <div className="pt-1 flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
              <span>
                معروض <strong className="text-emerald-700 dark:text-emerald-300">{displayedMonthlyOrdered.length.toLocaleString()}</strong> من أصل <strong>{filteredMonthlyOrdered.length.toLocaleString()}</strong> زبون
                {monthlyOrderedScroll.hasMore ? ' (مرّر للأسفل داخل الجدول لتحميل المزيد)' : ' — تم عرض الكل'}
              </span>
              {monthlyOrderedScroll.hasMore && (
                <button
                  type="button"
                  onClick={monthlyOrderedScroll.loadMore}
                  className="text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer font-black"
                >
                  تحميل المزيد الآن
                </button>
              )}
            </div>
          )}
        </div>

        {/* Separating Line */}
        <div className="relative py-2 flex items-center justify-center">
          <div className="w-full border-t border-dashed border-slate-300 dark:border-slate-700"></div>
          <div className="absolute bg-slate-100 dark:bg-slate-950 px-3 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black text-amber-600 dark:text-amber-400 border border-amber-500/40 shadow-xs flex items-center gap-1">
            <span>⚠️</span>
            <span>فاصل: زبائن لحد الان لم يتم طلب فاتورة لهم ({monthlyReportMonth})</span>
          </div>
        </div>

        {/* TABLE 2: Customers with NO Orders this Month */}
        <div className={`p-2.5 sm:p-3.5 rounded-xl border shadow-sm space-y-2.5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h4 className="text-xs sm:text-sm font-black text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <span>⚠️</span>
                <span>زبائن لحد الان لم يتم طلب فاتورة لهم ({monthlyReportMonth})</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
                  {filteredMonthlyUnordered.length} زبون
                </span>
              </h4>
              <p className="text-[10px] text-slate-500 font-bold">
                الزبائن المسجلون الذين لم يتم طلب أي فاتورة لهم ولا يملكون وزن أو مبلغ في الشهر الحالي
              </p>
            </div>

            <button
              onClick={exportMonthlyUnorderedExcel}
              disabled={filteredMonthlyUnordered.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 active:scale-95 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold shadow-sm transition-all cursor-pointer"
              title="تصدير قائمة الزبائن الذين لم يطلبوا كملف إكسل"
            >
              <Download className="w-3 h-3" />
              <span>تصدير الزبائن غير الطالبين (Excel)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div className="relative">
              <Search className="w-3 h-3 absolute right-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={monthlyUnorderedSearch}
                onChange={(e) => setMonthlyUnorderedSearch(e.target.value)}
                placeholder="بحث باسم الزبون، الكود، العنوان، أو المندوب..."
                className={`w-full pr-7 pl-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
              />
            </div>

            <select
              value={monthlyUnorderedDelegate}
              onChange={(e) => setMonthlyUnorderedDelegate(e.target.value)}
              className={`w-full py-1 px-2 rounded-lg border text-[11px] font-bold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              <option value="الكل">جميع المندوبين (الكل)</option>
              {delegateOptions.filter(d => d !== 'الكل').map((delName) => (
                <option key={`unordered-del-${delName}`} value={delName}>
                  {delName}
                </option>
              ))}
            </select>
          </div>

          <div
            ref={monthlyUnorderedScrollContainerRef}
            className="overflow-x-auto overflow-y-auto max-h-[440px] rounded-xl border border-slate-300 dark:border-slate-800 shadow-xs"
          >
            <table className="w-full min-w-[650px] text-[10px] sm:text-[11px] text-right whitespace-nowrap">
              <thead className={`sticky top-0 z-10 font-black ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/95 text-slate-900 border-b border-slate-300'}`}>
                <tr>
                  <th className="px-2.5 py-2 text-center w-8">ت</th>
                  <th className="px-2.5 py-2">اسم الزبون</th>
                  <th className="px-2.5 py-2">كود الزبون</th>
                  <th className="px-2.5 py-2">عنوان الزبون</th>
                  <th className="px-2.5 py-2">اسم المندوب</th>
                  <th className="px-2.5 py-2 text-center">حالة الشهر</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-slate-200 bg-white text-slate-900'}`}>
                {filteredMonthlyUnordered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500 dark:text-slate-400 font-bold">
                      {monthlyUnorderedCustomers.length === 0
                        ? 'ممتاز! تم طلب فواتير لجميع الزبائن المسجلين في هذا الشهر 🎉'
                        : 'لا توجد نتائج تطابق معايير البحث الحالية.'}
                    </td>
                  </tr>
                ) : (
                  displayedMonthlyUnordered.map((r, idx) => (
                    <tr key={`unordered-${r.customerCode}-${idx}`} className="hover:bg-amber-50/40 dark:hover:bg-slate-800/60 transition-colors font-bold">
                      <td className="px-2.5 py-2 text-center font-bold text-slate-500 dark:text-slate-400">{idx + 1}</td>
                      <td className="px-2.5 py-2 font-black text-slate-900 dark:text-white text-xs">{r.customerName}</td>
                      <td className="px-2.5 py-2 font-mono text-[9px]">
                        <span className="px-1.5 py-0.5 rounded font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          {r.customerCode || '-'}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-slate-700 dark:text-slate-300 font-medium max-w-[170px] truncate" title={r.customerAddress}>{r.customerAddress || 'غير محدد'}</td>
                      <td className="px-2.5 py-2 font-extrabold text-slate-800 dark:text-slate-200">{r.delegateName || 'غير محدد'}</td>
                      <td className="px-2.5 py-2 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700 shadow-2xs">
                          <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                          لم يطلب
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredMonthlyUnordered.length > 0 && (
                <tfoot className={`sticky bottom-0 z-10 font-black border-t-2 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-200/95 border-slate-300 text-slate-950'}`}>
                  <tr>
                    <td colSpan={5} className="px-2.5 py-2 font-black text-amber-700 dark:text-amber-300 text-xs">
                      مجموع الزبائن غير الطالبين ({filteredMonthlyUnordered.length} زبون)
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>

            {monthlyUnorderedScroll.hasMore && (
              <div
                ref={monthlyUnorderedScroll.sentinelRef}
                className="py-2.5 flex items-center justify-center gap-2 text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50/40 dark:bg-slate-800/40"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>جاري تحميل المزيد تلقائياً...</span>
              </div>
            )}
          </div>

          {filteredMonthlyUnordered.length > 0 && (
            <div className="pt-1 flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
              <span>
                معروض <strong className="text-amber-700 dark:text-amber-300">{displayedMonthlyUnordered.length.toLocaleString()}</strong> من أصل <strong>{filteredMonthlyUnordered.length.toLocaleString()}</strong> زبون
                {monthlyUnorderedScroll.hasMore ? ' (مرّر للأسفل داخل الجدول لتحميل المزيد)' : ' — تم عرض الكل'}
              </span>
              {monthlyUnorderedScroll.hasMore && (
                <button
                  type="button"
                  onClick={monthlyUnorderedScroll.loadMore}
                  className="text-amber-700 dark:text-amber-300 hover:underline cursor-pointer font-black"
                >
                  تحميل المزيد الآن
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const displayedInvoices = useMemo(
    () => groupedOldInvoices.slice(0, oldInvoicesScroll.visibleCount),
    [groupedOldInvoices, oldInvoicesScroll.visibleCount]
  );

  const displayedFilteredEntries = useMemo(() => {
    return groupedOldInvoices.flatMap((inv) => inv.entries);
  }, [groupedOldInvoices]);

  const displayedProductWeight = useMemo(() => {
    return displayedFilteredEntries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
  }, [displayedFilteredEntries]);

  const { oldTotalPieces, oldTotalCartons, oldRemainderPieces } = useMemo(() => {
    let pieces = 0;
    let cartons = 0;

    if (selectedProduct !== 'الكل') {
      const normalizedFilter = (selectedProduct || '').trim().toLowerCase();
      const matchedProd = productsList.find(
        (p) => (p.productName || '').trim().toLowerCase() === normalizedFilter
      );
      const cartonQty = Number(matchedProd?.cartonQuantity) || 1;

      pieces = displayedFilteredEntries.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);

      if (cartonQty > 1) {
        cartons = Math.floor(pieces / cartonQty);
        const remainder = pieces % cartonQty;
        return {
          oldTotalPieces: pieces,
          oldTotalCartons: cartons,
          oldRemainderPieces: remainder,
        };
      } else {
        return {
          oldTotalPieces: pieces,
          oldTotalCartons: pieces,
          oldRemainderPieces: 0,
        };
      }
    } else {
      displayedFilteredEntries.forEach((e) => {
        const q = Number(e.quantity) || 0;
        pieces += q;
        const normalizedName = (e.productName || '').trim().toLowerCase();
        const prod = productsList.find(
          (p) => (p.productName || '').trim().toLowerCase() === normalizedName
        );
        const cq = Number(prod?.cartonQuantity) || 1;
        if (e.entryUnit === 'carton') {
          cartons += Number(e.enteredQuantity) || (cq > 1 ? Math.floor(q / cq) : q);
        } else if (cq > 1 && q >= cq) {
          cartons += Math.floor(q / cq);
        }
      });

      return {
        oldTotalPieces: pieces,
        oldTotalCartons: cartons,
        oldRemainderPieces: 0,
      };
    }
  }, [displayedFilteredEntries, selectedProduct, productsList]);

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
      {renderMonthlyCustomerReports()}

      {/* Header Banner */}
      <div
        ref={archiveSectionTopRef}
        className={`p-4 rounded-2xl border-2 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
          isDarkMode 
            ? 'bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-emerald-500/40 text-white' 
            : 'bg-gradient-to-r from-emerald-50/80 via-white to-emerald-50/80 border-emerald-200 text-slate-900'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-600 text-white shadow-sm">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black flex items-center gap-2">
                <span>سجل الفواتير القديمة والتاريخية</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-extrabold border border-emerald-500/30">
                  لوحة المدير (Admin)
                </span>
              </h2>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                أرشيف فواتير المندوبين المنظمة والقابلة للبحث الفوري حسب اسم المحل / الزبون
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={exportToExcel}
            disabled={allEntriesCombined.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-md transition-all cursor-pointer"
            title="تصدير كافة الفواتير القديمة والتاريخية لجميع المندوبين عبر كامل النظام في ملف إكسل واحد"
          >
            <Download className="w-4 h-4" />
            <span>تصدير Excel الشامل</span>
          </button>
        </div>
      </div>

      {/* Conditional Saving & Calculation Rule Status Indicator */}
      <div
        className={`p-3 rounded-2xl border text-xs font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 shadow-sm transition-all ${
          baghdadStatus.isPastClosing
            ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
            : 'bg-sky-50/90 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800 text-sky-800 dark:text-sky-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
              baghdadStatus.isPastClosing
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                : 'bg-sky-500/20 border-sky-500/40 text-sky-600 dark:text-sky-400'
            }`}
          >
            {baghdadStatus.isPastClosing ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Clock className="w-4 h-4 animate-pulse" />
            )}
          </div>
          <div>
            <div className="font-black text-xs sm:text-sm flex items-center gap-2">
              <span>
                {baghdadStatus.isPastClosing
                  ? `تم انتهاء وقت الإغلاق الرسمي (${formattedTargetTime}) — اعتماد كافة الفواتير:`
                  : `قاعدة الحفظ والاحتساب المشروط (موعد الإغلاق: ${formattedTargetTime}):`}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                baghdadStatus.isPastClosing
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
              }`}>
                {baghdadStatus.isPastClosing ? 'معتمد بالكامل' : 'قيد التدقيق اليومي'}
              </span>
            </div>
            <p className="text-[11px] font-medium opacity-90 mt-0.5">
              {baghdadStatus.isPastClosing
                ? 'انتهى توقيت المبيعات اليومي المعتمد، فتمت أرشفة وإدراج كافة فواتير اليوم تلقائياً واحتسابها بالسجل التاريخي.'
                : 'فواتير اليوم لا تُحفظ ولا تُعرض أو تُحتسب في الفواتير القديمة فور إنشائها، وإنما تُدرج فقط فور ضغط المندوب على «أكملت مبيعات اليوم» أو عند انتهاء وقت الإغلاق الرسمي.'}
            </p>
          </div>
        </div>

        {!baghdadStatus.isPastClosing && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-sky-200 dark:border-sky-800/60 shadow-xs text-[11px]">
            <span className="text-slate-600 dark:text-slate-400 font-bold">المندوبين المعتمدين اليوم:</span>
            <span className="px-1.5 py-0.5 rounded-md bg-sky-600 text-white font-black">
              {completedDelegatesCount} من {delegatesList.length}
            </span>
          </div>
        )}
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <div className={`p-3 rounded-xl border shadow-xs text-center ${isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'}`}>
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">عدد الفواتير</div>
          <div className="text-base sm:text-lg font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
            {summaryMetrics.totalInvoices.toLocaleString()}
          </div>
        </div>

        <div className={`p-3 rounded-xl border shadow-xs text-center ${isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'}`}>
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">المحلات / الزبائن</div>
          <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-0.5">
            {summaryMetrics.uniqueShops.toLocaleString()} محل
          </div>
        </div>

        <div className={`p-3 rounded-xl border shadow-xs text-center ${isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'}`}>
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">إجمالي الوزن</div>
          <div className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
            {formatWithCommas(parseFloat(summaryMetrics.totalWeight.toFixed(0)), true)} كجم
          </div>
        </div>

        <div className={`p-3 rounded-xl border shadow-xs text-center ${isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'}`}>
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">إجمالي المبالغ</div>
          <div className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 mt-0.5 truncate">
            {formatWithCommas(Math.round(summaryMetrics.totalAmount), true)} <span className="text-[9px]">د.ع</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className={`p-3 sm:p-4 rounded-xl border shadow-xs space-y-3 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
        {/* Primary Search by Store / Shop Name & Product Filter Dropdown */}
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="relative flex-1 w-full">
            <div className="absolute right-3 top-2.5 text-emerald-600 dark:text-emerald-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={shopSearchTerm}
              onChange={(e) => setShopSearchTerm(e.target.value)}
              placeholder="🔍 بحث باسم المحل / الزبون، كود الزبون..."
              className={`w-full pr-9 pl-7 py-2 rounded-xl border text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                isDarkMode 
                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-400' 
                  : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
              }`}
            />
            {shopSearchTerm && (
              <button
                onClick={() => setShopSearchTerm('')}
                className="absolute left-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 cursor-pointer font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Product Filter Dropdown */}
          <div className="relative w-full sm:w-64">
            <div className="relative flex items-center">
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className={`w-full py-2 pr-8 pl-7 rounded-xl border text-xs font-black transition-all appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs ${
                  selectedProduct !== 'الكل'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-500 ring-2 ring-emerald-500/20'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
                title="تصفية الفواتير القديمة حسب منتج محدد"
              >
                <option value="الكل">📦 جميع المنتجات (عرض كامل)</option>
                {availableProductsList.map((pName) => (
                  <option key={`old_prod_${pName}`} value={pName}>
                    {pName}
                  </option>
                ))}
              </select>

              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-600 dark:text-emerald-400">
                <Package className="w-3.5 h-3.5" />
              </div>

              {selectedProduct !== 'الكل' ? (
                <button
                  type="button"
                  onClick={() => setSelectedProduct('الكل')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:text-red-500 cursor-pointer p-0.5 rounded-full"
                  title="إلغاء فلترة المنتج وعرض الكل"
                >
                  ✕
                </button>
              ) : (
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <ChevronDown className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          </div>

          {/* Weight Badge */}
          {displayedInvoices.length > 0 && (
            <span className={`text-xs font-black shrink-0 px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
              selectedProduct !== 'الكل'
                ? 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-200 dark:border-emerald-700 shadow-xs'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-slate-800 dark:text-emerald-400 dark:border-slate-700'
            }`}>
              <Scale className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {selectedProduct !== 'الكل' ? `وزن (${selectedProduct}): ` : 'الوزن الكلي: '}
                <strong className="font-mono">{formatWithCommas(parseFloat(displayedProductWeight.toFixed(0)), true)}</strong> كجم
              </span>
            </span>
          )}

          {/* فقرة: عدد الكارتون وعدد القطع المطلوبة */}
          {displayedInvoices.length > 0 && (
            <span className={`text-[11px] sm:text-xs font-black max-w-full px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 flex-wrap sm:flex-nowrap ${
              selectedProduct !== 'الكل'
                ? 'bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950/70 dark:text-indigo-200 dark:border-indigo-700 shadow-xs'
                : 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-slate-800 dark:text-indigo-300 dark:border-slate-700'
            }`}>
              <Package className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="flex items-center gap-1 flex-wrap">
                <span className="whitespace-nowrap">المطلوب:</span>
                <strong className="text-indigo-700 dark:text-indigo-300 font-mono text-xs sm:text-sm whitespace-nowrap">
                  {formatWithCommas(oldTotalCartons)}
                </strong>
                <span className="whitespace-nowrap">كارتون</span>
                {oldRemainderPieces > 0 ? (
                  <>
                    <span>و</span>
                    <strong className="text-indigo-700 dark:text-indigo-300 font-mono text-xs sm:text-sm whitespace-nowrap">
                      {formatWithCommas(oldRemainderPieces)}
                    </strong>
                    <span className="whitespace-nowrap">قطعة</span>
                  </>
                ) : null}
                <span className="text-[10px] sm:text-[11px] opacity-80 font-bold font-mono whitespace-nowrap mr-0.5">
                  ({formatWithCommas(oldTotalPieces)} قطعة)
                </span>
              </span>
            </span>
          )}
        </div>

        {/* Secondary Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          {/* Representative Filter */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-600 dark:text-slate-300 mb-1">
              المندوب:
            </label>
            <select
              value={selectedDelegate}
              onChange={(e) => setSelectedDelegate(e.target.value)}
              className={`w-full py-1.5 px-2 rounded-lg border text-xs font-bold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              <option value="الكل">جميع المندوبين (الكل)</option>
              {delegatesList.map((del) => (
                <option key={`old-del-${del}`} value={del}>
                  {del}
                </option>
              ))}
            </select>
          </div>

          {/* Month Filter */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-600 dark:text-slate-300 mb-1">
              الشهر:
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setSelectedDate('');
              }}
              className={`w-full py-1.5 px-2 rounded-lg border text-xs font-bold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              <option value="الكل">كافة الأشهر المسجلة</option>
              {availableMonths.map((m) => (
                <option key={`old-m-${m}`} value={m}>
                  شهر {m}
                </option>
              ))}
            </select>
          </div>

          {/* Specific Date Filter */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-600 dark:text-slate-300 mb-1">
              تاريخ محدد (اختياري):
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className={`w-full py-1 px-2 rounded-lg border text-xs font-bold ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            />
          </div>

          {/* Price Mode Filter */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-600 dark:text-slate-300 mb-1">
              نوع الفاتورة:
            </label>
            <div className="flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden p-0.5 bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setSelectedPriceMode('الكل')}
                className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${
                  selectedPriceMode === 'الكل'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => setSelectedPriceMode('retail')}
                className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${
                  selectedPriceMode === 'retail'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                مفرد
              </button>
              <button
                type="button"
                onClick={() => setSelectedPriceMode('wholesale')}
                className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${
                  selectedPriceMode === 'wholesale'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                جملة
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Invoices List matching EntryScreen Design exactly */}
      <div className="space-y-4">
        {isLoadingArchive && groupedOldInvoices.length === 0 ? (
          <div className={`p-8 rounded-2xl border text-center space-y-3 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <Loader2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin mx-auto" />
            <h3 className="text-sm font-black text-slate-700 dark:text-slate-200">
              جاري تحميل أحدث دفعة من المبيعات القديمة...
            </h3>
            <p className="text-xs text-slate-500 font-bold">
              يتم جلب البيانات تدريجياً من الأرشيف (200 سجل في كل دفعة) لسرعة فائقة أثناء التصفح.
            </p>
          </div>
        ) : archiveFetchError && groupedOldInvoices.length === 0 ? (
          <div className={`p-8 rounded-2xl border text-center space-y-3 ${isDarkMode ? 'bg-slate-900 border-rose-800/60' : 'bg-white border-rose-200'}`}>
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
            <h3 className="text-sm font-black text-rose-600 dark:text-rose-400">
              {archiveFetchError}
            </h3>
            <button
              type="button"
              onClick={() => {
                clearGlobalQuotaExceeded();
                fetchArchivePage(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-sm transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>إعادة تحميل الأرشيف</span>
            </button>
          </div>
        ) : groupedOldInvoices.length === 0 ? (
          <div className={`p-8 rounded-2xl border text-center space-y-3 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="text-3xl">📭</div>
            <h3 className="text-sm font-black text-slate-700 dark:text-slate-300">
              لا توجد فواتير قديمة تطابق معايير البحث في الدفعة الحالية
            </h3>
            <p className="text-xs text-slate-500 font-bold">
              {hasMoreArchiveFromServer
                ? `تم فحص ${archivedEntries.length.toLocaleString()} سجل حديث حتى الآن. يمكنك البحث في دفعة أقدم من الأرشيف.`
                : 'تأكد من كتابة اسم المحل بشكل صحيح أو اختر "جميع المندوبين" لعرض كامل الأرشيف.'}
            </p>
            {hasMoreArchiveFromServer && (
              <button
                type="button"
                disabled={isFetchingMoreArchive}
                onClick={() => fetchArchivePage(false, 500)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black shadow-sm transition-all cursor-pointer"
              >
                {isFetchingMoreArchive ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>البحث في دفعة أقدم من الأرشيف (+500 سجل)</span>
              </button>
            )}
          </div>
        ) : (
          displayedInvoices.map((inv) => {
            const customerName = inv.customerName;
            const entries = inv.entries;

            const phoneRegex = /(?:\+964|0)?7[3-9]\d[\s-]?\d{3}[\s-]?\d{4}/;
            const customerDisplayName = String(customerName || 'بدون اسم محل')
              .replace(/__(wholesale|retail)/g, '')
              .replace(phoneRegex, '')
              .replace(/^[\s-–—:]+|[\s-–—:]+$/g, '')
              .trim() || 'بدون اسم محل';

            const phone = getCustomerPhoneForOldInvoice(inv);
            const isProcessing = isSharingWhatsApp === inv.invoiceKey;
            const isProductFilterActive = selectedProduct !== 'الكل';

            const formatPriceValue = (val: number): string => {
              if (val === null || val === undefined || isNaN(val)) return '0';
              const num = Number(val);
              if (num === 0) return '0';
              if (Number.isInteger(num)) {
                return num.toLocaleString('en-US');
              }
              return num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
            };

            const findProduct = (entry: SalesEntry) => {
              const normalizedName = (entry.productName || '').trim();
              return (
                productsByNameMap.get(entry.productName) ||
                productsByNameMap.get(normalizedName) ||
                productsList.find((p) => (p.productName || '').trim().toLowerCase() === normalizedName.toLowerCase())
              );
            };

            const getEntryCartons = (entry: SalesEntry) => {
              if (entry.isGift) return 0;
              const prod = findProduct(entry);
              const cq = Number(prod?.cartonQuantity) || 1;
              if (entry.entryUnit === 'carton') {
                return Number(entry.enteredQuantity) || 0;
              }
              if (cq > 1 && entry.quantity >= cq) {
                return Math.floor(entry.quantity / cq);
              }
              return 0;
            };

            const getEntryUnitPrice = (entry: SalesEntry) => {
              if (entry.isGift) return 0;
              const prod = findProduct(entry);
              if (!prod) return 0;
              const isWholesale = Boolean(
                entry.priceMode === 'wholesale' ||
                (entry.priceMode as unknown as string) === 'جملة' ||
                inv.priceMode === 'wholesale' ||
                entry.customerType === 'جملة' ||
                entries[0]?.customerType === 'جملة'
              );
              const ws = typeof prod.wholesalePrice === 'string' ? parseArabicNumber(prod.wholesalePrice) : Number(prod.wholesalePrice) || 0;
              const rt = typeof prod.retailPrice === 'string' ? parseArabicNumber(prod.retailPrice) : Number(prod.retailPrice) || 0;
              return isWholesale ? (ws > 0 ? ws : rt) : (rt > 0 ? rt : ws);
            };

            const totalInvoiceCartons = entries.reduce((sum, e) => sum + getEntryCartons(e), 0);
            const totalInvoicePieces = entries.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
            const totalInvoiceWeight = entries.reduce((sum, e) => sum + (Number(e.totalWeightKg) || 0), 0);
            const totalInvoiceAmount = entries.reduce((sum, e) => {
              if (e.isGift) return sum;
              return sum + getEntryUnitPrice(e) * (Number(e.quantity) || 0);
            }, 0);

            const invoiceDateTimeStr = entries[0]?.timestamp
              ? `${new Date(entries[0].timestamp).toISOString().split('T')[0]} ${new Date(entries[0].timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
              : inv.dateString
              ? `${inv.dateString} 0:00`
              : '1900-01-00 0:00';

            return (
              <div
                key={inv.invoiceKey}
                className={`invoice-card border-2 rounded-2xl shadow-md overflow-hidden transition-all mb-5 ${
                  isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                }`}
              >
                {/* Header Bar: Matching EntryScreen exactly */}
                <div className={`p-2.5 sm:p-3.5 border-b flex items-center justify-between gap-2 relative ${
                  isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'
                }`}>
                  {/* Customer Name Header with Phone Button */}
                  <div className="flex-1 flex items-center justify-start gap-2 flex-wrap min-w-0 px-1">
                    <h3 className="font-black text-xs sm:text-base md:text-lg text-[#1f4e78] dark:text-blue-300 tracking-wide">
                      {customerDisplayName}
                    </h3>
                    {phone && (
                      <div className="inline-flex items-center gap-1.5 flex-wrap">
                        <a
                          href={`tel:${phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-emerald-500 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 shadow-xs transition-all cursor-pointer shrink-0"
                          title={`اتصال بالزبون: ${phone}`}
                          dir="ltr"
                        >
                          <Phone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons (Print, WhatsApp, Delete) */}
                  <div className="flex items-center gap-1.5 shrink-0 z-10">
                    <button
                      type="button"
                      onClick={() => handlePrintInvoice(inv)}
                      className={`p-1 sm:p-1.5 rounded-lg border transition-all cursor-pointer shadow-xs flex items-center justify-center active:scale-95 ${
                        isDarkMode
                          ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-800/60 border-blue-700'
                          : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-300'
                      }`}
                      title="طباعة الفاتورة"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleWhatsAppInvoice(inv, phone);
                      }}
                      className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg border text-[11px] sm:text-xs font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1 active:scale-95 ${
                        isProcessing
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : isDarkMode
                            ? 'bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/60 border-emerald-700'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-300'
                      }`}
                      title={isProcessing ? 'جاري تجهيز الفاتورة...' : phone ? `مشاركة صورة الفاتورة إلى واتساب الزبون (${phone})` : 'مشاركة صورة الفاتورة عبر واتساب'}
                    >
                      {isProcessing ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      <span className="hidden sm:inline">
                        {isProcessing ? 'جاري التجهيز...' : 'مشاركة الى واتساب'}
                      </span>
                    </button>

                    {currentUser?.isAdmin && (
                      <button
                        type="button"
                        disabled={deletingInvoiceKey === inv.invoiceKey}
                        onClick={() => handleDeleteOldInvoice(inv)}
                        className={`p-1 sm:p-1.5 rounded-lg border transition-all cursor-pointer shadow-xs flex items-center justify-center active:scale-95 ${
                          isDarkMode
                            ? 'bg-red-900/40 text-red-300 hover:bg-red-800/60 border-red-700'
                            : 'bg-red-50 text-red-700 hover:bg-red-100 border-red-300'
                        }`}
                        title="مسح / حذف الفاتورة بالكامل"
                      >
                        {deletingInvoiceKey === inv.invoiceKey ? (
                          <span className="w-3.5 h-3.5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {isProductFilterActive ? (
                      <span className="text-[11px] font-black text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950/70 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-700">
                        مفلتر: {selectedProduct}
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-400">#{entries.length} مواد</span>
                    )}
                  </div>
                </div>

                {/* Metadata Sub-Header Bar (Mobile: Compact 2x2 grid) */}
                <div className="sm:hidden border-b border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-1.5 text-[10px]">
                  <div className="grid grid-cols-2 gap-1 text-right">
                    <div className="flex items-center justify-between bg-white dark:bg-slate-800 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700">
                      <span className="font-black text-[#1f4e78] dark:text-blue-300">كود الزبون:</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{inv.customerCode || '---'}</span>
                    </div>
                    <div className="flex items-center justify-between bg-white dark:bg-slate-800 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700">
                      <span className="font-black text-[#1f4e78] dark:text-blue-300">نوع الزبون:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100">{inv.priceMode === 'wholesale' ? 'جملة' : 'مفرد'}</span>
                    </div>
                    <div className="flex items-center justify-between bg-white dark:bg-slate-800 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700">
                      <span className="font-black text-[#1f4e78] dark:text-blue-300">وقت وتاريخ:</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-[9px]" dir="ltr">{invoiceDateTimeStr}</span>
                    </div>
                    <div className="flex items-center justify-between bg-white dark:bg-slate-800 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700">
                      <span className="font-black text-[#1f4e78] dark:text-blue-300">اسم المندوب:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100 truncate max-w-[85px]">{inv.delegateName || 'غير محدد'}</span>
                    </div>
                  </div>
                </div>

                {/* Desktop Sub-Header Bar (sm and up) - Excel-style 8 columns matching EntryScreen */}
                <div className="hidden sm:block overflow-x-auto border-b border-slate-300 dark:border-slate-700">
                  <table className="w-full text-center border-collapse text-xs">
                    <tbody>
                      <tr className="divide-x divide-x-reverse divide-slate-300 dark:divide-slate-700">
                        <th className="py-1.5 px-2 bg-[#d9e1f2] dark:bg-slate-800 text-[#1f4e78] dark:text-blue-300 font-black whitespace-nowrap">
                          كود الزبون:
                        </th>
                        <td className="py-1.5 px-2 font-mono font-bold bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 whitespace-nowrap">
                          {inv.customerCode || '---'}
                        </td>

                        <th className="py-1.5 px-2 bg-[#d9e1f2] dark:bg-slate-800 text-[#1f4e78] dark:text-blue-300 font-black whitespace-nowrap">
                          نوع الزبون:
                        </th>
                        <td className="py-1.5 px-2 font-bold bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 whitespace-nowrap">
                          {inv.priceMode === 'wholesale' ? 'جملة' : 'مفرد'}
                        </td>

                        <th className="py-1.5 px-2 bg-[#d9e1f2] dark:bg-slate-800 text-[#1f4e78] dark:text-blue-300 font-black whitespace-nowrap">
                          وقت وتاريخ:
                        </th>
                        <td className="py-1.5 px-2 font-mono font-bold bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 whitespace-nowrap" dir="ltr">
                          {invoiceDateTimeStr}
                        </td>

                        <th className="py-1.5 px-2 bg-[#d9e1f2] dark:bg-slate-800 text-[#1f4e78] dark:text-blue-300 font-black whitespace-nowrap">
                          اسم المندوب:
                        </th>
                        <td className="py-1.5 px-2 font-bold bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 whitespace-nowrap">
                          {inv.delegateName || 'غير محدد'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Active Product Filter Info Banner */}
                {isProductFilterActive && (
                  <div className="px-3 py-1.5 bg-emerald-50/90 dark:bg-emerald-950/50 border-b border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                    <div className="flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        يتم عرض مادة: <strong className="font-black underline">{selectedProduct}</strong> فقط في هذه الفاتورة (تم إخفاء باقي المواد مؤقتاً)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedProduct('الكل')}
                      className="text-[10px] text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white underline cursor-pointer font-bold shrink-0 mr-2"
                    >
                      إلغاء التصفية وعرض جميع المواد
                    </button>
                  </div>
                )}

                {/* Main Invoice Table matching EntryScreen design */}
                <div className="overflow-x-auto">
                  <table className="w-full text-center border-collapse text-[9.5px] sm:text-xs">
                    <thead>
                      <tr className="bg-[#1f4e78] text-white font-black">
                        <th className="py-1 sm:py-2 px-0.5 sm:px-1 text-center border border-slate-400/30 w-7 sm:w-9">
                          ت
                        </th>
                        <th className="py-1 sm:py-2 px-1 sm:px-2.5 text-right border border-slate-400/30">اسم المنتج</th>
                        <th className="hidden sm:table-cell py-1.5 sm:py-2 px-1 sm:px-1.5 text-center border border-slate-400/30">الصنف</th>
                        <th className="sm:hidden py-1 px-1 text-center border border-slate-400/30">
                          <div className="flex flex-col items-center leading-tight">
                            <span>الكمية</span>
                            <span className="text-[8px] font-normal opacity-90">كارتون (قطع)</span>
                          </div>
                        </th>
                        <th className="hidden sm:table-cell py-1.5 sm:py-2 px-1 text-center border border-slate-400/30">
                          <div className="flex flex-col items-center leading-tight">
                            <span>الكمية</span>
                            <span className="text-[9px] font-normal opacity-90">(كارتون)</span>
                          </div>
                        </th>
                        <th className="hidden sm:table-cell py-1.5 sm:py-2 px-1 text-center border border-slate-400/30">
                          <div className="flex flex-col items-center leading-tight">
                            <span>الكمية</span>
                            <span className="text-[9px] font-normal opacity-90">(قطعة)</span>
                          </div>
                        </th>
                        <th className="py-1 sm:py-2 px-0.5 sm:px-1 text-center border border-slate-400/30">
                          <div className="flex flex-col items-center leading-tight">
                            <span>الوزن</span>
                            <span className="text-[8px] sm:text-[9px] font-normal opacity-90">(كجم)</span>
                          </div>
                        </th>
                        <th className="py-1 sm:py-2 px-0.5 sm:px-1 text-center border border-slate-400/30">
                          <div className="flex flex-col items-center leading-tight">
                            <span className="sm:hidden">السعر</span>
                            <span className="hidden sm:inline">سعر القطعة</span>
                            <span className="text-[8px] sm:text-[9px] font-normal opacity-90">(د.ع)</span>
                          </div>
                        </th>
                        <th className="py-1 sm:py-2 px-0.5 sm:px-1.5 text-center border border-slate-400/30">
                          <div className="flex flex-col items-center leading-tight">
                            <span>المبلغ</span>
                            <span className="text-[8px] sm:text-[9px] font-normal opacity-90">(د.ع)</span>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800' : 'divide-slate-200'}`}>
                      {entries.map((entry, index) => {
                        const isGift = Boolean(entry.isGift);
                        const unitPrice = getEntryUnitPrice(entry);
                        const itemAmount = isGift ? 0 : unitPrice * (Number(entry.quantity) || 0);
                        const itemCartons = getEntryCartons(entry);

                        return (
                          <tr
                            key={`old_item_${entry.id || index}`}
                            className={`transition-colors border-b ${
                              isDarkMode ? 'border-slate-800' : 'border-slate-200'
                            } ${
                              isGift
                                ? isDarkMode
                                  ? 'bg-amber-950/20 hover:bg-amber-950/30'
                                  : 'bg-amber-50/60 hover:bg-amber-100/60'
                                : index % 2 === 0
                                ? isDarkMode
                                  ? 'bg-slate-900 hover:bg-slate-800/60'
                                  : 'bg-white hover:bg-blue-50/40'
                                : isDarkMode
                                ? 'bg-slate-800/40 hover:bg-slate-800/70'
                                : 'bg-slate-50/70 hover:bg-blue-50/40'
                            }`}
                          >
                            {/* ت */}
                            <td className="py-1 sm:py-1.5 px-0.5 sm:px-1 text-center border-l border-slate-200 dark:border-slate-800">
                              <span className="font-mono text-slate-400 text-[10px] sm:text-xs">{index + 1}</span>
                            </td>

                            {/* اسم المنتج */}
                            <td className="py-1 sm:py-2 px-1 sm:px-2.5 text-right font-black text-slate-900 dark:text-white border-l border-slate-200 dark:border-slate-800">
                              <div className="flex flex-col text-right">
                                <div className="flex items-center gap-1 justify-start">
                                  {isGift ? (
                                    <span className="text-[8px] sm:text-[9px] font-black px-1 py-0.2 rounded bg-amber-500 text-white shadow-xs shrink-0">
                                      هدية 🎁
                                    </span>
                                  ) : null}
                                  <span className="font-bold sm:font-black text-slate-900 dark:text-white text-[10px] sm:text-xs leading-tight line-clamp-2">
                                    {entry.productName}
                                  </span>
                                </div>

                                {/* موبايل: كود المنتج (الصنف) */}
                                <div className="text-[9px] text-slate-500 dark:text-slate-400 font-mono sm:hidden flex items-center gap-1 mt-0.5 leading-none">
                                  <span className="font-bold text-slate-700 dark:text-slate-300">
                                    {getProductCode(entry.productName)}
                                  </span>
                                  {entry.categoryName ? (
                                    <span className="text-slate-500 dark:text-slate-400">
                                      ({entry.categoryName})
                                    </span>
                                  ) : null}
                                </div>

                                {/* الشاشات الأكبر: كود المنتج */}
                                <span className="text-[9px] text-slate-400 font-mono hidden md:inline">
                                  ({getProductCode(entry.productName)})
                                </span>
                              </div>
                            </td>

                            {/* الصنف (سطح المكتب) */}
                            <td className="hidden sm:table-cell py-1.5 sm:py-2 px-1 sm:px-1.5 text-center text-slate-600 dark:text-slate-300 font-bold border-l border-slate-200 dark:border-slate-800 text-[10px] sm:text-xs">
                              {entry.categoryName || '—'}
                            </td>

                            {/* الكمية (موبايل) */}
                            <td className="sm:hidden py-1 px-1 text-center font-mono border-l border-slate-200 dark:border-slate-800 text-[9px] whitespace-nowrap leading-tight">
                              <div className="font-bold text-slate-900 dark:text-white">
                                {itemCartons} كارتون
                              </div>
                              <div className="text-[8.5px] text-slate-500 dark:text-slate-400 font-semibold">
                                ({formatWithCommas(entry.quantity)})
                              </div>
                            </td>

                            {/* الكمية (كارتون) سطح المكتب */}
                            <td className="hidden sm:table-cell py-1.5 sm:py-2 px-1 text-center font-mono font-bold text-slate-800 dark:text-slate-200 border-l border-slate-200 dark:border-slate-800">
                              {itemCartons > 0 ? formatWithCommas(itemCartons) : 0}
                            </td>

                            {/* الكمية (قطعة) سطح المكتب */}
                            <td className="hidden sm:table-cell py-1.5 sm:py-2 px-1 text-center font-mono font-black text-slate-900 dark:text-white border-l border-slate-200 dark:border-slate-800">
                              {formatWithCommas(entry.quantity)}
                            </td>

                            {/* الوزن (كجم) */}
                            <td className="py-1 sm:py-2 px-0.5 sm:px-1 text-center font-mono font-bold sm:font-black text-emerald-700 dark:text-emerald-400 border-l border-slate-200 dark:border-slate-800 whitespace-nowrap text-[9px] sm:text-xs">
                              {formatWithCommas(parseFloat((entry.totalWeightKg || 0).toFixed(0)), true)}
                            </td>

                            {/* سعر القطعة (د.ع) */}
                            <td className="py-1 sm:py-2 px-0.5 sm:px-1 text-center font-mono font-bold text-slate-700 dark:text-slate-300 border-l border-slate-200 dark:border-slate-800 whitespace-nowrap text-[9px] sm:text-xs">
                              {isGift ? '0' : formatPriceValue(unitPrice)}
                            </td>

                            {/* المبلغ (د.ع) */}
                            <td className="py-1 sm:py-2 px-0.5 sm:px-1.5 text-center font-mono font-bold sm:font-black text-indigo-700 dark:text-indigo-400 border-l border-slate-200 dark:border-slate-800 whitespace-nowrap text-[9px] sm:text-xs">
                              {isGift ? '0' : formatPriceValue(itemAmount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>

                    {/* Footer Row matching EntryScreen */}
                    <tfoot>
                      <tr className="bg-[#d9e1f2] dark:bg-slate-800 text-[#1f4e78] dark:text-blue-200 font-black border-t-2 border-slate-400 text-[9.5px] sm:text-xs">
                        <td colSpan={2} className="sm:hidden py-1.5 px-1 text-right font-black border-l border-slate-300 dark:border-slate-700">
                          الإجمالي
                        </td>
                        <td colSpan={3} className="hidden sm:table-cell py-2 px-1.5 text-right font-black border-l border-slate-300 dark:border-slate-700">
                          الإجمالي
                        </td>

                        <td className="sm:hidden py-1.5 px-0.5 text-center font-mono font-black border-l border-slate-300 dark:border-slate-700 text-[8.5px] whitespace-nowrap leading-tight">
                          <div>{formatWithCommas(totalInvoiceCartons)} كارتون</div>
                          <div className="text-[8px] opacity-80">({formatWithCommas(totalInvoicePieces)})</div>
                        </td>

                        <td className="hidden sm:table-cell py-2 px-1 text-center font-mono font-black border-l border-slate-300 dark:border-slate-700">
                          {formatWithCommas(totalInvoiceCartons)}
                        </td>

                        <td className="hidden sm:table-cell py-2 px-1 text-center font-mono font-black border-l border-slate-300 dark:border-slate-700">
                          {formatWithCommas(totalInvoicePieces)}
                        </td>

                        <td className="py-1 sm:py-2 px-0.5 sm:px-1 text-center font-mono font-black border-l border-slate-300 dark:border-slate-700 whitespace-nowrap text-[9px] sm:text-xs">
                          {formatWithCommas(parseFloat(totalInvoiceWeight.toFixed(0)), true)} كجم
                        </td>

                        <td className="py-1 sm:py-2 px-0.5 sm:px-1 text-center font-mono font-black border-l border-slate-300 dark:border-slate-700 whitespace-nowrap text-[9px] sm:text-xs">
                          —
                        </td>

                        <td className="py-1 sm:py-2 px-0.5 sm:px-1.5 text-center font-mono font-black text-rose-700 dark:text-rose-300 border-l border-slate-300 dark:border-slate-700 whitespace-nowrap text-[9px] sm:text-xs">
                          {formatPriceValue(totalInvoiceAmount)} د.ع
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Infinite Scroll Sentinel & Progress Footer */}
      {groupedOldInvoices.length > 0 && (
        <div
          ref={oldInvoicesScroll.sentinelRef}
          className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center gap-2.5 text-center transition-all ${
            isDarkMode
              ? 'bg-slate-900/90 border-slate-800 text-slate-300'
              : 'bg-white border-slate-200 text-slate-700'
          }`}
        >
          {/* Progress Summary */}
          <div className="w-full max-w-lg space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold">
              <span>
                معروض <strong className="text-emerald-600 dark:text-emerald-400">{displayedInvoices.length.toLocaleString()}</strong> فاتورة (من أصل <strong>{groupedOldInvoices.length.toLocaleString()}</strong> محمّلة)
              </span>
              {totalArchiveDocsCount !== null && (
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  سجلات محمّلة: {archivedEntries.length.toLocaleString()} / {totalArchiveDocsCount.toLocaleString()}
                </span>
              )}
            </div>
            <div className={`w-full h-1.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
              <div
                className="h-full bg-emerald-600 dark:bg-emerald-500 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    totalArchiveDocsCount && totalArchiveDocsCount > 0 && hasMoreArchiveFromServer
                      ? Math.min(100, Math.max(5, (archivedEntries.length / totalArchiveDocsCount) * 100))
                      : Math.min(100, (displayedInvoices.length / Math.max(1, groupedOldInvoices.length)) * 100)
                  }%`,
                }}
              />
            </div>
          </div>

          {oldInvoicesScroll.hasMore ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-black text-emerald-700 dark:text-emerald-300">
                <Loader2 className={`w-4 h-4 ${oldInvoicesScroll.isLoadingMore ? 'animate-spin' : ''}`} />
                <span>
                  {isFetchingMoreArchive
                    ? 'جاري جلب الدفعة التالية من أرشيف قاعدة البيانات...'
                    : oldInvoicesScroll.isLoadingMore
                    ? 'جاري عرض المزيد من الفواتير القديمة...'
                    : 'مرّر للأسفل لتحميل المزيد تلقائياً'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (displayedInvoices.length < groupedOldInvoices.length) {
                    oldInvoicesScroll.loadMore();
                  } else if (hasMoreArchiveFromServer) {
                    fetchArchivePage(false);
                  }
                }}
                disabled={oldInvoicesScroll.isLoadingMore}
                className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer disabled:opacity-50 ${
                  isDarkMode
                    ? 'bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}
              >
                {displayedInvoices.length < groupedOldInvoices.length
                  ? `عرض المزيد الآن (+${Math.min(20, groupedOldInvoices.length - displayedInvoices.length)})`
                  : 'جلب دفعة أقدم من الأرشيف (+200 سجل)'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-bold">
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>تم عرض جميع الفواتير المطابقة في الأرشيف ({groupedOldInvoices.length.toLocaleString()} فاتورة)</span>
              </span>
              {groupedOldInvoices.length > 10 && (
                <button
                  type="button"
                  onClick={() => archiveSectionTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                  }`}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>العودة للأعلى</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
