import React, { useState, useMemo, useEffect } from 'react';
import { useSales, DEFAULT_CATEGORIES_LIST } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, doc, setDoc } from 'firebase/firestore';
import { GridRow, SalesEntry } from '../types';
import { Star, Save, Plus, Trash2, Check, AlertCircle, Pencil, X , Download, ShoppingCart, Package, Printer } from 'lucide-react';
import { DelegateLoginModal } from './DelegateLoginModal';
import { parseArabicDigits, parseArabicNumber, formatWithCommas } from '../utils/numberUtils';
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

    // Check for minimum amount
    const totalPrice = itemsToSave.reduce((sum, e) => {
        const prod = productsList.find(p => p.productName === e.productName);
        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
        return sum + (price * e.quantity);
    }, 0);

    const uniqueProductCount = new Set(itemsToSave.map(e => e.productName)).size;

    if (totalPrice < 25000 || uniqueProductCount < 3) {
        setErrorMessage('تنبيه: يجب أن لا تقل قيمة الفاتورة عن 25000، ويجب أن تحتوي على 3 أصناف مختلفة على الأقل.');
        return;
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


  const handleExportCSV = () => {
    if (safeSavedEntries.length === 0) {
      window.alert('لا توجد بيانات لتصديرها');
      return;
    }
    
    const headers = ['تاريخ الادخال', 'المندوب', 'اسم الزبون', 'كود الزبون', 'اسم المنتج', 'الصنف', 'كود المنتج', 'عدد القطع', 'وزن القطعة (كجم)', 'الوزن الكلي (كجم)', 'نوع الفاتورة'];
    const sortedEntries = [...safeSavedEntries].sort((a, b) => a.timestamp - b.timestamp);

    const worksheetData: any[] = [headers];
    
    let lastDelegate = '';
    let lastCustomerCode = '';

    sortedEntries.forEach((entry, index) => {
        const delegate = entry.delegateName || 'غير محدد';
        const customerCode = entry.customerCode || 'بدون كود';

        // Add separator row for new delegate
        if (index > 0 && delegate !== lastDelegate) {
            worksheetData.push(Array(headers.length).fill('')); // Empty row
        }
        // Add empty row for new customer only if not already a new delegate row
        else if (index > 0 && customerCode !== lastCustomerCode) {
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
        lastCustomerCode = customerCode;
    });

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SalesData');
    XLSX.writeFile(workbook, `sales_entries_${new Date().toISOString().split('T')[0]}.xlsx`);
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
            <div className="text-xl font-black">{new Set(safeSavedEntries.filter(e => e.dateString === new Date().toISOString().split('T')[0]).map(e => e.customerName)).size}</div>
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
              <button
                onClick={handleExportCSV}
                className="px-2.5 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg border border-blue-300 flex items-center gap-1.5 text-xs font-bold transition-colors shadow-sm cursor-pointer"
                title="تصدير البيانات كملف Excel"
              >
                <Download className="w-4 h-4" />
                <span>تصدير الادخالات</span>
              </button>
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
                const weightA = entriesA.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                const weightB = entriesB.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                return weightB - weightA;
              })
              .map(([customerName, entries]) => (
              <div key={customerName} className={`border-2 rounded-xl p-0 shadow-md overflow-hidden ${
                (isDarkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-400')
              }`}>
                <h4 className={`font-extrabold text-sm mb-0 p-3 border-b flex flex-col gap-2 rounded-t-xl ${isDarkMode ? 'bg-slate-700/80 border-slate-600 text-slate-100' : 'bg-slate-100/80 border-slate-200 text-slate-900'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span className="bg-slate-200 dark:bg-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-500">
                      {entries[0]?.customerCode || '---'}
                    </span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? `الزبون: ${customerName.split(' | الزبون: ').pop()}` : `الزبون: ${customerName}`}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                    {entries[0]?.priceMode && (
                      <span className={`px-2 py-0.5 rounded-md border font-bold flex items-center gap-1 whitespace-nowrap ${entries[0].priceMode === 'wholesale' ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                        {entries[0].priceMode === 'wholesale' ? <Package className="w-3 h-3" /> : <ShoppingCart className="w-3 h-3" />}
                        {entries[0].priceMode === 'wholesale' ? 'فاتورة جملة' : 'فاتورة مفرد'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <div className={`px-2 py-0.5 rounded-md border flex flex-col sm:flex-row sm:items-center gap-0 sm:gap-1 ${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-600' : 'bg-slate-200 text-slate-900 border-slate-300'}`}>
                      <span className="text-[10px] font-bold">المندوب: {entries[0]?.delegateName || 'غير محدد'}</span>
                      {entries[0]?.timestamp && (
                        <span className={`text-[9px] font-bold whitespace-nowrap sm:border-r sm:pr-2 ${isDarkMode ? 'text-slate-400 border-slate-600' : 'text-slate-600 border-slate-400'}`} dir="ltr">
                          {new Date(entries[0].timestamp).toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-emerald-600 text-white text-[10px] font-black px-2 py-0.5 rounded border border-emerald-700 shadow-md">
                        {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                      </span>
                      <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded border border-indigo-700 shadow-md" title="إجمالي مبلغ الفاتورة">
                        {formatWithCommas(entries.reduce((sum, e) => {
                          const prod = productsList.find(p => p.productName === e.productName);
                          const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                          return sum + (price * e.quantity);
                        }, 0), true)} د.ع
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => { 
                          setPrefilledEntryData({ 
                            customerName: entries[0].customerName, 
                            customerCode: entries[0].customerCode || '', 
                            customerAddress: entries[0].customerAddress || '',
                            customerInvoiceType: entries[0].priceMode === 'wholesale' ? 'جملة' : 'مفرد',
                            lastInvoiceToday: { priceMode: entries[0].priceMode }
                          });
                          setShowQuickAdd(true);
                          setActiveTab('products');
                        }}
                        className={`p-1 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${isDarkMode ? 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-800 border-emerald-700' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200 hover:text-emerald-800 border-emerald-200'}`}
                        title="إضافة منتج للفاتورة"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePrintInvoice(customerName, entries)}
                        className={`p-1 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${isDarkMode ? 'bg-blue-900/50 text-blue-400 hover:bg-blue-800 border-blue-700' : 'bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-800 border-blue-200'}`}
                        title="طباعة الفاتورة"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => {
                          if(window.confirm('هل تريد حذف هذه الفاتورة ؟')) {
                            entries.forEach(e => deleteSalesEntry(e.id));
                          }
                        }}
                        className={`p-1 rounded-lg border transition-colors cursor-pointer shadow-sm flex items-center justify-center ${isDarkMode ? 'bg-red-900/50 text-red-400 hover:bg-red-800 border-red-700' : 'bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 border-red-200'}`}
                        title="حذف الفاتورة بالكامل"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      )}
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
                          onClick={() => { if(window.confirm('هل أنت متأكد من حذف هذا السجل؟')) deleteSalesEntry(entry.id) }}
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
    </div>
    </PullToRefresh>
  );
};