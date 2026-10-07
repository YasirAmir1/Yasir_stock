import React, { useState, useMemo, useEffect } from 'react';
import { useSales, DEFAULT_CATEGORIES_LIST } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, doc, setDoc } from 'firebase/firestore';
import { GridRow, SalesEntry } from '../types';
import { Star, Save, Plus, Trash2, Check, AlertCircle, AlertTriangle, Pencil, X , Download, ShoppingCart, Package, Printer, Clock, RotateCcw, UserCheck, Shield, Calendar } from 'lucide-react';
import { DelegateLoginModal } from './DelegateLoginModal';
import { parseArabicDigits, parseArabicNumber, formatWithCommas, getInvoiceKey } from '../utils/numberUtils';
import { PullToRefresh } from './PullToRefresh';
import logoImg from '../assets/images/logo.png';
import * as XLSX from 'xlsx';

export const EntryScreen: React.FC = () => {
  const {
    currentUser,
    selectedDelegate,
    setSelectedDelegate,
    delegatesList = [],
    delegateAccounts = [],
    delegateTargets = [],
    savedEntries = [],
    productsList = [],
    saveSalesEntries,
    deleteSalesEntry,
    updateSalesEntry,
    syncData,
    isDarkMode,
    prefilledEntryData,
    setPrefilledEntryData,
    showQuickAdd,
    setShowQuickAdd,
    setActiveTab,
  } = useSales();

  useEffect(() => {
    if (prefilledEntryData) {
      setCustomerName(prefilledEntryData.customerName);
      setCustomerCode(prefilledEntryData.customerCode);
      setCustomerAddress(prefilledEntryData.customerAddress);
      if (prefilledEntryData.lastInvoiceToday) {
        setInvoicePriceMode(prefilledEntryData.lastInvoiceToday.priceMode || 'retail');
      } else if (prefilledEntryData.customerType) {
        setInvoicePriceMode(prefilledEntryData.customerType === 'مفرد' ? 'retail' : 'wholesale');
      }
      setPrefilledEntryData(null);
    }
  }, [prefilledEntryData, setPrefilledEntryData]);

  const productSuggestions = useMemo(() => {
    return productsList
      .filter(p => p.isAvailable !== false)
      .map(p => ({
        name: p.productName,
        category: p.categoryName,
        code: p.productCode,
        pieceWeightKg: Number(p.pieceWeightKg) || 0,
      }));
  }, [productsList]);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);
    const [customerName, setCustomerName] = useState(() => localStorage.getItem('entry_draft_customerName') || '');
  const [customerCode, setCustomerCode] = useState(() => localStorage.getItem('entry_draft_customerCode') || '');
  const [customerAddress, setCustomerAddress] = useState(() => localStorage.getItem('entry_draft_customerAddress') || '');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [invoicePriceMode, setInvoicePriceMode] = useState<'retail' | 'wholesale'>(() => (localStorage.getItem('pref_priceMode') as 'retail' | 'wholesale') || 'retail');
  const [savedEntriesFilterDelegate, setSavedEntriesFilterDelegate] = useState<string>('الكل');
  const [savedEntriesFilterPriceMode, setSavedEntriesFilterPriceMode] = useState<'الكل' | 'retail' | 'wholesale'>('الكل');
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [showCustomExportModal, setShowCustomExportModal] = useState(false);
  const [selectedDelegatesForExport, setSelectedDelegatesForExport] = useState<Set<string>>(new Set());
  const [targetAutoLockTime, setTargetAutoLockTime] = useState<string>('15:00');
  const [isPastClosing, setIsPastClosing] = useState<boolean>(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (snap) => {
        if (snap.exists() && snap.data()?.targetTime) {
          setTargetAutoLockTime(snap.data().targetTime);
        }
      },
      (err) => console.error('Error listening to auto_lock_time in EntryScreen:', err)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const checkClosing = () => {
      try {
        const now = new Date();
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Baghdad',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hour12: false,
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

        setIsPastClosing(currentSeconds >= targetSeconds);
      } catch {
        setIsPastClosing(false);
      }
    };
    checkClosing();
    const timer = setInterval(checkClosing, 5000);
    return () => clearInterval(timer);
  }, [targetAutoLockTime]);

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

  useEffect(() => {
    localStorage.setItem('pref_priceMode', invoicePriceMode);
  }, [invoicePriceMode]);

  const [activeAutocompleteRowId, setActiveAutocompleteRowId] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const container = e.currentTarget.closest('.entry-grid-container, .edit-form-container');
      if (!container) return;
      const focusableElements = Array.from(
        container.querySelectorAll('input, select')
      ) as HTMLElement[];
      const index = focusableElements.indexOf(e.currentTarget);
      if (index > -1 && index + 1 < focusableElements.length) {
        focusableElements[index + 1].focus();
      } else if (index === focusableElements.length - 1) {
        const saveBtn = container.querySelector('button.save-btn') as HTMLElement;
        if (saveBtn) saveBtn.focus();
      }
    }
  };

  // Edit Saved Entry State
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [minInvoiceAlertData, setMinInvoiceAlertData] = useState<{
    total: number;
    count: number;
    customerName?: string;
    context?: 'new' | 'edit' | 'deleteItem';
  } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    subMessage?: string;
    confirmButtonText: string;
    onConfirm: () => void;
  } | null>(null);
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

  const handleStartEdit = (entry: SalesEntry) => {
    setEditingEntryId(entry.id);
    if (entry.priceMode) {
      setInvoicePriceMode(entry.priceMode);
    }
    const grams = entry.pieceWeightKg ? Math.round(entry.pieceWeightKg * 1000) : 0;
    setEditFormData({
      productName: entry.productName,
      categoryName: entry.categoryName,
      quantity: String(entry.quantity),
      pieceWeightKg: String(grams),
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSaveEdit = (id: string) => {
    const qStr = parseArabicDigits(editFormData.quantity.trim());
    const wGramsStr = parseArabicDigits(editFormData.pieceWeightKg.trim());
    const name = editFormData.productName.trim();

    if (!name) {
      setErrorMessage('يرجى كتابة اسم المنتج المراد تعديله');
      return;
    }

    const q = parseInt(qStr, 10);
    const wGrams = parseFloat(wGramsStr);

    if (isNaN(q) || q <= 0) {
      setErrorMessage('يرجى إدخال عدد قطع صحيح أكبر من صفر');
      return;
    }
    if (isNaN(wGrams) || wGrams <= 0) {
      setErrorMessage('يرجى إدخال وزن قطعة صحيح بالغرام أكبر من صفر (مثال: 250)');
      return;
    }

    const pieceWeightKg = wGrams / 1000;
    const totalW = (q * wGrams) / 1000;

    // Get product to calculate carton quantity
    const prod = productsList.find(p => p.productName === name);
    const cq = Number(prod?.cartonQuantity) || 1;
    
    // Find old entry to get its unit
    const oldEntry = safeSavedEntries.find(e => e.id === id);
    const newEnteredQuantity = oldEntry?.entryUnit === 'carton' ? (q / cq) : q;

    // التحقق من أن القيم المحدثة منطقية قبل التمرير
    if (totalW <= 0 || isNaN(totalW)) {
      setErrorMessage('خطأ في حساب الوزن الإجمالي، يرجى التأكد من القيم المدخلة.');
      return;
    }

    // التحقق الصارم من شروط حفظ الفاتورة بعد التعديل (ألا يقل عن 3 أصناف ولا يقل عن 25,000 د.ع)
    // استثناء: عند إدخال أو تعديل الفاتورة من قبل الأدمن يتم رفع هذا الشرط بالكامل
    const isAdminUser = Boolean(currentUser?.isAdmin || currentUser?.role === 'admin');
    if (!isAdminUser && oldEntry) {
      const targetCustomerCode = oldEntry.customerCode ? String(oldEntry.customerCode).trim() : '';
      const targetCustomerName = oldEntry.customerName ? oldEntry.customerName.trim().toLowerCase() : '';

      const invoiceEntries = safeSavedEntries.filter(e => {
        const isSameDate = (e.dateString === oldEntry.dateString) || (!e.dateString && !oldEntry.dateString);
        const matchCode = targetCustomerCode && e.customerCode && String(e.customerCode).trim() === targetCustomerCode;
        const matchName = e.customerName && e.customerName.trim().toLowerCase() === targetCustomerName;
        return isSameDate && (matchCode || matchName);
      });

      // محاكاة الفاتورة بعد التعديل
      const simulatedEntries = invoiceEntries.map(e => {
        if (e.id === id) {
          return {
            ...e,
            productName: name,
            quantity: q,
            priceMode: e.priceMode || invoicePriceMode
          };
        }
        return e;
      });

      const simulatedUniqueProducts = new Set(simulatedEntries.map(e => e.productName)).size;
      const simulatedTotalPrice = simulatedEntries.reduce((sum, e) => {
        const p = productsList.find(prodItem => prodItem.productName === e.productName);
        const price = p ? (e.priceMode === 'wholesale' ? (p.wholesalePrice || 0) : (p.retailPrice || 0)) : 0;
        return sum + (price * e.quantity);
      }, 0);

      if (simulatedUniqueProducts < 3 || simulatedTotalPrice < 25000) {
        setMinInvoiceAlertData({
          total: simulatedTotalPrice,
          count: simulatedUniqueProducts,
          customerName: oldEntry.customerName,
          context: 'edit'
        });
        return;
      }
    }

    updateSalesEntry(id, {
      productName: name,
      categoryName: editFormData.categoryName,
      quantity: q,
      pieceWeightKg: pieceWeightKg,
      totalWeightKg: totalW,
      enteredQuantity: newEnteredQuantity,
    });

    setEditingEntryId(null);
    setSuccessMessage('تم تعديل المنتج ومزامنة البيانات بنجاح ✅');
    setErrorMessage(null);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCancelEdit = () => {
    setEditingEntryId(null);
  };

  const defaultCategory = DEFAULT_CATEGORIES_LIST[0] || 'قشطة';

  const getEffectivePieces = (quantityStr: string | number, productName: string, entryUnit?: 'piece' | 'carton'): number => {
    const q = typeof quantityStr === 'string' ? parseInt(parseArabicDigits(quantityStr.trim()), 10) || 0 : quantityStr;
    if (entryUnit === 'carton') {
      const prod = productsList.find(p => p.productName === productName);
      const cartonQuantity = Number(prod?.cartonQuantity) || 1;
      return q * cartonQuantity;
    }
    return q;
  };

  // Active delegate details
  const getProductCode = (productName: string) => {
    const match = productSuggestions.find(p => p.name === productName);
    return match ? match.code : '000';
  };

  const getCartonsDisplay = (productName: string, quantity: number) => {
    const productItem = productsList.find(p => p.productName === productName);
    if (productItem && productItem.cartonQuantity) {
      const cq = Number(productItem.cartonQuantity);
      if (cq > 0 && quantity >= cq) {
        const cartons = Math.floor(quantity / cq);
        const remainder = quantity % cq;
        return cartons + (remainder > 0 ? ` كرتون و ${remainder} ق` : ' كرتون');
      }
    }
    return null;
  };

  const activeDelegateName = currentUser?.isAdmin ? selectedDelegate : currentUser?.name;
  const isRafat = activeDelegateName === 'رأفت جمال';
  const isCompleted = completedDelegates[activeDelegateName || ''] || false;
  
  // حماية آمنة للبحث
  const safeDelegateAccounts = Array.isArray(delegateAccounts) ? delegateAccounts : [];
  const safeDelegateTargets = Array.isArray(delegateTargets) ? delegateTargets : [];
  const safeSavedEntries = Array.isArray(savedEntries) ? savedEntries : [];
  const uniqueCustomerNames = Array.from(new Set(safeSavedEntries.map(e => e.customerName).filter(Boolean))).sort();
  const activeAccountObj = safeDelegateAccounts.find((a) => a.delegateName === activeDelegateName);

  // Active delegate targets
  const delCategoryTargets = safeDelegateTargets.filter((t) => t.delegateName === activeDelegateName);
  const dailyTargetKg = delCategoryTargets.reduce((sum, t) => sum + t.dailyTargetWeightKg, 0) || 800;

  // Saved metrics for active delegate
  const totalSavedWeight = safeSavedEntries.reduce((sum, e) => sum + e.totalWeightKg, 0);
  const totalSavedQuantity = safeSavedEntries.reduce((sum, e) => sum + e.quantity, 0);
  const totalSavedPrice = safeSavedEntries.reduce((sum, e) => {
    const prod = productsList.find(p => p.productName === e.productName);
    const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
    return sum + (price * e.quantity);
  }, 0);

  const dailyPct = dailyTargetKg > 0 ? (totalSavedWeight / dailyTargetKg) * 100 : 0;

  const { modalTotalWeight, modalTotalPrice } = useMemo(() => {
    const delegateEntries = safeSavedEntries.filter(e => e.delegateName === activeDelegateName);
    const weight = delegateEntries.reduce((sum, e) => sum + e.totalWeightKg, 0);
    const price = delegateEntries.reduce((sum, e) => {
      const prod = productsList.find(p => p.productName === e.productName);
      const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
      return sum + (price * e.quantity);
    }, 0);
    return { modalTotalWeight: weight, modalTotalPrice: price };
  }, [safeSavedEntries, activeDelegateName, productsList]);

  // Initialize default 6 rows with unique keys
  const [gridRows, setGridRows] = useState<GridRow[]>(() => {
    const saved = localStorage.getItem('entry_draft_gridRows');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return Array.from({ length: 6 }, (_, i) => ({
      id: `row_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
      category: defaultCategory,
      pieceWeight: '',
      quantity: '',
      productName: '',
    }));
  });

  useEffect(() => {
    localStorage.setItem('entry_draft_customerName', customerName);
    localStorage.setItem('entry_draft_customerCode', customerCode);
    localStorage.setItem('entry_draft_customerAddress', customerAddress);
    localStorage.setItem('entry_draft_gridRows', JSON.stringify(gridRows));
  }, [customerName, customerCode, customerAddress, gridRows]);

  const currentGridTotalKg = useMemo(() => {
    return gridRows.reduce((sum, row) => {
      const q = getEffectivePieces(row.quantity, row.productName, row.entryUnit || 'piece');
      const g = parseFloat(parseArabicDigits(row.pieceWeight.trim())) || 0;
      return sum + (q * g) / 1000;
    }, 0);
  }, [gridRows]);

  const handleRowChange = (id: string, field: keyof GridRow, value: string) => {
    const normalizedValue =
      field === 'pieceWeight' || field === 'quantity' ? parseArabicDigits(value) : value;

    setGridRows((prev) => {
      const rowIndex = prev.findIndex((r) => r.id === id);
      const updated = prev.map((row) => (row.id === id ? { ...row, [field]: normalizedValue } : row));

      if (rowIndex >= prev.length - 2 && normalizedValue.trim().length > 0) {
        const isLastRowFilled = updated[updated.length - 1].productName.trim() !== '' ||
                                updated[updated.length - 1].quantity.trim() !== '' ||
                                updated[updated.length - 1].pieceWeight.trim() !== '';
        
        if (rowIndex === prev.length - 1 || (rowIndex === prev.length - 2 && isLastRowFilled)) {
          updated.push({
            id: `row_${Date.now()}_${updated.length}_${Math.random().toString(36).substring(2, 6)}`,
            category: defaultCategory,
            pieceWeight: '',
            quantity: '',
            productName: '',
          });
        }
      }

      return updated;
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleAddMoreRows = () => {
    setGridRows((prev) => [
      ...prev,
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `row_${Date.now()}_${prev.length + i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      })),
    ]);
  };

  const handleClearGrid = () => {
    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_clear_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );
    setCustomerName('');
    setCustomerCode('');
    setCustomerAddress('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handlePrintInvoice = (customerName: string, entries: typeof safeSavedEntries) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('الرجاء السماح بالنوافذ المنبثقة (Pop-ups) للطباعة');
      return;
    }

    const delegateName = entries[0]?.delegateName || 'غير محدد';
    const customerAddress = entries[0]?.customerAddress || '';
    const invoiceType = entries[0]?.priceMode === 'wholesale' ? 'جملة' : 'مفرد';
    const actualCustomerName = customerName.split(' | الزبون: ').pop() || '';
    const customerCode = customerName.includes('كود:') ? customerName.split('كود: ')[1].split(' |')[0] : 'غير محدد';
    
    let rowsHtml = '';
    let totalPrice = 0;
    let totalCartons = 0;
    let totalPieces = 0;
    
    entries.forEach((e, idx) => {
      const prod = productsList.find(p => p.productName === e.productName);
      const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
      const rowPrice = price * e.quantity;
      totalPrice += rowPrice;
      
      const cartonQty = Number(prod?.cartonQuantity) || 1;
      const isCartonOrMore = e.quantity >= cartonQty;
      
      totalCartons += (e.quantity / cartonQty);
      totalPieces += e.quantity;
      
      let quantityText = '';
      if (isCartonOrMore) {
        const cartons = (e.quantity / cartonQty).toFixed(2);
        const displayCartons = cartons.endsWith('.00') ? cartons.slice(0, -3) : cartons;
        quantityText = `${formatWithCommas(parseFloat(displayCartons))} كارتون<br><span style="font-size: 10px;">(${formatWithCommas(e.quantity)} قطعة)</span>`;
      } else {
        quantityText = `${formatWithCommas(e.quantity)} قطعة`;
      }

      rowsHtml += `
        <tr>
          <td>${idx + 1}</td>
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
          <title>فاتورة - ${actualCustomerName}</title>
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
            .info-item.spaced-bottom { margin-bottom: 5px; }
            .info-label { font-weight: bold; margin-left: 4px; }
            
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 12px; page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            th, td { border-bottom: 1px dashed #ccc; padding: 4px 2px; text-align: center; }
            th { font-weight: bold; border-bottom: 1px solid #000; }
            td.text-right { text-align: right; }
            td.text-left { text-align: left; }
            
            .totals-container { display: flex; justify-content: space-between; border-top: 1px solid #000; padding-top: 6px; margin-top: 6px; font-size: 14px; font-weight: bold; }
            .print-btn { display: block; width: 100%; padding: 10px; background: #059669; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: bold; cursor: pointer; margin-bottom: 20px; }
          </style>
        </head>
        <body class="invoice-print-view">
          <button class="print-btn" onclick="window.print()">🖨️ طباعة الفاتورة الآن</button>
          
          <div style="border: 2px solid #000; padding: 6px; margin-bottom: 10px;">
            <div class="header-container">
              <img src="${logoImg}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />
            <h1>تطبيق ياسر للمبيعات | كالة فرع صلاح الدين</h1>
            <div class="header-customer-row">
              <span class="header-customer-name">اسم الزبون: ${actualCustomerName}</span>
              <span class="header-invoice-date">${entries[0]?.timestamp ? new Date(entries[0].timestamp).toLocaleString('en-GB') : new Date().toLocaleString('en-GB')}</span>
            </div>
          </div>
          
          <div class="info-container">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <div class="info-item">
                <span class="info-label">اسم المندوب:</span>
                <span>${delegateName}</span>
              </div>
              <div class="info-item" style="font-size: 10px;">
                <span>(${customerCode})</span>
              </div>
            </div>
            ${customerAddress ? `
            <div class="info-item" style="margin-top: 3px;">
              <span class="info-label">عنوان الزبون:</span>
              <span>${customerAddress}</span>
            </div>` : ''}
          </div>
          
          <hr class="divider" />
          
          <table>
            <thead>
              <tr>
                <th style="width: 5%">#</th>
                <th style="width: 45%" class="text-right">المنتج</th>
                <th style="width: 25%">الكمية</th>
                <th style="width: 25%" class="text-left">السعر (${invoiceType})</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          
          <div style="border: 1px solid #000; padding: 4px; font-size: 10px; font-weight: bold; text-align: center; margin-top: 8px;">
            ملاحظة: قد تختلف الكميات اعلاه لنفاد المخزون.
          </div>
          
                    <div style="border: 1px solid #009; padding: 3px; font-size: 9px; font-weight: bold; text-align: center; margin-top: 8px;">
            رقم المبيعات    :   07718458337
          </div>

          </div>
          
          <script>
            window.onload = function() { 
              setTimeout(() => {
                window.print(); 
              }, 500);
            }
          </script>
        </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleSaveGrid = () => {
    if (isCompleted) {
      setErrorMessage('لا يمكن حفظ فواتير جديدة بعد إكمال مبيعات اليوم');
      return;
    }
    const trimmedCustomerName = customerName.trim();
    if (!trimmedCustomerName) {
      setErrorMessage('تنبيه: لم تقم بإدخال اسم الزبون!');
      return;
    }
    
    if (!invoicePriceMode) {
      setErrorMessage('تنبيه: يرجى اختيار نوع السعر (مفرد أو جملة) قبل الحفظ');
      return;
    }

    const itemsToSave: {
      productName: string;
      categoryName: string;
      quantity: number;
      entryUnit?: 'piece' | 'carton';
      enteredQuantity?: number;
      pieceWeightKg: number;
      totalWeightKg: number;
      delegateName: string;
      dateString: string;
      customerName: string;
      customerCode?: string;
      customerAddress?: string;
      priceMode?: 'retail' | 'wholesale';
      invoiceId?: string;
    }[] = [];

    let invalidFound = false;

    const invoiceId = Date.now().toString() + "_" + Math.random().toString(36).substr(2, 5);

    for (let i = 0; i < gridRows.length; i++) {
      const row = gridRows[i];
      const name = row.productName.trim();
      const qStr = parseArabicDigits(row.quantity.trim());
      const wStr = parseArabicDigits(row.pieceWeight.trim());

      if (name.length > 0 || qStr.length > 0 || wStr.length > 0) {
        const enteredQ = parseInt(qStr, 10);
        const effectiveQ = getEffectivePieces(qStr, name, row.entryUnit || 'piece');
        const wGrams = parseFloat(wStr);
        const cat = row.category || defaultCategory;

        if (!name) {
          setErrorMessage(`يرجى كتابة اسم المنتج في الصف رقم ${i + 1}`);
          invalidFound = true;
          break;
        }
        if (isNaN(enteredQ) || enteredQ <= 0) {
          setErrorMessage(`يرجى كتابة إدخال صحيح في الصف رقم ${i + 1}`);
          invalidFound = true;
          break;
        }
        if (isNaN(wGrams) || wGrams <= 0) {
          setErrorMessage(`يرجى كتابة وزن قطعة صحيح بالغرام في الصف رقم ${i + 1} (مثال: 250)`);
          invalidFound = true;
          break;
        }

        const pieceWeightKg = wGrams / 1000;
        const totalW = (effectiveQ * wGrams) / 1000;
        if (!trimmedCustomerName) {
          setErrorMessage('يرجى إدخال اسم الزبون قبل الحفظ');
          invalidFound = true;
          break;
        }

        itemsToSave.push({
          productName: name,
          categoryName: cat,
          quantity: effectiveQ,
          entryUnit: row.entryUnit || 'piece',
          enteredQuantity: enteredQ,
          pieceWeightKg: pieceWeightKg,
          totalWeightKg: totalW,
          delegateName: activeDelegateName || 'عام',
          dateString: new Date().toISOString().split('T')[0],
          customerName: trimmedCustomerName,
          customerCode: String(customerCode || '').trim(),
          customerAddress: String(customerAddress || '').trim(),
          priceMode: invoicePriceMode,
          invoiceId: invoiceId
        });
      }
    }

    if (invalidFound) return;

    // التحقق الصارم من شروط حفظ الفاتورة (للفواتير الجديدة وحتى بعد التعديل أو الإضافة):
    // 1. لا تحفظ فاتورة فيها عدد المنتجات أقل من 3
    // 2. لا تحفظ فاتورة يقل مجموعها عن 25,000 د.ع
    // استثناء: عند إدخال الفاتورة من قبل الأدمن يتم رفع هذا الشرط بالكامل
    const isAdminUser = Boolean(currentUser?.isAdmin || currentUser?.role === 'admin');
    if (!isAdminUser) {
      const existingEntriesForCustomer = safeSavedEntries.filter(e => {
        const isToday = e.dateString === new Date().toISOString().split('T')[0] || !e.dateString;
        const matchCustomer = (customerCode && e.customerCode && String(e.customerCode).trim() === String(customerCode).trim()) ||
                              (e.customerName && e.customerName.trim().toLowerCase() === trimmedCustomerName.toLowerCase());
        return isToday && matchCustomer;
      });

      const isAddingToExisting = existingEntriesForCustomer.length > 0;

      const allProductNames = [
        ...existingEntriesForCustomer.map(e => e.productName),
        ...itemsToSave.map(e => e.productName)
      ];
      const totalUniqueProducts = new Set(allProductNames).size;

      const existingTotal = existingEntriesForCustomer.reduce((sum, e) => {
        const prod = productsList.find(p => p.productName === e.productName);
        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
        return sum + (price * e.quantity);
      }, 0);

      const newItemsTotal = itemsToSave.reduce((sum, e) => {
        const prod = productsList.find(p => p.productName === e.productName);
        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
        return sum + (price * e.quantity);
      }, 0);

      const combinedTotalPrice = existingTotal + newItemsTotal;

      if (totalUniqueProducts < 3 || combinedTotalPrice < 25000) {
        setMinInvoiceAlertData({
          total: combinedTotalPrice,
          count: totalUniqueProducts,
          customerName: trimmedCustomerName,
          context: isAddingToExisting ? 'edit' : 'new'
        });
        return;
      }
    }

    saveSalesEntries(itemsToSave);
    setErrorMessage(null);

    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_saved_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );

    setCustomerName('');
    setCustomerCode('');
    setCustomerAddress('');
    setSuccessMessage(`تم حفظ الإدخال بنجاح (${itemsToSave.length} منتجات)`);
    setErrorMessage(null);
  };


    const formatEntriesForExport = (entries: typeof safeSavedEntries) => {
        const headers = ['تاريخ الادخال', 'المندوب', 'اسم الزبون', 'كود الزبون', 'اسم المنتج', 'الصنف', 'كود المنتج', 'عدد القطع', 'وزن القطعة (كجم)', 'الوزن الكلي (كجم)', 'نوع الفاتورة'];

        const getCustomerSortKey = (entry: typeof safeSavedEntries[0]) => {
            const rawCode = entry.customerCode ? String(entry.customerCode).trim() : '';
            if (rawCode) return rawCode;
            const rawName = entry.customerName ? entry.customerName.trim() : '';
            return rawName || 'بدون كود';
        };

        // Sort: Delegate Name (ASC Arabic), then Customer Code / Key (ASC Arabic numeric), then timestamp
        const sortedEntries = [...entries].sort((a, b) => {
            const delegateA = (a.delegateName || 'غير محدد').trim();
            const delegateB = (b.delegateName || 'غير محدد').trim();
            const delCompare = delegateA.localeCompare(delegateB, 'ar');
            if (delCompare !== 0) return delCompare;

            const keyA = getCustomerSortKey(a);
            const keyB = getCustomerSortKey(b);
            const keyCompare = keyA.localeCompare(keyB, 'ar', { numeric: true });
            if (keyCompare !== 0) return keyCompare;

            return (a.timestamp || 0) - (b.timestamp || 0);
        });

        const worksheetData: any[] = [headers];

        let lastDelegate = '';
        let lastCustomerKey = '';

        sortedEntries.forEach((entry, index) => {
            const delegate = (entry.delegateName || 'غير محدد').trim();
            const customerKey = getCustomerSortKey(entry);
            const customerCode = entry.customerCode ? String(entry.customerCode).trim() : 'بدون كود';

            // Add separator row for new delegate
            if (index > 0 && delegate !== lastDelegate) {
                worksheetData.push(Array(headers.length).fill('')); 
            }
            // Add separator row for new customer (grouping by customer code)
            else if (index > 0 && customerKey !== lastCustomerKey) {
                worksheetData.push(Array(headers.length).fill(''));
            }

            worksheetData.push([
                entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-GB') : '',
                delegate,
                entry.customerName || 'بدون اسم زبون',
                customerCode,
                entry.productName,
                entry.categoryName,
                getProductCode(entry.productName),
                entry.quantity.toString(),
                entry.pieceWeightKg.toString(),
                entry.totalWeightKg.toString(),
                entry.priceMode === 'wholesale' ? 'جملة' : 'مفرد'
            ]);

            lastDelegate = delegate;
            lastCustomerKey = customerKey;
        });

        return worksheetData;
    };

    const handleExportCSV = () => {
        if (safeSavedEntries.length === 0) {
            window.alert('لا توجد بيانات لتصديرها');
            return;
        }

        const worksheetData = formatEntriesForExport(safeSavedEntries);
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'SalesData');
        XLSX.writeFile(workbook, `sales_entries_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const handleCustomExport = () => {
        if (selectedDelegatesForExport.size === 0) {
            window.alert('يرجى اختيار مندوب واحد على الأقل');
            return;
        }

        const filtered = safeSavedEntries.filter(e => selectedDelegatesForExport.has(e.delegateName || 'غير محدد'));
        if (filtered.length === 0) {
            window.alert('لا توجد بيانات للمندوبين المحددين لتصديرها');
            return;
        }

        const worksheetData = formatEntriesForExport(filtered);
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'SalesData');
        XLSX.writeFile(workbook, `sales_entries_custom_${new Date().toISOString().split('T')[0]}.xlsx`);
        
        setShowCustomExportModal(false);
    };

  const filteredSavedEntries = safeSavedEntries.filter(
    (e) => {
      const matchSearch = !customerSearchTerm || (e.customerName && e.customerName.includes(customerSearchTerm));
      const matchDelegate = savedEntriesFilterDelegate === 'الكل' || e.delegateName === savedEntriesFilterDelegate;
      const matchPrice = savedEntriesFilterPriceMode === 'الكل' || e.priceMode === savedEntriesFilterPriceMode;
      return matchSearch && matchDelegate && matchPrice;
    }
  );
  
  const uniqueDelegatesForFilter = Array.from(new Set(safeSavedEntries.map(e => e.delegateName || 'غير محدد'))).sort();


  const groupedEntries: Record<string, typeof safeSavedEntries> = {};
  filteredSavedEntries.forEach((entry) => {
    let groupKey = entry.customerName || 'بدون اسم زبون';
    if (currentUser?.isAdmin && selectedDelegate === 'الكل') {
      groupKey = `${entry.delegateName || 'مندوب غير محدد'} | الزبون: ${groupKey}`;
    }
    if (!groupedEntries[groupKey]) {
      groupedEntries[groupKey] = [];
    }
    groupedEntries[groupKey].push(entry);
  });

  const delegateStats: Record<string, { retail: Set<string>, wholesale: Set<string>, total: Set<string> }> = {};
  safeSavedEntries.forEach((entry) => {
    const delegate = entry.delegateName || 'غير محدد';
    const customer = entry.customerName || 'بدون اسم زبون';
    if (!delegateStats[delegate]) {
      delegateStats[delegate] = { retail: new Set(), wholesale: new Set(), total: new Set() };
    }
    if (entry.priceMode === 'wholesale') {
      delegateStats[delegate].wholesale.add(customer);
    } else {
      delegateStats[delegate].retail.add(customer);
    }
    delegateStats[delegate].total.add(customer);
  });

  const isPrivilegedRole = currentUser?.isAdmin || currentUser?.role === 'dataEntry' || currentUser?.username?.toLowerCase() === 'rafatdata';

  // 12-hour formatted auto lock time in English (e.g. 15:00 -> 3:00 PM)
  const formattedLockTime12h = useMemo(() => {
    if (!targetAutoLockTime) return '';
    const [hStr, mStr] = targetAutoLockTime.split(':');
    const h = parseInt(hStr || '0', 10);
    const m = mStr || '00';
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
  }, [targetAutoLockTime]);

  // First invoice of each delegate today (for Admin & Data Entry top section)
  const delegateFirstInvoicesToday = useMemo(() => {
    const todayDate = new Date();
    const todayStr = todayDate.toISOString().split('T')[0];
    const map: Record<string, {
      firstTimestamp: number | null;
      firstTimeFormatted: string;
      firstDateFormatted: string;
      isReset: boolean;
      totalInvoicesToday: number;
    }> = {};

    delegatesList.forEach((del) => {
      const isCompleted = !!completedDelegates[del.trim()];
      const isReset = isCompleted || isPastClosing;

      const delEntries = safeSavedEntries.filter(
        (e) => (e.dateString === todayStr || (!e.dateString && e.timestamp)) && (e.delegateName || '').trim() === del.trim()
      );

      const validTimestamps = delEntries
        .map((e) => e.timestamp)
        .filter((t): t is number => typeof t === 'number' && t > 0);

      const firstTimestamp = validTimestamps.length > 0 ? Math.min(...validTimestamps) : null;

      let firstTimeFormatted = '---';
      let firstDateFormatted = '---';
      if (firstTimestamp) {
        const d = new Date(firstTimestamp);
        // Format Date in English YYYY-MM-DD
        firstDateFormatted = d.toLocaleDateString('en-CA');
        // Format Time in 12-hour format in English (e.g. 1:05:20 PM - 1 instead of 13)
        firstTimeFormatted = d.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
      }

      const uniqueInvoicesCount = new Set(delEntries.map(e => e.customerCode || e.customerName || e.id)).size;

      map[del] = {
        firstTimestamp,
        firstTimeFormatted,
        firstDateFormatted,
        isReset,
        totalInvoicesToday: uniqueInvoicesCount,
      };
    });

    return map;
  }, [delegatesList, safeSavedEntries, completedDelegates, isPastClosing]);

  // Sorted list of delegates from earliest first invoice time to latest (furthest) time today
  const sortedDelegatesByFirstInvoice = useMemo(() => {
    return [...delegatesList].sort((a, b) => {
      const infoA = delegateFirstInvoicesToday[a];
      const infoB = delegateFirstInvoicesToday[b];

      const timeA = infoA?.firstTimestamp;
      const timeB = infoB?.firstTimestamp;

      // Both have a recorded first invoice: sort earliest to latest (ascending)
      if (timeA && timeB) {
        if (timeA !== timeB) return timeA - timeB;
        return a.localeCompare(b, 'ar');
      }

      // Delegate with an invoice comes before one without
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;

      // Neither has an invoice yet: sort alphabetically
      return a.localeCompare(b, 'ar');
    });
  }, [delegatesList, delegateFirstInvoicesToday]);

  const currentInvoiceTotalWeight = gridRows.reduce((sum, row) => {
    const qVal = getEffectivePieces(row.quantity, row.productName, row.entryUnit || 'piece');
    const gVal = parseFloat(parseArabicDigits(row.pieceWeight.trim())) || 0;
    return sum + ((qVal * gVal) / 1000);
  }, 0);

  const currentInvoiceTotalPrice = gridRows.reduce((sum, row) => {
    const qVal = getEffectivePieces(row.quantity, row.productName, row.entryUnit || 'piece');
    const prod = productsList.find(p => p.productName === row.productName);
    const price = prod ? (invoicePriceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
    return sum + (qVal * price);
  }, 0);

  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="p-3 sm:p-4 max-w-5xl mx-auto space-y-4 dir-rtl text-slate-900">
      <DelegateLoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      {/* Summary Bar - Persistent at top of content area */}
      <div className="sticky top-0 z-40 bg-emerald-700 text-white p-2 rounded-lg shadow-md border border-emerald-900 flex justify-between items-center mb-3 w-full max-w-full">
        <div className="text-center px-1 flex-1 min-w-0">
          <div className="text-[9px] opacity-90 truncate">إجمالي المبيعات اليوم</div>
          <div className="font-black text-xs truncate">{formatWithCommas(totalSavedPrice, true)}</div>
        </div>
        <div className="text-center px-1 flex-1 min-w-0 border-r border-emerald-800">
          <div className="text-[9px] opacity-90 truncate">إجمالي الوزن اليوم</div>
          <div className="font-black text-xs truncate">{formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)), true)} كجم</div>
        </div>
      </div>

      {/* 1. New Top Section: Representatives First Invoice Timestamps & Status (Admin & Data Entry Only) */}
      {isPrivilegedRole && (
        <div className={`p-3 sm:p-4 rounded-2xl border-2 shadow-md space-y-3 ${
          isDarkMode 
            ? 'bg-slate-900 border-emerald-500/40 text-white' 
            : 'bg-white border-emerald-300 text-slate-900'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b pb-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-600 text-white shadow-xs">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-black flex items-center gap-1.5 flex-wrap">
                  <span>مواعيد بدء مبيعات المندوبين اليوم (توقيت أول فاتورة)</span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold border border-slate-300 dark:border-slate-600" dir="ltr">
                    {new Date().toLocaleDateString('en-CA')}
                  </span>
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                  مرتبة من أول توقيت فاتورة بدأ بها المندوب إلى أبعد توقيت • يتم تصفير العداد فور إغلاق المبيعات ({formattedLockTime12h || targetAutoLockTime}) أو عند ضغط المندوب على "أكملت مبيعات اليوم".
                </p>
              </div>
            </div>

            {isPastClosing ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40">
                <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                تم تجاوز وقت الإغلاق (تم التصفير)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                متابعة حية للبدء
              </span>
            )}
          </div>

          {/* Grid of Delegates (Sorted from earliest first invoice to furthest) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {sortedDelegatesByFirstInvoice.map((del, index) => {
              const info = delegateFirstInvoicesToday[del] || {
                firstTimestamp: null,
                firstTimeFormatted: '---',
                firstDateFormatted: '---',
                isReset: false,
                totalInvoicesToday: 0
              };

              const rank = info.firstTimestamp ? index + 1 : null;

              return (
                <div
                  key={`del-start-${del}`}
                  className={`p-2.5 rounded-xl border flex flex-col justify-between transition-all ${
                    info.isReset
                      ? isDarkMode
                        ? 'bg-slate-800/50 border-slate-700/60 opacity-80'
                        : 'bg-slate-100 border-slate-200 opacity-80'
                      : info.firstTimestamp
                      ? isDarkMode
                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-100 shadow-sm'
                        : 'bg-emerald-50/80 border-emerald-300 text-emerald-950 shadow-sm'
                      : isDarkMode
                        ? 'bg-slate-800/70 border-slate-700 text-slate-300'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1 min-w-0">
                      {rank && (
                        <span 
                          className="text-[9px] font-black w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs" 
                          title={`المرتبة ${rank} في بدء المبيعات`}
                        >
                          {rank}
                        </span>
                      )}
                      <span className="font-black text-xs truncate max-w-[90px]" title={del}>
                        {del}
                      </span>
                    </div>
                    {info.isReset ? (
                      <span className="text-[9px] font-black px-1 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        مصفّر
                      </span>
                    ) : info.firstTimestamp ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0"></span>
                    )}
                  </div>

                  <div className="mt-1">
                    {info.isReset ? (
                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        <RotateCcw className="w-3 h-3" />
                        <span>تم تصفير العداد</span>
                      </div>
                    ) : info.firstTimestamp ? (
                      <div className="space-y-1">
                        <div className="text-[9px] text-slate-500 dark:text-slate-400 font-bold">توقيت أول فاتورة:</div>
                        <div className="flex flex-col gap-0.5">
                          {/* التاريخ بالانكليزي */}
                          <div className="font-mono font-bold text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1" dir="ltr">
                            <Calendar className="w-3 h-3 text-emerald-500 shrink-0" />
                            <span>{info.firstDateFormatted}</span>
                          </div>
                          {/* التوقيت بالانكليزي بنظام 12 ساعة (الساعة 1 تكتب 1 وليس 13) */}
                          <div className="font-mono font-black text-xs text-emerald-600 dark:text-emerald-300 flex items-center gap-1" dir="ltr">
                            <Clock className="w-3 h-3 text-emerald-500 shrink-0" />
                            <span>{info.firstTimeFormatted}</span>
                          </div>
                        </div>
                        <div className="text-[9px] font-extrabold text-slate-600 dark:text-slate-300 pt-0.5">
                          {info.totalInvoicesToday} فواتير مسجلة
                        </div>
                      </div>
                    ) : (
                      <div className="text-[10px] font-bold text-slate-400 py-1">
                        بانتظار أول فاتورة ⏳
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}




      {/* Messages */}
      {errorMessage && (
        <div className="p-3 bg-red-900 text-white font-bold text-xs rounded-xl border border-red-500 text-center flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-300" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-900 text-white font-bold text-xs rounded-xl border border-emerald-400 text-center flex items-center justify-center gap-2">
          <Check className="w-4 h-4 text-emerald-300" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Daily Stats Summary for Admin */}
      {currentUser?.isAdmin && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-800 text-white p-3 rounded-xl shadow-lg border border-slate-600">
            <div className="text-[10px] text-slate-400 font-bold">عدد الفواتير اليوم</div>
            <div className="text-xl font-black">{new Set(safeSavedEntries.filter(e => e.dateString === new Date().toISOString().split('T')[0]).map(getInvoiceKey)).size}</div>
          </div>
          <div className="bg-slate-800 text-white p-3 rounded-xl shadow-lg border border-slate-600">
            <div className="text-[10px] text-slate-400 font-bold">إجمالي المبيعات اليوم</div>
            <div className="text-xl font-black">{formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)), true)} كجم</div>
          </div>
        </div>
      )}

      {/* Saved Sales List Table */}
      <div className="space-y-2 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
             فواتير اليوم :  ({new Set(safeSavedEntries.filter(e => e.dateString === new Date().toISOString().split('T')[0]).map(e => e.customerName)).size})
            </h3>
            
            <div className="flex bg-slate-200 rounded-lg p-0.5 border border-slate-300 mr-2">
              <button
                type="button"
                onClick={() => setSavedEntriesFilterPriceMode('الكل')}
                className={`px-3 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-all ${savedEntriesFilterPriceMode === 'الكل' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => setSavedEntriesFilterPriceMode('retail')}
                className={`px-3 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-all ${savedEntriesFilterPriceMode === 'retail' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                مفرد
              </button>
              <button
                type="button"
                onClick={() => setSavedEntriesFilterPriceMode('wholesale')}
                className={`px-3 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-all ${savedEntriesFilterPriceMode === 'wholesale' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                جملة
              </button>
            </div>

            {currentUser?.isAdmin && safeSavedEntries.length > 0 && (
              <>
                <button
                    onClick={handleExportCSV}
                    className="px-2.5 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg border border-blue-300 flex items-center gap-1.5 text-xs font-bold transition-colors shadow-sm cursor-pointer"
                    title="تصدير البيانات كملف Excel"
                >
                    <Download className="w-4 h-4" />
                    <span>تصدير الادخالات</span>
                </button>
                <button
                    onClick={() => setShowCustomExportModal(true)}
                    className="px-2.5 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg border border-purple-300 flex items-center gap-1.5 text-xs font-bold transition-colors shadow-sm cursor-pointer"
                >
                    <Download className="w-4 h-4" />
                    <span>تصدير مخصص</span>
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="بحث باسم الزبون..."
              value={customerSearchTerm}
              onChange={(e) => setCustomerSearchTerm(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-64"
            />
            {safeSavedEntries.length > 0 && (
              <span className="text-xs font-bold text-emerald-700 shrink-0">
                الإجمالي: {formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)), true)} كجم
              </span>
            )}
          </div>
        </div>

        {/* Delegate Filter Buttons for Admin */}
        {currentUser?.isAdmin && uniqueDelegatesForFilter.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
            <span className="text-xs font-bold text-slate-700">تصفية حسب المندوب:</span>
            <button
              onClick={() => setSavedEntriesFilterDelegate('الكل')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${savedEntriesFilterDelegate === 'الكل' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
            >
              الكل
            </button>
            {uniqueDelegatesForFilter.map(delegate => (
              <button
                key={`filter_${delegate}`}
                onClick={() => setSavedEntriesFilterDelegate(delegate)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${savedEntriesFilterDelegate === delegate ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                {delegate}
              </button>
            ))}
          </div>
        )}

        {safeSavedEntries.length === 0 ? (
          <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl text-center text-xs text-slate-600 font-bold">
            لا توجد مبيعات محفوظة اليوم
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedEntries)
              .sort(([, entriesA], [, entriesB]) => {
                const timeA = entriesA[0]?.timestamp || (entriesA[0]?.dateString ? new Date(entriesA[0].dateString).getTime() : 0);
                const timeB = entriesB[0]?.timestamp || (entriesB[0]?.dateString ? new Date(entriesB[0].dateString).getTime() : 0);
                if (timeA !== timeB) return timeA - timeB; // Sort by entry time (oldest first)
                return (entriesA[0]?.id || '').localeCompare(entriesB[0]?.id || '');
              })
              .map(([customerName, entries]) => (
              <div key={customerName} className={`invoice-card border-2 rounded-xl p-0 shadow-md overflow-hidden ${
                (isDarkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-400')
              }`}>
                <h4 className={`font-extrabold text-sm mb-0 p-3 border-b flex flex-col gap-2 rounded-t-xl ${isDarkMode ? 'bg-slate-700/80 border-slate-600 text-slate-100' : 'bg-slate-100/80 border-slate-200 text-slate-900'}`}>
                  {/* Row 1: Green Indicator + Code + Customer Name AND Actions (Edit, Print, Delete) */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span className="bg-slate-200 dark:bg-slate-600 text-[10px] font-black px-2 py-0.5 rounded border border-slate-300 dark:border-slate-500 shrink-0">
                        {entries[0]?.customerCode || '---'}
                      </span>
                      <span className="font-black text-sm truncate">
                        {currentUser?.isAdmin && selectedDelegate === 'الكل' ? `الزبون: ${customerName.split(' | الزبون: ').pop()}` : `الزبون: ${customerName}`}
                      </span>
                    </div>

                    {/* ازرار تعديل وطباعة ومسح امام اسم الزبون */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isCompleted && (
                        <button
                          type="button"
                          onClick={() => { 
                            setPrefilledEntryData({ 
                              customerName: entries[0].customerName, 
                              customerCode: entries[0].customerCode || '', 
                              customerAddress: entries[0].customerAddress || '',
                              customerInvoiceType: entries[0].priceMode === 'wholesale' ? 'جملة' : 'مفرد',
                              lastInvoiceToday: { priceMode: entries[0].priceMode },
                              isEditing: true
                            });
                            setShowQuickAdd(true);
                            setActiveTab('products');
                          }}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${isDarkMode ? 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-800 border-emerald-700' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200 hover:text-emerald-800 border-emerald-200'}`}
                          title="تعديل الفاتورة / إضافة مواد"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePrintInvoice(customerName, entries)}
                        className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${isDarkMode ? 'bg-blue-900/50 text-blue-400 hover:bg-blue-800 border-blue-700' : 'bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-800 border-blue-200'}`}
                        title="طباعة الفاتورة"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      {!isCompleted && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteConfirmation({
                              isOpen: true,
                              title: 'حذف الفاتورة بالكامل',
                              message: 'هل تريد حذف هذه الفاتورة ؟',
                              subMessage: `سيتم حذف جميع إدخالات فاتورة الزبون (${customerName}) نهائياً (${entries.length} سجل).`,
                              confirmButtonText: 'نعم، حذف الفاتورة',
                              onConfirm: () => {
                                entries.forEach(e => deleteSalesEntry(e.id));
                                setDeleteConfirmation(null);
                              }
                            });
                          }}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${isDarkMode ? 'bg-red-900/50 text-red-400 hover:bg-red-800 border-red-700' : 'bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 border-red-200'}`}
                          title="مسح / حذف الفاتورة بالكامل"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Grid Layout for Invoice Type & Metadata (Representative, Weight, Total) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] pt-2 border-t border-slate-200/70 dark:border-slate-600/70">
                    {/* 1. نوع الفاتورة: مفرد / جملة */}
                    <div className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg border font-bold text-center ${
                      entries[0]?.priceMode === 'wholesale'
                        ? 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
                        : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                    }`}>
                      {entries[0]?.priceMode === 'wholesale' ? <Package className="w-3.5 h-3.5 shrink-0" /> : <ShoppingCart className="w-3.5 h-3.5 shrink-0" />}
                      <span className="truncate">{entries[0]?.priceMode === 'wholesale' ? 'فاتورة جملة' : 'فاتورة مفرد'}</span>
                    </div>

                    {/* 2. اسم المندوب وتوقيت الفاتورة */}
                    <div className={`flex items-center justify-between sm:justify-center gap-1.5 py-1 px-2 rounded-lg border font-bold ${
                      isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-600' : 'bg-slate-200 text-slate-900 border-slate-300'
                    }`}>
                      <div className="flex items-center gap-1 truncate">
                        <span className="text-slate-500 dark:text-slate-400 font-normal">المندوب:</span>
                        <span className="truncate">{entries[0]?.delegateName || 'غير محدد'}</span>
                      </div>
                      {entries[0]?.timestamp && (
                        <span className={`text-[9px] font-bold whitespace-nowrap border-r pr-1 shrink-0 ${isDarkMode ? 'text-slate-400 border-slate-600' : 'text-slate-600 border-slate-400'}`} dir="ltr">
                          {new Date(entries[0].timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </span>
                      )}
                    </div>

                    {/* 3. الوزن الكلي */}
                    <div className="flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-emerald-600 text-white font-black border border-emerald-700 shadow-sm text-center">
                      <span className="text-emerald-100 text-[9px] font-normal">الوزن:</span>
                      <span>{formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم</span>
                    </div>

                    {/* 4. المبلغ الكلي */}
                    <div className="flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-indigo-600 text-white font-black border border-indigo-700 shadow-sm text-center" title="إجمالي مبلغ الفاتورة">
                      <span className="text-indigo-100 text-[9px] font-normal">المجموع:</span>
                      <span>{formatWithCommas(entries.reduce((sum, e) => {
                        const prod = productsList.find(p => p.productName === e.productName);
                        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                        return sum + (price * e.quantity);
                      }, 0), true)} د.ع</span>
                    </div>
                  </div>
                </h4>
                <div className="flex flex-col px-2 pb-1 pt-0.5">
                  {entries.map((entry, index) => {
              const isEditing = editingEntryId === entry.id;

              if (isEditing) {
                const currentQty = parseArabicNumber(editFormData.quantity) || 0;
                const currentGrams = parseArabicNumber(editFormData.pieceWeightKg) || 0;
                const calcTotalWeight = ((currentQty * currentGrams) / 1000).toFixed(2);

                return (
                  <div
                    key={`edit_${entry.id || 'item'}_${index}`}
                    className="p-3 bg-amber-50 border-2 border-amber-500 rounded-xl shadow-md space-y-3 text-slate-900 text-xs edit-form-container"
                  >
                    <div className="font-extrabold text-amber-800 text-xs flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Pencil className="w-4 h-4 text-amber-600" />
                        <span>تعديل المبيعات المحفوظة</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="p-1 rounded bg-amber-200/60 hover:bg-amber-300 text-slate-800 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">اسم المنتج</label>
                        <input
                          type="text"
                          value={editFormData.productName}
                          readOnly
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-500 bg-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">الصنف</label>
                        <input
                          type="text"
                          value={editFormData.categoryName}
                          readOnly
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-500 bg-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">عدد القطع (رقم الإدخال)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editFormData.quantity}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, quantity: parseArabicDigits(e.target.value) })
                          }
                          onKeyDown={handleKeyDown}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">وزن القطعة (غرام)</label>
                        <input
                          type="text"
                          value={editFormData.pieceWeightKg}
                          readOnly
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-500 bg-slate-100"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-amber-300/50">
                      <div className="text-xs font-black text-amber-900">
                        الوزن الإجمالي المعدل: {calcTotalWeight} كجم
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(entry.id)}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black text-xs flex items-center gap-1.5 shadow cursor-pointer save-btn"
                        >
                          <Check className="w-4 h-4" />
                          <span>حفظ التعديل</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-bold text-xs cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={`saved_${entry.id || 'item'}_${index}`}
                  className={`py-1 px-2 border-b last:border-b-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-[10px] transition-colors ${isDarkMode ? 'border-slate-700 hover:bg-slate-700/50' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <div className="flex-1 flex flex-col gap-1 w-full sm:w-auto">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${isDarkMode ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-slate-200 text-slate-700 border-slate-300'}`} title="كود المنتج">
                        {getProductCode(entry.productName)}
                      </span>
                      <span className={`font-bold text-sm ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{entry.productName}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${isDarkMode ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {entry.categoryName}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="flex items-center gap-1.5">
                      {entry.quantity >= (Number(productsList.find(p => p.productName === entry.productName)?.cartonQuantity) || 1) && (
                        <div className={`text-center font-bold px-2 py-0.5 border rounded-md text-[10px] min-w-[50px] ${isDarkMode ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`} title="الكراتين المدخلة">
                          {entry.entryUnit === 'carton' ? formatWithCommas(entry.enteredQuantity || 0) : formatWithCommas(parseFloat(((entry.enteredQuantity || entry.quantity) / (Number(productsList.find(p => p.productName === entry.productName)?.cartonQuantity) || 1)).toFixed(2)))} كارتون
                        </div>
                      )}
                      <div className={`text-center font-bold px-2 py-0.5 rounded-md text-[10px] min-w-[50px] ${isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-800'}`} title="القطع المدخلة">
                        {entry.entryUnit === 'carton' ? formatWithCommas(entry.quantity) : formatWithCommas(entry.enteredQuantity || entry.quantity)} قطعة
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1.5">
                      <div className={`text-center font-black px-2 py-0.5 rounded-md border text-[10px] min-w-[60px] ${isDarkMode ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300' : 'bg-emerald-50 border-emerald-100 text-emerald-800'}`} title="وزن الإدخال">
                        وزن: {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
                      </div>
                      <div className={`text-center font-black px-2 py-0.5 rounded-md border text-[10px] min-w-[60px] ${isDarkMode ? 'bg-rose-900/50 border-rose-700 text-rose-300' : 'bg-rose-50 border-rose-100 text-rose-800'}`} title="مبلغ الإدخال">
                        مبلغ: {formatWithCommas((productsList.find(p => p.productName === entry.productName)?.[entry.priceMode === 'wholesale' ? 'wholesalePrice' : 'retailPrice'] || 0) * entry.quantity, true)} د.ع
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!completedDelegates[activeDelegateName || ''] && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(entry)}
                          className={`p-1 rounded-md transition-colors flex items-center justify-center cursor-pointer ${isDarkMode ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-900/50' : 'text-amber-600 hover:text-amber-800 hover:bg-amber-100'}`}
                          title="تعديل هذا الإدخال"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!completedDelegates[activeDelegateName || ''] && (
                        <button
                          type="button"
                          onClick={() => {
                            // التحقق الصارم مما إذا كان حذف هذا الصنف سيجعل الفاتورة أقل من 3 أصناف أو أقل من 25,000 د.ع (معفى عند الأدمن)
                            const isAdminUser = Boolean(currentUser?.isAdmin || currentUser?.role === 'admin');
                            if (!isAdminUser) {
                              const remainingEntries = entries.filter(e => e.id !== entry.id);
                              const remainingCount = new Set(remainingEntries.map(e => e.productName)).size;
                              const remainingTotal = remainingEntries.reduce((sum, e) => {
                                const p = productsList.find(prodItem => prodItem.productName === e.productName);
                                const price = p ? (e.priceMode === 'wholesale' ? (p.wholesalePrice || 0) : (p.retailPrice || 0)) : 0;
                                return sum + (price * e.quantity);
                              }, 0);

                              if (remainingCount < 3 || remainingTotal < 25000) {
                                setMinInvoiceAlertData({
                                  total: remainingTotal,
                                  count: remainingCount,
                                  customerName: entry.customerName,
                                  context: 'deleteItem'
                                });
                                return;
                              }
                            }

                            setDeleteConfirmation({
                              isOpen: true,
                              title: 'حذف السجل',
                              message: 'هل أنت متأكد من حذف هذا السجل؟',
                              subMessage: `سيتم حذف سجل منتج "${entry.productName || 'المحدد'}" بكمية (${entry.quantity}) نهائياً.`,
                              confirmButtonText: 'نعم، حذف السجل',
                              onConfirm: () => {
                                deleteSalesEntry(entry.id);
                                setDeleteConfirmation(null);
                              }
                            });
                          }}
                          className={`p-1 rounded-md transition-colors flex items-center justify-center cursor-pointer ${isDarkMode ? 'text-red-400 hover:text-red-300 hover:bg-red-900/50' : 'text-red-500 hover:text-red-700 hover:bg-red-50'}`}
                          title="حذف السجل"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Minimum Invoice Alert Modal */}
      {minInvoiceAlertData && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130] p-4 animate-in fade-in duration-200"
          onClick={() => setMinInvoiceAlertData(null)}
        >
          <div 
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl p-5 sm:p-6 shadow-2xl border text-center space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shadow-inner">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400">
                تنبيه: حالة الفاتورة وشروط الحفظ
              </h3>
              {minInvoiceAlertData.customerName && (
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  الزبون: <span className="font-extrabold text-slate-800 dark:text-slate-200">{minInvoiceAlertData.customerName}</span>
                </div>
              )}
              <p className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 leading-relaxed px-1">
                {minInvoiceAlertData.context === 'edit'
                  ? 'لا يمكن حفظ هذا التعديل لأن الفاتورة ستصبح غير مستوفية لشروط الحفظ الإلزامية (أقل من 3 أصناف أو أقل من 25,000 د.ع).'
                  : minInvoiceAlertData.context === 'deleteItem'
                  ? 'لا يمكن حذف هذا الصنف لأن الفاتورة ستصبح غير مستوفية لشروط الحفظ الإلزامية (أقل من 3 أصناف أو أقل من 25,000 د.ع). لحذف كامل الفاتورة يرجى استخدام زر مسح/حذف الفاتورة بالكامل بالأعلى.'
                  : 'لا يمكن حفظ الفاتورة لأنها غير مستوفية لشروط الحفظ الإلزامية. يجب أن تحتوي الفاتورة على 3 أصناف مختلفة على الأقل وبقيمة لا تقل عن 25,000 د.ع.'}
              </p>
            </div>

            {/* شروط الحفظ الإلزامية */}
            <div className={`p-3 rounded-xl border text-right text-xs space-y-1.5 ${
              isDarkMode ? 'bg-amber-950/20 border-amber-500/30 text-amber-200' : 'bg-amber-50/80 border-amber-200 text-amber-900'
            }`}>
              <div className="font-black text-xs flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Shield className="w-3.5 h-3.5" />
                <span>شروط حفظ الفاتورة الإلزامية:</span>
              </div>
              <ul className="space-y-1 font-bold text-[11px] pr-2 list-disc list-inside">
                <li>عدد المنتجات: <span className="font-black">3 أصناف مختلفة على الأقل</span> في الفاتورة الواحدة.</li>
                <li>المبلغ الإجمالي: <span className="font-black">25,000 د.ع على الأقل</span>.</li>
              </ul>
            </div>

            {/* حالة الفاتورة الحالية */}
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 space-y-2.5 text-right text-xs">
              <div className="font-black text-xs text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-200 dark:border-slate-700">
                تقرير التحقق من حالة الفاتورة:
              </div>

              {/* الشرط 1: عدد الأصناف */}
              <div className="flex justify-between items-center gap-2">
                <span className="text-slate-600 dark:text-slate-400 font-bold">عدد الأصناف في الفاتورة:</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-black text-xs">
                    {minInvoiceAlertData.count} / 3 أصناف
                  </span>
                  {minInvoiceAlertData.count >= 3 ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300">
                      مستوفي ✅
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-300">
                      ينقص {3 - minInvoiceAlertData.count} صنف ❌
                    </span>
                  )}
                </div>
              </div>

              {/* الشرط 2: المبلغ الإجمالي */}
              <div className="flex justify-between items-center gap-2">
                <span className="text-slate-600 dark:text-slate-400 font-bold">المبلغ الإجمالي للفاتورة:</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-black text-xs" dir="ltr">
                    {formatWithCommas(minInvoiceAlertData.total, true)} د.ع
                  </span>
                  {minInvoiceAlertData.total >= 25000 ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300">
                      مستوفي ✅
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-300">
                      ينقص {formatWithCommas(25000 - minInvoiceAlertData.total, true)} د.ع ❌
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setMinInvoiceAlertData(null)}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-sm shadow-lg transition-all active:scale-95 cursor-pointer"
              >
                حسناً، فهمت ذلك (سأقوم باستيفاء شروط الحفظ)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Export Modal */}
      {showCustomExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowCustomExportModal(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-slate-800 dark:text-slate-200 mb-4 text-center">اختيار المندوبين للتصدير</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                    {uniqueDelegatesForFilter.map(delegate => (
                        <label key={delegate} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">
                            <input 
                                type="checkbox" 
                                checked={selectedDelegatesForExport.has(delegate)}
                                onChange={e => {
                                    const newSelected = new Set(selectedDelegatesForExport);
                                    if (e.target.checked) newSelected.add(delegate);
                                    else newSelected.delete(delegate);
                                    setSelectedDelegatesForExport(newSelected);
                                }}
                            />
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{delegate}</span>
                        </label>
                    ))}
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowCustomExportModal(false)} className="flex-1 px-4 py-2 bg-slate-200 text-slate-800 rounded-lg font-bold">إلغاء</button>
                    <button onClick={handleCustomExport} className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg font-bold">تصدير</button>
                </div>
            </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Centered Modal with Blurred Backdrop) */}
      {deleteConfirmation && deleteConfirmation.isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[150] p-4 animate-in fade-in duration-200"
          onClick={() => setDeleteConfirmation(null)}
          dir="rtl"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl border text-center space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode 
                ? 'bg-slate-900 border-red-500/40 text-white shadow-red-950/20' 
                : 'bg-white border-red-200 text-slate-900 shadow-slate-300/50'
            }`}
          >
            {/* Trash Warning Icon */}
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/15 text-red-500 flex items-center justify-center shadow-inner border border-red-500/30">
              <Trash2 className="w-7 h-7" />
            </div>

            {/* Title & Message */}
            <div className="space-y-1.5">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                {deleteConfirmation.title}
              </h3>
              <p className="text-sm sm:text-base font-black text-red-600 dark:text-red-400">
                {deleteConfirmation.message}
              </p>
              {deleteConfirmation.subMessage && (
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 pt-1 leading-relaxed">
                  {deleteConfirmation.subMessage}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmation(null)}
                className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border transition-all active:scale-95 cursor-pointer ${
                  isDarkMode 
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200' 
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={deleteConfirmation.onConfirm}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-500 active:scale-95 text-white rounded-xl font-black text-xs sm:text-sm shadow-lg shadow-red-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>{deleteConfirmation.confirmButtonText}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
};