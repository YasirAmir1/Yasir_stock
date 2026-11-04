import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, writeBatch, query, where, getDocs } from 'firebase/firestore';
import { safeOnSnapshot, logFirestoreErrorGracefully, isGlobalQuotaExceeded, cleanFirestoreData } from '../lib/firestoreUtils';
import { SalesEntry, AdditionalTargetDelegateConfig, AdditionalTargetGlobalConfig, ProductCustomerTarget, UploadedSalesEntry, UploadedWillieSalesEntry } from '../types';
import { formatWithCommas, parseArabicDigits } from '../utils/numberUtils';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas-pro';
import {
  Target,
  Users,
  User,
  Store,
  Calendar,
  Download,
  Upload,
  MessageCircle,
  Save,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Sparkles,
  ShieldCheck,
  Scale,
  Layers,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Printer,
  Check,
  Search,
  SlidersHorizontal,
  X,
  Package,
  Award,
  ArrowUpDown
} from 'lucide-react';
import { PullToRefresh } from './PullToRefresh';

// Arabic normalizer helper
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

// Robust classifier for ESL Family vs ESL Small
export const classifyEslProduct = (entry: { categoryName?: string; productName?: string; pieceWeightKg?: number; productCode?: string }): 'family' | 'small' | null => {
  const cat = normalizeArabic(entry.categoryName || '');
  const prod = normalizeArabic(entry.productName || '');
  const code = normalizeArabic(entry.productCode || '');
  const combined = `${cat} ${prod} ${code}`;
  const weight = Number(entry.pieceWeightKg) || 0;

  // Must belong to bottle milk category or contain bottle milk keywords
  const isBottleMilk =
    cat.includes('حليب بطل') ||
    cat.includes('حليب قنين') ||
    cat.includes('صغير') ||
    cat.includes('كبير') ||
    prod.includes('صغير') ||
    prod.includes('كبير') ||
    code.includes('sml') ||
    code.includes('fam') ||
    combined.includes('حليب بطل') ||
    combined.includes('حليب قنين') ||
    combined.includes('esl') ||
    (combined.includes('حليب') && (combined.includes('بطل') || combined.includes('زجاج') || combined.includes('قنين')));

  // Exclude packet milk (حليب باكيت / كرتون / تترا) unless explicitly bottle
  if (combined.includes('حليب باكيت') || combined.includes('باكيت') || combined.includes('تترا') || combined.includes('كارتون')) {
    if (!combined.includes('بطل') && !combined.includes('قنين') && !combined.includes('esl')) {
      return null;
    }
  }

  if (!isBottleMilk) {
    return null;
  }

  // Check Small indications first (checks categoryName, productName, productCode, and combined):
  if (
    cat.includes('صغير') ||
    cat.includes('small') ||
    cat.includes('200') ||
    cat.includes('220') ||
    cat.includes('250') ||
    prod.includes('صغير') ||
    prod.includes('200') ||
    prod.includes('220') ||
    prod.includes('250') ||
    prod.includes('small') ||
    code.includes('sml') ||
    code.includes('small') ||
    combined.includes('صغير') ||
    combined.includes('small') ||
    (weight > 0 && weight < 0.5)
  ) {
    return 'small';
  }

  // Check Family / Large indications:
  if (
    cat.includes('كبير') ||
    cat.includes('family') ||
    cat.includes('عائلي') ||
    prod.includes('كبير') ||
    prod.includes('1000') ||
    prod.includes('900') ||
    prod.includes('950') ||
    prod.includes('1 لتر') ||
    prod.includes('1لتر') ||
    prod.includes('لتر') ||
    prod.includes('عائلي') ||
    prod.includes('family') ||
    code.includes('fam') ||
    code.includes('family') ||
    combined.includes('كبير') ||
    combined.includes('family') ||
    weight >= 0.5
  ) {
    return 'family';
  }

  // Final fallbacks based on raw product name / category name
  const rawCombined = `${String(entry.categoryName || '')} ${String(entry.productName || '')} ${String(entry.productCode || '')}`.toLowerCase();
  if (rawCombined.includes('صغير') || rawCombined.includes('small') || rawCombined.includes('200') || rawCombined.includes('sml')) return 'small';
  if (rawCombined.includes('كبير') || rawCombined.includes('family') || rawCombined.includes('عائلي') || rawCombined.includes('1000') || rawCombined.includes('1l')) return 'family';

  if (weight >= 0.7) return 'family';
  if (weight > 0 && weight <= 0.4) return 'small';

  return 'family';
};

// Robust classifier for Willie Cheese
export const classifyWillieProduct = (entry: { categoryName?: string; productName?: string; productCode?: string }): { type: 'oval100g' | 'oval200g' | 'ovalLight200g' | null } => {
  const cat = normalizeArabic(entry.categoryName || '');
  const prod = normalizeArabic(entry.productName || '');
  const code = normalizeArabic(entry.productCode || '');
  const combined = `${cat} ${prod} ${code}`;

  const isWillie =
    combined.includes('ويلي') ||
    combined.includes('willie') ||
    combined.includes('w100') ||
    combined.includes('w200') ||
    combined.includes('w-100') ||
    combined.includes('w-200') ||
    combined.includes('w200l') ||
    combined.includes('w-200l');
  
  if (!isWillie) return { type: null };

  let type: 'oval100g' | 'oval200g' | 'ovalLight200g' | null = null;
  const isLight =
    combined.includes('لايت') ||
    combined.includes('light') ||
    combined.includes('200l') ||
    combined.includes('200-l') ||
    combined.includes('200 light') ||
    combined.includes('200light');

  if (isLight) {
    type = 'ovalLight200g';
  } else if (combined.includes('200')) {
    type = 'oval200g';
  } else if (combined.includes('100')) {
    type = 'oval100g';
  } else {
    type = 'oval100g';
  }

  return { type };
};

// Helper to provide detailed metadata for each target table
export const getTargetTableInfo = (uploadType?: string) => {
  switch (uploadType) {
    case 'milkFamily':
      return {
        tableName: 'جدول حليب العائلي (كبير 1 لتر)',
        badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
        icon: '🥛',
        description: 'سيتم استبدال مبيعات حليب العائلي فقط وتحديث الجدول الأول، مع الحفاظ الكامل على بيانات حليب الصغار والويلي.',
      };
    case 'milkSmall':
      return {
        tableName: 'جدول حليب الصغار (200 مل)',
        badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
        icon: '🍼',
        description: 'سيتم استبدال مبيعات حليب الصغار فقط وتحديث الجدول الثاني، مع الحفاظ الكامل على بيانات حليب العائلي والويلي.',
      };
    case 'milk':
      return {
        tableName: 'جدول إجمالي الحليب (ESL كلي)',
        badgeColor: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40',
        icon: '🥛',
        description: 'سيتم استبدال كافة مبيعات الحليب (العائلي والصغار) وتحديث جداول الحليب بالكامل من الملف الجديد.',
      };
    case 'willie100g':
      return {
        tableName: 'جدول جبن ويلي بيضاوي (100 غم)',
        badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
        icon: '🧀',
        description: 'سيتم استبدال مبيعات ويلي 100 غم فقط وتحديث هذا الجدول والجدول المجمع، دون المساس بأحجام 200 غم أو لايت 200 غم أو الحليب.',
      };
    case 'willie200g':
      return {
        tableName: 'جدول جبن ويلي بيضاوي (200 غم)',
        badgeColor: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
        icon: '🧀',
        description: 'سيتم استبدال مبيعات ويلي 200 غم فقط وتحديث هذا الجدول والجدول المجمع، دون المساس بأحجام 100 غم أو لايت 200 غم أو الحليب.',
      };
    case 'willieLight200g':
      return {
        tableName: 'جدول جبن ويلي بيضاوي لايت (200 غم لايت)',
        badgeColor: 'bg-teal-500/20 text-teal-400 border-teal-500/40',
        icon: '🧀',
        description: 'سيتم استبدال مبيعات ويلي لايت 200 غم فقط وتحديث هذا الجدول والجدول المجمع، دون المساس بباقي الأحجام أو الحليب.',
      };
    case 'willie':
      return {
        tableName: 'جدول جبن ويلي المجمع (كافة الأحجام)',
        badgeColor: 'bg-amber-600/20 text-amber-300 border-amber-600/40',
        icon: '🧀',
        description: 'سيتم استبدال مبيعات كافة أحجام جبن ويلي (100غ، 200غ، لايت 200غ) وتحديث كافة جداول الويلي بالكامل من الملف الجديد.',
      };
    default:
      return {
        tableName: 'جدول الهدف الإضافي',
        badgeColor: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
        icon: '📊',
        description: 'سيتم استبدال البيانات وتحديث الجدول المحدد من الملف الجديد.',
      };
  }
};

// Default fallback configuration
const DEFAULT_GLOBAL_CONFIG: AdditionalTargetGlobalConfig = {
  defaultFamilyMinWeightPerShopKg: 2, // 2 kg minimum per shop to qualify as covered
  defaultSmallMinWeightPerShopKg: 1,  // 1 kg minimum per shop to qualify as covered
  monthlyWorkingDaysCount: 26,        // 26 working days in current month by default
};

const DEFAULT_TARGETS_PER_DELEGATE = {
  familyMonthlyWeightTargetKg: 1040,
  familyTargetShopsCount: 15,
  familyMinWeightPerShopKg: 2,
  smallMonthlyWeightTargetKg: 390,
  smallTargetShopsCount: 15,
  smallMinWeightPerShopKg: 1,
  willieOval100gMonthlyWeightTarget: 182,
  willieOval100gShopsTarget: 10,
  willieOval200gMonthlyWeightTarget: 182,
  willieOval200gShopsTarget: 10,
  willieOvalLight200gMonthlyWeightTarget: 156,
  willieOvalLight200gShopsTarget: 10,
  willieMinWeightPerInvoiceKg: 1.2,
  willieMinWeightPerCustomerMonthKg: 4,
};

