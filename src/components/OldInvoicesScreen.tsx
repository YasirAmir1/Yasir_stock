import React, { useState, useMemo, useEffect } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import { SalesEntry } from '../types';
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
  Sparkles
} from 'lucide-react';
import { formatWithCommas } from '../utils/numberUtils';
import logoImg from '../assets/images/logo.png';
import * as XLSX from 'xlsx';

export const OldInvoicesScreen: React.FC = () => {
  const { 
    currentUser, 
    allSalesEntries = [], 
    productsList = [], 
    delegatesList = [], 
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

  // Fetch from `sales_entries_archive` if available to ensure full coverage of archived invoices
  useEffect(() => {
    let isMounted = true;
    const loadArchive = async () => {
      try {
        setIsLoadingArchive(true);
        const snap = await getDocs(collection(db, 'sales_entries_archive'));
        if (snap.size > 0 && isMounted) {
          const list: SalesEntry[] = [];
          snap.forEach(d => {
            list.push({ id: d.id, ...d.data() } as SalesEntry);
          });
          setArchivedEntries(list);
        }
      } catch (e) {
        console.error('Error reading archive:', e);
      } finally {
        if (isMounted) setIsLoadingArchive(false);
      }
    };
    loadArchive();
    return () => { isMounted = false; };
  }, []);

  // Merge all entries (allSalesEntries + archivedEntries) without duplicates
  const allEntriesCombined = useMemo(() => {
    const map = new Map<string, SalesEntry>();
    allSalesEntries.forEach(e => {
      if (e && e.id) map.set(e.id, e);
    });
    archivedEntries.forEach(e => {
      if (e && e.id) map.set(e.id, e);
    });
    return Array.from(map.values());
  }, [allSalesEntries, archivedEntries]);

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
      const prod = productsList.find(p => p.productName === e.productName);
      const cartonSize = Number(prod?.cartonQuantity) || 1;
      const isCarton = e.entryUnit === 'carton';
      const pieces = isCarton ? (e.quantity || 0) : (e.enteredQuantity || e.quantity || 0);
      const rowPrice = prod ? ((e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) * e.quantity) : 0;
      totalPrice += rowPrice;

      let quantityText = '';
      if (cartonSize > 1) {
        const cVal = isCarton ? (e.enteredQuantity || (pieces / cartonSize)) : (pieces / cartonSize);
        totalCartons += cVal;
        const displayCarton = cVal.toFixed(2).endsWith('.00') ? cVal.toFixed(0) : cVal.toFixed(2);
        quantityText = `<div style="font-weight: bold;">${pieces} قطعة</div><div style="font-size: 10px; color: #555;">(${displayCarton} كارتون)</div>`;
      } else {
        totalCartons += pieces;
        quantityText = `<div style="font-weight: bold;">${pieces} قطعة</div>`;
      }

      rowsHtml += `
        <tr>
          <td>${getProductCode(e.productName)}</td>
          <td class="text-right">${e.productName}</td>
          <td>${quantityText}</td>
          <td class="text-left">${formatWithCommas(rowPrice, true)} د.ع</td>
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

  // Export Filtered Old Invoices to Excel
  const exportToExcel = () => {
    if (groupedOldInvoices.length === 0) return;

    const data: any[] = [];
    groupedOldInvoices.forEach(inv => {
      inv.entries.forEach(e => {
        const prod = productsList.find(p => p.productName === e.productName);
        const unitPrice = prod 
          ? (inv.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) 
          : 0;
        data.push({
          'تاريخ الفاتورة': inv.dateString,
          'اسم المحل / الزبون': inv.customerName,
          'كود الزبون': inv.customerCode || '---',
          'عنوان الزبون': inv.customerAddress || '---',
          'المندوب': inv.delegateName,
          'نوع الفاتورة': inv.priceMode === 'wholesale' ? 'جملة' : 'مفرد',
          'اسم المنتج': e.productName,
          'الصنف': e.categoryName,
          'كود المنتج': getProductCode(e.productName),
          'الكمية (قطع)': e.quantity,
          'الوزن الكلي (كجم)': e.totalWeightKg,
          'المبلغ (د.ع)': unitPrice * e.quantity,
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'OldInvoices');
    XLSX.writeFile(workbook, `الفواتير_القديمة_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const displayedInvoices = groupedOldInvoices.slice(0, visibleCount);

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
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
            disabled={groupedOldInvoices.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-md transition-all cursor-pointer"
            title="تصدير النتائج إلى ملف إكسل"
          >
            <Download className="w-4 h-4" />
            <span>تصدير Excel</span>
          </button>
        </div>
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

                    {/* زر الطباعة أمام اسم الزبون */}
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
                    const prod = productsList.find(p => p.productName === entry.productName);
                    const cartonQty = Number(prod?.cartonQuantity) || 1;
                    const itemUnitPrice = prod ? (entry.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                    const itemTotalPrice = itemUnitPrice * entry.quantity;

                    return (
                      <div
                        key={`old_item_${entry.id || index}`}
                        className={`py-1 px-2 border-b last:border-b-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-[10px] transition-colors ${
                          isDarkMode ? 'border-slate-700 hover:bg-slate-700/50' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {/* Product Code, Name, Category */}
                        <div className="flex-1 flex flex-col gap-1 w-full sm:w-auto">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                              isDarkMode ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-slate-200 text-slate-700 border-slate-300'
                            }`} title="كود المنتج">
                              {getProductCode(entry.productName)}
                            </span>
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
                            {entry.quantity >= cartonQty && (
                              <div className={`text-center font-bold px-2 py-0.5 border rounded-md text-[10px] min-w-[50px] ${
                                isDarkMode ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                              }`} title="الكراتين المدخلة">
                                {entry.entryUnit === 'carton' 
                                  ? formatWithCommas(entry.enteredQuantity || 0) 
                                  : formatWithCommas(parseFloat(((entry.enteredQuantity || entry.quantity) / cartonQty).toFixed(2)))} كارتون
                              </div>
                            )}
                            <div className={`text-center font-bold px-2 py-0.5 rounded-md text-[10px] min-w-[50px] ${
                              isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-800'
                            }`} title="القطع">
                              {entry.entryUnit === 'carton' 
                                ? formatWithCommas(entry.quantity) 
                                : formatWithCommas(entry.enteredQuantity || entry.quantity)} قطعة
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1.5">
                            <div className={`text-center font-black px-2 py-0.5 rounded-md border text-[10px] min-w-[60px] ${
                              isDarkMode ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300' : 'bg-emerald-50 border-emerald-100 text-emerald-800'
                            }`} title="وزن الإدخال">
                              وزن: {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
                            </div>
                            <div className={`text-center font-black px-2 py-0.5 rounded-md border text-[10px] min-w-[60px] ${
                              isDarkMode ? 'bg-rose-900/50 border-rose-700 text-rose-300' : 'bg-rose-50 border-rose-100 text-rose-800'
                            }`} title="مبلغ الإدخال">
                              مبلغ: {formatWithCommas(itemTotalPrice, true)} د.ع
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
