import React, { useState, useMemo, useEffect } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { logFirestoreErrorGracefully } from '../lib/firestoreUtils';
import { collection, getDocs, query, doc, writeBatch, onSnapshot, where, setDoc } from 'firebase/firestore';
import { SalesEntry, RouteItem, DebtItem } from '../types';
import { 
  FileText, 
  Search, 
  Calendar, 
  Printer, 
  Download, 
  ShoppingCart, 
  Package, 
  ShieldAlert, 
  Store, 
  User, 
  ChevronDown, 
  ChevronUp, 
  RotateCcw,
  Sparkles,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  XCircle
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

export const OldInvoicesScreen: React.FC = () => {
  const { 
    currentUser, 
    allSalesEntries = [], 
    salesEntries = [],
    productsList = [], 
    delegatesList = [], 
    delegateAccounts = [],
    isDarkMode, 
    setActiveTab 
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
  const [selectedDelegate, setSelectedDelegate] = useState<string>('الكل');
  const [selectedPriceMode, setSelectedPriceMode] = useState<'الكل' | 'retail' | 'wholesale'>('الكل');
  const [selectedMonth, setSelectedMonth] = useState<string>('الكل');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState<number>(30);
  const [archivedEntries, setArchivedEntries] = useState<SalesEntry[]>([]);
  const [isLoadingArchive, setIsLoadingArchive] = useState(false);
  const [deletingInvoiceKey, setDeletingInvoiceKey] = useState<string | null>(null);

  // Auto-lock closing time (default 15:00 / 3:00 PM) & real-time clock tick
  const [targetAutoLockTime, setTargetAutoLockTime] = useState<string>('15:00');
  const [timeTick, setTimeTick] = useState<number>(Date.now());
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});

  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [monthlyReportMonth, setMonthlyReportMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [monthlyOrderedSearch, setMonthlyOrderedSearch] = useState<string>('');
  const [monthlyOrderedDelegate, setMonthlyOrderedDelegate] = useState<string>('الكل');
  const [monthlyOrderedShowAll, setMonthlyOrderedShowAll] = useState<boolean>(false);
  const [monthlyUnorderedSearch, setMonthlyUnorderedSearch] = useState<string>('');
  const [monthlyUnorderedDelegate, setMonthlyUnorderedDelegate] = useState<string>('الكل');
  const [monthlyUnorderedShowAll, setMonthlyUnorderedShowAll] = useState<boolean>(false);

  useEffect(() => {
    const q = query(collection(db, 'routes'));
    const unsub = onSnapshot(
      q, 
      (snap) => {
        const loaded: RouteItem[] = [];
        snap.forEach(d => loaded.push({ id: d.id, ...d.data() } as RouteItem));
        setRoutes(loaded);
      },
      (err) => {
        logFirestoreErrorGracefully(err, 'routes in OldInvoicesScreen');
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'debts'));
    const unsub = onSnapshot(
      q, 
      (snap) => {
        const loaded: DebtItem[] = [];
        snap.forEach(d => loaded.push({ id: d.id, ...d.data() } as DebtItem));
        setDebts(loaded);
      },
      (err) => {
        logFirestoreErrorGracefully(err, 'debts in OldInvoicesScreen');
      }
    );
    return () => unsub();
  }, []);

  // Real-time listener for configurable auto_lock_time setting
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (docSnap) => {
        if (docSnap.exists() && docSnap.data()?.time) {
          setTargetAutoLockTime(docSnap.data().time);
        }
      },
      (err) => {
        console.error('Error listening to auto_lock_time in OldInvoicesScreen:', err);
      }
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
    const unsub = onSnapshot(
      q,
      (snap) => {
        const completed: Record<string, boolean> = {};
        snap.forEach((d) => {
          completed[d.id] = true;
          const data = d.data();
          if (data.delegate) completed[data.delegate] = true;
          if (data.delegateName) completed[data.delegateName] = true;
          if (data.delegateCode) completed[data.delegateCode] = true;
        });
        setCompletedDelegates(completed);
      },
      (err) => {
        console.error('Error listening to daily_sales_completion in OldInvoicesScreen:', err);
      }
    );
    return () => unsub();
  }, [baghdadStatus.todayBaghdad]);

  // Real-time listener for `sales_entries_archive` to ensure full live coverage of archived invoices
  useEffect(() => {
    setIsLoadingArchive(true);
    const unsub = onSnapshot(
      collection(db, 'sales_entries_archive'),
      (snap) => {
        const list: SalesEntry[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as SalesEntry);
        });
        setArchivedEntries(list);
        setIsLoadingArchive(false);
      },
      (err) => {
        console.error('Error reading sales_entries_archive in OldInvoicesScreen:', err);
        setIsLoadingArchive(false);
      }
    );
    return () => unsub();
  }, []);

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

  // Helper to verify if an invoice entry is eligible into "Old Invoices" (Historical Record)
  // according to the conditional saving & calculation rule:
  // - Invoices must NOT be saved or displayed immediately upon creation during the day.
  // - Invoices must only be saved, processed, and calculated into "Old Invoices" after either:
  //   * The representative clicks "I have completed today's sales", OR
  //   * The official sales closing time for the day has expired/ended.
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
    // Condition A: If official closing time has expired, automatically adopt all active remaining invoices
    if (isPastClosing) {
      return true;
    }

    // Condition B: Otherwise, ONLY adopt if the representative has clicked "I have completed today's sales"
    return isDelegateCompletedToday(entry.delegateName, (entry as any).delegateCode);
  };

  // Background archiving synchronization:
  // Automatically archive eligible invoices into `sales_entries_archive` in Firestore
  // when either the representative clicks completion or the official sales closing time expires
  useEffect(() => {
    if (!allSalesEntries || allSalesEntries.length === 0) return;
    const archivedIds = new Set(archivedEntries.map((e) => e.id));
    const entriesToArchive = allSalesEntries.filter(
      (e) => e.id && !archivedIds.has(e.id) && isEntryEligibleForOldInvoices(e)
    );

    if (entriesToArchive.length > 0) {
      // Chunk batches up to 400 to respect Firestore limits
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
  }, [allSalesEntries, archivedEntries, baghdadStatus, completedDelegates]);

  // Merge all entries (allSalesEntries + archivedEntries) without duplicates,
  // STRICTLY filtered so that only eligible invoices (completed sales OR past closing time) are included:
  const allEntriesCombined = useMemo(() => {
    const map = new Map<string, SalesEntry>();
    allSalesEntries.forEach((e) => {
      if (e && e.id && isEntryEligibleForOldInvoices(e)) {
        map.set(e.id, e);
      }
    });
    archivedEntries.forEach((e) => {
      if (e && e.id && isEntryEligibleForOldInvoices(e)) {
        map.set(e.id, e);
      }
    });
    return Array.from(map.values());
  }, [allSalesEntries, archivedEntries, baghdadStatus, completedDelegates]);

  // Extract available months for filtering (sorted descending)
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    allEntriesCombined.forEach(e => {
      if (e.dateString) {
        const parts = e.dateString.replace(/\//g, '-').split('-');
        if (parts.length >= 2) {
          months.add(`${parts[0]}-${parts[1].padStart(2, '0')}`);
        }
      }
    });
    return Array.from(months).sort().reverse();
  }, [allEntriesCombined]);

  // Count of completed delegates for UI badge
  const completedDelegatesCount = useMemo(() => {
    return delegatesList.filter((name) => isDelegateCompletedToday(name)).length;
  }, [delegatesList, completedDelegates]);

  // Product Code lookup helper
  const getProductCode = (productName: string) => {
    const prod = productsList.find(p => p.productName === productName);
    return prod?.productCode || '---';
  };

  // Group historical entries into distinct invoices:
  // Key = dateString + customerCode/Name + delegateName + priceMode (+ invoiceId if present)
  const groupedOldInvoices = useMemo(() => {
    const term = shopSearchTerm.trim().toLowerCase();

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

      const prod = productsList.find(p => p.productName === entry.productName);
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
  }, [allEntriesCombined, shopSearchTerm, selectedDelegate, selectedPriceMode, selectedMonth, selectedDate, productsList]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalInvoices = groupedOldInvoices.length;
    const totalWeight = groupedOldInvoices.reduce((sum, inv) => sum + inv.totalWeight, 0);
    const totalAmount = groupedOldInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const uniqueShops = new Set(groupedOldInvoices.map(inv => inv.customerCode || inv.customerName)).size;
    return { totalInvoices, totalWeight, totalAmount, uniqueShops };
  }, [groupedOldInvoices]);

  // Exact Match Receipt Thermal Printing (matches EntryScreen print invoice)
  const handlePrintInvoice = (inv: typeof groupedOldInvoices[0]) => {
    const actualCustomerName = inv.customerName;
    const entries = inv.entries;

    let rowsHtml = '';
    let totalPrice = 0;
    let totalCartons = 0;

    entries.forEach((e) => {
      const isGift = Boolean(e.isGift);
      const prod = productsList.find(p => p.productName === e.productName);
      const cartonSize = Number(prod?.cartonQuantity) || 1;
      const isCarton = e.entryUnit === 'carton';
      const pieces = isCarton ? (e.quantity || 0) : (e.enteredQuantity || e.quantity || 0);
      const rowPrice = prod && !isGift ? ((e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) * e.quantity) : 0;
      totalPrice += rowPrice;

      let quantityText = '';
      if (isGift) {
        quantityText = `<div style="font-weight: bold; color: #d97706;">${pieces} قطعة (هدية)</div>`;
      } else if (cartonSize > 1) {
        const cVal = isCarton ? (e.enteredQuantity || (pieces / cartonSize)) : (pieces / cartonSize);
        totalCartons += cVal;
        const displayCarton = cVal.toFixed(2).endsWith('.00') ? cVal.toFixed(0) : cVal.toFixed(2);
        quantityText = `<div style="font-weight: bold;">${pieces} قطعة</div><div style="font-size: 10px; color: #555;">(${displayCarton} كارتون)</div>`;
      } else {
        totalCartons += pieces;
        quantityText = `<div style="font-weight: bold;">${pieces} قطعة</div>`;
      }

      rowsHtml += `
        <tr style="${isGift ? 'background-color: #fffbeb;' : ''}">
          <td>${isGift ? '🎁' : getProductCode(e.productName)}</td>
          <td class="text-right">
            ${isGift ? '<span style="color: #b45309; font-weight: bold; margin-left: 4px;">[هدية]</span>' : ''}
            ${e.productName}
          </td>
          <td>${quantityText}</td>
          <td class="text-left" style="${isGift ? 'font-weight: bold; color: #b45309;' : ''}">
            ${isGift ? 'هدية' : `${formatWithCommas(rowPrice, true)} د.ع`}
          </td>
        </tr>
      `;
    });

    const displayTotalCartons = totalCartons.toFixed(2).endsWith('.00') ? totalCartons.toFixed(0) : totalCartons.toFixed(2);

    rowsHtml += `
      <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f9f9f9;">
        <td colspan="3" class="text-right" style="padding-top: 8px; padding-bottom: 8px;">الإجمالي</td>
        <td class="text-left" style="padding-top: 8px; padding-bottom: 8px;">${formatWithCommas(totalPrice, true)} د.ع</td>
      </tr>
    `;

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>فاتورة قديمة - ${actualCustomerName}</title>
          <style>
            @media print {
              @page { margin: 0; }
              body { margin: 0; padding: 5px; }
              button { display: none !important; }
              .invoice-print-view { padding: 0 !important; }
            }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 10px; color: #000; max-width: 80mm; margin: 0 auto; background: #fff; line-height: 1.2; }
            .header-container { text-align: center; display: flex; flex-direction: column; align-items: center; margin-bottom: 3px; }
            .logo-img { width: 50px; height: auto; margin-bottom: 4px; filter: grayscale(100%); }
            h1 { margin: 0 0 3px 0; font-size: 15px; font-weight: bold; }
            .header-customer-row { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 5px; border-top: 1px dashed #000; padding-top: 5px; }
            .header-customer-name { margin: 0; font-size: 17px; font-weight: bold; }
            .header-invoice-date { font-size: 10px; color: #333; }
            .divider { border: none; border-top: 1px dashed #000; margin: 6px 0; }
            .info-container { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; text-align: right; }
            .info-item { font-size: 12px; line-height: 1.2; display: flex; flex-wrap: wrap; }
            .info-label { font-weight: bold; margin-left: 4px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 12px; page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            th, td { border-bottom: 1px dashed #ccc; padding: 4px 2px; text-align: center; }
            th { font-weight: bold; border-bottom: 1px solid #000; }
            td.text-right { text-align: right; }
            td.text-left { text-align: left; }
            .print-btn { display: block; width: 100%; padding: 10px; background: #059669; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: bold; cursor: pointer; margin-bottom: 20px; }
          </style>
        </head>
        <body class="invoice-print-view">
          <button class="print-btn" onclick="window.print()">🖨️ طباعة الفاتورة الآن</button>
          
          <div style="border: 2px solid #000; padding: 6px; margin-bottom: 10px;">
            <div class="header-container">
              <img src="${logoImg}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />
              <h1>شركة كالة للألبان والعصائر</h1>
              <div style="font-size: 11px; margin-bottom: 2px;">فرع صلاح الدين - تكريت</div>
              <div class="header-customer-row">
                <span class="header-customer-name">${actualCustomerName}</span>
                <span class="header-invoice-date">${inv.dateString}</span>
              </div>
            </div>
            
            <hr class="divider" />
            
            <div class="info-container">
              ${inv.customerCode ? `<div class="info-item"><span class="info-label">كود المحل/الزبون:</span> <span>${inv.customerCode}</span></div>` : ''}
              ${inv.customerAddress ? `<div class="info-item"><span class="info-label">العنوان:</span> <span>${inv.customerAddress}</span></div>` : ''}
              <div class="info-item"><span class="info-label">المندوب:</span> <span>${inv.delegateName}</span></div>
              <div class="info-item"><span class="info-label">نوع الفاتورة:</span> <span>${inv.priceMode === 'wholesale' ? 'جملة' : 'مفرد'} (أرشيف قديم)</span></div>
              <div class="info-item"><span class="info-label">تاريخ وتوقيت الفاتورة:</span> <span dir="ltr">${inv.dateString}</span></div>
            </div>
            
            <hr class="divider" />
            
            <table>
              <thead>
                <tr>
                  <th style="width: 15%;">الكود</th>
                  <th class="text-right" style="width: 45%;">المنتج</th>
                  <th style="width: 20%;">الكمية</th>
                  <th class="text-left" style="width: 20%;">السعر</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            
            <div style="margin-top: 6px; padding-top: 4px; border-top: 1px dashed #000; font-size: 11px; display: flex; justify-content: space-between;">
              <span>مجموع الكراتين: <b>${displayTotalCartons}</b></span>
              <span>الوزن الكلي: <b>${formatWithCommas(parseFloat(inv.totalWeight.toFixed(2)), true)} كجم</b></span>
            </div>
            
            <div style="text-align: center; margin-top: 15px; font-size: 11px; border-top: 1px dashed #000; padding-top: 5px;">
              شكراً لتعاملكم معنا
            </div>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    }
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

    const monthEntries = allSalesEntries.filter((e) => {
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
  }, [allSalesEntries, salesEntries, debts, monthlyReportMonth, routes, productsList, baghdadStatus, completedDelegates]);

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
        row['الوزن الكلي الشهري (كجم)'] = Number(c.totalWeight.toFixed(2));
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

  const renderMonthlyCustomerReports = () => {
    if (!canViewMonthlyReports) return null;

    const delegateOptions: string[] = [
      'الكل',
      ...Array.from(new Set(delegateAccounts.map((a: any) => a.delegateName).filter(Boolean))) as string[]
    ];

    const currentFilteredWeight = filteredMonthlyOrdered.reduce((sum, c) => sum + c.totalWeight, 0);
    const currentFilteredAmount = filteredMonthlyOrdered.reduce((sum, c) => sum + c.totalAmount, 0);
    const currentFilteredInvoices = filteredMonthlyOrdered.reduce((sum, c) => sum + c.invoicesCount, 0);

    const displayedMonthlyOrdered = monthlyOrderedShowAll 
      ? filteredMonthlyOrdered 
      : filteredMonthlyOrdered.slice(0, 20);

    const displayedMonthlyUnordered = monthlyUnorderedShowAll 
      ? filteredMonthlyUnordered 
      : filteredMonthlyUnordered.slice(0, 20);

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

          <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-800 shadow-xs">
            <table className="w-full min-w-[650px] text-[10px] sm:text-[11px] text-right whitespace-nowrap">
              <thead className={`font-black ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/90 text-slate-900 border-b border-slate-300'}`}>
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
                          {c.totalWeight.toFixed(1)} كجم
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
                <tfoot className={`font-black border-t-2 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-200/90 border-slate-300 text-slate-950'}`}>
                  <tr>
                    <td colSpan={5} className="px-2.5 py-2 font-black text-emerald-700 dark:text-emerald-300 text-xs">
                      المجموع ({filteredMonthlyOrdered.length} زبون)
                    </td>
                    <td className="px-2.5 py-2 text-center font-black text-indigo-700 dark:text-indigo-300 text-xs">
                      {currentFilteredInvoices.toLocaleString()}
                    </td>
                    <td className="px-2.5 py-2 text-center font-black text-emerald-700 dark:text-emerald-300 text-xs">
                      {currentFilteredWeight.toFixed(1)} كجم
                    </td>
                    <td className="px-2.5 py-2 text-center font-black text-blue-700 dark:text-blue-300 text-xs">
                      {Math.round(currentFilteredAmount).toLocaleString()} د.ع
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {filteredMonthlyOrdered.length > 20 && (
            <div className="pt-2 flex justify-center">
              <button
                onClick={() => setMonthlyOrderedShowAll(!monthlyOrderedShowAll)}
                className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                  isDarkMode 
                    ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/60' 
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}
              >
                {monthlyOrderedShowAll ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span>عرض أقل (أول 20 زبون فقط)</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span>المزيد (+{filteredMonthlyOrdered.length - 20} زبون)</span>
                  </>
                )}
              </button>
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

          <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-800 shadow-xs">
            <table className="w-full min-w-[650px] text-[10px] sm:text-[11px] text-right whitespace-nowrap">
              <thead className={`font-black ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/90 text-slate-900 border-b border-slate-300'}`}>
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
                <tfoot className={`font-black border-t-2 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-200/90 border-slate-300 text-slate-950'}`}>
                  <tr>
                    <td colSpan={5} className="px-2.5 py-2 font-black text-amber-700 dark:text-amber-300 text-xs">
                      مجموع الزبائن غير الطالبين ({filteredMonthlyUnordered.length} زبون)
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {filteredMonthlyUnordered.length > 20 && (
            <div className="pt-2 flex justify-center">
              <button
                onClick={() => setMonthlyUnorderedShowAll(!monthlyUnorderedShowAll)}
                className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                  isDarkMode 
                    ? 'bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-800/60' 
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {monthlyUnorderedShowAll ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span>عرض أقل (أول 20 زبون فقط)</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span>المزيد (+{filteredMonthlyUnordered.length - 20} زبون)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const displayedInvoices = groupedOldInvoices.slice(0, visibleCount);

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
      {renderMonthlyCustomerReports()}

      {/* Header Banner */}
      <div className={`p-4 rounded-2xl border-2 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isDarkMode 
          ? 'bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-emerald-500/40 text-white' 
          : 'bg-gradient-to-r from-emerald-50/80 via-white to-emerald-50/80 border-emerald-200 text-slate-900'
      }`}>
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
            {formatWithCommas(parseFloat(summaryMetrics.totalWeight.toFixed(1)), true)} كجم
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
        {/* Primary Search by Store / Shop Name (اسم المحل) */}
        <div className="relative w-full">
          <div className="absolute right-3 top-2.5 text-emerald-600 dark:text-emerald-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={shopSearchTerm}
            onChange={(e) => setShopSearchTerm(e.target.value)}
            placeholder="🔍 بحث باسم المحل / الزبون، كود الزبون، أو اسم المنتج..."
            className={`w-full pr-9 pl-3 py-2 rounded-xl border text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              isDarkMode 
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-400' 
                : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
          {shopSearchTerm && (
            <button
              onClick={() => setShopSearchTerm('')}
              className="absolute left-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕ مسح
            </button>
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
        {groupedOldInvoices.length === 0 ? (
          <div className={`p-8 rounded-2xl border text-center space-y-2 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="text-3xl">📭</div>
            <h3 className="text-sm font-black text-slate-700 dark:text-slate-300">
              لا توجد فواتير قديمة تطابق معايير البحث
            </h3>
            <p className="text-xs text-slate-500 font-bold">
              تأكد من كتابة اسم المحل بشكل صحيح أو اختر "جميع المندوبين" لعرض كامل الأرشيف.
            </p>
          </div>
        ) : (
          displayedInvoices.map((inv) => {
            const customerName = inv.customerName;
            const entries = inv.entries;

            return (
              <div 
                key={inv.invoiceKey} 
                className={`invoice-card border-2 rounded-xl p-0 shadow-md overflow-hidden transition-all ${
                  isDarkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-400'
                }`}
              >
                {/* Invoice Card Header - Matching EntryScreen exactly */}
                <h4 className={`font-extrabold text-sm mb-0 p-3 border-b flex flex-col gap-2 rounded-t-xl ${
                  isDarkMode ? 'bg-slate-700/80 border-slate-600 text-slate-100' : 'bg-slate-100/80 border-slate-200 text-slate-900'
                }`}>
                  {/* Row 1: Green Indicator + Code + Shop Name AND Print Action Button */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span className="bg-slate-200 dark:bg-slate-600 text-[10px] font-black px-2 py-0.5 rounded border border-slate-300 dark:border-slate-500 shrink-0">
                        {inv.customerCode || '---'}
                      </span>
                      <span className="font-black text-sm truncate">
                        اسم المحل: {customerName}
                      </span>
                      {inv.customerAddress && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal truncate">
                          ({inv.customerAddress})
                        </span>
                      )}
                    </div>

                    {/* زر الطباعة والحذف اليدوي أمام اسم الزبون */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePrintInvoice(inv)}
                        className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${
                          isDarkMode 
                            ? 'bg-blue-900/50 text-blue-400 hover:bg-blue-800 border-blue-700' 
                            : 'bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-800 border-blue-200'
                        }`}
                        title="طباعة الفاتورة القديمة"
                      >
                        <Printer className="w-4 h-4" />
                      </button>

                      {currentUser?.isAdmin && (
                        <button
                          type="button"
                          disabled={deletingInvoiceKey === inv.invoiceKey}
                          onClick={() => handleDeleteOldInvoice(inv)}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${
                            isDarkMode 
                              ? 'bg-rose-950/40 text-rose-400 hover:bg-rose-900 border-rose-800' 
                              : 'bg-rose-100 text-rose-600 hover:bg-rose-200 hover:text-rose-800 border-rose-200'
                          }`}
                          title="حذف هذه الفاتورة القديمة يدوياً (خاص بالمدير)"
                        >
                          {deletingInvoiceKey === inv.invoiceKey ? (
                            <span className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Grid Layout for Invoice Type & Metadata (Representative, Weight, Total) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] pt-2 border-t border-slate-200/70 dark:border-slate-600/70">
                    {/* 1. نوع الفاتورة: مفرد / جملة */}
                    <div className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg border font-bold text-center ${
                      inv.priceMode === 'wholesale' 
                        ? 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800' 
                        : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                    }`}>
                      {inv.priceMode === 'wholesale' ? <Package className="w-3.5 h-3.5 shrink-0" /> : <ShoppingCart className="w-3.5 h-3.5 shrink-0" />}
                      <span className="truncate">{inv.priceMode === 'wholesale' ? 'فاتورة جملة' : 'فاتورة مفرد'}</span>
                    </div>

                    {/* 2. اسم المندوب وتاريخ الفاتورة */}
                    <div className={`flex items-center justify-between sm:justify-center gap-1.5 py-1 px-2 rounded-lg border font-bold ${
                      isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-600' : 'bg-slate-200 text-slate-900 border-slate-300'
                    }`}>
                      <div className="flex items-center gap-1 truncate">
                        <span className="text-slate-500 dark:text-slate-400 font-normal">المندوب:</span>
                        <span className="truncate">{inv.delegateName}</span>
                      </div>
                      <span className={`text-[9px] font-bold whitespace-nowrap border-r pr-1 shrink-0 ${
                        isDarkMode ? 'text-slate-400 border-slate-600' : 'text-slate-600 border-slate-400'
                      }`} dir="ltr">
                        {inv.dateString}
                      </span>
                    </div>

                    {/* 3. الوزن الكلي */}
                    <div className="flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-emerald-600 text-white font-black border border-emerald-700 shadow-sm text-center">
                      <span className="text-emerald-100 text-[9px] font-normal">الوزن:</span>
                      <span>{formatWithCommas(parseFloat(inv.totalWeight.toFixed(2)), true)} كجم</span>
                    </div>

                    {/* 4. المبلغ الكلي */}
                    <div className="flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-indigo-600 text-white font-black border border-indigo-700 shadow-sm text-center" title="إجمالي مبلغ الفاتورة">
                      <span className="text-indigo-100 text-[9px] font-normal">المجموع:</span>
                      <span>{formatWithCommas(Math.round(inv.totalAmount), true)} د.ع</span>
                    </div>
                  </div>
                </h4>

                {/* Items List - Exactly matching EntryScreen layout */}
                <div className="flex flex-col px-2 pb-1 pt-0.5">
                  {entries.map((entry, index) => {
                    const isGift = Boolean(entry.isGift);
                    const prod = productsList.find(p => p.productName === entry.productName);
                    const cartonQty = Number(prod?.cartonQuantity) || 1;
                    const itemUnitPrice = prod && !isGift ? (entry.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                    const itemTotalPrice = itemUnitPrice * entry.quantity;

                    return (
                      <div
                        key={`old_item_${entry.id || index}`}
                        className={`py-1 px-2 border-b last:border-b-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-[10px] transition-colors ${
                          isGift
                            ? (isDarkMode ? 'bg-amber-950/30 border-amber-800/60' : 'bg-amber-50/70 border-amber-200')
                            : (isDarkMode ? 'border-slate-700 hover:bg-slate-700/50' : 'border-slate-200 hover:bg-slate-50')
                        }`}
                      >
                        {/* Product Code, Name, Category */}
                        <div className="flex-1 flex flex-col gap-1 w-full sm:w-auto">
                          <div className="flex items-center gap-2">
                            {isGift ? (
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-white shadow-xs">
                                هدية 🎁
                              </span>
                            ) : (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                isDarkMode ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-slate-200 text-slate-700 border-slate-300'
                              }`} title="كود المنتج">
                                {getProductCode(entry.productName)}
                              </span>
                            )}
                            <span className={`font-bold text-sm ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                              {entry.productName}
                            </span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              isDarkMode ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {entry.categoryName}
                            </span>
                          </div>
                        </div>

                        {/* Quantities, Weight, and Price */}
                        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                          <div className="flex items-center gap-1.5">
                            {!isGift && entry.quantity >= cartonQty && (
                              <div className={`text-center font-bold px-2 py-0.5 border rounded-md text-[10px] min-w-[50px] ${
                                isDarkMode ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                              }`} title="الكراتين المدخلة">
                                {entry.entryUnit === 'carton' 
                                  ? formatWithCommas(entry.enteredQuantity || 0) 
                                  : formatWithCommas(parseFloat(((entry.enteredQuantity || entry.quantity) / cartonQty).toFixed(2)))} كارتون
                              </div>
                            )}
                            <div className={`text-center font-bold px-2 py-0.5 rounded-md text-[10px] min-w-[50px] ${
                              isGift
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 font-black'
                                : (isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-800')
                            }`} title={isGift ? "قطع الهدية المجانية" : "القطع"}>
                              {isGift ? `${formatWithCommas(entry.quantity)} قطعة هدية` : (entry.entryUnit === 'carton' 
                                ? `${formatWithCommas(entry.quantity)} قطعة` 
                                : `${formatWithCommas(entry.enteredQuantity || entry.quantity)} قطعة`)}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1.5">
                            <div className={`text-center font-black px-2 py-0.5 rounded-md border text-[10px] min-w-[60px] ${
                              isDarkMode ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300' : 'bg-emerald-50 border-emerald-100 text-emerald-800'
                            }`} title="وزن الإدخال">
                              وزن: {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
                            </div>
                            <div className={`text-center font-black px-2 py-0.5 rounded-md border text-[10px] min-w-[60px] ${
                              isGift
                                ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/50 dark:text-amber-200'
                                : (isDarkMode ? 'bg-rose-900/50 border-rose-700 text-rose-300' : 'bg-rose-50 border-rose-100 text-rose-800')
                            }`} title={isGift ? "هدية مجانية (بدون مبلغ)" : "مبلغ الإدخال"}>
                              {isGift ? 'هدية 🎁' : `مبلغ: ${formatWithCommas(itemTotalPrice, true)} د.ع`}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination / Load More Button */}
      {groupedOldInvoices.length > visibleCount && (
        <div className="pt-2 flex justify-center">
          <button
            onClick={() => setVisibleCount(prev => prev + 30)}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md ${
              isDarkMode 
                ? 'bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700' 
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300'
            }`}
          >
            <ChevronDown className="w-4 h-4" />
            <span>عرض المزيد (+30 فاتورة قديمة)</span>
          </button>
        </div>
      )}
    </div>
  );
};