export const AdditionalTargetScreen: React.FC = () => {
  const {
    currentUser,
    delegatesList = [],
    salesEntries = [],
    allSalesEntries = [],
    selectedDate,
    setSelectedDate,
    isDarkMode,
    setUserMessage,
    refreshAllData,
  } = useSales();

  const printReportRef = useRef<HTMLDivElement>(null);
  const excelUploadInputRef = useRef<HTMLInputElement>(null);
  const excelFamilyUploadInputRef = useRef<HTMLInputElement>(null);
  const excelSmallUploadInputRef = useRef<HTMLInputElement>(null);
  const willieExcelUploadInputRef = useRef<HTMLInputElement>(null);
  const willie100gExcelUploadInputRef = useRef<HTMLInputElement>(null);
  const willie200gExcelUploadInputRef = useRef<HTMLInputElement>(null);
  const willieLight200gExcelUploadInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = Boolean(
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    currentUser?.name === 'الأدمن'
  );

  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.username?.toLowerCase() === 'supervisor' ||
    currentUser?.name === 'مشرف' ||
    currentUser?.name === 'رأفت جمال'
  );

  const canEditTargets = isAdmin || isDataEntry;

  // Selected date string
  const activeDate = useMemo(() => {
    return selectedDate || new Date().toISOString().split('T')[0];
  }, [selectedDate]);

  // Delegates list excluding excluded names (and exclude شرقاط)
  const activeDelegates = useMemo(() => {
    const list = delegatesList.filter(
      (d) =>
        d !== 'الكل' &&
        d !== 'الأدمن' &&
        d !== 'رأفت جمال' &&
        !d.toLowerCase().includes('sauce') &&
        !d.includes('مندوب عام 1') &&
        !d.includes('مندوب عام 2') &&
        !normalizeArabic(d).includes('شرقاط')
    );
    const standard = ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال', 'محمد جاسم', 'ناجي خلف', 'صباح فرحان'];
    standard.forEach((s) => {
      if (!list.includes(s) && !normalizeArabic(s).includes('شرقاط')) {
        list.push(s);
      }
    });
    return list;
  }, [delegatesList]);

  // Active delegate selection & view mode
  const [activeDelegate, setActiveDelegate] = useState<string>(() => {
    if (!isAdmin && !isDataEntry && currentUser?.name) {
      return currentUser.name;
    }
    return '__SUPERVISOR__';
  });

  const [viewMode, setViewMode] = useState<'single' | 'all'>('all');

  // Targets state loaded from Firestore
  const [delegateConfigs, setDelegateConfigs] = useState<AdditionalTargetDelegateConfig[]>(() => {
    try {
      const cached = localStorage.getItem('cache_additional_targets_delegates');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const [uploadedSalesEntries, setUploadedSalesEntries] = useState<UploadedSalesEntry[]>(() => {
    try {
      const cached = localStorage.getItem('cache_additional_target_uploaded_sales');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const [uploadedWillieSalesEntries, setUploadedWillieSalesEntries] = useState<UploadedWillieSalesEntry[]>(() => {
    try {
      const cached = localStorage.getItem('cache_additional_target_willie_uploaded_sales');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const [monthlyWillieSalesEntries, setMonthlyWillieSalesEntries] = useState<UploadedWillieSalesEntry[]>([]);
  const [monthlyUploadedSalesEntries, setMonthlyUploadedSalesEntries] = useState<UploadedSalesEntry[]>([]);

  const [globalConfig, setGlobalConfig] = useState<AdditionalTargetGlobalConfig>(() => {
    try {
      const cached = localStorage.getItem('cache_additional_targets_config');
      if (cached) return JSON.parse(cached);
    } catch {}
    return DEFAULT_GLOBAL_CONFIG;
  });

  // Modal for editing targets
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [configModalTab, setConfigModalTab] = useState<'milk' | 'willie'>('milk');
  const [editDelegateName, setEditDelegateName] = useState<string>('all');
  const [editFamilyWeightTarget, setEditFamilyWeightTarget] = useState<number>(40);
  const [editFamilyShopsTarget, setEditFamilyShopsTarget] = useState<number>(15);
  const [editFamilyMinWeight, setEditFamilyMinWeight] = useState<number>(2);
  const [editSmallWeightTarget, setEditSmallWeightTarget] = useState<number>(15);
  const [editSmallShopsTarget, setEditSmallShopsTarget] = useState<number>(15);
  const [editSmallMinWeight, setEditSmallMinWeight] = useState<number>(1);
  const [editWillieOval100gWeightTarget, setEditWillieOval100gWeightTarget] = useState<number>(7);
  const [editWillieOval100gShopsTarget, setEditWillieOval100gShopsTarget] = useState<number>(10);
  const [editWillieOval200gWeightTarget, setEditWillieOval200gWeightTarget] = useState<number>(7);
  const [editWillieOval200gShopsTarget, setEditWillieOval200gShopsTarget] = useState<number>(10);
  const [editWillieOvalLight200gWeightTarget, setEditWillieOvalLight200gWeightTarget] = useState<number>(6);
  const [editWillieOvalLight200gShopsTarget, setEditWillieOvalLight200gShopsTarget] = useState<number>(10);
  const [editWillieMinWeightInvoice, setEditWillieMinWeightInvoice] = useState<number>(1.2);
  const [editWillieMinWeightMonth, setEditWillieMinWeightMonth] = useState<number>(4);
  const [isSavingTargets, setIsSavingTargets] = useState<boolean>(false);
  const [isParsingExcel, setIsParsingExcel] = useState<boolean>(false);

  // Working days setting modal state
  const [showWorkingDaysModal, setShowWorkingDaysModal] = useState<boolean>(false);
  const [editWorkingDays, setEditWorkingDays] = useState<number>(() => globalConfig.monthlyWorkingDaysCount || 26);

  useEffect(() => {
    if (globalConfig.monthlyWorkingDaysCount) {
      setEditWorkingDays(globalConfig.monthlyWorkingDaysCount);
    }
  }, [globalConfig.monthlyWorkingDaysCount]);

  const handleSaveWorkingDays = async () => {
    try {
      setIsSavingTargets(true);
      const daysCount = Math.max(1, Math.min(31, Number(editWorkingDays) || 26));
      const updated: AdditionalTargetGlobalConfig = {
        ...globalConfig,
        monthlyWorkingDaysCount: daysCount,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || 'Admin',
      };
      setGlobalConfig(updated);
      try {
        localStorage.setItem('cache_additional_targets_config', JSON.stringify(updated));
      } catch {}

      await setDoc(doc(db, 'app_settings', 'additional_targets_config'), cleanFirestoreData(updated), { merge: true });
      setUserMessage(`تم حفظ عدد أيام العمل (${daysCount} يوم) وتحديث أهداف الوزن الشهرية للمندوبين بنجاح 🗓️✅`);
      setShowWorkingDaysModal(false);
    } catch (err) {
      console.error('Error saving working days:', err);
      setUserMessage('حدث خطأ أثناء حفظ عدد أيام العمل');
    } finally {
      setIsSavingTargets(false);
    }
  };

  // Upload confirmation state
  const [showUploadConfirm, setShowUploadConfirm] = useState<boolean>(false);
  const [pendingUploadData, setPendingUploadData] = useState<{
    delegateConfigs: AdditionalTargetDelegateConfig[];
    targets: ProductCustomerTarget[];
    sales: UploadedSalesEntry[];
    willieSales: UploadedWillieSalesEntry[];
    uploadType: 'milk' | 'milkFamily' | 'milkSmall' | 'willie' | 'willie100g' | 'willie200g' | 'willieLight200g';
  } | null>(null);

  // Table search & filter states
  const [shopSearchTerm, setShopSearchTerm] = useState<string>('');
  const [coverageFilter, setCoverageFilter] = useState<'all' | 'covered' | 'unmet' | 'neither'>('all');

  // Keep delegate locked for non-admins
  useEffect(() => {
    if (!isAdmin && !isDataEntry && currentUser?.name) {
      setActiveDelegate(currentUser.name);
      setViewMode('single');
    }
  }, [isAdmin, isDataEntry, currentUser]);

  // Sync with Firestore
  useEffect(() => {
    if (isGlobalQuotaExceeded()) return;

    const unsubConfigs = safeOnSnapshot(
      collection(db, 'additional_targets_delegates'),
      (snapshot: any) => {
        const list: AdditionalTargetDelegateConfig[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as AdditionalTargetDelegateConfig;
          if (data && data.delegateName) {
            list.push({ ...data, id: docSnap.id });
          }
        });
        setDelegateConfigs(list);
        try {
          localStorage.setItem('cache_additional_targets_delegates', JSON.stringify(list));
        } catch {}
      },
      (err: any) => logFirestoreErrorGracefully(err, 'additional_targets_delegates'),
      'additional_targets_delegates'
    );

    const unsubUploadedSales = safeOnSnapshot(
      query(collection(db, 'additional_target_uploaded_sales'), where('dateString', '==', activeDate)),
      (snapshot: any) => {
        const list: UploadedSalesEntry[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as UploadedSalesEntry;
          list.push({ ...data, id: docSnap.id });
        });
        setUploadedSalesEntries(list);
        try {
          localStorage.setItem('cache_additional_target_uploaded_sales', JSON.stringify(list));
        } catch {}
      },
      (err: any) => logFirestoreErrorGracefully(err, 'additional_target_uploaded_sales'),
      'additional_target_uploaded_sales'
    );

    const unsubUploadedWillieSales = safeOnSnapshot(
      query(collection(db, 'additional_target_willie_uploaded_sales'), where('dateString', '==', activeDate)),
      (snapshot: any) => {
        const list: UploadedWillieSalesEntry[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as UploadedWillieSalesEntry;
          list.push({ ...data, id: docSnap.id });
        });
        setUploadedWillieSalesEntries(list);
        try {
          localStorage.setItem('cache_additional_target_willie_uploaded_sales', JSON.stringify(list));
        } catch {}
      },
      (err: any) => logFirestoreErrorGracefully(err, 'additional_target_willie_uploaded_sales'),
      'additional_target_willie_uploaded_sales'
    );

    const activeMonth = activeDate.substring(0, 7);
    const unsubMonthlyWillieSales = safeOnSnapshot(
      query(collection(db, 'additional_target_willie_uploaded_sales'), where('monthString', '==', activeMonth)),
      (snapshot: any) => {
        const list: UploadedWillieSalesEntry[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as UploadedWillieSalesEntry;
          list.push({ ...data, id: docSnap.id });
        });
        setMonthlyWillieSalesEntries(list);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'monthly_willie_sales'),
      'monthly_willie_sales'
    );

    const unsubMonthlyUploadedSales = safeOnSnapshot(
      query(
        collection(db, 'additional_target_uploaded_sales'),
        where('dateString', '>=', `${activeMonth}-01`),
        where('dateString', '<=', `${activeMonth}-31`)
      ),
      (snapshot: any) => {
        const list: UploadedSalesEntry[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as UploadedSalesEntry;
          list.push({ ...data, id: docSnap.id });
        });
        setMonthlyUploadedSalesEntries(list);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'monthly_milk_sales'),
      'monthly_milk_sales'
    );

    const unsubGlobal = safeOnSnapshot(
      doc(db, 'app_settings', 'additional_targets_config'),
      (snap: any) => {
        if (snap.exists()) {
          const data = snap.data() as AdditionalTargetGlobalConfig;
          if (data) {
            setGlobalConfig(data);
            try {
              localStorage.setItem('cache_additional_targets_config', JSON.stringify(data));
            } catch {}
          }
        }
      },
      (err: any) => logFirestoreErrorGracefully(err, 'additional_targets_config'),
      'additional_targets_config'
    );

    return () => {
      unsubConfigs();
      unsubUploadedSales();
      unsubUploadedWillieSales();
      unsubMonthlyWillieSales();
      unsubMonthlyUploadedSales();
      unsubGlobal();
    };
  }, [activeDate]);

  // Helper to fetch target config for a given delegate
  const getDelegateConfig = useCallback(
    (delegateName: string): AdditionalTargetDelegateConfig => {
      const norm = normalizeArabic(delegateName);
      const found = delegateConfigs.find((c) => normalizeArabic(c.delegateName) === norm);
      if (found) {
        return {
          ...DEFAULT_TARGETS_PER_DELEGATE,
          ...found,
          familyMonthlyWeightTargetKg: found.familyMonthlyWeightTargetKg ?? found.familyDailyWeightTargetKg ?? 1040,
          familyMinWeightPerShopKg: found.familyMinWeightPerShopKg ?? globalConfig.defaultFamilyMinWeightPerShopKg ?? 2,
          smallMonthlyWeightTargetKg: found.smallMonthlyWeightTargetKg ?? found.smallDailyWeightTargetKg ?? 390,
          smallMinWeightPerShopKg: found.smallMinWeightPerShopKg ?? globalConfig.defaultSmallMinWeightPerShopKg ?? 1,
          willieOval100gMonthlyWeightTarget: found.willieOval100gMonthlyWeightTarget ?? found.willieOval100gWeightTarget ?? 182,
          willieOval100gShopsTarget: found.willieOval100gShopsTarget ?? 10,
          willieOval200gMonthlyWeightTarget: found.willieOval200gMonthlyWeightTarget ?? found.willieOval200gWeightTarget ?? 182,
          willieOval200gShopsTarget: found.willieOval200gShopsTarget ?? 10,
          willieOvalLight200gMonthlyWeightTarget: found.willieOvalLight200gMonthlyWeightTarget ?? found.willieOvalLight200gWeightTarget ?? 156,
          willieOvalLight200gShopsTarget: found.willieOvalLight200gShopsTarget ?? 10,
          willieMinWeightPerInvoiceKg: found.willieMinWeightPerInvoiceKg ?? 1.2,
          willieMinWeightPerCustomerMonthKg: found.willieMinWeightPerCustomerMonthKg ?? 4,
        };
      }
      return {
        delegateName,
        ...DEFAULT_TARGETS_PER_DELEGATE,
        familyMinWeightPerShopKg: globalConfig.defaultFamilyMinWeightPerShopKg ?? 2,
        smallMinWeightPerShopKg: globalConfig.defaultSmallMinWeightPerShopKg ?? 1,
      };
    },
    [delegateConfigs, globalConfig]
  );

  // Pool of sales entries - NOW EXCLUSIVELY FROM UPLOADED SALES
  const todayEntries = useMemo(() => {
    return uploadedSalesEntries;
  }, [uploadedSalesEntries]);

  // Compute stats per delegate
  const delegatesAnalysis = useMemo(() => {
    return activeDelegates.map((delName) => {
      const config = getDelegateConfig(delName);
      const normDel = normalizeArabic(delName);

      // Filter entries for this delegate
      const delEntries = todayEntries.filter(
        (e) => normalizeArabic(e.delegateName) === normDel || e.delegateName === delName
      );

      // Group by shop (customerCode or customerName)
      const shopMap: Record<
        string,
        {
          customerName: string;
          customerCode: string;
          customerType: string;
          familyWeight: number;
          smallWeight: number;
          willieOval100gWeight: number;
          willieOval200gWeight: number;
          willieOvalLight200gWeight: number;
          willieOval100gCoverageWeight: number;
          willieOval200gCoverageWeight: number;
          willieOvalLight200gCoverageWeight: number;
          totalWeight: number;
          invoicesCount: number;
          isFamilyCovered: boolean;
          isSmallCovered: boolean;
          isWillieOval100gCovered: boolean;
          isWillieOval200gCovered: boolean;
          isWillieOvalLight200gCovered: boolean;
          willieOval100gMonthlyTotalWeight: number;
          willieOval200gMonthlyTotalWeight: number;
          willieOvalLight200gMonthlyTotalWeight: number;
        }
      > = {};

      let totalFamilyWeight = 0;
      let totalSmallWeight = 0;
      let totalWillieVolumeWeight = 0;

      // ESL Milk entries
      delEntries.forEach((entry: any) => {
        const pieceWeightKg = entry.pieceWeightKg || (entry.quantity > 0 ? entry.totalWeightKg / entry.quantity : 0);
        const eslType = classifyEslProduct({ ...entry, pieceWeightKg });
        if (!eslType) return; // not ESL bottle milk

        const shopKey = (entry.customerCode || entry.customerName || 'محل عام').trim();
        if (!shopMap[shopKey]) {
          shopMap[shopKey] = {
            customerName: entry.customerName || entry.customerCode || 'عميل',
            customerCode: entry.customerCode || '',
            customerType: entry.customerType || (entry.priceMode === 'wholesale' ? 'جملة' : 'مفرد'),
            familyWeight: 0,
            smallWeight: 0,
            willieOval100gWeight: 0,
            willieOval200gWeight: 0,
            willieOvalLight200gWeight: 0,
            willieOval100gCoverageWeight: 0,
            willieOval200gCoverageWeight: 0,
            willieOvalLight200gCoverageWeight: 0,
            totalWeight: 0,
            invoicesCount: 0,
            isFamilyCovered: false,
            isSmallCovered: false,
            isWillieOval100gCovered: false,
            isWillieOval200gCovered: false,
            isWillieOvalLight200gCovered: false,
            willieOval100gMonthlyTotalWeight: 0,
            willieOval200gMonthlyTotalWeight: 0,
            willieOvalLight200gMonthlyTotalWeight: 0,
          };
        }

        const weight = Number(entry.totalWeightKg) || 0;
        shopMap[shopKey].invoicesCount += 1;
        shopMap[shopKey].totalWeight += weight;

        if (eslType === 'family') {
          shopMap[shopKey].familyWeight += weight;
          totalFamilyWeight += weight;
        } else if (eslType === 'small') {
          shopMap[shopKey].smallWeight += weight;
          totalSmallWeight += weight;
        }
      });

      // Willie entries
      const delWillieEntries = uploadedWillieSalesEntries.filter(
        (e) => normalizeArabic(e.delegateName) === normDel || e.delegateName === delName
      );

      let totalWillieOval100gWeight = 0;
      let totalWillieOval200gWeight = 0;
      let totalWillieOvalLight200gWeight = 0;

      delWillieEntries.forEach((entry) => {
        const { type } = classifyWillieProduct(entry);
        if (!type) return;

        const shopKey = (entry.customerCode || entry.customerName || 'محل عام').trim();
        if (!shopMap[shopKey]) {
          shopMap[shopKey] = {
            customerName: entry.customerName || entry.customerCode || 'عميل',
            customerCode: entry.customerCode || '',
            customerType: 'مفرد',
            familyWeight: 0,
            smallWeight: 0,
            willieOval100gWeight: 0,
            willieOval200gWeight: 0,
            willieOvalLight200gWeight: 0,
            willieOval100gCoverageWeight: 0,
            willieOval200gCoverageWeight: 0,
            willieOvalLight200gCoverageWeight: 0,
            totalWeight: 0,
            invoicesCount: 0,
            isFamilyCovered: false,
            isSmallCovered: false,
            isWillieOval100gCovered: false,
            isWillieOval200gCovered: false,
            isWillieOvalLight200gCovered: false,
            willieOval100gMonthlyTotalWeight: 0,
            willieOval200gMonthlyTotalWeight: 0,
            willieOvalLight200gMonthlyTotalWeight: 0,
          };
        }


        const weight = Number(entry.totalWeightKg) || 0;
        if (type === 'oval100g') {
          shopMap[shopKey].willieOval100gWeight += weight;
          totalWillieOval100gWeight += weight;
        } else if (type === 'oval200g') {
          shopMap[shopKey].willieOval200gWeight += weight;
          totalWillieOval200gWeight += weight;
        } else if (type === 'ovalLight200g') {
          shopMap[shopKey].willieOvalLight200gWeight += weight;
          totalWillieOvalLight200gWeight += weight;
        }
      });

      // Calculate Willie monthly weight per customer per product for coverage requirement
      const delMonthlyWillieEntries = monthlyWillieSalesEntries.filter(
        (e) => normalizeArabic(e.delegateName) === normDel || e.delegateName === delName
      );

      delMonthlyWillieEntries.forEach((entry) => {
        const { type } = classifyWillieProduct(entry);
        if (!type) return;
        const shopKey = (entry.customerCode || entry.customerName || 'محل عام').trim();
        if (!shopMap[shopKey]) {
          shopMap[shopKey] = {
            customerName: entry.customerName || entry.customerCode || 'عميل',
            customerCode: entry.customerCode || '',
            customerType: 'مفرد',
            familyWeight: 0,
            smallWeight: 0,
            willieOval100gWeight: 0,
            willieOval200gWeight: 0,
            willieOvalLight200gWeight: 0,
            willieOval100gCoverageWeight: 0,
            willieOval200gCoverageWeight: 0,
            willieOvalLight200gCoverageWeight: 0,
            totalWeight: 0,
            invoicesCount: 0,
            isFamilyCovered: false,
            isSmallCovered: false,
            isWillieOval100gCovered: false,
            isWillieOval200gCovered: false,
            isWillieOvalLight200gCovered: false,
            willieOval100gMonthlyTotalWeight: 0,
            willieOval200gMonthlyTotalWeight: 0,
            willieOvalLight200gMonthlyTotalWeight: 0,
          };
        }
        const weight = Number(entry.totalWeightKg) || 0;
        if (type === 'oval100g') shopMap[shopKey].willieOval100gMonthlyTotalWeight += weight;
        else if (type === 'oval200g') shopMap[shopKey].willieOval200gMonthlyTotalWeight += weight;
        else if (type === 'ovalLight200g') shopMap[shopKey].willieOvalLight200gMonthlyTotalWeight += weight;
      });

      // Calculate Willie monthly total sales per delegate per product
      const activeMonthStr = activeDate.substring(0, 7);
      const allMonthWillieForDel = [
        ...monthlyWillieSalesEntries.filter(
          (e) => (normalizeArabic(e.delegateName) === normDel || e.delegateName === delName) &&
                 (e.monthString === activeMonthStr || (e.dateString && e.dateString.startsWith(activeMonthStr)))
        ),
        ...uploadedWillieSalesEntries.filter(
          (e) => (normalizeArabic(e.delegateName) === normDel || e.delegateName === delName) &&
                 !monthlyWillieSalesEntries.some((m) => m.id === e.id) &&
                 (e.monthString === activeMonthStr || (e.dateString && e.dateString.startsWith(activeMonthStr)))
        ),
      ];

      let monthlyTotalWillieOval100g = 0;
      let monthlyTotalWillieOval200g = 0;
      let monthlyTotalWillieOvalLight200g = 0;

      allMonthWillieForDel.forEach((entry) => {
        const { type } = classifyWillieProduct(entry);
        if (!type) return;
        const weight = Number(entry.totalWeightKg) || 0;
        if (type === 'oval100g') monthlyTotalWillieOval100g += weight;
        else if (type === 'oval200g') monthlyTotalWillieOval200g += weight;
        else if (type === 'ovalLight200g') monthlyTotalWillieOvalLight200g += weight;
      });

      // Override with manual targets
      const manualOverride = delegateConfigs.find(c => normalizeArabic(c.delegateName) === normDel)?.manualSalesOverride;
      
      const effectiveFamilyWeight = manualOverride?.familySalesWeight ?? totalFamilyWeight;
      const effectiveSmallWeight = manualOverride?.smallSalesWeight ?? totalSmallWeight;
      const effectiveWillieOval100gWeight = manualOverride?.willieOval100gSalesWeight ?? totalWillieOval100gWeight;
      const effectiveWillieOval200gWeight = manualOverride?.willieOval200gSalesWeight ?? totalWillieOval200gWeight;
      const effectiveWillieOvalLight200gWeight = manualOverride?.willieOvalLight200gSalesWeight ?? totalWillieOvalLight200gWeight;

      // Effective monthly Willie sales
      const effectiveMonthlyWillieOval100gWeight = manualOverride?.willieOval100gSalesWeight ?? Math.max(monthlyTotalWillieOval100g, effectiveWillieOval100gWeight);
      const effectiveMonthlyWillieOval200gWeight = manualOverride?.willieOval200gSalesWeight ?? Math.max(monthlyTotalWillieOval200g, effectiveWillieOval200gWeight);
      const effectiveMonthlyWillieOvalLight200gWeight = manualOverride?.willieOvalLight200gSalesWeight ?? Math.max(monthlyTotalWillieOvalLight200g, effectiveWillieOvalLight200gWeight);
      const totalMonthlyWillieSalesWeight = effectiveMonthlyWillieOval100gWeight + effectiveMonthlyWillieOval200gWeight + effectiveMonthlyWillieOvalLight200gWeight;

      // Monthly Milk sales
      const delMonthMilkEntries = monthlyUploadedSalesEntries.filter(
        (e) => (normalizeArabic(e.delegateName) === normDel || e.delegateName === delName) &&
               (e.dateString ? e.dateString.startsWith(activeMonthStr) : true)
      );

      let monthlyFamilyWeight = 0;
      let monthlySmallWeight = 0;

      delMonthMilkEntries.forEach((entry: any) => {
        const pieceWeightKg = entry.pieceWeightKg || (entry.quantity > 0 ? entry.totalWeightKg / entry.quantity : 0);
        const eslType = classifyEslProduct({ ...entry, pieceWeightKg });
        if (!eslType) return;
        const weight = Number(entry.totalWeightKg) || 0;
        if (eslType === 'family') monthlyFamilyWeight += weight;
        else if (eslType === 'small') monthlySmallWeight += weight;
      });

      const effectiveMonthlyFamilyWeight = Math.max(monthlyFamilyWeight, effectiveFamilyWeight);
      const effectiveMonthlySmallWeight = Math.max(monthlySmallWeight, effectiveSmallWeight);
      const totalMonthlyMilkSalesWeight = effectiveMonthlyFamilyWeight + effectiveMonthlySmallWeight;

      // Evaluate coverage conditions per shop per product
      const minFam = config.familyMinWeightPerShopKg ?? 2;
      const minSm = config.smallMinWeightPerShopKg ?? 1;
      const minWillieInvoice = config.willieMinWeightPerInvoiceKg ?? 1.2;
      const minWillieMonth = config.willieMinWeightPerCustomerMonthKg ?? 4;

      let familyCoveredCount = 0;
      let smallCoveredCount = 0;
      let willieOval100gCoveredCount = 0;
      let willieOval200gCoveredCount = 0;
      let willieOvalLight200gCoveredCount = 0;

      const shopList = Object.values(shopMap).map((shop) => {
        shop.isFamilyCovered = shop.familyWeight >= minFam;
        shop.isSmallCovered = shop.smallWeight >= minSm;
        
        // Willie coverage logic per product:
        // Invoice today >= 1.2kg AND Monthly total >= 4kg
        shop.isWillieOval100gCovered = shop.willieOval100gWeight >= minWillieInvoice && shop.willieOval100gMonthlyTotalWeight >= minWillieMonth;
        shop.isWillieOval200gCovered = shop.willieOval200gWeight >= minWillieInvoice && shop.willieOval200gMonthlyTotalWeight >= minWillieMonth;
        shop.isWillieOvalLight200gCovered = shop.willieOvalLight200gWeight >= minWillieInvoice && shop.willieOvalLight200gMonthlyTotalWeight >= minWillieMonth;

        if (shop.isFamilyCovered) familyCoveredCount++;
        if (shop.isSmallCovered) smallCoveredCount++;
        if (shop.isWillieOval100gCovered) willieOval100gCoveredCount++;
        if (shop.isWillieOval200gCovered) willieOval200gCoveredCount++;
        if (shop.isWillieOvalLight200gCovered) willieOvalLight200gCoveredCount++;

        return shop;
      });

      // Sort shops by total weight descending
      shopList.sort((a, b) => (b.totalWeight + b.willieOval100gWeight + b.willieOval200gWeight + b.willieOvalLight200gWeight) - (a.totalWeight + a.willieOval100gWeight + a.willieOval200gWeight + a.willieOvalLight200gWeight));

      // ESL Family Targets
      const workingDaysCount = globalConfig.monthlyWorkingDaysCount || 26;
      const familyMonthlyTarget = config.familyMonthlyWeightTargetKg || 1040;
      const familyDailyTarget = familyMonthlyTarget / workingDaysCount;
      const familyTargetShops = config.familyTargetShopsCount || 15;
      const familyWeightPct = familyMonthlyTarget > 0 ? (effectiveMonthlyFamilyWeight / familyMonthlyTarget) * 100 : 0;
      const familyDailyWeightPct = familyDailyTarget > 0 ? (effectiveFamilyWeight / familyDailyTarget) * 100 : 0;
      const familyCoveragePct = familyTargetShops > 0 ? (familyCoveredCount / familyTargetShops) * 100 : 0;

      // ESL Small Targets
      const smallMonthlyTarget = config.smallMonthlyWeightTargetKg || 390;
      const smallDailyTarget = smallMonthlyTarget / workingDaysCount;
      const smallTargetShops = config.smallTargetShopsCount || 15;
      const smallWeightPct = smallMonthlyTarget > 0 ? (effectiveMonthlySmallWeight / smallMonthlyTarget) * 100 : 0;
      const smallDailyWeightPct = smallDailyTarget > 0 ? (effectiveSmallWeight / smallDailyTarget) * 100 : 0;
      const smallCoveragePct = smallTargetShops > 0 ? (smallCoveredCount / smallTargetShops) * 100 : 0;

      // Willie Oval 100g Targets
      const willieOval100gMonthlyTarget = config.willieOval100gMonthlyWeightTarget ?? 182;
      const willieOval100gWeightTarget = willieOval100gMonthlyTarget / workingDaysCount;
      const willieOval100gShopsTarget = config.willieOval100gShopsTarget ?? 10;
      const willieOval100gWeightPct = willieOval100gMonthlyTarget > 0 ? (effectiveMonthlyWillieOval100gWeight / willieOval100gMonthlyTarget) * 100 : 0;
      const willieOval100gDailyWeightPct = willieOval100gWeightTarget > 0 ? (effectiveWillieOval100gWeight / willieOval100gWeightTarget) * 100 : 0;
      const willieOval100gCoveragePct = willieOval100gShopsTarget > 0 ? (willieOval100gCoveredCount / willieOval100gShopsTarget) * 100 : 0;

      // Willie Oval 200g Targets
      const willieOval200gMonthlyTarget = config.willieOval200gMonthlyWeightTarget ?? 182;
      const willieOval200gWeightTarget = willieOval200gMonthlyTarget / workingDaysCount;
      const willieOval200gShopsTarget = config.willieOval200gShopsTarget ?? 10;
      const willieOval200gWeightPct = willieOval200gMonthlyTarget > 0 ? (effectiveMonthlyWillieOval200gWeight / willieOval200gMonthlyTarget) * 100 : 0;
      const willieOval200gDailyWeightPct = willieOval200gWeightTarget > 0 ? (effectiveWillieOval200gWeight / willieOval200gWeightTarget) * 100 : 0;
      const willieOval200gCoveragePct = willieOval200gShopsTarget > 0 ? (willieOval200gCoveredCount / willieOval200gShopsTarget) * 100 : 0;

      // Willie Oval Light 200g Targets
      const willieOvalLight200gMonthlyTarget = config.willieOvalLight200gMonthlyWeightTarget ?? 156;
      const willieOvalLight200gWeightTarget = willieOvalLight200gMonthlyTarget / workingDaysCount;
      const willieOvalLight200gShopsTarget = config.willieOvalLight200gShopsTarget ?? 10;
      const willieOvalLight200gWeightPct = willieOvalLight200gMonthlyTarget > 0 ? (effectiveMonthlyWillieOvalLight200gWeight / willieOvalLight200gMonthlyTarget) * 100 : 0;
      const willieOvalLight200gDailyWeightPct = willieOvalLight200gWeightTarget > 0 ? (effectiveWillieOvalLight200gWeight / willieOvalLight200gWeightTarget) * 100 : 0;
      const willieOvalLight200gCoveragePct = willieOvalLight200gShopsTarget > 0 ? (willieOvalLight200gCoveredCount / willieOvalLight200gShopsTarget) * 100 : 0;

      const totalWillieSalesWeight = effectiveWillieOval100gWeight + effectiveWillieOval200gWeight + effectiveWillieOvalLight200gWeight;
      const totalWillieMonthlyTarget = willieOval100gMonthlyTarget + willieOval200gMonthlyTarget + willieOvalLight200gMonthlyTarget;
      const totalWillieTargetWeight = totalWillieMonthlyTarget / workingDaysCount;

      const totalAchievedWeight = effectiveFamilyWeight + effectiveSmallWeight + totalWillieSalesWeight;
      const totalMonthlyAchievedWeight = effectiveMonthlyFamilyWeight + effectiveMonthlySmallWeight + totalMonthlyWillieSalesWeight;
      const totalMonthlyTargetWeight = familyMonthlyTarget + smallMonthlyTarget + totalWillieMonthlyTarget;
      const totalTargetWeight = totalMonthlyTargetWeight / workingDaysCount;
      const totalWeightPct = totalMonthlyTargetWeight > 0 ? (totalMonthlyAchievedWeight / totalMonthlyTargetWeight) * 100 : 0;

      return {
        delegateName: delName,
        config,
        shops: shopList,
        totalShopsVisited: shopList.length,
        workingDaysCount,

        // ESL Family Metrics
        familySalesWeight: effectiveFamilyWeight,
        monthlyFamilySalesWeight: effectiveMonthlyFamilyWeight,
        familyDailyTarget,
        familyMonthlyTarget,
        familyWeightPct,
        familyDailyWeightPct,
        familyCoveredShops: familyCoveredCount,
        familyTargetShops,
        familyCoveragePct,
        familyMinWeightPerShop: minFam,

        // ESL Small Metrics
        smallSalesWeight: effectiveSmallWeight,
        monthlySmallSalesWeight: effectiveMonthlySmallWeight,
        smallDailyTarget,
        smallMonthlyTarget,
        smallWeightPct,
        smallDailyWeightPct,
        smallCoveredShops: smallCoveredCount,
        smallTargetShops,
        smallCoveragePct,
        smallMinWeightPerShop: minSm,
        familyRemainingWeight: Math.max(0, familyMonthlyTarget - effectiveMonthlyFamilyWeight),
        smallRemainingWeight: Math.max(0, smallMonthlyTarget - effectiveMonthlySmallWeight),
        familyUnmetShops: Math.max(0, familyTargetShops - familyCoveredCount),
        smallUnmetShops: Math.max(0, smallTargetShops - smallCoveredCount),

        // Willie Oval 100g Metrics
        willieOval100gSalesWeight: effectiveWillieOval100gWeight,
        monthlyWillieOval100gSalesWeight: effectiveMonthlyWillieOval100gWeight,
        willieOval100gWeightTarget,
        willieOval100gMonthlyTarget,
        willieOval100gWeightPct,
        willieOval100gDailyWeightPct,
        willieOval100gCoveredShops: willieOval100gCoveredCount,
        willieOval100gShopsTarget,
        willieOval100gCoveragePct,

        // Willie Oval 200g Metrics
        willieOval200gSalesWeight: effectiveWillieOval200gWeight,
        monthlyWillieOval200gSalesWeight: effectiveMonthlyWillieOval200gWeight,
        willieOval200gWeightTarget,
        willieOval200gMonthlyTarget,
        willieOval200gWeightPct,
        willieOval200gDailyWeightPct,
        willieOval200gCoveredShops: willieOval200gCoveredCount,
        willieOval200gShopsTarget,
        willieOval200gCoveragePct,

        // Willie Oval Light 200g Metrics
        willieOvalLight200gSalesWeight: effectiveWillieOvalLight200gWeight,
        monthlyWillieOvalLight200gSalesWeight: effectiveMonthlyWillieOvalLight200gWeight,
        willieOvalLight200gWeightTarget,
        willieOvalLight200gMonthlyTarget,
        willieOvalLight200gWeightPct,
        willieOvalLight200gDailyWeightPct,
        willieOvalLight200gCoveredShops: willieOvalLight200gCoveredCount,
        willieOvalLight200gShopsTarget,
        willieOvalLight200gCoveragePct,

        willieMinWeightPerInvoice: minWillieInvoice,

        // Combined Totals
        totalAchievedWeight,
        totalMonthlyAchievedWeight,
        totalTargetWeight,
        totalMonthlyTargetWeight,
        totalWillieSalesWeight,
        totalMonthlyWillieSalesWeight,
        totalMonthlyMilkSalesWeight,
        totalWillieDailyTarget: totalWillieTargetWeight,
        totalWillieMonthlyTarget,
        totalWeightPct,
      };
    });
  }, [activeDelegates, getDelegateConfig, todayEntries, delegateConfigs, globalConfig.monthlyWorkingDaysCount, monthlyWillieSalesEntries, monthlyUploadedSalesEntries, uploadedWillieSalesEntries]);

  // Overall Branch Totals (Supervisor aggregate)
  const branchTotals = useMemo(() => {
    const workingDaysCount = globalConfig.monthlyWorkingDaysCount || 26;
    let familySalesWeight = 0;
    let monthlyFamilySalesWeight = 0;
    let familyDailyTarget = 0;
    let familyMonthlyTarget = 0;
    let familyCoveredShops = 0;
    let familyTargetShops = 0;

    let smallSalesWeight = 0;
    let monthlySmallSalesWeight = 0;
    let smallDailyTarget = 0;
    let smallMonthlyTarget = 0;
    let smallCoveredShops = 0;
    let smallTargetShops = 0;

    let willieOval100gSalesWeight = 0;
    let monthlyWillieOval100gSalesWeight = 0;
    let willieOval100gWeightTarget = 0;
    let willieOval100gMonthlyTarget = 0;
    let willieOval100gCoveredShops = 0;
    let willieOval100gShopsTarget = 0;

    let willieOval200gSalesWeight = 0;
    let monthlyWillieOval200gSalesWeight = 0;
    let willieOval200gWeightTarget = 0;
    let willieOval200gMonthlyTarget = 0;
    let willieOval200gCoveredShops = 0;
    let willieOval200gShopsTarget = 0;

    let willieOvalLight200gSalesWeight = 0;
    let monthlyWillieOvalLight200gSalesWeight = 0;
    let willieOvalLight200gWeightTarget = 0;
    let willieOvalLight200gMonthlyTarget = 0;
    let willieOvalLight200gCoveredShops = 0;
    let willieOvalLight200gShopsTarget = 0;

    delegatesAnalysis.forEach((d) => {
      familySalesWeight += d.familySalesWeight;
      monthlyFamilySalesWeight += d.monthlyFamilySalesWeight;
      familyDailyTarget += d.familyDailyTarget;
      familyMonthlyTarget += d.familyMonthlyTarget;
      familyCoveredShops += d.familyCoveredShops;
      familyTargetShops += d.familyTargetShops;

      smallSalesWeight += d.smallSalesWeight;
      monthlySmallSalesWeight += d.monthlySmallSalesWeight;
      smallDailyTarget += d.smallDailyTarget;
      smallMonthlyTarget += d.smallMonthlyTarget;
      smallCoveredShops += d.smallCoveredShops;
      smallTargetShops += d.smallTargetShops;

      willieOval100gSalesWeight += d.willieOval100gSalesWeight;
      monthlyWillieOval100gSalesWeight += d.monthlyWillieOval100gSalesWeight;
      willieOval100gWeightTarget += d.willieOval100gWeightTarget;
      willieOval100gMonthlyTarget += d.willieOval100gMonthlyTarget;
      willieOval100gCoveredShops += d.willieOval100gCoveredShops;
      willieOval100gShopsTarget += d.willieOval100gShopsTarget;

      willieOval200gSalesWeight += d.willieOval200gSalesWeight;
      monthlyWillieOval200gSalesWeight += d.monthlyWillieOval200gSalesWeight;
      willieOval200gWeightTarget += d.willieOval200gWeightTarget;
      willieOval200gMonthlyTarget += d.willieOval200gMonthlyTarget;
      willieOval200gCoveredShops += d.willieOval200gCoveredShops;
      willieOval200gShopsTarget += d.willieOval200gShopsTarget;

      willieOvalLight200gSalesWeight += d.willieOvalLight200gSalesWeight;
      monthlyWillieOvalLight200gSalesWeight += d.monthlyWillieOvalLight200gSalesWeight;
      willieOvalLight200gWeightTarget += d.willieOvalLight200gWeightTarget;
      willieOvalLight200gMonthlyTarget += d.willieOvalLight200gMonthlyTarget;
      willieOvalLight200gCoveredShops += d.willieOvalLight200gCoveredShops;
      willieOvalLight200gShopsTarget += d.willieOvalLight200gShopsTarget;
    });

    const familyWeightPct = familyMonthlyTarget > 0 ? (monthlyFamilySalesWeight / familyMonthlyTarget) * 100 : 0;
    const familyDailyWeightPct = familyDailyTarget > 0 ? (familySalesWeight / familyDailyTarget) * 100 : 0;
    const familyCoveragePct = familyTargetShops > 0 ? (familyCoveredShops / familyTargetShops) * 100 : 0;

    const smallWeightPct = smallMonthlyTarget > 0 ? (monthlySmallSalesWeight / smallMonthlyTarget) * 100 : 0;
    const smallDailyWeightPct = smallDailyTarget > 0 ? (smallSalesWeight / smallDailyTarget) * 100 : 0;
    const smallCoveragePct = smallTargetShops > 0 ? (smallCoveredShops / smallTargetShops) * 100 : 0;

    const willieOval100gWeightPct = willieOval100gMonthlyTarget > 0 ? (monthlyWillieOval100gSalesWeight / willieOval100gMonthlyTarget) * 100 : 0;
    const willieOval100gDailyWeightPct = willieOval100gWeightTarget > 0 ? (willieOval100gSalesWeight / willieOval100gWeightTarget) * 100 : 0;
    const willieOval100gCoveragePct = willieOval100gShopsTarget > 0 ? (willieOval100gCoveredShops / willieOval100gShopsTarget) * 100 : 0;

    const willieOval200gWeightPct = willieOval200gMonthlyTarget > 0 ? (monthlyWillieOval200gSalesWeight / willieOval200gMonthlyTarget) * 100 : 0;
    const willieOval200gDailyWeightPct = willieOval200gWeightTarget > 0 ? (willieOval200gSalesWeight / willieOval200gWeightTarget) * 100 : 0;
    const willieOval200gCoveragePct = willieOval200gShopsTarget > 0 ? (willieOval200gCoveredShops / willieOval200gShopsTarget) * 100 : 0;

    const willieOvalLight200gWeightPct = willieOvalLight200gMonthlyTarget > 0 ? (monthlyWillieOvalLight200gSalesWeight / willieOvalLight200gMonthlyTarget) * 100 : 0;
    const willieOvalLight200gDailyWeightPct = willieOvalLight200gWeightTarget > 0 ? (willieOvalLight200gSalesWeight / willieOvalLight200gWeightTarget) * 100 : 0;
    const willieOvalLight200gCoveragePct = willieOvalLight200gShopsTarget > 0 ? (willieOvalLight200gCoveredShops / willieOvalLight200gShopsTarget) * 100 : 0;

    const totalWillieSalesWeight = willieOval100gSalesWeight + willieOval200gSalesWeight + willieOvalLight200gSalesWeight;
    const totalMonthlyWillieSalesWeight = monthlyWillieOval100gSalesWeight + monthlyWillieOval200gSalesWeight + monthlyWillieOvalLight200gSalesWeight;
    const totalWillieTargetWeight = willieOval100gWeightTarget + willieOval200gWeightTarget + willieOvalLight200gWeightTarget;
    const totalWillieMonthlyTarget = totalWillieTargetWeight * workingDaysCount;

    const totalAchievedWeight = familySalesWeight + smallSalesWeight + totalWillieSalesWeight;
    const totalMonthlyAchievedWeight = monthlyFamilySalesWeight + monthlySmallSalesWeight + totalMonthlyWillieSalesWeight;
    const totalTargetWeight = familyDailyTarget + smallDailyTarget + totalWillieTargetWeight;
    const totalMonthlyTargetWeight = totalTargetWeight * workingDaysCount;
    const totalWeightPct = totalMonthlyTargetWeight > 0 ? (totalMonthlyAchievedWeight / totalMonthlyTargetWeight) * 100 : 0;

    return {
      delegateName: 'إجمالي المشرف (كافة المندوبين)',
      workingDaysCount,
      familySalesWeight,
      monthlyFamilySalesWeight,
      familyDailyTarget,
      familyMonthlyTarget,
      familyWeightPct,
      familyDailyWeightPct,
      familyCoveredShops,
      familyTargetShops,
      familyCoveragePct,

      smallSalesWeight,
      monthlySmallSalesWeight,
      smallDailyTarget,
      smallMonthlyTarget,
      smallWeightPct,
      smallDailyWeightPct,
      smallCoveredShops,
      smallTargetShops,
      smallCoveragePct,

      willieOval100gSalesWeight,
      monthlyWillieOval100gSalesWeight,
      willieOval100gWeightTarget,
      willieOval100gMonthlyTarget,
      willieOval100gWeightPct,
      willieOval100gDailyWeightPct,
      willieOval100gCoveredShops,
      willieOval100gShopsTarget,
      willieOval100gCoveragePct,

      willieOval200gSalesWeight,
      monthlyWillieOval200gSalesWeight,
      willieOval200gWeightTarget,
      willieOval200gMonthlyTarget,
      willieOval200gWeightPct,
      willieOval200gDailyWeightPct,
      willieOval200gCoveredShops,
      willieOval200gShopsTarget,
      willieOval200gCoveragePct,

      willieOvalLight200gSalesWeight,
      monthlyWillieOvalLight200gSalesWeight,
      willieOvalLight200gWeightTarget,
      willieOvalLight200gMonthlyTarget,
      willieOvalLight200gWeightPct,
      willieOvalLight200gDailyWeightPct,
      willieOvalLight200gCoveredShops,
      willieOvalLight200gShopsTarget,
      willieOvalLight200gCoveragePct,

      totalAchievedWeight,
      totalMonthlyAchievedWeight,
      totalTargetWeight,
      totalMonthlyTargetWeight,
      totalWillieSalesWeight,
      totalMonthlyWillieSalesWeight,
      totalWillieDailyTarget: totalWillieTargetWeight,
      totalWillieMonthlyTarget,
      totalWeightPct,
    };
  }, [delegatesAnalysis, globalConfig.monthlyWorkingDaysCount]);

  // Current active delegate data
  const currentDelegateData = useMemo(() => {
    if (activeDelegate === '__SUPERVISOR__' || viewMode === 'all') {
      return delegatesAnalysis[0] || null;
    }
    return (
      delegatesAnalysis.find(
        (d) => normalizeArabic(d.delegateName) === normalizeArabic(activeDelegate)
      ) || delegatesAnalysis[0]
    );
  }, [activeDelegate, viewMode, delegatesAnalysis]);

  // Filtered shops list for single delegate view
  const filteredShops = useMemo(() => {
    if (!currentDelegateData) return [];
    let list = currentDelegateData.shops;

    if (shopSearchTerm.trim()) {
      const q = normalizeArabic(shopSearchTerm);
      list = list.filter(
        (s) =>
          normalizeArabic(s.customerName).includes(q) ||
          normalizeArabic(s.customerCode).includes(q)
      );
    }

    if (coverageFilter === 'covered') {
      list = list.filter((s) => s.isFamilyCovered || s.isSmallCovered);
    } else if (coverageFilter === 'unmet') {
      list = list.filter(
        (s) => (!s.isFamilyCovered && s.familyWeight > 0) || (!s.isSmallCovered && s.smallWeight > 0)
      );
    } else if (coverageFilter === 'neither') {
      list = list.filter((s) => !s.isFamilyCovered && !s.isSmallCovered);
    }

    return list;
  }, [currentDelegateData, shopSearchTerm, coverageFilter]);

  // Save targets modal
  const handleOpenConfigModal = (delName?: string, categoryTab: 'milk' | 'willie' = 'milk') => {
    const targetName = delName || (activeDelegate !== '__SUPERVISOR__' ? activeDelegate : 'all');
    setEditDelegateName(targetName);
    setConfigModalTab(categoryTab);

    if (targetName === 'all') {
      setEditFamilyWeightTarget(40);
      setEditFamilyShopsTarget(15);
      setEditFamilyMinWeight(globalConfig.defaultFamilyMinWeightPerShopKg || 2);
      setEditSmallWeightTarget(15);
      setEditSmallShopsTarget(15);
      setEditSmallMinWeight(globalConfig.defaultSmallMinWeightPerShopKg || 1);
      setEditWillieOval100gWeightTarget(7);
      setEditWillieOval100gShopsTarget(10);
      setEditWillieOval200gWeightTarget(7);
      setEditWillieOval200gShopsTarget(10);
      setEditWillieOvalLight200gWeightTarget(6);
      setEditWillieOvalLight200gShopsTarget(10);
      setEditWillieMinWeightInvoice(1.2);
      setEditWillieMinWeightMonth(4);
    } else {
      const cfg = getDelegateConfig(targetName);
      setEditFamilyWeightTarget(cfg.familyMonthlyWeightTargetKg);
      setEditFamilyShopsTarget(cfg.familyTargetShopsCount);
      setEditFamilyMinWeight(cfg.familyMinWeightPerShopKg);
      setEditSmallWeightTarget(cfg.smallMonthlyWeightTargetKg);
      setEditSmallShopsTarget(cfg.smallTargetShopsCount);
      setEditSmallMinWeight(cfg.smallMinWeightPerShopKg);
      setEditWillieOval100gWeightTarget(cfg.willieOval100gMonthlyWeightTarget ?? 182);
      setEditWillieOval100gShopsTarget(cfg.willieOval100gShopsTarget ?? 10);
      setEditWillieOval200gWeightTarget(cfg.willieOval200gMonthlyWeightTarget ?? 182);
      setEditWillieOval200gShopsTarget(cfg.willieOval200gShopsTarget ?? 10);
      setEditWillieOvalLight200gWeightTarget(cfg.willieOvalLight200gMonthlyWeightTarget ?? 156);
      setEditWillieOvalLight200gShopsTarget(cfg.willieOvalLight200gShopsTarget ?? 10);
      setEditWillieMinWeightInvoice(cfg.willieMinWeightPerInvoiceKg ?? 1.2);
      setEditWillieMinWeightMonth(cfg.willieMinWeightPerCustomerMonthKg ?? 4);
    }

    setShowConfigModal(true);
  };

  const handleSaveTargets = async () => {
    try {
      setIsSavingTargets(true);
      const batch = writeBatch(db);

      const targetsToSave: AdditionalTargetDelegateConfig = {
        delegateName: editDelegateName,
        familyMonthlyWeightTargetKg: Number(editFamilyWeightTarget) || 0,
        familyTargetShopsCount: Number(editFamilyShopsTarget) || 0,
        familyMinWeightPerShopKg: Number(editFamilyMinWeight) || 2,
        smallMonthlyWeightTargetKg: Number(editSmallWeightTarget) || 0,
        smallTargetShopsCount: Number(editSmallShopsTarget) || 0,
        smallMinWeightPerShopKg: Number(editSmallMinWeight) || 1,
        willieOval100gMonthlyWeightTarget: Number(editWillieOval100gWeightTarget) || 182,
        willieOval100gShopsTarget: Number(editWillieOval100gShopsTarget) || 10,
        willieOval200gMonthlyWeightTarget: Number(editWillieOval200gWeightTarget) || 182,
        willieOval200gShopsTarget: Number(editWillieOval200gShopsTarget) || 10,
        willieOvalLight200gMonthlyWeightTarget: Number(editWillieOvalLight200gWeightTarget) || 156,
        willieOvalLight200gShopsTarget: Number(editWillieOvalLight200gShopsTarget) || 10,
        willieMinWeightPerInvoiceKg: Number(editWillieMinWeightInvoice) || 1.2,
        willieMinWeightPerCustomerMonthKg: Number(editWillieMinWeightMonth) || 4,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || 'الأدمن',
      };


      if (editDelegateName === 'all') {
        // Apply to all active delegates
        activeDelegates.forEach((del) => {
          const docId = `del_${del}`.replace(/[\/\s#$[\]]/g, '_');
          const docRef = doc(db, 'additional_targets_delegates', docId);
          batch.set(
            docRef,
            {
              ...targetsToSave,
              delegateName: del,
            },
            { merge: true }
          );
        });

        // Also update global default config
        const globalRef = doc(db, 'app_settings', 'additional_targets_config');
        batch.set(
          globalRef,
          {
            defaultFamilyMinWeightPerShopKg: Number(editFamilyMinWeight) || 2,
            defaultSmallMinWeightPerShopKg: Number(editSmallMinWeight) || 1,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser?.name || 'الأدمن',
          },
          { merge: true }
        );
      } else {
        const docId = `del_${editDelegateName}`.replace(/[\/\s#$[\]]/g, '_');
        const docRef = doc(db, 'additional_targets_delegates', docId);
        batch.set(docRef, targetsToSave, { merge: true });
      }

      await batch.commit();

      setShowConfigModal(false);
      setUserMessage('تم حفظ وتحديث الأهداف وشروط التغطية بنجاح 🎯✅');
    } catch (err: any) {
      console.error('Error saving additional targets config:', err);
      setUserMessage('حدث خطأ أثناء حفظ الأهداف');
    } finally {
      setIsSavingTargets(false);
    }
  };

  // Excel Import for Product/Customer Targets & Sales
  const handleExcelUpload = (file: File, type: 'milk' | 'milkFamily' | 'milkSmall' | 'willie' | 'willie100g' | 'willie200g' | 'willieLight200g' = 'milk') => {
    setIsParsingExcel(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      // Use setTimeout to allow the UI to show the parsing loader
      setTimeout(() => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });

      const delegateConfigsMap = new Map<string, AdditionalTargetDelegateConfig>();
      const parsedTargets: ProductCustomerTarget[] = [];
      const parsedSales: UploadedSalesEntry[] = [];
      const parsedWillieSales: UploadedWillieSalesEntry[] = [];
      let globalRowIndex = 0;

      // Canonical delegate name resolver
      const resolveDelegateFullName = (name: any): string => {
        if (!name) return '';
        const str = String(name).trim();
        const norm = cleanHeaderKey(str);

        if (norm.includes('بكر') || str === '60042244' || str.toLowerCase() === 'bkrkala' || norm.includes('مندوب4')) return 'بكر بدران';
        if (norm.includes('فيصل') || str === '60042245' || str.toLowerCase() === 'fslkala' || norm.includes('مندوب5')) return 'فيصل فؤاد';
        if (norm.includes('خلدون') || str === '60032667' || str.toLowerCase() === 'kldkala' || norm.includes('مندوب2')) return 'خلدون جمال';
        if (norm.includes('محمد') || str === '60037329' || str.toLowerCase() === 'mohkala' || norm.includes('مندوب3')) return 'محمد جاسم';
        if (norm.includes('ناجي') || str === '60037899' || str.toLowerCase() === 'najikala' || norm.includes('مندوب1')) return 'ناجي خلف';
        if (norm.includes('صباح') || str === '60041445' || str.toLowerCase() === 'sbhkala' || norm.includes('مندوب6')) return 'صباح فرحان';

        return str;
      };

      // Header cleaning helper: removes all spaces, symbols, dashes, underscores, etc.
      const cleanHeaderKey = (s: string) =>
        String(s || '')
          .toLowerCase()
          .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
          .replace(/[\u064B-\u065F\u0670]/g, '')
          .replace(/[أإآٱ]/g, 'ا')
          .replace(/ة/g, 'ه')
          .replace(/[يى]/g, 'ي')
          .replace(/ـ/g, '')
          .replace(/[\s_\-\.\/\\():]/g, '');

      // Helper function to extract cell value case-insensitively and space-insensitively
      const getVal = (row: any, ...keys: string[]) => {
        if (!row) return undefined;
        const rowKeys = Object.keys(row);
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
          const targetClean = cleanHeaderKey(k);
          const foundKey = rowKeys.find((rk) => cleanHeaderKey(rk) === targetClean);
          if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
            return row[foundKey];
          }
        }
        return undefined;
      };

      // Process each sheet in the workbook
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        jsonData.forEach((row: any) => {
          globalRowIndex++;

          const delNameRaw = getVal(
            row,
            'DelegateName',
            'delegateName',
            'Delegate Name',
            'المندوب',
            'اسم المندوب',
            'مندوب',
            'اسم_المندوب',
            'مندوب المبيعات',
            'اسم مندوب المبيعات',
            'Delegate',
            'Rep',
            'Representative',
            'اسم المندوب:'
          );

          if (!delNameRaw) return;
          const delName = resolveDelegateFullName(delNameRaw);

          // Excel upload is dedicated purely to sales entries (Targets are set manually via UI buttons)

          // 2. Process Specific Customer/Product Targets
          const custCodeRaw = getVal(row, 'CustomerCode', 'customerCode', 'كود العميل', 'كود المحل', 'رمز العميل', 'رمز المحل', 'كود', 'الرمز', 'Customer Code', 'Customer_Code');
          const custNameRaw = getVal(row, 'CustomerName', 'customerName', 'اسم العميل', 'اسم المحل', 'اسم الزبون', 'اسم_العميل', 'اسم_المحل', 'المحل', 'العميل', 'الزبون', 'Customer Name', 'Customer_Name');
          const custCode = String(custCodeRaw || custNameRaw || `SHOP_${globalRowIndex}`);
          const custName = String(custNameRaw || custCodeRaw || 'محل عام');

          const prodCodeRaw = getVal(row, 'ProductCode', 'productCode', 'كود المنتج', 'رمز المنتج', 'كود المادة', 'Product Code', 'ItemCode', 'Item Code');
          const prodNameRaw = getVal(row, 'ProductName', 'productName', 'اسم المنتج', 'المنتج', 'اسم المادة', 'المادة', 'Product Name', 'ItemName', 'Item Name');
          const pCode = String(prodCodeRaw || '');
          const pName = String(prodNameRaw || '');

          const targetWeight = getVal(row, 'TargetWeightKg', 'targetWeightKg', 'الهدف كغم', 'الهدف');

          if ((custCodeRaw || custNameRaw) && (prodCodeRaw || prodNameRaw) && targetWeight !== undefined) {
            parsedTargets.push({
              id: `${normalizeArabic(delName)}_${normalizeArabic(custCode)}_${normalizeArabic(pCode || pName)}`,
              delegateName: String(delName),
              customerCode: custCode,
              customerName: custName,
              productCode: pCode,
              productName: pName,
              targetWeightKg: Number(targetWeight || 0),
            });
          }

          // 3. Process Sales Weight / Quantities
          const rowWeightVal = getVal(
            row,
            'salesWeightKg',
            'SalesWeightKg',
            'sales_weight_kg',
            'Net Weight',
            'NetWeight',
            'TargetWeightKg',
            'Weight',
            'WeightKg',
            'salesWeight',
            'وزن المبيعات',
            'الوزن',
            'وزن',
            'الوزن كغم',
            'الوزن (كغم)',
            'صافي الوزن',
            'الوزن الكلي',
            'وزن المبيعات (كغم)',
            'الكمية (كغم)',
            'الكمية كغم'
          );

          const quantityVal = Number(
            getVal(row, 'Quantity', 'quantity', 'الكمية', 'العدد', 'عدد الكارتون', 'عدد القطع', 'Qty') || 0
          );

          let rowWeight = Number(rowWeightVal) || 0;
          const catName = String(getVal(row, 'CategoryName', 'categoryName', 'الصنف', 'فئة المنتج') || '');

          // Fallback: If weight is missing but quantity exists, calculate weight
          if (!rowWeight && quantityVal > 0) {
            let pieceW = 0.1;
            if (type === 'willie200g' || type === 'willieLight200g') {
              pieceW = 0.2;
            } else if (type === 'willie100g') {
              pieceW = 0.1;
            } else if (type === 'milkFamily') {
              pieceW = 1.0;
            } else if (type === 'milkSmall') {
              pieceW = 0.2;
            } else {
              let { type: wType } = classifyWillieProduct({ productName: pName, categoryName: catName, productCode: pCode });
              pieceW = wType === 'oval100g' ? 0.1 : 0.2;
            }
            rowWeight = quantityVal * pieceW;
          }

          if ((custCodeRaw || custNameRaw || pCode || pName) && (rowWeight > 0 || quantityVal > 0)) {
            if (type.startsWith('willie')) {
              let willieType: 'oval100g' | 'oval200g' | 'ovalLight200g' = 'oval100g';
              if (type === 'willie100g') {
                willieType = 'oval100g';
              } else if (type === 'willie200g') {
                willieType = 'oval200g';
              } else if (type === 'willieLight200g') {
                willieType = 'ovalLight200g';
              } else {
                const res = classifyWillieProduct({ productName: pName, categoryName: catName, productCode: pCode });
                willieType = res.type || 'oval100g';
              }

              const finalPCode = pCode || (willieType === 'oval100g' ? 'WILLIE-100' : willieType === 'oval200g' ? 'WILLIE-200' : 'WILLIE-200L');
              const finalPName =
                pName ||
                (willieType === 'oval100g'
                  ? 'ويلي بيضوي 100 غم'
                  : willieType === 'oval200g'
                  ? 'ويلي بيضوي 200 غم'
                  : 'ويلي بيضوي لايت 200 غم');

              const pieceWeight = willieType === 'oval100g' ? 0.1 : 0.2;

              parsedWillieSales.push({
                id: `willie_${activeDate}_${normalizeArabic(delName)}_${normalizeArabic(custCode)}_${normalizeArabic(finalPCode)}_${globalRowIndex}`,
                delegateName: String(delName),
                customerCode: custCode,
                customerName: custName,
                productCode: finalPCode,
                productName: finalPName,
                quantity: quantityVal || Math.max(1, Math.round(rowWeight / pieceWeight)),
                totalWeightKg: rowWeight,
                dateString: activeDate,
                monthString: activeDate.substring(0, 7), // YYYY-MM
                uploadedAt: new Date().toISOString(),
              });
            } else {
              let adjustedPName = pName;
              let adjustedCatName = catName;
              const finalPCode = pCode || (type === 'milkFamily' ? 'MILK-FAM' : type === 'milkSmall' ? 'MILK-SML' : '');

              if (type === 'milkFamily') {
                adjustedPName = pName ? `${pName} (حليب بطل كبير 1 لتر)` : 'حليب بطل كبير 1 لتر ESL Family';
                adjustedCatName = catName ? `${catName} (حليب بطل كبير ESL)` : 'حليب بطل كبير ESL';
              } else if (type === 'milkSmall') {
                adjustedPName = pName ? `${pName} (حليب بطل صغير 200مل)` : 'حليب بطل صغير 200مل ESL Small';
                adjustedCatName = catName ? `${catName} (حليب بطل صغير ESL)` : 'حليب بطل صغير ESL';
              }

              parsedSales.push({
                id: `sale_${activeDate}_${normalizeArabic(delName)}_${normalizeArabic(custCode)}_${normalizeArabic(finalPCode || globalRowIndex.toString())}_${globalRowIndex}`,
                delegateName: String(delName),
                customerCode: custCode,
                customerName: custName,
                productCode: finalPCode,
                productName: adjustedPName,
                categoryName: adjustedCatName,
                quantity: quantityVal || 1,
                totalWeightKg: rowWeight,
                dateString: activeDate,
                monthString: activeDate.substring(0, 7),
                uploadedAt: new Date().toISOString(),
              });
            }
          }
        });
      });

      // Filter by type
      const finalDelegateConfigs = Array.from(delegateConfigsMap.values());
      const finalTargets = parsedTargets;
      const isMilk = type === 'milk' || type === 'milkFamily' || type === 'milkSmall';
      const isWillie = type === 'willie' || type === 'willie100g' || type === 'willie200g' || type === 'willieLight200g';
      const finalSales = isMilk ? parsedSales : [];
      const finalWillieSales = isWillie ? parsedWillieSales : [];

          setPendingUploadData({
            delegateConfigs: finalDelegateConfigs,
            targets: finalTargets,
            sales: finalSales,
            willieSales: finalWillieSales,
            uploadType: type,
          });
          setIsParsingExcel(false);
          setShowUploadConfirm(true);
        } catch (err) {
          console.error('Error parsing excel:', err);
          setIsParsingExcel(false);
          setUserMessage('حدث خطأ أثناء تحليل بيانات ملف الإكسل');
        }
      }, 100);
    };
    reader.onerror = () => {
      setIsParsingExcel(false);
      setUserMessage('حدث خطأ أثناء قراءة ملف الإكسل');
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadMilkTemplate = () => {
    const headers = [
      'DelegateName',
      'FamilyWeightTarget',
      'FamilyShopsTarget',
      'FamilyMinWeight',
      'SmallWeightTarget',
      'SmallShopsTarget',
      'SmallMinWeight',
      'CustomerCode',
      'CustomerName',
      'ProductCode',
      'ProductName',
      'TargetWeightKg',
      'Quantity',
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template_Milk');
    XLSX.writeFile(workbook, 'نموذج_استيراد_أهداف_الحليب.xlsx');
  };

  const downloadMilkFamilyTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];
    const headers = [
      'DelegateName',
      'FamilyWeightTarget',
      'FamilyShopsTarget',
      'FamilyMinWeight',
      'CustomerCode',
      'CustomerName',
      'ProductCode',
      'ProductName',
      'salesWeightKg',
      'Quantity',
    ];
    const rows = [
      headers,
      [sampleDelegates[0] || 'بكر بدران', 40, 15, 2, '1001', 'أسواق الهدى', 'MILK-FAM-1L', 'حليب بطل كبير سادة 1 لتر', 12, 12],
      [sampleDelegates[1] || 'فيصل فؤاد', 40, 15, 2, '1002', 'ماركت الصفا', 'MILK-FAM-CHOC', 'حليب بطل كبير كاكاو 1 لتر', 24, 24],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'حليب_بطل_كبير');
    XLSX.writeFile(workbook, 'نموذج_استيراد_حليب_بطل_كبير.xlsx');
    setUserMessage('تم تنزيل نموذج إكسل حليب بطل كبير بنجاح 📥🥛');
  };

  const downloadMilkSmallTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];
    const headers = [
      'DelegateName',
      'SmallWeightTarget',
      'SmallShopsTarget',
      'SmallMinWeight',
      'CustomerCode',
      'CustomerName',
      'ProductCode',
      'ProductName',
      'salesWeightKg',
      'Quantity',
    ];
    const rows = [
      headers,
      [sampleDelegates[0] || 'بكر بدران', 15, 15, 1, '1001', 'أسواق الهدى', 'MILK-SM-STRAW', 'حليب بطل صغير فراولة 200مل', 5, 25],
      [sampleDelegates[1] || 'فيصل فؤاد', 15, 15, 1, '1002', 'ماركت الصفا', 'MILK-SM-BANANA', 'حليب بطل صغير موز 200مل', 6, 30],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'حليب_بطل_صغير');
    XLSX.writeFile(workbook, 'نموذج_استيراد_حليب_بطل_صغير.xlsx');
    setUserMessage('تم تنزيل نموذج إكسل حليب بطل صغير بنجاح 📥🍼');
  };

  const downloadWillie100gTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];
    const headers = [ 'DelegateName', 'Willie100WeightTarget', 'Willie100ShopsTarget', 'Willie100MinWeightInvoice', 'Willie100MinWeightMonth', 'CustomerCode', 'CustomerName', 'ProductCode', 'ProductName', 'salesWeightKg', 'Quantity' ];
    const rows = [ headers, [sampleDelegates[0] || 'بكر بدران', 7, 10, 1.2, 4, '1001', 'أسواق الهدى', 'WILLIE-100', 'ويلي بيضوي 100 غم', 2.4, 24] ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ويلي_100_غم');
    XLSX.writeFile(workbook, 'نموذج_استيراد_ويلي_100غم.xlsx');
    setUserMessage('تم تنزيل نموذج إكسل ويلي 100 غم بنجاح 📥🧀');
  };

  const downloadWillie200gTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];
    const headers = [ 'DelegateName', 'Willie200WeightTarget', 'Willie200ShopsTarget', 'Willie200MinWeightInvoice', 'Willie200MinWeightMonth', 'CustomerCode', 'CustomerName', 'ProductCode', 'ProductName', 'salesWeightKg', 'Quantity' ];
    const rows = [ headers, [sampleDelegates[0] || 'بكر بدران', 7, 10, 1.2, 4, '1001', 'أسواق الهدى', 'WILLIE-200', 'ويلي بيضوي 200 غم', 2.4, 12] ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ويلي_200_غم');
    XLSX.writeFile(workbook, 'نموذج_استيراد_ويلي_200غم.xlsx');
    setUserMessage('تم تنزيل نموذج إكسل ويلي 200 غم بنجاح 📥🧀');
  };

  const downloadWillieLight200gTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];
    const headers = [ 'DelegateName', 'Willie200lightWeightTarget', 'Willie200lightShopsTarget', 'Willie200lightMinWeightInvoice', 'Willie200lightMinWeightMonth', 'CustomerCode', 'CustomerName', 'ProductCode', 'ProductName', 'salesWeightKg', 'Quantity' ];
    const rows = [ headers, [sampleDelegates[0] || 'بكر بدران', 6, 10, 1.2, 4, '1001', 'أسواق الهدى', 'WILLIE-200L', 'ويلي بيضوي لايت 200 غم', 2.4, 12] ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ويلي_لايت_200_غم');
    XLSX.writeFile(workbook, 'نموذج_استيراد_ويلي_لايت_200غم.xlsx');
    setUserMessage('تم تنزيل نموذج إكسل ويلي لايت 200 غم بنجاح 📥🧀');
  };

  const downloadWillieTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const sampleDelegates =
      activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];

    // 1. Comprehensive Sheet containing all 3 Willie products
    const allHeaders = [
      'DelegateName',
      'Willie100WeightTarget',
      'Willie100ShopsTarget',
      'Willie100MinWeightInvoice',
      'Willie100MinWeightMonth',
      'Willie200WeightTarget',
      'Willie200ShopsTarget',
      'Willie200MinWeightInvoice',
      'Willie200MinWeightMonth',
      'Willie200lightWeightTarget',
      'Willie200lightShopsTarget',
      'Willie200lightMinWeightInvoice',
      'Willie200lightMinWeightMonth',
      'CustomerCode',
      'CustomerName',
      'ProductCode',
      'ProductName',
      'salesWeightKg',
      'Quantity',
    ];
    const allRows = [
      allHeaders,
      [
        sampleDelegates[0] || 'بكر بدران',
        7,
        10,
        1.2,
        4,
        7,
        10,
        1.2,
        4,
        6,
        10,
        1.2,
        4,
        '1001',
        'أسواق الهدى',
        'WILLIE-100',
        'ويلي بيضوي 100 غم',
        2.4,
        24,
      ],
      [
        sampleDelegates[1] || 'فيصل فؤاد',
        7,
        10,
        1.2,
        4,
        7,
        10,
        1.2,
        4,
        6,
        10,
        1.2,
        4,
        '1002',
        'ماركت الصفا',
        'WILLIE-200',
        'ويلي بيضوي 200 غم',
        3.6,
        18,
      ],
    ];
    const wsAll = XLSX.utils.aoa_to_sheet(allRows);
    XLSX.utils.book_append_sheet(workbook, wsAll, 'الويلي_شامل_3_منتجات');

    // 2. Willie 100g Sheet (Matching Table 1 from user image)
    const w100Headers = [
      'DelegateName',
      'Willie100WeightTarget',
      'Willie100ShopsTarget',
      'Willie100MinWeightInvoice',
      'Willie100MinWeightMonth',
      'CustomerCode',
      'CustomerName',
      'ProductCode',
      'ProductName',
      'salesWeightKg',
      'Quantity',
    ];
    const w100Rows = [
      w100Headers,
      [sampleDelegates[0] || 'بكر بدران', 7, 10, 1.2, 4, '1001', 'أسواق الهدى', 'WILLIE-100', 'ويلي بيضوي 100 غم', 2.4, 24],
      [sampleDelegates[1] || 'فيصل فؤاد', 7, 10, 1.2, 4, '1002', 'ماركت الصفا', 'WILLIE-100', 'ويلي بيضوي 100 غم', 3.6, 36],
    ];
    const ws100 = XLSX.utils.aoa_to_sheet(w100Rows);
    XLSX.utils.book_append_sheet(workbook, ws100, 'ويلي_100_غم');

    // 3. Willie 200g Sheet (Matching Table 2 from user image)
    const w200Headers = [
      'DelegateName',
      'Willie200WeightTarget',
      'Willie200ShopsTarget',
      'Willie200MinWeightInvoice',
      'Willie200MinWeightMonth',
      'CustomerCode',
      'CustomerName',
      'ProductCode',
      'ProductName',
      'salesWeightKg',
      'Quantity',
    ];
    const w200Rows = [
      w200Headers,
      [sampleDelegates[0] || 'بكر بدران', 7, 10, 1.2, 4, '1001', 'أسواق الهدى', 'WILLIE-200', 'ويلي بيضوي 200 غم', 2.4, 12],
      [sampleDelegates[1] || 'فيصل فؤاد', 7, 10, 1.2, 4, '1002', 'ماركت الصفا', 'WILLIE-200', 'ويلي بيضوي 200 غم', 4.8, 24],
    ];
    const ws200 = XLSX.utils.aoa_to_sheet(w200Rows);
    XLSX.utils.book_append_sheet(workbook, ws200, 'ويلي_200_غم');

    // 4. Willie 200g Light Sheet (Matching Table 3 from user image)
    const w200lightHeaders = [
      'DelegateName',
      'Willie200lightWeightTarget',
      'Willie200lightShopsTarget',
      'Willie200lightMinWeightInvoice',
      'Willie200lightMinWeightMonth',
      'CustomerCode',
      'CustomerName',
      'ProductCode',
      'ProductName',
      'salesWeightKg',
      'Quantity',
    ];
    const w200lightRows = [
      w200lightHeaders,
      [sampleDelegates[0] || 'بكر بدران', 6, 10, 1.2, 4, '1001', 'أسواق الهدى', 'WILLIE-200L', 'ويلي بيضوي لايت 200 غم', 2.4, 12],
      [sampleDelegates[1] || 'فيصل فؤاد', 6, 10, 1.2, 4, '1002', 'ماركت الصفا', 'WILLIE-200L', 'ويلي بيضوي لايت 200 غم', 2.4, 12],
    ];
    const ws200light = XLSX.utils.aoa_to_sheet(w200lightRows);
    XLSX.utils.book_append_sheet(workbook, ws200light, 'ويلي_200_غم_لايت');

    XLSX.writeFile(workbook, 'نموذج_استيراد_أهداف_الويلي.xlsx');
    setUserMessage('تم تنزيل نموذج إكسل المحدث لجبن ويلي (3 منتجات) بنجاح 📥🧀');
  };

  const saveParsedData = async (
    delegateConfigs: AdditionalTargetDelegateConfig[], 
    targets: ProductCustomerTarget[],
    sales: UploadedSalesEntry[],
    willieSales: UploadedWillieSalesEntry[] = [],
    type: 'milk' | 'milkFamily' | 'milkSmall' | 'willie' | 'willie100g' | 'willie200g' | 'willieLight200g' = 'milk'
  ) => {
    try {
      setIsSavingTargets(true);
      setUserMessage('جاري استبدال البيانات القديمة وحفظ الجديدة... 🔄');

      // Update local state immediately for instant UI reactivity
      if (delegateConfigs && delegateConfigs.length > 0) {
        setDelegateConfigs(prev => {
          const map = new Map(prev.map(c => [c.id || `del_${normalizeArabic(c.delegateName)}`, c]));
          delegateConfigs.forEach(c => {
            const key = c.id || `del_${normalizeArabic(c.delegateName)}`;
            map.set(key, { ...(map.get(key) || {}), ...c });
          });
          const list = Array.from(map.values());
          // Batch localStorage updates in next tick
          setTimeout(() => {
            try {
              localStorage.setItem('cache_additional_targets_delegates', JSON.stringify(list));
            } catch {}
          }, 0);
          return list;
        });
      }

      if (type.startsWith('willie')) {
        const targetWillieType = type === 'willie100g' ? 'oval100g' : type === 'willie200g' ? 'oval200g' : type === 'willieLight200g' ? 'ovalLight200g' : null;

        setUploadedWillieSalesEntries((prev) => {
          let updated = willieSales;
          if (targetWillieType) {
            const remaining = prev.filter((e) => classifyWillieProduct(e).type !== targetWillieType);
            updated = [...remaining, ...willieSales];
          }
          setTimeout(() => {
            try {
              localStorage.setItem('cache_additional_target_willie_uploaded_sales', JSON.stringify(updated));
            } catch {}
          }, 0);
          return updated;
        });

        setMonthlyWillieSalesEntries((prev) => {
          let updated = willieSales;
          if (targetWillieType) {
            const remaining = prev.filter((e) => classifyWillieProduct(e).type !== targetWillieType);
            updated = [...remaining, ...willieSales];
          }
          return updated;
        });
      } else {
        const targetMilkType = type === 'milkFamily' ? 'family' : type === 'milkSmall' ? 'small' : null;

        setUploadedSalesEntries((prev) => {
          let updated = sales;
          if (targetMilkType) {
            const remaining = prev.filter((e) => classifyEslProduct(e) !== targetMilkType);
            updated = [...remaining, ...sales];
          }
          setTimeout(() => {
            try {
              localStorage.setItem('cache_additional_target_uploaded_sales', JSON.stringify(updated));
            } catch {}
          }, 0);
          return updated;
        });

        setMonthlyUploadedSalesEntries((prev) => {
          let updated = sales;
          if (targetMilkType) {
            const remaining = prev.filter((e) => classifyEslProduct(e) !== targetMilkType);
            updated = [...remaining, ...sales];
          }
          return updated;
        });
      }

      // 1. Fetch existing sales for the active date to delete them (Replacement logic for specific table)
      let deletions: any[] = [];
      
      if (type.startsWith('milk')) {
        const existingSalesQuery = query(collection(db, 'additional_target_uploaded_sales'), where('dateString', '==', activeDate));
        const existingSalesSnap = await getDocs(existingSalesQuery);
        if (type === 'milk') {
          deletions = existingSalesSnap.docs.map(d => doc(db, 'additional_target_uploaded_sales', d.id));
        } else {
          const targetMilkType = type === 'milkFamily' ? 'family' : 'small';
          deletions = existingSalesSnap.docs
            .filter(d => classifyEslProduct(d.data()) === targetMilkType)
            .map(d => doc(db, 'additional_target_uploaded_sales', d.id));
        }
      } else {
        const existingWillieQuery = query(collection(db, 'additional_target_willie_uploaded_sales'), where('dateString', '==', activeDate));
        const existingWillieSnap = await getDocs(existingWillieQuery);
        if (type === 'willie') {
          deletions = existingWillieSnap.docs.map(d => doc(db, 'additional_target_willie_uploaded_sales', d.id));
        } else {
          const targetWillieType = type === 'willie100g' ? 'oval100g' : type === 'willie200g' ? 'oval200g' : 'ovalLight200g';
          deletions = existingWillieSnap.docs
            .filter(d => classifyWillieProduct(d.data()).type === targetWillieType)
            .map(d => doc(db, 'additional_target_willie_uploaded_sales', d.id));
        }
      }
      
      const allOps = [
        ...delegateConfigs.map(c => ({ ref: doc(db, 'additional_targets_delegates', c.id!), data: c, type: 'set' as const })),
        ...targets.map(t => ({ ref: doc(db, 'product_customer_targets', t.id), data: t, type: 'set' as const })),
        ...(type.startsWith('milk') ? sales.map(s => ({ ref: doc(db, 'additional_target_uploaded_sales', s.id), data: s, type: 'set' as const })) : []),
        ...(type.startsWith('willie') ? willieSales.map(ws => ({ ref: doc(db, 'additional_target_willie_uploaded_sales', ws.id), data: ws, type: 'set' as const })) : [])
      ];

      // Chunked Batching (max 500 per batch)
      const chunkSize = 450;
      
      // Handle deletions first or mixed (mixed is fine as long as count <= 500)
      const deleteOps = deletions.map(ref => ({ ref, type: 'delete' as const }));
      const totalOps = [...deleteOps, ...allOps];

      const batchPromises: Promise<void>[] = [];
      for (let i = 0; i < totalOps.length; i += chunkSize) {
        const batch = writeBatch(db);
        const chunk = totalOps.slice(i, i + chunkSize);
        chunk.forEach(op => {
          if (op.type === 'delete') {
            batch.delete(op.ref);
          } else {
            batch.set(op.ref, cleanFirestoreData(op.data), { merge: true });
          }
        });
        batchPromises.push(batch.commit());
      }
      
      await Promise.all(batchPromises);
      
      const targetTable = getTargetTableInfo(type);
      setUserMessage(`تم استبدال وتحديث قيم ${targetTable.tableName} بنجاح (${sales.length + willieSales.length} قيد) ✅`);
    } catch (err) {
      console.error('Error saving imported data:', err);
      setUserMessage('حدث خطأ أثناء استيراد البيانات');
    } finally {
      setIsSavingTargets(false);
    }
  };


  // WhatsApp Share helper
  const handleShareWhatsApp = () => {
    let text = `🎯 *تقرير الهدف الإضافي (حليب بطل ESL)*\n`;
    text += `📅 *التاريخ:* ${activeDate}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (viewMode === 'all') {
      text += `🏢 *إجمالي الفرع (كافة المندوبين):*\n`;
      text += `🥛 *حليب بطل كبير (ESL Family):*\n`;
      text += `   • وزن المبيعات: ${Math.round(branchTotals.familySalesWeight)} كغم من ${branchTotals.familyDailyTarget} كغم (${branchTotals.familyWeightPct.toFixed(0)}%)\n`;
      text += `   • تغطية المحلات: ${branchTotals.familyCoveredShops} محل من ${branchTotals.familyTargetShops} محل (${branchTotals.familyCoveragePct.toFixed(0)}%)\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🍼 *حليب بطل صغير (ESL Small):*\n`;
      text += `   • وزن المبيعات: ${Math.round(branchTotals.smallSalesWeight)} كغم من ${branchTotals.smallDailyTarget} كغم (${branchTotals.smallWeightPct.toFixed(0)}%)\n`;
      text += `   • تغطية المحلات: ${branchTotals.smallCoveredShops} محل من ${branchTotals.smallTargetShops} محل (${branchTotals.smallCoveragePct.toFixed(0)}%)\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🧀 *منتجات جبن ويلي الثلاثة (الفرع):*\n`;
      text += `   • ويلي 100 غم: ${Math.round(branchTotals.willieOval100gSalesWeight)} / ${branchTotals.willieOval100gWeightTarget} كغم\n`;
      text += `   • ويلي 200 غم: ${Math.round(branchTotals.willieOval200gSalesWeight)} / ${branchTotals.willieOval200gWeightTarget} كغم\n`;
      text += `   • ويلي لايت 200 غم: ${Math.round(branchTotals.willieOvalLight200gSalesWeight)} / ${branchTotals.willieOvalLight200gWeightTarget} كغم\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `*تفاصيل المندوبين:*\n`;

      delegatesAnalysis.forEach((d) => {
        text += `👤 *${d.delegateName}*:\n`;
        text += `   كبير: ${Math.round(d.familySalesWeight)} كغم (${Math.round(d.familyWeightPct)}%) | ${d.familyCoveredShops}/${d.familyTargetShops} محل\n`;
        text += `   صغير: ${Math.round(d.smallSalesWeight)} كغم (${Math.round(d.smallWeightPct)}%) | ${d.smallCoveredShops}/${d.smallTargetShops} محل\n`;
        text += `   ويلي 100غم: ${Math.round(d.willieOval100gSalesWeight)} | 200غم: ${Math.round(d.willieOval200gSalesWeight)} | لايت: ${Math.round(d.willieOvalLight200gSalesWeight)} كغم\n`;
      });
    } else if (currentDelegateData) {
      const d = currentDelegateData;
      text += `👤 *المندوب:* ${d.delegateName}\n`;
      text += `🥛 *حليب بطل كبير (ESL Family):*\n`;
      text += `   • وزن المبيعات: ${Math.round(d.familySalesWeight)} كغم من ${d.familyDailyTarget} كغم (${d.familyWeightPct.toFixed(0)}%)\n`;
      text += `   • تغطية المحلات (شرط ≥ ${d.familyMinWeightPerShop} كغم): ${d.familyCoveredShops} محل من ${d.familyTargetShops} محل (${d.familyCoveragePct.toFixed(0)}%)\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🍼 *حليب بطل صغير (ESL Small):*\n`;
      text += `   • وزن المبيعات: ${Math.round(d.smallSalesWeight)} كغم من ${d.smallDailyTarget} كغم (${d.smallWeightPct.toFixed(0)}%)\n`;
      text += `   • تغطية المحلات (شرط ≥ ${d.smallMinWeightPerShop} كغم): ${d.smallCoveredShops} محل من ${d.smallTargetShops} محل (${d.smallCoveragePct.toFixed(0)}%)\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🧀 *منتجات جبن ويلي الثلاثة:*\n`;
      text += `   • ويلي 100 غم: ${Math.round(d.willieOval100gSalesWeight)} كغم (هدف: ${d.willieOval100gWeightTarget}) | تغطية: ${d.willieOval100gCoveredShops}/${d.willieOval100gShopsTarget}\n`;
      text += `   • ويلي 200 غم: ${Math.round(d.willieOval200gSalesWeight)} كغم (هدف: ${d.willieOval200gWeightTarget}) | تغطية: ${d.willieOval200gCoveredShops}/${d.willieOval200gShopsTarget}\n`;
      text += `   • ويلي لايت 200 غم: ${Math.round(d.willieOvalLight200gSalesWeight)} كغم (هدف: ${d.willieOvalLight200gWeightTarget}) | تغطية: ${d.willieOvalLight200gCoveredShops}/${d.willieOvalLight200gShopsTarget}\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `⚡ *إجمالي وزن الحليب والجبن:* ${Math.round(d.totalAchievedWeight)} كغم\n`;
    }

    const encoded = encodeURIComponent(text);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  };

  // Export to Excel
  const handleExportExcel = () => {
    try {
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Grand Summary
      const summaryRows = delegatesAnalysis.map((d) => ({
        'المندوب': d.delegateName,
        'كبير: مبيعات الوزن (كغم)': Math.round(d.familySalesWeight),
        'كبير: هدف الوزن (كغم)': d.familyDailyTarget,
        'كبير: نسبة الوزن %': Math.round(d.familyWeightPct),
        'كبير: المحلات المحققة': d.familyCoveredShops,
        'كبير: هدف المحلات': d.familyTargetShops,
        'كبير: نسبة التغطية %': Math.round(d.familyCoveragePct),
        'كبير: شرط المحل (كغم)': d.familyMinWeightPerShop,

        'صغير: مبيعات الوزن (كغم)': Math.round(d.smallSalesWeight),
        'صغير: هدف الوزن (كغم)': d.smallDailyTarget,
        'صغير: نسبة الوزن %': Math.round(d.smallWeightPct),
        'صغير: المحلات المحققة': d.smallCoveredShops,
        'صغير: هدف المحلات': d.smallTargetShops,
        'صغير: نسبة التغطية %': Math.round(d.smallCoveragePct),
        'صغير: شرط المحل (كغم)': d.smallMinWeightPerShop,

        'ويلي 100 غم: مبيعات (كغم)': Math.round(d.willieOval100gSalesWeight),
        'ويلي 100 غم: هدف (كغم)': d.willieOval100gWeightTarget,
        'ويلي 100 غم: تغطية': `${d.willieOval100gCoveredShops}/${d.willieOval100gShopsTarget}`,

        'ويلي 200 غم: مبيعات (كغم)': Math.round(d.willieOval200gSalesWeight),
        'ويلي 200 غم: هدف (كغم)': d.willieOval200gWeightTarget,
        'ويلي 200 غم: تغطية': `${d.willieOval200gCoveredShops}/${d.willieOval200gShopsTarget}`,

        'ويلي لايت 200 غم: مبيعات (كغم)': Math.round(d.willieOvalLight200gSalesWeight),
        'ويلي لايت 200 غم: هدف (كغم)': d.willieOvalLight200gWeightTarget,
        'ويلي لايت 200 غم: تغطية': `${d.willieOvalLight200gCoveredShops}/${d.willieOvalLight200gShopsTarget}`,

        'إجمالي الوزن المحقق (كغم)': Math.round(d.totalAchievedWeight),
        'إجمالي الوزن المستهدف (كغم)': d.totalTargetWeight,
      }));

      const sheet1 = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(workbook, sheet1, 'ملخص_كافة_المندوبين');

      // Sheet 2: Detailed Shops for active delegate
      if (currentDelegateData && currentDelegateData.shops.length > 0) {
        const shopRows = currentDelegateData.shops.map((s) => ({
          'المندوب': currentDelegateData.delegateName,
          'كود المحل': s.customerCode,
          'اسم المحل': s.customerName,
          // 'النوع': s.customerType,
          'كبير (كغم)': Math.round(s.familyWeight),
          'كبير: حالة الشرط': s.isFamilyCovered ? 'محققة للشرط' : s.familyWeight > 0 ? 'أقل من الشرط' : 'لم يشترِ',
          'صغير (كغم)': Math.round(s.smallWeight),
          'صغير: حالة الشرط': s.isSmallCovered ? 'محققة للشرط' : s.smallWeight > 0 ? 'أقل من الشرط' : 'لم يشترِ',
          'ويلي 100 غم (كغم)': Math.round(s.willieOval100gWeight),
          'ويلي 100 غم (شهر)': Math.round(s.willieOval100gMonthlyTotalWeight || 0),
          'ويلي 200 غم (كغم)': Math.round(s.willieOval200gWeight),
          'ويلي 200 غم (شهر)': Math.round(s.willieOval200gMonthlyTotalWeight || 0),
          'ويلي لايت 200 غم (كغم)': Math.round(s.willieOvalLight200gWeight),
          'ويلي لايت 200 غم (شهر)': Math.round(s.willieOvalLight200gMonthlyTotalWeight || 0),
          'إجمالي الوزن': Math.round(s.totalWeight + s.willieOval100gWeight + s.willieOval200gWeight + s.willieOvalLight200gWeight),
        }));

        const sheet2 = XLSX.utils.json_to_sheet(shopRows);
        XLSX.utils.book_append_sheet(workbook, sheet2, `محلات_${currentDelegateData.delegateName}`);
      }

      XLSX.writeFile(workbook, `الهدف_الإضافي_حليب_بطل_${activeDate}.xlsx`);
      setUserMessage('تم تصدير تقرير الهدف الإضافي كملف إكسل بنجاح 📊✅');
    } catch (e) {
      console.error('Error exporting excel:', e);
      setUserMessage('حدث خطأ أثناء تصدير ملف الإكسل');
    }
  };

  // Export JPEG Image via html2canvas-pro
  const handleExportJpeg = async () => {
    if (!printReportRef.current) return;
    try {
      setUserMessage('جاري إنشاء صورة التقرير بجودة عالية... 📸');
      const canvas = await html2canvas(printReportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: isDarkMode ? '#020617' : '#ffffff',
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `الهدف_الإضافي_${activeDate}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setUserMessage('تم تنزيل صورة التقرير JPEG بنجاح 🖼️✅');
    } catch (err) {
      console.error('Error exporting JPEG:', err);
      setUserMessage('حدث خطأ أثناء تصدير الصورة');
    }
  };

  // Percent badge renderer
  const renderBadge = (pct: number) => {
    const isUnder75 = pct < 75;
    const isOver100 = pct >= 100;

    let cls = isDarkMode
      ? 'bg-slate-800 text-slate-300 border-slate-700'
      : 'bg-slate-100 text-slate-700 border-slate-200';

    if (isUnder75) {
      cls = isDarkMode
        ? 'bg-red-950/80 text-red-300 border-red-800/80'
        : 'bg-red-100 text-red-800 border-red-300';
    } else if (isOver100) {
      cls = isDarkMode
        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
        : 'bg-emerald-100 text-emerald-800 border-emerald-300';
    }

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black border ${cls}`}>
        {isOver100 ? <Check className="w-3 h-3 text-emerald-500" /> : isUnder75 ? <AlertTriangle className="w-3 h-3 text-red-500" /> : null}
        <span>{pct.toFixed(0)}%</span>
      </span>
    );
  };

  return (
    <PullToRefresh
      onRefresh={async () => {
        await refreshAllData();
        await new Promise((r) => setTimeout(r, 400));
      }}
    >
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-5 animate-in fade-in duration-200 dir-rtl">
        {/* Header Banner */}
        <div
          className={`p-4 sm:p-5 rounded-2xl border shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all duration-300 ${
            isDarkMode
              ? 'bg-gradient-to-br from-[#0c1a36] via-[#09152e] to-[#040b1b] border-blue-500/30 text-white'
              : 'bg-gradient-to-r from-blue-50 via-white to-slate-50 border-blue-200 text-slate-900'
          }`}
        >
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shrink-0">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-blue-700 dark:text-blue-400">
                  الهدف الإضافي (Additional Target)
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                  حليب بطل ESL
                </span>
                {!isAdmin && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    خاص بالمندوب: {currentUser?.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                متابعة هدف الوزن اليومي وتغطية المحلات لحليب بطل كبير (ESL Family) وصغير (ESL Small) مع شرط الحد الأدنى لوزن المحل
              </p>
            </div>
          </div>

          {/* Action buttons & Date Picker */}
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm text-xs font-bold">
              <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
              <input
                type="date"
                value={activeDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent font-black outline-none text-slate-800 dark:text-slate-200 cursor-pointer"
              />
            </div>

            {canEditTargets && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* 0. Working Days Button for Admins */}
                <button
                  onClick={() => setShowWorkingDaysModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="تحديد عدد أيام العمل في الشهر الحالي لحساب الوزن الشهري"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>أيام العمل ({globalConfig.monthlyWorkingDaysCount || 26} يوم)</span>
                </button>



                <input
                  type="file"
                  ref={excelUploadInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file, 'milk');
                    e.target.value = '';
                  }}
                />
                <input
                  type="file"
                  ref={willieExcelUploadInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file, 'willie');
                    e.target.value = '';
                  }}
                />
                <input
                  type="file"
                  ref={excelFamilyUploadInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file, 'milkFamily');
                    e.target.value = '';
                  }}
                />
                <input
                  type="file"
                  ref={excelSmallUploadInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file, 'milkSmall');
                    e.target.value = '';
                  }}
                />
                <input
                  type="file"
                  ref={willie100gExcelUploadInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file, 'willie100g');
                    e.target.value = '';
                  }}
                />
                <input
                  type="file"
                  ref={willie200gExcelUploadInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file, 'willie200g');
                    e.target.value = '';
                  }}
                />
                <input
                  type="file"
                  ref={willieLight200gExcelUploadInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file, 'willieLight200g');
                    e.target.value = '';
                  }}
                />
                {/* Manual Target Edit Buttons */}
                <button
                  onClick={() => handleOpenConfigModal(activeDelegate, 'milk')}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="تعديل أهداف وتغطية الحليب"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>تعديل هدف الحليب</span>
                </button>

                <button
                  onClick={() => handleOpenConfigModal(activeDelegate, 'willie')}
                  className="px-3 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="تعديل أهداف وتغطية الويلي"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>تعديل هدف الويلي</span>
                </button>
              </div>
            )}


            {canEditTargets && (
              <>
                <button
                  onClick={handleShareWhatsApp}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                  title="مشاركة التقرير عبر واتساب"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">واتساب</span>
                </button>

                <button
                  onClick={handleExportExcel}
                  className="px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                  title="تصدير كملف إكسل"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">إكسل</span>
                </button>

                <button
                  onClick={handleExportJpeg}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border shadow-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                  title="حفظ التقرير كصورة JPEG"
                >
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">صورة JPEG</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Delegate Selector Bar (For Admins & Data Entry) */}
        {canEditTargets && (
          <div
            className={`p-3.5 rounded-2xl border shadow-lg space-y-2.5 ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" />
                <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100">
                  اختيار المندوب / عرض التقرير
                </h3>
              </div>
              <span className="text-[11px] text-slate-400 font-bold">
                {activeDelegates.length} مندوبين نشطين
              </span>
            </div>

            <div className="flex flex-wrap gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => {
                  setViewMode('all');
                  setActiveDelegate('__SUPERVISOR__');
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap shadow-sm cursor-pointer ${
                  viewMode === 'all'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                📊 عرض جدول كافة المندوبين (المشرف)
              </button>

              {activeDelegates.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setActiveDelegate(name);
                    setViewMode('single');
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap shadow-sm cursor-pointer ${
                    activeDelegate === name && viewMode === 'single'
                      ? 'bg-indigo-600 border-indigo-500 text-white'
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

        {/* Printable/Capturable Report Container */}
        <div ref={printReportRef} className="space-y-6">
          {/* VIEW MODE 1: ALL DELEGATES GRAND SUPERVISOR VIEW */}
          {viewMode === 'all' && (
            <div className="space-y-6">
              {/* Grand Overview KPI Cards (Milk Only) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Family Milk Grand Card */}
                <div
                  className={`p-4 rounded-2xl border shadow-md space-y-2.5 ${
                    isDarkMode ? 'bg-slate-900 border-blue-500/40' : 'bg-white border-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                      <Package className="w-4 h-4" />
                      <span>بطل كبير (ESL)</span>
                    </span>
                    {renderBadge(branchTotals.familyWeightPct)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold">الوزن</span>
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        {Math.round(branchTotals.familySalesWeight)}/{branchTotals.familyDailyTarget}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold">تغطية</span>
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        {branchTotals.familyCoveredShops}/{branchTotals.familyTargetShops}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Small Milk Grand Card */}
                <div
                  className={`p-4 rounded-2xl border shadow-md space-y-2.5 ${
                    isDarkMode ? 'bg-slate-900 border-indigo-500/40' : 'bg-white border-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                      <Package className="w-4 h-4" />
                      <span>بطل صغير (ESL)</span>
                    </span>
                    {renderBadge(branchTotals.smallWeightPct)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold">الوزن</span>
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        {Math.round(branchTotals.smallSalesWeight)}/{branchTotals.smallDailyTarget}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold">تغطية</span>
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        {branchTotals.smallCoveredShops}/{branchTotals.smallTargetShops}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Total Milk Grand Card */}
                <div
                  className={`p-4 rounded-2xl border shadow-md space-y-2.5 ${
                    isDarkMode ? 'bg-slate-900 border-blue-500/40' : 'bg-white border-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" />
                      <span>إجمالي الحليب (ESL Total)</span>
                    </span>
                    {renderBadge(((branchTotals.familySalesWeight + branchTotals.smallSalesWeight) / (branchTotals.familyDailyTarget + branchTotals.smallDailyTarget)) * 100)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold">الوزن الكلي</span>
                      <span className="text-xs font-black text-blue-700 dark:text-blue-400">
                        {Math.round(branchTotals.familySalesWeight + branchTotals.smallSalesWeight)} كغم
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold">المندوبين</span>
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        {delegatesAnalysis.length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Table 1: ESL Family Milk */}
              <div
                className={`p-4 rounded-2xl border shadow-xl space-y-3 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-black">
                      🥛
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-black text-blue-700 dark:text-blue-400">
                        جدول مقارنة حليب بطل كبير (ESL Family - 1 لتر)
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        متابعة الوزن اليومي والشهري والتغطية لحليب بطل كبير مع زر تحديث الإكسل
                      </p>
                    </div>
                  </div>

                  {/* Hidden per user request:
                  {canEditTargets && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={downloadMilkFamilyTemplate}
                        className="px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-black flex items-center gap-1 hover:bg-blue-100 transition-all cursor-pointer border border-blue-200 dark:border-blue-800"
                        title="تحميل نموذج أهداف ومبيعات حليب بطل كبير"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>نموذج (كبير)</span>
                      </button>
                      <button
                        onClick={() => excelFamilyUploadInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                        title="استيراد وتحديث إكسل حليب بطل كبير"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>إكسل (حليب كبير)</span>
                      </button>
                    </div>
                  )}
                  */}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr
                        className={`font-black ${
                          isDarkMode
                            ? 'bg-slate-800 text-slate-200 border-b border-slate-700'
                            : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                        }`}
                      >
                        <th className="py-2.5 px-3">المندوب</th>
                        <th className="py-2.5 px-3 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                          مجموع المبيعات الشهرية (كغم)
                        </th>
                        <th className="py-2.5 px-3">الهدف الشهري (كغم)</th>
                        <th className="py-2.5 px-3">نسبة الإنجاز %</th>
                        <th className="py-2.5 px-3 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                          المحلات المحققة (تغطية)
                        </th>
                        <th className="py-2.5 px-3">هدف المحلات</th>
                        <th className="py-2.5 px-3">نسبة التغطية %</th>
                        <th className="py-2.5 px-3">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {delegatesAnalysis.map((item) => (
                        <tr
                          key={item.delegateName}
                          onClick={() => {
                            setActiveDelegate(item.delegateName);
                            setViewMode('single');
                          }}
                          className={`transition-colors font-bold cursor-pointer ${
                            isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-black text-slate-900 dark:text-slate-100">
                            {item.delegateName}
                          </td>
                          <td className="py-2.5 px-3 font-black text-blue-600 dark:text-blue-400">
                            <div className="flex flex-col items-center">
                              <span>{Math.round(item.monthlyFamilySalesWeight)} كغم</span>
                              {item.familySalesWeight > 0 && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                                  (اليومي: {Math.round(item.familySalesWeight)} كغم)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                            {item.familyMonthlyTarget} كغم
                          </td>
                          <td className="py-2.5 px-3">{renderBadge(item.familyWeightPct)}</td>
                          <td className="py-2.5 px-3 font-black text-blue-700 dark:text-blue-300">
                            {item.familyCoveredShops} محل
                          </td>
                          <td className="py-2.5 px-3">{item.familyTargetShops} محل</td>
                          <td className="py-2.5 px-3">{renderBadge(item.familyCoveragePct)}</td>
                          <td className="py-2.5 px-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDelegate(item.delegateName);
                                setViewMode('single');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 text-[11px] font-black hover:bg-blue-200 transition-colors cursor-pointer"
                            >
                              عرض المحلات
                            </button>
                          </td>
                        </tr>
                      ))}

                      {/* Branch Family Milk Totals */}
                      <tr
                        className={`font-black border-t-2 ${
                          isDarkMode
                            ? 'bg-slate-950 text-blue-400 border-blue-500/40'
                            : 'bg-blue-50/90 text-blue-900 border-blue-300'
                        }`}
                      >
                        <td className="py-3 px-3">إجمالي الفرع (كبير)</td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col items-center">
                            <span>{Math.round(branchTotals.monthlyFamilySalesWeight)} كغم</span>
                            {branchTotals.familySalesWeight > 0 && (
                              <span className="text-[10px] opacity-75 font-normal">
                                (اليومي: {Math.round(branchTotals.familySalesWeight)} كغم)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3">{branchTotals.familyMonthlyTarget} كغم</td>
                        <td className="py-3 px-3">{renderBadge(branchTotals.familyWeightPct)}</td>
                        <td className="py-3 px-3">{branchTotals.familyCoveredShops} محل</td>
                        <td className="py-3 px-3">{branchTotals.familyTargetShops} محل</td>
                        <td className="py-3 px-3">{renderBadge(branchTotals.familyCoveragePct)}</td>
                        <td className="py-3 px-3"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 2: ESL Small Milk */}
              <div
                className={`p-4 rounded-2xl border shadow-xl space-y-3 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-black">
                      🍼
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-black text-indigo-600 dark:text-indigo-400">
                        جدول مقارنة حليب بطل صغير (ESL Small - 200 مل)
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        متابعة الوزن اليومي والشهري والتغطية لحليب بطل صغير مع زر تحديث الإكسل
                      </p>
                    </div>
                  </div>

                  {/* Hidden per user request:
                  {canEditTargets && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={downloadMilkSmallTemplate}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-black flex items-center gap-1 hover:bg-indigo-100 transition-all cursor-pointer border border-indigo-200 dark:border-indigo-800"
                        title="تحميل نموذج أهداف ومبيعات حليب بطل صغير"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>نموذج (صغير)</span>
                      </button>
                      <button
                        onClick={() => excelSmallUploadInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                        title="استيراد وتحديث إكسل حليب بطل صغير"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>إكسل (حليب صغير)</span>
                      </button>
                    </div>
                  )}
                  */}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr
                        className={`font-black ${
                          isDarkMode
                            ? 'bg-slate-800 text-slate-200 border-b border-slate-700'
                            : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                        }`}
                      >
                        <th className="py-2.5 px-3">المندوب</th>
                        <th className="py-2.5 px-3 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                          مجموع المبيعات الشهرية (كغم)
                        </th>
                        <th className="py-2.5 px-3">الهدف الشهري (كغم)</th>
                        <th className="py-2.5 px-3">نسبة الإنجاز %</th>
                        <th className="py-2.5 px-3 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                          المحلات المحققة (تغطية)
                        </th>
                        <th className="py-2.5 px-3">هدف المحلات</th>
                        <th className="py-2.5 px-3">نسبة التغطية %</th>
                        <th className="py-2.5 px-3">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {delegatesAnalysis.map((item) => (
                        <tr
                          key={item.delegateName}
                          onClick={() => {
                            setActiveDelegate(item.delegateName);
                            setViewMode('single');
                          }}
                          className={`transition-colors font-bold cursor-pointer ${
                            isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-black text-slate-900 dark:text-slate-100">
                            {item.delegateName}
                          </td>
                          <td className="py-2.5 px-3 font-black text-indigo-600 dark:text-indigo-400">
                            <div className="flex flex-col items-center">
                              <span>{Math.round(item.monthlySmallSalesWeight)} كغم</span>
                              {item.smallSalesWeight > 0 && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                                  (اليومي: {Math.round(item.smallSalesWeight)} كغم)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                            {item.smallMonthlyTarget} كغم
                          </td>
                          <td className="py-2.5 px-3">{renderBadge(item.smallWeightPct)}</td>
                          <td className="py-2.5 px-3 font-black text-indigo-700 dark:text-indigo-300">
                            {item.smallCoveredShops} محل
                          </td>
                          <td className="py-2.5 px-3">{item.smallTargetShops} محل</td>
                          <td className="py-2.5 px-3">{renderBadge(item.smallCoveragePct)}</td>
                          <td className="py-2.5 px-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDelegate(item.delegateName);
                                setViewMode('single');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[11px] font-black hover:bg-indigo-200 transition-colors cursor-pointer"
                            >
                              عرض المحلات
                            </button>
                          </td>
                        </tr>
                      ))}

                      {/* Branch Small Milk Totals */}
                      <tr
                        className={`font-black border-t-2 ${
                          isDarkMode
                            ? 'bg-slate-950 text-indigo-400 border-indigo-500/40'
                            : 'bg-indigo-50/90 text-indigo-900 border-indigo-300'
                        }`}
                      >
                        <td className="py-3 px-3">إجمالي الفرع (صغير)</td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col items-center">
                            <span>{Math.round(branchTotals.monthlySmallSalesWeight)} كغم</span>
                            {branchTotals.smallSalesWeight > 0 && (
                              <span className="text-[10px] opacity-75 font-normal">
                                (اليومي: {Math.round(branchTotals.smallSalesWeight)} كغم)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3">{branchTotals.smallMonthlyTarget} كغم</td>
                        <td className="py-3 px-3">{renderBadge(branchTotals.smallWeightPct)}</td>
                        <td className="py-3 px-3">{branchTotals.smallCoveredShops} محل</td>
                        <td className="py-3 px-3">{branchTotals.smallTargetShops} محل</td>
                        <td className="py-3 px-3">{renderBadge(branchTotals.smallCoveragePct)}</td>
                        <td className="py-3 px-3"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 3: Total Milk Summary */}
              <div
                className={`p-4 rounded-2xl border shadow-xl space-y-3 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm sm:text-base font-black text-blue-700 dark:text-blue-400 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-500" />
                    <span>جدول إجمالي مبيعات وأهداف الحليب (كبير + صغير)</span>
                  </h3>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr
                        className={`font-black ${
                          isDarkMode
                            ? 'bg-slate-800 text-slate-200 border-b border-slate-700'
                            : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                        }`}
                      >
                        <th className="py-2.5 px-3">المندوب</th>
                        <th className="py-2.5 px-3 font-black text-blue-700 dark:text-blue-300">مجموع المبيعات الشهرية (كغم)</th>
                        <th className="py-2.5 px-3">إجمالي الهدف الشهري (كغم)</th>
                        <th className="py-2.5 px-3">إجمالي التغطية المحققة</th>
                        <th className="py-2.5 px-3">نسبة الإنجاز الكلية %</th>
                        <th className="py-2.5 px-3">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {delegatesAnalysis.map((item) => {
                        const totalMilkSales = item.familySalesWeight + item.smallSalesWeight;
                        const totalMilkMonthlySales = item.monthlyFamilySalesWeight + item.monthlySmallSalesWeight;
                        const totalMilkMonthlyTarget = item.familyMonthlyTarget + item.smallMonthlyTarget;
                        const totalMilkWeightPct = totalMilkMonthlyTarget > 0 ? (totalMilkMonthlySales / totalMilkMonthlyTarget) * 100 : 0;
                        const totalMilkCoveredShops = item.familyCoveredShops + item.smallCoveredShops;
                        const totalMilkTargetShops = item.familyTargetShops + item.smallTargetShops;

                        return (
                          <tr
                            key={item.delegateName}
                            onClick={() => {
                              setActiveDelegate(item.delegateName);
                              setViewMode('single');
                            }}
                            className={`transition-colors font-bold cursor-pointer ${
                              isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-black text-slate-900 dark:text-slate-100">
                              {item.delegateName}
                            </td>
                            <td className="py-2.5 px-3 font-black text-blue-600 dark:text-blue-400">
                              <div className="flex flex-col items-center">
                                <span>{Math.round(totalMilkMonthlySales)} كغم</span>
                                {totalMilkSales > 0 && (
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                                    (اليومي: {Math.round(totalMilkSales)} كغم)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{totalMilkMonthlyTarget} كغم</td>
                            <td className="py-2.5 px-3">{totalMilkCoveredShops} / {totalMilkTargetShops} محل</td>
                            <td className="py-2.5 px-3">{renderBadge(totalMilkWeightPct)}</td>
                            <td className="py-2.5 px-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDelegate(item.delegateName);
                                  setViewMode('single');
                                }}
                                className="px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 text-[11px] font-black hover:bg-blue-200 transition-colors cursor-pointer"
                              >
                                عرض المحلات
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {/* Grand Total Milk Totals */}
                      <tr
                        className={`font-black border-t-2 ${
                          isDarkMode
                            ? 'bg-slate-950 text-blue-400 border-blue-500/40'
                            : 'bg-blue-50/90 text-blue-900 border-blue-300'
                        }`}
                      >
                        <td className="py-3 px-3">إجمالي الفرع (كافة الحليب)</td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col items-center">
                            <span>{Math.round(branchTotals.monthlyFamilySalesWeight + branchTotals.monthlySmallSalesWeight)} كغم</span>
                            {(branchTotals.familySalesWeight + branchTotals.smallSalesWeight) > 0 && (
                              <span className="text-[10px] opacity-75 font-normal">
                                (اليومي: {Math.round(branchTotals.familySalesWeight + branchTotals.smallSalesWeight)} كغم)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3">{branchTotals.familyMonthlyTarget + branchTotals.smallMonthlyTarget} كغم</td>
                        <td className="py-3 px-3">{branchTotals.familyCoveredShops + branchTotals.smallCoveredShops} / {branchTotals.familyTargetShops + branchTotals.smallTargetShops} محل</td>
                        <td className="py-3 px-3">
                          {renderBadge(((branchTotals.monthlyFamilySalesWeight + branchTotals.monthlySmallSalesWeight) / (branchTotals.familyMonthlyTarget + branchTotals.smallMonthlyTarget)) * 100)}
                        </td>
                        <td className="py-3 px-3"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Separate Tables for Willie Cheese Sizes */}
              <div className="mt-8 space-y-6">
                {[
                  {
                    key: '100g',
                    title: 'جدول مقارنة جبن ويلي بيضوي (100 غم)',
                    subtitle: 'ترتيب المندوبين ومتابعة الوزن الشهري واليومي والتغطية لمنتج ويلي 100 غم (شرط الفاتورة ≥ 1.2 كغم والشهري ≥ 4 كغم)',
                    color: 'amber',
                    downloadTemplate: downloadWillie100gTemplate,
                    uploadRef: willie100gExcelUploadInputRef,
                    uploadType: 'willie100g' as const,
                    getData: (item: typeof delegatesAnalysis[0]) => ({
                      sales: item.monthlyWillieOval100gSalesWeight,
                      dailySales: item.willieOval100gSalesWeight,
                      dailyTarget: item.willieOval100gWeightTarget,
                      monthlyTarget: item.willieOval100gMonthlyTarget,
                      weightPct: item.willieOval100gWeightPct,
                      coveredShops: item.willieOval100gCoveredShops,
                      targetShops: item.willieOval100gShopsTarget,
                      coveragePct: item.willieOval100gCoveragePct,
                    }),
                    getBranchTotal: () => ({
                      sales: branchTotals.monthlyWillieOval100gSalesWeight,
                      dailySales: branchTotals.willieOval100gSalesWeight,
                      dailyTarget: branchTotals.willieOval100gWeightTarget,
                      monthlyTarget: branchTotals.willieOval100gMonthlyTarget,
                      weightPct: branchTotals.willieOval100gWeightPct,
                      coveredShops: branchTotals.willieOval100gCoveredShops,
                      targetShops: branchTotals.willieOval100gShopsTarget,
                      coveragePct: branchTotals.willieOval100gCoveragePct,
                    }),
                  },
                  {
                    key: '200g',
                    title: 'جدول مقارنة جبن ويلي بيضوي (200 غم)',
                    subtitle: 'ترتيب المندوبين ومتابعة الوزن الشهري واليومي والتغطية لمنتج ويلي 200 غم (شرط الفاتورة ≥ 1.2 كغم والشهري ≥ 4 كغم)',
                    color: 'amber',
                    downloadTemplate: downloadWillie200gTemplate,
                    uploadRef: willie200gExcelUploadInputRef,
                    uploadType: 'willie200g' as const,
                    getData: (item: typeof delegatesAnalysis[0]) => ({
                      sales: item.monthlyWillieOval200gSalesWeight,
                      dailySales: item.willieOval200gSalesWeight,
                      dailyTarget: item.willieOval200gWeightTarget,
                      monthlyTarget: item.willieOval200gMonthlyTarget,
                      weightPct: item.willieOval200gWeightPct,
                      coveredShops: item.willieOval200gCoveredShops,
                      targetShops: item.willieOval200gShopsTarget,
                      coveragePct: item.willieOval200gCoveragePct,
                    }),
                    getBranchTotal: () => ({
                      sales: branchTotals.monthlyWillieOval200gSalesWeight,
                      dailySales: branchTotals.willieOval200gSalesWeight,
                      dailyTarget: branchTotals.willieOval200gWeightTarget,
                      monthlyTarget: branchTotals.willieOval200gMonthlyTarget,
                      weightPct: branchTotals.willieOval200gWeightPct,
                      coveredShops: branchTotals.willieOval200gCoveredShops,
                      targetShops: branchTotals.willieOval200gShopsTarget,
                      coveragePct: branchTotals.willieOval200gCoveragePct,
                    }),
                  },
                  {
                    key: 'light200g',
                    title: 'جدول مقارنة جبن ويلي بيضوي لايت (200 غم لايت)',
                    subtitle: 'ترتيب المندوبين ومتابعة الوزن الشهري واليومي والتغطية لمنتج ويلي لايت 200 غم (شرط الفاتورة ≥ 1.2 كغم والشهري ≥ 4 كغم)',
                    color: 'amber',
                    downloadTemplate: downloadWillieLight200gTemplate,
                    uploadRef: willieLight200gExcelUploadInputRef,
                    uploadType: 'willieLight200g' as const,
                    getData: (item: typeof delegatesAnalysis[0]) => ({
                      sales: item.monthlyWillieOvalLight200gSalesWeight,
                      dailySales: item.willieOvalLight200gSalesWeight,
                      dailyTarget: item.willieOvalLight200gWeightTarget,
                      monthlyTarget: item.willieOvalLight200gMonthlyTarget,
                      weightPct: item.willieOvalLight200gWeightPct,
                      coveredShops: item.willieOvalLight200gCoveredShops,
                      targetShops: item.willieOvalLight200gShopsTarget,
                      coveragePct: item.willieOvalLight200gCoveragePct,
                    }),
                    getBranchTotal: () => ({
                      sales: branchTotals.monthlyWillieOvalLight200gSalesWeight,
                      dailySales: branchTotals.willieOvalLight200gSalesWeight,
                      dailyTarget: branchTotals.willieOvalLight200gWeightTarget,
                      monthlyTarget: branchTotals.willieOvalLight200gMonthlyTarget,
                      weightPct: branchTotals.willieOvalLight200gWeightPct,
                      coveredShops: branchTotals.willieOvalLight200gCoveredShops,
                      targetShops: branchTotals.willieOvalLight200gShopsTarget,
                      coveragePct: branchTotals.willieOvalLight200gCoveragePct,
                    }),
                  },
                ].map((tableCfg) => {
                  const sortedList = [...delegatesAnalysis].sort((a, b) => {
                    const dA = tableCfg.getData(a);
                    const dB = tableCfg.getData(b);
                    return dB.sales - dA.sales;
                  });
                  const bTotal = tableCfg.getBranchTotal();

                  return (
                    <div
                      key={tableCfg.key}
                      className={`p-4 rounded-2xl border shadow-xl space-y-3 ${
                        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-black">
                            🧀
                          </div>
                          <div>
                            <h3 className="text-sm sm:text-base font-black text-amber-700 dark:text-amber-400">
                              {tableCfg.title}
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {tableCfg.subtitle}
                            </p>
                          </div>
                        </div>

                        {/* Hidden per user request:
                        {canEditTargets && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={tableCfg.downloadTemplate}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-xs font-black flex items-center gap-1 hover:bg-amber-100 transition-all cursor-pointer border border-amber-200 dark:border-amber-800"
                              title={`تحميل نموذج أهداف ومبيعات ${tableCfg.title}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>نموذج</span>
                            </button>
                            <button
                              onClick={() => tableCfg.uploadRef.current?.click()}
                              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                              title={`استيراد وتحديث إكسل ${tableCfg.title}`}
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>إكسل لتحديث الجدول</span>
                            </button>
                          </div>
                        )}
                        */}
                      </div>

                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-xs text-center border-collapse">
                          <thead>
                            <tr
                              className={`font-black ${
                                isDarkMode
                                  ? 'bg-slate-800 text-slate-200 border-b border-slate-700'
                                  : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                              }`}
                            >
                              <th className="py-2.5 px-2 w-12">الترتيب</th>
                              <th className="py-2.5 px-3">المندوب</th>
                              <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                مجموع المبيعات الشهرية (كغم)
                              </th>
                              <th className="py-2.5 px-3">الهدف الشهري (كغم)</th>
                              <th className="py-2.5 px-3">نسبة الإنجاز %</th>
                              <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                المحلات المحققة (تغطية)
                              </th>
                              <th className="py-2.5 px-3">هدف المحلات</th>
                              <th className="py-2.5 px-3">نسبة التغطية %</th>
                              <th className="py-2.5 px-3">إجراء</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {sortedList.map((item, idx) => {
                              const data = tableCfg.getData(item);
                              return (
                                <tr
                                  key={item.delegateName}
                                  onClick={() => {
                                    setActiveDelegate(item.delegateName);
                                    setViewMode('single');
                                  }}
                                  className={`transition-colors font-bold cursor-pointer ${
                                    isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
                                  }`}
                                >
                                  <td className="py-2.5 px-2">
                                    <span
                                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-black ${
                                        idx === 0
                                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-300'
                                          : idx === 1
                                          ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
                                          : idx === 2
                                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                                          : 'text-slate-400'
                                      }`}
                                    >
                                      {idx + 1}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-black text-slate-900 dark:text-slate-100 text-right">
                                    {item.delegateName}
                                  </td>
                                  <td className="py-2.5 px-3 font-black text-amber-600 dark:text-amber-400">
                                    <div className="flex flex-col items-center">
                                      <span>{Math.round(data.sales)} كغم</span>
                                      {data.dailySales > 0 && (
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                                          (اليومي: {Math.round(data.dailySales)} كغم)
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                                    {data.monthlyTarget} كغم
                                  </td>
                                  <td className="py-2.5 px-3">{renderBadge(data.weightPct)}</td>
                                  <td className="py-2.5 px-3 font-black text-amber-700 dark:text-amber-300">
                                    {data.coveredShops} محل
                                  </td>
                                  <td className="py-2.5 px-3">{data.targetShops} محل</td>
                                  <td className="py-2.5 px-3">{renderBadge(data.coveragePct)}</td>
                                  <td className="py-2.5 px-3">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveDelegate(item.delegateName);
                                        setViewMode('single');
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 text-[11px] font-black hover:bg-amber-200 transition-colors cursor-pointer"
                                    >
                                      عرض المحلات
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}

                            {/* Branch Willie Total Row */}
                            <tr
                              className={`font-black border-t-2 ${
                                isDarkMode
                                  ? 'bg-slate-950 text-amber-400 border-amber-500/40'
                                  : 'bg-amber-50/90 text-amber-900 border-amber-300'
                              }`}
                            >
                              <td className="py-3 px-2">∑</td>
                              <td className="py-3 px-3 text-right">إجمالي الفرع ({tableCfg.key === '100g' ? '100 غم' : tableCfg.key === '200g' ? '200 غم' : 'لايت'})</td>
                              <td className="py-3 px-3">
                                <div className="flex flex-col items-center">
                                  <span>{Math.round(bTotal.sales)} كغم</span>
                                  {bTotal.dailySales > 0 && (
                                    <span className="text-[10px] opacity-75 font-normal">
                                      (اليومي: {Math.round(bTotal.dailySales)} كغم)
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-3">{bTotal.monthlyTarget} كغم</td>
                              <td className="py-3 px-3">{renderBadge(bTotal.weightPct)}</td>
                              <td className="py-3 px-3">{bTotal.coveredShops} محل</td>
                              <td className="py-3 px-3">{bTotal.targetShops} محل</td>
                              <td className="py-3 px-3">{renderBadge(bTotal.coveragePct)}</td>
                              <td className="py-3 px-3"></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}

                {/* Table 4: Combined Total Willie Summary Table */}
                <div
                  className={`p-4 rounded-2xl border shadow-xl space-y-3 ${
                    isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-600 to-yellow-500 text-white flex items-center justify-center font-black shadow-sm">
                        <Award className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black text-amber-800 dark:text-amber-400">
                          جدول إجمالي جبن ويلي (كافة الأحجام الثلاثة)
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          الملخص الشامل لجبن ويلي لجميع المندوبين
                        </p>
                      </div>
                    </div>

                    {/* Hidden per user request:
                    {canEditTargets && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={downloadWillieTemplate}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-xs font-black flex items-center gap-1 hover:bg-amber-100 transition-all cursor-pointer border border-amber-200 dark:border-amber-800"
                          title="تحميل نموذج أهداف ومبيعات الويلي الشامل"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>نموذج (شامل)</span>
                        </button>
                        <button
                          onClick={() => willieExcelUploadInputRef.current?.click()}
                          className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                          title="استيراد وتحديث إكسل الويلي الشامل"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>إكسل (الويلي الشامل)</span>
                        </button>
                      </div>
                    )}
                    */}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-xs text-center border-collapse">
                      <thead>
                        <tr
                          className={`font-black ${
                            isDarkMode
                              ? 'bg-slate-800 text-slate-200 border-b border-slate-700'
                              : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                          }`}
                        >
                          <th className="py-2.5 px-3 text-right">المندوب</th>
                          <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                            ويلي 100 غم (شهري/تغطية)
                          </th>
                          <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                            ويلي 200 غم (شهري/تغطية)
                          </th>
                          <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                            ويلي لايت 200 غم (شهري/تغطية)
                          </th>
                          <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-black">
                            مجموع المبيعات الشهرية (كغم)
                          </th>
                          <th className="py-2.5 px-3">الهدف الشهري</th>
                          <th className="py-2.5 px-3">إجراء</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {delegatesAnalysis.map((item) => {
                          const totalSales = item.willieOval100gSalesWeight + item.willieOval200gSalesWeight + item.willieOvalLight200gSalesWeight;
                          return (
                            <tr
                              key={item.delegateName}
                              onClick={() => {
                                setActiveDelegate(item.delegateName);
                                setViewMode('single');
                              }}
                              className={`transition-colors font-bold cursor-pointer ${
                                isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-2.5 px-3 font-black text-slate-900 dark:text-slate-100 text-right">
                                {item.delegateName}
                              </td>
                              <td className="py-2.5 px-3 border-x border-slate-200 dark:border-slate-800">
                                <span className="font-black text-amber-600 block">{Math.round(item.monthlyWillieOval100gSalesWeight)} كغم</span>
                                <span className="text-[10px] text-slate-400">تغطية: {item.willieOval100gCoveredShops}/{item.willieOval100gShopsTarget}</span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="font-black text-amber-600 block">{Math.round(item.monthlyWillieOval200gSalesWeight)} كغم</span>
                                <span className="text-[10px] text-slate-400">تغطية: {item.willieOval200gCoveredShops}/{item.willieOval200gShopsTarget}</span>
                              </td>
                              <td className="py-2.5 px-3 border-x border-slate-200 dark:border-slate-800">
                                <span className="font-black text-amber-600 block">{Math.round(item.monthlyWillieOvalLight200gSalesWeight)} كغم</span>
                                <span className="text-[10px] text-slate-400">تغطية: {item.willieOvalLight200gCoveredShops}/{item.willieOvalLight200gShopsTarget}</span>
                              </td>
                              <td className="py-2.5 px-3 font-black text-amber-700 dark:text-amber-300">
                                <div className="flex flex-col items-center">
                                  <span>{Math.round(item.totalMonthlyWillieSalesWeight)} كغم</span>
                                  {totalSales > 0 && (
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                                      (اليومي: {Math.round(totalSales)} كغم)
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{item.totalWillieMonthlyTarget} كغم</td>
                              <td className="py-2.5 px-3">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveDelegate(item.delegateName);
                                    setViewMode('single');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 text-[11px] font-black hover:bg-amber-200 transition-colors cursor-pointer"
                                >
                                  عرض المحلات
                                </button>
                              </td>
                            </tr>
                          );
                        })}

                        {/* Grand Branch Willie Totals */}
                        <tr
                          className={`font-black border-t-2 ${
                            isDarkMode
                              ? 'bg-slate-950 text-amber-400 border-amber-500/40'
                              : 'bg-amber-50/90 text-amber-900 border-amber-300'
                          }`}
                        >
                          <td className="py-3 px-3 text-right">إجمالي الفرع (كافة الويلي)</td>
                          <td className="py-3 px-3 border-x border-amber-200 dark:border-amber-900/50">
                            <div className="flex flex-col items-center">
                              <span>{Math.round(branchTotals.monthlyWillieOval100gSalesWeight)} كغم</span>
                              {branchTotals.willieOval100gSalesWeight > 0 && (
                                <span className="text-[10px] opacity-75 font-normal">
                                  (اليومي: {Math.round(branchTotals.willieOval100gSalesWeight)} كغم)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-col items-center">
                              <span>{Math.round(branchTotals.monthlyWillieOval200gSalesWeight)} كغم</span>
                              {branchTotals.willieOval200gSalesWeight > 0 && (
                                <span className="text-[10px] opacity-75 font-normal">
                                  (اليومي: {Math.round(branchTotals.willieOval200gSalesWeight)} كغم)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 border-x border-amber-200 dark:border-amber-900/50">
                            <div className="flex flex-col items-center">
                              <span>{Math.round(branchTotals.monthlyWillieOvalLight200gSalesWeight)} كغم</span>
                              {branchTotals.willieOvalLight200gSalesWeight > 0 && (
                                <span className="text-[10px] opacity-75 font-normal">
                                  (اليومي: {Math.round(branchTotals.willieOvalLight200gSalesWeight)} كغم)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-black text-amber-600">
                            <div className="flex flex-col items-center">
                              <span>{Math.round(branchTotals.totalMonthlyWillieSalesWeight)} كغم</span>
                              {branchTotals.totalWillieSalesWeight > 0 && (
                                <span className="text-[10px] opacity-75 font-normal">
                                  (اليومي: {Math.round(branchTotals.totalWillieSalesWeight)} كغم)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3">{branchTotals.totalWillieMonthlyTarget} كغم</td>
                          <td className="py-3 px-3"></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW MODE 2: SINGLE DELEGATE DETAILED VIEW */}
          {viewMode === 'single' && currentDelegateData && (
            <div className="space-y-6">
              {/* Header Card for Delegate */}
              <div
                className={`p-4 rounded-2xl border shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                  isDarkMode ? 'bg-slate-900 border-blue-500/30' : 'bg-blue-50/80 border-blue-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">
                      تقرير الهدف الإضافي: {currentDelegateData.delegateName}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      التاريخ: {activeDate} | إجمالي المحلات المزارة: {currentDelegateData.totalShopsVisited} محل
                    </p>
                  </div>
                </div>

                {canEditTargets && (
                  <button
                    onClick={() => handleOpenConfigModal(currentDelegateData.delegateName)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-black shadow-xs hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer text-slate-800 dark:text-slate-200"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-blue-500" />
                    <span>تعديل أهداف هذا المندوب</span>
                  </button>
                )}
              </div>

              {/* 2 Main Product Category Summary Cards (Milk) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. ESL Family Target Card */}
                <div
                  className={`p-4 sm:p-5 rounded-2xl border shadow-lg space-y-4 ${
                    isDarkMode ? 'bg-slate-900 border-blue-500/40' : 'bg-white border-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-black">
                        🥛
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
                          حليب بطل كبير (ESL Family)
                        </h3>
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">
                          مختلف الأطعمة (1 لتر / عائلي)
                        </span>
                      </div>
                    </div>
                    {renderBadge(currentDelegateData.familyWeightPct)}
                  </div>

                  {/* Weight metrics */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800">
                      <span>هدف الوزن الشهري ({currentDelegateData.workingDaysCount} يوم عمل):</span>
                      <span className="font-black">{currentDelegateData.familyMonthlyTarget} كغم</span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, currentDelegateData.familyWeightPct)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>الإنجاز: {currentDelegateData.familyWeightPct.toFixed(0)}%</span>
                      {currentDelegateData.familyRemainingWeight > 0 ? (
                        <span className="text-red-500 font-bold">متبقي {Math.round(currentDelegateData.familyRemainingWeight)} كغم</span>
                      ) : (
                        <span className="text-emerald-500 font-bold">تم تحقيق الوزن المستهدف ✅</span>
                      )}
                    </div>
                  </div>

                  {/* Coverage metrics */}
                  <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-blue-800 dark:text-blue-300 flex items-center gap-1">
                        <Store className="w-3.5 h-3.5" />
                        <span>تغطية المحلات (ESL Family Cov):</span>
                      </span>
                      {renderBadge(currentDelegateData.familyCoveragePct)}
                    </div>

                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-600 dark:text-slate-400">المحلات المحققة للشرط:</span>
                      <span className="font-black text-blue-700 dark:text-blue-300 text-sm">
                        {currentDelegateData.familyCoveredShops} من أصل {currentDelegateData.familyTargetShops} محل
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-blue-200/50 dark:border-blue-900/50">
                      <span>شرط الوزن للمحل: ≥ {currentDelegateData.familyMinWeightPerShop} كغم</span>
                      {currentDelegateData.familyUnmetShops > 0 && (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          ({currentDelegateData.familyUnmetShops} محلات اشترت أقل من الشرط)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. ESL Small Target Card */}
                <div
                  className={`p-4 sm:p-5 rounded-2xl border shadow-lg space-y-4 ${
                    isDarkMode ? 'bg-slate-900 border-indigo-500/40' : 'bg-white border-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-black">
                        🍼
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
                          حليب بطل صغير (ESL Small)
                        </h3>
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
                          مختلف الأطعمة (200 مل)
                        </span>
                      </div>
                    </div>
                    {renderBadge(currentDelegateData.smallWeightPct)}
                  </div>

                  {/* Weight metrics */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800">
                      <span>هدف الوزن الشهري ({currentDelegateData.workingDaysCount} يوم عمل):</span>
                      <span className="font-black">{currentDelegateData.smallMonthlyTarget} كغم</span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, currentDelegateData.smallWeightPct)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>الإنجاز: {currentDelegateData.smallWeightPct.toFixed(0)}%</span>
                      {currentDelegateData.smallRemainingWeight > 0 ? (
                        <span className="text-red-500 font-bold">متبقي {Math.round(currentDelegateData.smallRemainingWeight)} كغم</span>
                      ) : (
                        <span className="text-emerald-500 font-bold">تم تحقيق الوزن المستهدف ✅</span>
                      )}
                    </div>
                  </div>

                  {/* Coverage metrics */}
                  <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-indigo-800 dark:text-indigo-300 flex items-center gap-1">
                        <Store className="w-3.5 h-3.5" />
                        <span>تغطية المحلات (ESL Small Cov):</span>
                      </span>
                      {renderBadge(currentDelegateData.smallCoveragePct)}
                    </div>

                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-600 dark:text-slate-400">المحلات المحققة للشرط:</span>
                      <span className="font-black text-indigo-700 dark:text-indigo-300 text-sm">
                        {currentDelegateData.smallCoveredShops} من أصل {currentDelegateData.smallTargetShops} محل
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-indigo-200/50 dark:border-indigo-900/50">
                      <span>شرط الوزن للمحل: ≥ {currentDelegateData.smallMinWeightPerShop} كغم</span>
                      {currentDelegateData.smallUnmetShops > 0 && (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          ({currentDelegateData.smallUnmetShops} محلات اشترت أقل من الشرط)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Detailed Visited Shops Table - MILK */}
              <div
                className={`p-4 rounded-2xl border shadow-xl space-y-3 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-blue-700 dark:text-blue-400 flex items-center gap-2">
                      <Store className="w-4 h-4" />
                      <span>قائمة المحلات ومبيعات حليب بطل ESL</span>
                    </h3>
                  </div>

                  {/* Filter and Search */}
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                    <div className="relative flex-1 sm:w-56">
                      <Search className="w-3.5 h-3.5 absolute right-2.5 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="بحث عن محل..."
                        value={shopSearchTerm}
                        onChange={(e) => setShopSearchTerm(e.target.value)}
                        className={`w-full pr-8 pl-3 py-1.5 rounded-xl text-xs font-bold border outline-none ${
                          isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500'
                            : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-blue-500'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr
                        className={`font-black ${
                          isDarkMode
                            ? 'bg-slate-800 text-slate-200 border-b border-slate-700'
                            : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                        }`}
                      >
                        <th className="py-2.5 px-3 text-right">المحل / العميل</th>
                        <th className="py-2.5 px-3 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-x border-slate-200 dark:border-slate-800">
                          حليب كبير (كغم)
                        </th>
                        <th className="py-2.5 px-3 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                          شرط الكبير (≥ {currentDelegateData.familyMinWeightPerShop} كغم)
                        </th>
                        <th className="py-2.5 px-3 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-x border-slate-200 dark:border-slate-800">
                          حليب صغير (كغم)
                        </th>
                        <th className="py-2.5 px-3 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                          شرط الصغير (≥ {currentDelegateData.smallMinWeightPerShop} كغم)
                        </th>
                        <th className="py-2.5 px-3 font-black">إجمالي الحليب</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filteredShops.filter(s => s.familyWeight > 0 || s.smallWeight > 0).map((shop, idx) => (
                        <tr
                          key={shop.customerCode || shop.customerName || idx}
                          className={`transition-colors font-bold ${
                            isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-right">
                            <span className="font-black text-slate-900 dark:text-slate-100 block">{shop.customerName}</span>
                            {shop.customerCode && <span className="text-[10px] text-slate-400 block font-normal">كود: {shop.customerCode}</span>}
                          </td>
                          <td className="py-2.5 px-3 border-x border-slate-200 dark:border-slate-800 font-black">{shop.familyWeight > 0 ? `${Math.round(shop.familyWeight)} كغم` : '-'}</td>
                          <td className="py-2.5 px-3">
                            {shop.isFamilyCovered ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>محققة للشرط</span>
                              </span>
                            ) : shop.familyWeight > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-800">
                                <AlertTriangle className="w-3 h-3" />
                                <span>أقل من {Math.round(currentDelegateData.familyMinWeightPerShop)} كغم</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 font-normal">لم يشترِ</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 border-x border-slate-200 dark:border-slate-800 font-black">{shop.smallWeight > 0 ? `${Math.round(shop.smallWeight)} كغم` : '-'}</td>
                          <td className="py-2.5 px-3">
                            {shop.isSmallCovered ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>محققة للشرط</span>
                              </span>
                            ) : shop.smallWeight > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-800">
                                <AlertTriangle className="w-3 h-3" />
                                <span>أقل من {Math.round(currentDelegateData.smallMinWeightPerShop)} كغم</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 font-normal">لم يشترِ</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-black text-blue-600 dark:text-blue-400">{Math.round(shop.familyWeight + shop.smallWeight)} كغم</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. Willie Cheese Target Card - SEPARATE SECTION (3 Products) */}
                <div className="mt-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Willie Oval 100g Card */}
                    <div className={`p-4 rounded-2xl border shadow-lg space-y-3 ${isDarkMode ? 'bg-slate-900 border-amber-500/40' : 'bg-white border-amber-200'}`}>
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-black text-amber-600 dark:text-amber-400 text-sm">🧀 ويلي بيضوي 100 غم</span>
                        {renderBadge(currentDelegateData.willieOval100gWeightPct)}
                      </div>
                      <div className="text-xs space-y-1 font-bold">
                        <div className="flex justify-between">
                          <span className="text-slate-500">الوزن الشهري:</span>
                          <span>{Math.round(currentDelegateData.willieOval100gSalesWeight)} / {currentDelegateData.willieOval100gMonthlyTarget} كغم</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">التغطية:</span>
                          <span className="text-amber-600">{currentDelegateData.willieOval100gCoveredShops} / {currentDelegateData.willieOval100gShopsTarget} محل</span>
                        </div>
                      </div>
                    </div>

                    {/* Willie Oval 200g Card */}
                    <div className={`p-4 rounded-2xl border shadow-lg space-y-3 ${isDarkMode ? 'bg-slate-900 border-amber-500/40' : 'bg-white border-amber-200'}`}>
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-black text-amber-600 dark:text-amber-400 text-sm">🧀 ويلي بيضوي 200 غم</span>
                        {renderBadge(currentDelegateData.willieOval200gWeightPct)}
                      </div>
                      <div className="text-xs space-y-1 font-bold">
                        <div className="flex justify-between">
                          <span className="text-slate-500">الوزن الشهري:</span>
                          <span>{Math.round(currentDelegateData.willieOval200gSalesWeight)} / {currentDelegateData.willieOval200gMonthlyTarget} كغم</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">التغطية:</span>
                          <span className="text-amber-600">{currentDelegateData.willieOval200gCoveredShops} / {currentDelegateData.willieOval200gShopsTarget} محل</span>
                        </div>
                      </div>
                    </div>

                    {/* Willie Oval Light 200g Card */}
                    <div className={`p-4 rounded-2xl border shadow-lg space-y-3 ${isDarkMode ? 'bg-slate-900 border-amber-500/40' : 'bg-white border-amber-200'}`}>
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-black text-amber-600 dark:text-amber-400 text-sm">🧀 ويلي بيضوي لايت 200 غم</span>
                        {renderBadge(currentDelegateData.willieOvalLight200gWeightPct)}
                      </div>
                      <div className="text-xs space-y-1 font-bold">
                        <div className="flex justify-between">
                          <span className="text-slate-500">الوزن الشهري:</span>
                          <span>{Math.round(currentDelegateData.willieOvalLight200gSalesWeight)} / {currentDelegateData.willieOvalLight200gMonthlyTarget} كغم</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">التغطية:</span>
                          <span className="text-amber-600">{currentDelegateData.willieOvalLight200gCoveredShops} / {currentDelegateData.willieOvalLight200gShopsTarget} محل</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              {/* Detailed Visited Shops Table - WILLIE (3 Products) */}
              <div
                className={`p-4 rounded-2xl border shadow-xl space-y-3 mt-4 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-amber-600 dark:text-amber-400 flex items-center gap-2">
                      <Award className="w-4 h-4" />
                      <span>قائمة المحلات ومبيعات منتجات جبن ويلي الثلاثة</span>
                    </h3>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr
                        className={`font-black ${
                          isDarkMode
                            ? 'bg-slate-800 text-slate-200 border-b border-slate-700'
                            : 'bg-slate-100 text-slate-800 border-b border-slate-200'
                        }`}
                      >
                        <th className="py-2.5 px-3 text-right">المحل / العميل</th>
                        <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-x border-slate-200 dark:border-slate-800">
                          ويلي 100 غم (يومي / شهري / تغطية)
                        </th>
                        <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-x border-slate-200 dark:border-slate-800">
                          ويلي 200 غم (يومي / شهري / تغطية)
                        </th>
                        <th className="py-2.5 px-3 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                          ويلي لايت 200 غم (يومي / شهري / تغطية)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filteredShops.filter(s => s.willieOval100gWeight > 0 || s.willieOval200gWeight > 0 || s.willieOvalLight200gWeight > 0).map((shop, idx) => (
                        <tr
                          key={shop.customerCode || shop.customerName || idx}
                          className={`transition-colors font-bold ${
                            isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-right">
                            <span className="font-black text-slate-900 dark:text-slate-100 block">{shop.customerName}</span>
                            {shop.customerCode && <span className="text-[10px] text-slate-400 block font-normal">كود: {shop.customerCode}</span>}
                          </td>
                          {/* 100g */}
                          <td className="py-2.5 px-3 border-x border-slate-200 dark:border-slate-800">
                            {shop.willieOval100gWeight > 0 ? (
                              <div className="space-y-0.5">
                                <div className="text-amber-600 font-black">{Math.round(shop.willieOval100gWeight)} كغم (شهر: {Math.round(shop.willieOval100gMonthlyTotalWeight || 0)})</div>
                                <div>
                                  {shop.isWillieOval100gCovered ? (
                                    <span className="text-emerald-500 text-[10px]">مغطى ✅</span>
                                  ) : (
                                    <span className="text-red-400 text-[10px]">غير مغطى ❌</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>
                          {/* 200g */}
                          <td className="py-2.5 px-3 border-x border-slate-200 dark:border-slate-800">
                            {shop.willieOval200gWeight > 0 ? (
                              <div className="space-y-0.5">
                                <div className="text-amber-600 font-black">{Math.round(shop.willieOval200gWeight)} كغم (شهر: {Math.round(shop.willieOval200gMonthlyTotalWeight || 0)})</div>
                                <div>
                                  {shop.isWillieOval200gCovered ? (
                                    <span className="text-emerald-500 text-[10px]">مغطى ✅</span>
                                  ) : (
                                    <span className="text-red-400 text-[10px]">غير مغطى ❌</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>
                          {/* Light 200g */}
                          <td className="py-2.5 px-3">
                            {shop.willieOvalLight200gWeight > 0 ? (
                              <div className="space-y-0.5">
                                <div className="text-amber-600 font-black">{Math.round(shop.willieOvalLight200gWeight)} كغم (شهر: {Math.round(shop.willieOvalLight200gMonthlyTotalWeight || 0)})</div>
                                <div>
                                  {shop.isWillieOvalLight200gCovered ? (
                                    <span className="text-emerald-500 text-[10px]">مغطى ✅</span>
                                  ) : (
                                    <span className="text-red-400 text-[10px]">غير مغطى ❌</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* PARSING LOADER OVERLAY */}
        {isParsingExcel && (
          <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4 border border-slate-200 dark:border-slate-800">
              <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">جاري معالجة الملف...</h3>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">يرجى الانتظار، يتم تحليل بيانات الإكسل بدقة 📊</p>
              </div>
            </div>
          </div>
        )}

        {/* ADMIN TARGETS CONFIG MODAL */}
        {showConfigModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
            onClick={() => setShowConfigModal(false)}
          >
            <div
              className={`p-4 sm:p-6 rounded-3xl shadow-2xl w-full max-w-lg border text-right space-y-4 max-h-[90vh] overflow-y-auto ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center">
                    <SlidersHorizontal className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm sm:text-base">تحديد الأهداف وشروط التغطية</h3>
                    <p className="text-[11px] text-slate-400">حليب بطل كبير وصغير - شركة كالة</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Category Tab Switcher inside Modal */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setConfigModalTab('milk')}
                  className={`flex-1 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    configModalTab === 'milk'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>🥛 أهداف وتغطية الحليب</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfigModalTab('willie')}
                  className={`flex-1 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    configModalTab === 'willie'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>🧀 أهداف وتغطية الويلي</span>
                </button>
              </div>

              {/* Delegate Selector for modal */}
              <div>
                <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1">
                  تطبيق الهدف على:
                </label>
                <select
                  value={editDelegateName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditDelegateName(val);
                    if (val !== 'all') {
                      const cfg = getDelegateConfig(val);
                      setEditFamilyWeightTarget(cfg.familyMonthlyWeightTargetKg ?? cfg.familyDailyWeightTargetKg ?? 1040);
                      setEditFamilyShopsTarget(cfg.familyTargetShopsCount);
                      setEditFamilyMinWeight(cfg.familyMinWeightPerShopKg);
                      setEditSmallWeightTarget(cfg.smallMonthlyWeightTargetKg ?? cfg.smallDailyWeightTargetKg ?? 390);
                      setEditSmallShopsTarget(cfg.smallTargetShopsCount);
                      setEditSmallMinWeight(cfg.smallMinWeightPerShopKg);
                      setEditWillieOval100gWeightTarget(cfg.willieOval100gMonthlyWeightTarget ?? cfg.willieOval100gWeightTarget ?? 182);
                      setEditWillieOval100gShopsTarget(cfg.willieOval100gShopsTarget ?? 10);
                      setEditWillieOval200gWeightTarget(cfg.willieOval200gMonthlyWeightTarget ?? cfg.willieOval200gWeightTarget ?? 182);
                      setEditWillieOval200gShopsTarget(cfg.willieOval200gShopsTarget ?? 10);
                      setEditWillieOvalLight200gWeightTarget(cfg.willieOvalLight200gMonthlyWeightTarget ?? cfg.willieOvalLight200gWeightTarget ?? 156);
                      setEditWillieOvalLight200gShopsTarget(cfg.willieOvalLight200gShopsTarget ?? 10);
                      setEditWillieMinWeightInvoice(cfg.willieMinWeightPerInvoiceKg ?? 1.2);
                      setEditWillieMinWeightMonth(cfg.willieMinWeightPerCustomerMonthKg ?? 4);
                    } else {
                      setEditFamilyWeightTarget(40);
                      setEditFamilyShopsTarget(15);
                      setEditFamilyMinWeight(globalConfig.defaultFamilyMinWeightPerShopKg || 2);
                      setEditSmallWeightTarget(15);
                      setEditSmallShopsTarget(15);
                      setEditSmallMinWeight(globalConfig.defaultSmallMinWeightPerShopKg || 1);
                      setEditWillieOval100gWeightTarget(7);
                      setEditWillieOval100gShopsTarget(10);
                      setEditWillieOval200gWeightTarget(7);
                      setEditWillieOval200gShopsTarget(10);
                      setEditWillieOvalLight200gWeightTarget(6);
                      setEditWillieOvalLight200gShopsTarget(10);
                      setEditWillieMinWeightInvoice(1.2);
                      setEditWillieMinWeightMonth(4);
                    }
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-black border outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  <option value="all">🌟 تطبيق على كافة المندوبين معاً (إعدادات عامة)</option>
                  {activeDelegates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* MILK TARGET FORMS */}
              {configModalTab === 'milk' && (
                <div className="space-y-3 animate-in fade-in">
                  {/* Family Targets Form */}
                  <div className="p-3.5 rounded-2xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 space-y-3">
                    <h4 className="text-xs font-black text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                      <span>🥛</span>
                      <span>حليب بطل كبير (ESL Family Target)</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          الهدف الشهري (كغم)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={editFamilyWeightTarget}
                          onChange={(e) => setEditFamilyWeightTarget(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          هدف عدد المحلات
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={editFamilyShopsTarget}
                          onChange={(e) => setEditFamilyShopsTarget(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          شرط المحل (أدنى وزن كغم)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editFamilyMinWeight}
                          onChange={(e) => setEditFamilyMinWeight(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Small Targets Form */}
                  <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-3">
                    <h4 className="text-xs font-black text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                      <span>🍼</span>
                      <span>حليب بطل صغير (ESL Small Target)</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          الهدف الشهري (كغم)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={editSmallWeightTarget}
                          onChange={(e) => setEditSmallWeightTarget(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          هدف عدد المحلات
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={editSmallShopsTarget}
                          onChange={(e) => setEditSmallShopsTarget(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          شرط المحل (أدنى وزن كغم)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editSmallMinWeight}
                          onChange={(e) => setEditSmallMinWeight(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* WILLIE TARGET FORMS */}
              {configModalTab === 'willie' && (
                <div className="space-y-3 animate-in fade-in">
                  {/* Willie Targets Form (3 Products) */}
                  <div className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 space-y-3">
                    <h4 className="text-xs font-black text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <span>🧀</span>
                      <span>أهداف جبن ويلي الثلاثة</span>
                    </h4>
                    <div className="space-y-3">
                      {/* 100g */}
                      <div className="p-2.5 rounded-xl bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 space-y-2">
                        <span className="text-[11px] font-black text-amber-800 dark:text-amber-300 block">ويلي بيضوي 100 غم</span>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">الهدف الشهري (كغم)</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editWillieOval100gWeightTarget}
                              onChange={(e) => setEditWillieOval100gWeightTarget(Number(e.target.value))}
                              className={`w-full px-2 py-1 rounded-lg text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">هدف المحلات</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editWillieOval100gShopsTarget}
                              onChange={(e) => setEditWillieOval100gShopsTarget(Number(e.target.value))}
                              className={`w-full px-2 py-1 rounded-lg text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                            />
                          </div>
                        </div>
                      </div>

                      {/* 200g */}
                      <div className="p-2.5 rounded-xl bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 space-y-2">
                        <span className="text-[11px] font-black text-amber-800 dark:text-amber-300 block">ويلي بيضوي 200 غم</span>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">الهدف الشهري (كغم)</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editWillieOval200gWeightTarget}
                              onChange={(e) => setEditWillieOval200gWeightTarget(Number(e.target.value))}
                              className={`w-full px-2 py-1 rounded-lg text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">هدف المحلات</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editWillieOval200gShopsTarget}
                              onChange={(e) => setEditWillieOval200gShopsTarget(Number(e.target.value))}
                              className={`w-full px-2 py-1 rounded-lg text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Light 200g */}
                      <div className="p-2.5 rounded-xl bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 space-y-2">
                        <span className="text-[11px] font-black text-amber-800 dark:text-amber-300 block">ويلي بيضوي لايت 200 غم</span>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">الهدف الشهري (كغم)</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editWillieOvalLight200gWeightTarget}
                              onChange={(e) => setEditWillieOvalLight200gWeightTarget(Number(e.target.value))}
                              className={`w-full px-2 py-1 rounded-lg text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">هدف المحلات</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editWillieOvalLight200gShopsTarget}
                              onChange={(e) => setEditWillieOvalLight200gShopsTarget(Number(e.target.value))}
                              className={`w-full px-2 py-1 rounded-lg text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Conditions */}
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-amber-200 dark:border-amber-900/50">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">شرط الفاتورة (كغم)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={editWillieMinWeightInvoice}
                            onChange={(e) => setEditWillieMinWeightInvoice(Number(e.target.value))}
                            className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">شرط الشهر (كغم)</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={editWillieMinWeightMonth}
                            onChange={(e) => setEditWillieMinWeightMonth(Number(e.target.value))}
                            className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}


              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveTargets}
                  disabled={isSavingTargets}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingTargets ? 'جاري الحفظ...' : 'تثبيت وحفظ الأهداف'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {/* REPLACEMENT MODAL FOR TARGET TABLES */}
        {showUploadConfirm && pendingUploadData && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in"
            onClick={() => {
              setShowUploadConfirm(false);
              setPendingUploadData(null);
            }}
          >
            <div
              className={`p-6 sm:p-7 rounded-3xl shadow-2xl w-full max-w-lg border text-center space-y-5 ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-500 flex items-center justify-center text-3xl shadow-inner">
                  {getTargetTableInfo(pendingUploadData.uploadType).icon}
                </div>
                <div className="space-y-1.5">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-black border ${getTargetTableInfo(pendingUploadData.uploadType).badgeColor}`}>
                    {getTargetTableInfo(pendingUploadData.uploadType).tableName}
                  </span>
                  <h3 className="text-lg font-black pt-1">مودل استبدال وتحديث قيم الجدول</h3>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    هل أنت متأكد من استبدال وتحديث قيم هذا الجدول من ملف الإكسل؟
                  </p>
                </div>
              </div>

              {/* Data Summary Card */}
              <div className={`p-4 rounded-2xl border text-right space-y-2.5 text-xs ${
                isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span className="font-bold">الجدول المستهدف بالتحديث:</span>
                  <span className="font-black text-amber-600 dark:text-amber-400">{getTargetTableInfo(pendingUploadData.uploadType).tableName}</span>
                </div>
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span className="font-bold">عدد السجلات المقروءة من الملف:</span>
                  <span className="font-black font-mono text-emerald-600 dark:text-emerald-400 text-sm">
                    {pendingUploadData.uploadType.startsWith('willie') 
                      ? pendingUploadData.willieSales.length 
                      : pendingUploadData.sales.length} قيد
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span className="font-bold">إجمالي وزن المبيعات بالملف:</span>
                  <span className="font-black font-mono text-emerald-600 dark:text-emerald-400">
                    {(pendingUploadData.uploadType.startsWith('willie')
                      ? pendingUploadData.willieSales.reduce((s, e) => s + (e.totalWeightKg || 0), 0)
                      : pendingUploadData.sales.reduce((s, e) => s + (e.totalWeightKg || 0), 0)
                    ).toFixed(2)} كغم
                  </span>
                </div>
              </div>

              {/* Explicit replacement notice */}
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-right">
                <p className="text-xs font-black text-amber-700 dark:text-amber-400 leading-relaxed">
                  ⚠️ {getTargetTableInfo(pendingUploadData.uploadType).description}
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadConfirm(false);
                    setPendingUploadData(null);
                  }}
                  className={`flex-1 py-3 rounded-2xl font-bold text-xs border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (pendingUploadData) {
                      const dataToSave = pendingUploadData;
                      setShowUploadConfirm(false);
                      setPendingUploadData(null);
                      saveParsedData(
                        dataToSave.delegateConfigs,
                        dataToSave.targets,
                        dataToSave.sales,
                        dataToSave.willieSales,
                        dataToSave.uploadType
                      );
                    }
                  }}
                  disabled={isSavingTargets}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-black text-xs rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSavingTargets ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      <span>جاري الاستبدال والحفظ...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>تأكيد استبدال قيم الجدول</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* WORKING DAYS SETTING MODAL FOR ADMIN */}
        {showWorkingDaysModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in"
            onClick={() => setShowWorkingDaysModal(false)}
          >
            <div
              className={`p-6 sm:p-8 rounded-3xl shadow-2xl w-full max-w-md border space-y-6 ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b pb-4 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black shadow-md">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black">عدد أيام العمل بالشهر</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      يحدد السستم الوزن الشهري المستهدف بضرب الوزن اليومي لكل مندوب في هذا العدد.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowWorkingDaysModal(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 dark:text-slate-300 mb-2">
                    أدخل عدد أيام العمل في الشهر الحالي (1 - 31 يوم):
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="31"
                      step="1"
                      value={editWorkingDays}
                      onChange={(e) => setEditWorkingDays(Number(e.target.value))}
                      className={`w-full px-4 py-3 rounded-2xl text-lg font-black text-center border outline-none transition-all ${
                        isDarkMode
                          ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500'
                          : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-indigo-500'
                      }`}
                    />
                    <span className="absolute left-4 top-3.5 text-xs font-bold text-slate-400">يوم عمل</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-900/60 text-xs font-bold text-indigo-900 dark:text-indigo-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-black text-indigo-700 dark:text-indigo-300">
                    <Sparkles className="w-4 h-4" />
                    <span>توضيح آلية الاحتساب:</span>
                  </div>
                  <p className="leading-relaxed text-[11px]">
                    الوزن الشهري المستهدف للمندوب = (الوزن اليومي المستهدف) × ({editWorkingDays || 26} يوم عمل).
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWorkingDaysModal(false)}
                  className="flex-1 py-3 rounded-2xl font-bold text-xs border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveWorkingDays}
                  disabled={isSavingTargets}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingTargets ? 'جاري الحفظ...' : 'حفظ واحتساب'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
};
