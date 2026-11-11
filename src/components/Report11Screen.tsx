import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { DailySalesCompletionBar } from './DailySalesCompletionBar';
import { PullToRefresh } from './PullToRefresh';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, writeBatch, query, where } from 'firebase/firestore';
import { safeOnSnapshot, logFirestoreErrorGracefully, isGlobalQuotaExceeded } from '../lib/firestoreUtils';
import { SalesEntry, Report11CategoryTarget, Report11Config } from '../types';
import { formatWithCommas, parseArabicDigits } from '../utils/numberUtils';
import { showConfirm } from '../utils/dialogService';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas-pro';
import { uploadExcelToSupabaseStorage } from '../lib/supabaseService';
import {
  FileSpreadsheet,
  Calendar,
  Upload,
  Download,
  Printer,
  Share2,
  TrendingUp,
  Target,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  User,
  Users,
  Save,
  Pencil,
  RotateCcw,
  Scale,
  Percent,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  Search,
  MessageCircle,
  LayoutList,
  ArrowUpDown,
  SlidersHorizontal,
  Table as TableIcon,
  ShieldCheck,
  ShoppingBag,
  Store,
  Receipt,
  Coins,
  Award,
  PackagePlus,
  Package,
  Shield,
  Trash2,
  Crown,
  X
} from 'lucide-react';
import logoImg from '../assets/images/logo.png';

// The exact 15 categories required by the user
export const REPORT_11_CATEGORIES = [
  'لبن',
  'قشطة',
  'حليب بطل',
  'حليب باكيت',
  'دانيت',
  'جبن 1',
  'جبن ويلي',
  'دوغ',
  'عصير',
  'حلويات',
  'جبن بيتزا',
  'بيتزا جاهز وبركر ومقرمش',
  'صوصج',
  'خضراوات مجمدة و فنكر',
  'صلصات'
] as const;

export const getCategoryDisplayName = (cat: string): string => {
  if (cat === 'زبادي' || cat === 'لبن') {
    return 'لبن';
  }
  if (
    cat === 'خضراوات وفنكر' ||
    cat === 'خضراوات مجمدة وفنكر' ||
    cat === 'خضروات مجمدة وفنكر' ||
    cat === 'خضروات وفنكر' ||
    cat === 'خضراوات مجمده وفنكر' ||
    cat === 'خضراوات مجمدة و فنكر' ||
    cat === 'خضروات مجمدة و فنكر'
  ) {
    return 'خضراوات مجمدة و فنكر';
  }
  if (cat === 'كل انواع الجبن العادي' || cat === 'جبن 1') {
    return 'جبن 1';
  }
  if (cat === 'مقرمش وبركر وبيتزا جاهز' || cat === 'بيتزا جاهز وبركر ومقرمش') {
    return 'بيتزا جاهز وبركر ومقرمش';
  }
  return cat;
};

export type Report11CategoryName = typeof REPORT_11_CATEGORIES[number];

// Helper to normalize Arabic strings
const normalizeArabic = (str: any): string => {
  if (str === null || str === undefined) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ');
};

// Match any raw category string (from Excel column/cell, Firestore record, or user input) to the canonical Report 11 category
export const matchReport11CategoryName = (rawInput: any): Report11CategoryName | null => {
  if (rawInput === null || rawInput === undefined) return null;
  const str = normalizeArabic(rawInput);
  if (!str) return null;

  // 1. Direct match with any canonical category
  for (const c of REPORT_11_CATEGORIES) {
    if (normalizeArabic(c) === str) return c;
  }

  // Handle old canonical names mapping to new ones
  if (
    str === normalizeArabic('زبادي') ||
    str === normalizeArabic('لبن') ||
    str === normalizeArabic('اللبن') ||
    str === normalizeArabic('خاثر') ||
    str === normalizeArabic('الخاثر') ||
    str === normalizeArabic('البان') ||
    str === normalizeArabic('الالبان') ||
    str === normalizeArabic('ماست')
  ) {
    return 'لبن';
  }
  if (str === normalizeArabic('كل انواع الجبن العادي') || str === normalizeArabic('جبن 1') || str === normalizeArabic('جبن1')) {
    return 'جبن 1';
  }
  if (str === normalizeArabic('مقرمش وبركر وبيتزا جاهز') || str === normalizeArabic('بيتزا جاهز وبركر ومقرمش')) {
    return 'بيتزا جاهز وبركر ومقرمش';
  }
  if (str === normalizeArabic('خضراوات مجمدة وفنكر') || str === normalizeArabic('خضراوات مجمدة و فنكر')) {
    return 'خضراوات مجمدة و فنكر';
  }

  // 2. Vegetables & Fries (خضراوات مجمدة و فنكر / خضراوات وفنكر / خضروات / فنكر / بطاطا / مجمدات)
  if (
    str.includes('خضراوات') ||
    str.includes('خضروات') ||
    str.includes('خضار') ||
    str.includes('فنكر') ||
    str.includes('فنجر') ||
    str.includes('بطاطا') ||
    str.includes('بازلاء') ||
    str.includes('مجمدات')
  ) {
    return 'خضراوات مجمدة و فنكر';
  }

  // 3. Pizza cheese (جبن بيتزا)
  if (
    str.includes('جبن بيتزا') ||
    str.includes('جبنه بيتزا') ||
    str.includes('موزاريلا') ||
    (str.includes('بيتزا') && str.includes('جبن'))
  ) {
    return 'جبن بيتزا';
  }

  // 4. Willy cheese (جبن ويلي)
  if (str.includes('ويلي') || str.includes('willy')) {
    return 'جبن ويلي';
  }

  // 5. Crispy & Burger & Ready Pizza (بيتزا جاهز وبركر ومقرمش)
  if (
    str.includes('مقرمش') ||
    str.includes('بركر') ||
    str.includes('برغر') ||
    str.includes('ناجتس') ||
    str.includes('زنجر') ||
    str.includes('ستريبس') ||
    (str.includes('بيتزا') && str.includes('جاهز'))
  ) {
    return 'بيتزا جاهز وبركر ومقرمش';
  }

  // 6. Danette (دانيت)
  if (str.includes('دانيت') || str.includes('danette')) {
    return 'دانيت';
  }

  // 7. Bottle milk (حليب بطل)
  if (
    str.includes('حليب بطل') ||
    str.includes('حليب قنينه') ||
    (str.includes('حليب') && (str.includes('بطل') || str.includes('زجاج')))
  ) {
    return 'حليب بطل';
  }

  // 8. Packet milk (حليب باكيت)
  if (
    str.includes('حليب باكيت') ||
    str.includes('حليب كارتون') ||
    str.includes('حليب كرتون') ||
    str.includes('حليب تترا') ||
    (str.includes('حليب') && str.includes('باكيت'))
  ) {
    return 'حليب باكيت';
  }

  // 9. Sausage (صوصج)
  if (str.includes('صوصج') || str.includes('سجق') || str.includes('سوسج') || str.includes('نقانق')) {
    return 'صوصج';
  }

  // 10. All regular cheese (جبن 1 / كل انواع الجبن العادي)
  if (
    str.includes('جبن 1') ||
    str === 'جبن' ||
    str.includes('جبن عادي') ||
    str.includes('اجبان') ||
    str.includes('فيتا') ||
    str.includes('شيدر') ||
    str.includes('حلوم') ||
    str.includes('قشقوان') ||
    str.includes('كاسات') ||
    str.includes('مثلثات') ||
    str.includes('لبنه') ||
    str.includes('لبنة')
  ) {
    return 'جبن 1';
  }

  // 11. Doogh (دوغ)
  if (str.includes('دوغ') || str.includes('شنينه') || str.includes('عيران')) {
    return 'دوغ';
  }

  // 12. Cream (قشطة)
  if (str.includes('قشط') || str.includes('قيمر')) {
    return 'قشطة';
  }

  // 13. Yogurt / Laban (لبن / زبادي / خاثر / ألبان / ماست / رائب / سفن / جاموس)
  if (
    str.includes('زبادي') ||
    str.includes('لبن') ||
    str.includes('خاثر') ||
    str.includes('البان') ||
    str.includes('ماست') ||
    str.includes('رايب') ||
    str.includes('رائب') ||
    str.includes('يوغرت') ||
    str.includes('سفن') ||
    str.includes('جاموس') ||
    str === 'لبن' ||
    str === 'اللبن' ||
    str === 'زبادي' ||
    str === 'الزبادي' ||
    str === 'خاثر' ||
    str === 'الخاثر' ||
    str === 'البان' ||
    str === 'الالبان' ||
    str === 'ماست' ||
    str === 'الماست'
  ) {
    return 'لبن';
  }

  // 14. Juice (عصير)
  if (str.includes('عصير')) {
    return 'عصير';
  }

  // 15. Sweets (حلويات)
  if (str.includes('حلويات') || str.includes('كاسترد') || str.includes('مهلبيه')) {
    return 'حلويات';
  }

  // 16. Sauces (صلصات)
  if (str.includes('صلص') || str.includes('مايونيز') || str.includes('كاتشب')) {
    return 'صلصات';
  }

  // Substring fallback
  for (const c of REPORT_11_CATEGORIES) {
    const normC = normalizeArabic(c);
    if (str.includes(normC) || normC.includes(str)) {
      return c;
    }
  }

  return null;
};

// Check if two category strings refer to the same canonical Report 11 category
export const isMatchingReport11Category = (catA: any, catB: any): boolean => {
  if (!catA || !catB) return false;
  if (catA === catB) return true;
  const normA = normalizeArabic(catA);
  const normB = normalizeArabic(catB);
  if (normA === normB) return true;

  const mA = matchReport11CategoryName(catA);
  const mB = matchReport11CategoryName(catB);
  if (mA && mB && mA === mB) return true;

  // Extra check for vegetables and fries variations
  const isVegA = normA.includes('خضراوات') || normA.includes('خضروات') || normA.includes('خضار') || normA.includes('فنكر') || normA.includes('فنجر') || normA.includes('بطاطا');
  const isVegB = normB.includes('خضراوات') || normB.includes('خضروات') || normB.includes('خضار') || normB.includes('فنكر') || normB.includes('فنجر') || normB.includes('بطاطا');
  if (isVegA && isVegB) return true;

  // Extra check for laban / yogurt / khather / alba'an variations
  const isLabanA = normA.includes('لبن') || normA.includes('زبادي') || normA.includes('خاثر') || normA.includes('البان') || normA.includes('ماست') || normA.includes('رايب') || normA.includes('رائب') || normA.includes('سفن') || normA.includes('جاموس');
  const isLabanB = normB.includes('لبن') || normB.includes('زبادي') || normB.includes('خاثر') || normB.includes('البان') || normB.includes('ماست') || normB.includes('رايب') || normB.includes('رائب') || normB.includes('سفن') || normB.includes('جاموس');
  if (isLabanA && isLabanB) return true;

  return false;
};

// Smart category matcher: maps any sales invoice entry to one of the 15 categories
export const matchSalesEntryToReport11Category = (entry: SalesEntry): Report11CategoryName | null => {
  const cat = normalizeArabic(entry.categoryName || '');
  const prod = normalizeArabic(entry.productName || '');
  const combined = `${cat} ${prod}`;

  // 1. Willy cheese (جبن ويلي)
  if (combined.includes('ويلي') || combined.includes('willy')) {
    return 'جبن ويلي';
  }

  // 2. Pizza cheese (جبن بيتزا)
  if (
    combined.includes('جبن بيتزا') ||
    combined.includes('جبنه بيتزا') ||
    combined.includes('موزاريلا بيتزا') ||
    (cat.includes('جبن بيتزا') && !combined.includes('جاهز'))
  ) {
    return 'جبن بيتزا';
  }

  // 3. Danette (دانيت)
  if (combined.includes('دانيت') || combined.includes('danette')) {
    return 'دانيت';
  }

  // 4. Bottle milk (حليب بطل)
  if (
    combined.includes('حليب بطل') ||
    combined.includes('حليب قنينه') ||
    (combined.includes('حليب') && (combined.includes('بطل') || combined.includes('زجاج')))
  ) {
    return 'حليب بطل';
  }

  // 5. Packet milk (حليب باكيت)
  if (
    combined.includes('حليب باكيت') ||
    combined.includes('حليب كارتون') ||
    combined.includes('حليب كرتون') ||
    combined.includes('حليب تترا') ||
    (combined.includes('حليب') && combined.includes('باكيت'))
  ) {
    return 'حليب باكيت';
  }

  // 6. Regular cheese (جبن 1 / كل انواع الجبن العادي)
  if (
    cat === 'جبن 1' ||
    cat === 'جبن' ||
    cat.includes('جبن عادي') ||
    combined.includes('جبن 1') ||
    combined.includes('جبن ابيض') ||
    combined.includes('جبن مثلثات') ||
    combined.includes('جبن كاسات') ||
    combined.includes('جبن فيتا') ||
    combined.includes('جبن شيدر') ||
    combined.includes('جبن حلوم') ||
    combined.includes('جبن قشقوان') ||
    combined.includes('جبن كريم') ||
    combined.includes('لبنه') ||
    combined.includes('لبنة') ||
    (combined.includes('جبن') && !combined.includes('بيتزا') && !combined.includes('ويلي'))
  ) {
    return 'جبن 1';
  }

  // 7. Doogh (دوغ)
  if (combined.includes('دوغ') || combined.includes('شنينه') || combined.includes('عيران') || cat === 'دوغ') {
    return 'دوغ';
  }

  // 8. Cream (قشطة)
  if (combined.includes('قشطه') || combined.includes('قيمر') || cat === 'قشطه') {
    return 'قشطة';
  }

  // 9. Yogurt / Laban (لبن)
  if (
    combined.includes('زبادي') ||
    combined.includes('لبن') ||
    combined.includes('يوغرت') ||
    combined.includes('خاثر') ||
    combined.includes('البان') ||
    combined.includes('ماست') ||
    combined.includes('رايب') ||
    combined.includes('رائب') ||
    combined.includes('سفن') ||
    combined.includes('جاموس') ||
    cat.includes('لبن') ||
    cat.includes('زبادي') ||
    cat.includes('خاثر') ||
    cat.includes('البان') ||
    cat.includes('ماست') ||
    cat === 'لبن' ||
    cat === 'زبادي' ||
    cat === 'خاثر' ||
    cat === 'البان' ||
    cat === 'ماست'
  ) {
    return 'لبن';
  }

  // 10. Juice (عصير)
  if (combined.includes('عصير') || cat === 'عصير') {
    return 'عصير';
  }

  // 11. Sweets (حلويات)
  if (
    combined.includes('حلويات') ||
    combined.includes('كاسترد') ||
    combined.includes('مهلبيه') ||
    cat === 'حلويات'
  ) {
    return 'حلويات';
  }

  // 12. Crispy, Burger & Ready Pizza (بيتزا جاهز وبركر ومقرمش)
  if (
    combined.includes('مقرمش') ||
    combined.includes('بركر') ||
    combined.includes('برغر') ||
    combined.includes('بيتزا جاهز') ||
    combined.includes('بيتزا جاهزه') ||
    combined.includes('ناجتس') ||
    combined.includes('زنجر') ||
    combined.includes('ستريبس') ||
    cat === 'بيتزا جاهز وبركر ومقرمش' ||
    cat === 'مقرمش وبركر وبيتزا جاهز'
  ) {
    return 'بيتزا جاهز وبركر ومقرمش';
  }

  // 13. Sausage (صوصج)
  if (combined.includes('صوصج') || combined.includes('سجق') || combined.includes('سوسج') || cat === 'صوصج') {
    return 'صوصج';
  }

  // 14. Vegetables & Fries (خضراوات مجمدة و فنكر)
  if (
    combined.includes('خضراوات') ||
    combined.includes('خضروات') ||
    combined.includes('خضار') ||
    combined.includes('فنكر') ||
    combined.includes('فنجر') ||
    combined.includes('بطاطا') ||
    combined.includes('بازلاء') ||
    combined.includes('مجمدات') ||
    cat.includes('خضراوات') ||
    cat.includes('خضروات') ||
    cat.includes('فنكر') ||
    cat === 'خضراوات مجمده و فنكر' ||
    cat === 'خضروات مجمده و فنكر' ||
    cat === 'خضراوات وفنكر' ||
    cat === 'خضروات وفنكر' ||
    cat === 'خضراوات مجمدة وفنكر' ||
    cat === 'خضروات مجمدة وفنكر' ||
    cat === 'خضراوات مجمدة و فنكر'
  ) {
    return 'خضراوات مجمدة و فنكر';
  }

  // 15. Sauces (صلصات)
  if (
    combined.includes('صلصات') ||
    combined.includes('صلصه') ||
    combined.includes('مايونيز') ||
    combined.includes('كاتشب') ||
    cat === 'صلصات'
  ) {
    return 'صلصات';
  }

  // Direct exact match
  for (const c of REPORT_11_CATEGORIES) {
    if (normalizeArabic(c) === cat || normalizeArabic(c) === prod) {
      return c;
    }
  }

  return null;
};

// Calculate default remaining working days in current month excluding Fridays
export const calculateRemainingWorkingDaysInMonth = (): number => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  
  let workingDays = 0;
  for (let day = today; day <= lastDay; day++) {
    const d = new Date(year, month, day);
    // 5 = Friday
    if (d.getDay() !== 5) {
      workingDays++;
    }
  }
  return Math.max(1, workingDays);
};

