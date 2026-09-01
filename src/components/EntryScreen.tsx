import React, { useState, useMemo, useEffect } from 'react';
import { useSales, DEFAULT_CATEGORIES_LIST } from '../context/SalesContext';
import { GridRow, SalesEntry } from '../types';
import { Star, Save, Plus, Trash2, Check, AlertCircle, Pencil, X , Download, ShoppingCart, Package, Printer } from 'lucide-react';
import { DelegateLoginModal } from './DelegateLoginModal';
import { parseArabicDigits, parseArabicNumber, formatWithCommas } from '../utils/numberUtils';
import { PullToRefresh } from './PullToRefresh';
import logoImg from '../assets/images/logo.png';

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
  } = useSales();

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

    updateSalesEntry(id, {
      productName: name,
      categoryName: editFormData.categoryName,
      quantity: q,
      pieceWeightKg: pieceWeightKg,
      totalWeightKg: totalW,
    });

    setEditingEntryId(null);
    setSuccessMessage('تم تعديل المنتج بنجاح ✅');
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
          customerCode: customerCode.trim(),
          customerAddress: customerAddress.trim(),
          priceMode: invoicePriceMode
        });
      }
    }

    if (invalidFound) return;

    if (itemsToSave.length < 3) {
      setErrorMessage('تنبيه: يجب ادخال 3 منتجات او اكثر للحفظ');
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
    
    const headers = ['تاريخ الادخال', 'المندوب', 'اسم الزبون', 'اسم المنتج', 'الصنف', 'كود المنتج', 'عدد القطع', 'وزن القطعة (كجم)', 'الوزن الكلي (كجم)', 'نوع الفاتورة'];
    const rows = safeSavedEntries.map(entry => [
      entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-GB') : '',
      entry.delegateName || 'غير محدد',
      entry.customerName || 'بدون اسم زبون',
      entry.productName,
      entry.categoryName,
      getProductCode(entry.productName),
      entry.quantity.toString(),
      entry.pieceWeightKg.toString(),
      entry.totalWeightKg.toString(),
      entry.priceMode === 'wholesale' ? 'جملة' : 'مفرد'
    ]);
    
    const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `sales_entries_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

      {/* Target Progress Banner */}


      {/* Total Saved Weight Summary Card */}
      <div className="bg-white border-2 border-emerald-600 rounded-xl p-4 shadow-md text-center space-y-3">
        <h2 className="font-extrabold text-slate-900 text-base">
          مجموع وزن إدخالات ({activeDelegateName})
        </h2>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-12">
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-500 mb-1">الوزن الكلي</span>
            <div className="text-3xl font-black text-slate-900">
              {formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)), true)} كجم
            </div>
          </div>
          
          <div className="hidden sm:block w-px h-12 bg-slate-200"></div>
          <div className="block sm:hidden w-full h-px bg-slate-200"></div>
          
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-500 mb-1">المبلغ الكلي</span>
            <div className="text-3xl font-black text-emerald-600">
              {formatWithCommas(totalSavedPrice, true)} د.ع
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-3 pt-2">
          <span className="px-3 py-1 bg-emerald-100 border border-emerald-400 text-slate-900 font-bold text-xs rounded-full">
            إجمالي القطع: {formatWithCommas(totalSavedQuantity)} قطعة
          </span>
          <span className="px-3 py-1 bg-emerald-100 border border-emerald-400 text-slate-900 font-bold text-xs rounded-full">
            عدد السجلات: {formatWithCommas(safeSavedEntries.length)} منتج
          </span>
        </div>
        {Object.keys(delegateStats).length > 0 && (
          <div className="flex flex-wrap justify-center gap-3 pt-3 mt-2 border-t border-emerald-200">
            {Object.entries(delegateStats)
              .sort(([, a], [, b]) => (b.wholesale.size + b.retail.size) - (a.wholesale.size + a.retail.size))
              .map(([delegate, stats]) => (
               <div key={delegate} className="flex flex-col items-center bg-white border-2 border-emerald-500 rounded-lg shadow-sm overflow-hidden text-xs min-w-[120px]">
                 <div className="bg-emerald-50 w-full text-center py-1.5 px-3 border-b border-emerald-200 text-slate-800 font-bold">
                   {delegate}
                 </div>
                 <div className="flex justify-between w-full px-2 py-1 text-slate-600 border-b border-slate-100">
                   <div className="flex flex-col items-center w-1/2 border-l border-slate-200">
                     <span className="text-[9px] text-purple-600 font-bold">جملة</span>
                     <span className="font-bold text-slate-800">{stats.wholesale.size}</span>
                   </div>
                   <div className="flex flex-col items-center w-1/2">
                     <span className="text-[9px] text-amber-600 font-bold">مفرد</span>
                     <span className="font-bold text-slate-800">{stats.retail.size}</span>
                   </div>
                 </div>
                 <div className="bg-slate-50 w-full text-center py-1 px-3 text-emerald-800 font-black">
                   المجموع: {stats.wholesale.size + stats.retail.size}
                 </div>
               </div>
            ))}
          </div>
        )}
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





            {/* Customer Info Box */}
      <div className="bg-slate-50 border border-slate-300 rounded-xl p-4 shadow-sm">
        <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2">
          بيانات الزبون
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">اسم الزبون <span className="text-red-500">*</span></label>
            <input
              type="text"
              list="customerNamesList"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="إلزامي"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <datalist id="customerNamesList">
              {uniqueCustomerNames.map((name, idx) => (
                <option key={idx} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">نوع الفاتورة <span className="text-red-500">*</span></label>
            <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-300">
              <button
                type="button"
                onClick={() => setInvoicePriceMode('retail')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${invoicePriceMode === 'retail' ? 'bg-white shadow-sm text-emerald-700 border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
              >
                مفرد
              </button>
              <button
                type="button"
                onClick={() => setInvoicePriceMode('wholesale')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${invoicePriceMode === 'wholesale' ? 'bg-white shadow-sm text-emerald-700 border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
              >
                جملة
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">كود الزبون</label>
            <input
              type="text"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
             
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">العنوان</label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
             
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* EXACT GRID TABLE matching requested style */}
      <div className="border-2 border-slate-900 rounded-xl overflow-hidden shadow-xl bg-white entry-grid-container">
        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse">
            <thead>
              <tr className="bg-[#7EFF74] text-black font-extrabold text-xs sm:text-sm border-b-2 border-slate-900">
                <th className="py-2.5 px-2 border-l border-slate-900 w-[30%]">اسم المنتج</th>
                <th className="py-2.5 px-2 border-l border-slate-900 w-[20%]">رقم الإدخال</th>
                <th className="py-2.5 px-2 border-l border-slate-900 w-[20%]">الصنف</th>
                <th className="py-2.5 px-2 border-l border-slate-900 w-[15%]">وزن القطعة (غرام)</th>
                <th className="py-2.5 px-2 w-[15%]">وزن الإدخال بالكيلو</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.map((row, idx) => {
                const effectiveQ = getEffectivePieces(row.quantity, row.productName, row.entryUnit || 'piece');
                const gVal = parseFloat(parseArabicDigits(row.pieceWeight.trim())) || 0;
                const rowKgVal = (effectiveQ * gVal) / 1000;

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-800 ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                    }`}
                  >
                    <td className="p-0 border-l border-slate-800 relative">
                      <div className="relative flex items-center w-full h-full">
                        <input
                          type="text"
                          placeholder="اسم المنتج (اكتب للاقتراح من القائمة)"
                          value={row.productName}
                          onChange={(e) => {
                            handleRowChange(row.id, 'productName', e.target.value);
                            setActiveAutocompleteRowId(row.id);
                          }}
                          onFocus={() => setActiveAutocompleteRowId(row.id)}
                          onBlur={() => setTimeout(() => setActiveAutocompleteRowId(null), 250)}
                          onKeyDown={handleKeyDown}
                          className="w-full h-10 px-2 pl-8 bg-transparent text-slate-900 font-bold text-sm text-right focus:bg-emerald-50 focus:outline-none border-none"
                        />
                        {(row.productName || row.quantity || row.pieceWeight) && (
                          <button
                            type="button"
                            onClick={() => {
                              handleRowChange(row.id, 'productName', '');
                              handleRowChange(row.id, 'quantity', '');
                              handleRowChange(row.id, 'pieceWeight', '');
                            }}
                            className="absolute left-1.5 w-5 h-5 bg-red-100 hover:bg-red-500 text-red-600 hover:text-white rounded-full flex items-center justify-center transition-colors cursor-pointer"
                            title="مسح السطر"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {activeAutocompleteRowId === row.id && (
                        <div className="absolute top-full right-0 z-50 w-full min-w-[280px] sm:w-96 bg-white border border-slate-300 shadow-2xl rounded-xl mt-1 max-h-72 overflow-y-auto text-right">
                          {productSuggestions
                            .filter((item) =>
                              row.productName.trim() === '' || item.name.toLowerCase().includes(row.productName.toLowerCase()) || item.code.toLowerCase().includes(row.productName.toLowerCase())
                            )
                            .slice(0, 6)
                            .map((matchedItem, mIdx) => (
                              <div
                                key={`sug_${mIdx}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  const weightGrams = matchedItem.pieceWeightKg ? String(Math.round(matchedItem.pieceWeightKg * 1000)) : '';
                                  setGridRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? {
                                            ...r,
                                            productName: matchedItem.name,
                                            category: matchedItem.category || r.category,
                                            pieceWeight: weightGrams || r.pieceWeight,
                                          }
                                        : r
                                    )
                                  );
                                  setActiveAutocompleteRowId(null);
                                }}
                                className="px-3 py-2.5 hover:bg-emerald-100 cursor-pointer text-xs font-bold text-slate-900 border-b border-slate-100 flex items-center justify-between"
                              >
                                <span>{matchedItem.name}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-800">
                                  {matchedItem.category}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </td>

                    <td className="p-0 border-l border-slate-800 relative">
                      <div className="flex flex-col h-full justify-center">
                        <div className="flex items-center justify-center gap-3 pt-1.5 pb-1 border-b border-slate-200 bg-slate-50/50">
                          <button
                            type="button"
                            onClick={() => handleRowChange(row.id, 'entryUnit' as keyof GridRow, 'piece')}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border transition-colors ${
                              (row.entryUnit || 'piece') === 'piece' 
                                ? 'border-red-500 text-red-600' 
                                : 'border-transparent text-slate-700'
                            }`}
                          >
                            قطع
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRowChange(row.id, 'entryUnit' as keyof GridRow, 'carton')}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border transition-colors ${
                              row.entryUnit === 'carton'
                                ? 'border-red-500 text-red-600'
                                : 'border-transparent text-slate-700'
                            }`}
                          >
                            كارتون
                          </button>
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={row.quantity}
                          onChange={(e) => handleRowChange(row.id, 'quantity', e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-full h-8 px-2 bg-transparent text-slate-900 font-bold text-sm text-center focus:bg-emerald-50 focus:outline-none border-none"
                        />
                      </div>
                    </td>

                    <td className="p-0 border-l border-slate-800">
                      <select
                        value={row.category}
                        onChange={(e) => handleRowChange(row.id, 'category', e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full h-10 px-1 bg-transparent text-slate-900 font-bold text-xs focus:bg-emerald-50 focus:outline-none border-none text-center cursor-pointer"
                      >
                        {DEFAULT_CATEGORIES_LIST.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="p-0 border-l border-slate-800">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="غرام (مثال 250)"
                        value={row.pieceWeight}
                        onChange={(e) => handleRowChange(row.id, 'pieceWeight', e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full h-10 px-2 bg-transparent text-slate-900 font-bold text-sm text-center focus:bg-emerald-50 focus:outline-none border-none"
                      />
                    </td>

                    <td className="py-2 px-1 text-center font-black text-xs text-emerald-900 bg-emerald-100/60">
                      {rowKgVal > 0 ? `${formatWithCommas(parseFloat(rowKgVal.toFixed(2)), true)} كجم` : '0 كجم'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-emerald-50 border-t-2 border-slate-900">
                <td colSpan={3} className="py-2.5 px-3 text-right font-black text-emerald-900 text-sm">
                  الإجمالي الكلي: {formatWithCommas(currentInvoiceTotalPrice, true)} د.ع
                </td>
                <td colSpan={2} className="py-2.5 px-3 text-left font-black text-emerald-900 text-sm">
                  الوزن: {formatWithCommas(parseFloat(currentInvoiceTotalWeight.toFixed(2)), true)} كجم
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <button
          onClick={handleSaveGrid}
          className="w-full bg-[#7EFF74] hover:bg-[#6be662] text-black font-black text-lg py-3 flex items-center justify-center gap-2 border-t-2 border-slate-900 transition-colors shadow-inner cursor-pointer save-btn"
        >
          <Save className="w-5 h-5 text-black" />
          <span>حفظ الادخال</span>
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          onClick={handleAddMoreRows}
          className="px-4 py-2 border border-slate-600 bg-slate-800 text-slate-200 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة صفوف إضافية</span>
        </button>

        <button
          onClick={handleClearGrid}
          className="px-4 py-2 border border-red-500/40 bg-red-950/40 text-red-300 hover:bg-red-900/60 rounded-xl text-xs font-bold transition-colors cursor-pointer"
        >
          مسح الجدول
        </button>
      </div>

      {/* Saved Sales List Table */}
      <div className="space-y-2 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
              سجل المبيعات المحفوظة اليوم ({safeSavedEntries.length})
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
            لا توجد مبيعات محفوظة اليوم بعد. أدخل المنتجات في الجدول أعلاه واضغط 'حفظ الادخال'.
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
              <div key={customerName} className="bg-white border-2 border-slate-400 rounded-xl p-0 shadow-md overflow-hidden">
                <h4 className="font-extrabold text-slate-800 text-sm mb-0 p-3 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? `الزبون: ${customerName.split(' | الزبون: ').pop()}` : `الزبون: ${customerName}`}</span>
                    {entries[0]?.priceMode && (
                      <span className={`px-2 py-0.5 text-[10px] rounded-md border font-bold flex items-center gap-1 whitespace-nowrap ${entries[0].priceMode === 'wholesale' ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                        {entries[0].priceMode === 'wholesale' ? <Package className="w-3 h-3" /> : <ShoppingCart className="w-3 h-3" />}
                        {entries[0].priceMode === 'wholesale' ? 'فاتورة جملة' : 'فاتورة مفرد'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg border border-slate-300 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                      <span className="text-xs sm:text-sm font-bold">المندوب: {entries[0]?.delegateName || 'غير محدد'}</span>
                      {entries[0]?.timestamp && (
                        <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap sm:border-r border-slate-300 sm:pr-2" dir="ltr">
                          {new Date(entries[0].timestamp).toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-emerald-600 text-white text-sm sm:text-base font-black px-3 py-1.5 rounded-lg border border-emerald-700 shadow-md">
                        {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                      </span>
                      <span className="bg-indigo-600 text-white text-sm sm:text-base font-black px-3 py-1.5 rounded-lg border border-indigo-700 shadow-md" title="إجمالي مبلغ الفاتورة">
                        {formatWithCommas(entries.reduce((sum, e) => {
                          const prod = productsList.find(p => p.productName === e.productName);
                          const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                          return sum + (price * e.quantity);
                        }, 0), true)} د.ع
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handlePrintInvoice(customerName, entries)}
                        className="p-1.5 bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-800 rounded-lg border border-blue-200 transition-colors cursor-pointer shadow-sm flex items-center justify-center"
                        title="طباعة الفاتورة"
                      >
                        <Printer className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if(window.confirm('هل تريد حذف هذه الفاتورة ؟')) {
                            entries.forEach(e => deleteSalesEntry(e.id));
                          }
                        }}
                        className="p-1.5 bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 rounded-lg border border-red-200 transition-colors cursor-pointer shadow-sm flex items-center justify-center"
                        title="حذف الفاتورة بالكامل"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </h4>
                <div className="flex flex-col px-2 pb-2 pt-1">
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
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, productName: e.target.value })
                          }
                          onKeyDown={handleKeyDown}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">الصنف</label>
                        <select
                          value={editFormData.categoryName}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, categoryName: e.target.value })
                          }
                          onKeyDown={handleKeyDown}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white"
                        >
                          {DEFAULT_CATEGORIES_LIST.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">رقم الإدخال</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editFormData.quantity}
                          onChange={(e) =>
                            setEditFormData({
                              ...editFormData,
                              quantity: parseArabicDigits(e.target.value),
                            })
                          }
                          onKeyDown={handleKeyDown}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white text-center"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 mb-1">وزن القطعة (غرام)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editFormData.pieceWeightKg}
                          onChange={(e) =>
                            setEditFormData({
                              ...editFormData,
                              pieceWeightKg: parseArabicDigits(e.target.value),
                            })
                          }
                          onKeyDown={handleKeyDown}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white text-center"
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
                  className="py-2.5 px-3 border-b last:border-b-0 border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-900 text-xs hover:bg-slate-50 transition-colors"
                >
                  <div className="flex-1 flex flex-col gap-1 w-full sm:w-auto">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-700 font-bold bg-slate-200 px-1.5 py-0.5 rounded border border-slate-300" title="كود المنتج">
                        {getProductCode(entry.productName)}
                      </span>
                      <span className="font-bold text-sm text-slate-900">{entry.productName}</span>
                      <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                        {entry.categoryName}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="flex items-center gap-1.5">
                      {entry.quantity >= (Number(productsList.find(p => p.productName === entry.productName)?.cartonQuantity) || 1) && (
                        <div className="text-center font-bold px-2 py-0.5 bg-indigo-50 border border-indigo-200 rounded-md text-indigo-700 text-[10px] min-w-[50px]" title="الكراتين المدخلة">
                          {entry.entryUnit === 'carton' ? formatWithCommas(entry.enteredQuantity || 0) : formatWithCommas(parseFloat(((entry.enteredQuantity || entry.quantity) / (Number(productsList.find(p => p.productName === entry.productName)?.cartonQuantity) || 1)).toFixed(2)))} كارتون
                        </div>
                      )}
                      <div className="text-center font-bold px-2 py-0.5 bg-slate-100 rounded-md text-slate-800 text-[10px] min-w-[50px]" title="القطع المدخلة">
                        {entry.entryUnit === 'carton' ? formatWithCommas(entry.quantity) : formatWithCommas(entry.enteredQuantity || entry.quantity)} قطعة
                      </div>
                      <div className="text-center font-black text-emerald-800 px-2 py-0.5 bg-emerald-50 rounded-md border border-emerald-100 text-[10px] min-w-[60px]" title="الوزن الإجمالي">
                        {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
                      </div>
                      <div className="text-center font-black text-rose-800 px-2 py-0.5 bg-rose-50 rounded-md border border-rose-100 text-[10px] min-w-[60px]" title="السعر">
                        {formatWithCommas((productsList.find(p => p.productName === entry.productName)?.[entry.priceMode === 'wholesale' ? 'wholesalePrice' : 'retailPrice'] || 0) * entry.quantity, true)} د.ع
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="تعديل هذا الإدخال"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if(window.confirm('هل أنت متأكد من حذف هذا السجل؟')) deleteSalesEntry(entry.id) }}
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="حذف السجل"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>              );
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