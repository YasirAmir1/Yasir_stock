import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, writeBatch, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { MonthlyDelegateReturn } from '../types';
import { formatWithCommas, parseArabicNumber } from '../utils/numberUtils';
import { showConfirm, showAlert } from '../utils/dialogService';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas-pro';
import {
  RotateCcw,
  FileSpreadsheet,
  Upload,
  Download,
  Trash2,
  Search,
  User,
  Store,
  Scale,
  Plus,
  RefreshCw,
  Image,
  CheckCircle2,
  Calendar,
  Layers,
  X
} from 'lucide-react';

// Helper for Arabic text normalization
const normalizeArabic = (text: any): string => {
  if (text === null || text === undefined) return '';
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
};

// Color sanitizer for html2canvas compatibility
const sanitizeModernColors = (clonedDoc: Document, bgFallback: string = '#ffffff') => {
  const elements = clonedDoc.querySelectorAll('*');
  elements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const computed = window.getComputedStyle(htmlEl);
    const colorProps = ['color', 'backgroundColor', 'borderColor', 'outlineColor'];
    colorProps.forEach((prop) => {
      const val = (computed as any)[prop];
      if (val && typeof val === 'string' && (val.includes('oklch') || val.includes('oklab') || val.includes('color('))) {
        if (prop === 'color') {
          htmlEl.style.color = '#000000';
        } else if (prop === 'backgroundColor') {
          htmlEl.style.backgroundColor = bgFallback;
        } else {
          (htmlEl.style as any)[prop] = '#cbd5e1';
        }
      }
    });
  });

  if (clonedDoc.defaultView) {
    const origGetComputedStyle = clonedDoc.defaultView.getComputedStyle;
    clonedDoc.defaultView.getComputedStyle = function (elt: Element, pseudoElt?: string | null) {
      const style = origGetComputedStyle.call(this, elt, pseudoElt);
      return new Proxy(style, {
        get(target, prop) {
          if (typeof prop === 'string' && (prop === 'display' || prop === 'position' || prop === 'width' || prop === 'height')) {
            return (target as any)[prop];
          }
          const val = (target as any)[prop];
          if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab') || val.includes('color('))) {
            const p = String(prop).toLowerCase();
            if (p === 'color') return '#000000';
            if (p.includes('background')) return bgFallback;
            return '#cbd5e1';
          }
          return typeof val === 'function' ? val.bind(target) : val;
        },
      });
    };
  }
};

