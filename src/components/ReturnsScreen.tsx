import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSales, isExcludedReportDelegate } from '../context/SalesContext';
import { useDebounce } from '../hooks/useDebounce';
import { db } from '../lib/firebase';
import { collection, writeBatch, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { safeOnSnapshot } from '../lib/firestoreUtils';
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
  X,
  Coins,
  AlertTriangle,
  Pencil,
  Percent,
  Calculator,
  Info,
  ShieldAlert
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
  const {
    currentUser,
    isDarkMode,
    delegatesList = [],
    delegateTargets = [],
    delegateAccounts = [],
    addToast
  } = useSales();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportCaptureRef = useRef<HTMLDivElement>(null);

  // Role Checks
  const isAdmin = Boolean(
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    currentUser?.name === 'الأدمن' ||
    currentUser?.username?.toLowerCase() === 'yasir' ||
    currentUser?.username?.toLowerCase() === 'supervisor' ||
    currentUser?.name === 'مشرف' ||
    currentUser?.roleName?.includes('مشرف') ||
    currentUser?.delegateName === '__SUPERVISOR__'
  );

  const isStrictAdmin = Boolean(isAdmin && currentUser?.role !== 'dataEntry');

  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.name?.includes('مدخل') ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );
  const isRafatJamal = Boolean(currentUser?.name === 'رأفت جمال' || currentUser?.username?.toLowerCase() === 'rafatdata');

  const isAdminOrDataEntry = Boolean(isAdmin || isDataEntry);

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
  const debouncedSearchTerm = useDebounce(searchTerm, 400);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // Number of working days in the month (Admin can change it, defaults to 26)
  const [workingDays, setWorkingDays] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('app_returns_working_days');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 31) return parsed;
      }
    } catch {}
    return 26;
  });

  const handleWorkingDaysChange = async (val: number) => {
    if (!isAdmin) return;
    const clean = Math.max(1, Math.min(31, val || 1));
    setWorkingDays(clean);
    try {
      localStorage.setItem('app_returns_working_days', String(clean));
      await setDoc(doc(db, 'app_settings', 'returns_config'), { workingDays: clean }, { merge: true });
    } catch {}
  };

  // Allowed returns percentage from monthly target (Admin can change it, defaults to 3%)
  const [allowedPercentage, setAllowedPercentage] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('app_returns_allowed_percentage');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed;
      }
    } catch {}
    return 3;
  });

  const handleAllowedPercentageChange = async (val: number) => {
    if (!isAdmin) return;
    const clean = Math.max(0, Math.min(100, isNaN(val) ? 0 : val));
    setAllowedPercentage(clean);
    try {
      localStorage.setItem('app_returns_allowed_percentage', String(clean));
      await setDoc(doc(db, 'app_settings', 'returns_config'), { allowedPercentage: clean }, { merge: true });
    } catch {}
  };

  // Penalty step in kg configured by Admin (Default: 100 kg)
  // عندما يزيد الراجع بمقدار (X) كيلو فوق التاركت المسموح
  const [penaltyWeightStep, setPenaltyWeightStep] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('app_returns_penalty_weight_step');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {}
    return 100;
  });

  const handlePenaltyWeightStepChange = async (val: number) => {
    if (!isAdmin) return;
    const clean = Math.max(1, isNaN(val) ? 100 : val);
    setPenaltyWeightStep(clean);
    try {
      localStorage.setItem('app_returns_penalty_weight_step', String(clean));
      await setDoc(doc(db, 'app_settings', 'returns_config'), { penaltyWeightStep: clean }, { merge: true });
    } catch {}
  };

  // Penalty amount per step in thousands IQD configured by Admin (Default: 10 thousand = 10,000 IQD)
  // تضاف غرامة (Y) آلاف د.ع
  const [penaltyAmountStep, setPenaltyAmountStep] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('app_returns_penalty_amount_step');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0) return parsed;
      }
    } catch {}
    return 10;
  });

  const handlePenaltyAmountStepChange = async (val: number) => {
    if (!isAdmin) return;
    const clean = Math.max(0, isNaN(val) ? 0 : val);
    setPenaltyAmountStep(clean);
    try {
      localStorage.setItem('app_returns_penalty_amount_step', String(clean));
      await setDoc(doc(db, 'app_settings', 'returns_config'), { penaltyAmountStep: clean }, { merge: true });
    } catch {}
  };

  // Fixed Daily Targets entered by Admin per delegate (independent from Report 11, stays fixed until changed)
  const [dailyTargets, setDailyTargets] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('app_returns_daily_targets');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
      const oldCustom = localStorage.getItem('app_returns_custom_daily_targets');
      if (oldCustom) {
        const parsedOld = JSON.parse(oldCustom);
        if (parsedOld && typeof parsedOld === 'object') return parsedOld;
      }
    } catch {}
    return {};
  });

  // Modal state for editing a delegate's daily target (Admin Only)
  const [editingDailyTargetDelegate, setEditingDailyTargetDelegate] = useState<{
    delegateName: string;
    dailyTarget: number;
  } | null>(null);

  const handleSaveDailyTarget = async (delegateName: string, dailyVal: number) => {
    if (!isAdmin) return;
    const cleanVal = Math.max(0, Number(dailyVal) || 0);
    const updated = { ...dailyTargets, [delegateName]: cleanVal };
    setDailyTargets(updated);
    try {
      localStorage.setItem('app_returns_daily_targets', JSON.stringify(updated));
      await setDoc(doc(db, 'app_settings', 'returns_config'), { 
        dailyTargets: updated,
        customDailyTargets: updated 
      }, { merge: true });
    } catch (e) {
      console.error('Error saving daily target:', e);
    }
    setEditingDailyTargetDelegate(null);
    addToast({
      title: 'تم حفظ وتثبيت التاركت اليومي',
      message: `تم تثبيت التاركت اليومي للمندوب "${delegateName}" بقيمة (${formatWithCommas(cleanVal)} كغم).`,
      type: 'success',
    });
  };

  const handleResetDelegateDailyTarget = async (delegateName: string) => {
    if (!isAdmin) return;
    const updated = { ...dailyTargets };
    delete updated[delegateName];
    setDailyTargets(updated);
    try {
      localStorage.setItem('app_returns_daily_targets', JSON.stringify(updated));
      await setDoc(doc(db, 'app_settings', 'returns_config'), { 
        dailyTargets: updated,
        customDailyTargets: updated 
      }, { merge: true });
    } catch (e) {
      console.error('Error resetting daily target:', e);
    }
    setEditingDailyTargetDelegate(null);
    addToast({
      title: 'إلغاء التثبيت',
      message: `تمت استعادة التاركت اليومي الافتراضي للمندوب "${delegateName}".`,
      type: 'info',
    });
  };

  const handleResetAllDailyTargets = async () => {
    if (!isAdmin) return;
    const confirm = await showConfirm(
      `هل تريد إعادة ضبط وحذف التاركت اليومي الثابت لجميع المندوبين؟`,
      {
        title: 'إعادة ضبط التاركت اليومي',
        variant: 'warning',
        confirmText: 'نعم، إعادة الضبط',
        cancelText: 'إلغاء',
      }
    );
    if (!confirm) return;
    setDailyTargets({});
    try {
      localStorage.removeItem('app_returns_daily_targets');
      localStorage.removeItem('app_returns_custom_daily_targets');
      await setDoc(doc(db, 'app_settings', 'returns_config'), { 
        dailyTargets: {},
        customDailyTargets: {} 
      }, { merge: true });
    } catch (e) {
      console.error('Error resetting daily targets:', e);
    }
    addToast({
      title: 'تمت الاستعادة',
      message: 'تم تصفير التاركت اليومي الثابت لجميع المندوبين.',
      type: 'success',
    });
  };

  // Realtime Firestore synchronization for returns config (working days, allowed percentage, penalty rules, fixed daily targets)
  useEffect(() => {
    const unsubReturnsConfig = safeOnSnapshot(
      doc(db, 'app_settings', 'returns_config'),
      (docSnap: any) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.workingDays !== undefined && Number(data.workingDays) > 0) {
            setWorkingDays(Number(data.workingDays));
            localStorage.setItem('app_returns_working_days', String(data.workingDays));
          }
          if (data.allowedPercentage !== undefined && Number(data.allowedPercentage) >= 0) {
            setAllowedPercentage(Number(data.allowedPercentage));
            localStorage.setItem('app_returns_allowed_percentage', String(data.allowedPercentage));
          }
          if (data.penaltyWeightStep !== undefined && Number(data.penaltyWeightStep) > 0) {
            setPenaltyWeightStep(Number(data.penaltyWeightStep));
            localStorage.setItem('app_returns_penalty_weight_step', String(data.penaltyWeightStep));
          }
          if (data.penaltyAmountStep !== undefined && Number(data.penaltyAmountStep) >= 0) {
            setPenaltyAmountStep(Number(data.penaltyAmountStep));
            localStorage.setItem('app_returns_penalty_amount_step', String(data.penaltyAmountStep));
          }
          if (data.dailyTargets && typeof data.dailyTargets === 'object') {
            setDailyTargets(data.dailyTargets);
            localStorage.setItem('app_returns_daily_targets', JSON.stringify(data.dailyTargets));
          } else if (data.customDailyTargets && typeof data.customDailyTargets === 'object') {
            setDailyTargets(data.customDailyTargets);
            localStorage.setItem('app_returns_daily_targets', JSON.stringify(data.customDailyTargets));
          }
        }
      },
      (err: any) => console.warn('Could not listen to returns_config:', err),
      'ReturnsScreen-config'
    );

    return () => {
      unsubReturnsConfig();
    };
  }, []);

  // Helper to extract a delegate's daily target
  // Independent from Report 11! The Admin enters it and it stays fixed until changed.
  const getDelegateDailyTarget = (delName: string): number => {
    // 1. Highest Priority: Fixed daily target set by Admin
    if (dailyTargets[delName] !== undefined && Number(dailyTargets[delName]) >= 0) {
      return Number(dailyTargets[delName]);
    }

    const norm = normalizeArabic(delName);
    for (const [key, val] of Object.entries(dailyTargets)) {
      if (normalizeArabic(key) === norm && Number(val) >= 0) {
        return Number(val);
      }
    }

    // 2. Fallback: From delegateTargets (sum of categories) if configured
    const foundTargets = (delegateTargets || []).filter(
      (t) => normalizeArabic(t.delegateName) === norm
    );
    if (foundTargets.length > 0) {
      const sum = foundTargets.reduce((s, t) => s + (Number(t.dailyTargetWeightKg) || 0), 0);
      if (sum > 0) return Math.round(sum);
    }

    // 3. Fallback: From delegateAccounts (monthlyTargetKg / 26)
    const acc = (delegateAccounts || []).find((a) => normalizeArabic(a.delegateName) === norm);
    if (acc && acc.monthlyTargetKg > 0) {
      return Math.round((acc.monthlyTargetKg / 26) );
    }
    return 0;
  };

  // Helper to get total monthly target (Daily Target * Working Days)
  const getDelegateMonthlyTarget = (delName: string): number => {
    const daily = getDelegateDailyTarget(delName);
    return Math.round(daily * workingDays);
  };

  // New manual entry state
  const [newEntry, setNewEntry] = useState<{
    delegateName: string;
    shopsCount: number;
    monthlyReturnedWeightKg: number;
  }>({
    delegateName: delegatesList.filter(d => !isExcludedReportDelegate(d))[0] || '',
    shopsCount: 0,
    monthlyReturnedWeightKg: 0,
  });

  // Realtime Firestore synchronization
  useEffect(() => {
    setIsLoading(true);
    const colRef = collection(db, 'monthly_delegate_returns');
    const unsubscribe = safeOnSnapshot(
      colRef,
      (snapshot: any) => {
        const items: MonthlyDelegateReturn[] = [];
        snapshot.forEach((docSnap: any) => {
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
      (error: any) => {
        console.error('Error listening to monthly_delegate_returns:', error);
        setIsLoading(false);
      },
      'ReturnsScreen-returns'
    );

    return () => unsubscribe();
  }, []);

  // Helper to check if a delegate row belongs to the current logged-in delegate
  const isDelegateMatchingCurrentUser = useCallback((delName: string): boolean => {
    if (!currentUser) return false;
    const normRow = normalizeArabic(delName);

    const candidates = [
      loggedInRepName,
      currentUser.name,
      currentUser.delegateName,
      currentUser.username,
    ].filter(Boolean) as string[];

    for (const c of candidates) {
      const normC = normalizeArabic(c);
      if (normRow === normC) return true;

      const cleanRow = normRow.replace(/^(مندوب|المندوب)\s+/, '').trim();
      const cleanC = normC.replace(/^(مندوب|المندوب)\s+/, '').trim();
      if (cleanRow && cleanC) {
        if (cleanRow === cleanC) return true;
        if (cleanRow.length >= 3 && cleanC.length >= 3) {
          if (cleanRow.includes(cleanC) || cleanC.includes(cleanRow)) return true;
        }
      }
    }

    if (currentUser.username) {
      const acc = delegateAccounts.find(
        (a) => a.username?.toLowerCase() === currentUser.username?.toLowerCase()
      );
      if (acc && acc.delegateName) {
        const normAcc = normalizeArabic(acc.delegateName);
        if (normRow === normAcc) return true;
        const cleanRow = normRow.replace(/^(مندوب|المندوب)\s+/, '').trim();
        const cleanAcc = normAcc.replace(/^(مندوب|المندوب)\s+/, '').trim();
        if (cleanRow && cleanAcc && (cleanRow === cleanAcc || cleanRow.includes(cleanAcc) || cleanAcc.includes(cleanRow))) {
          return true;
        }
      }
    }

    if (currentUser.delegateCode) {
      const acc = delegateAccounts.find(
        (a) => a.delegateCode === currentUser.delegateCode
      );
      if (acc && acc.delegateName) {
        const normAcc = normalizeArabic(acc.delegateName);
        if (normRow === normAcc) return true;
      }
    }

    return false;
  }, [currentUser, loggedInRepName, delegateAccounts]);

  // Filter out excluded delegates (e.g. مندوب عام 1 and مندوب عام 2)
  // PRIVACY: If logged in as a delegate (not Admin and not Data Entry), show ONLY their own account!
  const sanitizedReturnsList = useMemo(() => {
    let list = returnsList.filter((item) => !isExcludedReportDelegate(item.delegateName));

    if (!isAdminOrDataEntry) {
      const userMatches = list.filter((item) => isDelegateMatchingCurrentUser(item.delegateName));

      if (userMatches.length > 0) {
        list = userMatches;
      } else {
        // If no return record exists for this delegate yet, provide a row showing their account with 0 returns
        const myName = loggedInRepName || currentUser?.name || 'حسابك';
        list = [{
          id: `del_self_${Date.now()}`,
          delegateName: myName,
          shopsCount: 0,
          monthlyReturnedWeightKg: 0,
          monthString: new Date().toISOString().slice(0, 7),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }];
      }
    }

    return list;
  }, [returnsList, isAdminOrDataEntry, isDelegateMatchingCurrentUser, loggedInRepName, currentUser]);

  // Filtered list based on search term (search only active for Admin / Data Entry)
  const filteredReturns = useMemo(() => {
    if (!isAdminOrDataEntry) return sanitizedReturnsList;
    if (!debouncedSearchTerm.trim()) return sanitizedReturnsList;
    const term = normalizeArabic(debouncedSearchTerm);
    return sanitizedReturnsList.filter((item) => normalizeArabic(item.delegateName).includes(term));
  }, [sanitizedReturnsList, debouncedSearchTerm, isAdminOrDataEntry]);

  // Aggregated totals for main returns table
  const totalDelegatesCount = sanitizedReturnsList.length;
  const totalShopsCount = useMemo(
    () => sanitizedReturnsList.reduce((sum, r) => sum + (r.shopsCount || 0), 0),
    [sanitizedReturnsList]
  );
  const totalReturnedWeightKg = useMemo(
    () => Number(sanitizedReturnsList.reduce((sum, r) => sum + (r.monthlyReturnedWeightKg || 0), 0).toFixed(0)),
    [sanitizedReturnsList]
  );

  // Table 2: Data for Allowed Returns & Penalties (جدول الراجع المسموح وغراماته)
  const allowedReturnsData = useMemo(() => {
    const stepKg = penaltyWeightStep > 0 ? penaltyWeightStep : 100;
    const finePerStep = penaltyAmountStep >= 0 ? penaltyAmountStep * 1000 : 10000;

    return filteredReturns.map((item) => {
      const delName = item.delegateName;
      const dailyTargetKg = getDelegateDailyTarget(delName);
      const isCustomDaily = dailyTargets[delName] !== undefined && Number(dailyTargets[delName]) >= 0;
      const monthlyTotalTargetKg = getDelegateMonthlyTarget(delName);

      // Rule: Allowed returns = allowedPercentage % of monthly total target
      const allowedReturnKg = Number((monthlyTotalTargetKg * (allowedPercentage / 100)).toFixed(0));
      // Returned weight so far (from table above)
      const actualReturnKg = Number((item.monthlyReturnedWeightKg || 0).toFixed(0));
      // Difference
      const diffKg = Number((actualReturnKg - allowedReturnKg).toFixed(0));

      // Penalty Rule:
      // When excess >= penaltyWeightStep over allowed, add penaltyAmountStep thousands IQD.
      // For every additional penaltyWeightStep kg excess, add another penaltyAmountStep thousands IQD.
      let penaltyAmount = 0;
      let penaltyTiers = 0;
      if (diffKg >= stepKg) {
        penaltyTiers = Math.floor(diffKg / stepKg);
        penaltyAmount = penaltyTiers * finePerStep;
      }

      return {
        id: item.id,
        delegateName: delName,
        dailyTargetKg,
        monthlyTotalTargetKg,
        allowedReturnKg,
        actualReturnKg,
        diffKg,
        penaltyAmount,
        penaltyTiers,
        isCustomDaily,
      };
    });
  }, [filteredReturns, workingDays, allowedPercentage, penaltyWeightStep, penaltyAmountStep, dailyTargets, delegateTargets, delegateAccounts]);

  // Aggregated totals for Table 2 (Allowed Returns & Penalties)
  const totalMonthlyTargetSum = useMemo(
    () => Number(allowedReturnsData.reduce((sum, r) => sum + r.monthlyTotalTargetKg, 0).toFixed(0)),
    [allowedReturnsData]
  );

  const totalAllowedReturnSum = useMemo(
    () => Number(allowedReturnsData.reduce((sum, r) => sum + r.allowedReturnKg, 0).toFixed(0)),
    [allowedReturnsData]
  );

  const totalActualReturnSum = useMemo(
    () => Number(allowedReturnsData.reduce((sum, r) => sum + r.actualReturnKg, 0).toFixed(0)),
    [allowedReturnsData]
  );

  const totalPenaltiesSum = useMemo(
    () => allowedReturnsData.reduce((sum, r) => sum + r.penaltyAmount, 0),
    [allowedReturnsData]
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

        const cleanWeight = Number(monthlyReturnedWeightKg.toFixed(0));

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

  // Export Tables to Excel
  const handleExportToExcel = () => {
    if (sanitizedReturnsList.length === 0) {
      showAlert('لا توجد بيانات في جدول المرتجعات لتصديرها.', 'تنبيه', 'warning');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: ملخص المرتجعات الشهري
      const exportData = sanitizedReturnsList.map((r, idx) => ({
        'ت': idx + 1,
        'اسم المندوب': r.delegateName,
        'عدد المحلات خلال الشهر': r.shopsCount,
        'الوزن الراجع للشهري (كغم)': r.monthlyReturnedWeightKg,
      }));

      // Add summary row
      exportData.push({
        'ت': 'المجموع',
        'اسم المندوب': `${sanitizedReturnsList.length} مندوب`,
        'عدد المحلات خلال الشهر': totalShopsCount,
        'الوزن الراجع للشهري (كغم)': totalReturnedWeightKg,
      } as any);

      const ws1 = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, ws1, 'المرتجعات الشهرية');

      // Sheet 2: الراجع المسموح وغراماته (للأدمن فقط)
      if (isStrictAdmin) {
        const exportAllowedData = allowedReturnsData.map((row, idx) => ({
          'ت': idx + 1,
          'اسم المندوب': row.delegateName,
          'التاركت اليومي (كغم)': row.dailyTargetKg,
          'أيام العمل بالشهر': workingDays,
          'التاركت الكلي الشهري (كغم)': row.monthlyTotalTargetKg,
          [`الوزن الراجع المسموح (${allowedPercentage}%) (كغم)`]: row.allowedReturnKg,
          'الوزن الراجع لحد الآن (كغم)': row.actualReturnKg,
          'الفرق عن المسموح (كغم)': row.diffKg,
          [`الغرامة المفروضة (د.ع) (لكل ${penaltyWeightStep} كغم زيادة = +${penaltyAmountStep} آلاف)`]: row.penaltyAmount,
        }));

        exportAllowedData.push({
          'ت': 'المجموع',
          'اسم المندوب': `${allowedReturnsData.length} مندوب`,
          'التاركت اليومي (كغم)': '',
          'أيام العمل بالشهر': workingDays,
          'التاركت الكلي الشهري (كغم)': totalMonthlyTargetSum,
          [`الوزن الراجع المسموح (${allowedPercentage}%) (كغم)`]: totalAllowedReturnSum,
          'الوزن الراجع لحد الآن (كغم)': totalActualReturnSum,
          'الفرق عن المسموح (كغم)': '',
          [`الغرامة المفروضة (د.ع) (لكل ${penaltyWeightStep} كغم زيادة = +${penaltyAmountStep} آلاف)`]: totalPenaltiesSum,
        } as any);

        const ws2 = XLSX.utils.json_to_sheet(exportAllowedData);
        XLSX.utils.book_append_sheet(wb, ws2, 'الراجع المسموح وغراماته');
      }

      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = isAdmin
        ? `تقرير_المرتجعات_والراجع_المسموح_${dateStr}.xlsx`
        : `تقرير_المرتجعات_الشهرية_${dateStr}.xlsx`;
      XLSX.writeFile(wb, fileName);

      addToast({
        title: 'تم التصدير',
        message: isAdmin
          ? 'تم تنزيل ملف الإكسل (جدول ملخص المرتجعات + جدول الراجع المسموح وغراماته) بنجاح.'
          : 'تم تنزيل ملف الإكسل (جدول ملخص المرتجعات) بنجاح.',
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
        monthlyReturnedWeightKg: Number((parseFloat(String(newEntry.monthlyReturnedWeightKg)) || 0).toFixed(0)),
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
            {isAdmin && !isRafatJamal && (
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

            {/* Excel Upload (Admin Only) */}
            {isAdmin && !isRafatJamal && (
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
            {isAdmin && !isRafatJamal && returnsList.length > 0 && (
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
        <div className={`grid gap-3 mt-5 ${isAdmin ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
          {/* Total Returned Weight */}
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${
            isDarkMode ? 'bg-slate-800/60 border-slate-700/60' : 'bg-emerald-50/70 border-emerald-200/70'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {isAdminOrDataEntry ? 'إجمالي الراجع الشهري' : 'الراجع الشهري لحسابك'}
              </span>
              <Scale className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-base sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
              {formatWithCommas(totalReturnedWeightKg)} <span className="text-xs font-bold">كغم</span>
            </div>
          </div>

          {/* Total Allowed Returns Weight (Admin Only) */}
          {isAdmin && (
            <div className={`p-3.5 sm:p-4 rounded-2xl border ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700/60' : 'bg-amber-50/70 border-amber-200/70'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  الراجع المسموح ({allowedPercentage}%)
                </span>
                <Coins className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-base sm:text-2xl font-black font-mono text-amber-600 dark:text-amber-400 mt-1">
                {formatWithCommas(totalAllowedReturnSum)} <span className="text-xs font-bold">كغم</span>
              </div>
            </div>
          )}

          {/* Total Penalties (Admin Only) */}
          {isAdmin && (
            <div className={`p-3.5 sm:p-4 rounded-2xl border ${
              totalPenaltiesSum > 0
                ? isDarkMode
                  ? 'bg-rose-950/30 border-rose-900/60'
                  : 'bg-rose-50/70 border-rose-200/70'
                : isDarkMode
                ? 'bg-slate-800/60 border-slate-700/60'
                : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  إجمالي الغرامات المفروضة
                </span>
                <AlertTriangle className={`w-4 h-4 ${totalPenaltiesSum > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
              </div>
              <div className={`text-base sm:text-2xl font-black font-mono mt-1 ${
                totalPenaltiesSum > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
              }`}>
                {totalPenaltiesSum > 0 ? `${formatWithCommas(totalPenaltiesSum)} د.ع` : '0 د.ع'}
              </div>
            </div>
          )}

          {/* Total Shops for non-admin representative */}
          {!isAdmin && (
            <div className={`p-3.5 sm:p-4 rounded-2xl border ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700/60' : 'bg-purple-50/70 border-purple-200/70'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  عدد المحلات خلال الشهر
                </span>
                <Store className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-base sm:text-2xl font-black font-mono text-purple-600 dark:text-purple-400 mt-1">
                {formatWithCommas(totalShopsCount)} <span className="text-xs font-bold">محل</span>
              </div>
            </div>
          )}

          {/* Total Delegates Count / Delegate Name */}
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${
            isDarkMode ? 'bg-slate-800/60 border-slate-700/60' : 'bg-blue-50/70 border-blue-200/70'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {isAdminOrDataEntry ? 'عدد المندوبين' : 'حساب المندوب'}
              </span>
              <User className="w-4 h-4 text-blue-500" />
            </div>
            {isAdminOrDataEntry ? (
              <div className="text-base sm:text-2xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
                {formatWithCommas(totalDelegatesCount)} <span className="text-xs font-bold">مندوب</span>
              </div>
            ) : (
              <div className="text-sm sm:text-base font-black text-blue-600 dark:text-blue-400 mt-1 truncate" title={sanitizedReturnsList[0]?.delegateName || loggedInRepName}>
                {sanitizedReturnsList[0]?.delegateName || loggedInRepName || 'حسابك'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search and Helper Filter Bar (Admin & Data Entry Only) */}
      {isAdminOrDataEntry && (
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
          <button
            onClick={handleDownloadTemplate}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg border border-dashed border-emerald-300 dark:border-emerald-800"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>تحميل نموذج إكسل للاستيراد</span>
          </button>
        </div>
      )}

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
            <thead className={`font-black text-[10px] sm:text-[11px] uppercase border-b ${
              isDarkMode ? 'bg-slate-800/80 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-1.5 sm:px-3 w-8 sm:w-10 text-center">#</th>
                <th className="py-2.5 px-2 sm:px-3">اسم المندوب</th>
                <th className="py-2.5 px-1.5 sm:px-3 text-center">عدد المحلات</th>
                <th className="py-2.5 px-2 sm:px-3 text-center font-black">الوزن الراجع (كغم)</th>
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
                      <td className="py-2 px-1.5 sm:px-3 text-center font-mono text-slate-400 text-[10px] sm:text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2 sm:px-3 font-black text-slate-900 dark:text-white text-xs sm:text-sm">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>{row.delegateName}</span>
                          {isCurrentRep && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                              (أنت)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-1.5 sm:px-3 text-center font-mono font-bold text-purple-700 dark:text-purple-400 text-xs sm:text-sm">
                        {formatWithCommas(row.shopsCount)} <span className="text-[10px] text-slate-400 font-sans">محل</span>
                      </td>
                      <td className="py-2 px-2 sm:px-3 text-center font-mono font-black text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm">
                        {formatWithCommas(row.monthlyReturnedWeightKg)} <span className="text-[10px] text-slate-400 font-sans">كغم</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer: Totals */}
            {sanitizedReturnsList.length > 0 && (
              <tfoot className={`font-black border-t-2 ${
                isDarkMode ? 'bg-slate-800 text-white border-slate-700' : 'bg-slate-100 text-slate-900 border-slate-300'
              }`}>
                <tr>
                  <td colSpan={2} className="py-3 px-4 text-right">
                    {isAdminOrDataEntry
                      ? `المجموع الكلي (${sanitizedReturnsList.length} مندوب):`
                      : `المجموع لحسابك (${sanitizedReturnsList[0]?.delegateName || ''}):`}
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

        {/* ============================================================== */}
        {/* TABLE 2: جدول الراجع المسموح وغراماته (يظهر للجميع) */}
        {/* ============================================================== */}
        <div className="pt-8 border-t-2 border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black shrink-0 border border-amber-500/20">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black flex items-center gap-2">
                <span>جدول الراجع المسموح وغراماته</span>
                {isAdmin && !isRafatJamal && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                    النسبة المسموحة: {allowedPercentage}%
                  </span>
                )}
              </h2>
              {isAdmin && !isRafatJamal ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  احتساب الراجع المسموح ({allowedPercentage}% من التاركت الشهري الكلي) والغرامات عند تجاوز الحد المسموح
                </p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  تفاصيل الراجع المسموح والغرامات المحتسبة لحسابك حسب التاركت اليومي
                </p>
              )}
            </div>
          </div>

            {/* Controls: Allowed Percentage, Working Days, Penalty Rules & Reset */}
            {isAdmin && !isRafatJamal && (
              <div className="flex items-center gap-2 flex-wrap report-actions-col">
                <>
                  {/* Allowed Percentage Input - Admin Only */}
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs shadow-xs ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}>
                    <Percent className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="font-bold">النسبة المسموحة:</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={allowedPercentage}
                      onChange={(e) => handleAllowedPercentageChange(parseFloat(e.target.value))}
                      className="w-14 text-center font-mono font-black py-0.5 px-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 outline-none focus:border-amber-500"
                      title="أدخل النسبة المئوية للراجع المسموح من التاركت الكلي"
                    />
                    <span className="text-amber-600 dark:text-amber-400 font-bold">%</span>
                  </div>

                  {/* Working Days Input - Admin Only */}
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs shadow-xs ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}>
                    <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span className="font-bold">أيام العمل:</span>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={workingDays}
                      onChange={(e) => handleWorkingDaysChange(parseInt(e.target.value, 10))}
                      className="w-14 text-center font-mono font-black py-0.5 px-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-blue-500"
                      title="أدخل عدد أيام العمل في الشهر لضرب التاركت اليومي بها"
                    />
                    <span className="text-slate-400 font-bold">يوم</span>
                  </div>

                  {/* Penalty Step and Amount Inputs - Admin Only */}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs shadow-xs ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}>
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="font-bold">زيادة لكل:</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={penaltyWeightStep}
                      onChange={(e) => handlePenaltyWeightStepChange(parseFloat(e.target.value))}
                      className="w-14 text-center font-mono font-black py-0.5 px-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 outline-none focus:border-rose-500"
                      title="عندما يزيد الراجع بمقدار هذا الرقم (كغم) فوق التاركت المسموح"
                    />
                    <span className="text-slate-400 font-bold">كغم</span>
                    <span className="font-bold text-slate-500 dark:text-slate-400 mr-1">= غرامة</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={penaltyAmountStep}
                      onChange={(e) => handlePenaltyAmountStepChange(parseFloat(e.target.value))}
                      className="w-12 text-center font-mono font-black py-0.5 px-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 outline-none focus:border-rose-500"
                      title="مبلغ الغرامة المفروضة بآلاف الدنانير (مثلاً 10 = 10 آلاف د.ع)"
                    />
                    <span className="text-rose-600 dark:text-rose-400 font-bold">آلاف د.ع</span>
                  </div>

                  {Object.keys(dailyTargets).length > 0 && (
                    <button
                      onClick={handleResetAllDailyTargets}
                      className="px-2.5 py-1.5 rounded-xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100 text-[11px] font-bold text-amber-700 dark:text-amber-300 transition-colors flex items-center gap-1 cursor-pointer"
                      title="إعادة ضبط التاركت اليومي لجميع المندوبين"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>إعادة ضبط التاركت اليومي</span>
                    </button>
                  )}
                </>
              </div>
            )}
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <table className="w-full text-right text-xs">
              <thead className={`font-black text-[10px] sm:text-[11px] uppercase border-b ${
                isDarkMode ? 'bg-slate-800/80 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}>
                <tr>
                  <th className="py-2.5 px-1 w-7 sm:w-8 text-center">#</th>
                  <th className="py-2.5 px-1.5 min-w-[85px] sm:min-w-[115px]">المندوب</th>
                  <th className="py-2.5 px-1 text-center min-w-[70px] sm:min-w-[95px]">
                    <div className="flex flex-col items-center justify-center">
                      <span>ت. اليومي</span>
                      {isAdmin && !isRafatJamal && (
                        <span className="text-[8px] text-amber-500 font-normal">(تعديل)</span>
                      )}
                    </div>
                  </th>
                  <th className="py-2.5 px-1 text-center min-w-[70px] sm:min-w-[95px]">
                    <div className="flex flex-col items-center justify-center">
                      <span>ت. الكلي</span>
                      <span className="text-[8px] text-slate-400 font-normal">({workingDays}ي)</span>
                    </div>
                  </th>
                  <th className="py-2.5 px-1 text-center text-amber-700 dark:text-amber-400 font-black min-w-[70px] sm:min-w-[95px]">
                    <div className="flex flex-col items-center justify-center">
                      <span>المسموح</span>
                      <span className="text-[8px] font-normal">({allowedPercentage}%)</span>
                    </div>
                  </th>
                  <th className="py-2.5 px-1 text-center text-blue-700 dark:text-blue-400 font-black min-w-[70px] sm:min-w-[90px]">
                    <span>الراجع الحالي</span>
                  </th>
                  <th className="py-2.5 px-1 text-center min-w-[75px] sm:min-w-[100px]">الفرق</th>
                  <th className="py-2.5 px-1 text-center text-rose-700 dark:text-rose-400 font-black min-w-[75px] sm:min-w-[105px]">
                    <div className="flex flex-col items-center">
                      <span>الغرامات</span>
                      {isAdmin && (
                        <span className="text-[8px] text-slate-400 font-normal">
                          (+{penaltyAmountStep}ك لكل +{penaltyWeightStep}كغم)
                        </span>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-500" />
                      <span>جاري تحميل البيانات...</span>
                    </td>
                  </tr>
                ) : allowedReturnsData.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                      {sanitizedReturnsList.length === 0
                        ? 'يرجى تسجيل أو استيراد بيانات المرتجعات في الجدول أعلاه لحساب الراجع المسموح والغرامات.'
                        : 'لا توجد نتائج مطابقة لبحثك.'}
                    </td>
                  </tr>
                ) : (
                  allowedReturnsData.map((row, idx) => {
                    const isCurrentRep = loggedInRepName && normalizeArabic(row.delegateName) === normalizeArabic(loggedInRepName);
                    const hasPenalty = row.penaltyAmount > 0;

                    return (
                      <tr
                        key={row.id || idx}
                        className={`transition-colors ${
                          isCurrentRep
                            ? isDarkMode
                              ? 'bg-amber-950/30 hover:bg-amber-900/30 font-bold'
                              : 'bg-amber-50/70 hover:bg-amber-100/70 font-bold'
                            : hasPenalty
                            ? isDarkMode
                              ? 'bg-rose-950/20 hover:bg-rose-950/30'
                              : 'bg-rose-50/50 hover:bg-rose-100/60'
                            : idx % 2 === 0
                            ? isDarkMode
                              ? 'bg-slate-900'
                              : 'bg-white hover:bg-slate-50'
                            : isDarkMode
                            ? 'bg-slate-800/30 hover:bg-slate-800/60'
                            : 'bg-slate-50/70 hover:bg-slate-100/70'
                        }`}
                      >
                        <td className="py-2 px-1 text-center font-mono text-slate-400 text-[10px] sm:text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-1.5 font-black text-slate-900 dark:text-white text-[11px] sm:text-xs">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-blue-500 shrink-0" />
                            <span className="truncate">{row.delegateName}</span>
                            {isCurrentRep && (
                              <span className="px-1 py-0.2 rounded text-[8px] font-bold bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 shrink-0">
                                أنت
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Daily Target with direct edit button */}
                        <td className="py-2 px-1 text-center font-mono font-bold text-[11px] sm:text-xs">
                          <div className="flex items-center justify-center gap-0.5">
                            {row.dailyTargetKg > 0 ? (
                              <span className="text-slate-900 dark:text-slate-100 font-black">
                                {formatWithCommas(row.dailyTargetKg)}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[10px] font-normal">—</span>
                            )}
                            {row.isCustomDaily && (
                              <span className="text-[8px] px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 font-sans font-bold" title="تاركت يومي ثابت">
                                ثابت
                              </span>
                            )}
                            {isAdmin && !isRafatJamal && (
                              <button
                                onClick={() =>
                                  setEditingDailyTargetDelegate({
                                    delegateName: row.delegateName,
                                    dailyTarget: row.dailyTargetKg,
                                  })
                                }
                                className="p-0.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                title="تعديل وتثبيت التاركت اليومي للمندوب"
                              >
                                <Pencil className="w-3 h-3 text-amber-500 hover:text-amber-600" />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Monthly Total Target */}
                        <td className="py-2 px-1 text-center font-mono font-bold text-[11px] sm:text-xs">
                          <span className="text-slate-900 dark:text-slate-100 font-black">
                            {formatWithCommas(row.monthlyTotalTargetKg)}
                          </span>
                        </td>

                        {/* Allowed Return Weight */}
                        <td className="py-2 px-1 text-center font-mono font-black text-amber-700 dark:text-amber-400 text-[11px] sm:text-xs">
                          {formatWithCommas(row.allowedReturnKg)}
                        </td>

                        {/* Actual Return Weight from table above */}
                        <td className="py-2 px-1 text-center font-mono font-black text-blue-700 dark:text-blue-400 text-[11px] sm:text-xs">
                          {formatWithCommas(row.actualReturnKg)}
                        </td>

                        {/* Difference from Allowed */}
                        <td className="py-2 px-1 text-center font-mono text-[10px] sm:text-xs">
                          {row.diffKg <= 0 ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800/60 whitespace-nowrap">
                              متبقي {formatWithCommas(Math.abs(row.diffKg))}
                            </span>
                          ) : (
                            <span className={`inline-block px-1.5 py-0.5 rounded font-bold border whitespace-nowrap ${
                              row.diffKg >= penaltyWeightStep
                                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                            }`}>
                              +{formatWithCommas(row.diffKg)} زيادة
                            </span>
                          )}
                        </td>

                        {/* Penalties Column */}
                        <td className="py-2 px-1 text-center">
                          {hasPenalty ? (
                            <span className="inline-block px-1.5 py-0.5 rounded-lg text-[10px] sm:text-xs font-black font-mono bg-rose-600 text-white shadow-xs whitespace-nowrap">
                              {formatWithCommas(row.penaltyAmount)} د.ع
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-mono">
                              0
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Table Footer: Totals */}
              {allowedReturnsData.length > 0 && (
                <tfoot className={`font-black border-t-2 text-[10px] sm:text-xs ${
                  isDarkMode ? 'bg-slate-800 text-white border-slate-700' : 'bg-slate-100 text-slate-900 border-slate-300'
                }`}>
                  <tr>
                    <td colSpan={3} className="py-2.5 px-2 text-right">
                      {isAdminOrDataEntry
                        ? `المجموع (${allowedReturnsData.length}):`
                        : `المجموع:`}
                    </td>
                    <td className="py-2.5 px-1 text-center font-mono">
                      {formatWithCommas(totalMonthlyTargetSum)}
                    </td>
                    <td className="py-2.5 px-1 text-center font-mono text-amber-700 dark:text-amber-300">
                      {formatWithCommas(totalAllowedReturnSum)}
                    </td>
                    <td className="py-2.5 px-1 text-center font-mono text-blue-700 dark:text-blue-300">
                      {formatWithCommas(totalActualReturnSum)}
                    </td>
                    <td className="py-2.5 px-1 text-center text-[10px] text-slate-400">
                      —
                    </td>
                    <td className="py-2.5 px-1 text-center font-mono font-black text-rose-600 dark:text-rose-400">
                      {totalPenaltiesSum > 0 ? `${formatWithCommas(totalPenaltiesSum)} د.ع` : '0'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Explanatory Box - Admin Only */}
          {isAdmin && !isRafatJamal && (
            <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
              isDarkMode ? 'bg-slate-800/40 border-slate-700/60 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <div className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                <Info className="w-4 h-4 text-blue-500 shrink-0" />
                <span>قواعد احتساب جدول الراجع المسموح وغراماته:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">التاركت اليومي:</strong> يدخله الأدمن لكل مندوب بشكل ثابت بالضغط على زر القلم (✏️)، ويبقى محفوظاً وثابتاً لحين تغييره مرة ثانية (مفصول تماماً عن التقرير 11).
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">التاركت الكلي:</strong> حاصل ضرب التاركت اليومي للمندوب في عدد أيام العمل بالشهر ({workingDays} يوم).
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">الوزن الراجع المسموح:</strong> يحسب تلقائياً بنسبة {allowedPercentage}% من التاركت الكلي الشهري (التاركت الشهري × {allowedPercentage}%).
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">الوزن الراجع لحد الآن:</strong> محسوب ومأخوذ تلقائياً من جدول ملخص المرتجعات الشهري أعلاه.
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-slate-200">سطر الغرامات:</strong> عندما يزيد الراجع بمقدار {penaltyWeightStep} كيلو فوق التاركت المسموح تضاف غرامة {penaltyAmountStep} آلاف د.ع، وعندما يزيد {penaltyWeightStep * 2} كيلو تضاف {penaltyAmountStep} آلاف أخرى فوق القديمة (تصبح {penaltyAmountStep * 2} ألف د.ع)، وتزداد {penaltyAmountStep} آلاف مع كل {penaltyWeightStep} كيلو إضافية.
                </li>
              </ul>
            </div>
          )}
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

      {/* MODAL: Edit Delegate Daily Target (Admin Only) */}
      {isAdmin && editingDailyTargetDelegate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`p-6 rounded-3xl shadow-2xl w-full max-w-md border space-y-4 ${
            isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-black text-base flex items-center gap-2">
                <Pencil className="w-5 h-5 text-amber-500" />
                <span>تحديد التاركت اليومي الثابت للمندوب</span>
              </h3>
              <button
                onClick={() => setEditingDailyTargetDelegate(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-bold">
              <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 space-y-1.5 border border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">اسم المندوب:</span>
                  <span className="font-black text-slate-900 dark:text-white text-sm">{editingDailyTargetDelegate.delegateName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">أيام العمل في الشهر:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">{workingDays} يوم</span>
                </div>
              </div>

              <div>
                <label className="text-slate-500 dark:text-slate-400 mb-1.5 block">
                  التاركت اليومي (كغم) - يدخله الأدمن ويبقى ثابتاً:
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  autoFocus
                  value={editingDailyTargetDelegate.dailyTarget || ''}
                  onChange={(e) =>
                    setEditingDailyTargetDelegate({
                      ...editingDailyTargetDelegate,
                      dailyTarget: parseFloat(e.target.value) || 0,
                    })
                  }
                  placeholder="0.0"
                  className={`w-full p-2.5 rounded-xl border font-mono outline-none text-base font-black ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
                <div className="mt-2 p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                  <p>
                    • التاركت الكلي الشهري ({workingDays} يوم): <strong className="font-mono font-black">{formatWithCommas(Math.round(((editingDailyTargetDelegate.dailyTarget || 0) * workingDays) ))} كغم</strong>
                  </p>
                  <p>
                    • الراجع المسموح ({allowedPercentage}%): <strong className="font-mono font-black">{formatWithCommas(Number((((editingDailyTargetDelegate.dailyTarget || 0) * workingDays) * (allowedPercentage / 100)).toFixed(0)))} كغم</strong>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingDailyTargetDelegate(null)}
                  className={`flex-1 py-2.5 rounded-xl font-bold border transition-colors ${
                    isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  إلغاء
                </button>
                <button
                  onClick={() =>
                    handleSaveDailyTarget(editingDailyTargetDelegate.delegateName, editingDailyTargetDelegate.dailyTarget)
                  }
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>حفظ وتثبيت التاركت</span>
                </button>
              </div>

              {dailyTargets[editingDailyTargetDelegate.delegateName] !== undefined && (
                <button
                  onClick={() => handleResetDelegateDailyTarget(editingDailyTargetDelegate.delegateName)}
                  className="w-full py-2 text-xs font-bold text-slate-500 hover:text-rose-600 dark:text-slate-400 hover:underline flex items-center justify-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>إلغاء التثبيت واستعادة التلقائي</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