export const Report11Screen: React.FC = () => {
  const {
    currentUser,
    delegatesList = [],
    delegateAccounts = [],
    salesEntries = [],
    allSalesEntries = [],
    productsList = [],
    selectedDate,
    setSelectedDate,
    calculateUnifiedSalesStats,
    isDarkMode,
    setUserMessage,
    refreshAllData
  } = useSales();

  const printRef = useRef<HTMLDivElement>(null);
  const allSalesTableRef = useRef<HTMLDivElement>(null);

  const handleExportAllSalesTableJpeg = async () => {
    if (!allSalesTableRef.current) return;
    try {
      setUserMessage('جاري تجهيز وتحويل الجدول إلى صورة JPEG... 📸');
      const canvas = await html2canvas(allSalesTableRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#1c1917'
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `تقرير_مبيعات_الكل_${todayDateString}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (navigator.canShare && navigator.canShare({ files: [new File([], 'test')] })) {
        canvas.toBlob(async (blob) => {
          if (blob) {
            const file = new File([blob], `تقرير_مبيعات_الكل_${todayDateString}.jpg`, { type: 'image/jpeg' });
            try {
              await navigator.share({
                title: 'تقرير مبيعات الكل',
                text: `📊 تقرير مبيعات الكل (مفرد + جملة) - التاريخ: ${todayDateString}`,
                files: [file]
              });
              setUserMessage('تم مشاركة صورة التقرير بنجاح 📤✅');
              return;
            } catch (e) {}
          }
        }, 'image/jpeg', 0.95);
      }

      let text = `📊 *تقرير مبيعات الكل (مفرد + جملة)*\n`;
      text += `📅 *التاريخ:* ${todayDateString}\n`;
      text += `📦 *إجمالي الفواتير:* ${totalAllStats.count}\n`;
      text += `⚖️ *إجمالي الوزن:* ${formatWithCommas(Math.round(totalAllStats.weight), true)} كغم\n`;
      text += `💰 *إجمالي المبلغ:* ${formatWithCommas(totalAllStats.amount, true)}\n`;
      text += `(تم تنزيل صورة التقرير بصيغة JPEG على جهازك 📷✅)`;

      const encoded = encodeURIComponent(text);
      window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
      setUserMessage('تم تنزيل صورة التقرير JPEG وفتح واتساب بنجاح 🖼️📲');
    } catch (err) {
      console.error('Error exporting table to JPEG:', err);
      setUserMessage('حدث خطأ أثناء تصدير الجدول كصورة');
    }
  };

  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.username?.toLowerCase() === 'supervisor' ||
    currentUser?.name === 'مشرف'
  );

  const isRafatJamal = Boolean(currentUser?.name === 'رأفت جمال' || currentUser?.username?.toLowerCase() === 'rafatdata');

  const isAdmin = Boolean(
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    currentUser?.name === 'الأدمن'
  );

  // Comprehensive report view tab & collapse state
  const [comprehensiveViewTab, setComprehensiveViewTab] = useState<'all' | 'retail' | 'wholesale' | 'three_tables'>('all');
  const [isComprehensiveCollapsed, setIsComprehensiveCollapsed] = useState(true);

  // Targets state: loaded from Firestore collection report11_targets
  const [categoryTargets, setCategoryTargets] = useState<Report11CategoryTarget[]>(() => {
    try {
      const cached = localStorage.getItem('cache_report11_targets');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  // Config: working days & remaining days
  const [config, setConfig] = useState<Report11Config>(() => {
    try {
      const cached = localStorage.getItem('cache_report11_config');
      if (cached) return JSON.parse(cached);
    } catch {}
    return {
      workingDays: 26,
      remainingDays: calculateRemainingWorkingDaysInMonth()
    };
  });

  const [inputWorkingDays, setInputWorkingDays] = useState<number | string>(config.workingDays || 26);
  const [inputRemainingDays, setInputRemainingDays] = useState<number | string>(config.remainingDays || calculateRemainingWorkingDaysInMonth());
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Completed delegates state from daily_sales_completion
  const [completedDelegatesMap, setCompletedDelegatesMap] = useState<Record<string, boolean>>({});

  const isDelegateCompleted = useCallback((name: string): boolean => {
    if (!name) return false;
    const norm = normalizeArabic(name);
    return Boolean(completedDelegatesMap[norm] || completedDelegatesMap[name.trim()]);
  }, [completedDelegatesMap]);

  // List of active delegates to present (excluding system/admin names and شرقاط)
  const delegateNamesList = useMemo(() => {
    const list = delegatesList.filter(
      d => d !== 'الكل' && d !== 'الأدمن' && d !== 'رأفت جمال' && !d.toLowerCase().includes('sauce') && !d.includes('مندوب عام 1') && !d.includes('مندوب عام 2') && !normalizeArabic(d).includes('شرقاط')
    );
    // Guarantee the standard delegates always exist (excluding شرقاط)
    const standard = ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال', 'محمد جاسم', 'ناجي خلف', 'صباح فرحان'];
    standard.forEach(s => {
      if (!list.includes(s) && !normalizeArabic(s).includes('شرقاط')) list.push(s);
    });
    return list;
  }, [delegatesList]);

  // Active delegate selection:
  // Standard default for admin is supervisor view (__SUPERVISOR__).
  const defaultDelegate = useMemo(() => {
    if (!isAdmin) {
      return currentUser?.name || 'مندوب';
    }
    return '__SUPERVISOR__';
  }, [isAdmin, currentUser]);

  const [activeDelegate, setActiveDelegate] = useState<string>(defaultDelegate);
  const [viewMode, setViewMode] = useState<'single' | 'all'>('all');

  // Excel Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [extraTargetsList, setExtraTargetsList] = useState<any[]>([]);
  const [delegateIncentives, setDelegateIncentives] = useState<any[]>([]);
  const [specificProductTargets, setSpecificProductTargets] = useState<any[]>([]);
  const [specificProductName, setSpecificProductName] = useState<string>('جبن اماه 200 غم');
  const [tempSpecificProductName, setTempSpecificProductName] = useState<string>('جبن اماه 200 غم');
  const [isSavingSpecificProductName, setIsSavingSpecificProductName] = useState<boolean>(false);
  const [showAdminSpecificBreakdown, setShowAdminSpecificBreakdown] = useState<boolean>(true);

  // Dedicated refs & messages for Excel uploads
  const specificProductExcelInputRef = useRef<HTMLInputElement>(null);
  const monthlyExcelInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingMonthlyExcel, setIsUploadingMonthlyExcel] = useState<boolean>(false);
  const [monthlyUploadMessage, setMonthlyUploadMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isUploadingSpecificProductExcel, setIsUploadingSpecificProductExcel] = useState<boolean>(false);
  const [specificProductUploadMessage, setSpecificProductUploadMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Extra targets modal state
  const [showEditExtraTargetsModal, setShowEditExtraTargetsModal] = useState<boolean>(false);
  const [editExtraTargetDelegate, setEditExtraTargetDelegate] = useState<string>('');
  const [editMonthlyIqdTarget, setEditMonthlyIqdTarget] = useState<string>('');
  const [editMonthlyIqdSales, setEditMonthlyIqdSales] = useState<string>('');
  const [editTargetShopsCount, setEditTargetShopsCount] = useState<string>('');
  const [editExtraProductName, setEditExtraProductName] = useState<string>('جبن مسدمر مثلث 90 غم');
  const [editExtraProductCustomersTarget, setEditExtraProductCustomersTarget] = useState<string>('');
  const [isSavingExtraTargets, setIsSavingExtraTargets] = useState<boolean>(false);

  // Specific product modal state
  const [showEditSpecificProductModal, setShowEditSpecificProductModal] = useState<boolean>(false);
  const [editSpecificProductDelegate, setEditSpecificProductDelegate] = useState<string>('');
  const [editSpecificTargetPieces, setEditSpecificTargetPieces] = useState<string>('');
  const [editSpecificSalesPieces, setEditSpecificSalesPieces] = useState<string>('');
  const [editSpecificTargetCartons, setEditSpecificTargetCartons] = useState<string>('');
  const [editSpecificSalesCartons, setEditSpecificSalesCartons] = useState<string>('');
  const [editSpecificTargetShops, setEditSpecificTargetShops] = useState<string>('');
  const [editSpecificActualShops, setEditSpecificActualShops] = useState<string>('');
  const [isSavingSpecificProductModal, setIsSavingSpecificProductModal] = useState<boolean>(false);

  // Inline editing state for Admin
  const [editingCell, setEditingCell] = useState<{
    delegateName: string;
    categoryName: string;
    field: 'monthlyTarget' | 'monthlySales';
  } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Keep activeDelegate in sync with role
  useEffect(() => {
    if (!isAdmin && currentUser?.name) {
      setActiveDelegate(currentUser.name);
    }
  }, [isAdmin, currentUser]);

  // Keep local inputs synced with config updates
  useEffect(() => {
    if (config.workingDays !== undefined) setInputWorkingDays(config.workingDays);
    if (config.remainingDays !== undefined) setInputRemainingDays(config.remainingDays);
  }, [config]);

  // 1. Listen for report11_targets from Firestore
  useEffect(() => {
    if (isGlobalQuotaExceeded()) return;

    const unsubTargets = safeOnSnapshot(
      collection(db, 'report11_targets'),
      (snapshot: any) => {
        const list: Report11CategoryTarget[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as Report11CategoryTarget;
          if (data && data.delegateName && data.categoryName) {
            list.push({ ...data, id: docSnap.id });
          }
        });

        // Keep report11_targets strictly synced with Firestore and Excel uploads
        setCategoryTargets(list);
        try {
          localStorage.setItem('cache_report11_targets', JSON.stringify(list));
        } catch {}
      },
      (err: any) => logFirestoreErrorGracefully(err, 'report11_targets'),
      'report11_targets'
    );

    // 2. Listen for report11_config
    const unsubConfig = safeOnSnapshot(
      doc(db, 'app_settings', 'report11_config'),
      (snap: any) => {
        if (snap.exists()) {
          const data = snap.data() as Report11Config;
          if (data) {
            setConfig(prev => ({
              workingDays: typeof data.workingDays === 'number' ? data.workingDays : prev.workingDays,
              remainingDays: typeof data.remainingDays === 'number' ? data.remainingDays : prev.remainingDays,
              updatedAt: data.updatedAt,
              updatedBy: data.updatedBy
            }));
            try {
              localStorage.setItem('cache_report11_config', JSON.stringify(data));
            } catch {}
          }
        }
      },
      (err: any) => logFirestoreErrorGracefully(err, 'report11_config'),
      'report11_config'
    );

    const unsubExtra = safeOnSnapshot(
      collection(db, 'delegate_monthly_extra_targets'),
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => list.push({ ...d.data(), id: d.id }));
        setExtraTargetsList(list);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'delegate_monthly_extra_targets'),
      'delegate_monthly_extra_targets'
    );

    const unsubInc = safeOnSnapshot(
      collection(db, 'delegate_incentives'),
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => list.push({ ...d.data(), id: d.id }));
        setDelegateIncentives(list);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'delegate_incentives'),
      'delegate_incentives'
    );

    const unsubSpec = safeOnSnapshot(
      collection(db, 'specific_product_targets'),
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => list.push({ ...d.data(), id: d.id }));
        if (list.length === 0) {
          const defaultImageTargets = [
            { delegateName: 'بكر بدران', productName: 'جبن اماه 200 غم', targetPieces: 230, salesPiecesOverride: 53, targetCartons: 13, salesCartonsOverride: 2.9, targetShops: 30, actualShopsOverride: 7 },
            { delegateName: 'فيصل فؤاد', productName: 'جبن اماه 200 غم', targetPieces: 230, salesPiecesOverride: 146, targetCartons: 13, salesCartonsOverride: 8.1, targetShops: 30, actualShopsOverride: 16 },
            { delegateName: 'خلدون جمال', productName: 'جبن اماه 200 غم', targetPieces: 230, salesPiecesOverride: 54, targetCartons: 13, salesCartonsOverride: 3.0, targetShops: 30, actualShopsOverride: 3 },
            { delegateName: 'محمد جاسم', productName: 'جبن اماه 200 غم', targetPieces: 230, salesPiecesOverride: 239, targetCartons: 13, salesCartonsOverride: 13.3, targetShops: 30, actualShopsOverride: 29 },
            { delegateName: 'ناجي خلف', productName: 'جبن اماه 200 غم', targetPieces: 230, salesPiecesOverride: 18, targetCartons: 13, salesCartonsOverride: 1.0, targetShops: 30, actualShopsOverride: 2 },
            { delegateName: 'صباح فرحان', productName: 'جبن اماه 200 غم', targetPieces: 230, salesPiecesOverride: 92, targetCartons: 13, salesCartonsOverride: 5.1, targetShops: 30, actualShopsOverride: 8 }
          ];
          setSpecificProductTargets(defaultImageTargets);
          try {
            const batch = writeBatch(db);
            defaultImageTargets.forEach((t) => {
              const docKey = `del_${t.delegateName}`.replace(/[\/\s#$[\]]/g, '_');
              batch.set(doc(db, 'specific_product_targets', docKey), { ...t, updatedAt: new Date().toISOString() }, { merge: true });
            });
            batch.commit();
          } catch (e) {}
        } else {
          setSpecificProductTargets(list);
        }
      },
      (err: any) => logFirestoreErrorGracefully(err, 'specific_product_targets'),
      'specific_product_targets'
    );

    const unsubSpecName = safeOnSnapshot(
      doc(db, 'app_settings', 'specific_product_name'),
      (snap: any) => {
        if (snap.exists() && snap.data()?.productName) {
          setSpecificProductName(snap.data().productName);
        } else {
          setSpecificProductName('جبن اماه 200 غم');
        }
      },
      (err: any) => logFirestoreErrorGracefully(err, 'specific_product_name'),
      'specific_product_name'
    );
    const todayStr = new Date().toISOString().split('T')[0];
    const qComp = query(collection(db, 'daily_sales_completion'), where('date', '==', todayStr));
    const unsubCompletion = safeOnSnapshot(
      qComp,
      (snap: any) => {
        const map: Record<string, boolean> = {};
        snap.forEach((d: any) => {
          const data = d.data();
          if (data && data.delegate) {
            const del = String(data.delegate).trim();
            map[normalizeArabic(del)] = true;
            map[del] = true;
          }
        });
        setCompletedDelegatesMap(map);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'daily_sales_completion'),
      'Report11Screen-completion'
    );

    return () => {
      unsubTargets();
      unsubConfig();
      unsubExtra();
      unsubInc();
      unsubSpec();
      unsubSpecName();
      unsubCompletion();
    };
  }, []);

  // Save Working Days and Remaining Days
  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    const newConfig: Report11Config = {
      workingDays: Math.max(1, Number(inputWorkingDays) || 26),
      remainingDays: Math.max(1, Number(inputRemainingDays) || 1),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.name || 'الأدمن'
    };

    setConfig(newConfig);
    try {
      localStorage.setItem('cache_report11_config', JSON.stringify(newConfig));
      await setDoc(doc(db, 'app_settings', 'report11_config'), newConfig, { merge: true });
      setUserMessage('تم حفظ وتحديث أيام العمل والأيام المتبقية بنجاح ومزامنتها لجميع المندوبين ⏱️✅');
    } catch (err) {
      console.error('Error saving report11 config:', err);
      setUserMessage('حدث خطأ أثناء حفظ أيام العمل');
    } finally {
      setIsSavingConfig(false);
    }
  };



  // Daily Sales calculation for today from invoices:
  // Grouped by delegateName and matched to the 15 categories
  const todayDateString = useMemo(() => {
    return selectedDate || new Date().toISOString().split('T')[0];
  }, [selectedDate]);

  const salesPool = useMemo(() => {
    // If allSalesEntries is available, use it; otherwise fallback to salesEntries
    if (allSalesEntries && allSalesEntries.length > 0) return allSalesEntries;
    return salesEntries;
  }, [allSalesEntries, salesEntries]);

  // Map: delegateName -> categoryName -> total sales kg for today
  const dailySalesByDelegateAndCat = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};

    // Initialize all delegates and categories
    delegateNamesList.forEach(del => {
      map[del] = {};
      REPORT_11_CATEGORIES.forEach(cat => {
        map[del][cat] = 0;
      });
    });

    salesPool.forEach(entry => {
      if (entry.status === 'cancelled') return;
      if (entry.dateString !== todayDateString) return;

      const delName = entry.delegateName ? entry.delegateName.trim() : '';
      if (!delName) return;

      // Find matched delegate
      const matchedDel = delegateNamesList.find(
        d => normalizeArabic(d) === normalizeArabic(delName)
      ) || delName;

      if (!map[matchedDel]) {
        map[matchedDel] = {};
        REPORT_11_CATEGORIES.forEach(cat => {
          map[matchedDel][cat] = 0;
        });
      }

      const matchedCat = matchSalesEntryToReport11Category(entry);
      if (matchedCat) {
        const weight = Number(entry.totalWeightKg) || 0;
        map[matchedDel][matchedCat] = (map[matchedDel][matchedCat] || 0) + weight;
      }
    });

    return map;
  }, [salesPool, todayDateString, delegateNamesList]);

  // Compute full table rows for a specific delegate
  const getDelegateTableData = useCallback((delName: string) => {
    const remainingDays = Math.max(1, config.remainingDays || 1);
    const delNorm = normalizeArabic(delName);

    let totalMonthlyTarget = 0;
    let totalMonthlySales = 0;
    let totalRemainingMonthly = 0;
    let totalDailyTarget = 0;
    let totalDailySales = 0;

    const rows = REPORT_11_CATEGORIES.map(categoryName => {
      const catNorm = normalizeArabic(categoryName);

      // Find target record using robust category matcher
      const targetObj = categoryTargets.find(
        t => {
          if (normalizeArabic(t.delegateName) !== delNorm) return false;
          return isMatchingReport11Category(t.categoryName, categoryName);
        }
      );

      const monthlyTarget = targetObj ? (Number(targetObj.monthlyTarget) || 0) : 0;
      const monthlySales = targetObj ? (Number(targetObj.monthlySales) || 0) : 0;
      
      // المتبقي من الهدف الشهري
      const remainingMonthly = Math.max(0, monthlyTarget - monthlySales);
      
      // التاركت اليومي = المتبقي من الهدف الشهري / عدد الأيام المتبقية
      const dailyTarget = remainingDays > 0 ? (remainingMonthly / remainingDays) : 0;
      
      // المبيعات اليومية من الفواتير لليوم
      const dailySales = (dailySalesByDelegateAndCat[delName] && dailySalesByDelegateAndCat[delName][categoryName]) || 0;

      // النسب المئوية
      const dailyPct = dailyTarget > 0 ? (dailySales / dailyTarget) * 100 : 0;
      const monthlyPct = monthlyTarget > 0 ? (monthlySales / monthlyTarget) * 100 : 0;

      totalMonthlyTarget += monthlyTarget;
      totalMonthlySales += monthlySales;
      totalRemainingMonthly += remainingMonthly;
      totalDailyTarget += dailyTarget;
      totalDailySales += dailySales;

      return {
        categoryName,
        monthlyTarget,
        monthlySales,
        remainingMonthly,
        dailyTarget,
        dailySales,
        dailyPct,
        monthlyPct
      };
    });

    const totalDailyPct = totalDailyTarget > 0 ? (totalDailySales / totalDailyTarget) * 100 : 0;
    const totalMonthlyPct = totalMonthlyTarget > 0 ? (totalMonthlySales / totalMonthlyTarget) * 100 : 0;

    return {
      delegateName: delName,
      rows,
      totals: {
        totalMonthlyTarget,
        totalMonthlySales,
        totalRemainingMonthly,
        totalDailyTarget,
        totalDailySales,
        totalDailyPct,
        totalMonthlyPct
      }
    };
  }, [categoryTargets, config.remainingDays, dailySalesByDelegateAndCat]);

  // Aggregated Supervisor Table Data (Sums up daily and monthly sales & targets of all delegates across all 15 categories)
  const supervisorTableData = useMemo(() => {
    let totalMonthlyTarget = 0;
    let totalMonthlySales = 0;
    let totalRemainingMonthly = 0;
    let totalDailyTarget = 0;
    let totalDailySales = 0;

    const remainingDays = Math.max(1, config.remainingDays || 1);

    const rows = REPORT_11_CATEGORIES.map(categoryName => {
      let catMonthlyTarget = 0;
      let catMonthlySales = 0;
      let catDailySales = 0;

      delegateNamesList.forEach(del => {
        const delNorm = normalizeArabic(del);
        const targetObj = categoryTargets.find(t => {
          if (normalizeArabic(t.delegateName) !== delNorm) return false;
          return isMatchingReport11Category(t.categoryName, categoryName);
        });

        if (targetObj) {
          catMonthlyTarget += Number(targetObj.monthlyTarget) || 0;
          catMonthlySales += Number(targetObj.monthlySales) || 0;
        }

        const dSales = (dailySalesByDelegateAndCat[del] && dailySalesByDelegateAndCat[del][categoryName]) || 0;
        catDailySales += dSales;
      });

      const remainingMonthly = Math.max(0, catMonthlyTarget - catMonthlySales);
      const catDailyTarget = remainingDays > 0 ? (remainingMonthly / remainingDays) : 0;
      const dailyPct = catDailyTarget > 0 ? (catDailySales / catDailyTarget) * 100 : 0;
      const monthlyPct = catMonthlyTarget > 0 ? (catMonthlySales / catMonthlyTarget) * 100 : 0;

      totalMonthlyTarget += catMonthlyTarget;
      totalMonthlySales += catMonthlySales;
      totalRemainingMonthly += remainingMonthly;
      totalDailyTarget += catDailyTarget;
      totalDailySales += catDailySales;

      return {
        categoryName,
        monthlyTarget: catMonthlyTarget,
        monthlySales: catMonthlySales,
        remainingMonthly,
        dailyTarget: catDailyTarget,
        dailySales: catDailySales,
        dailyPct,
        monthlyPct
      };
    });

    const totalDailyPct = totalDailyTarget > 0 ? (totalDailySales / totalDailyTarget) * 100 : 0;
    const totalMonthlyPct = totalMonthlyTarget > 0 ? (totalMonthlySales / totalMonthlyTarget) * 100 : 0;

    return {
      delegateName: 'تاركت المشرف (إجمالي المندوبين)',
      isSupervisor: true,
      rows,
      totals: {
        totalMonthlyTarget,
        totalMonthlySales,
        totalRemainingMonthly,
        totalDailyTarget,
        totalDailySales,
        totalDailyPct,
        totalMonthlyPct
      }
    };
  }, [delegateNamesList, categoryTargets, config.remainingDays, dailySalesByDelegateAndCat]);

  // Current delegate table data
  const currentTable = useMemo(() => {
    if (activeDelegate === '__SUPERVISOR__') {
      return supervisorTableData;
    }
    return getDelegateTableData(activeDelegate);
  }, [activeDelegate, supervisorTableData, getDelegateTableData]);

  // Daily target achievement status per delegate
  const delegatesDailyStatus = useMemo(() => {
    const statusMap: Record<string, {
      totalDailyTarget: number;
      totalDailySales: number;
      totalDailyPct: number;
      isAchieved: boolean;
      remainingDaily: number;
    }> = {};

    delegateNamesList.forEach(del => {
      const t = getDelegateTableData(del);
      const target = t.totals.totalDailyTarget;
      const sales = t.totals.totalDailySales;
      const pct = t.totals.totalDailyPct;
      const isAchieved = target <= 0 || sales >= target;
      const remainingDaily = Math.max(0, target - sales);
      statusMap[del] = {
        totalDailyTarget: target,
        totalDailySales: sales,
        totalDailyPct: pct,
        isAchieved,
        remainingDaily
      };
    });

    return statusMap;
  }, [delegateNamesList, getDelegateTableData]);

  // 1. All valid entries for today
  const entriesToday = useMemo(() => {
    return salesPool.filter(e => e.dateString === todayDateString && e.status !== 'cancelled');
  }, [salesPool, todayDateString]);

  // 2. Product price map for calculating retail & wholesale amounts
  const productPriceMap = useMemo(() => {
    const map = new Map<string, { retailPrice: number; wholesalePrice: number }>();
    productsList.forEach(p => {
      const pName = p.productName || (p as any).name || '';
      if (pName) {
        map.set(pName, {
          retailPrice: Number(p.retailPrice) || 0,
          wholesalePrice: Number(p.wholesalePrice) || 0
        });
      }
    });
    return map;
  }, [productsList]);

  // 3. Unified Daily Sales Report Data (Retail, Wholesale, and All Sales)
  const unifiedStats = useMemo(() => {
    return calculateUnifiedSalesStats(todayDateString, 'الكل');
  }, [calculateUnifiedSalesStats, todayDateString]);

  const {
    retailSalesList,
    wholesaleSalesList,
    allSalesList,
    totalRetailStats,
    totalWholesaleStats,
    totalAllStats
  } = useMemo(() => {
    const retailSalesList = delegateNamesList.map(name => {
      const b = unifiedStats.delegatesBreakdown[name] || { retailInvoicesCount: 0, retailSalesWeight: 0, retailSalesPrice: 0 };
      return {
        name,
        count: b.retailInvoicesCount,
        weight: b.retailSalesWeight,
        amount: b.retailSalesPrice
      };
    }).sort((a, b) => b.weight - a.weight);

    const wholesaleSalesList = delegateNamesList.map(name => {
      const b = unifiedStats.delegatesBreakdown[name] || { wholesaleInvoicesCount: 0, wholesaleSalesWeight: 0, wholesaleSalesPrice: 0 };
      return {
        name,
        count: b.wholesaleInvoicesCount,
        weight: b.wholesaleSalesWeight,
        amount: b.wholesaleSalesPrice
      };
    }).sort((a, b) => b.weight - a.weight);

    const allSalesList = delegateNamesList.map(name => {
      const b = unifiedStats.delegatesBreakdown[name] || { totalInvoicesCount: 0, totalSalesWeight: 0, totalSalesPrice: 0 };
      return {
        name,
        count: b.totalInvoicesCount,
        weight: b.totalSalesWeight,
        amount: b.totalSalesPrice
      };
    }).sort((a, b) => b.weight - a.weight);

    const totalRetailStats = {
      count: unifiedStats.retailInvoicesCount,
      weight: unifiedStats.retailSalesWeight,
      amount: unifiedStats.retailSalesPrice,
    };

    const totalWholesaleStats = {
      count: unifiedStats.wholesaleInvoicesCount,
      weight: unifiedStats.wholesaleSalesWeight,
      amount: unifiedStats.wholesaleSalesPrice,
    };

    const totalAllStats = {
      count: unifiedStats.totalInvoicesCount,
      weight: unifiedStats.totalSalesWeight,
      amount: unifiedStats.totalSalesPrice,
    };

    return {
      retailSalesList,
      wholesaleSalesList,
      allSalesList,
      totalRetailStats,
      totalWholesaleStats,
      totalAllStats
    };
  }, [delegateNamesList, unifiedStats]);

  // 4. Total Delegate Daily Report Metrics (عدد الفواتير، وزن المبيعات اليومي، الهدف اليومي، والنسبة)
  const delegateDailySummaryList = useMemo(() => {
    return delegateNamesList.map(name => {
      const delTable = getDelegateTableData(name);
      const b = unifiedStats.delegatesBreakdown[name];
      const invoiceCount = b ? b.totalInvoicesCount : 0;
      const dailySalesWeight = b ? b.totalSalesWeight : delTable.totals.totalDailySales;
      const dailyTarget = delTable.totals.totalDailyTarget;
      const pct = dailyTarget > 0 ? (dailySalesWeight / dailyTarget) * 100 : 0;
      const isAchieved = dailyTarget <= 0 || dailySalesWeight >= dailyTarget;
      const remaining = Math.max(0, dailyTarget - dailySalesWeight);

      return {
        name,
        invoiceCount,
        dailySalesWeight,
        dailyTarget,
        pct,
        isAchieved,
        remaining
      };
    }).sort((a, b) => b.dailySalesWeight - a.dailySalesWeight);
  }, [delegateNamesList, getDelegateTableData, unifiedStats]);

  // Active delegate's total summary for today
  const activeDelegateDailySummary = useMemo(() => {
    const targetName = activeDelegate === '__SUPERVISOR__'
      ? (delegateNamesList[0] || '')
      : activeDelegate;
    const found = delegateDailySummaryList.find(d => normalizeArabic(d.name) === normalizeArabic(targetName));
    if (found) return found;

    // Fallback
    const delTable = activeDelegate === '__SUPERVISOR__' ? supervisorTableData : getDelegateTableData(targetName);
    const delEntries = activeDelegate === '__SUPERVISOR__'
      ? entriesToday
      : entriesToday.filter(e => normalizeArabic(e.delegateName) === normalizeArabic(targetName));
    const invoiceCount = new Set(delEntries.map(e => `${e.dateString || ''}_${e.customerCode || e.customerName || e.invoiceId || e.id}`)).size;
    return {
      name: activeDelegate === '__SUPERVISOR__' ? 'تاركت المشرف (إجمالي المندوبين)' : targetName,
      invoiceCount,
      dailySalesWeight: delTable.totals.totalDailySales,
      dailyTarget: delTable.totals.totalDailyTarget,
      pct: delTable.totals.totalDailyPct,
      isAchieved: delTable.totals.totalDailyTarget <= 0 || delTable.totals.totalDailySales >= delTable.totals.totalDailyTarget,
      remaining: Math.max(0, delTable.totals.totalDailyTarget - delTable.totals.totalDailySales)
    };
  }, [activeDelegate, delegateDailySummaryList, supervisorTableData, getDelegateTableData, entriesToday, delegateNamesList]);

  // Overall totals for the branch delegates
  const branchDelegateDailyTotals = useMemo(() => {
    const invoiceCount = delegateDailySummaryList.reduce((s, d) => s + d.invoiceCount, 0);
    const dailySalesWeight = supervisorTableData.totals.totalDailySales;
    const dailyTarget = supervisorTableData.totals.totalDailyTarget;
    const pct = supervisorTableData.totals.totalDailyPct;
    const isAchieved = dailyTarget <= 0 || dailySalesWeight >= dailyTarget;
    const remaining = Math.max(0, dailyTarget - dailySalesWeight);

    return {
      name: 'الإجمالي العام للمندوبين',
      invoiceCount,
      dailySalesWeight,
      dailyTarget,
      pct,
      isAchieved,
      remaining
    };
  }, [delegateDailySummaryList, supervisorTableData]);

  const currentMonthStr = useMemo(() => {
    return new Date().toISOString().slice(0, 7);
  }, []);

  // Compute stats for Section 2: الأهداف والمبيعات التراكمية الإضافية
  const extraTargetsStats = useMemo(() => {
    const isTotal = viewMode === 'all' && activeDelegate === 'الكل';
    const targetDelName = activeDelegate;

    if (!isTotal && targetDelName && targetDelName !== 'الكل') {
      const delNorm = normalizeArabic(targetDelName);
      const targetRecord = extraTargetsList.find(
        (t) => normalizeArabic(t.delegateName) === delNorm || t.delegateName === targetDelName
      );

      const iqdTarget = targetRecord?.monthlyIqdTarget || 0;
      const iqdSalesOverride = targetRecord?.monthlyIqdSalesOverride;

      const delMonthSales = salesPool.filter((s) => {
        if (s.status === 'cancelled') return false;
        if (!s.dateString || !s.dateString.startsWith(currentMonthStr)) return false;
        return normalizeArabic(s.delegateName) === delNorm;
      });

      const actualIqdSales = delMonthSales.reduce((sum, s) => {
        const prod = productsList.find((p) => p.productName === s.productName);
        const price = prod
          ? s.priceMode === 'wholesale'
            ? prod.wholesalePrice || 0
            : prod.retailPrice || 0
          : 0;
        return sum + price * (s.quantity || 0);
      }, 0);

      const iqdSales = iqdSalesOverride !== undefined && iqdSalesOverride > 0 ? iqdSalesOverride : actualIqdSales;
      const iqdPct = iqdTarget > 0 ? (iqdSales / iqdTarget) * 100 : 0;

      const shopsTarget = targetRecord?.targetShopsCount || 0;
      const actualShopsOverride = targetRecord?.actualShopsCountOverride;

      const uniqueShopsSet = new Set(
        delMonthSales
          .map((s) => (s.customerCode || s.customerName || '').trim())
          .filter((name) => name.length > 0)
      );

      const shopsActual = actualShopsOverride !== undefined && actualShopsOverride > 0 ? actualShopsOverride : uniqueShopsSet.size;
      const shopsPct = shopsTarget > 0 ? (shopsActual / shopsTarget) * 100 : 0;

      const extraProdName = targetRecord?.extraProductName || 'جبن مسدمر مثلث 90 غم';
      const extraCustTarget = targetRecord?.extraProductCustomersTarget || 0;
      const extraCustActualOverride = targetRecord?.extraProductCustomersActualOverride;

      const normProdName = normalizeArabic(extraProdName);
      const extraCustSet = new Set(
        delMonthSales
          .filter((s) => {
            const pNorm = normalizeArabic(s.productName || '');
            const cNorm = normalizeArabic(s.categoryName || '');
            return pNorm === normProdName || cNorm === normProdName || pNorm.includes(normProdName);
          })
          .map((s) => (s.customerCode || s.customerName || '').trim())
          .filter((name) => name.length > 0)
      );

      const extraCustActual = extraCustActualOverride !== undefined && extraCustActualOverride > 0 ? extraCustActualOverride : extraCustSet.size;
      const extraCustPct = extraCustTarget > 0 ? (extraCustActual / extraCustTarget) * 100 : 0;

      return {
        title: 'الأهداف والمبيعات التراكمية الإضافية',
        isTotal: false,
        iqdTarget,
        iqdSales,
        iqdPct,
        shopsTarget,
        shopsActual,
        shopsPct,
        extraProdName,
        extraCustTarget,
        extraCustActual,
        extraCustPct,
      };
    } else {
      let sumIqdTarget = 0;
      let sumIqdSales = 0;
      let sumShopsTarget = 0;
      let sumShopsActual = 0;
      let sumExtraCustTarget = 0;
      let sumExtraCustActual = 0;
      let commonExtraProdName = 'جبن مسدمر مثلث 90 غم';

      delegateNamesList.forEach((delName) => {
        const delNorm = normalizeArabic(delName);
        const targetRecord = extraTargetsList.find(
          (t) => normalizeArabic(t.delegateName) === delNorm || t.delegateName === delName
        );

        const iqdTarget = targetRecord?.monthlyIqdTarget || 0;
        sumIqdTarget += iqdTarget;

        const delMonthSales = salesPool.filter((s) => {
          if (s.status === 'cancelled') return false;
          if (!s.dateString || !s.dateString.startsWith(currentMonthStr)) return false;
          return normalizeArabic(s.delegateName) === delNorm;
        });

        const actualIqdSales = delMonthSales.reduce((sum, s) => {
          const prod = productsList.find((p) => p.productName === s.productName);
          const price = prod
            ? s.priceMode === 'wholesale'
              ? prod.wholesalePrice || 0
              : prod.retailPrice || 0
            : 0;
          return sum + price * (s.quantity || 0);
        }, 0);

        const iqdSales = targetRecord?.monthlyIqdSalesOverride !== undefined && targetRecord.monthlyIqdSalesOverride > 0 ? targetRecord.monthlyIqdSalesOverride : actualIqdSales;
        sumIqdSales += iqdSales;

        const shopsTarget = targetRecord?.targetShopsCount || 0;
        sumShopsTarget += shopsTarget;

        const uniqueShopsSet = new Set(
          delMonthSales
            .map((s) => (s.customerCode || s.customerName || '').trim())
            .filter((name) => name.length > 0)
        );

        const shopsActual = targetRecord?.actualShopsCountOverride !== undefined && targetRecord.actualShopsCountOverride > 0 ? targetRecord.actualShopsCountOverride : uniqueShopsSet.size;
        sumShopsActual += shopsActual;

        const extraProdName = targetRecord?.extraProductName || commonExtraProdName;
        commonExtraProdName = extraProdName;
        const extraCustTarget = targetRecord?.extraProductCustomersTarget || 0;
        sumExtraCustTarget += extraCustTarget;

        const normProdName = normalizeArabic(extraProdName);
        const extraCustSet = new Set(
          delMonthSales
            .filter((s) => {
              const pNorm = normalizeArabic(s.productName || '');
              const cNorm = normalizeArabic(s.categoryName || '');
              return pNorm === normProdName || cNorm === normProdName || pNorm.includes(normProdName);
            })
            .map((s) => (s.customerCode || s.customerName || '').trim())
            .filter((name) => name.length > 0)
        );

        const extraCustActual = targetRecord?.extraProductCustomersActualOverride !== undefined && targetRecord.extraProductCustomersActualOverride > 0 ? targetRecord.extraProductCustomersActualOverride : extraCustSet.size;
        sumExtraCustActual += extraCustActual;
      });

      const iqdPct = sumIqdTarget > 0 ? (sumIqdSales / sumIqdTarget) * 100 : 0;
      const shopsPct = sumShopsTarget > 0 ? (sumShopsActual / sumShopsTarget) * 100 : 0;
      const extraCustPct = sumExtraCustTarget > 0 ? (sumExtraCustActual / sumExtraCustTarget) * 100 : 0;

      return {
        title: 'الأهداف والمبيعات التراكمية الإضافية',
        isTotal: true,
        iqdTarget: sumIqdTarget,
        iqdSales: sumIqdSales,
        iqdPct,
        shopsTarget: sumShopsTarget,
        shopsActual: sumShopsActual,
        shopsPct,
        extraProdName: commonExtraProdName,
        extraCustTarget: sumExtraCustTarget,
        extraCustActual: sumExtraCustActual,
        extraCustPct,
      };
    }
  }, [
    isAdmin,
    viewMode,
    activeDelegate,
    extraTargetsList,
    salesPool,
    currentMonthStr,
    productsList,
    delegateNamesList,
  ]);

  // Compute stats for Section 3: تاركت اضافي للمنتج المحدد
  const specificProductStats = useMemo(() => {
    const isAggregated = isAdmin && (viewMode === 'all' || activeDelegate === 'الكل');
    const activeProdName = specificProductName || 'جبن اماه 200 غم';
    const matchedProd = productsList.find(
      (p) => normalizeArabic(p.productName) === normalizeArabic(activeProdName) || p.productName === activeProdName
    );
    const cartonQty = matchedProd?.cartonQuantity ? Number(matchedProd.cartonQuantity) : 0;

    const delegateBreakdown = delegateNamesList.map((del) => {
      const normDel = normalizeArabic(del);
      const record = specificProductTargets.find(
        (t) => normalizeArabic(t.delegateName || '') === normDel || t.delegateName === del
      );

      const delMonthSales = salesPool.filter((s) => {
        if (s.status === 'cancelled') return false;
        if (!s.dateString || !s.dateString.startsWith(currentMonthStr)) return false;
        return normalizeArabic(s.delegateName) === normDel;
      });

      const prodSalesEntries = delMonthSales.filter((s) => {
        const pNorm = normalizeArabic(s.productName || '');
        const normTarget = normalizeArabic(activeProdName);
        return pNorm === normTarget || pNorm.includes(normTarget) || normTarget.includes(pNorm);
      });

      const calculatedSalesPieces = prodSalesEntries.reduce((sum, s) => sum + (s.quantity || 0), 0);
      const salesPieces = record?.salesPiecesOverride !== undefined && record.salesPiecesOverride > 0
        ? record.salesPiecesOverride
        : calculatedSalesPieces;

      let salesCartons = record?.salesCartonsOverride || 0;
      if (salesCartons === 0 && cartonQty > 0 && salesPieces > 0) {
        salesCartons = parseFloat((salesPieces / cartonQty).toFixed(0));
      }

      let targetPieces = record?.targetPieces || 0;
      let targetCartons = record?.targetCartons || 0;
      if (targetPieces === 0 && targetCartons > 0 && cartonQty > 0) {
        targetPieces = Math.round(targetCartons * cartonQty);
      } else if (targetCartons === 0 && targetPieces > 0 && cartonQty > 0) {
        targetCartons = parseFloat((targetPieces / cartonQty).toFixed(0));
      }

      const salesPct = targetPieces > 0 ? (salesPieces / targetPieces) * 100 : (targetCartons > 0 ? (salesCartons / targetCartons) * 100 : 0);

      const targetShops = record?.targetShops || 0;
      const uniqueShops = new Set(
        prodSalesEntries
          .map((s) => (s.customerCode || s.customerName || '').trim())
          .filter((name) => name.length > 0)
      );

      const actualShops = record?.actualShopsOverride !== undefined && record.actualShopsOverride > 0
        ? record.actualShopsOverride
        : uniqueShops.size;

      const shopsPct = targetShops > 0 ? (actualShops / targetShops) * 100 : 0;

      return {
        delegateName: del,
        targetPieces,
        salesPieces,
        salesPct,
        targetCartons,
        salesCartons,
        targetShops,
        actualShops,
        shopsPct,
      };
    }).sort((a, b) => b.salesPieces - a.salesPieces);

    if (isAggregated) {
      const targetPieces = delegateBreakdown.reduce((sum, d) => sum + d.targetPieces, 0);
      const salesPieces = delegateBreakdown.reduce((sum, d) => sum + d.salesPieces, 0);
      const targetCartons = delegateBreakdown.reduce((sum, d) => sum + d.targetCartons, 0);
      const salesCartons = delegateBreakdown.reduce((sum, d) => sum + d.salesCartons, 0);
      const targetShops = delegateBreakdown.reduce((sum, d) => sum + d.targetShops, 0);
      const actualShops = delegateBreakdown.reduce((sum, d) => sum + d.actualShops, 0);

      const salesPct = targetPieces > 0 ? (salesPieces / targetPieces) * 100 : (targetCartons > 0 ? (salesCartons / targetCartons) * 100 : 0);
      const shopsPct = targetShops > 0 ? (actualShops / targetShops) * 100 : 0;

      return {
        productName: activeProdName,
        isAggregated: true,
        delegateName: 'مجموع كافة المندوبين',
        targetPieces,
        salesPieces,
        salesPct,
        targetCartons,
        salesCartons,
        targetShops,
        actualShops,
        shopsPct,
        delegateBreakdown,
      };
    } else {
      const single = delegateBreakdown.find((d) => normalizeArabic(d.delegateName) === normalizeArabic(activeDelegate)) || {
        delegateName: activeDelegate,
        targetPieces: 0,
        salesPieces: 0,
        salesPct: 0,
        targetCartons: 0,
        salesCartons: 0,
        targetShops: 0,
        actualShops: 0,
        shopsPct: 0,
      };

      return {
        productName: activeProdName,
        isAggregated: false,
        ...single,
        delegateBreakdown,
      };
    }
  }, [
    isAdmin,
    viewMode,
    specificProductName,
    productsList,
    delegateNamesList,
    specificProductTargets,
    salesPool,
    currentMonthStr,
    activeDelegate,
  ]);

  // Action Handlers
  const handleSaveSpecificProductName = async () => {
    const cleanName = tempSpecificProductName.trim();
    if (!cleanName) return;
    try {
      setIsSavingSpecificProductName(true);
      await setDoc(
        doc(db, 'app_settings', 'specific_product_name'),
        {
          productName: cleanName,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.name || 'الأدمن',
        },
        { merge: true }
      );
      setSpecificProductName(cleanName);
      setUserMessage(`تم تعيين وحفظ المنتج المخصص (${cleanName}) بنجاح لكافة المندوبين ✅`);
    } catch (e) {
      console.error('Error saving specific product name:', e);
      setUserMessage('حدث خطأ أثناء حفظ اسم المنتج المخصص.');
    } finally {
      setIsSavingSpecificProductName(false);
    }
  };

  const handleSpecificProductExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingSpecificProductExcel(true);
      setSpecificProductUploadMessage(null);
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });

      if (!jsonData || jsonData.length === 0) {
        setSpecificProductUploadMessage({ text: 'ملف الإكسل فارغ أو غير صالح!', type: 'error' });
        return;
      }

      const batch = writeBatch(db);
      let count = 0;
      const activeProdName = specificProductName || 'جبن اماه 200 غم';

      jsonData.forEach((row: any) => {
        const rawDelegate = (
          row['اسم المندوب'] ||
          row['المندوب'] ||
          row['مندوب'] ||
          row['Delegate'] ||
          ''
        ).toString().trim();

        if (!rawDelegate) return;

        const normDel = normalizeArabic(rawDelegate);
        const matchedDel = delegateNamesList.find(
          (d) => normalizeArabic(d) === normDel || d.trim().toLowerCase() === rawDelegate.toLowerCase()
        ) || rawDelegate;

        const targetPieces = parseFloat(String(row['تاركت الصنف (قطعة)'] || row['تاركت القطعة'] || 0).replace(/,/g, '')) || 0;
        const salesPiecesOverride = parseFloat(String(row['مبيعات الصنف (قطعة)'] || row['مبيعات القطعة'] || 0).replace(/,/g, '')) || 0;
        const targetCartons = parseFloat(String(row['تاركت المنتج (كارتون)'] || row['تاركت الكارتون'] || 0).replace(/,/g, '')) || 0;
        const salesCartonsOverride = parseFloat(String(row['مبيعات المنتج (كارتون)'] || row['مبيعات الكارتون'] || 0).replace(/,/g, '')) || 0;
        const targetShops = parseFloat(String(row['مطلوب تبيع لعدد محلات'] || row['تاركت المحلات'] || 0).replace(/,/g, '')) || 0;
        const actualShopsOverride = parseFloat(String(row['تم بيع لعدد محلات'] || row['محلات مباع لها'] || 0).replace(/,/g, '')) || 0;

        const docKey = `del_${matchedDel}`.replace(/[\/\s#$[\]]/g, '_');
        const docRef = doc(db, 'specific_product_targets', docKey);

        batch.set(docRef, {
          delegateName: matchedDel,
          productName: activeProdName,
          targetPieces,
          salesPiecesOverride,
          targetCartons,
          salesCartonsOverride,
          targetShops,
          actualShopsOverride,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.name || 'الأدمن',
        }, { merge: true });
        count++;
      });

      await batch.commit();

      setSpecificProductUploadMessage({
        text: `تم رفع وتحديث بيانات المنتج المخصص لـ (${count}) مندوب بنجاح وإرسال التنبيهات 🔔✅`,
        type: 'success',
      });
      setUserMessage(`تم تحديث بيانات المنتج المخصص لـ (${count}) مندوب بنجاح ✅`);
    } catch (err: any) {
      console.error('Error uploading specific product excel:', err);
      setSpecificProductUploadMessage({
        text: `حدث خطأ أثناء معالجة ملف الإكسل: ${err.message || 'خطأ غير معروف'}`,
        type: 'error',
      });
    } finally {
      setIsUploadingSpecificProductExcel(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDownloadSpecificProductTemplate = () => {
    try {
      const validDelegates = delegateNamesList;
      const rows: any[] = [];

      validDelegates.forEach((del) => {
        const normDel = normalizeArabic(del);
        const existingRecord = specificProductTargets.find(
          (t) => normalizeArabic(t.delegateName || '') === normDel || t.delegateName === del
        );

        rows.push({
          'اسم المندوب': del,
          'اسم المنتج': specificProductName,
          'تاركت الصنف (قطعة)': existingRecord?.targetPieces || 0,
          'مبيعات الصنف (قطعة)': existingRecord?.salesPiecesOverride || 0,
          'تاركت المنتج (كارتون)': existingRecord?.targetCartons || 0,
          'مبيعات المنتج (كارتون)': existingRecord?.salesCartonsOverride || 0,
          'مطلوب تبيع لعدد محلات': existingRecord?.targetShops || 0,
          'تم بيع لعدد محلات': existingRecord?.actualShopsOverride || 0,
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'متابعة_المنتج_المخصص');
      XLSX.writeFile(workbook, `نموذج_المنتج_المخصص_${specificProductName}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error('Error downloading specific product template:', err);
    }
  };

  const handleClearSpecificProductData = async () => {
    const confirmed = await showConfirm('هل أنت متأكد من مسح وتفريغ كافة بيانات ملف الإكسل للصنف المحدد؟');
    if (!confirmed) return;
    try {
      const batch = writeBatch(db);
      specificProductTargets.forEach((t) => {
        if (t.id) {
          batch.delete(doc(db, 'specific_product_targets', t.id));
        }
      });
      await batch.commit();
      setSpecificProductTargets([]);
      setUserMessage('تم مسح بيانات الصنف المحدد بنجاح ✅');
    } catch (err) {
      console.error('Error clearing specific product targets:', err);
    }
  };

  const openEditSpecificProduct = (delName: string) => {
    setEditSpecificProductDelegate(delName);
    const existing = specificProductTargets.find(
      (t) => normalizeArabic(t.delegateName || '') === normalizeArabic(delName) || t.delegateName === delName
    );
    setEditSpecificTargetPieces(existing ? String(existing.targetPieces || '') : '');
    setEditSpecificSalesPieces(existing ? String(existing.salesPiecesOverride || '') : '');
    setEditSpecificTargetCartons(existing ? String(existing.targetCartons || '') : '');
    setEditSpecificSalesCartons(existing ? String(existing.salesCartonsOverride || '') : '');
    setEditSpecificTargetShops(existing ? String(existing.targetShops || '') : '');
    setEditSpecificActualShops(existing ? String(existing.actualShopsOverride || '') : '');
    setShowEditSpecificProductModal(true);
  };

  const handleSaveSpecificProductModal = async () => {
    if (!editSpecificProductDelegate) return;
    try {
      setIsSavingSpecificProductModal(true);
      const docKey = `del_${editSpecificProductDelegate}`.replace(/[\/\s#$[\]]/g, '_');
      await setDoc(
        doc(db, 'specific_product_targets', docKey),
        {
          delegateName: editSpecificProductDelegate,
          productName: specificProductName,
          targetPieces: parseFloat(editSpecificTargetPieces.replace(/,/g, '')) || 0,
          salesPiecesOverride: parseFloat(editSpecificSalesPieces.replace(/,/g, '')) || 0,
          targetCartons: parseFloat(editSpecificTargetCartons.replace(/,/g, '')) || 0,
          salesCartonsOverride: parseFloat(editSpecificSalesCartons.replace(/,/g, '')) || 0,
          targetShops: parseFloat(editSpecificTargetShops.replace(/,/g, '')) || 0,
          actualShopsOverride: parseFloat(editSpecificActualShops.replace(/,/g, '')) || 0,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.name || 'الأدمن',
        },
        { merge: true }
      );
      setShowEditSpecificProductModal(false);
      setUserMessage(`تم حفظ أهداف ومبيعات المنتج المخصص للمندوب (${editSpecificProductDelegate}) بنجاح ✅`);
    } catch (err) {
      console.error('Error saving specific product modal:', err);
    } finally {
      setIsSavingSpecificProductModal(false);
    }
  };

  const handleSaveExtraTargets = async () => {
    if (!editExtraTargetDelegate) return;
    try {
      setIsSavingExtraTargets(true);
      const docKey = `del_${editExtraTargetDelegate}`.replace(/[\/\s#$[\]]/g, '_');
      await setDoc(
        doc(db, 'delegate_monthly_extra_targets', docKey),
        {
          delegateName: editExtraTargetDelegate,
          monthlyIqdTarget: parseFloat(editMonthlyIqdTarget.replace(/,/g, '')) || 0,
          targetShopsCount: parseFloat(editTargetShopsCount.replace(/,/g, '')) || 0,
          extraProductName: editExtraProductName.trim() || 'جبن مسدمر مثلث 90 غم',
          extraProductCustomersTarget: parseFloat(editExtraProductCustomersTarget.replace(/,/g, '')) || 0,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.name || 'الأدمن',
        },
        { merge: true }
      );
      setShowEditExtraTargetsModal(false);
      setUserMessage('تم حفظ الأهداف الإضافية للمندوب بنجاح ✅');
    } catch (err) {
      console.error('Error saving extra targets:', err);
    } finally {
      setIsSavingExtraTargets(false);
    }
  };

  // Excel Import Handler (Unified parsing for Category Targets, Incentives, Extra Targets, & Specific Product Targets)
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadFeedback(null);

    try {
      // Archive Excel sheet in Supabase Storage ('sales-bucket' / excel-sales/)
      try {
        uploadExcelToSupabaseStorage(file, {
          uploadedBy: currentUser?.name || 'الأدمن',
          targetType: 'report11',
          description: 'شيت أهداف ومبيعات التقرير 11',
        }).catch((sErr) => console.warn('Supabase storage archive note:', sErr));
      } catch {}

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('ملف الإكسل فارغ ولا يحتوي على بيانات صالحة.');
      }

      const batch = writeBatch(db);
      const newTargetsList: Report11CategoryTarget[] = [...categoryTargets];
      let processedCount = 0;

      const delegateIncentiveMap: Record<string, number> = {};
      const delegateExtraTargetsMap: Record<string, any> = {};
      const delegateSpecificProductMap: Record<string, any> = {};
      const providedCategoryKeys = new Set<string>();

      workbook.SheetNames.forEach((sheetName) => {
        try {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });
          if (!jsonData || jsonData.length === 0) return;

          const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
          let headerRowIdx = -1;
          for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
            const rCells = rawRows[r] || [];
            const text = rCells.map((c: any) => String(c)).join(' ');
            if (
              text.includes('مندوب') || 
              text.includes('صنف') || 
              text.includes('Delegate') || 
              text.includes('Category') ||
              text.includes('هدف') ||
              text.includes('تاركت')
            ) {
              headerRowIdx = r;
              break;
            }
          }

          for (let rowIdx = 0; rowIdx < jsonData.length; rowIdx++) {
            const row = jsonData[rowIdx];
            const rawRow = (headerRowIdx >= 0 && headerRowIdx + 1 + rowIdx < rawRows.length)
              ? rawRows[headerRowIdx + 1 + rowIdx]
              : (rowIdx + 1 < rawRows.length ? rawRows[rowIdx + 1] : null);

            const rawDelegate = String(
              row['اسم المندوب'] ??
              row['المندوب'] ??
              row['مندوب'] ??
              row['Delegate'] ??
              row['delegateName'] ??
              (rawRow && rawRow[0] !== undefined ? rawRow[0] : '') ??
              ''
            ).trim();

            console.log("Processing row:", row, "Delegate:", rawDelegate);
            if (!rawDelegate) continue;

            // Normalize against standard delegates
            const normDel = normalizeArabic(rawDelegate);
            const matchedDel = delegateNamesList.find(d => normalizeArabic(d) === normDel) || rawDelegate;

            // 1. Category Targets & Sales (Long Format with Category Column)
            let rawCategory = String(
              row['الصنف'] ??
              row['اسم الصنف'] ??
              row['صنف'] ??
              row['Category'] ??
              row['categoryName'] ??
              row['الأصناف'] ??
              row['الاصناف'] ??
              row['المجموعة'] ??
              row['اسم المجموعة'] ??
              row['المجموعات'] ??
              row['القسم'] ??
              row['اسم القسم'] ??
              row['الفئة'] ??
              row['اسم الفئة'] ??
              ''
            ).trim();

            if (!rawCategory) {
              for (const [k, v] of Object.entries(row)) {
                if (!v) continue;
                const normK = normalizeArabic(k);
                if (
                  normK === 'صنف' || normK === 'الصنف' || normK === 'اسم الصنف' ||
                  normK === 'مجموعه' || normK === 'المجموعه' || normK === 'اسم المجموعه' ||
                  normK === 'قسم' || normK === 'القسم' || normK === 'اسم القسم' ||
                  normK === 'فئه' || normK === 'الفئه' || normK === 'اسم الفئه' ||
                  normK.includes('صنف') || normK.includes('category')
                ) {
                  rawCategory = String(v).trim();
                  break;
                }
              }
            }

            if (rawCategory) {
              const matchedCat = matchReport11CategoryName(rawCategory) || rawCategory;
              providedCategoryKeys.add(`${matchedDel}_${matchedCat}`);
              providedCategoryKeys.add(`${normalizeArabic(matchedDel)}_${matchedCat}`);
              if (matchedCat === 'لبن') {
                providedCategoryKeys.add(`${matchedDel}_لبن`);
                providedCategoryKeys.add(`${normalizeArabic(matchedDel)}_لبن`);
              }

              let rawMonthlyTarget =
                row['الهدف الشهري'] ??
                row['التاركت الشهري'] ??
                row['تاركت شهري'] ??
                row['هدف شهري'] ??
                row['الهدف الشهري (كغم)'] ??
                row['التاركت الشهري (كغم)'] ??
                row['هدف شهري (كغم)'] ??
                row['تاركت شهري (كغم)'] ??
                row['الهدف (كغم)'] ??
                row['التاركت (كغم)'] ??
                row['الهدف'] ??
                row['التاركت'] ??
                row['هدف'] ??
                row['تاركت'] ??
                row['Monthly Target'] ??
                row['monthlyTarget'] ??
                row['Target'] ??
                row['target'] ??
                null;

              let rawMonthlySales =
                row['المبيعات الشهرية'] ??
                row['المبيعات لحد الآن'] ??
                row['المبيعات لحد الان'] ??
                row['مبيعات الشهر'] ??
                row['المبيعات'] ??
                row['المبيعات الشهرية (كغم)'] ??
                row['مبيعات شهرية (كغم)'] ??
                row['المبيعات (كغم)'] ??
                row['مبيعات (كغم)'] ??
                row['Monthly Sales'] ??
                row['monthlySales'] ??
                row['Sales'] ??
                row['sales'] ??
                null;

              if (rawMonthlyTarget === null || rawMonthlyTarget === undefined) {
                for (const [k, v] of Object.entries(row)) {
                  if (v === '' || v === null || v === undefined) continue;
                  const normK = normalizeArabic(k);
                  if (
                    (normK.includes('هدف') || normK.includes('تاركت') || normK.includes('target')) &&
                    !normK.includes('دينار') && !normK.includes('يومي') && !normK.includes('قطعه') && !normK.includes('محل') && !normK.includes('زبائن')
                  ) {
                    rawMonthlyTarget = v;
                    break;
                  }
                }
              }

              if (rawMonthlySales === null || rawMonthlySales === undefined) {
                for (const [k, v] of Object.entries(row)) {
                  if (v === '' || v === null || v === undefined) continue;
                  const normK = normalizeArabic(k);
                  if (
                    (normK.includes('مبيعات') || normK.includes('بيع') || normK.includes('sales')) &&
                    !normK.includes('دينار') && !normK.includes('يومي') && !normK.includes('نقد') && !normK.includes('قطعه') && !normK.includes('محل') && !normK.includes('زبائن')
                  ) {
                    rawMonthlySales = v;
                    break;
                  }
                }
              }

              if (rawMonthlyTarget !== null || rawMonthlySales !== null) {
                const cleanTargetStr = parseArabicDigits(String(rawMonthlyTarget ?? 0)).replace(/,/g, '').trim();
                const cleanSalesStr = parseArabicDigits(String(rawMonthlySales ?? 0)).replace(/,/g, '').trim();
                const monthlyTarget = parseFloat(cleanTargetStr) || 0;
                const monthlySales = parseFloat(cleanSalesStr) || 0;

                const docKey = `${matchedDel}_${matchedCat}`.replace(/[\/\s#$[\]]/g, '_');
                const docRef = doc(db, 'report11_targets', docKey);

                const record: Report11CategoryTarget = {
                  delegateName: matchedDel,
                  categoryName: matchedCat,
                  monthlyTarget,
                  monthlySales,
                  updatedAt: new Date().toISOString(),
                  updatedBy: currentUser?.name || 'الأدمن'
                };

                batch.set(docRef, record, { merge: true });

                const existingIdx = newTargetsList.findIndex(
                  t => normalizeArabic(t.delegateName) === normalizeArabic(matchedDel) &&
                       isMatchingReport11Category(t.categoryName, matchedCat)
                );
                if (existingIdx >= 0) {
                  newTargetsList[existingIdx] = record;
                  console.log("Updated existing target:", record);
                } else {
                  newTargetsList.push(record);
                  console.log("Added new target:", record);
                }

                processedCount++;
              }
            } else {
              // 1.B Wide / Horizontal Table Support: Categories as Columns!
              // In case the uploaded Excel has delegates as rows and category names as column headers
              for (const [colKey, colVal] of Object.entries(row)) {
                if (colVal === null || colVal === undefined || String(colVal).trim() === '') continue;
                const normCol = normalizeArabic(colKey);
                if (
                  normCol.includes('مندوب') ||
                  normCol.includes('حوافز') ||
                  normCol.includes('ديناري') ||
                  normCol.includes('محلات') ||
                  normCol.includes('زبائن') ||
                  normCol.includes('تاكيدي') ||
                  normCol.includes('قطعه')
                ) continue;

                const colCat = matchReport11CategoryName(colKey);
                if (colCat) {
                  providedCategoryKeys.add(`${matchedDel}_${colCat}`);
                  providedCategoryKeys.add(`${normalizeArabic(matchedDel)}_${colCat}`);
                  if (colCat === 'لبن') {
                    providedCategoryKeys.add(`${matchedDel}_لبن`);
                    providedCategoryKeys.add(`${normalizeArabic(matchedDel)}_لبن`);
                  }

                  const numVal = parseFloat(parseArabicDigits(String(colVal)).replace(/,/g, '').trim());
                  if (!isNaN(numVal) && numVal >= 0) {
                    const docKey = `${matchedDel}_${colCat}`.replace(/[\/\s#$[\]]/g, '_');
                    const docRef = doc(db, 'report11_targets', docKey);

                    const existingRecord = newTargetsList.find(
                      t => normalizeArabic(t.delegateName) === normalizeArabic(matchedDel) &&
                           isMatchingReport11Category(t.categoryName, colCat)
                    );

                    const record: Report11CategoryTarget = {
                      delegateName: matchedDel,
                      categoryName: colCat,
                      monthlyTarget: numVal,
                      monthlySales: existingRecord ? (existingRecord.monthlySales || 0) : 0,
                      updatedAt: new Date().toISOString(),
                      updatedBy: currentUser?.name || 'الأدمن'
                    };

                    batch.set(docRef, record, { merge: true });

                    const existingIdx = newTargetsList.findIndex(
                      t => normalizeArabic(t.delegateName) === normalizeArabic(matchedDel) &&
                           isMatchingReport11Category(t.categoryName, colCat)
                    );
                    if (existingIdx >= 0) {
                      newTargetsList[existingIdx] = {
                        ...newTargetsList[existingIdx],
                        monthlyTarget: numVal
                      };
                    } else {
                      newTargetsList.push(record);
                    }

                    processedCount++;
                  }
                }
              }
            }

            // 2. Incentives (الحوافز لحد الان)
            const rawInc =
              row['الحوافز لحد الان'] ??
              row['الحوافز لحد الآن'] ??
              row['الحوافز الكلية لحد الان'] ??
              row['الحوافز الكلية لحد الآن'] ??
              row['الحوافز الكلية'] ??
              row['مبلغ الحوافز'] ??
              row['الحوافز'] ??
              row['Incentives'] ??
              row['incentives'] ??
              row['e'] ??
              null;

            if (rawInc !== null && rawInc !== undefined && String(rawInc).trim() !== '') {
              const incVal = parseFloat(String(rawInc).replace(/,/g, '').trim());
              if (!isNaN(incVal)) {
                delegateIncentiveMap[matchedDel] = incVal;
              }
            }

            // 3. Extra Targets (التاركت الديناري الشهري من عمود F، والمبيعات النقدية بالدينار من عمود G)
            // عمود F: التاركت الديناري الشهري
            let rawColFVal: any = (rawRow && rawRow[5] !== undefined && rawRow[5] !== '') ? rawRow[5] : undefined;
            if (rawColFVal === undefined || rawColFVal === '') {
              const colFKeys = [
                'التاركت الديناري الشهري',
                'تاركت ديناري شهري',
                'التاركت الديناري',
                'تاركت ديناري',
                'الهدف الديناري الشهري',
                'الهدف الديناري',
                'هدف ديناري شهري',
                'هدف ديناري',
                'تاركت المبيعات النقدية بالدينار',
                'تاركت المبيعات النقدية',
                'تاركت مبيعات نقدية',
                'تاركت نقدية',
                'تاركت نقدي',
                'تاركت دينار',
                'F',
                'f',
                'Col F',
                'Column F'
              ];
              for (const k of colFKeys) {
                if (row[k] !== undefined && row[k] !== '') {
                  rawColFVal = row[k];
                  break;
                }
              }
            }
            if (rawColFVal === undefined || rawColFVal === '') {
              for (const [k, v] of Object.entries(row)) {
                if (v === '' || v === null || v === undefined) continue;
                const normK = normalizeArabic(k);
                if ((normK.includes('تاركت') || normK.includes('هدف')) && normK.includes('دينار')) {
                  rawColFVal = v;
                  break;
                }
              }
            }

            // عمود G: المبيعات النقدية بالدينار (مبيعات ديناري شهري)
            let rawColGVal: any = (rawRow && rawRow[6] !== undefined && rawRow[6] !== '') ? rawRow[6] : undefined;
            if (rawColGVal === undefined || rawColGVal === '') {
              const colGKeys = [
                'المبيعات النقدية بالدينار',
                'المبيعات النقدية',
                'مبيعات نقدية بالدينار',
                'مبيعات نقدية',
                'مبيعات ديناري شهري',
                'المبيعات الدينارية',
                'المبيعات الدينارية الشهرية',
                'مبيعات ديناري',
                'مبيعات بالدينار',
                'المبيعات بالدينار',
                'المبيعات النقديه',
                'مبيعات نقديه',
                'مبيعات نقدي',
                'مبيعات دينار',
                'المبيعات الشهرية بالدينار',
                'مبيعات شهرية بالدينار',
                'المبيعات الشهرية دينار',
                'مبيعات شهرية دينار',
                'G',
                'g',
                'Col G',
                'Column G'
              ];
              for (const k of colGKeys) {
                if (row[k] !== undefined && row[k] !== '') {
                  rawColGVal = row[k];
                  break;
                }
              }
            }
            if (rawColGVal === undefined || rawColGVal === '') {
              for (const [k, v] of Object.entries(row)) {
                if (v === '' || v === null || v === undefined) continue;
                const normK = normalizeArabic(k);
                if (normK.includes('مبيعات') && (normK.includes('دينار') || normK.includes('نقد'))) {
                  rawColGVal = v;
                  break;
                }
              }
            }

            const parseCleanNumber = (val: any): number | null => {
              if (val === null || val === undefined || val === '') return null;
              if (typeof val === 'number') return isNaN(val) ? null : val;
              const clean = String(val).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
              if (clean === '' || clean === '-') return null;
              const num = parseFloat(clean);
              return isNaN(num) ? null : num;
            };

            const parsedColF = parseCleanNumber(rawColFVal);
            const parsedColG = parseCleanNumber(rawColGVal);

            const rawShopsTarget = row['مطلوب تبيع لعدد محلات'] ?? row['تاركت المحلات'] ?? row['تغطية المحلات'] ?? row['هدف المحلات'];
            const rawShopsActual = row['تم بيع لعدد محلات'] ?? row['مبيعات المحلات'] ?? row['عدد المحلات المباعة'];
            const rawExtraProdName = row['اسم المنتج التأكيدي'] ?? row['اسم المنتج الإضافي'] ?? row['المنتج الإضافي'] ?? row['اسم المنتج المخصص'];
            const rawExtraCustTarget = row['تاركت زبائن شهري'] ?? row['تاركت الزبائن'] ?? row['هدف زبائن الصنف'];
            const rawExtraCustActual = row['تم بيع لهم'] ?? row['زبائن مباع لهم'] ?? row['مبيعات زبائن الصنف'];

            if (
              parsedColF !== null ||
              parsedColG !== null ||
              rawShopsTarget !== undefined ||
              rawShopsActual !== undefined ||
              rawExtraProdName !== undefined ||
              rawExtraCustTarget !== undefined ||
              rawExtraCustActual !== undefined
            ) {
              if (!delegateExtraTargetsMap[matchedDel]) {
                const existingExtra = extraTargetsList.find(
                  (t) => normalizeArabic(t.delegateName) === normalizeArabic(matchedDel) || t.delegateName === matchedDel
                );
                delegateExtraTargetsMap[matchedDel] = {
                  delegateName: matchedDel,
                  monthlyIqdTarget: existingExtra?.monthlyIqdTarget || 0,
                  monthlyIqdSalesOverride: existingExtra?.monthlyIqdSalesOverride || 0,
                  targetShopsCount: existingExtra?.targetShopsCount || 0,
                  actualShopsCountOverride: existingExtra?.actualShopsCountOverride || 0,
                  extraProductName: existingExtra?.extraProductName || 'جبن مسدمر مثلث 90 غم',
                  extraProductCustomersTarget: existingExtra?.extraProductCustomersTarget || 0,
                  extraProductCustomersActualOverride: existingExtra?.extraProductCustomersActualOverride || 0
                };
              }

              // Update Column F: التاركت الديناري الشهري
              if (parsedColF !== null) {
                delegateExtraTargetsMap[matchedDel].monthlyIqdTarget = parsedColF;
              }

              // Update Column G: المبيعات النقدية بالدينار
              if (parsedColG !== null) {
                delegateExtraTargetsMap[matchedDel].monthlyIqdSalesOverride = parsedColG;
              }

              // Update Shops Target & Actual
              if (rawShopsTarget !== undefined && String(rawShopsTarget).trim() !== '') {
                const st = parseInt(String(rawShopsTarget).replace(/,/g, '')) || 0;
                if (st > 0) delegateExtraTargetsMap[matchedDel].targetShopsCount = st;
              }
              if (rawShopsActual !== undefined && String(rawShopsActual).trim() !== '') {
                const sa = parseInt(String(rawShopsActual).replace(/,/g, '')) || 0;
                if (sa > 0) delegateExtraTargetsMap[matchedDel].actualShopsCountOverride = sa;
              }

              // Update Extra Product
              if (rawExtraProdName !== undefined && String(rawExtraProdName).trim() !== '') {
                delegateExtraTargetsMap[matchedDel].extraProductName = String(rawExtraProdName).trim();
              }
              if (rawExtraCustTarget !== undefined && String(rawExtraCustTarget).trim() !== '') {
                const ct = parseInt(String(rawExtraCustTarget).replace(/,/g, '')) || 0;
                if (ct > 0) delegateExtraTargetsMap[matchedDel].extraProductCustomersTarget = ct;
              }
              if (rawExtraCustActual !== undefined && String(rawExtraCustActual).trim() !== '') {
                const ca = parseInt(String(rawExtraCustActual).replace(/,/g, '')) || 0;
                if (ca > 0) delegateExtraTargetsMap[matchedDel].extraProductCustomersActualOverride = ca;
              }
            }

            // 4. Specific Product Targets (تاركت الصنف المخصص قطعة/كارتون ومحلات)
            const rawSpecPiecesTarget = row['تاركت الصنف (قطعة)'] ?? row['تاركت القطعة'] ?? row['تاركت قطعة'];
            const rawSpecPiecesSales = row['مبيعات الصنف (قطعة)'] ?? row['مبيعات القطعة'] ?? row['مبيعات قطعة'];
            const rawSpecCartonsTarget = row['تاركت المنتج (كارتون)'] ?? row['تاركت الكارتون'] ?? row['تاركت كارتون'];
            const rawSpecCartonsSales = row['مبيعات المنتج (كارتون)'] ?? row['مبيعات الكارتون'] ?? row['مبيعات كارتون'];

            if (rawSpecPiecesTarget !== undefined || rawSpecPiecesSales !== undefined || rawSpecCartonsTarget !== undefined) {
              const targetPieces = parseFloat(String(rawSpecPiecesTarget || 0).replace(/,/g, '')) || 0;
              const salesPiecesOverride = parseFloat(String(rawSpecPiecesSales || 0).replace(/,/g, '')) || 0;
              const targetCartons = parseFloat(String(rawSpecCartonsTarget || 0).replace(/,/g, '')) || 0;
              const salesCartonsOverride = parseFloat(String(rawSpecCartonsSales || 0).replace(/,/g, '')) || 0;

              if (targetPieces > 0 || salesPiecesOverride > 0 || targetCartons > 0) {
                delegateSpecificProductMap[matchedDel] = {
                  delegateName: matchedDel,
                  productName: specificProductName || 'جبن اماه 200 غم',
                  targetPieces,
                  salesPiecesOverride,
                  targetCartons,
                  salesCartonsOverride,
                  targetShops: rawShopsTarget !== undefined ? (parseInt(String(rawShopsTarget).replace(/,/g, '')) || 0) : 0,
                  actualShopsOverride: rawShopsActual !== undefined ? (parseInt(String(rawShopsActual).replace(/,/g, '')) || 0) : 0
                };
              }
            }
          }
        } catch (errSheet) {
          console.warn('Error parsing sheet:', sheetName, errSheet);
        }
      });

      // Save incentives
      let incCount = 0;
      Object.entries(delegateIncentiveMap).forEach(([delName, amount]) => {
        const incRef = doc(db, 'delegate_incentives', `del_${delName}`.replace(/[\/\s#$[\]]/g, '_'));
        batch.set(incRef, { delegateName: delName, incentivesAmount: amount, updatedAt: new Date().toISOString() }, { merge: true });
        incCount++;
      });

      // Save extra targets
      let extraCount = 0;
      Object.entries(delegateExtraTargetsMap).forEach(([delName, extraData]) => {
        const extraRef = doc(db, 'delegate_monthly_extra_targets', `del_${delName}`.replace(/[\/\s#$[\]]/g, '_'));
        batch.set(extraRef, { ...extraData, updatedAt: new Date().toISOString() }, { merge: true });
        extraCount++;
      });

      // Save specific product targets
      let specCount = 0;
      Object.entries(delegateSpecificProductMap).forEach(([delName, specData]) => {
        const specRef = doc(db, 'specific_product_targets', `del_${delName}`.replace(/[\/\s#$[\]]/g, '_'));
        batch.set(specRef, { ...specData, updatedAt: new Date().toISOString() }, { merge: true });
        specCount++;
      });

      // For all delegates in the uploaded Excel, ensure any omitted category has monthlyTarget: 0 and monthlySales: 0
      const processedDelegatesSet = new Set<string>();
      newTargetsList.forEach(t => processedDelegatesSet.add(t.delegateName));
      
      const targetDelegates = processedDelegatesSet.size > 0 ? Array.from(processedDelegatesSet) : delegateNamesList;

      targetDelegates.forEach((del) => {
        REPORT_11_CATEGORIES.forEach((cat) => {
          const key1 = `${del}_${cat}`;
          const key2 = `${normalizeArabic(del)}_${cat}`;
          const isProvided =
            providedCategoryKeys.has(key1) ||
            providedCategoryKeys.has(key2) ||
            Array.from(providedCategoryKeys).some(k => {
              const parts = k.split('_');
              const kDel = parts[0];
              const kCat = parts.slice(1).join('_');
              return normalizeArabic(kDel) === normalizeArabic(del) && isMatchingReport11Category(kCat, cat);
            });

          if (!isProvided) {
            const docKey = `${del}_${cat}`.replace(/[\/\s#$[\]]/g, '_');
            const docRef = doc(db, 'report11_targets', docKey);
            const record: Report11CategoryTarget = {
              delegateName: del,
              categoryName: cat,
              monthlyTarget: 0,
              monthlySales: 0,
              updatedAt: new Date().toISOString(),
              updatedBy: currentUser?.name || 'الأدمن'
            };
            batch.set(docRef, record);

            const idx = newTargetsList.findIndex(
              t => normalizeArabic(t.delegateName) === normalizeArabic(del) &&
                   isMatchingReport11Category(t.categoryName, cat)
            );
            if (idx >= 0) {
              newTargetsList[idx] = record;
            } else {
              newTargetsList.push(record);
            }
          }
        });
      });

      if (processedCount === 0 && incCount === 0 && extraCount === 0 && specCount === 0) {
        throw new Error('لم يتم العثور على بيانات صالحة في الملف. تأكد من إدراج اسم المندوب والأعمدة المطلوبة.');
      }

      await batch.commit();

      setCategoryTargets(newTargetsList);
      // Fetch fresh lists to update local state since batch commit might not trigger snapshots instantly
      // Or manually update the local states based on maps
      setDelegateIncentives(prev => {
        const next = [...prev];
        Object.entries(delegateIncentiveMap).forEach(([delName, amount]) => {
          const idx = next.findIndex(i => normalizeArabic(i.delegateName) === normalizeArabic(delName));
          if (idx >= 0) next[idx] = { ...next[idx], incentivesAmount: amount };
          else next.push({ delegateName: delName, incentivesAmount: amount });
        });
        return next;
      });
      setExtraTargetsList(prev => {
        const next = [...prev];
        Object.entries(delegateExtraTargetsMap).forEach(([delName, extraData]) => {
          const idx = next.findIndex(t => normalizeArabic(t.delegateName) === normalizeArabic(delName));
          if (idx >= 0) next[idx] = { ...next[idx], ...extraData };
          else next.push(extraData);
        });
        return next;
      });
      setSpecificProductTargets(prev => {
        const next = [...prev];
        Object.entries(delegateSpecificProductMap).forEach(([delName, specData]) => {
          const idx = next.findIndex(t => normalizeArabic(t.delegateName) === normalizeArabic(delName));
          if (idx >= 0) next[idx] = { ...next[idx], ...specData };
          else next.push(specData);
        });
        return next;
      });

      try {
        localStorage.setItem('cache_report11_targets', JSON.stringify(newTargetsList));
      } catch {}

      const detailParts = [];
      if (processedCount > 0) detailParts.push(`${processedCount} سجل أصناف`);
      if (incCount > 0) detailParts.push(`حوافز ${incCount} مندوب`);
      if (extraCount > 0) detailParts.push(`أهداف إضافية لـ ${extraCount} مندوب`);
      if (specCount > 0) detailParts.push(`أهداف منتج محدد لـ ${specCount} مندوب`);

      const summaryText = detailParts.join('، ');

      setUploadFeedback({
        type: 'success',
        message: `تم رفع وتحديث بيانات ملف الإكسل بنجاح (${summaryText}) وإرسال التنبيهات فوراً 📊✅`
      });
      setUserMessage(`تم استيراد ملف الإكسل وتحديث (${summaryText}) بنجاح ✅`);
    } catch (err: any) {
      console.error('Error importing Report 11 Excel:', err);
      setUploadFeedback({
        type: 'error',
        message: err.message || 'حدث خطأ أثناء قراءة ملف الإكسل'
      });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  // Clear & Reset All Excel Category Targets & Monthly Sales for Admin
  const handleClearAllCategoryTargets = async () => {
    const confirmed = await showConfirm('هل أنت متأكد من مسح وتفريغ كافة أهداف ومبيعات الإكسل لجميع الأصناف والمندوبين وتصفيرها إلى 0؟');
    if (!confirmed) return;
    try {
      setIsUploading(true);
      const batch = writeBatch(db);
      const clearedList: Report11CategoryTarget[] = [];

      delegateNamesList.forEach((del) => {
        REPORT_11_CATEGORIES.forEach((cat) => {
          const docKey = `${del}_${cat}`.replace(/[\/\s#$[\]]/g, '_');
          const docRef = doc(db, 'report11_targets', docKey);
          const record: Report11CategoryTarget = {
            delegateName: del,
            categoryName: cat,
            monthlyTarget: 0,
            monthlySales: 0,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser?.name || 'الأدمن'
          };
          batch.set(docRef, record);
          clearedList.push(record);
        });
      });

      await batch.commit();
      setCategoryTargets(clearedList);
      try {
        localStorage.setItem('cache_report11_targets', JSON.stringify(clearedList));
      } catch {}
      setUploadFeedback({
        type: 'success',
        message: 'تم مسح وتصفير كافة أهداف ومبيعات الإكسل بنجاح 🧹✅'
      });
      setUserMessage('تم تصفير أهداف ومبيعات الإكسل بنجاح ✅');
    } catch (err: any) {
      console.error('Error clearing targets:', err);
      setUserMessage('حدث خطأ أثناء التصفير.');
    } finally {
      setIsUploading(false);
    }
  };

  // Download Excel Template for all delegates & 15 categories & incentives & extra targets
  const handleDownloadTemplate = () => {
    try {
      const rows: any[] = [];

      delegateNamesList.forEach(del => {
        const delNorm = normalizeArabic(del);

        const existingInc = delegateIncentives.find(
          i => normalizeArabic(i.delegateName) === delNorm || i.delegateName === del
        );
        const existingExtra = extraTargetsList.find(
          t => normalizeArabic(t.delegateName) === delNorm || t.delegateName === del
        );
        const existingSpec = specificProductTargets.find(
          p => normalizeArabic(p.delegateName) === delNorm || p.delegateName === del
        );

        REPORT_11_CATEGORIES.forEach((cat, idx) => {
          const existing = categoryTargets.find(
            t => normalizeArabic(t.delegateName) === delNorm && isMatchingReport11Category(t.categoryName, cat)
          );

          rows.push({
            'اسم المندوب': del,
            'الصنف': getCategoryDisplayName(cat),
            'الهدف الشهري': existing ? existing.monthlyTarget : 0,
            'المبيعات الشهرية': existing ? existing.monthlySales : 0,
            'الحوافز لحد الان': idx === 0 && existingInc ? existingInc.incentivesAmount : (idx === 0 ? 0 : ''),
            'تاركت ديناري شهري': idx === 0 && existingExtra ? (existingExtra.monthlyIqdTarget || 0) : (idx === 0 ? 0 : ''),
            'مبيعات ديناري شهري': idx === 0 && existingExtra ? (existingExtra.monthlyIqdSalesOverride || 0) : (idx === 0 ? 0 : ''),
            'مطلوب تبيع لعدد محلات': idx === 0 && existingExtra ? (existingExtra.targetShopsCount || 0) : (idx === 0 ? 0 : ''),
            'تم بيع لعدد محلات': idx === 0 && existingExtra ? (existingExtra.actualShopsCountOverride || 0) : (idx === 0 ? 0 : ''),
            'اسم المنتج التأكيدي': idx === 0 && existingExtra ? (existingExtra.extraProductName || 'جبن اماه 200 غم') : (idx === 0 ? 'جبن اماه 200 غم' : ''),
            'تاركت زبائن شهري': idx === 0 && existingExtra ? (existingExtra.extraProductCustomersTarget || 0) : (idx === 0 ? 0 : ''),
            'تم بيع لهم': idx === 0 && existingExtra ? (existingExtra.extraProductCustomersActualOverride || 0) : (idx === 0 ? 0 : ''),
            'تاركت الصنف (قطعة)': idx === 0 && existingSpec ? (existingSpec.targetPieces || 0) : (idx === 0 ? 0 : ''),
            'مبيعات الصنف (قطعة)': idx === 0 && existingSpec ? (existingSpec.salesPiecesOverride || 0) : (idx === 0 ? 0 : '')
          });
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 18 },
        { wch: 28 },
        { wch: 15 },
        { wch: 15 },
        { wch: 18 },
        { wch: 20 },
        { wch: 20 },
        { wch: 22 },
        { wch: 20 },
        { wch: 24 },
        { wch: 18 },
        { wch: 15 },
        { wch: 20 },
        { wch: 20 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'التقرير 11 والشامل');
      XLSX.writeFile(workbook, `نموذج_أهداف_ومبيعات_وحوافز_التقرير_11_${new Date().toISOString().split('T')[0]}.xlsx`);

      setUserMessage('تم تنزيل نموذج الإكسل الشامل لجميع الأهداف والحوافز بنجاح 📥✅');
    } catch (err) {
      console.error('Error downloading template:', err);
      setUserMessage('حدث خطأ أثناء تنزيل النموذج');
    }
  };

  // Export Full Report to Excel
  const handleExportFullExcel = () => {
    try {
      const rows: any[] = [];
      const delegatesToExport = viewMode === 'all' ? delegateNamesList : [activeDelegate];

      delegatesToExport.forEach(del => {
        const delTable = getDelegateTableData(del);

        delTable.rows.forEach(r => {
          rows.push({
            'اسم المندوب': del,
            'الصنف': r.categoryName,
            'التاركت اليومي (كغم)': Math.round(r.dailyTarget),
            'المبيعات اليومية (كغم)': Math.round(r.dailySales),
            'نسبة الإنجاز اليومية %': `${Math.round(r.dailyPct)}%`,
            'التاركت الشهري (كغم)': r.monthlyTarget,
            'المبيعات الشهرية (كغم)': r.monthlySales,
            'المتبقي من الهدف الشهري (كغم)': Math.round(r.remainingMonthly),
            'نسبة الإنجاز الشهرية %': `${Math.round(r.monthlyPct)}%`
          });
        });

        // Totals row
        rows.push({
          'اسم المندوب': `مجموع ${del}`,
          'الصنف': 'المجموع الكلي',
          'التاركت اليومي (كغم)': Math.round(delTable.totals.totalDailyTarget),
          'المبيعات اليومية (كغم)': Math.round(delTable.totals.totalDailySales),
          'نسبة الإنجاز اليومية %': `${Math.round(delTable.totals.totalDailyPct)}%`,
          'التاركت الشهري (كغم)': delTable.totals.totalMonthlyTarget,
          'المبيعات الشهرية (كغم)': delTable.totals.totalMonthlySales,
          'المتبقي من الهدف الشهري (كغم)': Math.round(delTable.totals.totalRemainingMonthly),
          'نسبة الإنجاز الشهرية %': `${Math.round(delTable.totals.totalMonthlyPct)}%`
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 18 },
        { wch: 28 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 24 },
        { wch: 20 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'بيانات التقرير 11');
      XLSX.writeFile(workbook, `التقرير_11_${activeDelegate}_${todayDateString}.xlsx`);

      setUserMessage('تم تصدير تقرير 11 إلى ملف إكسل بنجاح 📊✅');
    } catch (err) {
      console.error('Error exporting report 11:', err);
      setUserMessage('حدث خطأ أثناء تصدير التقرير');
    }
  };

  // Inline Cell Save for Admin
  const handleSaveInlineEdit = async () => {
    if (!editingCell) return;
    const { delegateName, categoryName, field } = editingCell;
    const numVal = parseFloat(parseArabicDigits(editValue.trim())) || 0;

    const matchedCat = matchReport11CategoryName(categoryName) || categoryName;
    const docKey = `${delegateName}_${matchedCat}`.replace(/[\/\s#$[\]]/g, '_');
    const existing = categoryTargets.find(
      t => normalizeArabic(t.delegateName) === normalizeArabic(delegateName) &&
           isMatchingReport11Category(t.categoryName, categoryName)
    );

    const updatedRecord: Report11CategoryTarget = {
      delegateName,
      categoryName: matchedCat,
      monthlyTarget: field === 'monthlyTarget' ? numVal : (existing?.monthlyTarget || 0),
      monthlySales: field === 'monthlySales' ? numVal : (existing?.monthlySales || 0),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.name || 'الأدمن'
    };

    setCategoryTargets(prev => {
      const idx = prev.findIndex(
        t => normalizeArabic(t.delegateName) === normalizeArabic(delegateName) &&
             isMatchingReport11Category(t.categoryName, categoryName)
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updatedRecord;
        return next;
      }
      return [...prev, updatedRecord];
    });

    try {
      await setDoc(doc(db, 'report11_targets', docKey), updatedRecord, { merge: true });
      setUserMessage(`تم تحديث ${field === 'monthlyTarget' ? 'الهدف الشهري' : 'المبيعات الشهرية'} لصنف (${categoryName}) بنجاح ✅`);
    } catch (err) {
      console.error('Error saving inline cell:', err);
      setUserMessage('حدث خطأ أثناء الحفظ');
    } finally {
      setEditingCell(null);
      setEditValue('');
    }
  };

  // WhatsApp Share helper
  const handleShareWhatsApp = () => {
    const table = currentTable;
    let text = `📊 *تقرير (11) - كالة تكريت*\n`;
    text += `👤 *المندوب:* ${table.delegateName}\n`;
    text += `📅 *التاريخ:* ${todayDateString}\n`;
    text += `⏱️ *أيام العمل:* ${config.workingDays} يوم | *المتبقية:* ${config.remainingDays} يوم\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🎯 *إجمالي التاركت اليومي:* ${formatWithCommas(Math.round(table.totals.totalDailyTarget))} كغم\n`;
    text += `📦 *إجمالي المبيعات اليومية:* ${formatWithCommas(Math.round(table.totals.totalDailySales))} كغم\n`;
    text += `⚡ *نسبة الإنجاز اليومية:* ${table.totals.totalDailyPct.toFixed(0)}%\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🏆 *إجمالي التاركت الشهري:* ${formatWithCommas(table.totals.totalMonthlyTarget)} كغم\n`;
    text += `💰 *إجمالي المبيعات الشهرية:* ${formatWithCommas(table.totals.totalMonthlySales)} كغم\n`;
    text += `⏳ *المتبقي من الهدف الشهري:* ${formatWithCommas(Math.round(table.totals.totalRemainingMonthly))} كغم\n`;
    text += `📈 *نسبة الإنجاز الشهرية:* ${table.totals.totalMonthlyPct.toFixed(0)}%\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*تفاصيل الأصناف (15 صنف):*\n`;

    table.rows.forEach(r => {
      text += `▫️ *${r.categoryName}*:\n`;
      text += `   اليومي: تاركت ${Math.round(r.dailyTarget)} | بيع ${Math.round(r.dailySales)} (${Math.round(r.dailyPct)}%)\n`;
      text += `   الشهري: تاركت ${r.monthlyTarget} | بيع ${r.monthlySales} (${Math.round(r.monthlyPct)}%)\n`;
    });

    const encoded = encodeURIComponent(text);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  };

  // Print Handler
  const handlePrint = () => {
    window.print();
  };

  // Render badge helper for achievement percentage
  // Requirement: Highlight in RED if < 75%, highlight in GREEN if > 120%
  const renderPercentBadge = (pct: number) => {
    const isUnder75 = pct < 75;
    const isOver120 = pct > 120;

    let colorClass = '';
    let icon = null;

    if (isUnder75) {
      // Red for < 75%
      colorClass = isDarkMode
        ? 'bg-red-950/90 text-red-300 border-red-700/80 shadow-xs ring-1 ring-red-500/40'
        : 'bg-red-100 text-red-800 border-red-300 shadow-xs ring-1 ring-red-400/40';
      icon = <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />;
    } else if (isOver120) {
      // Green for > 120%
      colorClass = isDarkMode
        ? 'bg-emerald-950/90 text-emerald-300 border-emerald-600/80 shadow-xs ring-1 ring-emerald-500/40'
        : 'bg-emerald-100 text-emerald-800 border-emerald-400 shadow-xs ring-1 ring-emerald-400/40';
      icon = <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />;
    } else {
      // Regular / neutral between 75% and 120%
      colorClass = isDarkMode
        ? 'bg-slate-800/90 text-slate-300 border-slate-700'
        : 'bg-slate-100 text-slate-700 border-slate-200';
      if (pct >= 100) {
        icon = <Check className="w-3 h-3 text-emerald-500 shrink-0" />;
      }
    }

    return (
      <span
        title={isUnder75 ? 'النسبة أقل من 75% (تحت المستهدف)' : isOver120 ? 'النسبة تتجاوز 120% (إنجاز فائق)' : `النسبة: ${pct.toFixed(0)}%`}
        className={`inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs font-black border transition-all ${colorClass}`}
      >
        {icon}
        <span>{pct.toFixed(0)}%</span>
      </span>
    );
  };

  return (
    <PullToRefresh onRefresh={async () => { await refreshAllData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-5 animate-in fade-in duration-200">
      
      {/* Daily Sales Completion Bar & Priority Table (Moved from ReportsScreen) */}
      <DailySalesCompletionBar />

      {/* Header Banner */}
      <div className={`p-4 sm:p-5 rounded-2xl border shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-500 ${
        isDarkMode
          ? 'bg-gradient-to-br from-[#0a1b4b] via-[#08153a] to-[#050c26] border-[#1e293b] text-white shadow-emerald-950/20'
          : 'bg-gradient-to-r from-emerald-50 via-white to-slate-50 border-emerald-200 text-slate-900'
      }`}>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-emerald-700 dark:text-emerald-400">
                التقرير (11)
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                15 صنف رئيسي
              </span>
              {!isAdmin && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  خاص بالمندوب: {currentUser?.name}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              متابعة التاركت اليومي والشهري، مبيعات اليوم من الفواتير، ونسب الإنجاز لكل صنف على حدة
            </p>
          </div>
        </div>

        {/* Action Buttons: WhatsApp, Excel, Print (Admin Only) - Restored */}
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
            <button
              onClick={handleShareWhatsApp}
              title="مشاركة التقرير عبر واتساب"
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="hidden sm:inline">واتساب</span>
            </button>

            <button
              onClick={handleExportFullExcel}
              title="تصدير التقرير كملف إكسل"
              className="px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">تصدير إكسل</span>
            </button>

            <button
              onClick={handlePrint}
              title="طباعة التقرير"
              className={`px-3 py-2 rounded-xl text-xs font-bold border shadow-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              <Printer className="w-4 h-4" />
              <span className="hidden sm:inline">طباعة</span>
            </button>
          </div>
        )}
      </div>

      {/* 🚀 New Delegate Selector Bar (Moved to Top) */}
      {isAdmin && (
        <div className={`p-4 rounded-2xl border shadow-lg space-y-3 ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 text-emerald-500" />
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
              اختيار المندوب / عرض التقرير
            </h3>
          </div>
          <div className="flex flex-wrap gap-2 overflow-x-auto pb-1 scrollbar-hide">

            <button
              onClick={() => {
                setActiveDelegate('__SUPERVISOR__');
                setViewMode('single');
              }}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all border whitespace-nowrap shadow-sm cursor-pointer ${
                activeDelegate === '__SUPERVISOR__' && viewMode === 'single'
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              مشرف (إجمالي المندوبين)
            </button>

            <button
              onClick={() => setViewMode('all')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all border whitespace-nowrap shadow-sm cursor-pointer ${
                viewMode === 'all'
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              عرض جدول جميع المندوبين
            </button>
            {delegateNamesList.map(name => (
              <button
                key={name}
                onClick={() => {
                  setActiveDelegate(name);
                  setViewMode('single');
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all border whitespace-nowrap shadow-sm cursor-pointer ${
                  activeDelegate === name && viewMode === 'single'
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {(isAdmin && !isDataEntry && !isRafatJamal) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Card 1: Working Days & Remaining Days Config */}
          <div className={`lg:col-span-6 p-4 rounded-2xl border shadow-md space-y-3 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-emerald-500" />
                <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                  إعدادات أيام العمل للشهر
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                (يتحكم بها الأدمن فقط)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-black text-slate-600 dark:text-slate-300 mb-1">
                  أيام العمل الكلية
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={inputWorkingDays}
                    onChange={(e) => setInputWorkingDays(Number(e.target.value))}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-black border text-center transition-all ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-500'
                        : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                    }`}
                  />
                  <span className="absolute left-2.5 top-2 text-[10px] text-slate-400 font-bold">يوم</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-600 dark:text-slate-300 mb-1">
                  الأيام المتبقية
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={inputRemainingDays}
                    onChange={(e) => setInputRemainingDays(Number(e.target.value))}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-black border text-center transition-all ${
                      isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-500'
                        : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                    }`}
                  />
                  <span className="absolute left-2.5 top-2 text-[10px] text-slate-400 font-bold">يوم</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 gap-2">
              <button
                onClick={() => setInputRemainingDays(calculateRemainingWorkingDaysInMonth())}
                type="button"
                className="text-[11px] font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>حساب تلقائي للأيام المتبقية</span>
              </button>

              <button
                onClick={handleSaveConfig}
                disabled={isSavingConfig}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingConfig ? 'جاري الحفظ...' : 'تثبيت الأيام'}</span>
              </button>
            </div>
          </div>

          {/* Card 2: Excel Import & Template Download */}
          <div className={`lg:col-span-6 p-4 rounded-2xl border shadow-md space-y-3 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-teal-500" />
                <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                  تحميل أهداف ومبيعات الشهر من الإكسل
                </h3>
              </div>
              <button
                onClick={handleDownloadTemplate}
                className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>تنزيل النموذج الفارغ</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              ارفع ملف الإكسل لتحديث (الهدف الشهري) و(المبيعات الشهرية) لكل مندوب ولكل صنف من الـ 15 صنفاً دفعة واحدة.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <label className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all">
                <FileSpreadsheet className="w-4 h-4" />
                <span>{isUploading ? 'جاري قراءة ورفع الملف...' : 'اختر ملف إكسل لتحميل الأهداف والمبيعات'}</span>
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleExcelUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </label>
              {/*
              <button
                type="button"
                onClick={handleClearAllCategoryTargets}
                disabled={isUploading}
                title="مسح وتفريغ كافة مبيعات وأهداف الإكسل"
                className="px-3 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer shrink-0 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>تصفير المبيعات الأسبوعية/الشهرية</span>
              </button>
              */}
            </div>

            {uploadFeedback && (
              <div className={`p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in ${
                uploadFeedback.type === 'success'
                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                  : 'bg-rose-100 dark:bg-rose-950/70 text-rose-900 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
              }`}>
                {uploadFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{uploadFeedback.message}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 📊 1. تقرير مبيعات اليوم الشامل (Comprehensive Daily Sales Report) */}
      <div className="space-y-3 p-3 sm:p-5 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl w-full text-white">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-800/90 p-3 sm:p-4 rounded-xl border border-slate-700 shadow-md">
          <div>
            <h3 className="font-black text-white text-base sm:text-lg flex items-center gap-2 flex-wrap">
              <span>📊 تقرير مبيعات اليوم الشامل</span>
              <span className="text-xs font-black text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-lg border border-amber-500/30">
                مفرد + جملة + الكل
              </span>
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 font-bold mt-1">
              التاريخ: {todayDateString}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
            {/* View Selector Tabs */}
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-700 text-xs font-bold">
              <button
                type="button"
                onClick={() => setComprehensiveViewTab('three_tables')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  comprehensiveViewTab === 'three_tables'
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                الجداول الثلاثة
              </button>
              <button
                type="button"
                onClick={() => setComprehensiveViewTab('all')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  comprehensiveViewTab === 'all'
                    ? 'bg-amber-600 text-white font-black shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => setComprehensiveViewTab('retail')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  comprehensiveViewTab === 'retail'
                    ? 'bg-emerald-600 text-white font-black shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                المفرد
              </button>
              <button
                type="button"
                onClick={() => setComprehensiveViewTab('wholesale')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  comprehensiveViewTab === 'wholesale'
                    ? 'bg-indigo-600 text-white font-black shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                الجملة
              </button>
            </div>

            {/* Collapse/Expand Toggle */}
            <button
              type="button"
              onClick={() => setIsComprehensiveCollapsed(prev => !prev)}
              className="p-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors cursor-pointer"
              title={isComprehensiveCollapsed ? 'توسيع التقرير الشامل' : 'طي التقرير الشامل'}
            >
              {isComprehensiveCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Quick KPI stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-center">
          <div className="p-2.5 sm:p-3 rounded-xl bg-slate-800/90 border border-slate-700/80">
            <span className="text-[11px] text-slate-400 block font-bold">إجمالي الفواتير</span>
            <span className="text-base sm:text-xl font-black text-white">{totalAllStats.count}</span>
            <span className="text-[10px] text-slate-400 block">مفرد ({totalRetailStats.count}) + جملة ({totalWholesaleStats.count})</span>
          </div>

          <div className="p-2.5 sm:p-3 rounded-xl bg-slate-800/90 border border-slate-700/80">
            <span className="text-[11px] text-slate-400 block font-bold">إجمالي الوزن لليوم</span>
            <span className="text-base sm:text-xl font-black text-amber-400">{formatWithCommas(Math.round(totalAllStats.weight), true)} <span className="text-xs font-normal">كغم</span></span>
            <span className="text-[10px] text-slate-400 block">مفرد ({formatWithCommas(Math.round(totalRetailStats.weight))}) + جملة ({formatWithCommas(Math.round(totalWholesaleStats.weight))})</span>
          </div>

          <div className="p-2.5 sm:p-3 rounded-xl bg-slate-800/90 border border-slate-700/80">
            <span className="text-[11px] text-slate-400 block font-bold">إجمالي المبيعات نقدياً</span>
            <span className="text-base sm:text-xl font-black text-emerald-400">{formatWithCommas(totalAllStats.amount, true)} <span className="text-xs font-normal">د.ع</span></span>
            <span className="text-[10px] text-slate-400 block">حسب أسعار المنتجات</span>
          </div>

          <div className="p-2.5 sm:p-3 rounded-xl bg-slate-800/90 border border-slate-700/80">
            <span className="text-[11px] text-slate-400 block font-bold">الهدف اليومي للفرع</span>
            <span className="text-base sm:text-xl font-black text-indigo-400">{formatWithCommas(Math.round(supervisorTableData.totals.totalDailyTarget), true)} <span className="text-xs font-normal">كغم</span></span>
            <span className="text-[10px] text-slate-400 block">نسبة التحقيق: {supervisorTableData.totals.totalDailyPct.toFixed(0)}%</span>
          </div>
        </div>

        {/* The Tables Container */}
        {!isComprehensiveCollapsed && (
          <div className="space-y-4 pt-1 animate-in fade-in duration-200">
            {/* 1. Retail Sales Table */}
            {(comprehensiveViewTab === 'three_tables' || comprehensiveViewTab === 'retail') && (
              <div className="bg-slate-800 rounded-xl p-2 sm:p-4 text-white shadow-lg border border-slate-700/60 w-full">
                <h4 className="font-black mb-2 text-sm sm:text-base text-emerald-400 flex items-center gap-1.5">
                  <span>🛒</span>
                  <span>جدول مبيعات المفرد (لليوم)</span>
                </h4>
                <div className="overflow-x-auto w-full">
                  <table className="w-full min-w-full text-xs sm:text-sm font-bold text-center border-collapse border border-white/30">
                    <thead>
                      <tr className="border-b border-white/30 text-white bg-slate-900/80 font-black">
                        <th className="py-2 px-2 border border-white/30">المندوب</th>
                        <th className="py-2 px-2 border border-white/30">عدد الفواتير</th>
                        <th className="py-2 px-2 border border-white/30">الوزن (كجم)</th>
                        <th className="py-2 px-2 border border-white/30">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(isAdmin ? retailSalesList : retailSalesList.filter(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))).map(s => (
                        <tr key={s.name} className={`border-b border-white/20 font-bold transition-colors ${isDelegateCompleted(s.name) ? 'bg-emerald-950/40 hover:bg-emerald-900/50' : 'hover:bg-slate-700/50'}`}>
                          <td className={`py-2 px-2 font-black border border-white/20 transition-colors ${
                            isDelegateCompleted(s.name) ? 'bg-emerald-500/25 text-emerald-300' : ''
                          }`}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span className={isDelegateCompleted(s.name) ? 'text-emerald-300 font-black' : ''}>{s.name}</span>
                              {isDelegateCompleted(s.name) && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-500 text-slate-950 shrink-0 shadow-xs">
                                  <Check className="w-3 h-3 text-slate-950 font-black" />
                                  <span>مكتمل</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`py-2 px-2 font-black border border-white/20 ${s.count < 1 ? 'text-red-400' : ''}`}>{s.count}</td>
                          <td className="py-2 px-2 font-bold border border-white/20">{formatWithCommas(Number(s.weight.toFixed(0)), true)}</td>
                          <td className="py-2 px-2 font-black border border-white/20">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-white/40 bg-slate-900 font-black text-xs sm:text-sm">
                        <td className="py-2 px-2 text-emerald-300 border border-white/30">
                          {isAdmin ? 'إجمالي المفرد' : `مبيعات المفرد لـ ${currentUser?.name}`}
                        </td>
                        <td className={`py-2 px-2 border border-white/30 ${(isAdmin ? totalRetailStats.count : (retailSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.count || 0)) < 1 ? 'text-red-400' : ''}`}>
                          {isAdmin ? totalRetailStats.count : (retailSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.count || 0)}
                        </td>
                        <td className="py-2 px-2 border border-white/30">
                          {formatWithCommas(Number((isAdmin ? totalRetailStats.weight : (retailSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.weight || 0)).toFixed(0)), true)}
                        </td>
                        <td className="py-2 px-2 border border-white/30">
                          {formatWithCommas(isAdmin ? totalRetailStats.amount : (retailSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.amount || 0), true)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 2. Wholesale Sales Table */}
            {(comprehensiveViewTab === 'three_tables' || comprehensiveViewTab === 'wholesale') && (
              <div className="bg-slate-800 rounded-xl p-2 sm:p-4 text-white shadow-lg border border-slate-700/60 w-full">
                <h4 className="font-black mb-2 text-sm sm:text-base text-indigo-400 flex items-center gap-1.5">
                  <span>📦</span>
                  <span>جدول مبيعات الجملة (لليوم)</span>
                </h4>
                <div className="overflow-x-auto w-full">
                  <table className="w-full min-w-full text-xs sm:text-sm font-bold text-center border-collapse border border-white/30">
                    <thead>
                      <tr className="border-b border-white/30 text-white bg-slate-900/80 font-black">
                        <th className="py-2 px-2 border border-white/30">المندوب</th>
                        <th className="py-2 px-2 border border-white/30">عدد الفواتير</th>
                        <th className="py-2 px-2 border border-white/30">الوزن (كجم)</th>
                        <th className="py-2 px-2 border border-white/30">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(isAdmin ? wholesaleSalesList : wholesaleSalesList.filter(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))).map(s => (
                        <tr key={s.name} className={`border-b border-white/20 font-bold transition-colors ${isDelegateCompleted(s.name) ? 'bg-emerald-950/40 hover:bg-emerald-900/50' : 'hover:bg-slate-700/50'}`}>
                          <td className={`py-2 px-2 font-black border border-white/20 transition-colors ${
                            isDelegateCompleted(s.name) ? 'bg-emerald-500/25 text-emerald-300' : ''
                          }`}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span className={isDelegateCompleted(s.name) ? 'text-emerald-300 font-black' : ''}>{s.name}</span>
                              {isDelegateCompleted(s.name) && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-500 text-slate-950 shrink-0 shadow-xs">
                                  <Check className="w-3 h-3 text-slate-950 font-black" />
                                  <span>مكتمل</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`py-2 px-2 font-black border border-white/20 ${s.count < 1 ? 'text-red-400' : ''}`}>{s.count}</td>
                          <td className="py-2 px-2 font-bold border border-white/20">{formatWithCommas(Number(s.weight.toFixed(0)), true)}</td>
                          <td className="py-2 px-2 font-black border border-white/20">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-white/40 bg-slate-900 font-black text-xs sm:text-sm">
                        <td className="py-2 px-2 text-indigo-300 border border-white/30">
                          {isAdmin ? 'إجمالي الجملة' : `مبيعات الجملة لـ ${currentUser?.name}`}
                        </td>
                        <td className={`py-2 px-2 border border-white/30 ${(isAdmin ? totalWholesaleStats.count : (wholesaleSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.count || 0)) < 1 ? 'text-red-400' : ''}`}>
                          {isAdmin ? totalWholesaleStats.count : (wholesaleSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.count || 0)}
                        </td>
                        <td className="py-2 px-2 border border-white/30">
                          {formatWithCommas(Number((isAdmin ? totalWholesaleStats.weight : (wholesaleSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.weight || 0)).toFixed(0)), true)}
                        </td>
                        <td className="py-2 px-2 border border-white/30">
                          {formatWithCommas(isAdmin ? totalWholesaleStats.amount : (wholesaleSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.amount || 0), true)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3. All Sales Summary Table */}
            {(comprehensiveViewTab === 'three_tables' || comprehensiveViewTab === 'all') && (
              <div ref={allSalesTableRef} className="bg-amber-950/70 border border-amber-600/60 rounded-xl p-2 sm:p-4 text-white shadow-lg w-full">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <h4 className="font-black text-sm sm:text-base text-amber-400 flex items-center gap-1.5">
                    <span>🏆</span>
                    <span>جدول مبيعات الكل (مفرد + جملة)</span>
                  </h4>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleExportAllSalesTableJpeg}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                      title="إرسال صورة التقرير بصيغة JPEG إلى واتساب"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>واتساب (صورة JPEG)</span>
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto w-full">
                  <table className="w-full min-w-full text-xs sm:text-sm font-bold text-center border-collapse border border-white/30">
                    <thead>
                      <tr className="border-b border-white/30 text-amber-200 bg-amber-900/60 font-black">
                        <th className="py-2 px-2 border border-white/30">المندوب</th>
                        <th className="py-2 px-2 border border-white/30">إجمالي الفواتير</th>
                        <th className="py-2 px-2 border border-white/30">إجمالي الوزن (كجم)</th>
                        <th className="py-2 px-2 border border-white/30">إجمالي المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(isAdmin ? allSalesList : allSalesList.filter(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))).map(s => (
                        <tr key={s.name} className={`border-b border-white/20 font-bold transition-colors ${isDelegateCompleted(s.name) ? 'bg-emerald-950/40 hover:bg-emerald-900/50' : 'hover:bg-amber-800/40'}`}>
                          <td className={`py-2 px-2 font-black border border-white/20 transition-colors ${
                            isDelegateCompleted(s.name) ? 'bg-emerald-500/25 text-emerald-300' : ''
                          }`}>
                            <div className="flex items-center justify-center gap-1.5">
                              <span className={isDelegateCompleted(s.name) ? 'text-emerald-300 font-black' : ''}>{s.name}</span>
                              {isDelegateCompleted(s.name) && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-500 text-slate-950 shrink-0 shadow-xs">
                                  <Check className="w-3 h-3 text-slate-950 font-black" />
                                  <span>مكتمل</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`py-2 px-2 font-black border border-white/20 ${s.count < 1 ? 'text-red-400' : ''}`}>{s.count}</td>
                          <td className="py-2 px-2 font-bold border border-white/20">{formatWithCommas(Number(s.weight.toFixed(0)), true)}</td>
                          <td className="py-2 px-2 font-black border border-white/20">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-white/40 bg-amber-950 font-black text-amber-300 text-xs sm:text-sm">
                        <td className="py-2 px-2 border border-white/30">
                          {isAdmin ? 'الإجمالي الكلي' : `إجمالي مبيعات ${currentUser?.name}`}
                        </td>
                        <td className={`py-2 px-2 border border-white/30 ${(isAdmin ? totalAllStats.count : (allSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.count || 0)) < 1 ? 'text-red-400' : ''}`}>
                          {isAdmin ? totalAllStats.count : (allSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.count || 0)}
                        </td>
                        <td className="py-2 px-2 border border-white/30">
                          {formatWithCommas(Number((isAdmin ? totalAllStats.weight : (allSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.weight || 0)).toFixed(0)), true)}
                        </td>
                        <td className="py-2 px-2 border border-white/30">
                          {formatWithCommas(isAdmin ? totalAllStats.amount : (allSalesList.find(s => normalizeArabic(s.name) === normalizeArabic(currentUser?.name || ''))?.amount || 0), true)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {/* 📋 2. جدول التقرير الكلي لجميع المندوبين (اليوم الحالي) */}
      <div className={`p-4 sm:p-5 rounded-2xl border shadow-xl space-y-4 ${
        isDarkMode ? 'bg-slate-900 border-emerald-500/30' : 'bg-white border-emerald-200'
      }`}>
        {/* Aggregated Delegate Comparison Table (جدول التقرير الكلي لجميع المندوبين لليوم الحالي) */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-emerald-500" />
              <span>جدول التقرير الكلي لجميع المندوبين (اليوم الحالي)</span>
            </h4>
            <span className="text-[11px] text-slate-400">
              {delegateDailySummaryList.length} مندوبين
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs sm:text-sm text-center border-collapse">
              <thead>
                <tr className={`font-black ${
                  isDarkMode ? 'bg-slate-800 text-slate-200 border-b border-slate-700' : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                }`}>
                  <th className="py-2.5 px-3">المندوب</th>
                  <th className="py-2.5 px-3">عدد الفواتير</th>
                  <th className="py-2.5 px-3">وزن المبيعات اليومي (كجم)</th>
                  <th className="py-2.5 px-3">الهدف اليومي (كجم)</th>
                  <th className="py-2.5 px-3">النسبة</th>
                  <th className="py-2.5 px-3">حالة التحقيق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(isAdmin ? delegateDailySummaryList : delegateDailySummaryList.filter(item => normalizeArabic(item.name) === normalizeArabic(currentUser?.name || ''))).map(item => {
                  const isCurrent = activeDelegate === item.name;
                  return (
                    <tr
                      key={item.name}
                      onClick={() => {
                        if (isAdmin) {
                          setActiveDelegate(item.name);
                        }
                      }}
                      className={`transition-colors font-bold ${
                        isAdmin ? 'cursor-pointer' : ''
                      } ${
                        isCurrent
                          ? isDarkMode ? 'bg-emerald-950/40 hover:bg-emerald-950/60' : 'bg-emerald-50/80 hover:bg-emerald-100/70'
                          : isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className={`py-2 px-3 font-black transition-colors ${
                        isDelegateCompleted(item.name) ? 'bg-emerald-500/25 text-emerald-600 dark:text-emerald-300' : ''
                      }`}>
                        <div className="flex items-center justify-center gap-1.5">
                          <span>{item.name}</span>
                          {isCurrent && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="المندوب المحدد حالياً" />
                          )}
                          {isDelegateCompleted(item.name) && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-500 text-slate-950 shrink-0 shadow-xs">
                              <Check className="w-3 h-3 text-slate-950 font-black" />
                              <span>مكتمل</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`py-2 px-3 font-black ${item.invoiceCount < 1 ? 'text-red-500' : ''}`}>
                        {item.invoiceCount}
                      </td>
                      <td className="py-2 px-3 font-bold">
                        {formatWithCommas(Math.round(item.dailySalesWeight), true)}
                      </td>
                      <td className="py-2 px-3 font-bold">
                        {formatWithCommas(Math.round(item.dailyTarget), true)}
                      </td>
                      <td className="py-2 px-3">
                        {renderPercentBadge(item.pct)}
                      </td>
                      <td className="py-2 px-3">
                        {item.isAchieved ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>مكتمل</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-black text-red-600 dark:text-red-400">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-bounce" />
                            <span>متبقي {formatWithCommas(Math.round(item.remaining))} كغم</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* Branch Totals Row */}
                <tr className={`font-black border-t-2 ${
                  isDarkMode
                    ? 'bg-slate-950 text-emerald-400 border-emerald-500/40'
                    : 'bg-emerald-50/90 text-emerald-900 border-emerald-300'
                }`}>
                  <td className="py-2.5 px-3 font-black">
                    {branchDelegateDailyTotals.name}
                  </td>
                  <td className="py-2.5 px-3 font-black">
                    {branchDelegateDailyTotals.invoiceCount}
                  </td>
                  <td className="py-2.5 px-3 font-black">
                    {formatWithCommas(Math.round(branchDelegateDailyTotals.dailySalesWeight), true)}
                  </td>
                  <td className="py-2.5 px-3 font-black">
                    {formatWithCommas(Math.round(branchDelegateDailyTotals.dailyTarget), true)}
                  </td>
                  <td className="py-2.5 px-3">
                    {renderPercentBadge(branchDelegateDailyTotals.pct)}
                  </td>
                  <td className="py-2.5 px-3">
                    {branchDelegateDailyTotals.isAchieved ? (
                      <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>محقق إجمالاً</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-black text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>متبقي {formatWithCommas(Math.round(branchDelegateDailyTotals.remaining))} كغم</span>
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Delegate's Own Info Banner */}
      {!isAdmin && (
        <div className={`p-3.5 rounded-2xl border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
          isDarkMode ? 'bg-slate-900 border-emerald-500/30' : 'bg-emerald-50/70 border-emerald-200'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">
                جدول أهداف ومبيعات: {String(currentUser?.name || '')}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                أيام العمل: {config.workingDays} يوم | الأيام المتبقية: {config.remainingDays} يوم
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {currentTable.totals.totalDailyTarget > 0 && (
              currentTable.totals.totalDailySales < currentTable.totals.totalDailyTarget ? (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-red-100 dark:bg-red-950/70 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-300 text-xs font-black">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
                  <span>لم يحقق التاركت اليومي</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-black">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>حقق التاركت اليومي</span>
                </div>
              )
            )}
            <div className="text-left">
              <span className="text-[11px] font-bold text-slate-400 block">تاريخ اليوم</span>
              <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">{todayDateString}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Table Content */}
      <div ref={printRef} className="space-y-6">
        
        {viewMode === 'all' && isAdmin ? (
          /* All Delegates Tables Overview */
          <div className="space-y-8">
            {delegateNamesList.map(del => {
              const table = getDelegateTableData(del);
              const status = delegatesDailyStatus[del];
              const notAchieved = status && !status.isAchieved && status.totalDailyTarget > 0;
              return (
                <div key={del} className="space-y-2">
                  <div className="flex items-center justify-between px-1 flex-wrap gap-2">
                    <h3 className="text-base font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                      <User className="w-5 h-5" />
                      <span>جدول المندوب: {del}</span>
                    </h3>
                    {notAchieved ? (
                      <span className="flex items-center gap-1.5 text-xs font-black px-2.5 py-1 rounded-xl bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-800 shadow-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
                        <span>لم يحقق التاركت اليومي (متبقي {formatWithCommas(Math.round(status.remainingDaily))} كغم)</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-black px-2.5 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>حقق التاركت اليومي ({status ? status.totalDailyPct.toFixed(0) : 0}%)</span>
                      </span>
                    )}
                  </div>
                  <DelegateTableView
                    table={table}
                    isDarkMode={isDarkMode}
                    isAdmin={isAdmin}
                    remainingDays={config.remainingDays}
                    renderPercentBadge={renderPercentBadge}
                    onStartEdit={(delegateName, categoryName, field, currentVal) => {
                      setEditingCell({ delegateName, categoryName, field });
                      setEditValue(String(currentVal || ''));
                    }}
                    isRafatJamal={isRafatJamal}
                  />
                </div>
              );
            })}

            {!isRafatJamal && (
              <div className="space-y-2 pt-6 border-t-2 border-indigo-500/30">
                <div className="flex items-center justify-between px-1 flex-wrap gap-2">
                  <h3 className="text-base font-black text-indigo-700 dark:text-indigo-400 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    <span>جدول تاركت المشرف (إجمالي مبيعات وتاركت المندوبين)</span>
                  </h3>
                  <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                    إجمالي الفرع بالكامل
                  </span>
                </div>
                <DelegateTableView
                  table={supervisorTableData}
                  isDarkMode={isDarkMode}
                  isAdmin={isAdmin}
                  remainingDays={config.remainingDays}
                  renderPercentBadge={renderPercentBadge}
                  onStartEdit={() => {}}
                  defaultLayoutMode="table"
                  isRafatJamal={isRafatJamal}
                />
              </div>
            )}
          </div>
        ) : (
          /* Single Delegate Table View */
          <div className="space-y-4">
            {/* Clear Delegate Name Header */}
            <div className="flex items-center justify-between px-1 py-1 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 mb-1">
              <h2 className="text-base sm:text-lg font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-emerald-600/70 dark:text-emerald-500/50 font-bold leading-tight">عرض بيانات المندوب</span>
                  <span className="leading-tight">جدول المندوب: {activeDelegate === 'الكل' || !activeDelegate ? (currentUser?.name || 'المندوب') : activeDelegate}</span>
                </div>
              </h2>
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Daily Target */}
              <div className={`p-3.5 rounded-2xl border shadow-sm space-y-1 ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span className="text-xs font-bold">التاركت اليومي</span>
                  <Target className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  {formatWithCommas(Math.round(currentTable.totals.totalDailyTarget))} <span className="text-xs font-normal text-slate-400">كغم</span>
                </div>
                <p className="text-[10px] text-slate-400">المتبقي ÷ {config.remainingDays} يوم</p>
              </div>

              {/* Daily Sales */}
              <div className={`p-3.5 rounded-2xl border shadow-sm space-y-1 ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span className="text-xs font-bold">مبيعات اليوم</span>
                  <TrendingUp className="w-4 h-4 text-teal-500" />
                </div>
                <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center justify-between">
                  <span>{formatWithCommas(Math.round(currentTable.totals.totalDailySales))} <span className="text-xs font-normal text-slate-400">كغم</span></span>
                  {renderPercentBadge(currentTable.totals.totalDailyPct)}
                </div>
                {currentTable.totals.totalDailyTarget > 0 && currentTable.totals.totalDailySales < currentTable.totals.totalDailyTarget ? (
                  <div className="flex items-center gap-1 text-[10px] font-black text-red-600 dark:text-red-400 pt-0.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-bounce" />
                    <span>لم يحقق التاركت اليومي (متبقي {formatWithCommas(Math.round(currentTable.totals.totalDailyTarget - currentTable.totals.totalDailySales))} كغم)</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400">من الفواتير المسجلة اليوم</p>
                )}
              </div>

              {/* Monthly Target */}
              <div className={`p-3.5 rounded-2xl border shadow-sm space-y-1 ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span className="text-xs font-bold">التاركت الشهري</span>
                  <Scale className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  {formatWithCommas(Math.round(currentTable.totals.totalMonthlyTarget))} <span className="text-xs font-normal text-slate-400">كغم</span>
                </div>
                <p className="text-[10px] text-slate-400">من ملف الإكسل المرفوع</p>
              </div>

              {/* Monthly Sales */}
              <div className={`p-3.5 rounded-2xl border shadow-sm space-y-1 ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span className="text-xs font-bold">المبيعات الشهرية</span>
                  <Percent className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center justify-between">
                  <span>{formatWithCommas(Math.round(currentTable.totals.totalMonthlySales))} <span className="text-xs font-normal text-slate-400">كغم</span></span>
                  {renderPercentBadge(currentTable.totals.totalMonthlyPct)}
                </div>
                <p className="text-[10px] text-slate-400">المتبقي: {formatWithCommas(Math.round(currentTable.totals.totalRemainingMonthly))} كغم</p>
              </div>
            </div>

            {/* Table */}
            <DelegateTableView
              table={currentTable}
              isDarkMode={isDarkMode}
              isAdmin={isAdmin}
              remainingDays={config.remainingDays}
              renderPercentBadge={renderPercentBadge}
              onStartEdit={(delegateName, categoryName, field, currentVal) => {
                setEditingCell({ delegateName, categoryName, field });
                setEditValue(String(currentVal || ''));
              }}
              supervisorTable={supervisorTableData}
              isRafatJamal={isRafatJamal}
            />
          </div>
        )}
      </div>

      {/* Inline Edit Modal for Admin */}
      {editingCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className={`w-full max-w-sm p-5 rounded-2xl shadow-2xl border text-right space-y-4 animate-in zoom-in-95 ${
            isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div>
              <h3 className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                تعديل {editingCell.field === 'monthlyTarget' ? 'الهدف الشهري' : 'المبيعات الشهرية'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                المندوب: {editingCell.delegateName} | الصنف: {editingCell.categoryName}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                القيمة الجديدة (بالكيلوغرام)
              </label>
              <input
                type="number"
                step="any"
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveInlineEdit();
                  if (e.key === 'Escape') setEditingCell(null);
                }}
                className={`w-full px-3 py-2 rounded-xl text-sm font-black border text-center transition-all ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-500'
                    : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                }`}
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setEditingCell(null)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveInlineEdit}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl shadow-md transition-all cursor-pointer"
              >
                حفظ التعديل
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Note / Guide Footer (Admin Only) */}
      {isAdmin && (
        <div className={`p-4 rounded-2xl border text-xs leading-relaxed space-y-1 ${
          isDarkMode ? 'bg-slate-900/60 border-slate-800/80 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}>
          <p className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-emerald-500" />
            <span>ملاحظات الحساب والمعادلات في التقرير (11):</span>
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] pr-2">
            <li><strong>المتبقي من الهدف الشهري:</strong> (الهدف الشهري - المبيعات الشهرية).</li>
            <li><strong>التاركت اليومي:</strong> (المتبقي من الهدف الشهري ÷ الأيام المتبقية للشهر).</li>
            <li><strong>المبيعات اليومية:</strong> يتم جلبها فوراً من فواتير اليوم للمندوب وتصنيفها آلياً حسب الصنف من الـ 15 صنفاً.</li>
            <li><strong>نسبة الإنجاز اليومية:</strong> (المبيعات اليومية ÷ التاركت اليومي) × 100%.</li>
            <li><strong>نسبة الإنجاز الشهرية:</strong> (المبيعات الشهرية ÷ الهدف الشهري) × 100%.</li>
          </ul>

          {/* Color and Status Legend */}
          <div className="pt-2.5 mt-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3 flex-wrap text-[11px] font-black">
            <span className="text-slate-500 dark:text-slate-400">دلالات الألوان والرموز:</span>
            <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
              <span>أحمر: النسبة أقل من 75%</span>
            </span>
            <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block"></span>
              <span>عادي: النسبة بين 75% و 120%</span>
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
              <span>أخضر: النسبة تتجاوز 120%</span>
            </span>
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 inline-block" />
              <span>أيقونة تحذيرية: لم يتم تحقيق التاركت اليومي</span>
            </span>
          </div>
        </div>
      )}



      {/* 📊 2. الأهداف والمبيعات التراكمية الإضافية (الإجمالي العام) */}
      <div className={`p-4 sm:p-5 rounded-2xl border-2 shadow-xl space-y-4 ${
        isDarkMode ? 'bg-slate-900 border-emerald-500/30 text-white' : 'bg-white border-emerald-200 text-slate-900'
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold shrink-0">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base flex items-center gap-2 flex-wrap">
                <span className="text-slate-900 dark:text-white">{String(extraTargetsStats.title || '')}</span>
                {extraTargetsStats.isTotal && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                    مجموع كافة المندوبين
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                {extraTargetsStats.isTotal
                  ? 'إجمالي ومجموع أداء المبيعات والتاركت الإضافي لكافة المندوبين للشهر الحالي'
                  : 'متابعة التاركت الديناري، تغطية المحلات، وأداء زبائن الصنف التأكيدي للشهر الحالي'}
              </p>
            </div>
          </div>

          {isAdmin && !isRafatJamal && (
            <button
              type="button"
                onClick={() => {
                  const targetDel = activeDelegate !== 'الكل' ? activeDelegate : (delegateNamesList[0] || '');
                  setEditExtraTargetDelegate(targetDel);
                  const existing = extraTargetsList.find(t => t.delegateName === targetDel);
                  setEditMonthlyIqdTarget(existing ? String(existing.monthlyIqdTarget || '') : '');
                  setEditTargetShopsCount(existing ? String(existing.targetShopsCount || '') : '');
                  setEditExtraProductName(existing?.extraProductName || 'جبن مسدمر مثلث 90 غم');
                  setEditExtraProductCustomersTarget(existing ? String(existing.extraProductCustomersTarget || '') : '');
                  setShowEditExtraTargetsModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>تعديل الأهداف الإضافية</span>
              </button>
          )}
        </div>

        {/* 3 Grid Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Card 1: تاركت ديناري شهري ومبيعات ديناري شهري */}
          <div className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
            extraTargetsStats.iqdPct >= 100
              ? 'bg-lime-400/10 border-lime-400/50 ring-1 ring-lime-400/40 shadow-sm'
              : isDarkMode
              ? 'bg-slate-950/80 border-slate-800'
              : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 shrink-0">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-xs sm:text-sm">التاركت الديناري الشهري</h4>
                  <span className="text-[10px] text-slate-400 font-bold">المبيعات النقدية بالدينار</span>
                </div>
              </div>
              {extraTargetsStats.iqdPct >= 100 && (
                <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-lime-400 text-slate-950 font-black text-[9px] shadow-sm">
                  👑 100%+
                </span>
              )}
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800/80 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-bold">تاركت ديناري شهري:</span>
                <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                  {formatWithCommas(Number(extraTargetsStats.iqdTarget.toFixed(0)), true)} <span className="text-[9px] text-slate-400 font-normal">د.ع</span>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-bold">مبيعات ديناري شهري:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                  {formatWithCommas(Number(extraTargetsStats.iqdSales.toFixed(0)), true)} <span className="text-[9px] text-slate-400 font-normal">د.ع</span>
                </span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 dark:text-slate-400 font-extrabold">النسبة %:</span>
                <span className={`font-mono font-black text-sm ${extraTargetsStats.iqdPct >= 100 ? 'text-lime-500 dark:text-[#39ff14]' : 'text-blue-600 dark:text-blue-400'}`}>
                  {extraTargetsStats.iqdPct.toFixed(0)}%
                </span>
              </div>

              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden mt-1">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    extraTargetsStats.iqdPct >= 100 ? 'bg-lime-400 dark:bg-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.8)]' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, extraTargetsStats.iqdPct))}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Card 2: مطلوب تبيع لعدد محلات وتم بيع لعدد محلات */}
          <div className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
            extraTargetsStats.shopsPct >= 100
              ? 'bg-lime-400/10 border-lime-400/50 ring-1 ring-lime-400/40 shadow-sm'
              : isDarkMode
              ? 'bg-slate-950/80 border-slate-800'
              : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-500/20 text-blue-500 shrink-0">
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-xs sm:text-sm">تغطية عدد المحلات</h4>
                  <span className="text-[10px] text-slate-400 font-bold">الانتشار وعدد المحلات</span>
                </div>
              </div>
              {extraTargetsStats.shopsPct >= 100 && (
                <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-lime-400 text-slate-950 font-black text-[9px] shadow-sm">
                  👑 100%+
                </span>
              )}
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800/80 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-bold">مطلوب تبيع لعدد محلات:</span>
                <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                  {extraTargetsStats.shopsTarget.toFixed(0)} <span className="text-[9px] text-slate-400 font-normal">محل</span>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-bold">تم بيع لعدد محلات:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                  {extraTargetsStats.shopsActual.toFixed(0)} <span className="text-[9px] text-slate-400 font-normal">محل</span>
                </span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 dark:text-slate-400 font-extrabold">النسبة %:</span>
                <span className={`font-mono font-black text-sm ${extraTargetsStats.shopsPct >= 100 ? 'text-lime-500 dark:text-[#39ff14]' : 'text-blue-600 dark:text-blue-400'}`}>
                  {extraTargetsStats.shopsPct.toFixed(0)}%
                </span>
              </div>

              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden mt-1">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    extraTargetsStats.shopsPct >= 100 ? 'bg-lime-400 dark:bg-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.8)]' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, extraTargetsStats.shopsPct))}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Card 3: اسم المنتج الإضافي، تاركت زبائن شهري، تم بيع لهم */}
          <div className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
            extraTargetsStats.extraCustPct >= 100
              ? 'bg-lime-400/10 border-lime-400/50 ring-1 ring-lime-400/40 shadow-sm'
              : isDarkMode
              ? 'bg-slate-950/80 border-slate-800'
              : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-purple-500/20 text-purple-500 shrink-0">
                  <PackagePlus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-xs sm:text-sm">المنتج التأكيدي</h4>
                  <span className="text-[10px] text-slate-400 font-bold">هدف الصنف الترويجي</span>
                </div>
              </div>
              {extraTargetsStats.extraCustPct >= 100 && (
                <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-lime-400 text-slate-950 font-black text-[9px] shadow-sm">
                  👑 100%+
                </span>
              )}
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800/80 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-bold">اسم المنتج التأكيدي:</span>
                <span className="font-black text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md border border-purple-500/20 truncate max-w-[130px]">
                  {extraTargetsStats.extraProdName}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-bold">تاركت زبائن شهري:</span>
                <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                  {extraTargetsStats.extraCustTarget.toFixed(0)} <span className="text-[9px] text-slate-400 font-normal">زبون</span>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-bold">تم بيع لهم:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                  {extraTargetsStats.extraCustActual.toFixed(0)} <span className="text-[9px] text-slate-400 font-normal">زبون</span>
                </span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 dark:text-slate-400 font-extrabold">النسبة %:</span>
                <span className={`font-mono font-black text-sm ${extraTargetsStats.extraCustPct >= 100 ? 'text-lime-500 dark:text-[#39ff14]' : 'text-purple-600 dark:text-purple-400'}`}>
                  {extraTargetsStats.extraCustPct.toFixed(0)}%
                </span>
              </div>

              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden mt-1">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    extraTargetsStats.extraCustPct >= 100 ? 'bg-lime-400 dark:bg-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.8)]' : 'bg-purple-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, extraTargetsStats.extraCustPct))}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 📦 1. تاركت اضافي للمنتج : (اسم المنتج) */}
      <div className={`p-4 sm:p-5 rounded-2xl border-2 shadow-xl space-y-4 ${
        isDarkMode ? 'bg-slate-900 border-indigo-500/30 text-white' : 'bg-white border-indigo-200 text-slate-900'
      }`}>
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center font-black shadow-md shrink-0">
              <Package className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-sm sm:text-base flex items-center gap-2">
                  <span>تاركت اضافي للمنتج :</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-bold">
                    {String(specificProductStats.productName || specificProductName || 'جبن اماه 200 غم')}
                  </span>
                </h3>
                {specificProductStats.isAggregated ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                    مجموع كافة المندوبين
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                    المندوب: {String(specificProductStats.delegateName || '')}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 shadow-sm">
                  <span className="text-amber-500 text-sm">💡</span>
                  <span>بيع هذه الكمية لهذه المحلات يتم حساب نصف كارتون للتغطية</span>
                </span>
              </div>
            </div>
          </div>

          {/* Admin Controls Toolbar */}
          {isAdmin && !isRafatJamal && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl border border-slate-300 dark:border-slate-700">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap px-1">
                  اسم المنتج:
                </span>
                <input
                  type="text"
                  list="report11-specific-products-datalist"
                  value={tempSpecificProductName}
                  onChange={(e) => setTempSpecificProductName(e.target.value)}
                  placeholder="اكتب اسم المنتج..."
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 w-36 sm:w-44"
                />
                <datalist id="report11-specific-products-datalist">
                  {productsList.map((p) => (
                    <option key={p.id || p.productName} value={p.productName} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={handleSaveSpecificProductName}
                  disabled={isSavingSpecificProductName || !tempSpecificProductName.trim()}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black rounded-lg shadow transition-all disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                  title="حفظ وتحديد الصنف المخصص لكافة المندوبين"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSavingSpecificProductName ? '...' : 'حفظ'}</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5 justify-end flex-wrap">
                <input
                  type="file"
                  ref={specificProductExcelInputRef}
                  onChange={handleSpecificProductExcelUpload}
                  accept=".xlsx, .xls"
                  className="hidden"
                />
                {/* Excel upload button for specific product target */}
                <button
                  type="button"
                  onClick={() => specificProductExcelInputRef.current?.click()}
                  disabled={isUploadingSpecificProductExcel}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
                  title="رفع ملف إكسل مخصص لتحديث مبيعات وتاركت ومحلات المنتج المحدد"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isUploadingSpecificProductExcel ? 'جاري الرفع...' : 'رفع إكسل المنتج المحدد'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadSpecificProductTemplate}
                  className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                  title="تحميل نموذج الإكسل الخاص بالصنف المحدد"
                >
                  <Download className="w-4 h-4" />
                  <span>نموذج الإكسل</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const targetDel = activeDelegate !== 'الكل' ? activeDelegate : (delegateNamesList[0] || '');
                    openEditSpecificProduct(targetDel);
                  }}
                  className="flex items-center gap-1 px-2.5 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                  title="تعديل يدوي لأهداف ومبيعات المندوبين"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>تعديل يدوي</span>
                </button>

                {specificProductTargets.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearSpecificProductData}
                    className="flex items-center gap-1 px-2.5 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                    title="مسح وتفريغ كافة بيانات ملف الإكسل المرفوع للصنف المحدد"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>مسح بيانات الملف</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Upload Message Banner */}
        {specificProductUploadMessage && (
          <div
            className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between border ${
              specificProductUploadMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
            }`}
          >
            <span>{specificProductUploadMessage.text}</span>
            <button
              type="button"
              onClick={() => setSpecificProductUploadMessage(null)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Dynamic Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Card 1: Product Sales (in pieces) vs Target (in pieces) & Achievement % */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border transition-all duration-300 ${
              specificProductStats.salesPct >= 100
                ? 'bg-lime-400/20 dark:bg-lime-400/20 border-2 border-lime-400 shadow-[0_0_25px_rgba(163,230,53,0.35)] ring-2 ring-lime-400/40 text-lime-900 dark:text-[#39ff14]'
                : isDarkMode
                ? 'bg-slate-900/70 border-slate-800 text-white'
                : 'bg-white border-slate-200 shadow-sm text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    specificProductStats.salesPct >= 100
                      ? 'bg-lime-400/30 text-lime-700 dark:text-[#39ff14] shadow-[0_0_12px_rgba(163,230,53,0.5)]'
                      : 'bg-indigo-500/20 text-indigo-400'
                  }`}
                >
                  <Package className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h4 className={`font-black text-xs sm:text-base flex items-center gap-1.5 ${
                    specificProductStats.salesPct >= 100 ? 'text-lime-800 dark:text-[#39ff14]' : ''
                  }`}>
                    <span>مبيعات لحد الان</span>
                    {specificProductStats.salesPct >= 100 && (
                      <Crown className="w-5 h-5 fill-amber-400 text-amber-400 drop-shadow-md animate-bounce inline shrink-0" />
                    )}
                  </h4>
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    المنتج المحدد: {specificProductStats.productName || specificProductName}
                  </span>
                </div>
              </div>

              <div
                className={`px-3 py-1.5 rounded-xl font-mono font-black text-base sm:text-lg flex items-center gap-1.5 shadow-sm ${
                  specificProductStats.salesPct >= 100
                    ? 'bg-lime-400/30 text-lime-900 dark:text-[#39ff14] border-2 border-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.4)]'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {specificProductStats.salesPct >= 100 && (
                  <Crown className="w-4 h-4 fill-amber-400 text-amber-400 inline" />
                )}
                <span>{specificProductStats.salesPct.toFixed(0)}%</span>
                {specificProductStats.salesPct >= 100 && (
                  <span className="text-xs">🏆</span>
                )}
              </div>
            </div>

            <div className="w-full bg-slate-200 dark:bg-slate-800 h-3 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  specificProductStats.salesPct >= 100
                    ? 'bg-gradient-to-r from-lime-400 via-lime-300 to-[#39ff14] shadow-[0_0_15px_rgba(57,255,20,0.9)]'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600'
                }`}
                style={{ width: `${Math.min(specificProductStats.salesPct, 100)}%` }}
              />
            </div>

            {specificProductStats.salesPct >= 100 && (
              <div className="mb-3 p-2 rounded-xl bg-lime-400/30 border border-lime-500 flex items-center justify-between text-xs font-black text-lime-900 dark:text-[#39ff14]">
                <span className="flex items-center gap-1.5">
                  <Crown className="w-4 h-4 fill-amber-400 text-amber-400" />
                  تم الوصول إلى 100% من الهدف الشهري وتجاوزه بنجاح! 👑
                </span>
                <span className="font-mono text-sm font-black">
                  +{formatWithCommas(Math.max(0, specificProductStats.salesPieces - specificProductStats.targetPieces))} قطعة فائض
                </span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-200/60 dark:border-slate-800/80">
              <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold mb-0.5">مبيعات الصنف (قطعة)</div>
                <div className={`font-mono font-black text-xs sm:text-base ${
                  specificProductStats.salesPct >= 100 ? 'text-lime-700 dark:text-[#39ff14]' : 'text-indigo-600 dark:text-indigo-400'
                }`}>
                  {formatWithCommas(specificProductStats.salesPieces)}
                  <span className="text-[10px] text-slate-400 mr-1">قطعة</span>
                </div>
                {specificProductStats.salesCartons > 0 && (
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    ≈ {formatWithCommas(specificProductStats.salesCartons)} كارتون
                  </div>
                )}
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold mb-0.5">تاركت الصنف (قطعة)</div>
                <div className="font-mono font-black text-xs sm:text-base text-slate-700 dark:text-slate-300">
                  {formatWithCommas(specificProductStats.targetPieces)}
                  <span className="text-[10px] text-slate-400 mr-1">قطعة</span>
                </div>
                {specificProductStats.targetCartons > 0 && (
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    ≈ {formatWithCommas(specificProductStats.targetCartons)} كارتون
                  </div>
                )}
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold mb-0.5">
                  {specificProductStats.salesPieces >= specificProductStats.targetPieces && specificProductStats.targetPieces > 0
                    ? 'الفائض عن التاركت'
                    : 'المتبقي للتاركت'}
                </div>
                <div
                  className={`font-mono font-black text-xs sm:text-base ${
                    specificProductStats.salesPieces >= specificProductStats.targetPieces && specificProductStats.targetPieces > 0
                      ? 'text-lime-700 dark:text-[#39ff14]'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {specificProductStats.salesPieces >= specificProductStats.targetPieces && specificProductStats.targetPieces > 0
                    ? `+${formatWithCommas(specificProductStats.salesPieces - specificProductStats.targetPieces)}`
                    : formatWithCommas(Math.max(0, specificProductStats.targetPieces - specificProductStats.salesPieces))}
                  <span className="text-[10px] text-slate-400 mr-1">قطعة</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Number of Shops Sold To vs Target Shops & Achievement % */}
          <div
            className={`p-4 rounded-2xl border transition-all ${
              specificProductStats.shopsPct >= 100
                ? 'bg-lime-400/10 dark:bg-lime-400/15 border-lime-500/50 shadow-[0_0_15px_rgba(132,204,22,0.15)] ring-1 ring-lime-500/30'
                : isDarkMode
                ? 'bg-slate-900/70 border-slate-800'
                : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    specificProductStats.shopsPct >= 100
                      ? 'bg-lime-500/20 text-lime-600 dark:text-[#39ff14]'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}
                >
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <span>تغطية عدد المحلات (الانتشار)</span>
                    {specificProductStats.shopsPct >= 100 && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-[#39ff14] inline" />
                    )}
                  </h4>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold block">
                    بيع هذه الكمية لهذه المحلات يتم حساب نصف كارتون للتغطية
                  </span>
                </div>
              </div>

              <div
                className={`px-3 py-1 rounded-xl font-mono font-black text-sm sm:text-base flex items-center gap-1 ${
                  specificProductStats.shopsPct >= 100
                    ? 'bg-lime-400/25 text-lime-700 dark:text-[#39ff14] border border-lime-500/40'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>{specificProductStats.shopsPct.toFixed(0)}%</span>
              </div>
            </div>

            <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  specificProductStats.shopsPct >= 100
                    ? 'bg-gradient-to-r from-lime-500 to-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.6)]'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500'
                }`}
                style={{ width: `${Math.min(specificProductStats.shopsPct, 100)}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-100 dark:border-slate-800/80">
              <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold mb-0.5">تم بيع لعدد محلات</div>
                <div className="font-mono font-black text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">
                  {specificProductStats.actualShops}
                  <span className="text-[9px] text-slate-400 mr-1">محل</span>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold mb-0.5">تاركت تغطية المحلات</div>
                <div className="font-mono font-black text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                  {specificProductStats.targetShops}
                  <span className="text-[9px] text-slate-400 mr-1">محل مطلوب</span>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold mb-0.5">
                  {specificProductStats.actualShops >= specificProductStats.targetShops && specificProductStats.targetShops > 0
                    ? 'تغطية مكتملة'
                    : 'متبقي للتغطية'}
                </div>
                <div
                  className={`font-mono font-black text-xs sm:text-sm ${
                    specificProductStats.actualShops >= specificProductStats.targetShops && specificProductStats.targetShops > 0
                      ? 'text-lime-600 dark:text-[#39ff14]'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {specificProductStats.actualShops >= specificProductStats.targetShops && specificProductStats.targetShops > 0
                    ? `+${specificProductStats.actualShops - specificProductStats.targetShops}`
                    : Math.max(0, specificProductStats.targetShops - specificProductStats.actualShops)}
                  <span className="text-[9px] text-slate-400 mr-1">محل</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Admin Aggregation: Breakdown Table */}
        {isAdmin && !isRafatJamal && specificProductStats.isAggregated && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setShowAdminSpecificBreakdown(!showAdminSpecificBreakdown)}
                className="flex items-center gap-1.5 text-xs font-black text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                {showAdminSpecificBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span>
                  {showAdminSpecificBreakdown ? 'إخفاء' : 'عرض'} مبيعات منتج محدد ({specificProductStats.productName || specificProductName}) ({specificProductStats.delegateBreakdown.length})
                </span>
              </button>
            </div>

            {showAdminSpecificBreakdown && (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-inner">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black text-[11px] border-b border-slate-200 dark:border-slate-700">
                      <th className="p-2.5">المندوب</th>
                      <th className="p-2.5 text-center">مبيعات (قطعة)</th>
                      <th className="p-2.5 text-center">تاركت (قطعة)</th>
                      <th className="p-2.5 text-center">نسبة الإنجاز %</th>
                      <th className="p-2.5 text-center">مبيعات (كارتون)</th>
                      <th className="p-2.5 text-center">تم بيع لمحلات</th>
                      <th className="p-2.5 text-center">تاركت المحلات</th>
                      <th className="p-2.5 text-center">نسبة المحلات</th>
                      <th className="p-2.5 text-center">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {specificProductStats.delegateBreakdown.map((del, idx) => {
                      const isSalesAchieved = del.salesPct >= 100;
                      const isShopsAchieved = del.shopsPct >= 100;
                      const isTopSeller = idx === 0 && del.salesPieces > 0;
                      return (
                        <tr
                          key={del.delegateName}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                            isTopSeller
                              ? 'bg-amber-500/10 dark:bg-amber-500/10 font-black ring-1 ring-amber-500/30'
                              : isSalesAchieved
                              ? 'bg-lime-400/20 text-lime-900 dark:text-[#39ff14] font-black'
                              : ''
                          }`}
                        >
                          <td className="p-2.5 font-extrabold flex items-center gap-1.5 flex-wrap">
                            {isTopSeller && (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-500/25 text-amber-700 dark:text-amber-300 text-[10px] font-black border border-amber-500/40 inline-flex items-center gap-0.5 shadow-sm">
                                <span>🥇</span>
                                <span>الأعلى مبيعاً</span>
                              </span>
                            )}
                            <span>{del.delegateName}</span>
                            {isSalesAchieved && (
                              <Crown className="w-4 h-4 fill-amber-400 text-amber-400 inline" />
                            )}
                          </td>
                          <td className={`p-2.5 text-center font-mono font-black ${
                            isTopSeller
                              ? 'text-amber-600 dark:text-amber-400 font-black'
                              : isSalesAchieved
                              ? 'text-lime-700 dark:text-[#39ff14]'
                              : 'text-indigo-600 dark:text-indigo-400'
                          }`}>
                            {formatWithCommas(del.salesPieces)}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                            {formatWithCommas(del.targetPieces)}
                          </td>
                          <td className="p-2.5 text-center font-mono font-black">
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[11px] inline-flex items-center gap-1 ${
                                isSalesAchieved
                                  ? 'bg-lime-400/30 text-lime-900 dark:text-[#39ff14] border border-lime-500'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {isSalesAchieved && (
                                <Crown className="w-3 h-3 fill-amber-400 text-amber-400 inline" />
                              )}
                              {del.salesPct.toFixed(0)}%
                            </span>
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-slate-500 dark:text-slate-400">
                            {formatWithCommas(del.salesCartons)}
                          </td>
                          <td className="p-2.5 text-center font-mono font-black text-emerald-600 dark:text-emerald-400">
                            {del.actualShops}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                            {del.targetShops}
                          </td>
                          <td className="p-2.5 text-center font-mono font-black">
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[11px] ${
                                isShopsAchieved
                                  ? 'bg-lime-400/20 text-lime-700 dark:text-[#39ff14] border border-lime-500/30'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {del.shopsPct.toFixed(0)}%
                            </span>
                          </td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => openEditSpecificProduct(del.delegateName)}
                              className="p-1 rounded-lg bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 transition-all cursor-pointer"
                              title="تعديل أهداف ومبيعات هذا المندوب"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {!isRafatJamal && (
        <div className={`p-4 sm:p-5 rounded-2xl border-2 shadow-xl ${
          isDarkMode ? 'bg-slate-900 border-amber-500/30 text-white' : 'bg-white border-amber-200 text-slate-900'
        }`}>
          {(!isAdmin) ? (
            /* Delegate View */
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3.5">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-emerald-500 text-slate-950 flex items-center justify-center font-black shadow-md shrink-0">
                  <Award className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-sm sm:text-base">
                      الحوافز الكلية لحد الان ({currentUser?.name})
                    </h4>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                    إجمالي مبالغ الحوافز والعمولات المكتسبة للشهر الحالي بناءً على الأداء والمبيعات المعتمدة
                  </p>
                </div>
              </div>

              <div className="w-full sm:w-auto bg-white dark:bg-slate-900 px-5 py-2.5 rounded-2xl border-2 border-emerald-500/50 shadow-sm flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <span className="text-xs text-slate-400 font-bold">مبلغ الحوافز:</span>
                <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
                  {formatWithCommas(
                    delegateIncentives.find(
                      (inc) =>
                        normalizeArabic(inc.delegateName || '') === normalizeArabic(currentUser?.name || '') ||
                        inc.delegateName?.trim().toLowerCase() === currentUser?.name?.trim().toLowerCase()
                    )?.incentivesAmount || 0,
                    true
                  )}
                  <span className="text-xs font-bold text-slate-500 mr-1.5">د.ع</span>
                </span>
              </div>
            </div>
          ) : (
            /* Admin View */
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-sm sm:text-base text-slate-800 dark:text-white flex items-center gap-1.5">
                      <Award className="w-5 h-5 text-amber-500" />
                      إدارة حوافز المندوبين الكلية لحد الآن
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                      لوحة تحكم الإدارة
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                    تظهر الحوافز لكل مندوب على حدة في حسابه الخاص. يتم تحديث مبالغ الحوافز من خلال رفع ملف الإكسل.
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                  {/* Excel upload button removed per user request */}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80">
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center justify-between">
                  <span>أسماء المندوبين والحوافز المسجلة لكل مندوب لحد الآن:</span>
                  <span className="text-[10px] text-slate-400">تظهر هذه المبالغ في حساب كل مندوب على حدة</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {delegateNamesList.map((del) => {
                    const incVal = delegateIncentives.find(
                      (inc) =>
                        normalizeArabic(inc.delegateName || '') === normalizeArabic(del) ||
                        inc.delegateName?.trim().toLowerCase() === del.trim().toLowerCase()
                    )?.incentivesAmount || 0;
                    const isSelected = activeDelegate === del;
                    return (
                      <div
                        key={del}
                        className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                          isSelected
                            ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/10'
                            : isDarkMode
                            ? 'bg-slate-900/60 border-slate-800 text-slate-200'
                            : 'bg-white border-slate-200 text-slate-800 shadow-sm'
                        }`}
                      >
                        <span className="font-extrabold truncate">{del}</span>
                        <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                          {formatWithCommas(incVal, true)} <span className="text-[9px] text-slate-400">د.ع</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={monthlyExcelInputRef}
        accept=".xlsx, .xls, .csv"
        onChange={handleExcelUpload}
        className="hidden"
      />

      {/* Modal 1: Edit Extra Targets Modal */}
      {showEditExtraTargetsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowEditExtraTargetsModal(false)}
        >
          <div
            className={`p-6 rounded-3xl shadow-2xl w-full max-w-lg border text-right space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <h3 className="font-black text-base text-emerald-400 flex items-center gap-2">
                <Pencil className="w-5 h-5" />
                تعديل الأهداف التراكمية الشهرية للمندوب
              </h3>
              <button
                onClick={() => setShowEditExtraTargetsModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-slate-400">المندوب:</label>
                <select
                  value={editExtraTargetDelegate}
                  onChange={(e) => {
                    const del = e.target.value;
                    setEditExtraTargetDelegate(del);
                    const existing = extraTargetsList.find((t) => t.delegateName === del);
                    setEditMonthlyIqdTarget(existing ? String(existing.monthlyIqdTarget || '') : '');
                    setEditTargetShopsCount(existing ? String(existing.targetShopsCount || '') : '');
                    setEditExtraProductName(existing?.extraProductName || 'جبن مسدمر مثلث 90 غم');
                    setEditExtraProductCustomersTarget(existing ? String(existing.extraProductCustomersTarget || '') : '');
                  }}
                  className={`w-full p-2.5 rounded-xl border font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {delegateNamesList.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">تاركت ديناري شهري (د.ع):</label>
                <input
                  type="text"
                  value={editMonthlyIqdTarget}
                  onChange={(e) => setEditMonthlyIqdTarget(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 50,000,000"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">مطلوب تبيع لعدد محلات (محل):</label>
                <input
                  type="text"
                  value={editTargetShopsCount}
                  onChange={(e) => setEditTargetShopsCount(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 150"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">اسم المنتج التأكيدي:</label>
                <input
                  type="text"
                  value={editExtraProductName}
                  onChange={(e) => setEditExtraProductName(e.target.value)}
                  placeholder="مثال: جبن مسدمر مثلث 90 غم"
                  className={`w-full p-2.5 rounded-xl border font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">تاركت زبائن شهري للمنتج التأكيدي (زبون):</label>
                <input
                  type="text"
                  value={editExtraProductCustomersTarget}
                  onChange={(e) => setEditExtraProductCustomersTarget(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 80"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-700">
              <button
                type="button"
                onClick={() => setShowEditExtraTargetsModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveExtraTargets}
                disabled={isSavingExtraTargets}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black shadow cursor-pointer disabled:opacity-50"
              >
                {isSavingExtraTargets ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Edit Specific Product Target Modal */}
      {showEditSpecificProductModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowEditSpecificProductModal(false)}
        >
          <div
            className={`p-6 rounded-3xl shadow-2xl w-full max-w-lg border text-right space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <h3 className="font-black text-base text-indigo-400 flex items-center gap-2">
                <Pencil className="w-5 h-5" />
                تعديل أهداف ومبيعات المنتج المخصص ({specificProductName})
              </h3>
              <button
                onClick={() => setShowEditSpecificProductModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-slate-400">المندوب:</label>
                <select
                  value={editSpecificProductDelegate}
                  onChange={(e) => openEditSpecificProduct(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {delegateNamesList.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-slate-400">تاركت الصنف (قطعة):</label>
                  <input
                    type="text"
                    value={editSpecificTargetPieces}
                    onChange={(e) => setEditSpecificTargetPieces(parseArabicDigits(e.target.value))}
                    placeholder="مثال: 500"
                    className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1 text-slate-400">مبيعات الصنف (قطعة):</label>
                  <input
                    type="text"
                    value={editSpecificSalesPieces}
                    onChange={(e) => setEditSpecificSalesPieces(parseArabicDigits(e.target.value))}
                    placeholder="مثال: 320"
                    className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-slate-400">مطلوب تبيع لعدد محلات:</label>
                  <input
                    type="text"
                    value={editSpecificTargetShops}
                    onChange={(e) => setEditSpecificTargetShops(parseArabicDigits(e.target.value))}
                    placeholder="مثال: 50"
                    className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1 text-slate-400">تم بيع لعدد محلات:</label>
                  <input
                    type="text"
                    value={editSpecificActualShops}
                    onChange={(e) => setEditSpecificActualShops(parseArabicDigits(e.target.value))}
                    placeholder="مثال: 35"
                    className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-700">
              <button
                type="button"
                onClick={() => setShowEditSpecificProductModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveSpecificProductModal}
                disabled={isSavingSpecificProductModal}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black shadow cursor-pointer disabled:opacity-50"
              >
                {isSavingSpecificProductModal ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
};


// Sub-component: Presentation of a Delegate's Table
interface DelegateTableViewProps {
  table: {
    delegateName: string;
    isSupervisor?: boolean;
    rows: Array<{
      categoryName: string;
      monthlyTarget: number;
      monthlySales: number;
      remainingMonthly: number;
      dailyTarget: number;
      dailySales: number;
      dailyPct: number;
      monthlyPct: number;
    }>;
    totals: {
      totalMonthlyTarget: number;
      totalMonthlySales: number;
      totalRemainingMonthly: number;
      totalDailyTarget: number;
      totalDailySales: number;
      totalDailyPct: number;
      totalMonthlyPct: number;
    };
  };
  isDarkMode: boolean;
  isAdmin: boolean;
  remainingDays: number;
  renderPercentBadge: (pct: number) => React.ReactNode;
  onStartEdit: (delegateName: string, categoryName: string, field: 'monthlyTarget' | 'monthlySales', currentVal: number) => void;
  defaultLayoutMode?: 'cards' | 'table';
  supervisorTable?: {
    delegateName: string;
    isSupervisor?: boolean;
    rows: Array<{
      categoryName: string;
      monthlyTarget: number;
      monthlySales: number;
      remainingMonthly: number;
      dailyTarget: number;
      dailySales: number;
      dailyPct: number;
      monthlyPct: number;
    }>;
    totals: {
      totalMonthlyTarget: number;
      totalMonthlySales: number;
      totalRemainingMonthly: number;
      totalDailyTarget: number;
      totalDailySales: number;
      totalDailyPct: number;
      totalMonthlyPct: number;
    };
  };
  isRafatJamal?: boolean;
}

const DelegateTableView: React.FC<DelegateTableViewProps> = ({
  table,
  isDarkMode,
  isAdmin,
  remainingDays,
  renderPercentBadge,
  onStartEdit,
  defaultLayoutMode,
  supervisorTable,
  isRafatJamal
}) => {
  const [layoutMode, setLayoutMode] = useState<'cards' | 'table'>(() => {
    if (defaultLayoutMode) return defaultLayoutMode;
    return isAdmin ? 'table' : 'cards';
  });
  const [sortOption, setSortOption] = useState<'default' | 'categories' | 'monthlyDesc' | 'salesDesc' | 'pctAsc' | 'alphabetical'>('default');

  const isDailyTargetAchieved = table.totals.totalDailyTarget <= 0 || table.totals.totalDailySales >= table.totals.totalDailyTarget;
  const remainingDailyTarget = Math.max(0, table.totals.totalDailyTarget - table.totals.totalDailySales);

  // Find the category with highest monthly achievement (المنتج الأعلى تحقيقاً)
  const highestMonthlyCategory = useMemo(() => {
    let bestName: string | null = null;
    let bestPct = -1;
    let bestSales = -1;
    for (const r of table.rows) {
      if (r.monthlyPct > 0 || r.monthlySales > 0) {
        if (r.monthlyPct > bestPct || (r.monthlyPct === bestPct && r.monthlySales > bestSales)) {
          bestName = r.categoryName;
          bestPct = r.monthlyPct;
          bestSales = r.monthlySales;
        }
      }
    }
    return bestName;
  }, [table.rows]);

  // Find the supervisor category with highest monthly achievement
  const highestSupervisorMonthlyCategory = useMemo(() => {
    if (!supervisorTable?.rows) return null;
    let bestName: string | null = null;
    let bestPct = -1;
    let bestSales = -1;
    for (const r of supervisorTable.rows) {
      if (r.monthlyPct > 0 || r.monthlySales > 0) {
        if (r.monthlyPct > bestPct || (r.monthlyPct === bestPct && r.monthlySales > bestSales)) {
          bestName = r.categoryName;
          bestPct = r.monthlyPct;
          bestSales = r.monthlySales;
        }
      }
    }
    return bestName;
  }, [supervisorTable?.rows]);

  // Sorted rows based on selected option:
  // DEFAULT: Sort from lowest to highest monthly ranking (من الأقل إلى الأعلى تصنيفاً شهرياً)
  const sortedRows = useMemo(() => {
    const rowsCopy = [...table.rows];
    if (sortOption === 'categories') {
      return rowsCopy;
    }
    if (sortOption === 'default') {
      return rowsCopy.sort((a, b) => {
        if (a.monthlyPct !== b.monthlyPct) return a.monthlyPct - b.monthlyPct;
        return a.monthlySales - b.monthlySales;
      });
    }
    if (sortOption === 'monthlyDesc') {
      return rowsCopy.sort((a, b) => b.monthlyPct - a.monthlyPct);
    }
    if (sortOption === 'alphabetical') {
      return rowsCopy.sort((a, b) =>
        getCategoryDisplayName(a.categoryName).localeCompare(getCategoryDisplayName(b.categoryName), 'ar')
      );
    }
    if (sortOption === 'salesDesc') {
      return rowsCopy.sort((a, b) => b.dailySales - a.dailySales);
    }
    if (sortOption === 'pctAsc') {
      return rowsCopy.sort((a, b) => a.dailyPct - b.dailyPct);
    }
    return rowsCopy;
  }, [table.rows, sortOption]);

  // Sorted supervisor rows based on selected option:
  // DEFAULT: Sort from lowest to highest monthly ranking (من الأقل إلى الأعلى تصنيفاً شهرياً)
  const sortedSupervisorRows = useMemo(() => {
    if (!supervisorTable) return [];
    const rowsCopy = [...supervisorTable.rows];
    if (sortOption === 'categories') {
      return rowsCopy;
    }
    if (sortOption === 'default') {
      return rowsCopy.sort((a, b) => {
        if (a.monthlyPct !== b.monthlyPct) return a.monthlyPct - b.monthlyPct;
        return a.monthlySales - b.monthlySales;
      });
    }
    if (sortOption === 'monthlyDesc') {
      return rowsCopy.sort((a, b) => b.monthlyPct - a.monthlyPct);
    }
    if (sortOption === 'alphabetical') {
      return rowsCopy.sort((a, b) =>
        getCategoryDisplayName(a.categoryName).localeCompare(getCategoryDisplayName(b.categoryName), 'ar')
      );
    }
    if (sortOption === 'salesDesc') {
      return rowsCopy.sort((a, b) => b.dailySales - a.dailySales);
    }
    if (sortOption === 'pctAsc') {
      return rowsCopy.sort((a, b) => a.dailyPct - b.dailyPct);
    }
    return rowsCopy;
  }, [supervisorTable, sortOption]);

  return (
    <div className={`overflow-hidden rounded-2xl border shadow-xl transition-all duration-500 ${
      isDarkMode ? 'bg-gradient-to-br from-[#0a1b4b] via-[#08153a] to-[#050c26] border-[#1e293b]' : 'bg-white border-slate-300'
    }`}>
      {/* Daily target alert bar for this delegate */}
      {table.totals.totalDailyTarget > 0 && (
        !isDailyTargetAchieved ? (
          <div className={`px-4 py-2 border-b flex items-center justify-between text-xs font-black flex-wrap gap-2 ${
            isDarkMode ? 'bg-red-950/40 border-red-900/60 text-red-300' : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
              <span>تنبيه للمندوب ({table.delegateName}): لم يتم تحقيق التاركت اليومي حتى الآن</span>
            </div>
            <span className="font-bold">المتبقي لليوم: {formatWithCommas(Math.round(remainingDailyTarget))} كغم</span>
          </div>
        ) : (
          <div className={`px-4 py-2 border-b flex items-center justify-between text-xs font-black flex-wrap gap-2 ${
            isDarkMode ? 'bg-emerald-950/40 border-emerald-900/60 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>تم تحقيق التاركت اليومي للمندوب ({table.delegateName}) بنجاح 🎯</span>
            </div>
            <span className="font-bold">نسبة اليوم: {table.totals.totalDailyPct.toFixed(0)}%</span>
          </div>
        )
      )}

      {/* View & Sort Toolbar */}
      <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-3 flex-wrap text-xs ${
        isDarkMode ? 'bg-slate-950/80 border-slate-800 text-slate-300' : 'bg-slate-100/90 border-slate-200 text-slate-700'
      }`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-black text-[11px] flex items-center gap-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
            <span>طريقة العرض:</span>
          </span>
          <div className={`inline-flex rounded-xl p-0.5 border bg-slate-200/50 ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-slate-300 bg-slate-200/50'}`}>
            <button
              onClick={() => setLayoutMode('table')}
              className={`px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                layoutMode === 'table'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>الجدول الكلاسيكي</span>
            </button>
            <button
              onClick={() => setLayoutMode('cards')}
              className={`px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                layoutMode === 'cards'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span>تصميم القوائم</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-0">
          <span className={`font-bold text-[10px] sm:text-[11px] flex items-center gap-1 shrink-0 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden xs:inline">الترتيب:</span>
          </span>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as any)}
            className={`flex-1 sm:flex-initial px-2 py-1 rounded-xl text-[10px] sm:text-[11px] font-bold border cursor-pointer min-w-0 truncate max-w-[120px] xs:max-w-[140px] sm:max-w-none ${
              isDarkMode
                ? 'bg-[#050c26] border-slate-700 text-slate-200 focus:border-emerald-500'
                : 'bg-white border-slate-300 text-slate-800 focus:border-emerald-600'
            }`}
          >
            <option value="default">شهري (من الأقل)</option>
            <option value="categories">الترتيب القياسي للأصناف (15 صنف)</option>
            <option value="monthlyDesc">شهري (من الأعلى)</option>
            <option value="salesDesc">الأعلى مبيعات</option>
            <option value="pctAsc">الأقل إنجازاً</option>
            <option value="alphabetical">أبجدي (أ - ي)</option>
          </select>
        </div>
      </div>

      {layoutMode === 'cards' ? (
        /* CARD-BASED ARRANGEMENT (Matching image_6418cabd.png exactly) */
        <div className="space-y-3">
          {sortedRows.map((row) => {
            const hasSalesToday = row.dailySales > 0;
            const isAchieved = row.monthlyTarget > 0 && row.monthlySales >= row.monthlyTarget;
            const isMonthlyOver120 = row.monthlyTarget > 0 && row.monthlyPct >= 120;
            const isDailyOver120 = row.dailyPct >= 120 || (row.dailyTarget > 0 && row.dailySales >= row.dailyTarget && row.dailyPct >= 100);

            return (
              <div
                key={row.categoryName}
                className={`rounded-2xl border transition-all duration-300 shadow-sm overflow-hidden ${
                  isMonthlyOver120
                    ? isDarkMode
                      ? 'bg-[#0b3313] border-2 border-emerald-500 shadow-emerald-950/50 text-emerald-100'
                      : 'bg-emerald-200/95 border-2 border-emerald-700 shadow-emerald-200 text-emerald-950 font-black'
                    : isAchieved
                    ? isDarkMode
                      ? 'bg-[#152e18] border-lime-500/80 shadow-lime-950/20 text-white'
                      : 'bg-[#e2fb8d] border-lime-500 shadow-lime-100 text-slate-900'
                    : isDarkMode
                    ? 'bg-[#08153a] border-slate-800 text-slate-100'
                    : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                {/* Top Section: Category & Daily Stats */}
                <div className={`p-2.5 sm:p-4 grid grid-cols-12 items-center gap-1.5 sm:gap-2 transition-colors ${
                  !isAchieved && isDailyOver120
                    ? isDarkMode
                      ? 'bg-emerald-950/70 text-emerald-100'
                      : 'bg-emerald-100/80 text-emerald-950'
                    : ''
                }`}>
                  {/* Far Right (RTL Child 1): Category Title & Trophy Badge */}
                  <div className="col-span-4 sm:col-span-4 text-right flex items-center justify-start gap-1.5 sm:gap-2 flex-wrap min-w-0">
                    <h3 className={`font-black text-sm sm:text-lg tracking-tight truncate ${
                      isAchieved
                        ? isDarkMode ? 'text-lime-300' : 'text-slate-950'
                        : isDarkMode ? 'text-white' : 'text-slate-900'
                    }`}>
                      {getCategoryDisplayName(row.categoryName)}
                    </h3>
                    {isAchieved && (
                      <div className="flex items-center gap-1 bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full text-[9px] sm:text-xs font-black shadow-xs shrink-0">
                        <Crown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-950" />
                        <span>100% 🏆</span>
                      </div>
                    )}
                  </div>

                  {/* Center Right (RTL Child 2): Daily Sales Value */}
                  <div className="col-span-2 sm:col-span-2 text-center flex flex-col items-center justify-center min-w-0">
                    <span className={`font-black text-xs sm:text-base ${
                      hasSalesToday
                        ? isDarkMode ? 'text-emerald-400' : 'text-emerald-700'
                        : isDarkMode ? 'text-slate-200' : 'text-slate-800'
                    }`}>
                      {formatWithCommas(Math.round(row.dailySales))}
                    </span>
                    <span className="text-[9px] text-slate-400 font-bold sm:hidden">(مبيعات)</span>
                  </div>

                  {/* Center Left (RTL Child 3): Daily Target Value & Subtitle */}
                  <div className="col-span-3 sm:col-span-2 text-center flex flex-col items-center justify-center leading-tight min-w-0">
                    <span className={`font-black text-xs sm:text-base ${
                      isDarkMode ? 'text-slate-200' : 'text-slate-800'
                    }`}>
                      {formatWithCommas(Math.round(row.dailyTarget))}
                    </span>
                    <span className={`text-[9px] sm:text-[10px] font-bold mt-0.5 ${
                      isAchieved
                        ? isDarkMode ? 'text-lime-300/80' : 'text-slate-700'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      <span className="sm:hidden">(هدف يومي)</span>
                      <span className="hidden sm:inline whitespace-nowrap">(هدف يومي لنهاية الشهر)</span>
                    </span>
                  </div>

                  {/* Far Left (RTL Child 4): Daily Percentage & Progress Bar */}
                  <div className="col-span-3 sm:col-span-4 flex flex-col items-end justify-center gap-0.5 sm:gap-1 min-w-0">
                    <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-end">
                      {row.dailyPct >= 100 && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-black text-[10px] sm:text-sm flex items-center gap-0.5">
                          <span>مكتمل</span>
                          <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600" />
                        </span>
                      )}
                      <span className={`font-black text-xs sm:text-base ${
                        row.dailyPct < 75
                          ? 'text-red-600 dark:text-red-400'
                          : row.dailyPct >= 100
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}>
                        {Math.round(row.dailyPct)}%
                      </span>
                    </div>
                    <div className="w-full max-w-[90px] sm:max-w-[160px] h-1.5 sm:h-2 bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          row.dailyPct < 75
                            ? 'bg-red-500'
                            : isAchieved
                            ? 'bg-lime-600 dark:bg-lime-400'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, row.dailyPct))}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Dashed Separator Line */}
                <div className={`border-t border-dashed mx-3 sm:mx-4 ${
                  isAchieved
                    ? 'border-lime-400/80 dark:border-lime-500/40'
                    : 'border-slate-300 dark:border-slate-700/80'
                }`} />

                {/* Bottom Section: Monthly Stats */}
                <div className="p-2.5 sm:p-4 grid grid-cols-12 items-center gap-1.5 sm:gap-2 text-xs">
                  {/* Far Right (RTL Child 1): • الشهري: */}
                  <div className="col-span-3 sm:col-span-4 text-right flex items-center gap-1 font-black text-slate-700 dark:text-slate-300 text-xs sm:text-sm min-w-0">
                    <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${
                      isAchieved ? 'bg-lime-600 dark:bg-lime-400' : 'bg-emerald-500'
                    }`} />
                    <span>الشهري:</span>
                  </div>

                  {/* Center Right (RTL Child 2): Monthly Sales Value & Subtitle */}
                  <div className="col-span-3 sm:col-span-2 text-center flex flex-col items-center justify-center leading-tight min-w-0">
                    <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatWithCommas(Math.round(row.monthlySales))} كغم
                    </span>
                    <span className={`text-[9px] sm:text-[10px] font-bold mt-0.5 ${
                      isAchieved
                        ? isDarkMode ? 'text-lime-300/80' : 'text-slate-700'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      <span className="sm:hidden">(مبيعات)</span>
                      <span className="hidden sm:inline whitespace-nowrap">(مبيعات شهري)</span>
                    </span>
                  </div>

                  {/* Center Left (RTL Child 3): Monthly Target Value & Subtitle */}
                  <div className="col-span-3 sm:col-span-2 text-center flex flex-col items-center justify-center leading-tight min-w-0">
                    <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatWithCommas(Math.round(row.monthlyTarget))} كغم
                    </span>
                    <span className={`text-[9px] sm:text-[10px] font-bold mt-0.5 ${
                      isAchieved
                        ? isDarkMode ? 'text-lime-300/80' : 'text-slate-700'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      <span className="sm:hidden">(هدف)</span>
                      <span className="hidden sm:inline whitespace-nowrap">(هدف شهري)</span>
                    </span>
                  </div>

                  {/* Far Left (RTL Child 4): Monthly Percentage, Achievement Badge, Remaining & Progress Bar */}
                  <div className="col-span-3 sm:col-span-4 flex flex-col items-end justify-center gap-0.5 sm:gap-1 min-w-0">
                    <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-end">
                      {row.monthlyPct >= 100 && (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-600 text-white font-black text-[9px] sm:text-xs shadow-2xs flex items-center gap-1">
                          <span>تم تحقيق الهدف</span>
                          <Crown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-300" />
                        </span>
                      )}
                      <span className={`font-black text-xs sm:text-base ${
                        row.monthlyPct < 75
                          ? 'text-red-600 dark:text-red-400'
                          : row.monthlyPct >= 100
                          ? 'text-emerald-800 dark:text-emerald-300'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}>
                        {row.monthlyPct.toFixed(0)}%
                      </span>
                    </div>

                    {row.remainingMonthly > 0 && (
                      <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate max-w-full">
                        متبقي: {formatWithCommas(Math.round(row.remainingMonthly))}
                      </span>
                    )}

                    <div className="w-full max-w-[90px] sm:max-w-[160px] h-1.5 sm:h-2 bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          row.monthlyPct < 75
                            ? 'bg-red-400'
                            : isAchieved
                            ? 'bg-lime-600 dark:bg-lime-400'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, row.monthlyPct))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Grand Totals Block formatted identically */}
          <div className="h-3 bg-[#dce4ec] dark:bg-slate-800 border-t border-b border-[#cbd5e1] dark:border-slate-700 w-full" />
          <div className={`px-3 sm:px-8 py-3.5 sm:py-4 border-t-2 border-emerald-600 rounded-b-2xl ${
            isDarkMode ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'
          }`}>
            {/* Totals Daily Row */}
            <div className="grid grid-cols-12 items-center gap-1.5 sm:gap-2">
              {/* Far Right (Child 1 in RTL): Label */}
              <div className="col-span-4 sm:col-span-4 text-right flex items-center gap-1.5 min-w-0">
                <Target className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-black text-slate-900 dark:text-white text-xs sm:text-base leading-tight">
                  المجموع الكلي اليومي
                </span>
              </div>

              {/* Middle-Right (Child 2 in RTL): Total Daily Sales */}
              <div className="col-span-2 sm:col-span-2 text-center flex flex-col items-center justify-center min-w-0">
                <span className="font-black text-teal-700 dark:text-teal-400 text-xs sm:text-base whitespace-nowrap">
                  {formatWithCommas(Math.round(table.totals.totalDailySales))} كغم
                </span>
                <span className="text-[9px] text-slate-400 font-bold sm:hidden">(مبيعات)</span>
              </div>

              {/* Middle-Left (Child 3 in RTL): Total Daily Target */}
              <div className="col-span-3 sm:col-span-2 text-center flex flex-col items-center justify-center leading-tight min-w-0">
                <span className="font-black text-emerald-700 dark:text-emerald-400 text-xs sm:text-base whitespace-nowrap">
                  {formatWithCommas(Math.round(table.totals.totalDailyTarget))} كغم
                </span>
                <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold mt-0.5">
                  <span className="sm:hidden">(هدف يومي)</span>
                  <span className="hidden sm:inline whitespace-nowrap">(إجمالي الهدف اليومي)</span>
                </span>
              </div>

              {/* Far Left (Child 4 in RTL): Total Daily Percentage & Progress Bar */}
              <div className="col-span-3 sm:col-span-4 flex flex-col items-end justify-center gap-0.5 sm:gap-1 min-w-0">
                <div className="flex items-center gap-1 sm:gap-1.5 justify-end">
                  <span className={`text-xs sm:text-sm font-black ${
                    table.totals.totalDailyPct < 75
                      ? 'text-red-600 dark:text-red-400'
                      : table.totals.totalDailyPct > 120
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-900 dark:text-white'
                  }`}>
                    {Math.round(table.totals.totalDailyPct)}%
                  </span>
                  {!isDailyTargetAchieved && table.totals.totalDailyTarget > 0 && (
                    <span title="لم يتحقق التاركت اليومي الكلي">
                      <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
                    </span>
                  )}
                </div>
                <div className="w-full max-w-[90px] sm:max-w-[160px] h-1.5 sm:h-2.5 bg-[#dce4ec] dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      table.totals.totalDailyPct < 75
                        ? 'bg-red-500'
                        : table.totals.totalDailyPct > 120
                        ? 'bg-emerald-500'
                        : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, table.totals.totalDailyPct))}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-dashed border-slate-300 dark:border-slate-800 my-2" />

            {/* Totals Monthly Row */}
            <div className="grid grid-cols-12 items-center gap-1.5 sm:gap-2 text-xs">
              {/* Far Right (Child 1 in RTL): Monthly Label */}
              <div className="col-span-3 sm:col-span-4 text-right flex items-center gap-1 font-black text-slate-700 dark:text-slate-300 text-xs sm:text-sm min-w-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0" />
                <span>الشهري:</span>
              </div>

              {/* Middle-Right (Child 2 in RTL): Total Monthly Sales */}
              <div className="col-span-3 sm:col-span-2 text-center flex flex-col items-center justify-center leading-tight min-w-0">
                <span className="text-slate-800 dark:text-slate-200 font-bold text-xs sm:text-sm whitespace-nowrap">
                  {formatWithCommas(Math.round(table.totals.totalMonthlySales))} كغم
                </span>
                <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold mt-0.5">
                  <span className="sm:hidden">(مبيعات)</span>
                  <span className="hidden sm:inline whitespace-nowrap">(إجمالي مبيعات الشهر)</span>
                </span>
              </div>

              {/* Middle-Left (Child 3 in RTL): Total Monthly Target */}
              <div className="col-span-3 sm:col-span-2 text-center flex flex-col items-center justify-center leading-tight min-w-0">
                <span className="text-slate-800 dark:text-slate-200 font-bold text-xs sm:text-sm whitespace-nowrap">
                  {formatWithCommas(Math.round(table.totals.totalMonthlyTarget))} كغم
                </span>
                <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold mt-0.5">
                  <span className="sm:hidden">(هدف)</span>
                  <span className="hidden sm:inline whitespace-nowrap">(إجمالي الهدف الشهري)</span>
                </span>
              </div>

              {/* Far Left (Child 4 in RTL): Total Monthly Percentage & Progress Bar */}
              <div className="col-span-3 sm:col-span-4 flex flex-col items-end justify-center gap-0.5 sm:gap-1 min-w-0">
                <div className="flex items-center gap-1 sm:gap-1.5 justify-end">
                  <span className={`font-black text-xs sm:text-sm ${
                    table.totals.totalMonthlyPct < 75
                      ? 'text-red-600 dark:text-red-400'
                      : table.totals.totalMonthlyPct > 120
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}>
                    {table.totals.totalMonthlyPct.toFixed(0)}%
                  </span>
                </div>

                <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate max-w-full">
                  متبقي: {formatWithCommas(Math.round(table.totals.totalRemainingMonthly))}
                </span>

                <div className="w-full max-w-[90px] sm:max-w-[160px] h-1.5 sm:h-2 bg-[#dce4ec] dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      table.totals.totalMonthlyPct < 75
                        ? 'bg-red-400'
                        : table.totals.totalMonthlyPct > 120
                        ? 'bg-emerald-400'
                        : 'bg-slate-400'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, table.totals.totalMonthlyPct))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* CLASSIC FULL DATA TABLE (Available via switcher) */
        <div className="space-y-8 p-1 sm:p-2">
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <table className="w-full text-right border-collapse text-[10px]">
            <thead>
              {/* Super Header: Grouping Daily & Monthly Sections */}
              <tr className={`border-b text-[10px] font-black ${
                isDarkMode ? 'bg-slate-950 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}>
                <th rowSpan={2} className="p-1.5 text-center border-l border-slate-300 dark:border-slate-800 w-8">
                  ت
                </th>
                <th rowSpan={2} className="p-1.5 border-l border-slate-300 dark:border-slate-800 min-w-[120px]">
                  الصنف
                </th>
                <th colSpan={3} className="p-2 text-center border-l border-slate-300 dark:border-slate-800 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  القسم اليومي (اليوم)
                </th>
                <th colSpan={4} className="p-2 text-center bg-teal-500/10 text-teal-700 dark:text-teal-400">
                  القسم الشهري (تحميل إكسل)
                </th>
              </tr>
              {/* Sub-Header: Columns */}
              <tr className={`border-b text-[11px] font-black ${
                isDarkMode ? 'bg-slate-900/90 text-slate-300 border-slate-800' : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}>
                {/* Daily Section */}
                <th className="p-1 text-center border-l border-slate-300 dark:border-slate-800 w-[14%]">ت.ي</th>
                <th className="p-1 text-center border-l border-slate-300 dark:border-slate-800 w-[14%]">م.ي</th>
                <th className="p-1 text-center border-l border-slate-300 dark:border-slate-800 w-[12%]">ن.ي%</th>

                {/* Monthly Section */}
                <th className="p-1 text-center border-l border-slate-300 dark:border-slate-800 w-[15%]">ت.ش</th>
                <th className="p-1 text-center border-l border-slate-300 dark:border-slate-800 w-[15%]">م.ش</th>
                <th className="p-1 text-center border-l border-slate-300 dark:border-slate-800 w-[15%]">متبقي</th>
                <th className="p-1 text-center w-[15%]">ن.ش%</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {sortedRows.map((row, idx) => {
                const isEven = idx % 2 === 0;
                const hasSalesToday = row.dailySales > 0;
                const isHighestAchieved = row.monthlyTarget > 0 && row.monthlySales >= row.monthlyTarget;
                const isRowMonthlyOver120 = row.monthlyTarget > 0 && row.monthlyPct >= 120;
                const isRowDailyOver120 = row.dailyPct >= 120 || (row.dailyTarget > 0 && row.dailySales >= row.dailyTarget && row.dailyPct >= 100);

                return (
                  <tr
                    key={row.categoryName}
                    className={`transition-colors font-bold ${
                      isRowMonthlyOver120
                        ? isDarkMode
                          ? 'bg-[#0b3313] text-emerald-100 font-black ring-2 ring-emerald-500'
                          : 'bg-emerald-200/95 text-emerald-950 font-black ring-2 ring-emerald-700'
                        : isHighestAchieved
                        ? isDarkMode
                          ? 'bg-emerald-950/80 text-emerald-100 ring-1 ring-inset ring-emerald-500/50'
                          : 'bg-emerald-100/90 text-emerald-950 ring-1 ring-inset ring-emerald-500/50'
                        : isEven
                        ? isDarkMode ? 'bg-slate-900/40' : 'bg-white'
                        : isDarkMode ? 'bg-slate-900/80' : 'bg-slate-50/70'
                    }`}
                  >
                    {/* Index */}
                    <td className="p-1.5 text-center font-bold text-slate-400 border-l border-slate-200 dark:border-slate-800 text-[10px]">
                      {idx + 1}
                    </td>

                    <td className={`p-1.5 font-bold border-l ${
                      isDarkMode ? 'text-white border-slate-700' : 'text-slate-900 border-slate-200'
                    }`}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`text-[11px] ${
                          isHighestAchieved 
                            ? (isDarkMode ? 'text-emerald-300 font-black' : 'text-emerald-950 font-black')
                            : (isDarkMode ? 'text-white' : 'text-slate-900')
                        }`}>
                          <span className={isDarkMode ? 'text-white font-black' : ''}>
                            {getCategoryDisplayName(row.categoryName)}
                          </span>
                        </span>
                        {isHighestAchieved && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-600 text-white shrink-0 shadow-xs">
                            <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                            <span>تم التحقيق الشهري 🎯</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Daily Target */}
                    <td className={`p-1 text-center font-black border-l border-slate-200 dark:border-slate-800 text-[9px] ${
                      isRowDailyOver120
                        ? isDarkMode ? 'bg-emerald-950/90 text-emerald-200' : 'bg-emerald-100/90 text-emerald-950'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}>
                      {row.dailyTarget > 0 ? formatWithCommas(Math.round(row.dailyTarget)) : '0'}
                    </td>

                    {/* Daily Sales */}
                    <td className={`p-1 text-center font-black border-l border-slate-200 dark:border-slate-800 text-[9px] ${
                      isRowDailyOver120
                        ? isDarkMode ? 'bg-emerald-950/90 text-emerald-200' : 'bg-emerald-100/90 text-emerald-950'
                        : hasSalesToday ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                    }`}>
                      {hasSalesToday ? formatWithCommas(Math.round(row.dailySales)) : '0'}
                    </td>

                    {/* Daily % */}
                    <td className={`p-1 text-center border-l border-slate-200 dark:border-slate-800 ${
                      isRowDailyOver120
                        ? isDarkMode ? 'bg-emerald-950/90' : 'bg-emerald-100/90'
                        : ''
                    }`}>
                      <div className="flex justify-center scale-90">{renderPercentBadge(row.dailyPct)}</div>
                    </td>

                    {/* Monthly Target */}
                    <td className="p-1 text-center font-black text-slate-800 dark:text-slate-200 border-l border-slate-200 dark:border-slate-800 text-[9px]">
                      {row.monthlyTarget > 0 ? formatWithCommas(Math.round(row.monthlyTarget)) : '0'}
                    </td>

                    {/* Monthly Sales */}
                    <td className="p-1 text-center font-black text-slate-800 dark:text-slate-200 border-l border-slate-200 dark:border-slate-800 text-[9px]">
                      {row.monthlySales > 0 ? formatWithCommas(Math.round(row.monthlySales)) : '0'}
                    </td>

                    {/* Remaining Target */}
                    <td className="p-1 text-center font-black text-amber-700 dark:text-amber-400 border-l border-slate-200 dark:border-slate-800 text-[9px]">
                      {row.remainingMonthly > 0 ? formatWithCommas(Math.round(row.remainingMonthly)) : '0'}
                    </td>

                    {/* Monthly % */}
                    <td className="p-1 text-center">
                      <div className="flex justify-center scale-90">{renderPercentBadge(row.monthlyPct)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* TOTALS SUMMARY ROW */}
            <tfoot>
              <tr className={`border-t-2 font-black text-xs sm:text-[13px] ${
                isDarkMode
                  ? 'bg-gradient-to-r from-emerald-950 via-slate-950 to-slate-950 text-white border-emerald-600'
                  : 'bg-gradient-to-r from-emerald-100 via-slate-100 to-slate-200 text-slate-950 border-emerald-500'
              }`}>
                <td colSpan={2} className="p-3 text-center border-l border-slate-300 dark:border-slate-800 font-black">
                  <div className="flex items-center justify-center gap-2">
                    <Target className="w-4 h-4 text-emerald-500" />
                    <span>المجموع الكلي</span>
                  </div>
                </td>

                {/* Total Daily Target */}
                <td className="p-3 text-center border-l border-slate-300 dark:border-slate-800 text-emerald-700 dark:text-emerald-300 font-black">
                  {formatWithCommas(Math.round(table.totals.totalDailyTarget))} كغم
                </td>

                {/* Total Daily Sales */}
                <td className="p-3 text-center border-l border-slate-300 dark:border-slate-800 text-teal-700 dark:text-teal-300 font-black">
                  {formatWithCommas(Math.round(table.totals.totalDailySales))} كغم
                </td>

                {/* Total Daily % - Highlight red if <75%, green if >120% with warning if target missed */}
                <td className={`p-3 text-center border-l border-slate-300 dark:border-slate-800 transition-colors ${
                  table.totals.totalDailyPct < 75
                    ? isDarkMode ? 'bg-red-950/40' : 'bg-red-100/70'
                    : table.totals.totalDailyPct > 120
                    ? isDarkMode ? 'bg-emerald-950/40' : 'bg-emerald-100/70'
                    : ''
                }`}>
                  <div className="flex items-center justify-center gap-1.5">
                    {renderPercentBadge(table.totals.totalDailyPct)}
                    {!isDailyTargetAchieved && table.totals.totalDailyTarget > 0 && (
                      <span title="لم يحقق التاركت اليومي الكلي">
                        <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
                      </span>
                    )}
                  </div>
                </td>

                {/* Total Monthly Target */}
                <td className="p-3 text-center border-l border-slate-300 dark:border-slate-800 font-black">
                  {formatWithCommas(Math.round(table.totals.totalMonthlyTarget))} كغم
                </td>

                {/* Total Monthly Sales */}
                <td className="p-3 text-center border-l border-slate-300 dark:border-slate-800 font-black">
                  {formatWithCommas(Math.round(table.totals.totalMonthlySales))} كغم
                </td>

                {/* Total Remaining */}
                <td className="p-3 text-center border-l border-slate-300 dark:border-slate-800 text-amber-700 dark:text-amber-400 font-black">
                  {formatWithCommas(Math.round(table.totals.totalRemainingMonthly))} كغم
                </td>

                {/* Total Monthly % - Highlight red if <75%, green if >120% */}
                <td className={`p-3 text-center transition-colors ${
                  table.totals.totalMonthlyPct < 75
                    ? isDarkMode ? 'bg-red-950/40' : 'bg-red-100/70'
                    : table.totals.totalMonthlyPct > 120
                    ? isDarkMode ? 'bg-emerald-950/40' : 'bg-emerald-100/70'
                    : ''
                }`}>
                  {renderPercentBadge(table.totals.totalMonthlyPct)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Supervisor Table: Aggregates daily & monthly sales and targets across all delegates (Admin Only) */}
        {isAdmin && !isRafatJamal && supervisorTable && !table.isSupervisor && (
          <div className="pt-6 border-t-2 border-dashed border-indigo-400/50 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 px-1">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-emerald-600 text-white flex items-center justify-center font-black shadow-md shrink-0">
                  <ShieldCheck className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>جدول تاركت المشرف (إجمالي مبيعات وتاركت المندوبين)</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                      تاركت المشرف العام
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    يجمع مبيعات وتاركت اليومي والشهري لكافة المندوبين لكل صنف على حدة
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-black bg-indigo-50/80 dark:bg-indigo-950/50 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800">
                <span className="text-slate-600 dark:text-slate-300">نسبة إنجاز المشرف اليومية:</span>
                {renderPercentBadge(supervisorTable.totals.totalDailyPct)}
              </div>
            </div>

            {/* The supervisor classic table */}
            <div className="overflow-x-auto rounded-xl border-2 border-indigo-500/40 dark:border-indigo-800 shadow-md">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className={`border-b text-[11px] font-black ${
                    isDarkMode ? 'bg-[#0a1b4b] text-indigo-100 border-[#1e293b]' : 'bg-indigo-100/80 text-indigo-950 border-indigo-300'
                  }`}>
                    <th rowSpan={2} className="p-3 text-center border-l border-indigo-200 dark:border-indigo-900 min-w-[50px]">
                      ت
                    </th>
                    <th rowSpan={2} className="p-3 border-l border-indigo-200 dark:border-indigo-900 min-w-[170px]">
                      الصنف (15 صنف - تاركت المشرف)
                    </th>
                    <th colSpan={3} className="p-2 text-center border-l border-indigo-200 dark:border-indigo-900 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                      القسم اليومي (إجمالي مبيعات وتاركت المندوبين)
                    </th>
                    <th colSpan={4} className="p-2 text-center bg-teal-500/15 text-teal-800 dark:text-teal-300">
                      القسم الشهري (إجمالي مبيعات وتاركت المندوبين)
                    </th>
                  </tr>
                  <tr className={`border-b text-[11px] font-black ${
                    isDarkMode ? 'bg-[#08153a]/80 text-slate-300 border-[#1e293b]' : 'bg-indigo-50 text-slate-700 border-indigo-200'
                  }`}>
                    <th className="p-2.5 text-center border-l border-indigo-200 dark:border-indigo-900 min-w-[100px]">
                      التاركت اليومي
                    </th>
                    <th className="p-2.5 text-center border-l border-indigo-200 dark:border-indigo-900 min-w-[100px]">
                      مبيعات اليوم
                    </th>
                    <th className="p-2.5 text-center border-l border-indigo-200 dark:border-indigo-900 min-w-[90px]">
                      نسبة اليوم %
                    </th>
                    <th className="p-2.5 text-center border-l border-indigo-200 dark:border-indigo-900 min-w-[110px]">
                      التاركت الشهري
                    </th>
                    <th className="p-2.5 text-center border-l border-indigo-200 dark:border-indigo-900 min-w-[110px]">
                      المبيعات الشهرية
                    </th>
                    <th className="p-2.5 text-center border-l border-indigo-200 dark:border-indigo-900 min-w-[100px]">
                      المتبقي
                    </th>
                    <th className="p-2.5 text-center min-w-[90px]">
                      نسبة الشهر %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-100 dark:divide-indigo-950">
                  {sortedSupervisorRows.map((row, idx) => {
                    const isEven = idx % 2 === 0;
                    const hasSalesToday = row.dailySales > 0;
                    const isHighestAchieved = row.monthlyTarget > 0 && row.monthlySales >= row.monthlyTarget;

                    return (
                      <tr
                        key={`sup_${row.categoryName}`}
                        className={`transition-colors font-bold ${
                          isHighestAchieved
                            ? isDarkMode
                              ? 'bg-emerald-950/80 text-emerald-100 ring-1 ring-inset ring-emerald-500/50'
                              : 'bg-emerald-100/90 text-emerald-950 ring-1 ring-inset ring-emerald-500/50'
                            : isEven
                            ? isDarkMode ? 'bg-slate-900/40' : 'bg-white'
                            : isDarkMode ? 'bg-slate-900/80' : 'bg-indigo-50/30'
                        }`}
                      >
                        <td className="p-2.5 text-center font-bold text-slate-400 border-l border-indigo-100 dark:border-indigo-950 text-[11px]">
                          {idx + 1}
                        </td>
                        <td className={`p-2.5 font-black border-l ${
                          isDarkMode ? 'text-white border-indigo-950' : 'text-slate-900 border-indigo-100'
                        }`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs sm:text-[13px] ${
                              isHighestAchieved 
                                ? (isDarkMode ? 'text-emerald-300 font-black' : 'text-emerald-950 font-black')
                                : (isDarkMode ? 'text-white font-black' : 'text-slate-900')
                            }`}>
                              {getCategoryDisplayName(row.categoryName)}
                            </span>
                            {isHighestAchieved && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-600 text-white shrink-0 shadow-xs">
                                <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                                <span>تم التحقيق الشهري 🎯</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5 text-center font-black text-slate-700 dark:text-slate-300 border-l border-indigo-100 dark:border-indigo-950">
                          <span className="text-xs">
                            {row.dailyTarget > 0 ? `${formatWithCommas(Math.round(row.dailyTarget))} كغم` : '0'}
                          </span>
                        </td>
                        <td className={`p-2.5 text-center font-black border-l border-indigo-100 dark:border-indigo-950 ${
                          hasSalesToday ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-slate-400 dark:text-slate-500'
                        }`}>
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-xs">
                              {hasSalesToday ? `${formatWithCommas(Math.round(row.dailySales))} كغم` : '0'}
                            </span>
                            {row.dailyTarget > 0 && row.dailySales < row.dailyTarget && (
                              <span title={`لم يتحقق تاركت المشرف اليومي للصنف (متبقي ${Math.round(row.dailyTarget - row.dailySales)} كغم)`}>
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0 inline" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`p-2.5 text-center border-l border-indigo-100 dark:border-indigo-950 transition-colors ${
                          row.dailyPct < 75
                            ? isDarkMode ? 'bg-red-950/30' : 'bg-red-50/70'
                            : row.dailyPct > 120
                            ? isDarkMode ? 'bg-emerald-950/30' : 'bg-emerald-50/70'
                            : ''
                        }`}>
                          {renderPercentBadge(row.dailyPct)}
                        </td>
                        <td className="p-2.5 text-center font-black text-slate-800 dark:text-slate-200 border-l border-indigo-100 dark:border-indigo-950">
                          <span>{row.monthlyTarget > 0 ? `${formatWithCommas(Math.round(row.monthlyTarget))} كغم` : '0'}</span>
                        </td>
                        <td className="p-2.5 text-center font-black text-slate-800 dark:text-slate-200 border-l border-indigo-100 dark:border-indigo-950">
                          <span>{row.monthlySales > 0 ? `${formatWithCommas(Math.round(row.monthlySales))} كغم` : '0'}</span>
                        </td>
                        <td className="p-2.5 text-center font-black text-amber-700 dark:text-amber-400 border-l border-indigo-100 dark:border-indigo-950">
                          <span className="text-xs">
                            {row.remainingMonthly > 0 ? `${formatWithCommas(Math.round(row.remainingMonthly))} كغم` : '0'}
                          </span>
                        </td>
                        <td className={`p-2.5 text-center transition-colors ${
                          row.monthlyPct < 75
                            ? isDarkMode ? 'bg-red-950/30' : 'bg-red-50/70'
                            : row.monthlyPct > 120
                            ? isDarkMode ? 'bg-emerald-950/30' : 'bg-emerald-50/70'
                            : ''
                        }`}>
                          {renderPercentBadge(row.monthlyPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className={`border-t-2 font-black text-xs sm:text-[13px] ${
                    isDarkMode
                      ? 'bg-gradient-to-r from-indigo-950 via-slate-950 to-emerald-950 text-white border-indigo-500'
                      : 'bg-gradient-to-r from-indigo-100 via-slate-100 to-emerald-100 text-slate-950 border-indigo-500'
                  }`}>
                    <td colSpan={2} className="p-3 text-center border-l border-indigo-200 dark:border-indigo-900 font-black">
                      <div className="flex items-center justify-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-indigo-500" />
                        <span>إجمالي تاركت المشرف العام</span>
                      </div>
                    </td>
                    <td className="p-3 text-center border-l border-indigo-200 dark:border-indigo-900 text-emerald-700 dark:text-emerald-300 font-black">
                      {formatWithCommas(Math.round(supervisorTable.totals.totalDailyTarget))} كغم
                    </td>
                    <td className="p-3 text-center border-l border-indigo-200 dark:border-indigo-900 text-teal-700 dark:text-teal-300 font-black">
                      {formatWithCommas(Math.round(supervisorTable.totals.totalDailySales))} كغم
                    </td>
                    <td className={`p-3 text-center border-l border-indigo-200 dark:border-indigo-900 transition-colors ${
                      supervisorTable.totals.totalDailyPct < 75
                        ? isDarkMode ? 'bg-red-950/40' : 'bg-red-100/70'
                        : supervisorTable.totals.totalDailyPct > 120
                        ? isDarkMode ? 'bg-emerald-950/40' : 'bg-emerald-100/70'
                        : ''
                    }`}>
                      {renderPercentBadge(supervisorTable.totals.totalDailyPct)}
                    </td>
                    <td className="p-3 text-center border-l border-indigo-200 dark:border-indigo-900 font-black">
                      {formatWithCommas(Math.round(supervisorTable.totals.totalMonthlyTarget))} كغم
                    </td>
                    <td className="p-3 text-center border-l border-indigo-200 dark:border-indigo-900 font-black">
                      {formatWithCommas(Math.round(supervisorTable.totals.totalMonthlySales))} كغم
                    </td>
                    <td className="p-3 text-center border-l border-indigo-200 dark:border-indigo-900 text-amber-700 dark:text-amber-400 font-black">
                      {formatWithCommas(Math.round(supervisorTable.totals.totalRemainingMonthly))} كغم
                    </td>
                    <td className={`p-3 text-center transition-colors ${
                      supervisorTable.totals.totalMonthlyPct < 75
                        ? isDarkMode ? 'bg-red-950/40' : 'bg-red-100/70'
                        : supervisorTable.totals.totalMonthlyPct > 120
                        ? isDarkMode ? 'bg-emerald-950/40' : 'bg-emerald-100/70'
                        : ''
                    }`}>
                      {renderPercentBadge(supervisorTable.totals.totalMonthlyPct)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
};

export default Report11Screen;