export const ReturnsScreen: React.FC = () => {
  const { currentUser, isDarkMode, delegatesList = [], addToast } = useSales();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportCaptureRef = useRef<HTMLDivElement>(null);

  // Role Checks
  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.name?.includes('مدخل') ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );

  const isAdminOrDataEntry = Boolean(
    currentUser?.isAdmin ||
    currentUser?.name === 'الأدمن' ||
    currentUser?.username?.toLowerCase() === 'yasir' ||
    isDataEntry
  );

  const loggedInRepName = (currentUser?.delegateName || currentUser?.name || '').trim();

  // State
  const [returnsList, setReturnsList] = useState<MonthlyDelegateReturn[]>(() => {
    try {
      const cached = localStorage.getItem('app_monthly_delegate_returns');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isDownloadingImage, setIsDownloadingImage] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // New manual entry state
  const [newEntry, setNewEntry] = useState<{
    delegateName: string;
    shopsCount: number;
    monthlyReturnedWeightKg: number;
  }>({
    delegateName: delegatesList[0] || '',
    shopsCount: 0,
    monthlyReturnedWeightKg: 0,
  });

  // Realtime Firestore synchronization
  useEffect(() => {
    setIsLoading(true);
    const colRef = collection(db, 'monthly_delegate_returns');
    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const items: MonthlyDelegateReturn[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as MonthlyDelegateReturn;
          items.push({
            ...data,
            id: docSnap.id,
            shopsCount: Number(data.shopsCount) || 0,
            monthlyReturnedWeightKg: Number(data.monthlyReturnedWeightKg) || 0,
          });
        });

        // Sort descending by weight
        items.sort((a, b) => (b.monthlyReturnedWeightKg || 0) - (a.monthlyReturnedWeightKg || 0));

        setReturnsList(items);
        localStorage.setItem('app_monthly_delegate_returns', JSON.stringify(items));
        setIsLoading(false);
      },
      (error) => {
        console.error('Error listening to monthly_delegate_returns:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Filtered list based on search term
  const filteredReturns = useMemo(() => {
    if (!searchTerm.trim()) return returnsList;
    const term = normalizeArabic(searchTerm);
    return returnsList.filter((item) => normalizeArabic(item.delegateName).includes(term));
  }, [returnsList, searchTerm]);

  // Aggregated totals
  const totalDelegatesCount = returnsList.length;
  const totalShopsCount = useMemo(
    () => returnsList.reduce((sum, r) => sum + (r.shopsCount || 0), 0),
    [returnsList]
  );
  const totalReturnedWeightKg = useMemo(
    () => Number(returnsList.reduce((sum, r) => sum + (r.monthlyReturnedWeightKg || 0), 0).toFixed(3)),
    [returnsList]
  );

  // Dedicated Excel Upload Handler
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be uploaded again if needed
    event.target.value = '';

    const confirmUpload = await showConfirm(
      `هل أنت متأكد من استيراد ملف المرتجعات الشهرية؟\n\nتنبيه: سيتم استبدال البيانات الحالية بالكامل وتحديث الجدول من الملف الجديد.`,
      {
        title: 'تأكيد استيراد ملف المرتجعات الشهرية',
        variant: 'warning',
        confirmText: 'نعم، استيراد واستبدال',
        cancelText: 'إلغاء',
      }
    );

    if (!confirmUpload) return;

    setIsUploading(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];

      const rawJson = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

      if (!rawJson || rawJson.length === 0) {
        await showAlert('ملف الإكسل فارغ ولا يحتوي على أي بيانات.', 'خطأ في الملف', 'danger');
        setIsUploading(false);
        return;
      }

      const timestampNow = Date.now();
      const currentMonthStr = new Date().toISOString().slice(0, 7);
      const parsedItems: MonthlyDelegateReturn[] = [];

      for (let i = 0; i < rawJson.length; i++) {
        const row = rawJson[i];

        // Flexible column mapping
        let delegateName = '';
        let shopsCount = 0;
        let monthlyReturnedWeightKg = 0;

        for (const [key, value] of Object.entries(row)) {
          const normKey = normalizeArabic(key).replace(/\s+/g, '');
          const strVal = String(value || '').trim();

          // 1. Delegate Name
          if (
            normKey.includes('اسم') ||
            normKey.includes('مندوب') ||
            normKey.includes('المندوب') ||
            normKey.includes('المندوبين') ||
            normKey === 'delegate' ||
            normKey === 'name' ||
            normKey === 'rep'
          ) {
            if (!delegateName && strVal) delegateName = strVal;
          }

          // 2. Shops Count
          if (
            normKey.includes('محل') ||
            normKey.includes('محلات') ||
            normKey.includes('زبون') ||
            normKey.includes('زبائن') ||
            normKey.includes('عدد') ||
            normKey === 'shops' ||
            normKey === 'customers' ||
            normKey === 'count'
          ) {
            const parsedCount = Math.round(parseArabicNumber(strVal));
            if (!isNaN(parsedCount) && parsedCount > 0) shopsCount = parsedCount;
          }

          // 3. Monthly Returned Weight (Kg)
          if (
            normKey.includes('وزن') ||
            normKey.includes('راجع') ||
            normKey.includes('شهري') ||
            normKey.includes('كغم') ||
            normKey === 'weight' ||
            normKey === 'returnedweight' ||
            normKey === 'totalweight'
          ) {
            const parsedWeight = parseArabicNumber(strVal);
            if (!isNaN(parsedWeight) && parsedWeight > 0) monthlyReturnedWeightKg = parsedWeight;
          }
        }

        // Fallback: If no column headers matched, try index-based mapping
        if (!delegateName) {
          const values = Object.values(row);
          if (values.length >= 1 && values[0]) delegateName = String(values[0]).trim();
          if (values.length >= 2) {
            shopsCount = Math.round(parseArabicNumber(String(values[1]))) || 0;
          }
          if (values.length >= 3) {
            monthlyReturnedWeightKg = parseArabicNumber(String(values[2])) || 0;
          }
        }

        if (!delegateName || delegateName === 'المجموع' || delegateName === 'المجموع الكلي') {
          continue;
        }

        const cleanWeight = Number(monthlyReturnedWeightKg.toFixed(3));

        const newItem: MonthlyDelegateReturn = {
          id: `mret_${timestampNow}_${i}_${Math.random().toString(36).substring(2, 7)}`,
          delegateName: delegateName.trim(),
          shopsCount: Math.max(0, shopsCount),
          monthlyReturnedWeightKg: cleanWeight,
          monthString: currentMonthStr,
          createdAt: timestampNow,
          updatedAt: timestampNow,
        };

        parsedItems.push(newItem);
      }

      if (parsedItems.length === 0) {
        await showAlert(
          'لم يتم العثور على أي صفوف صالحة. تأكد أن الملف يحتوي على أعمدة: اسم المندوب، عدد المحلات، والوزن الراجع الشهري.',
          'تنبيه الملف',
          'danger'
        );
        setIsUploading(false);
        return;
      }

      // Step 1: Wipe prior records from Firestore
      const oldDocsSnap = await getDocs(collection(db, 'monthly_delegate_returns'));
      const oldDocIds = oldDocsSnap.docs.map((d) => d.id);
      for (let i = 0; i < oldDocIds.length; i += 400) {
        const batch = writeBatch(db);
        const chunk = oldDocIds.slice(i, i + 400);
        chunk.forEach((docId) => batch.delete(doc(db, 'monthly_delegate_returns', docId)));
        await batch.commit();
      }

      // Step 2: Write new parsed items into Firestore
      for (let i = 0; i < parsedItems.length; i += 400) {
        const batch = writeBatch(db);
        const chunk = parsedItems.slice(i, i + 400);
        chunk.forEach((item) => batch.set(doc(db, 'monthly_delegate_returns', item.id), item));
        await batch.commit();
      }

      parsedItems.sort((a, b) => b.monthlyReturnedWeightKg - a.monthlyReturnedWeightKg);
      setReturnsList(parsedItems);
      localStorage.setItem('app_monthly_delegate_returns', JSON.stringify(parsedItems));

      addToast({
        title: 'تم استيراد الملف بنجاح',
        message: `تم تحميل بيانات ${parsedItems.length} مندوب بنجاح.`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Error importing returns Excel:', err);
      await showAlert(`فشل تحميل الملف: ${err.message || 'حدث خطأ غير معروف'}`, 'خطأ', 'danger');
    } finally {
      setIsUploading(false);
    }
  };

  // Direct Image Download to Laptop / Computer
  const handleDownloadReportAsImage = async () => {
    const el = reportCaptureRef.current;
    if (!el) {
      showAlert('تعذر العثور على عنصر التقرير لتحويله إلى صورة.', 'خطأ', 'danger');
      return;
    }

    try {
      setIsDownloadingImage(true);

      await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 250));

      const canvas = await html2canvas(el, {
        backgroundColor: '#ffffff',
        scale: 2.5, // Crisp high-DPI output for laptops
        useCORS: true,
        allowTaint: true,
        logging: false,
        onclone: (clonedDoc) => {
          sanitizeModernColors(clonedDoc, '#ffffff');

          const card = clonedDoc.getElementById('monthly-returns-report-card');
          if (card) {
            // Inject styles ensuring 100% pure black text across the entire exported report image
            const styleTag = clonedDoc.createElement('style');
            styleTag.textContent = `
              #monthly-returns-report-card,
              #monthly-returns-report-card * {
                color: #000000 !important;
                -webkit-text-fill-color: #000000 !important;
              }
              #monthly-returns-report-card {
                background-color: #ffffff !important;
                border: 2px solid #000000 !important;
                box-shadow: none !important;
              }
              #monthly-returns-report-card .border-b,
              #monthly-returns-report-card .border-t {
                border-color: #000000 !important;
              }
              #monthly-returns-report-card table {
                background-color: #ffffff !important;
                border-color: #000000 !important;
                border: 1.5px solid #000000 !important;
              }
              #monthly-returns-report-card thead th {
                background-color: #f1f5f9 !important;
                color: #000000 !important;
                font-weight: 900 !important;
                border-bottom: 2px solid #000000 !important;
              }
              #monthly-returns-report-card tbody tr {
                background-color: #ffffff !important;
                border-bottom: 1px solid #cbd5e1 !important;
              }
              #monthly-returns-report-card tbody tr:nth-child(even) {
                background-color: #f8fafc !important;
              }
              #monthly-returns-report-card tbody td {
                color: #000000 !important;
              }
              #monthly-returns-report-card tfoot tr,
              #monthly-returns-report-card tfoot td {
                background-color: #f1f5f9 !important;
                color: #000000 !important;
                font-weight: 900 !important;
                border-top: 2px solid #000000 !important;
              }
              #monthly-returns-report-card .report-actions-col {
                display: none !important;
              }
              #monthly-returns-report-card svg {
                stroke: #000000 !important;
                color: #000000 !important;
              }
            `;
            clonedDoc.head.appendChild(styleTag);

            // Traverse and directly set style.color on all elements
            const allElements = card.querySelectorAll('*');
            allElements.forEach((element) => {
              const htmlEl = element as HTMLElement;
              htmlEl.style.setProperty('color', '#000000', 'important');
              if (
                htmlEl.tagName === 'TH' ||
                htmlEl.tagName === 'TD' ||
                htmlEl.tagName === 'SPAN' ||
                htmlEl.tagName === 'H2' ||
                htmlEl.tagName === 'P' ||
                htmlEl.tagName === 'DIV'
              ) {
                htmlEl.style.setProperty('color', '#000000', 'important');
              }
            });
          }
        },
      });

      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const dateStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
      const fileName = `تقرير_المرتجعات_الشهرية_للمندوبين_${dateStr}.png`;

      // Trigger direct download to user's computer
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addToast({
        title: 'تم تحميل التقرير',
        message: 'تم تحميل تقرير المرتجعات كصورة عالية الدقة إلى جهازك بنجاح ✅',
        type: 'success',
      });
    } catch (err: any) {
      console.error('Error generating image:', err);
      showAlert('حدث خطأ أثناء إنشاء وتحميل صورة التقرير.', 'خطأ', 'danger');
    } finally {
      setIsDownloadingImage(false);
    }
  };

  // Export Table to Excel
  const handleExportToExcel = () => {
    if (returnsList.length === 0) {
      showAlert('لا توجد بيانات في جدول المرتجعات لتصديرها.', 'تنبيه', 'warning');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();
      const exportData = returnsList.map((r, idx) => ({
        'ت': idx + 1,
        'اسم المندوب': r.delegateName,
        'عدد المحلات خلال الشهر': r.shopsCount,
        'الوزن الراجع للشهري (كغم)': r.monthlyReturnedWeightKg,
      }));

      // Add summary row
      exportData.push({
        'ت': 'المجموع',
        'اسم المندوب': `${returnsList.length} مندوب`,
        'عدد المحلات خلال الشهر': totalShopsCount,
        'الوزن الراجع للشهري (كغم)': totalReturnedWeightKg,
      } as any);

      const ws = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, ws, 'المرتجعات الشهرية');

      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `تقرير_المرتجعات_الشهرية_${dateStr}.xlsx`);

      addToast({
        title: 'تم التصدير',
        message: 'تم تنزيل ملف الإكسل بنجاح.',
        type: 'success',
      });
    } catch (err) {
      console.error(err);
      showAlert('حدث خطأ أثناء تصدير ملف الإكسل.', 'خطأ', 'danger');
    }
  };

  // Download Sample Excel Template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'اسم المندوب': 'أحمد محمد',
        'عدد المحلات خلال الشهر': 18,
        'الوزن الراجع للشهري (كغم)': 245.5,
      },
      {
        'اسم المندوب': 'علي حسين',
        'عدد المحلات خلال الشهر': 12,
        'الوزن الراجع للشهري (كغم)': 180.25,
      },
      {
        'اسم المندوب': 'عمر خالد',
        'عدد المحلات خلال الشهر': 9,
        'الوزن الراجع للشهري (كغم)': 95.0,
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'نموذج_المرتجعات');
    XLSX.writeFile(wb, 'نموذج_استيراد_المرتجعات_الشهرية.xlsx');
  };

  // Clear All Data
  const handleClearAll = async () => {
    if (returnsList.length === 0) return;
    const confirmed = await showConfirm(
      `هل أنت متأكد من مسح جميع بيانات جدول المرتجعات (${returnsList.length} سجل)؟`,
      { title: 'تأكيد المسح', variant: 'danger', confirmText: 'نعم، مسح الكل', cancelText: 'إلغاء' }
    );
    if (!confirmed) return;

    try {
      const snap = await getDocs(collection(db, 'monthly_delegate_returns'));
      const docIds = snap.docs.map((d) => d.id);
      for (let i = 0; i < docIds.length; i += 400) {
        const batch = writeBatch(db);
        const chunk = docIds.slice(i, i + 400);
        chunk.forEach((id) => batch.delete(doc(db, 'monthly_delegate_returns', id)));
        await batch.commit();
      }
      setReturnsList([]);
      localStorage.removeItem('app_monthly_delegate_returns');
      addToast({
        title: 'تم المسح',
        message: 'تم تصفير جدول المرتجعات الشهرية بنجاح.',
        type: 'info',
      });
    } catch (err: any) {
      console.error(err);
      showAlert(`فشل المسح: ${err.message}`, 'خطأ', 'danger');
    }
  };

  // (Edit and Delete single row functions removed as per requirement)

  // Add Manual Row
  const handleAddManualRow = async () => {
    if (!newEntry.delegateName.trim()) {
      showAlert('يرجى تحديد أو كتابة اسم المندوب.', 'بيانات ناقصة', 'warning');
      return;
    }

    try {
      const newItem: MonthlyDelegateReturn = {
        id: `mret_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        delegateName: newEntry.delegateName.trim(),
        shopsCount: Math.max(0, parseInt(String(newEntry.shopsCount), 10) || 0),
        monthlyReturnedWeightKg: Number((parseFloat(String(newEntry.monthlyReturnedWeightKg)) || 0).toFixed(3)),
        monthString: new Date().toISOString().slice(0, 7),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, 'monthly_delegate_returns', newItem.id), newItem);
      setReturnsList((prev) => [newItem, ...prev]);
      setShowAddModal(false);
      setNewEntry({
        delegateName: delegatesList[0] || '',
        shopsCount: 0,
        monthlyReturnedWeightKg: 0,
      });

      addToast({
        title: 'تمت الإضافة',
        message: `تمت إضافة سجل ${newItem.delegateName} بنجاح.`,
        type: 'success',
      });
    } catch (err) {
      console.error(err);
      showAlert('فشل في إضافة السجل', 'خطأ', 'danger');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 space-y-6 dir-rtl text-right">
      {/* Hidden File Input for Excel Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
        className="hidden"
      />

      {/* Screen Header */}
      <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border shadow-sm transition-all ${
        isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black shrink-0 shadow-inner">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black flex items-center gap-2">
                <span>جدول المرتجعات الشهرية للمندوبين</span>
              </h1>
            </div>
          </div>

          {/* Top Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            {/* Direct Image Download Button to Laptop (Admin Only) */}
            {isAdminOrDataEntry && (
              <button
                onClick={handleDownloadReportAsImage}
                disabled={isDownloadingImage || returnsList.length === 0}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-black text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                title="تحميل التقرير على شكل صورة عالية الدقة إلى لابتوبك"
              >
                <Image className={`w-4 h-4 ${isDownloadingImage ? 'animate-spin' : ''}`} />
                <span>{isDownloadingImage ? 'جاري تجهيز الصورة...' : 'تحميل التقرير كصورة 📥'}</span>
              </button>
            )}

            {/* Excel Upload (Admin & Data Entry) */}
            {isAdminOrDataEntry && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Upload className={`w-4 h-4 ${isUploading ? 'animate-bounce' : ''}`} />
                <span>{isUploading ? 'جاري الاستيراد...' : 'استيراد إكسل'}</span>
              </button>
            )}

            {/* Export Excel (Admin Only) */}
            {isAdminOrDataEntry && (
              <button
                onClick={handleExportToExcel}
                disabled={returnsList.length === 0}
                className={`p-2.5 rounded-xl border text-xs font-bold transition-all disabled:opacity-40 flex items-center gap-1.5 ${
                  isDarkMode ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                }`}
                title="تصدير كملف إكسل"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="hidden md:inline">تصدير إكسل</span>
              </button>
            )}

            {/* Manual Add Item (Admin) */}
            {isAdminOrDataEntry && (
              <button
                onClick={() => setShowAddModal(true)}
                className={`p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 ${
                  isDarkMode ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                }`}
                title="إضافة مندوب يدوياً"
              >
                <Plus className="w-4 h-4 text-emerald-500" />
                <span className="hidden md:inline">إضافة</span>
              </button>
            )}

            {/* Clear All Data */}
            {isAdminOrDataEntry && returnsList.length > 0 && (
              <button
                onClick={handleClearAll}
                className="p-2.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100 transition-colors"
                title="مسح وتصفير السجلات"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Global Key Metrics Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          {/* Total Returned Weight */}
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${
            isDarkMode ? 'bg-slate-800/60 border-slate-700/60' : 'bg-emerald-50/70 border-emerald-200/70'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">إجمالي الوزن الراجع الشهري</span>
              <Scale className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-lg sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
              {formatWithCommas(totalReturnedWeightKg)} <span className="text-xs font-bold">كغم</span>
            </div>
          </div>

          {/* Total Shops Count */}
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${
            isDarkMode ? 'bg-slate-800/60 border-slate-700/60' : 'bg-purple-50/70 border-purple-200/70'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">إجمالي عدد المحلات خلال الشهر</span>
              <Store className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-lg sm:text-2xl font-black font-mono text-purple-600 dark:text-purple-400 mt-1">
              {formatWithCommas(totalShopsCount)} <span className="text-xs font-bold">محل</span>
            </div>
          </div>

          {/* Total Delegates Count */}
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${
            isDarkMode ? 'bg-slate-800/60 border-slate-700/60' : 'bg-blue-50/70 border-blue-200/70'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">عدد المندوبين المسجلين</span>
              <User className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-lg sm:text-2xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
              {formatWithCommas(totalDelegatesCount)} <span className="text-xs font-bold">مندوب</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Helper Filter Bar */}
      <div className={`p-3 sm:p-4 rounded-2xl border shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث باسم المندوب..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pr-9 pl-3 py-2 rounded-xl text-xs outline-none border transition-all ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500'
                : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-emerald-500'
            }`}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Template Download link for users */}
        {isAdminOrDataEntry && (
          <button
            onClick={handleDownloadTemplate}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg border border-dashed border-emerald-300 dark:border-emerald-800"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>تحميل نموذج إكسل للاستيراد</span>
          </button>
        )}
      </div>

      {/* THE MAIN REPORT CARD CONTAINER - ATTACHED WITH REF FOR HIGH-RES IMAGE CAPTURE */}
      <div
        ref={reportCaptureRef}
        id="monthly-returns-report-card"
        className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border shadow-sm space-y-4 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Table Header inside the report */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base sm:text-lg font-black flex items-center gap-2">
              <Scale className="w-5 h-5 text-emerald-500" />
              <span>جدول ملخص المرتجعات الشهري للمندوبين</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              بيانات المرتجعات للشهر الحالي مع إجمالي الأوزان وعدد المحلات
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-500 dark:text-slate-400">
            <Calendar className="w-3.5 h-3.5 text-emerald-500" />
            <span>لحد تاريخ: {new Date().toLocaleDateString('en-GB')}</span>
          </div>
        </div>

        {/* The Clean Main Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-right text-xs">
            <thead className={`font-black text-[11px] uppercase border-b ${
              isDarkMode ? 'bg-slate-800/80 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}>
              <tr>
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4">اسم المندوبين</th>
                <th className="py-3 px-4 text-center">عدد المحلات خلال الشهر</th>
                <th className="py-3 px-4 text-center font-black">الوزن الراجع للشهري (كغم)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-500" />
                    <span>جاري تحميل بيانات المرتجعات...</span>
                  </td>
                </tr>
              ) : filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400 text-xs">
                    {returnsList.length === 0
                      ? 'لا توجد بيانات مرتجعات مسجلة حالياً. يمكنك استيراد ملف إكسل بالضغط على زر "استيراد إكسل" أعلاه.'
                      : 'لا توجد نتائج مطابقة لبحثك.'}
                  </td>
                </tr>
              ) : (
                filteredReturns.map((row, idx) => {
                  const isCurrentRep = loggedInRepName && normalizeArabic(row.delegateName) === normalizeArabic(loggedInRepName);

                  return (
                    <tr
                      key={row.id || idx}
                      className={`transition-colors ${
                        isCurrentRep
                          ? isDarkMode
                            ? 'bg-emerald-950/40 hover:bg-emerald-900/40'
                            : 'bg-emerald-50 hover:bg-emerald-100/70 font-bold'
                          : idx % 2 === 0
                          ? isDarkMode
                            ? 'bg-slate-900'
                            : 'bg-white hover:bg-slate-50'
                          : isDarkMode
                          ? 'bg-slate-800/30 hover:bg-slate-800/60'
                          : 'bg-slate-50/70 hover:bg-slate-100/70'
                      }`}
                    >
                      <td className="py-3 px-4 text-center font-mono text-slate-400 text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 font-black text-slate-900 dark:text-white text-xs sm:text-sm">
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>{row.delegateName}</span>
                          {isCurrentRep && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                              (أنت)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-purple-700 dark:text-purple-400 text-xs sm:text-sm">
                        {formatWithCommas(row.shopsCount)} <span className="text-[10px] text-slate-400 font-sans">محل</span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-black text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm">
                        {formatWithCommas(row.monthlyReturnedWeightKg)} <span className="text-[10px] text-slate-400 font-sans">كغم</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer: Totals */}
            {returnsList.length > 0 && (
              <tfoot className={`font-black border-t-2 ${
                isDarkMode ? 'bg-slate-800 text-white border-slate-700' : 'bg-slate-100 text-slate-900 border-slate-300'
              }`}>
                <tr>
                  <td colSpan={2} className="py-3 px-4 text-right">
                    المجموع الكلي ({returnsList.length} مندوب):
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-purple-700 dark:text-purple-300 text-xs sm:text-sm">
                    {formatWithCommas(totalShopsCount)} محل
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-emerald-700 dark:text-emerald-300 text-xs sm:text-base">
                    {formatWithCommas(totalReturnedWeightKg)} كغم
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Footer Stamp on Image / Table */}
      </div>

      {/* MODAL: Manual Add Item */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`p-6 rounded-3xl shadow-2xl w-full max-w-md border space-y-4 ${
            isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-black text-base flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-500" />
                <span>إضافة سجل مرتجع جديد</span>
              </h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded-xl text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-bold">
              <div>
                <label className="text-slate-500 dark:text-slate-400 mb-1 block">اسم المندوب:</label>
                <input
                  type="text"
                  placeholder="مثال: أحمد محمد"
                  value={newEntry.delegateName}
                  onChange={(e) => setNewEntry({ ...newEntry, delegateName: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>

              <div>
                <label className="text-slate-500 dark:text-slate-400 mb-1 block">عدد المحلات خلال الشهر:</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newEntry.shopsCount}
                  onChange={(e) => setNewEntry({ ...newEntry, shopsCount: parseInt(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-xl border font-mono outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>

              <div>
                <label className="text-slate-500 dark:text-slate-400 mb-1 block">الوزن الراجع للشهري (كغم):</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="0.000"
                  value={newEntry.monthlyReturnedWeightKg}
                  onChange={(e) => setNewEntry({ ...newEntry, monthlyReturnedWeightKg: parseFloat(e.target.value) || 0 })}
                  className={`w-full p-2.5 rounded-xl border font-mono outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className={`flex-1 py-2.5 rounded-xl font-bold border transition-colors ${
                  isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                إلغاء
              </button>
              <button
                onClick={handleAddManualRow}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة السجل</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
