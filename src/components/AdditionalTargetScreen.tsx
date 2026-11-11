import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, writeBatch, query, where, getDocs } from 'firebase/firestore';
import { safeOnSnapshot, logFirestoreErrorGracefully, isGlobalQuotaExceeded } from '../lib/firestoreUtils';
import { AdditionalTargetConfig, AdditionalTargetSalesEntry } from '../types';
import { formatWithCommas } from '../utils/numberUtils';
import * as XLSX from 'xlsx';
import {
  Target,
  Award,
  Upload,
  Download,
  Lock,
  Unlock,
  Store,
  CheckCircle2,
  AlertCircle,
  Calendar,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  User,
  Users,
  Check,
  X,
  FileSpreadsheet,
  Coins,
  HardDrive,
  Database,
  ShieldCheck,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { PullToRefresh } from './PullToRefresh';
import { FamilyMilkTable, SmallMilkTable } from './FamilyMilkTable';
import {
  checkSupabaseSchemaStatus,
  configureSupabaseStorageBuckets,
  uploadExcelToSupabaseStorage,
} from '../lib/supabaseService';
import {
  BUCKET_SALES,
  BUCKET_INVOICE_IMAGES,
  BUCKET_PRODUCT_IMAGES,
} from '../lib/supabaseClient';

// Incentive Rules Constants
export const INCENTIVE_COVERAGE_AMOUNT = 32500; // 32,500 IQD
export const INCENTIVE_SALES_AMOUNT = 32500;    // 32,500 IQD

// Normalize Arabic text helper
const normalizeArabic = (str: any): string => {
  if (!str) return '';
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

// Robust classifier for Large Bottle Milk vs Small Bottle Milk
export const classifyMilkBottle = (entry: {
  categoryName?: string;
  productName?: string;
  productCode?: string;
  pieceWeightKg?: number;
}): 'family' | 'small' | null => {
  const cat = normalizeArabic(entry.categoryName || '');
  const prod = normalizeArabic(entry.productName || '');
  const code = normalizeArabic(entry.productCode || '');
  const combined = `${cat} ${prod} ${code}`;
  const weight = Number(entry.pieceWeightKg) || 0;

  // Exclude Willie cheese
  if (combined.includes('ويلي') || combined.includes('willie') || combined.includes('جبن')) {
    return null;
  }

  // Exclude packet milk (حليب باكيت / كرتون / تترا) unless explicitly bottle
  if (combined.includes('باكيت') || combined.includes('تترا') || combined.includes('كارتون')) {
    if (!combined.includes('بطل') && !combined.includes('قنين') && !combined.includes('esl')) {
      return null;
    }
  }

  // Small bottle indicators (200ml, small, sml, etc.)
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

  // Large bottle indicators (1L, family, عائلي, كبير, fam, etc.)
  if (
    cat.includes('كبير') ||
    cat.includes('family') ||
    cat.includes('عائلي') ||
    prod.includes('كبير') ||
    prod.includes('1000') ||
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

  // Fallback check
  if (combined.includes('حليب') || combined.includes('بطل') || combined.includes('esl')) {
    if (weight >= 0.6) return 'family';
    if (weight > 0 && weight < 0.5) return 'small';
    return 'family'; // Default bottle milk
  }

  return null;
};

// Robust classifier for Willie Cheese
export const classifyWillieProduct = (entry: {
  categoryName?: string;
  productName?: string;
  productCode?: string;
}): boolean => {
  const cat = normalizeArabic(entry.categoryName || '');
  const prod = normalizeArabic(entry.productName || '');
  const code = normalizeArabic(entry.productCode || '');
  const combined = `${cat} ${prod} ${code}`;

  return (
    combined.includes('ويلي') ||
    combined.includes('willie') ||
    combined.includes('جبن ويلي') ||
    combined.includes('ويلي بيضوي') ||
    combined.includes('w100') ||
    combined.includes('w200') ||
    combined.includes('w-100') ||
    combined.includes('w-200')
  );
};

export const AdditionalTargetScreen: React.FC = () => {
  const { currentUser, isDarkMode, delegatesList = [] } = useSales();

  const isAdmin = Boolean(
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'admin' ||
    currentUser?.username?.toLowerCase() === 'rafatdata'
  );

  // Active Date Filter (Defaults to today in YYYY-MM-DD format)
  const [activeDate, setActiveDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  const activeMonthStr = useMemo(() => activeDate.substring(0, 7), [activeDate]);

  // Clean active delegates list
  const activeDelegates = useMemo(() => {
    const list: string[] = [];
    delegatesList.forEach((d) => {
      const s = String(d || '').trim();
      if (s && !list.includes(s) && !s.includes('مخزن') && !s.includes('تجريبي')) {
        list.push(s);
      }
    });
    return list;
  }, [delegatesList]);

  // Active delegate selection & view mode
  const [activeDelegate, setActiveDelegate] = useState<string>(() => {
    if (!isAdmin && currentUser?.name) {
      return currentUser.name;
    }
    return '__SUPERVISOR__';
  });

  const [viewMode, setViewMode] = useState<'single' | 'all'>('all');

  // Lock delegate selection for representatives
  useEffect(() => {
    if (!isAdmin && currentUser?.name) {
      setActiveDelegate(currentUser.name);
      setViewMode('single');
    }
  }, [isAdmin, currentUser]);

  // Target Configs from Firestore
  const [configs, setConfigs] = useState<AdditionalTargetConfig[]>(() => {
    try {
      const cached = localStorage.getItem('cache_additional_target_configs');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  // Uploaded Sales Entries from Firestore
  const [salesEntries, setSalesEntries] = useState<AdditionalTargetSalesEntry[]>(() => {
    try {
      const cached = localStorage.getItem('cache_additional_target_sales');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  // Dedicated Target Category Tabs: 'overview' | 'family' | 'small' | 'willie'
  const [targetCategory, setTargetCategory] = useState<'overview' | 'family' | 'small' | 'willie'>('overview');

  // Supabase Storage Buckets Verification State
  const [storageVerification, setStorageVerification] = useState<{
    checked: boolean;
    salesBucket: boolean;
    invoiceImages: boolean;
    productImages: boolean;
    allReady: boolean;
    isChecking: boolean;
  }>({
    checked: false,
    salesBucket: true,
    invoiceImages: true,
    productImages: true,
    allReady: true,
    isChecking: false,
  });

  const verifyStorageBuckets = async () => {
    setStorageVerification((prev) => ({ ...prev, isChecking: true }));
    try {
      const res = await checkSupabaseSchemaStatus();
      setStorageVerification({
        checked: true,
        salesBucket: res.buckets['sales-bucket'].exists,
        invoiceImages: res.buckets['invoice-images'].exists,
        productImages: res.buckets['product-images'].exists,
        allReady: res.allBucketsReady,
        isChecking: false,
      });
      // If any bucket is missing, automatically initialize or handle fallback
      if (!res.allBucketsReady) {
        await configureSupabaseStorageBuckets();
      }
    } catch {
      setStorageVerification((prev) => ({ ...prev, isChecking: false, checked: true }));
    }
  };

  useEffect(() => {
    verifyStorageBuckets();
  }, []);

  // Excel Upload Input Refs
  const excelUploadRef = useRef<HTMLInputElement>(null);
  const willieUploadRef = useRef<HTMLInputElement>(null);
  const familyMilkUploadRef = useRef<HTMLInputElement>(null);
  const smallMilkUploadRef = useRef<HTMLInputElement>(null);

  // Helper to generate synthetic Milk shop entries preserving EXACT sales weight from Excel
  const createMilkSyntheticEntries = (
    delName: string,
    salesWeight: number,
    coveredShops: number,
    rowIndex: number,
    actDate: string,
    actMonthStr: string,
    milkType: 'family' | 'small'
  ): AdditionalTargetSalesEntry[] => {
    const entries: AdditionalTargetSalesEntry[] = [];
    if (salesWeight <= 0 && coveredShops <= 0) return entries;

    const minPerShop = milkType === 'family' ? 11.5 : 7.5;
    const countCovered = Math.max(0, coveredShops || 0);

    if (countCovered > 0) {
      const totalWeight = Math.max(salesWeight, countCovered * minPerShop);
      const perShop = totalWeight / countCovered;

      for (let c = 1; c <= countCovered; c++) {
        const isLast = c === countCovered;
        const prevSum = (c - 1) * Math.round(perShop);
        const shopWeight = isLast ? Math.round(totalWeight - prevSum) : Math.round(perShop);

        entries.push({
          id: `sale_${actDate}_${normalizeArabic(delName)}_${milkType.toUpperCase()}_SHOP_${c}_${rowIndex}`,
          delegateName: delName,
          customerCode: `${milkType.toUpperCase()}_SHOP_${c}`,
          customerName: `محل حليب ${milkType === 'family' ? 'كبير' : 'صغير'} ${c}`,
          productCode: milkType === 'family' ? 'MILK-FAMILY' : 'MILK-SMALL',
          productName: milkType === 'family' ? 'حليب بطل كبير' : 'حليب بطل صغير',
          categoryName: milkType === 'family' ? 'حليب عائلي' : 'حليب صغير',
          salesWeightKg: Math.max(minPerShop, shopWeight),
          dateString: actDate,
          monthString: actMonthStr,
          uploadedAt: new Date().toISOString(),
        });
      }
    } else if (salesWeight > 0) {
      entries.push({
        id: `sale_${actDate}_${normalizeArabic(delName)}_${milkType.toUpperCase()}_SHOP_0_${rowIndex}`,
        delegateName: delName,
        customerCode: `${milkType.toUpperCase()}_SHOP_0`,
        customerName: `محل حليب ${milkType === 'family' ? 'كبير' : 'صغير'} غير مؤهل`,
        productCode: milkType === 'family' ? 'MILK-FAMILY' : 'MILK-SMALL',
        productName: milkType === 'family' ? 'حليب بطل كبير' : 'حليب بطل صغير',
        categoryName: milkType === 'family' ? 'حليب عائلي' : 'حليب صغير',
        salesWeightKg: Math.min(salesWeight, minPerShop > 1 ? minPerShop - 1 : 0.5),
        dateString: actDate,
        monthString: actMonthStr,
        uploadedAt: new Date().toISOString(),
      });
    }

    return entries;
  };

  const handleFamilyMilkUpload = async (file: File) => {
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);

        if (!rows || rows.length === 0) {
          setUserMessage('ملف الحليب الكبير فارغ أو لا يحتوي على بيانات صالحة');
          setIsUploading(false);
          return;
        }

        const parsedEntries: AdditionalTargetSalesEntry[] = [];
        let rowIndex = 0;
        let updatedDelegatesCount = 0;

        for (const row of rows as any[]) {
          rowIndex++;
          const rowKeys = Object.keys(row);
          const findVal = (predicate: (cleanKey: string) => boolean) => {
            for (const rk of rowKeys) {
              const clean = normalizeArabic(rk).replace(/[\s_-]/g, '');
              if (predicate(clean)) {
                const val = row[rk];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                  return val;
                }
              }
            }
            return undefined;
          };

          const delNameRaw = findVal((k) => k.includes('مندوب') || k.includes('delegate') || k.includes('preseller'));
          if (!delNameRaw) continue;
          const rawDelNameStr = String(delNameRaw).trim();
          const matchedDel = activeDelegates.find(d => normalizeArabic(d) === normalizeArabic(rawDelNameStr)) || rawDelNameStr;

          const targetWeight = Number(findVal((k) => (k.includes('هدف') || k.includes('تاركت') || k.includes('target')) && (k.includes('وزن') || k.includes('كغم') || k.includes('kg')) && !k.includes('محل') && !k.includes('زبون') && !k.includes('عميل'))) || 0;

          const salesWeight = Number(findVal((k) => (k.includes('مبيعات') || k.includes('بيع') || k.includes('sales')) && (k.includes('وزن') || k.includes('كغم') || k.includes('kg')))) || 0;

          const targetShops = Number(findVal((k) => k.includes('مستهدف') || (k.includes('target') && (k.includes('cust') || k.includes('shop') || k.includes('client'))))) || 0;

          // Acceptable shops: matches any key with مقبول or acceptable or منجز or تغطية
          const coveredShopsRaw = findVal((k) => k.includes('مقبول') || k.includes('acceptable') || k.includes('منجز') || (k.includes('تغطية') && !k.includes('حافز')));
          const coveredShops = coveredShopsRaw !== undefined ? Number(coveredShopsRaw) || 0 : 0;

          const docId = `del_${matchedDel}`.replace(/[\/\s#$[\]]/g, '_');
          const docRef = doc(db, 'additional_target_configs', docId);
          await setDoc(docRef, {
            delegateName: matchedDel,
            familyMonthlyWeightTargetKg: targetWeight > 0 ? targetWeight : 1040,
            familyTargetShopsCount: targetShops > 0 ? targetShops : 15,
            familyMinWeightPerShopKg: 11.5,
            familyCoveredShopsCount: coveredShops,
            familyMonthlySalesWeightKg: salesWeight,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser?.name || 'الأدمن',
          }, { merge: true });

          updatedDelegatesCount++;

          const synth = createMilkSyntheticEntries(matchedDel, salesWeight, coveredShops, rowIndex, activeDate, activeMonthStr, 'family');
          if (synth.length > 0) {
            parsedEntries.push(...synth);
          }
        }

        const existingQuery = query(collection(db, 'additional_target_sales'), where('monthString', '==', activeMonthStr));
        const existingSnap = await getDocs(existingQuery);
        const deleteOps = existingSnap.docs
          .filter((d) => classifyMilkBottle(d.data()) === 'family')
          .map((d) => doc(db, 'additional_target_sales', d.id));

        const batchOps = parsedEntries.map((entry) => ({ ref: doc(db, 'additional_target_sales', entry.id), data: entry }));
        const totalOps = [
          ...deleteOps.map((ref) => ({ ref, isDelete: true, data: null })),
          ...batchOps.map((b) => ({ ref: b.ref, isDelete: false, data: b.data })),
        ];

        for (let i = 0; i < totalOps.length; i += 400) {
          const batch = writeBatch(db);
          totalOps.slice(i, i + 400).forEach((op) => {
            if (op.isDelete) batch.delete(op.ref);
            else if (op.data) batch.set(op.ref, op.data, { merge: true });
          });
          await batch.commit();
        }
        // Backup uploaded Excel to Supabase Storage Bucket ('sales-bucket')
        uploadExcelToSupabaseStorage(file, {
          uploadedBy: currentUser?.name || 'مدير النظام',
          targetType: 'family-milk-uploads',
          description: `ملف مبيعات حليب كبير لشهر ${activeMonthStr}`,
        }).catch((err) => console.warn('Supabase storage backup notice:', err));

        setUserMessage(`تم استيراد وتحديث بيانات ${updatedDelegatesCount} مندوب للحليب الكبير ومزامنتها بنجاح 🥛📥✅`);
      } catch (err) {
        console.error(err);
        setUserMessage('حدث خطأ أثناء معالجة ملف الحليب الكبير');
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSmallMilkUpload = async (file: File) => {
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);

        if (!rows || rows.length === 0) {
          setUserMessage('ملف الحليب الصغير فارغ أو لا يحتوي على بيانات صالحة');
          setIsUploading(false);
          return;
        }

        const parsedEntries: AdditionalTargetSalesEntry[] = [];
        let rowIndex = 0;
        let updatedDelegatesCount = 0;

        for (const row of rows as any[]) {
          rowIndex++;
          const rowKeys = Object.keys(row);
          const findVal = (predicate: (cleanKey: string) => boolean) => {
            for (const rk of rowKeys) {
              const clean = normalizeArabic(rk).replace(/[\s_-]/g, '');
              if (predicate(clean)) {
                const val = row[rk];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                  return val;
                }
              }
            }
            return undefined;
          };

          const delNameRaw = findVal((k) => k.includes('مندوب') || k.includes('delegate') || k.includes('preseller'));
          if (!delNameRaw) continue;
          const rawDelNameStr = String(delNameRaw).trim();
          const matchedDel = activeDelegates.find(d => normalizeArabic(d) === normalizeArabic(rawDelNameStr)) || rawDelNameStr;

          const targetWeight = Number(findVal((k) => (k.includes('هدف') || k.includes('تاركت') || k.includes('target')) && (k.includes('وزن') || k.includes('كغم') || k.includes('kg')) && !k.includes('محل') && !k.includes('زبون') && !k.includes('عميل'))) || 0;

          const salesWeight = Number(findVal((k) => (k.includes('مبيعات') || k.includes('بيع') || k.includes('sales')) && (k.includes('وزن') || k.includes('كغم') || k.includes('kg')))) || 0;

          const targetShops = Number(findVal((k) => k.includes('مستهدف') || (k.includes('target') && (k.includes('cust') || k.includes('shop') || k.includes('client'))))) || 0;

          // Acceptable shops: matches any key with مقبول or acceptable or منجز or تغطية
          const coveredShopsRaw = findVal((k) => k.includes('مقبول') || k.includes('acceptable') || k.includes('منجز') || (k.includes('تغطية') && !k.includes('حافز')));
          const coveredShops = coveredShopsRaw !== undefined ? Number(coveredShopsRaw) || 0 : 0;

          const docId = `del_${matchedDel}`.replace(/[\/\s#$[\]]/g, '_');
          const docRef = doc(db, 'additional_target_configs', docId);
          await setDoc(docRef, {
            delegateName: matchedDel,
            smallMonthlyWeightTargetKg: targetWeight > 0 ? targetWeight : 390,
            smallTargetShopsCount: targetShops > 0 ? targetShops : 15,
            smallMinWeightPerShopKg: 7.5,
            smallCoveredShopsCount: coveredShops,
            smallMonthlySalesWeightKg: salesWeight,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser?.name || 'الأدمن',
          }, { merge: true });

          updatedDelegatesCount++;

          const synth = createMilkSyntheticEntries(matchedDel, salesWeight, coveredShops, rowIndex, activeDate, activeMonthStr, 'small');
          if (synth.length > 0) {
            parsedEntries.push(...synth);
          }
        }

        const existingQuery = query(collection(db, 'additional_target_sales'), where('monthString', '==', activeMonthStr));
        const existingSnap = await getDocs(existingQuery);
        const deleteOps = existingSnap.docs
          .filter((d) => classifyMilkBottle(d.data()) === 'small')
          .map((d) => doc(db, 'additional_target_sales', d.id));

        const batchOps = parsedEntries.map((entry) => ({ ref: doc(db, 'additional_target_sales', entry.id), data: entry }));
        const totalOps = [
          ...deleteOps.map((ref) => ({ ref, isDelete: true, data: null })),
          ...batchOps.map((b) => ({ ref: b.ref, isDelete: false, data: b.data })),
        ];

        for (let i = 0; i < totalOps.length; i += 400) {
          const batch = writeBatch(db);
          totalOps.slice(i, i + 400).forEach((op) => {
            if (op.isDelete) batch.delete(op.ref);
            else if (op.data) batch.set(op.ref, op.data, { merge: true });
          });
          await batch.commit();
        }
        // Backup uploaded Excel to Supabase Storage Bucket ('sales-bucket')
        uploadExcelToSupabaseStorage(file, {
          uploadedBy: currentUser?.name || 'مدير النظام',
          targetType: 'small-milk-uploads',
          description: `ملف مبيعات حليب صغير لشهر ${activeMonthStr}`,
        }).catch((err) => console.warn('Supabase storage backup notice:', err));

        setUserMessage(`تم استيراد وتحديث ${updatedDelegatesCount} مندوب ومزامنتها بنجاح (المحلات المقبولة: محدثة بدقة) 🍼📥✅`);
      } catch (err) {
        console.error(err);
        setUserMessage('حدث خطأ أثناء معالجة ملف الحليب الصغير');
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [userMessage, setUserMessage] = useState<string | null>(null);



  // Config Modal State
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showLockedConditionModal, setShowLockedConditionModal] = useState<boolean>(false);
  const [lockedModalDelegateName, setLockedModalDelegateName] = useState<string | null>(null);
  const [lockedModalType, setLockedModalType] = useState<'family' | 'small' | 'willie'>('family');
  const [configTab, setConfigTab] = useState<'milk' | 'willie'>('milk');
  const [editDelegate, setEditDelegate] = useState<string>('all');
  const [editFamTarget, setEditFamTarget] = useState<number>(1040);
  const [editFamShops, setEditFamShops] = useState<number>(15);
  const [editFamMinWeight, setEditFamMinWeight] = useState<number>(11.5);
  const [editSmTarget, setEditSmTarget] = useState<number>(390);
  const [editSmShops, setEditSmShops] = useState<number>(15);
  const [editSmMinWeight, setEditSmMinWeight] = useState<number>(7.5);
  const [editWillieTarget, setEditWillieTarget] = useState<number>(182);
  const [editWillieShops, setEditWillieShops] = useState<number>(10);
  const [editWillieMinWeight, setEditWillieMinWeight] = useState<number>(4.0);
  const [editIsLocked, setEditIsLocked] = useState<boolean>(false);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);

  // Auto dismiss user notification messages
  useEffect(() => {
    if (userMessage) {
      const timer = setTimeout(() => setUserMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [userMessage]);

  // Sync Target Configs with Firestore
  useEffect(() => {
    if (isGlobalQuotaExceeded()) return;
    const unsub = safeOnSnapshot(
      collection(db, 'additional_target_configs'),
      (snap: any) => {
        const list: AdditionalTargetConfig[] = [];
        snap.forEach((d: any) => {
          list.push({ id: d.id, ...d.data() } as AdditionalTargetConfig);
        });
        setConfigs(list);
        try {
          localStorage.setItem('cache_additional_target_configs', JSON.stringify(list));
        } catch {}
      },
      (err) => logFirestoreErrorGracefully(err, 'additional_target_configs'),
      'additional_target_configs'
    );
    return () => unsub();
  }, []);

  // Sync Monthly Sales Entries with Firestore
  useEffect(() => {
    if (isGlobalQuotaExceeded()) return;
    const q = query(
      collection(db, 'additional_target_sales'),
      where('monthString', '==', activeMonthStr)
    );
    const unsub = safeOnSnapshot(
      q,
      (snap: any) => {
        const list: AdditionalTargetSalesEntry[] = [];
        snap.forEach((d: any) => {
          list.push({ id: d.id, ...d.data() } as AdditionalTargetSalesEntry);
        });
        setSalesEntries(list);
        try {
          localStorage.setItem('cache_additional_target_sales', JSON.stringify(list));
        } catch {}
      },
      (err) => logFirestoreErrorGracefully(err, 'additional_target_sales'),
      'additional_target_sales'
    );
    return () => unsub();
  }, [activeMonthStr]);

  // Helper to fetch target config for a delegate
  const getDelegateConfig = (delName: string): AdditionalTargetConfig => {
    const norm = normalizeArabic(delName);
    const found = configs.find((c) => normalizeArabic(c.delegateName) === norm);
    if (found) {
      return {
        ...found,
        familyMinWeightPerShopKg: found.familyMinWeightPerShopKg ?? 11.5,
        smallMinWeightPerShopKg: (!found.smallMinWeightPerShopKg || found.smallMinWeightPerShopKg === 4.0) ? 7.5 : found.smallMinWeightPerShopKg,
        willieMinWeightPerShopKg: found.willieMinWeightPerShopKg ?? 4.0,
      };
    }
    return {
      delegateName: delName,
      familyMonthlyWeightTargetKg: 1040,
      familyTargetShopsCount: 15,
      familyMinWeightPerShopKg: 11.5,
      smallMonthlyWeightTargetKg: 390,
      smallTargetShopsCount: 15,
      smallMinWeightPerShopKg: 7.5,
      willieMonthlyWeightTargetKg: 182,
      willieTargetShopsCount: 10,
      willieMinWeightPerShopKg: 4.0,
      isLocked: false,
    };
  };

  // Open Target Config Modal with specific product category focus ('milk' | 'willie')
  const handleOpenConfigModal = (delName: string, tab: 'milk' | 'willie' = 'milk') => {
    setEditDelegate(delName);
    setConfigTab(tab);
    if (delName === 'all') {
      setEditFamTarget(1040);
      setEditFamShops(15);
      setEditFamMinWeight(11.5);
      setEditSmTarget(390);
      setEditSmShops(15);
      setEditSmMinWeight(7.5);
      setEditWillieTarget(182);
      setEditWillieShops(10);
      setEditWillieMinWeight(4.0);
      setEditIsLocked(false);
    } else {
      const cfg = getDelegateConfig(delName);
      setEditFamTarget(cfg.familyMonthlyWeightTargetKg);
      setEditFamShops(cfg.familyTargetShopsCount);
      setEditFamMinWeight(cfg.familyMinWeightPerShopKg);
      setEditSmTarget(cfg.smallMonthlyWeightTargetKg);
      setEditSmShops(cfg.smallTargetShopsCount);
      setEditSmMinWeight(cfg.smallMinWeightPerShopKg ?? 7.5);
      setEditWillieTarget(cfg.willieMonthlyWeightTargetKg ?? 182);
      setEditWillieShops(cfg.willieTargetShopsCount ?? 10);
      setEditWillieMinWeight(cfg.willieMinWeightPerShopKg ?? 4.0);
      setEditIsLocked(Boolean(cfg.isLocked));
    }
    setShowConfigModal(true);
  };

  // Download Willie Sales Data excel file
  const downloadWillieSalesData = () => {
    // Filter Willie sales entries for current active month
    const willieEntries = salesEntries.filter((s) => classifyWillieProduct(s));

    // Sheet 1: Willie Detailed Visited Shops & Sales Entries
    const detailedHeaders = [
      'اسم المندوب (DelegateName)',
      'كود المحل (CustomerCode)',
      'اسم المحل (CustomerName)',
      'كود المنتج (ProductCode)',
      'اسم المنتج (ProductName)',
      'الوزن المباع (SALESWeightKg)',
      'تاريخ البيع',
      'شرط القبول (≥ 4.0 كغم)'
    ];

    const detailedRows = willieEntries.map((entry) => [
      entry.delegateName,
      entry.customerCode || '',
      entry.customerName || '',
      entry.productCode || '',
      entry.productName || '',
      Number(entry.salesWeightKg) || 0,
      entry.dateString || activeDate,
      (Number(entry.salesWeightKg) || 0) >= 4.0 ? 'مقبول (≥ 4 كغم)' : 'غير مكتمل (< 4 كغم)'
    ]);

    // Sheet 2: Willie Summary Dashboard & Incentives per Preseller
    const summaryHeaders = [
      'اسم المندوب',
      'هدف الوزن (كغم)',
      'مبيعات الوزن (كغم)',
      'حافز الوزن',
      'المحلات المستهدفة',
      'المحلات المقبولة (≥ 4 كغم)',
      'حافز التغطية',
      'إجمالي الحافز'
    ];

    const summaryRows = delegatesAnalysis.map((item) => [
      item.delegateName,
      `${Math.round(item.willieTargetWeight)} كغم`,
      `${Math.round(item.totalWillieWeight)} كغم (${item.willieWeightPct.toFixed(0)}%)`,
      item.hasWillieSalesIncentiveUnlocked ? '32,500 د.ع' : !item.hasWillie100Coverage ? 'مقفل بالشرط' : '0 د.ع',
      `${Math.round(item.willieTargetShops)} محل`,
      `${Math.round(item.willieCoveredCount)} محل (${item.willieCoveragePct.toFixed(0)}%)`,
      `${formatWithCommas(item.willieCoverageIncentiveEarned)} د.ع`,
      `${formatWithCommas(item.willieTotalIncentive)} د.ع`
    ]);

    const wb = XLSX.utils.book_new();

    const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص_حوافز_ويلي');

    const wsDetailed = XLSX.utils.aoa_to_sheet([detailedHeaders, ...detailedRows]);
    XLSX.utils.book_append_sheet(wb, wsDetailed, 'سجلات_مبيعات_ويلي');

    XLSX.writeFile(wb, `بيانات_مبيعات_ويلي_${activeMonthStr}.xlsx`);
    setUserMessage('تم تحميل بيانات ومبيعات ويلي بنجاح 🧀📥');
  };

  // Save Target Configs to Firestore
  const handleSaveConfigs = async () => {
    try {
      setIsSavingConfig(true);
      const batch = writeBatch(db);

      const targetData: Omit<AdditionalTargetConfig, 'delegateName' | 'id'> = {
        familyMonthlyWeightTargetKg: Number(editFamTarget) || 0,
        familyTargetShopsCount: Number(editFamShops) || 0,
        familyMinWeightPerShopKg: Number(editFamMinWeight) || 11.5,
        smallMonthlyWeightTargetKg: Number(editSmTarget) || 0,
        smallTargetShopsCount: Number(editSmShops) || 0,
        smallMinWeightPerShopKg: Number(editSmMinWeight) || 7.5,
        willieMonthlyWeightTargetKg: Number(editWillieTarget) || 0,
        willieTargetShopsCount: Number(editWillieShops) || 0,
        willieMinWeightPerShopKg: Number(editWillieMinWeight) || 4.0,
        isLocked: editIsLocked,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || 'الأدمن',
      };

      if (editDelegate === 'all') {
        activeDelegates.forEach((del) => {
          const docId = `del_${del}`.replace(/[\/\s#$[\]]/g, '_');
          const docRef = doc(db, 'additional_target_configs', docId);
          batch.set(docRef, { ...targetData, delegateName: del }, { merge: true });
        });
      } else {
        const docId = `del_${editDelegate}`.replace(/[\/\s#$[\]]/g, '_');
        const docRef = doc(db, 'additional_target_configs', docId);
        batch.set(docRef, { ...targetData, delegateName: editDelegate }, { merge: true });
      }

      await batch.commit();
      setShowConfigModal(false);
      setUserMessage('تم حفظ وتثبيت الأهداف الشهرية بنجاح 🎯✅');
    } catch (err: any) {
      console.error('Error saving target configs:', err);
      setUserMessage('حدث خطأ أثناء حفظ الأهداف');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Helper to generate synthetic Willie shop entries preserving EXACT sales weight and covered count
  const createWillieSyntheticEntries = (
    delName: string,
    salesWeight: number,
    coveredShops: number,
    rowIndex: number,
    actDate: string,
    actMonthStr: string
  ): AdditionalTargetSalesEntry[] => {
    const entries: AdditionalTargetSalesEntry[] = [];
    if (salesWeight <= 0 && coveredShops <= 0) return entries;

    const minPerShop = 4.0;
    const countCovered = Math.max(0, coveredShops);

    if (countCovered > 0) {
      const totalWeight = Math.max(salesWeight, countCovered * minPerShop);
      const perShop = totalWeight / countCovered;

      for (let c = 1; c <= countCovered; c++) {
        const isLast = c === countCovered;
        const prevSum = (c - 1) * Math.round(perShop);
        const shopWeight = isLast ? Math.round(totalWeight - prevSum) : Math.round(perShop);

        entries.push({
          id: `sale_${actDate}_${normalizeArabic(delName)}_WSHOP_${c}_${rowIndex}`,
          delegateName: delName,
          customerCode: `WSHOP_${c}`,
          customerName: `محل ويلي ${c}`,
          productCode: 'WILLIE-CHEESE',
          productName: 'جبن ويلي بيضوي',
          categoryName: 'ويلي',
          salesWeightKg: Math.max(minPerShop, shopWeight),
          dateString: actDate,
          monthString: actMonthStr,
          uploadedAt: new Date().toISOString(),
        });
      }
    } else if (salesWeight > 0) {
      entries.push({
        id: `sale_${actDate}_${normalizeArabic(delName)}_WSHOP_0_${rowIndex}`,
        delegateName: delName,
        customerCode: `WSHOP_0`,
        customerName: `محل ويلي غير مؤهل`,
        productCode: 'WILLIE-CHEESE',
        productName: 'جبن ويلي بيضوي',
        categoryName: 'ويلي',
        salesWeightKg: Math.min(salesWeight, 3.5),
        dateString: actDate,
        monthString: actMonthStr,
        uploadedAt: new Date().toISOString(),
      });
    }

    return entries;
  };

  // Excel Upload Handler matching [DelegateName, CustomerCode, CustomerName, ProductCode, ProductName, SALESWeightKg]
  const handleExcelUpload = (file: File) => {
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);

        if (!rows || rows.length === 0) {
          setUserMessage('الملف فارغ أو لا يحتوي على بيانات صالحة');
          setIsUploading(false);
          return;
        }

        const cleanKey = (k: string) => String(k || '').trim().toLowerCase().replace(/[\s_-]/g, '');

        const getVal = (row: any, ...keys: string[]) => {
          const rowKeys = Object.keys(row);
          for (const k of keys) {
            if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
            const targetClean = cleanKey(k);
            const foundKey = rowKeys.find((rk) => cleanKey(rk) === targetClean);
            if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) return row[foundKey];
          }
          return undefined;
        };

        const parsedEntries: AdditionalTargetSalesEntry[] = [];
        let rowIndex = 0;

        rows.forEach((row: any) => {
          rowIndex++;
          const delNameRaw = getVal(row, 'DelegateName', 'Delegate Name', 'اسم المندوب', 'المندوب', 'مندوب', 'Preseller Name', 'Preseller');
          if (!delNameRaw) return;

          const rawDelNameStr = String(delNameRaw).trim();
          const matchedDel = activeDelegates.find(d => normalizeArabic(d) === normalizeArabic(rawDelNameStr)) || rawDelNameStr;
          const delName = matchedDel;

          // Check if this row is a Willie Summary Row (matching image_be325a5c.png)
          const rowKeys = Object.keys(row);
          const findKeyVal = (predicate: (cleanKey: string) => boolean) => {
            for (const rk of rowKeys) {
              const clean = normalizeArabic(rk).replace(/[\s_-]/g, '');
              if (predicate(clean)) {
                const val = row[rk];
                if (val !== undefined && val !== null && String(val).trim() !== '') return val;
              }
            }
            return undefined;
          };

          const isWillieSummary =
            getVal(row, 'هدف الوزن (كغم)', 'هدف الوزن', 'Daily Target KG', 'Target KG', 'المحلات المستهدفة', 'Target Customer') !== undefined ||
            getVal(row, 'مبيعات الوزن (كغم)', 'مبيعات الوزن', 'Daily Sales Kg', 'Sales Kg') !== undefined;

          if (isWillieSummary) {
            const targetWeight = Number(getVal(row, 'هدف الوزن (كغم)', 'هدف الوزن', 'Daily Target KG', 'Target KG') || findKeyVal((k) => k.includes('هدف') && k.includes('وزن'))) || 0;
            const salesWeight = Number(getVal(row, 'مبيعات الوزن (كغم)', 'مبيعات الوزن', 'Daily Sales Kg', 'Sales Kg', 'SalesKG') || findKeyVal((k) => k.includes('مبيعات') && k.includes('وزن'))) || 0;
            const targetShops = Number(getVal(row, 'المحلات المستهدفة', 'Target Customer', 'Target Cust') || findKeyVal((k) => k.includes('مستهدف'))) || 0;
            const coveredShops = Number(getVal(row, 'المحلات المقبولة (≥ 4 كغم)', 'المحلات المقبولة', 'Acceptable Customer', 'AcceptableCust') || findKeyVal((k) => k.includes('مقبول') || k.includes('acceptable') || k.includes('منجز') || (k.includes('تغطية') && !k.includes('حافز')))) || 0;

            if (targetWeight > 0 || targetShops > 0 || salesWeight > 0 || coveredShops > 0) {
              const docId = `del_${matchedDel}`.replace(/[\/\s#$[\]]/g, '_');
              const docRef = doc(db, 'additional_target_configs', docId);
              setDoc(
                docRef,
                {
                  delegateName: matchedDel,
                  willieMonthlyWeightTargetKg: targetWeight > 0 ? targetWeight : 182,
                  willieTargetShopsCount: targetShops > 0 ? targetShops : 10,
                  willieMinWeightPerShopKg: 4.0,
                  willieCoveredShopsCount: coveredShops,
                  willieMonthlySalesWeightKg: salesWeight,
                  updatedAt: new Date().toISOString(),
                  updatedBy: currentUser?.name || 'الأدمن',
                },
                { merge: true }
              ).catch((err) => console.error('Error updating Willie config from excel:', err));
            }

            if (salesWeight > 0 || coveredShops > 0) {
              const synth = createWillieSyntheticEntries(matchedDel, salesWeight, coveredShops, rowIndex, activeDate, activeMonthStr);
              parsedEntries.push(...synth);
            }
            return;
          }

          // Detailed row parsing (standard)
          const custCode = String(getVal(row, 'CustomerCode', 'Customer Code', 'كود العميل', 'كود المحل', 'كود') || `CUST_${rowIndex}`);
          const custName = String(getVal(row, 'CustomerName', 'Customer Name', 'اسم العميل', 'اسم المحل', 'المحل') || custCode);
          const prodCode = String(getVal(row, 'ProductCode', 'Product Code', 'كود المنتج', 'رمز المادة') || '');
          const prodName = String(getVal(row, 'ProductName', 'Product Name', 'اسم المنتج', 'المادة') || prodCode);
          const catName = String(getVal(row, 'CategoryName', 'Category Name', 'اسم الصنف', 'الصنف') || '');
          const weightRaw = getVal(
            row,
            'SALESWeightKg',
            'salesWeightKg',
            'SalesWeightKg',
            'SalesWeight',
            'sales_weight_kg',
            'الوزن',
            'وزن المبيعات',
            'الوزن كغم',
            'مبيعات الوزن (كغم)',
            'مبيعات الوزن'
          );
          const salesWeightKg = Number(weightRaw) || 0;

          if (salesWeightKg > 0 || prodName) {
            parsedEntries.push({
              id: `sale_${activeDate}_${normalizeArabic(delName)}_${normalizeArabic(custCode)}_${rowIndex}`,
              delegateName: delName,
              customerCode: custCode,
              customerName: custName,
              productCode: prodCode,
              productName: prodName,
              categoryName: catName,
              salesWeightKg,
              dateString: activeDate,
              monthString: activeMonthStr,
              uploadedAt: new Date().toISOString(),
            });
          }
        });

        if (parsedEntries.length === 0) {
          setUserMessage('تم تحديث إعدادات التاركتات للويلي بنجاح 🎯');
          setIsUploading(false);
          return;
        }

        // Delete existing entries for this dateString to avoid duplicates upon re-upload
        const existingQuery = query(
          collection(db, 'additional_target_sales'),
          where('dateString', '==', activeDate)
        );
        const existingSnap = await getDocs(existingQuery);
        const deleteOps = existingSnap.docs.map((d) => doc(db, 'additional_target_sales', d.id));

        // Save new parsed sales in Firestore batches (max 450 per batch)
        // If upload contains Willie entries, delete all existing Willie entries for the active month
        const hasWillieData = parsedEntries.some((e) => classifyWillieProduct(e));
        
        let existingDeleteRefs: any[] = [];
        if (hasWillieData) {
          const monthQuery = query(
            collection(db, 'additional_target_sales'),
            where('monthString', '==', activeMonthStr)
          );
          const monthSnap = await getDocs(monthQuery);
          existingDeleteRefs = monthSnap.docs
            .filter((d) => classifyWillieProduct(d.data()))
            .map((d) => doc(db, 'additional_target_sales', d.id));
        } else {
          const existingQuery = query(
            collection(db, 'additional_target_sales'),
            where('dateString', '==', activeDate)
          );
          const existingSnap = await getDocs(existingQuery);
          existingDeleteRefs = existingSnap.docs.map((d) => doc(db, 'additional_target_sales', d.id));
        }

        const batchOps = parsedEntries.map((entry) => ({
          ref: doc(db, 'additional_target_sales', entry.id),
          data: entry,
        }));

        const chunkSize = 450;
        const totalOps = [
          ...existingDeleteRefs.map((ref) => ({ ref, isDelete: true, data: null })),
          ...batchOps.map((b) => ({ ref: b.ref, isDelete: false, data: b.data })),
        ];

        for (let i = 0; i < totalOps.length; i += chunkSize) {
          const batch = writeBatch(db);
          const chunk = totalOps.slice(i, i + chunkSize);
          chunk.forEach((op) => {
            if (op.isDelete) {
              batch.delete(op.ref);
            } else if (op.data) {
              batch.set(op.ref, op.data, { merge: true });
            }
          });
          await batch.commit();
        }

        // Backup uploaded Excel to Supabase Storage Bucket ('sales-bucket')
        uploadExcelToSupabaseStorage(file, {
          uploadedBy: currentUser?.name || 'مدير النظام',
          targetType: 'general-sales-uploads',
          description: `ملف مبيعات إكسل شامل لشهر ${activeMonthStr}`,
        }).catch((err) => console.warn('Supabase storage backup notice:', err));

        setUserMessage(`تم إفراغ البيانات القديمة واستيراد ${parsedEntries.length} سجل مبيعات وتحديث أرقام الحليب والويلي والحوافز بنجاح 📥✅`);
      } catch (err: any) {
        console.error('Error parsing and uploading excel:', err);
        setUserMessage('حدث خطأ أثناء معالجة ملف الإكسل');
      } finally {
        setIsUploading(false);
      }
    };
    reader.onerror = () => {
      setIsUploading(false);
      setUserMessage('حدث خطأ أثناء قراءة الملف');
    };
    reader.readAsArrayBuffer(file);
  };

  // Dedicated Willie Excel Upload Handler: Completely clears old Willie values/coverage for active month & replaces with new file
  const handleWillieUpload = (file: File) => {
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);

        if (!rows || rows.length === 0) {
          setUserMessage('ملف الويلي فارغ أو لا يحتوي على بيانات صالحة');
          setIsUploading(false);
          return;
        }

        const cleanKey = (k: string) => String(k || '').trim().toLowerCase().replace(/[\s_-]/g, '');

        const getVal = (row: any, ...keys: string[]) => {
          const rowKeys = Object.keys(row);
          for (const k of keys) {
            if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
            const targetClean = cleanKey(k);
            const foundKey = rowKeys.find((rk) => cleanKey(rk) === targetClean);
            if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) return row[foundKey];
          }
          return undefined;
        };

        const parsedEntries: AdditionalTargetSalesEntry[] = [];
        let rowIndex = 0;

        for (const row of rows as any[]) {
          rowIndex++;
          const delNameRaw = getVal(row, 'DelegateName', 'Delegate Name', 'اسم المندوب', 'المندوب', 'مندوب', 'Preseller Name', 'Preseller');
          if (!delNameRaw) continue;

          const rawDelNameStr = String(delNameRaw).trim();
          const matchedDel = activeDelegates.find(d => normalizeArabic(d) === normalizeArabic(rawDelNameStr)) || rawDelNameStr;
          const delName = matchedDel;

          const rowKeys = Object.keys(row);
          const findKeyVal = (predicate: (cleanKey: string) => boolean) => {
            for (const rk of rowKeys) {
              const clean = normalizeArabic(rk).replace(/[\s_-]/g, '');
              if (predicate(clean)) {
                const val = row[rk];
                if (val !== undefined && val !== null && String(val).trim() !== '') return val;
              }
            }
            return undefined;
          };

          const isWillieSummary =
            getVal(row, 'هدف الوزن (كغم)', 'هدف الوزن', 'Daily Target KG', 'Target KG', 'المحلات المستهدفة', 'Target Customer') !== undefined ||
            getVal(row, 'مبيعات الوزن (كغم)', 'مبيعات الوزن', 'Daily Sales Kg', 'Sales Kg') !== undefined;

          if (isWillieSummary) {
            const targetWeight = Number(getVal(row, 'هدف الوزن (كغم)', 'هدف الوزن', 'Daily Target KG', 'Target KG') || findKeyVal((k) => k.includes('هدف') && k.includes('وزن'))) || 0;
            const salesWeight = Number(getVal(row, 'مبيعات الوزن (كغم)', 'مبيعات الوزن', 'Daily Sales Kg', 'Sales Kg', 'SalesKG') || findKeyVal((k) => k.includes('مبيعات') && k.includes('وزن'))) || 0;
            const targetShops = Number(getVal(row, 'المحلات المستهدفة', 'Target Customer', 'Target Cust') || findKeyVal((k) => k.includes('مستهدف'))) || 0;
            const coveredShops = Number(getVal(row, 'المحلات المقبولة (≥ 4 كغم)', 'المحلات المقبولة', 'Acceptable Customer', 'AcceptableCust') || findKeyVal((k) => k.includes('مقبول') || k.includes('acceptable') || k.includes('منجز') || (k.includes('تغطية') && !k.includes('حافز')))) || 0;

            if (targetWeight > 0 || targetShops > 0 || salesWeight > 0 || coveredShops > 0) {
              const docId = `del_${matchedDel}`.replace(/[\/\s#$[\]]/g, '_');
              const docRef = doc(db, 'additional_target_configs', docId);
              await setDoc(
                docRef,
                {
                  delegateName: matchedDel,
                  willieMonthlyWeightTargetKg: targetWeight > 0 ? targetWeight : 182,
                  willieTargetShopsCount: targetShops > 0 ? targetShops : 10,
                  willieMinWeightPerShopKg: 4.0,
                  willieCoveredShopsCount: coveredShops,
                  willieMonthlySalesWeightKg: salesWeight,
                  updatedAt: new Date().toISOString(),
                  updatedBy: currentUser?.name || 'الأدمن',
                },
                { merge: true }
              );
            }

            if (salesWeight > 0 || coveredShops > 0) {
              const synth = createWillieSyntheticEntries(matchedDel, salesWeight, coveredShops, rowIndex, activeDate, activeMonthStr);
              parsedEntries.push(...synth);
            }
            continue;
          }

          // Detailed row parsing for Willie
          const custCode = String(getVal(row, 'CustomerCode', 'Customer Code', 'كود العميل', 'كود المحل', 'كود') || `CUST_${rowIndex}`);
          const custName = String(getVal(row, 'CustomerName', 'Customer Name', 'اسم العميل', 'اسم المحل', 'المحل') || custCode);
          const prodCode = String(getVal(row, 'ProductCode', 'Product Code', 'كود المنتج', 'رمز المادة') || 'WILLIE-CHEESE');
          const prodName = String(getVal(row, 'ProductName', 'Product Name', 'اسم المنتج', 'المادة') || 'جبن ويلي بيضوي');
          const catName = String(getVal(row, 'CategoryName', 'Category Name', 'اسم الصنف', 'الصنف') || 'ويلي');
          const weightRaw = getVal(
            row,
            'SALESWeightKg',
            'salesWeightKg',
            'SalesWeightKg',
            'SalesWeight',
            'sales_weight_kg',
            'الوزن',
            'وزن المبيعات',
            'الوزن كغم',
            'مبيعات الوزن (كغم)',
            'مبيعات الوزن'
          );
          const salesWeightKg = Number(weightRaw) || 0;

          if (salesWeightKg > 0 || prodName) {
            parsedEntries.push({
              id: `sale_${activeDate}_${normalizeArabic(delName)}_${normalizeArabic(custCode)}_${rowIndex}`,
              delegateName: delName,
              customerCode: custCode,
              customerName: custName,
              productCode: prodCode,
              productName: prodName,
              categoryName: catName,
              salesWeightKg,
              dateString: activeDate,
              monthString: activeMonthStr,
              uploadedAt: new Date().toISOString(),
            });
          }
        }

        // STEP 1: Query and DELETE ALL existing Willie sales entries for current month to guarantee complete reset & replacement
        const existingQuery = query(
          collection(db, 'additional_target_sales'),
          where('monthString', '==', activeMonthStr)
        );
        const existingSnap = await getDocs(existingQuery);
        const deleteOps = existingSnap.docs
          .filter((d) => classifyWillieProduct(d.data()))
          .map((d) => doc(db, 'additional_target_sales', d.id));

        // STEP 2: Write batch operation (Delete old + insert new parsed entries)
        const batchOps = parsedEntries.map((entry) => ({
          ref: doc(db, 'additional_target_sales', entry.id),
          data: entry,
        }));

        const chunkSize = 400;
        const totalOps = [
          ...deleteOps.map((ref) => ({ ref, isDelete: true, data: null })),
          ...batchOps.map((b) => ({ ref: b.ref, isDelete: false, data: b.data })),
        ];

        for (let i = 0; i < totalOps.length; i += chunkSize) {
          const batch = writeBatch(db);
          const chunk = totalOps.slice(i, i + chunkSize);
          chunk.forEach((op) => {
            if (op.isDelete) {
              batch.delete(op.ref);
            } else if (op.data) {
              batch.set(op.ref, op.data, { merge: true });
            }
          });
          await batch.commit();
        }

        // Backup uploaded Excel to Supabase Storage Bucket ('sales-bucket')
        uploadExcelToSupabaseStorage(file, {
          uploadedBy: currentUser?.name || 'مدير النظام',
          targetType: 'willie-uploads',
          description: `ملف مبيعات ويلي لشهر ${activeMonthStr}`,
        }).catch((err) => console.warn('Supabase storage backup notice:', err));

        setUserMessage(`تم إفراغ البيانات القديمة واستيراد ${parsedEntries.length} سجل مبيعات وتغطية جديد للويلي بنجاح 🧀📥✅`);
      } catch (err: any) {
        console.error('Error parsing and uploading Willie excel:', err);
        setUserMessage('حدث خطأ أثناء معالجة ملف الإكسل للويلي');
      } finally {
        setIsUploading(false);
      }
    };
    reader.onerror = () => {
      setIsUploading(false);
      setUserMessage('حدث خطأ أثناء قراءة الملف');
    };
    reader.readAsArrayBuffer(file);
  };

  // Download Sample Excel Template matching user's exact specification
  const downloadSampleTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];
    const headers = ['DelegateName', 'CustomerCode', 'CustomerName', 'ProductCode', 'ProductName', 'SALESWeightKg'];
    const sampleRows = [
      headers,
      [sampleDelegates[0] || 'بكر بدران', '101', 'أسواق الهدى', 'MILK-FAM-1L', 'حليب بطل كبير سادة 1 لتر', 12.0],
      [sampleDelegates[0] || 'بكر بدران', '101', 'أسواق الهدى', 'MILK-SM-200ML', 'حليب بطل صغير فراولة 200مل', 5.0],
      [sampleDelegates[0] || 'بكر بدران', '101', 'أسواق الهدى', 'WILLIE-100G', 'جبن ويلي بيضوي 100غ', 6.0],
      [sampleDelegates[1] || 'فيصل فؤاد', '102', 'ماركت الصفا', 'MILK-FAM-CHOC', 'حليب بطل كبير كاكاو 1 لتر', 24.0],
      [sampleDelegates[1] || 'فيصل فؤاد', '102', 'ماركت الصفا', 'MILK-SM-BANANA', 'حليب بطل صغير موز 200مل', 6.0],
      [sampleDelegates[1] || 'فيصل فؤاد', '102', 'ماركت الصفا', 'WILLIE-200G', 'جبن ويلي بيضوي 200غ', 8.0],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مبيعات_الهدف_الاضافي');
    XLSX.writeFile(wb, 'نموذج_مبيعات_الهدف_الاضافي.xlsx');
    setUserMessage('تم تنزيل نموذج مبيعات الإكسل بنجاح 📥🥛🧀');
  };

  // Download Sample Excel Template Specifically for Willie (ويلي) matching image_be325a5c.png
  const downloadWillieTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];

    // Sheet 1: Summary Import Format matching image_be325a5c.png
    const summaryHeaders = [
      'اسم المندوب',
      'هدف الوزن (كغم)',
      'مبيعات الوزن (كغم)',
      'حافز الوزن',
      'المحلات المستهدفة',
      'المحلات المقبولة (≥ 4 كغم)',
      'حافز التغطية',
      'إجمالي الحافز'
    ];

    const summaryRows = [
      summaryHeaders,
      [sampleDelegates[0] || 'بكر بدران', 182, 185, 32500, 10, 10, 32500, 65000],
      [sampleDelegates[1] || 'فيصل فؤاد', 182, 190, 32500, 10, 10, 32500, 65000],
      [sampleDelegates[2] || 'خلدون جمال', 182, 120, 0, 10, 6, 0, 0],
    ];

    // Sheet 2: Detailed Visited Shops Template
    const detailedHeaders = ['DelegateName', 'CustomerCode', 'CustomerName', 'ProductCode', 'ProductName', 'SALESWeightKg'];
    const detailedRows = [
      detailedHeaders,
      [sampleDelegates[0] || 'بكر بدران', '101', 'أسواق الهدى', 'WILLIE-100G', 'جبن ويلي بيضوي 100غ', 6.0],
      [sampleDelegates[0] || 'بكر بدران', '102', 'سوپرماركت الأمل', 'WILLIE-200G', 'جبن ويلي بيضوي 200غ', 8.0],
      [sampleDelegates[1] || 'فيصل فؤاد', '103', 'أسواق الصفا', 'WILLIE-100G', 'جبن ويلي بيضوي 100غ', 4.5],
      [sampleDelegates[1] || 'فيصل فؤاد', '104', 'ماركت البركة', 'WILLIE-200G', 'جبن ويلي بيضوي 200غ', 12.0],
    ];

    const wb = XLSX.utils.book_new();

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'نموذج_استيراد_ملخص_ويلي');

    const wsDetailed = XLSX.utils.aoa_to_sheet(detailedRows);
    XLSX.utils.book_append_sheet(wb, wsDetailed, 'تفاصيل_مبيعات_ويلي');

    XLSX.writeFile(wb, 'نموذج_استيراد_بيانات_الويلي.xlsx');
    setUserMessage('تم تنزيل نموذج استيراد بيانات الويلي بنجاح 🧀📥');
  };

  // Download Sample Excel Template Specifically for Family Milk
  const downloadFamilyTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];

    // Sheet 1: Summary Import Format
    const summaryHeaders = [
      'اسم المندوب',
      'هدف الوزن (كغم)',
      'مبيعات الوزن (كغم)',
      'حافز الوزن',
      'المحلات المستهدفة',
      'المحلات المقبولة (≥ 11.5 كغم)',
      'حافز التغطية',
      'إجمالي الحافز'
    ];

    const summaryRows = [
      summaryHeaders,
      [sampleDelegates[0] || 'بكر بدران', 500, 450, 32500, 50, 45, 32500, 65000],
      [sampleDelegates[1] || 'فيصل فؤاد', 500, 510, 32500, 50, 50, 32500, 65000],
      [sampleDelegates[2] || 'خلدون جمال', 500, 300, 0, 50, 30, 0, 0],
    ];

    // Sheet 2: Detailed Visited Shops Template
    const detailedHeaders = ['DelegateName', 'CustomerCode', 'CustomerName', 'ProductCode', 'ProductName', 'SALESWeightKg'];
    const detailedRows = [
      detailedHeaders,
      [sampleDelegates[0] || 'بكر بدران', '201', 'أسواق النور', 'MILK-FAM', 'حليب بطل كبير', 11.5],
      [sampleDelegates[0] || 'بكر بدران', '202', 'ميني ماركت السلام', 'MILK-FAM', 'حليب بطل كبير', 12.0],
    ];

    const wb = XLSX.utils.book_new();

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'نموذج_استيراد_ملخص_حليب_كبير');

    const wsDetailed = XLSX.utils.aoa_to_sheet(detailedRows);
    XLSX.utils.book_append_sheet(wb, wsDetailed, 'تفاصيل_مبيعات_حليب_كبير');

    XLSX.writeFile(wb, 'نموذج_استيراد_بيانات_الحليب_الكبير.xlsx');
    setUserMessage('تم تنزيل نموذج استيراد بيانات الحليب الكبير بنجاح 🥛📥');
  };

  // Download Sample Excel Template Specifically for Small Milk
  const downloadSmallTemplate = () => {
    const sampleDelegates = activeDelegates.length > 0 ? activeDelegates.slice(0, 3) : ['بكر بدران', 'فيصل فؤاد', 'خلدون جمال'];

    // Sheet 1: Summary Import Format
    const summaryHeaders = [
      'اسم المندوب',
      'هدف الوزن (كغم)',
      'مبيعات الوزن (كغم)',
      'حافز الوزن',
      'المحلات المستهدفة',
      'المحلات المقبولة (≥ 7.5 كغم)',
      'حافز التغطية',
      'إجمالي الحافز'
    ];

    const summaryRows = [
      summaryHeaders,
      [sampleDelegates[0] || 'بكر بدران', 300, 250, 32500, 50, 45, 32500, 65000],
      [sampleDelegates[1] || 'فيصل فؤاد', 300, 310, 32500, 50, 50, 32500, 65000],
      [sampleDelegates[2] || 'خلدون جمال', 300, 150, 0, 50, 20, 0, 0],
    ];

    // Sheet 2: Detailed Visited Shops Template
    const detailedHeaders = ['DelegateName', 'CustomerCode', 'CustomerName', 'ProductCode', 'ProductName', 'SALESWeightKg'];
    const detailedRows = [
      detailedHeaders,
      [sampleDelegates[0] || 'بكر بدران', '301', 'أسواق النور', 'MILK-SM', 'حليب بطل صغير', 7.5],
      [sampleDelegates[0] || 'بكر بدران', '302', 'ميني ماركت السلام', 'MILK-SM', 'حليب بطل صغير', 3.0],
    ];

    const wb = XLSX.utils.book_new();

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'نموذج_استيراد_ملخص_حليب_صغير');

    const wsDetailed = XLSX.utils.aoa_to_sheet(detailedRows);
    XLSX.utils.book_append_sheet(wb, wsDetailed, 'تفاصيل_مبيعات_حليب_صغير');

    XLSX.writeFile(wb, 'نموذج_استيراد_بيانات_الحليب_الصغير.xlsx');
    setUserMessage('تم تنزيل نموذج استيراد بيانات الحليب الصغير بنجاح 🍼📥');
  };

  // Calculations per Delegate
  const delegatesAnalysis = useMemo(() => {
    return activeDelegates.map((delName) => {
      const normDel = normalizeArabic(delName);
      const config = getDelegateConfig(delName);

      // Filter entries for this delegate in the current month
      const delSales = salesEntries.filter(
        (s) => normalizeArabic(s.delegateName) === normDel || s.delegateName === delName
      );

      // Shop grouping map
      const shopMap: Record<
        string,
        {
          customerCode: string;
          customerName: string;
          familyWeight: number;
          smallWeight: number;
          willieWeight: number;
          invoicesCount: number;
          isFamilyCovered: boolean;
          isSmallCovered: boolean;
          isWillieCovered: boolean;
        }
      > = {};

      let totalFamilyWeightFromShops = 0;
      let totalSmallWeightFromShops = 0;
      let totalWillieWeightFromShops = 0;

      delSales.forEach((entry) => {
        const isWillie = classifyWillieProduct(entry);
        const milkType = isWillie ? null : classifyMilkBottle(entry);

        const shopKey = (entry.customerCode || entry.customerName || 'محل').trim();
        if (!shopMap[shopKey]) {
          shopMap[shopKey] = {
            customerCode: entry.customerCode || '',
            customerName: entry.customerName || entry.customerCode || 'عميل',
            familyWeight: 0,
            smallWeight: 0,
            willieWeight: 0,
            invoicesCount: 0,
            isFamilyCovered: false,
            isSmallCovered: false,
            isWillieCovered: false,
          };
        }

        const weight = Number(entry.salesWeightKg) || 0;
        shopMap[shopKey].invoicesCount += 1;

        if (isWillie) {
          shopMap[shopKey].willieWeight += weight;
          totalWillieWeightFromShops += weight;
        } else if (milkType === 'family') {
          shopMap[shopKey].familyWeight += weight;
          totalFamilyWeightFromShops += weight;
        } else if (milkType === 'small') {
          shopMap[shopKey].smallWeight += weight;
          totalSmallWeightFromShops += weight;
        }
      });

      // Thresholds
      const minFam = config.familyMinWeightPerShopKg ?? 11.5;
      const minSm = (!config.smallMinWeightPerShopKg || config.smallMinWeightPerShopKg === 4.0) ? 7.5 : config.smallMinWeightPerShopKg;
      const minWillie = config.willieMinWeightPerShopKg ?? 4.0; // Minimum Accepted Order Threshold: 4.0 KG

      let familyCoveredCountFromShops = 0;
      let smallCoveredCountFromShops = 0;
      let willieCoveredCountFromShops = 0;

      const shopList = Object.values(shopMap).map((shop) => {
        shop.isFamilyCovered = shop.familyWeight >= minFam;
        shop.isSmallCovered = shop.smallWeight >= minSm;
        shop.isWillieCovered = shop.willieWeight >= minWillie;

        if (shop.isFamilyCovered) familyCoveredCountFromShops++;
        if (shop.isSmallCovered) smallCoveredCountFromShops++;
        if (shop.isWillieCovered) willieCoveredCountFromShops++;

        return shop;
      });

      // Section 1: Large Bottle Milk Metrics
      const familyTargetWeight = Math.round(config.familyMonthlyWeightTargetKg || 1040);
      const familyTargetShops = Math.round(config.familyTargetShopsCount || 15);
      const totalFamilyWeight = Math.round(typeof config.familyMonthlySalesWeightKg === 'number' ? config.familyMonthlySalesWeightKg : totalFamilyWeightFromShops);
      const familyCoveredCount = Math.round(typeof config.familyCoveredShopsCount === 'number' ? config.familyCoveredShopsCount : familyCoveredCountFromShops);
      const familyWeightPct = familyTargetWeight > 0 ? (totalFamilyWeight / familyTargetWeight) * 100 : 0;
      const familyCoveragePct = familyTargetShops > 0 ? (familyCoveredCount / familyTargetShops) * 100 : 0;

      // Incentive Rules Section 1 (Large Bottle Milk)
      const hasFamily100Coverage = familyCoveredCount >= familyTargetShops && familyTargetShops > 0;
      const familyCoverageIncentiveEarned = hasFamily100Coverage ? INCENTIVE_COVERAGE_AMOUNT : 0;

      const hasFamilySalesTarget = totalFamilyWeight >= familyTargetWeight && familyTargetWeight > 0;
      const hasFamilySalesIncentiveUnlocked = hasFamily100Coverage && hasFamilySalesTarget;
      const familySalesIncentiveEarned = hasFamilySalesIncentiveUnlocked ? INCENTIVE_SALES_AMOUNT : 0;

      const familyTotalIncentive = familyCoverageIncentiveEarned + familySalesIncentiveEarned;

      // Section 2: Small Bottle Milk Metrics
      const smallTargetWeight = Math.round(config.smallMonthlyWeightTargetKg || 390);
      const smallTargetShops = Math.round(config.smallTargetShopsCount || 15);
      const totalSmallWeight = Math.round(typeof config.smallMonthlySalesWeightKg === 'number' ? config.smallMonthlySalesWeightKg : totalSmallWeightFromShops);
      const smallCoveredCount = Math.round(typeof config.smallCoveredShopsCount === 'number' ? config.smallCoveredShopsCount : smallCoveredCountFromShops);
      const smallWeightPct = smallTargetWeight > 0 ? (totalSmallWeight / smallTargetWeight) * 100 : 0;
      const smallCoveragePct = smallTargetShops > 0 ? (smallCoveredCount / smallTargetShops) * 100 : 0;

      // Incentive Rules Section 2 (Small Bottle Milk)
      const hasSmall100Coverage = smallCoveredCount >= smallTargetShops && smallTargetShops > 0;
      const smallCoverageIncentiveEarned = hasSmall100Coverage ? INCENTIVE_COVERAGE_AMOUNT : 0;

      const hasSmallSalesTarget = totalSmallWeight >= smallTargetWeight && smallTargetWeight > 0;
      const hasSmallSalesIncentiveUnlocked = hasSmall100Coverage && hasSmallSalesTarget;
      const smallSalesIncentiveEarned = hasSmallSalesIncentiveUnlocked ? INCENTIVE_SALES_AMOUNT : 0;

      const smallTotalIncentive = smallCoverageIncentiveEarned + smallSalesIncentiveEarned;

      // Section 3: Willie (ويلي) Metrics
      const willieTargetWeight = Math.round(config.willieMonthlyWeightTargetKg ?? 182);
      const willieTargetShops = Math.round(config.willieTargetShopsCount ?? 10);
      const totalWillieWeight = Math.round(typeof config.willieMonthlySalesWeightKg === 'number' ? config.willieMonthlySalesWeightKg : totalWillieWeightFromShops);
      const willieCoveredCount = Math.round(typeof config.willieCoveredShopsCount === 'number' ? config.willieCoveredShopsCount : willieCoveredCountFromShops);
      const willieWeightPct = willieTargetWeight > 0 ? (totalWillieWeight / willieTargetWeight) * 100 : 0;
      const willieCoveragePct = willieTargetShops > 0 ? (willieCoveredCount / willieTargetShops) * 100 : 0;

      // Willie Incentive Calculation Rules (Reward Rules)
      // 1. Coverage Reward (Reward Cov = 32,500 IQD): Unlocked ONLY when %coverage >= 100%
      const hasWillie100Coverage = willieCoveredCount >= willieTargetShops && willieTargetShops > 0;
      const willieCoverageIncentiveEarned = hasWillie100Coverage ? INCENTIVE_COVERAGE_AMOUNT : 0;

      // 2. Sales Weight Reward (Reward KG = 32,500 IQD): LOCKED by default. Requires %coverage >= 100% FIRST to unlock.
      const hasWillieSalesTarget = totalWillieWeight >= willieTargetWeight && willieTargetWeight > 0;
      const hasWillieSalesIncentiveUnlocked = hasWillie100Coverage && hasWillieSalesTarget;
      const willieSalesIncentiveEarned = hasWillieSalesIncentiveUnlocked ? INCENTIVE_SALES_AMOUNT : 0;

      const willieTotalIncentive = willieCoverageIncentiveEarned + willieSalesIncentiveEarned;

      // Grand Total Incentives across Milk & Willie
      const grandTotalIncentive = familyTotalIncentive + smallTotalIncentive + willieTotalIncentive;

      return {
        delegateName: delName,
        config,

        // Large Bottle Milk
        totalFamilyWeight,
        familyTargetWeight,
        familyWeightPct,
        familyCoveredCount,
        familyTargetShops,
        familyCoveragePct,
        minFam,
        hasFamily100Coverage,
        hasFamilySalesTarget,
        hasFamilySalesIncentiveUnlocked,
        familyCoverageIncentiveEarned,
        familySalesIncentiveEarned,
        familyTotalIncentive,

        // Small Bottle Milk
        totalSmallWeight,
        smallTargetWeight,
        smallWeightPct,
        smallCoveredCount,
        smallTargetShops,
        smallCoveragePct,
        minSm,
        hasSmall100Coverage,
        hasSmallSalesTarget,
        hasSmallSalesIncentiveUnlocked,
        smallCoverageIncentiveEarned,
        smallSalesIncentiveEarned,
        smallTotalIncentive,

        // Willie (ويلي)
        totalWillieWeight,
        willieTargetWeight,
        willieWeightPct,
        willieCoveredCount,
        willieTargetShops,
        willieCoveragePct,
        minWillie,
        hasWillie100Coverage,
        hasWillieSalesTarget,
        hasWillieSalesIncentiveUnlocked,
        willieCoverageIncentiveEarned,
        willieSalesIncentiveEarned,
        willieTotalIncentive,

        // Combined
        grandTotalIncentive,
      };
    });
  }, [activeDelegates, configs, salesEntries]);

  // Selected single delegate data
  const currentDelegateData = useMemo(() => {
    if (activeDelegate === '__SUPERVISOR__' && isAdmin) return null;
    return delegatesAnalysis.find(
      (d) => normalizeArabic(d.delegateName) === normalizeArabic(activeDelegate) || d.delegateName === activeDelegate
    ) || delegatesAnalysis[0] || null;
  }, [activeDelegate, delegatesAnalysis, isAdmin]);

  // Grand totals across all delegates for category badges and progress bars
  const grandCategoryTotals = useMemo(() => {
    const totalFamWeight = delegatesAnalysis.reduce((s, d) => s + d.totalFamilyWeight, 0);
    const targetFamWeight = delegatesAnalysis.reduce((s, d) => s + d.familyTargetWeight, 0);
    const famPct = targetFamWeight > 0 ? (totalFamWeight / targetFamWeight) * 100 : 0;
    const famIncentives = delegatesAnalysis.reduce((s, d) => s + d.familyTotalIncentive, 0);
    const famCoveredCount = delegatesAnalysis.reduce((s, d) => s + d.familyCoveredCount, 0);
    const famTargetShops = delegatesAnalysis.reduce((s, d) => s + d.familyTargetShops, 0);

    const totalSmWeight = delegatesAnalysis.reduce((s, d) => s + d.totalSmallWeight, 0);
    const targetSmWeight = delegatesAnalysis.reduce((s, d) => s + d.smallTargetWeight, 0);
    const smPct = targetSmWeight > 0 ? (totalSmWeight / targetSmWeight) * 100 : 0;
    const smIncentives = delegatesAnalysis.reduce((s, d) => s + d.smallTotalIncentive, 0);
    const smCoveredCount = delegatesAnalysis.reduce((s, d) => s + d.smallCoveredCount, 0);
    const smTargetShops = delegatesAnalysis.reduce((s, d) => s + d.smallTargetShops, 0);

    const totalWillieWeight = delegatesAnalysis.reduce((s, d) => s + d.totalWillieWeight, 0);
    const targetWillieWeight = delegatesAnalysis.reduce((s, d) => s + d.willieTargetWeight, 0);
    const williePct = targetWillieWeight > 0 ? (totalWillieWeight / targetWillieWeight) * 100 : 0;
    const willieIncentives = delegatesAnalysis.reduce((s, d) => s + d.willieTotalIncentive, 0);
    const willieCoveredCount = delegatesAnalysis.reduce((s, d) => s + d.willieCoveredCount, 0);
    const willieTargetShops = delegatesAnalysis.reduce((s, d) => s + d.willieTargetShops, 0);

    const grandIncentives = delegatesAnalysis.reduce((s, d) => s + d.grandTotalIncentive, 0);

    return {
      totalFamWeight,
      targetFamWeight,
      famPct,
      famIncentives,
      famCoveredCount,
      famTargetShops,
      totalSmWeight,
      targetSmWeight,
      smPct,
      smIncentives,
      smCoveredCount,
      smTargetShops,
      totalWillieWeight,
      targetWillieWeight,
      williePct,
      willieIncentives,
      willieCoveredCount,
      willieTargetShops,
      grandIncentives,
    };
  }, [delegatesAnalysis]);

  return (
    <PullToRefresh onRefresh={async () => new Promise((r) => setTimeout(r, 400))}>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-5 space-y-6 dir-rtl animate-in fade-in duration-200">
        {/* User Notification Toast */}
        {userMessage && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-2xl bg-slate-900 text-white border border-slate-700 shadow-2xl text-xs sm:text-sm font-black flex items-center gap-2 animate-in slide-in-from-top-4">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>{userMessage}</span>
          </div>
        )}

        {/* 1. Header Banner */}
        <div
          className={`p-4 sm:p-6 rounded-3xl border shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all duration-300 ${
            isDarkMode
              ? 'bg-gradient-to-br from-[#0c1a36] via-[#09152e] to-[#040b1b] border-blue-500/30 text-white'
              : 'bg-gradient-to-r from-blue-50 via-white to-indigo-50/60 border-blue-200 text-slate-900'
          }`}
        >
          <div className="flex items-center gap-3.5 w-full md:w-auto">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white flex items-center justify-center shadow-lg shrink-0">
              <Award className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-blue-700 dark:text-blue-400">
                  الاضافي (Additional Target)
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                  حليب بطل وجبن ويلي
                </span>
                {!isAdmin && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>المندوب: {currentUser?.name}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                متابعة تاركتات الوزن الشهري، وتغطية المحلات لحليب بطل وجبن ويلي، واحتساب حوافز التغطية والمبيعات
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
                onChange={(e) => setActiveDate(e.target.value)}
                className="bg-transparent font-black outline-none text-slate-800 dark:text-slate-200 cursor-pointer"
              />
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Excel Upload Input */}
                <input
                  type="file"
                  ref={excelUploadRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelUpload(file);
                    e.target.value = '';
                  }}
                />

                {/* 1. Upload Sales Button */}
                <button
                  onClick={() => excelUploadRef.current?.click()}
                  disabled={isUploading}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  title="رفع ملف مبيعات إكسل: DelegateName | CustomerCode | CustomerName | ProductCode | ProductName | SALESWeightKg"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isUploading ? 'جاري الرفع...' : 'رفع مبيعات الإكسل'}</span>
                </button>

                {/* 2. Download Template Button */}
                <button
                  onClick={downloadSampleTemplate}
                  className="px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                  title="تنزيل نموذج إكسل عام مطابق للأعمدة المطلوبة"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">النموذج العام</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 1.1 Supabase Storage Buckets Verification Banner */}
        <div
          className={`p-3.5 sm:p-4 rounded-2xl border shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-3.5 ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                  حاويات التخزين السحابي (Supabase Storage Buckets):
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black flex items-center gap-1 ${
                    storageVerification.salesBucket
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                  title="حاوية ملفات وجداول الإكسل"
                >
                  <Check className="w-3 h-3 text-emerald-500" />
                  sales-bucket (الإكسل والمبيعات)
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black flex items-center gap-1 ${
                    storageVerification.invoiceImages
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                  title="حاوية لقطات وصور الفواتير"
                >
                  <Check className="w-3 h-3 text-emerald-500" />
                  invoice-images (صور الفواتير)
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black flex items-center gap-1 ${
                    storageVerification.productImages
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                  title="حاوية صور المنتجات والكتالوج"
                >
                  <Check className="w-3 h-3 text-emerald-500" />
                  product-images (صور المواد)
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                تكامل مباشر مع التخزين السحابي لتوليد مسارات عامة ومزامنة الفواتير وجداول مبيعات المندوبين
              </p>
            </div>
          </div>

          <button
            onClick={verifyStorageBuckets}
            disabled={storageVerification.isChecking}
            className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-black text-slate-700 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all self-end md:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${storageVerification.isChecking ? 'animate-spin text-blue-500' : 'text-slate-400'}`} />
            <span>{storageVerification.isChecking ? 'جاري التحقق...' : 'فحص الحاويات'}</span>
          </button>
        </div>

        {/* 1.2 Isolated Target Categories Navigation (Segmented Controller) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100">
                أقسام الأهداف الإضافية المستقلة (حليب كبير • حليب صغير • ويلي):
              </h3>
            </div>
            <span className="text-[11px] font-bold text-slate-400">
              اختر قسماً لعرض تفاصيله المستقلة بدقة
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* TAB 1: OVERVIEW */}
            <button
              onClick={() => setTargetCategory('overview')}
              className={`p-3.5 rounded-2xl border text-right transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between gap-2 shadow-sm ${
                targetCategory === 'overview'
                  ? 'bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-700 shadow-md ring-2 ring-blue-500/50'
                  : isDarkMode
                  ? 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black flex items-center gap-1.5">
                  <span>📊</span>
                  <span>نظرة شاملة (الكل)</span>
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                  targetCategory === 'overview' ? 'bg-blue-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}>
                  مقارنة
                </span>
              </div>
              <p className="text-[11px] opacity-75 line-clamp-1">
                جدول مقارنة الحليب وجبن ويلي لكافة المندوبين
              </p>
              <div className="pt-1 border-t border-slate-700/40 flex items-center justify-between text-[11px] font-bold">
                <span>إجمالي الحوافز:</span>
                <span className="font-black text-amber-400">
                  {formatWithCommas(grandCategoryTotals.grandIncentives)} د.ع
                </span>
              </div>
            </button>

            {/* TAB 2: LARGE MILK (حليب كبير - 1L) */}
            <button
              onClick={() => setTargetCategory('family')}
              className={`p-3.5 rounded-2xl border text-right transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between gap-2 shadow-sm ${
                targetCategory === 'family'
                  ? 'bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 text-white border-blue-600 shadow-md ring-2 ring-blue-400'
                  : isDarkMode
                  ? 'bg-slate-900/60 border-blue-900/30 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-blue-200 text-slate-700 hover:bg-blue-50/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black flex items-center gap-1.5">
                  <span>🥛</span>
                  <span>حليب كبير (1L)</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-400/40">
                  ≥ 11.5 كغم/محل
                </span>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] font-black mb-1">
                  <span>الإنجاز: {grandCategoryTotals.famPct.toFixed(0)}%</span>
                  <span className="opacity-80 font-normal">
                    {Math.round(grandCategoryTotals.totalFamWeight)} / {Math.round(grandCategoryTotals.targetFamWeight)} كغم
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, grandCategoryTotals.famPct)}%` }}
                  />
                </div>
              </div>
              <div className="pt-1 border-t border-blue-500/20 flex items-center justify-between text-[11px] font-bold">
                <span>حوافز الحليب الكبير:</span>
                <span className="font-black text-emerald-400">
                  {formatWithCommas(grandCategoryTotals.famIncentives)} د.ع
                </span>
              </div>
            </button>

            {/* TAB 3: SMALL MILK (حليب صغير - 200ml) */}
            <button
              onClick={() => setTargetCategory('small')}
              className={`p-3.5 rounded-2xl border text-right transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between gap-2 shadow-sm ${
                targetCategory === 'small'
                  ? 'bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-900 text-white border-indigo-600 shadow-md ring-2 ring-indigo-400'
                  : isDarkMode
                  ? 'bg-slate-900/60 border-indigo-900/30 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-indigo-200 text-slate-700 hover:bg-indigo-50/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black flex items-center gap-1.5">
                  <span>🍼</span>
                  <span>حليب صغير (200ml)</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-400/40">
                  ≥ 7.5 كغم/محل
                </span>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] font-black mb-1">
                  <span>الإنجاز: {grandCategoryTotals.smPct.toFixed(0)}%</span>
                  <span className="opacity-80 font-normal">
                    {Math.round(grandCategoryTotals.totalSmWeight)} / {Math.round(grandCategoryTotals.targetSmWeight)} كغم
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, grandCategoryTotals.smPct)}%` }}
                  />
                </div>
              </div>
              <div className="pt-1 border-t border-indigo-500/20 flex items-center justify-between text-[11px] font-bold">
                <span>حوافز الحليب الصغير:</span>
                <span className="font-black text-emerald-400">
                  {formatWithCommas(grandCategoryTotals.smIncentives)} د.ع
                </span>
              </div>
            </button>

            {/* TAB 4: WILLE (ويلي) */}
            <button
              onClick={() => setTargetCategory('willie')}
              className={`p-3.5 rounded-2xl border text-right transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between gap-2 shadow-sm ${
                targetCategory === 'willie'
                  ? 'bg-gradient-to-br from-amber-900 via-amber-800 to-orange-900 text-white border-amber-600 shadow-md ring-2 ring-amber-400'
                  : isDarkMode
                  ? 'bg-slate-900/60 border-amber-900/30 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-amber-200 text-slate-700 hover:bg-amber-50/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black flex items-center gap-1.5">
                  <span>🧀</span>
                  <span>ويلي (Wille)</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/30 text-amber-200 border border-amber-400/40">
                  شرط الأهلية ≥ 4 كغم
                </span>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] font-black mb-1">
                  <span>الإنجاز: {grandCategoryTotals.williePct.toFixed(0)}%</span>
                  <span className="opacity-80 font-normal">
                    {Math.round(grandCategoryTotals.totalWillieWeight)} / {Math.round(grandCategoryTotals.targetWillieWeight)} كغم
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, grandCategoryTotals.williePct)}%` }}
                  />
                </div>
              </div>
              <div className="pt-1 border-t border-amber-500/20 flex items-center justify-between text-[11px] font-bold">
                <span>حوافز ويلي:</span>
                <span className="font-black text-amber-300">
                  {formatWithCommas(grandCategoryTotals.willieIncentives)} د.ع
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* 2. Admin Selector Bar (Visible to Admin & Data Entry Only) */}
        {isAdmin && (
          <div
            className={`p-3.5 rounded-2xl border shadow-lg space-y-2.5 ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" />
                <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100">
                  لوحة الإدارة: اختيار المندوب أو مقارنة الجميع
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
                📊 جدول مقارنة كافة المندوبين
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

        {/* 3. VIEW MODE 1: ALL DELEGATES OVERVIEW (ADMIN ONLY) */}
        {isAdmin && viewMode === 'all' && (
          <div className="space-y-6">
            {/* 3.1 MILK & WILLIE COMBINED COMPARISON (OVERVIEW MODE) */}
            {targetCategory === 'overview' && (
              <div
                className={`p-4 rounded-3xl border shadow-xl space-y-4 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2 border-b pb-3 border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-800 dark:text-slate-200">
                      📊 المقارنة الشاملة: أداء الحليب لكافة المندوبين
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      إجمالي المندوبين: {delegatesAnalysis.length}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr
                        className={`font-black ${
                          isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        <th rowSpan={2} className="py-3 px-3 border-l-2 border-slate-300 dark:border-slate-700">
                          المندوب
                        </th>
                        <th colSpan={3} className="py-2 px-3 bg-blue-500/20 text-blue-800 dark:text-blue-300 border-x-2 border-blue-400 dark:border-blue-700">
                          🥛 حليب بطل كبير (ESL Family)
                        </th>
                        <th colSpan={3} className="py-2 px-3 bg-indigo-500/20 text-indigo-800 dark:text-indigo-300 border-x-2 border-indigo-400 dark:border-indigo-700">
                          🍼 حليب بطل صغير (ESL Small)
                        </th>
                        <th rowSpan={2} className="py-3 px-3 bg-amber-500/20 text-amber-800 dark:text-amber-300 border-x-2 border-amber-400 dark:border-amber-700">
                          💰 حوافز الحليب
                        </th>
                      </tr>
                      <tr
                        className={`font-black text-[11px] ${
                          isDarkMode ? 'bg-slate-800/90 text-slate-300' : 'bg-slate-200/80 text-slate-700'
                        }`}
                      >
                        <th className="py-2 px-2 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-r-2 border-blue-400 dark:border-blue-700">
                          الوزن (كغم)
                        </th>
                        <th className="py-2 px-2 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                          التغطية
                        </th>
                        <th className="py-2 px-2 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-l-2 border-blue-400 dark:border-blue-700">
                          الحافز
                        </th>

                        <th className="py-2 px-2 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-r-2 border-indigo-400 dark:border-indigo-700">
                          الوزن (كغم)
                        </th>
                        <th className="py-2 px-2 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                          التغطية
                        </th>
                        <th className="py-2 px-2 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-l-2 border-indigo-400 dark:border-indigo-700">
                          الحافز
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-bold">
                      {delegatesAnalysis.map((item) => (
                        <tr
                          key={item.delegateName}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                            item.config.isLocked ? 'bg-emerald-500/5' : ''
                          }`}
                        >
                          <td className="py-3 px-3 font-black text-slate-900 dark:text-slate-100 border-l-2 border-slate-300 dark:border-slate-700">
                            <div className="flex items-center justify-center gap-1.5">
                              <span>{item.delegateName}</span>
                              {item.config.isLocked && (
                                <span title="الأهداف مثبتة ومقفلة">
                                  <Lock className="w-3 h-3 text-emerald-500" />
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Large Milk Weight */}
                          <td className="py-3 px-3 bg-blue-500/5 text-blue-700 dark:text-blue-300 font-black border-r-2 border-blue-300 dark:border-blue-800/60">
                            {Math.round(item.totalFamilyWeight)} / {Math.round(item.familyTargetWeight)}
                            <span className="text-[10px] block opacity-75">
                              ({item.familyWeightPct.toFixed(0)}%)
                            </span>
                          </td>

                          {/* Large Milk Coverage */}
                          <td className="py-3 px-3 bg-blue-500/5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black ${
                                item.hasFamily100Coverage
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {Math.round(item.familyCoveredCount)} من {Math.round(item.familyTargetShops)} ({item.familyCoveragePct.toFixed(0)}%)
                            </span>
                          </td>

                          {/* Large Milk Incentive */}
                          <td className="py-3 px-3 bg-blue-500/5 font-black border-l-2 border-blue-300 dark:border-blue-800/60">
                            {item.familyTotalIncentive > 0 ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                {formatWithCommas(item.familyTotalIncentive)} د.ع
                              </span>
                            ) : !item.hasFamily100Coverage ? (
                              <button
                                onClick={() => {
                                  setLockedModalDelegateName(item.delegateName);
                                  setLockedModalType('family');
                                  setShowLockedConditionModal(true);
                                }}
                                className="text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 hover:bg-amber-200 border border-amber-300 dark:border-amber-700 px-2 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 mx-auto shadow-2xs"
                                title="شرط التغطية 100% لتفعيل حوافز الوزن"
                              >
                                <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                <span className="underline">مقفل بالشرط</span>
                              </button>
                            ) : (
                              <span className="text-slate-400">0 د.ع</span>
                            )}
                          </td>

                          {/* Small Milk Weight */}
                          <td className="py-3 px-3 bg-indigo-500/5 text-indigo-700 dark:text-indigo-300 font-black border-r-2 border-indigo-300 dark:border-indigo-800/60">
                            {Math.round(item.totalSmallWeight)} / {Math.round(item.smallTargetWeight)}
                            <span className="text-[10px] block opacity-75">
                              ({item.smallWeightPct.toFixed(0)}%)
                            </span>
                          </td>

                          {/* Small Milk Coverage */}
                          <td className="py-3 px-3 bg-indigo-500/5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black ${
                                item.hasSmall100Coverage
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {Math.round(item.smallCoveredCount)} من {Math.round(item.smallTargetShops)} ({item.smallCoveragePct.toFixed(0)}%)
                            </span>
                          </td>

                          {/* Small Milk Incentive */}
                          <td className="py-3 px-3 bg-indigo-500/5 font-black border-l-2 border-indigo-300 dark:border-indigo-800/60">
                            {item.smallTotalIncentive > 0 ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                {formatWithCommas(item.smallTotalIncentive)} د.ع
                              </span>
                            ) : !item.hasSmall100Coverage ? (
                              <button
                                onClick={() => {
                                  setLockedModalDelegateName(item.delegateName);
                                  setLockedModalType('small');
                                  setShowLockedConditionModal(true);
                                }}
                                className="text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 hover:bg-amber-200 border border-amber-300 dark:border-amber-700 px-2 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 mx-auto shadow-2xs"
                                title="شرط التغطية 100% لتفعيل حوافز الوزن"
                              >
                                <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                <span className="underline">مقفل بالشرط</span>
                              </button>
                            ) : (
                              <span className="text-slate-400">0 د.ع</span>
                            )}
                          </td>

                          {/* Total Milk Incentive */}
                          <td className="py-3 px-3 bg-amber-500/10 font-black text-sm border-x-2 border-amber-300 dark:border-amber-800/60">
                            <span
                              className={
                                item.familyTotalIncentive + item.smallTotalIncentive > 0
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-400'
                              }
                            >
                              {formatWithCommas(item.familyTotalIncentive + item.smallTotalIncentive)} د.ع
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3.2 ISOLATED LARGE MILK DASHBOARD (حليب كبير - 1L) */}
            {targetCategory === 'family' && (
              <div className="space-y-5 animate-in fade-in duration-200">
                {/* Large Milk Header & KPIs */}
                <div
                  className={`p-5 rounded-3xl border shadow-xl space-y-4 ${
                    isDarkMode ? 'bg-slate-900 border-blue-500/40 text-white' : 'bg-gradient-to-r from-blue-50 to-indigo-50/60 border-blue-200 text-slate-900'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b pb-4 border-blue-200 dark:border-blue-900/50">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-2xl shadow-lg">
                        🥛
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg sm:text-xl font-black text-blue-800 dark:text-blue-300">
                            لوحة قسم الحليب الكبير (Large Milk - 1L)
                          </h2>
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                            حجم 1 لتر / عائلي
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            الحد الأدنى للأهلية: ≥ 11.5 كغم لكل محل
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          احتساب تغطية المحلات المستقلة والمبيعات الشهرية وتطبيق حوافز التغطية (32,500 د.ع) وحوافز المبيعات (32,500 د.ع)
                        </p>
                      </div>
                    </div>

                    <div className="text-left font-black">
                      <span className="text-xs text-slate-400 block">إجمالي حوافز الحليب الكبير</span>
                      <span className="text-lg text-emerald-600 dark:text-emerald-400">
                        {formatWithCommas(grandCategoryTotals.famIncentives)} د.ع
                      </span>
                    </div>
                  </div>

                  {/* KPIs Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-blue-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">مبيعات الوزن المحققة</span>
                      <span className="text-base font-black text-blue-700 dark:text-blue-400">
                        {Math.round(grandCategoryTotals.totalFamWeight)} كغم
                      </span>
                      <span className="text-[10px] text-slate-400 block">من أصل {Math.round(grandCategoryTotals.targetFamWeight)} كغم</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-blue-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">نسبة إنجاز الوزن</span>
                      <span className="text-base font-black text-indigo-700 dark:text-indigo-400">
                        {grandCategoryTotals.famPct.toFixed(0)}%
                      </span>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-blue-500"
                          style={{ width: `${Math.min(100, grandCategoryTotals.famPct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-blue-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">تغطية المحلات المقبولة</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">
                        {Math.round(grandCategoryTotals.famCoveredCount)} محل
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        من {Math.round(grandCategoryTotals.famTargetShops)} محل مستهدف
                      </span>
                    </div>

                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-blue-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">شرط أهلية المحل (Dynamic)</span>
                      <span className="text-base font-black text-amber-700 dark:text-amber-400">
                        ≥ 11.5 كغم
                      </span>
                      <span className="text-[10px] text-slate-400 block">لكل طلب أو فاتورة محل</span>
                    </div>
                  </div>
                </div>

                <FamilyMilkTable
                  delegatesAnalysis={delegatesAnalysis}
                  isDarkMode={isDarkMode}
                  isAdmin={isAdmin}
                  handleOpenConfigModal={handleOpenConfigModal}
                  downloadFamilyTemplate={downloadFamilyTemplate}
                  handleFamilyMilkUpload={handleFamilyMilkUpload}
                  familyMilkUploadRef={familyMilkUploadRef}
                  setLockedModalDelegateName={setLockedModalDelegateName}
                  setShowLockedConditionModal={(show) => {
                    setLockedModalType('family');
                    setShowLockedConditionModal(show);
                  }}
                />
              </div>
            )}

            {/* 3.3 ISOLATED SMALL MILK DASHBOARD (حليب صغير - 200ml) */}
            {targetCategory === 'small' && (
              <div className="space-y-5 animate-in fade-in duration-200">
                {/* Small Milk Header & KPIs */}
                <div
                  className={`p-5 rounded-3xl border shadow-xl space-y-4 ${
                    isDarkMode ? 'bg-slate-900 border-indigo-500/40 text-white' : 'bg-gradient-to-r from-indigo-50 to-purple-50/60 border-indigo-200 text-slate-900'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b pb-4 border-indigo-200 dark:border-indigo-900/50">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-2xl shadow-lg">
                        🍼
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg sm:text-xl font-black text-indigo-800 dark:text-indigo-300">
                            لوحة قسم الحليب الصغير (Small Milk - 200ml)
                          </h2>
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700">
                            حجم 200 مل / ESL
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            الحد الأدنى للأهلية: ≥ 7.5 كغم لكل محل
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          احتساب تغطية المحلات المستقلة والمبيعات الشهرية وتطبيق حوافز التغطية (32,500 د.ع) وحوافز المبيعات (32,500 د.ع)
                        </p>
                      </div>
                    </div>

                    <div className="text-left font-black">
                      <span className="text-xs text-slate-400 block">إجمالي حوافز الحليب الصغير</span>
                      <span className="text-lg text-emerald-600 dark:text-emerald-400">
                        {formatWithCommas(grandCategoryTotals.smIncentives)} د.ع
                      </span>
                    </div>
                  </div>

                  {/* KPIs Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-indigo-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">مبيعات الوزن المحققة</span>
                      <span className="text-base font-black text-indigo-700 dark:text-indigo-400">
                        {Math.round(grandCategoryTotals.totalSmWeight)} كغم
                      </span>
                      <span className="text-[10px] text-slate-400 block">من أصل {Math.round(grandCategoryTotals.targetSmWeight)} كغم</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-indigo-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">نسبة إنجاز الوزن</span>
                      <span className="text-base font-black text-purple-700 dark:text-purple-400">
                        {grandCategoryTotals.smPct.toFixed(0)}%
                      </span>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-indigo-500"
                          style={{ width: `${Math.min(100, grandCategoryTotals.smPct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-indigo-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">تغطية المحلات المقبولة</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">
                        {Math.round(grandCategoryTotals.smCoveredCount)} محل
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        من {Math.round(grandCategoryTotals.smTargetShops)} محل مستهدف
                      </span>
                    </div>

                    <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-indigo-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">شرط أهلية المحل (Dynamic)</span>
                      <span className="text-base font-black text-amber-700 dark:text-amber-400">
                        ≥ 7.5 كغم
                      </span>
                      <span className="text-[10px] text-slate-400 block">لكل طلب أو فاتورة محل</span>
                    </div>
                  </div>
                </div>

                <SmallMilkTable
                  delegatesAnalysis={delegatesAnalysis}
                  isDarkMode={isDarkMode}
                  isAdmin={isAdmin}
                  handleOpenConfigModal={handleOpenConfigModal}
                  downloadSmallTemplate={downloadSmallTemplate}
                  handleSmallMilkUpload={handleSmallMilkUpload}
                  smallMilkUploadRef={smallMilkUploadRef}
                  setLockedModalDelegateName={setLockedModalDelegateName}
                  setShowLockedConditionModal={(show) => {
                    setLockedModalType('small');
                    setShowLockedConditionModal(show);
                  }}
                />
              </div>
            )}

            {/* 3.4 DEDICATED WILLIE (ويلي) SECTION (OVERVIEW OR WILLIE TAB) */}
            {(targetCategory === 'overview' || targetCategory === 'willie') && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Golden Willie Rule & Incentive Condition Banner */}
                <div className="p-4 sm:p-5 rounded-3xl border border-amber-400 dark:border-amber-600/50 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 shadow-md space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black text-xl shadow-md">
                        🧀
                      </div>
                      <div>
                        <h4 className="text-sm sm:text-base font-black text-amber-900 dark:text-amber-200">
                          قواعد واشتراطات أهداف ويلي (Wille Rules Engine)
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          نظام القواعد الإلزامي لاحتساب التغطية والحوافز لجبن ويلي بيضوي
                        </p>
                      </div>
                    </div>

                    <span className="px-3 py-1 rounded-full text-xs font-black bg-amber-500 text-slate-950 shadow-xs">
                      الحد الأدنى للأهلية: 4.0 كغم للمحل
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-bold text-slate-800 dark:text-slate-200">
                    <div className="p-3 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-amber-300 dark:border-amber-700/60 flex items-start gap-2.5 shadow-2xs">
                      <span className="w-6 h-6 rounded-lg bg-amber-500 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div>
                        <span className="font-black text-amber-800 dark:text-amber-300 block mb-0.5">
                          قاعدة الأهلية (Wille Rule - 4KG Threshold):
                        </span>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                          يشترط تحقيق <strong>4.0 كغم كحد أدنى</strong> لكل محل/زبون ليُعتبر مؤهلاً ومقبولاً. أي محل يشتري أقل من 4 كغم <strong>لا يُحسب إطلاقاً</strong> ضمن نسبة تغطية المحلات.
                        </p>
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-amber-300 dark:border-amber-700/60 flex items-start gap-2.5 shadow-2xs">
                      <span className="w-6 h-6 rounded-lg bg-orange-600 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div>
                        <span className="font-black text-orange-700 dark:text-orange-300 block mb-0.5">
                          قفل حافز المبيعات (Locked Condition):
                        </span>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                          حافز مبيعات الوزن (32,500 د.ع) <strong>مقفل بشرط</strong> تحقيق تغطية المحلات بنسبة 100% أولاً، ثم استيفاء هدف مبيعات الوزن.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Willie Isolated KPIs Banner */}
                {targetCategory === 'willie' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-amber-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">إجمالي مبيعات ويلي</span>
                      <span className="text-base font-black text-amber-700 dark:text-amber-400">
                        {Math.round(grandCategoryTotals.totalWillieWeight)} كغم
                      </span>
                      <span className="text-[10px] text-slate-400 block">من أصل {Math.round(grandCategoryTotals.targetWillieWeight)} كغم ({grandCategoryTotals.williePct.toFixed(0)}%)</span>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-amber-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">المحلات المقبولة (≥ 4 كغم)</span>
                      <span className="text-base font-black text-indigo-700 dark:text-indigo-400">
                        {Math.round(grandCategoryTotals.willieCoveredCount)} محل
                      </span>
                      <span className="text-[10px] text-slate-400 block">من {Math.round(grandCategoryTotals.willieTargetShops)} محل مستهدف</span>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-amber-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">حوافز ويلي المكتسبة</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">
                        {formatWithCommas(grandCategoryTotals.willieIncentives)} د.ع
                      </span>
                      <span className="text-[10px] text-slate-400 block">تغطية + مبيعات مستحقة</span>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-amber-200 dark:border-slate-700 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-400 block">شرط الأهلية الصارم</span>
                      <span className="text-base font-black text-amber-600 dark:text-amber-400">
                        ≥ 4.0 كغم
                      </span>
                      <span className="text-[10px] text-slate-400 block">لكل زبون/محل مستقل</span>
                    </div>
                  </div>
                )}

                <div
                  className={`p-4 rounded-3xl border shadow-xl space-y-4 ${
                    isDarkMode ? 'bg-slate-900 border-amber-500/30' : 'bg-white border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 border-b pb-3 border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center font-black text-lg">
                        🧀
                      </div>
                      <div>
                        <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                          جدول أداء المندوبين وحوافز ويلي (Wille) لشهر {activeMonthStr}
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          حسابات ومبيعات وحوافز جبن ويلي مستقلة كلياً (شرط قبول المحل ≥ 4.0 كغم)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Hidden Willie File Input */}
                      <input
                        type="file"
                        ref={willieUploadRef}
                        className="hidden"
                        accept=".xlsx, .xls"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleWillieUpload(file);
                          e.target.value = '';
                        }}
                      />

                      {isAdmin && (
                        <>
                          {/* 1. Import Willie Data Button */}
                          <button
                            onClick={() => willieUploadRef.current?.click()}
                            disabled={isUploading}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                            title="استيراد وتحديث بيانات مبيعات وتغطية ويلي وإفراغ البيانات القديمة"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>{isUploading ? 'جاري الاستيراد...' : 'استيراد بيانات الويلي'}</span>
                          </button>

                          {/* 2. Download Willie Template Button */}
                          <button
                            onClick={downloadWillieTemplate}
                            className="px-3 py-1.5 rounded-xl bg-amber-700/90 hover:bg-amber-700 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                            title="تنزيل نموذج ملف إكسل مخصص لمبيعات جبن ويلي"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>نموذج إكسل ويلي</span>
                          </button>

                          {/* 3. Export Willie Sales Report Button */}
                          <button
                            onClick={downloadWillieSalesData}
                            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                            title="تصدير وتحميل بيانات ومبيعات ويلي الحالية بصيغة إكسل"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>تصدير تقرير ويلي</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md">
                    <table className="w-full text-xs text-center border-collapse">
                      <thead>
                        <tr className="text-[#0a192f] font-black text-xs">
                          <th className="py-3.5 px-3 border border-orange-600/30 bg-[#ea580c] text-slate-950 font-black">
                            اسم المندوب
                          </th>
                          <th className="py-3.5 px-3 border border-orange-600/30 bg-[#ea580c] text-slate-950 font-black">
                            هدف الوزن (كغم)
                          </th>
                          <th className="py-3.5 px-3 border border-orange-600/30 bg-[#ea580c] text-slate-950 font-black">
                            مبيعات الوزن (كغم)
                          </th>
                          <th className="py-3.5 px-3 border border-orange-600/30 bg-[#ea580c] text-slate-950 font-black">
                            حافز الوزن
                          </th>
                          <th className="py-3.5 px-3 border border-orange-600/30 bg-[#ea580c] text-slate-950 font-black">
                            المحلات المستهدفة
                          </th>
                          <th className="py-3.5 px-3 border border-orange-600/30 bg-[#ea580c] text-slate-950 font-black">
                            المحلات المقبولة (≥ 4 كغم)
                          </th>
                          <th className="py-3.5 px-3 border border-orange-600/30 bg-[#ea580c] text-slate-950 font-black">
                            حافز التغطية
                          </th>
                          <th className="py-3.5 px-3 border border-orange-700 bg-[#7c2d12] text-white font-black text-sm">
                            إجمالي الحافز
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-bold">
                        {delegatesAnalysis.map((item) => (
                          <tr
                            key={item.delegateName + '_willie'}
                            className="hover:bg-amber-500/5 transition-colors"
                          >
                            {/* 1. اسم المندوب */}
                            <td className="py-3 px-3 font-black text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800">
                              {item.delegateName}
                            </td>

                            {/* 2. هدف الوزن (كغم) */}
                            <td className="py-3 px-3 border border-slate-200 dark:border-slate-800">
                              {Math.round(item.willieTargetWeight)} كغم
                            </td>

                            {/* 3. مبيعات الوزن (كغم) */}
                            <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-amber-700 dark:text-amber-300">
                              {Math.round(item.totalWillieWeight)} كغم
                              <span className="block text-[10px] text-slate-400 font-normal">
                                ({item.willieWeightPct.toFixed(0)}%)
                              </span>
                            </td>

                            {/* 4. حافز الوزن */}
                            <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black">
                              {item.hasWillieSalesIncentiveUnlocked ? (
                                <span className="text-emerald-600 dark:text-emerald-400">32,500 د.ع ✅</span>
                              ) : !item.hasWillie100Coverage ? (
                                <button
                                  onClick={() => {
                                    setLockedModalDelegateName(item.delegateName);
                                    setLockedModalType('willie');
                                    setShowLockedConditionModal(true);
                                  }}
                                  className="text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 hover:bg-amber-200 border border-amber-300 dark:border-amber-700 px-2 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 mx-auto shadow-2xs"
                                  title="اضغط لتنبيه المندوب بشرط التغطية 100%"
                                >
                                  <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                  <span className="underline">مقفل بالشرط</span>
                                </button>
                              ) : (
                                <span className="text-slate-400">0 د.ع</span>
                              )}
                            </td>

                            {/* 5. المحلات المستهدفة */}
                            <td className="py-3 px-3 border border-slate-200 dark:border-slate-800">
                              {Math.round(item.willieTargetShops)} محل
                            </td>

                            {/* 6. المحلات المقبولة (>= 4 كغم) */}
                            <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-indigo-600 dark:text-indigo-400">
                              {Math.round(item.willieCoveredCount)} محل
                              <span className="block text-[10px] text-slate-400 font-normal">
                                ({item.willieCoveragePct.toFixed(0)}%)
                              </span>
                            </td>

                            {/* 7. حافز التغطية */}
                            <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black">
                              <span
                                className={
                                  item.willieCoverageIncentiveEarned > 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-400'
                                }
                              >
                                {formatWithCommas(item.willieCoverageIncentiveEarned)} د.ع
                              </span>
                            </td>

                            {/* 8. إجمالي الحافز */}
                            <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 bg-amber-500/10 font-black text-sm text-emerald-700 dark:text-emerald-300">
                              {formatWithCommas(item.willieTotalIncentive)} د.ع
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
        )}

        {/* 4. VIEW MODE 2: SINGLE REPRESENTATIVE DETAILED VIEW (ISOLATED ROLE VIEW) */}
        {(viewMode === 'single' || !isAdmin) && currentDelegateData && (
          <div className="space-y-6">
            {/* Top Bar for Representative */}
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
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">
                      تقرير الأهداف الإضافية: {currentDelegateData.delegateName}
                    </h2>
                    {currentDelegateData.config.isLocked ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-1 border border-emerald-300 dark:border-emerald-700">
                        <Lock className="w-3 h-3" />
                        <span>أهداف مثبتة</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 flex items-center gap-1">
                        <Unlock className="w-3 h-3" />
                        <span>قيد التعديل</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    الشهر: {activeMonthStr}
                  </p>
                </div>
              </div>

              {/* Total Earned Incentives Highlight Box */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5">
                <Coins className="w-6 h-6 text-amber-500 shrink-0" />
                <div>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                    مجموع الحوافز المكتسبة حتى الآن (حليب + ويلي)
                  </span>
                  <span className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400">
                    {formatWithCommas(currentDelegateData.grandTotalIncentive)} د.ع
                    <span className="text-xs font-normal text-slate-400 mr-1.5">
                      (من أصل 195,000 د.ع)
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* SECTION 1: LARGE BOTTLE MILK (حليب بطل كبير) */}
            {(targetCategory === 'overview' || targetCategory === 'family') && (
              <div
                className={`p-5 rounded-3xl border shadow-xl space-y-5 transition-all ${
                  isDarkMode ? 'bg-slate-900 border-blue-500/40' : 'bg-white border-blue-200'
                }`}
              >
              {/* Section 1 Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b pb-4 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-black text-2xl shadow-inner">
                    🥛
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-black text-blue-800 dark:text-blue-300">
                        الفقرة الأولى: حليب بطل كبير (ESL Family)
                      </h2>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                        حجم 1 لتر / عائلي
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      شرط احتساب تغطية المحل: شراء ≥ {currentDelegateData.minFam} كغم حليب كبير
                    </p>
                  </div>
                </div>

                {/* Subtotal Section 1 Incentive */}
                <div className="text-left sm:text-right">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
                    حوافز حليب كبير:
                  </span>
                  <span className="text-sm sm:text-base font-black text-blue-600 dark:text-blue-400">
                    {formatWithCommas(currentDelegateData.familyTotalIncentive)} د.ع
                    <span className="text-xs font-normal text-slate-400 mr-1"> (من 65,000 د.ع)</span>
                  </span>
                </div>
              </div>

              {/* Section 1 Metrics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Weight Target & Progress */}
                <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-blue-600" />
                      <span>تاركت الوزن الشهري:</span>
                    </span>
                    <span className="text-xs font-black text-blue-700 dark:text-blue-300">
                      {Math.round(currentDelegateData.totalFamilyWeight)} من {Math.round(currentDelegateData.familyTargetWeight)} كغم
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        currentDelegateData.hasFamilySalesTarget ? 'bg-emerald-500' : 'bg-blue-600'
                      }`}
                      style={{ width: `${Math.min(100, currentDelegateData.familyWeightPct)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-500 dark:text-slate-400">
                      نسبة الإنجاز: {currentDelegateData.familyWeightPct.toFixed(0)}%
                    </span>
                    {currentDelegateData.hasFamilySalesTarget ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تم تحقيق وزن الهدف المستهدف ✅</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        متبقي {Math.max(0, Math.round(currentDelegateData.familyTargetWeight - currentDelegateData.totalFamilyWeight))} كغم
                      </span>
                    )}
                  </div>
                </div>

                {/* Shop Coverage Target & Progress */}
                <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                      <Store className="w-4 h-4 text-indigo-600" />
                      <span>تاركت تغطية المحلات:</span>
                    </span>
                    <span className="text-xs font-black text-indigo-700 dark:text-indigo-300">
                      {Math.round(currentDelegateData.familyCoveredCount)} من أصل {Math.round(currentDelegateData.familyTargetShops)} محل
                    </span>
                  </div>

                  {/* Coverage Progress Bar */}
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        currentDelegateData.hasFamily100Coverage ? 'bg-emerald-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${Math.min(100, currentDelegateData.familyCoveragePct)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-500 dark:text-slate-400">
                      نسبة التغطية: {currentDelegateData.familyCoveragePct.toFixed(0)}%
                    </span>
                    {currentDelegateData.hasFamily100Coverage ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تم تحقيق 100% تغطية ✅</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        متبقي {Math.round(Math.max(0, currentDelegateData.familyTargetShops - currentDelegateData.familyCoveredCount))} محلات للوصول للهدف
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 1 Incentives Breakdown Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* 1. Large Milk Coverage Incentive (32,500 IQD) */}
                <div
                  className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                    currentDelegateData.hasFamily100Coverage
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${
                        currentDelegateData.hasFamily100Coverage
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {currentDelegateData.hasFamily100Coverage ? <Check className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="text-xs font-black">حافز تغطية حليب كبير</h4>
                      <p className="text-[11px] opacity-75">
                        يُمنح عند تحقيق تغطية 100% من المحلات
                      </p>
                    </div>
                  </div>
                  <div className="text-left font-black">
                    <span className="text-sm block">32,500 د.ع</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full inline-block font-bold ${
                        currentDelegateData.hasFamily100Coverage
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {currentDelegateData.hasFamily100Coverage ? 'مستحق ✅' : 'قيد الإنجاز ⏳'}
                    </span>
                  </div>
                </div>

                {/* 2. Large Milk Sales Incentive (32,500 IQD) */}
                <div
                  className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                    currentDelegateData.hasFamilySalesIncentiveUnlocked
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${
                        currentDelegateData.hasFamilySalesIncentiveUnlocked
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {currentDelegateData.hasFamilySalesIncentiveUnlocked ? (
                        <Check className="w-5 h-5" />
                      ) : (
                        <Lock className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-black">حافز مبيعات حليب كبير</h4>
                      <p className="text-[11px] opacity-75">
                        يُفتح فقط بعد تحقيق 100% تغطية + تحقيق الوزن المستهدف
                      </p>
                    </div>
                  </div>
                  <div className="text-left font-black">
                    <span className="text-sm block">32,500 د.ع</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full inline-block font-bold ${
                        currentDelegateData.hasFamilySalesIncentiveUnlocked
                          ? 'bg-emerald-500 text-white'
                          : !currentDelegateData.hasFamily100Coverage
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {currentDelegateData.hasFamilySalesIncentiveUnlocked
                        ? 'مستحق ✅'
                        : !currentDelegateData.hasFamily100Coverage
                        ? 'مقفل حتى إكمال التغطية 🔒'
                        : 'بانتظار اكتمال الوزن ⏳'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: SMALL BOTTLE MILK (حليب بطل صغير) */}
          {(targetCategory === 'overview' || targetCategory === 'small') && (
            <div
              className={`p-5 rounded-3xl border shadow-xl space-y-5 transition-all ${
                isDarkMode ? 'bg-slate-900 border-indigo-500/40' : 'bg-white border-indigo-200'
              }`}
            >
              {/* Section 2 Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b pb-4 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-black text-2xl shadow-inner">
                    🍼
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-black text-indigo-800 dark:text-indigo-300">
                        الفقرة الثانية: حليب بطل صغير (ESL Small)
                      </h2>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700">
                        حجم 200 مل / صغار
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      شرط احتساب تغطية المحل: شراء ≥ {currentDelegateData.minSm} كغم حليب صغير
                    </p>
                  </div>
                </div>

                {/* Subtotal Section 2 Incentive */}
                <div className="text-left sm:text-right">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
                    حوافز حليب صغير:
                  </span>
                  <span className="text-sm sm:text-base font-black text-indigo-600 dark:text-indigo-400">
                    {formatWithCommas(currentDelegateData.smallTotalIncentive)} د.ع
                    <span className="text-xs font-normal text-slate-400 mr-1"> (من 65,000 د.ع)</span>
                  </span>
                </div>
              </div>

              {/* Section 2 Metrics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Weight Target & Progress */}
                <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-indigo-600" />
                      <span>تاركت الوزن الشهري:</span>
                    </span>
                    <span className="text-xs font-black text-indigo-700 dark:text-indigo-300">
                      {Math.round(currentDelegateData.totalSmallWeight)} من {Math.round(currentDelegateData.smallTargetWeight)} كغم
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        currentDelegateData.hasSmallSalesTarget ? 'bg-emerald-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${Math.min(100, currentDelegateData.smallWeightPct)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-500 dark:text-slate-400">
                      نسبة الإنجاز: {currentDelegateData.smallWeightPct.toFixed(0)}%
                    </span>
                    {currentDelegateData.hasSmallSalesTarget ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تم تحقيق وزن الهدف المستهدف ✅</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        متبقي {Math.max(0, Math.round(currentDelegateData.smallTargetWeight - currentDelegateData.totalSmallWeight))} كغم
                      </span>
                    )}
                  </div>
                </div>

                {/* Shop Coverage Target & Progress */}
                <div className="p-4 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/70 dark:border-purple-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                      <Store className="w-4 h-4 text-purple-600" />
                      <span>تاركت تغطية المحلات:</span>
                    </span>
                    <span className="text-xs font-black text-purple-700 dark:text-purple-300">
                      {Math.round(currentDelegateData.smallCoveredCount)} من أصل {Math.round(currentDelegateData.smallTargetShops)} محل
                    </span>
                  </div>

                  {/* Coverage Progress Bar */}
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        currentDelegateData.hasSmall100Coverage ? 'bg-emerald-500' : 'bg-purple-600'
                      }`}
                      style={{ width: `${Math.min(100, currentDelegateData.smallCoveragePct)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-500 dark:text-slate-400">
                      نسبة التغطية: {currentDelegateData.smallCoveragePct.toFixed(0)}%
                    </span>
                    {currentDelegateData.hasSmall100Coverage ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تم تحقيق 100% تغطية ✅</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        متبقي {Math.round(Math.max(0, currentDelegateData.smallTargetShops - currentDelegateData.smallCoveredCount))} محلات للوصول للهدف
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 2 Incentives Breakdown Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* 1. Small Milk Coverage Incentive (32,500 IQD) */}
                <div
                  className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                    currentDelegateData.hasSmall100Coverage
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${
                        currentDelegateData.hasSmall100Coverage
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {currentDelegateData.hasSmall100Coverage ? <Check className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="text-xs font-black">حافز تغطية حليب صغير</h4>
                      <p className="text-[11px] opacity-75">
                        يُمنح عند تحقيق تغطية 100% من المحلات
                      </p>
                    </div>
                  </div>
                  <div className="text-left font-black">
                    <span className="text-sm block">32,500 د.ع</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full inline-block font-bold ${
                        currentDelegateData.hasSmall100Coverage
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {currentDelegateData.hasSmall100Coverage ? 'مستحق ✅' : 'قيد الإنجاز ⏳'}
                    </span>
                  </div>
                </div>

                {/* 2. Small Milk Sales Incentive (32,500 IQD) */}
                <div
                  className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                    currentDelegateData.hasSmallSalesIncentiveUnlocked
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${
                        currentDelegateData.hasSmallSalesIncentiveUnlocked
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {currentDelegateData.hasSmallSalesIncentiveUnlocked ? (
                        <Check className="w-5 h-5" />
                      ) : (
                        <Lock className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-black">حافز مبيعات حليب صغير</h4>
                      <p className="text-[11px] opacity-75">
                        يُفتح فقط بعد تحقيق 100% تغطية + تحقيق الوزن المستهدف
                      </p>
                    </div>
                  </div>
                  <div className="text-left font-black">
                    <span className="text-sm block">32,500 د.ع</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full inline-block font-bold ${
                        currentDelegateData.hasSmallSalesIncentiveUnlocked
                          ? 'bg-emerald-500 text-white'
                          : !currentDelegateData.hasSmall100Coverage
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {currentDelegateData.hasSmallSalesIncentiveUnlocked
                        ? 'مستحق ✅'
                        : !currentDelegateData.hasSmall100Coverage
                        ? 'مقفل حتى إكمال التغطية 🔒'
                        : 'بانتظار اكتمال الوزن ⏳'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: WILLE (ويلي) SECTION - POSITIONED BELOW MILK SECTIONS */}
          {(targetCategory === 'overview' || targetCategory === 'willie') && (
            <div
              className={`p-5 rounded-3xl border shadow-xl space-y-5 transition-all ${
                isDarkMode ? 'bg-slate-900 border-amber-500/40' : 'bg-white border-amber-200'
              }`}
            >
              {/* Section 3 Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b pb-4 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-black text-2xl shadow-inner">
                    🧀
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-black text-amber-800 dark:text-amber-300">
                        الفقرة الثالثة: ويلي (Wille)
                      </h2>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                        جبن ويلي
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      شرط احتساب تغطية المحل: شراء ≥ 4.0 كغم من جبن ويلي
                    </p>
                  </div>
                </div>

                {/* Subtotal Section 3 Incentive & Action Buttons */}
                <div className="flex flex-col items-start sm:items-end gap-2">
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
                      حوافز جبن ويلي:
                    </span>
                    <span className="text-sm sm:text-base font-black text-amber-600 dark:text-amber-400">
                      {formatWithCommas(currentDelegateData.willieTotalIncentive)} د.ع
                      <span className="text-xs font-normal text-slate-400 mr-1"> (من 65,000 د.ع)</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => excelUploadRef.current?.click()}
                          disabled={isUploading}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black shadow-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                          title="استيراد ورفع مبيعات ويلي"
                        >
                          <Upload className="w-3 h-3" />
                          <span>{isUploading ? 'جاري الاستيراد...' : 'استيراد بيانات الويلي'}</span>
                        </button>
                        <button
                          onClick={downloadWillieTemplate}
                          className="px-2.5 py-1 rounded-lg bg-amber-700/90 hover:bg-amber-700 text-white text-[11px] font-black shadow-xs flex items-center gap-1 transition-all cursor-pointer"
                          title="تنزيل نموذج إكسل خاص بمبيعات ويلي"
                        >
                          <FileSpreadsheet className="w-3 h-3" />
                          <span>نموذج ويلي</span>
                        </button>
                        <button
                          onClick={downloadWillieSalesData}
                          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black shadow-xs flex items-center gap-1 transition-all cursor-pointer"
                          title="تصدير تقرير ويلي للمندوب"
                        >
                          <Download className="w-3 h-3" />
                          <span>تصدير المبيعات</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 3 Metrics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Weight Target & Progress */}
                <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-amber-600" />
                      <span>الهدف الشهري (Target KG):</span>
                    </span>
                    <span className="text-xs font-black text-amber-700 dark:text-amber-300">
                      {Math.round(currentDelegateData.totalWillieWeight)} من {Math.round(currentDelegateData.willieTargetWeight)} كغم
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        currentDelegateData.hasWillieSalesTarget ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min(100, currentDelegateData.willieWeightPct)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-500 dark:text-slate-400">
                      نسبة تحقيق المبيعات (%Achieved KG): {currentDelegateData.willieWeightPct.toFixed(0)}%
                    </span>
                    {currentDelegateData.hasWillieSalesTarget ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تم تحقيق هدف المبيعات ✅</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        متبقي {Math.max(0, Math.round(currentDelegateData.willieTargetWeight - currentDelegateData.totalWillieWeight))} كغم
                      </span>
                    )}
                  </div>
                </div>

                {/* Shop Coverage Target & Progress */}
                <div className="p-4 rounded-2xl bg-orange-50/60 dark:bg-orange-950/30 border border-orange-200/70 dark:border-orange-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-orange-900 dark:text-orange-200 flex items-center gap-1.5">
                      <Store className="w-4 h-4 text-orange-600" />
                      <span>تاركت المحلات المستهدفة (Target Customer):</span>
                    </span>
                    <span className="text-xs font-black text-orange-700 dark:text-orange-300">
                      {Math.round(currentDelegateData.willieCoveredCount)} من أصل {Math.round(currentDelegateData.willieTargetShops)} محل مقبول (≥4 كغم)
                    </span>
                  </div>

                  {/* Coverage Progress Bar */}
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        currentDelegateData.hasWillie100Coverage ? 'bg-emerald-500' : 'bg-orange-500'
                      }`}
                      style={{ width: `${Math.min(100, currentDelegateData.willieCoveragePct)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-500 dark:text-slate-400">
                      نسبة التغطية (%Coverage): {currentDelegateData.willieCoveragePct.toFixed(0)}%
                    </span>
                    {currentDelegateData.hasWillie100Coverage ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تم تحقيق 100% تغطية ✅</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        متبقي {Math.round(Math.max(0, currentDelegateData.willieTargetShops - currentDelegateData.willieCoveredCount))} محلات وصولاً للهدف
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 3 Incentives Breakdown Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* 1. Willie Coverage Incentive (32,500 IQD) */}
                <div
                  className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                    currentDelegateData.hasWillie100Coverage
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${
                        currentDelegateData.hasWillie100Coverage
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {currentDelegateData.hasWillie100Coverage ? <Check className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="text-xs font-black">حافز التغطية (Reward Cov)</h4>
                      <p className="text-[11px] opacity-75">
                        32,500 د.ع تُمنح عند وصول التغطية إلى 100%
                      </p>
                    </div>
                  </div>
                  <div className="text-left font-black">
                    <span className="text-sm block">32,500 د.ع</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full inline-block font-bold ${
                        currentDelegateData.hasWillie100Coverage
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {currentDelegateData.hasWillie100Coverage ? 'مستحق ✅' : 'قيد الإنجاز ⏳'}
                    </span>
                  </div>
                </div>

                {/* 2. Willie Sales Incentive (32,500 IQD) - LOCKED by default until 100% coverage */}
                <div
                  className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                    currentDelegateData.hasWillieSalesIncentiveUnlocked
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${
                        currentDelegateData.hasWillieSalesIncentiveUnlocked
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {currentDelegateData.hasWillieSalesIncentiveUnlocked ? (
                        <Check className="w-5 h-5" />
                      ) : (
                        <Lock className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-black">حافز المبيعات (Reward KG)</h4>
                      <p className="text-[11px] opacity-75">
                        32,500 د.ع مقفلة 🔒 تتطلب 100% تغطية أولاً + تحصيل المبيعات
                      </p>
                    </div>
                  </div>
                  <div className="text-left font-black">
                    <span className="text-sm block">32,500 د.ع</span>
                    {currentDelegateData.hasWillieSalesIncentiveUnlocked ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full inline-block font-bold bg-emerald-500 text-white">
                        مستحق ✅
                      </span>
                    ) : !currentDelegateData.hasWillie100Coverage ? (
                      <button
                        onClick={() => {
                          setLockedModalDelegateName(currentDelegateData.delegateName);
                          setLockedModalType('willie');
                          setShowLockedConditionModal(true);
                        }}
                        className="text-[10px] px-2.5 py-1 rounded-full font-black bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-200 transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                        title="اضغط لعرض التنبيه الخاص بشرط حوافز الوزن"
                      >
                        <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        <span>مقفل بالشرط (اضغط للتنبيه)</span>
                      </button>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full inline-block font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        بانتظار اكتمال الوزن ⏳
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          </div>
        )}

        {/* 6. ADMIN TARGET CONFIGURATION & LOCK MODAL */}
        {showConfigModal && (
          <div
            className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
            onClick={() => setShowConfigModal(false)}
          >
            <div
              className={`p-5 sm:p-6 rounded-3xl shadow-2xl w-full max-w-lg border text-right space-y-4 max-h-[90vh] overflow-y-auto ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className={`w-9 h-9 rounded-xl text-white flex items-center justify-center font-black ${
                    configTab === 'willie' ? 'bg-amber-600' : 'bg-blue-600'
                  }`}>
                    <SlidersHorizontal className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm sm:text-base">
                      {configTab === 'willie' ? 'تثبيت وقفل تاركت وتغطية ويلي' : 'تثبيت وقفل تاركت وتغطية الحليب'}
                    </h3>
                    <p className="text-[11px] text-slate-400">تحديد أهداف الوزن والمحلات وشروط التغطية للمندوبين</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Product Category Tab Switcher */}
              <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setConfigTab('milk')}
                  className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    configTab === 'milk'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span>🥛</span>
                  <span>تاركت وتغطية الحليب</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfigTab('willie')}
                  className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    configTab === 'willie'
                      ? 'bg-amber-600 text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span>🧀</span>
                  <span>تاركت وتغطية ويلي</span>
                </button>
              </div>

              {/* Delegate Selector */}
              <div>
                <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1">
                  تطبيق الهدف على:
                </label>
                <select
                  value={editDelegate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditDelegate(val);
                    if (val !== 'all') {
                      const cfg = getDelegateConfig(val);
                      setEditFamTarget(cfg.familyMonthlyWeightTargetKg);
                      setEditFamShops(cfg.familyTargetShopsCount);
                      setEditFamMinWeight(cfg.familyMinWeightPerShopKg);
                      setEditSmTarget(cfg.smallMonthlyWeightTargetKg);
                      setEditSmShops(cfg.smallTargetShopsCount);
                      setEditSmMinWeight(cfg.smallMinWeightPerShopKg);
                      setEditWillieTarget(cfg.willieMonthlyWeightTargetKg ?? 182);
                      setEditWillieShops(cfg.willieTargetShopsCount ?? 10);
                      setEditWillieMinWeight(cfg.willieMinWeightPerShopKg ?? 4.0);
                      setEditIsLocked(Boolean(cfg.isLocked));
                    }
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-black border outline-none ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  <option value="all">🌟 تطبيق على كافة المندوبين معاً</option>
                  {activeDelegates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* TAB 1: MILK TARGETS */}
              {configTab === 'milk' && (
                <div className="space-y-3">
                  {/* Section 1: Large Milk Targets */}
                  <div className="p-3.5 rounded-2xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 space-y-3">
                    <h4 className="text-xs font-black text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                      <span>🥛</span>
                      <span>أهداف حليب بطل كبير (1 لتر / عائلي)</span>
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
                          value={editFamTarget}
                          onChange={(e) => setEditFamTarget(Number(e.target.value))}
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
                          value={editFamShops}
                          onChange={(e) => setEditFamShops(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          شرط المحل (أدنى كغم)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editFamMinWeight}
                          onChange={(e) => setEditFamMinWeight(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Small Milk Targets */}
                  <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-3">
                    <h4 className="text-xs font-black text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                      <span>🍼</span>
                      <span>أهداف حليب بطل صغير (200 مل / صغار)</span>
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
                          value={editSmTarget}
                          onChange={(e) => setEditSmTarget(Number(e.target.value))}
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
                          value={editSmShops}
                          onChange={(e) => setEditSmShops(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          شرط المحل (أدنى كغم)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editSmMinWeight}
                          onChange={(e) => setEditSmMinWeight(Number(e.target.value))}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: WILLIE TARGETS */}
              {configTab === 'willie' && (
                <div className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 space-y-3">
                  <h4 className="text-xs font-black text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <span>🧀</span>
                    <span>أهداف وجبن ويلي (Wille Target & Coverage)</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        الهدف الشهري (Target KG)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editWillieTarget}
                        onChange={(e) => setEditWillieTarget(Number(e.target.value))}
                        className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        هدف المحلات (Target Cust)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editWillieShops}
                        onChange={(e) => setEditWillieShops(Number(e.target.value))}
                        className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        شرط المحل المقبول (ثابت 4 كغم)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={editWillieMinWeight}
                        onChange={(e) => setEditWillieMinWeight(Number(e.target.value))}
                        className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-black border text-center ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Lock Target Switch */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  {editIsLocked ? (
                    <Lock className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Unlock className="w-4 h-4 text-slate-400" />
                  )}
                  <div>
                    <span className="text-xs font-black block">قفل وتثبيت الأهداف للشهر</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      يمنع التغييرات العشوائية ويحدد التاركت المعتمد
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={editIsLocked}
                  onChange={(e) => setEditIsLocked(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 cursor-pointer"
                />
              </div>

              {/* Save Button */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfigs}
                  disabled={isSavingConfig}
                  className={`px-5 py-2 rounded-xl text-white text-xs font-black shadow-md transition-all cursor-pointer disabled:opacity-50 ${
                    configTab === 'willie' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'
                  }`}
                >
                  {isSavingConfig ? 'جاري الحفظ...' : configTab === 'willie' ? 'تثبيت وحفظ أهداف ويلي' : 'تثبيت وحفظ أهداف الحليب'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LOCKED CONDITION NOTIFICATION MODAL FOR PRESELLER */}
        {showLockedConditionModal && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
            <div
              className={`w-full max-w-md p-6 rounded-3xl border shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 ${
                isDarkMode ? 'bg-slate-900 border-amber-500/40 text-white' : 'bg-white border-amber-300 text-slate-900'
              }`}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 flex items-center justify-center font-black">
                    <Lock className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                      تنبيه شرط حوافز الوزن (Reward KG)
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      قواعد واشتراطات استحقاق حافز الوزن
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLockedConditionModal(false)}
                  className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Alert Message Box */}
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-2 text-xs font-bold leading-relaxed text-amber-950 dark:text-amber-100">
                    <p className="text-sm font-black text-amber-800 dark:text-amber-300">
                      عزيزي المندوب {lockedModalDelegateName ? `(${lockedModalDelegateName})` : ''}:
                    </p>
                    <p className="text-slate-800 dark:text-slate-200 font-bold">
                      أنت <span className="underline decoration-rose-500 font-black text-rose-600 dark:text-rose-400">لا تستلم حوافز الوزن</span> حالياً!
                    </p>
                    <p className="text-slate-700 dark:text-slate-300 font-bold">
                      لا بد من تحقيق <span className="font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md">حافز التغطية (Reward Cov) بنسبة 100%</span> أولاً، وبعد تحقق هذا الشرط تأخذ وتستلم حوافز الوزن (Reward KG).
                    </p>
                  </div>
                </div>
              </div>

              {/* Rule Summary Details */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-2.5">
                <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-bold">
                  <span>1️⃣ شرط التغطية المطلوبة:</span>
                  <span className="font-black text-emerald-600 dark:text-emerald-400">
                    100% من المحلات (
                    {lockedModalType === 'family' ? '11.5' : lockedModalType === 'small' ? '7.5' : '4.0'} كغم)
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-bold">
                  <span>2️⃣ حافز التغطية (Reward Cov):</span>
                  <span className="font-black text-amber-600 dark:text-amber-400">32,500 د.ع</span>
                </div>
                <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-bold">
                  <span>3️⃣ حافز الوزن (Reward KG):</span>
                  <span className="font-black text-indigo-600 dark:text-indigo-400">32,500 د.ع (ينفتح بعد التغطية 100%)</span>
                </div>
              </div>

              {/* Close Button */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowLockedConditionModal(false)}
                  className="w-full py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  <span>فهمت ذلك (موافق)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
};
