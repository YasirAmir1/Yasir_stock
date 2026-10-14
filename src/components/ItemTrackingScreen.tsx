import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { formatWithCommas } from '../utils/numberUtils';
import { showAlert } from '../utils/dialogService';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas-pro';
import {
  Layers,
  Calendar,
  Download,
  Image,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  TrendingUp,
  Award,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Package,
  FileSpreadsheet,
  Flame,
  ShieldAlert,
  BarChart3,
  CalendarRange,
  Users
} from 'lucide-react';

interface MonthlyItemTarget {
  id?: string;
  categoryName: string;
  delegateName: string;
  monthlyTarget: number;
  monthlySales: number;
  updatedAt?: string;
  updatedBy?: string;
}

// Arabic normalization helper
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

const isDelMatch = (nameA?: string, nameB?: string): boolean => {
  if (!nameA || !nameB) return false;
  const a = nameA.trim().toLowerCase();
  const b = nameB.trim().toLowerCase();
  if (a === b) return true;
  return normalizeArabic(a) === normalizeArabic(b);
};

export const ItemTrackingScreen: React.FC = () => {
  const {
    currentUser,
    salesEntries = [],
    rawSavedEntries = [],
    delegatesList = [],
    delegateTargets = [],
    productsList = [],
    isDarkMode,
    syncData,
    addToast
  } = useSales();

  // Role Access Control: Strictly Admin and Data Entry
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
    currentUser?.role === 'admin' ||
    currentUser?.roleName?.includes('أدمن') ||
    currentUser?.roleName?.includes('ادمن') ||
    currentUser?.name === 'الأدمن' ||
    currentUser?.username?.toLowerCase() === 'yasir' ||
    isDataEntry
  );

  // Active Section: 'all' (Both sections) | 'daily' (Section A) | 'monthly' (Section B)
  const [activeSection, setActiveSection] = useState<'all' | 'daily' | 'monthly'>('all');

  // Selected date for Daily tracking (defaults to today in Baghdad timezone)
  const todayStr = useMemo(() => {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }, []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Search filter
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Expanded row for product drilldown
  const [expandedDelegate, setExpandedDelegate] = useState<string | null>(null);

  // Downloading states
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isCapturingImage, setIsCapturingImage] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Remaining working days edit state
  const [isEditingDays, setIsEditingDays] = useState(false);
  const [editDaysInput, setEditDaysInput] = useState<string>('20');
  const [isSavingDays, setIsSavingDays] = useState(false);

  // Printable container ref
  const printContainerRef = useRef<HTMLDivElement>(null);
  const tikritSectionRef = useRef<HTMLDivElement>(null);
  const sectionARef = useRef<HTMLDivElement>(null);
  const sectionBRef = useRef<HTMLDivElement>(null);
  const [isCapturingTikritImage, setIsCapturingTikritImage] = useState(false);
  const [isCapturingSectionAImage, setIsCapturingSectionAImage] = useState(false);
  const [isCapturingSectionBImage, setIsCapturingSectionBImage] = useState(false);

  const handleDownloadSectionBImage = async () => {
    if (!sectionBRef.current) return;
    try {
      setIsCapturingSectionBImage(true);
      const canvas = await html2canvas(sectionBRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        logging: false
      });
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `متابعة_الصلصات_الشهرية_${selectedDate}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addToast({
        title: 'تم حفظ صورة التقرير الشهري',
        message: 'تم حفظ صورة تقرير متابعة الصلصات الشهرية كصورة عالية الدقة بنجاح 🖼️',
        type: 'success'
      });
    } catch (err) {
      console.error('Error generating Section B image:', err);
      showAlert('حدث خطأ أثناء حفظ صورة التقرير الشهري.', 'خطأ', 'danger');
    } finally {
      setIsCapturingSectionBImage(false);
    }
  };

  const handleDownloadSectionAImage = async () => {
    if (!sectionARef.current) return;
    try {
      setIsCapturingSectionAImage(true);
      const canvas = await html2canvas(sectionARef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        logging: false
      });
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `متابعة_الصلصات_اليومية_${selectedDate}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addToast({
        title: 'تم حفظ صورة التقرير اليومي',
        message: 'تم حفظ صورة تقرير متابعة الصلصات اليومية كصورة عالية الدقة بنجاح 🖼️',
        type: 'success'
      });
    } catch (err) {
      console.error('Error generating Section A image:', err);
      showAlert('حدث خطأ أثناء حفظ صورة التقرير اليومي.', 'خطأ', 'danger');
    } finally {
      setIsCapturingSectionAImage(false);
    }
  };

  const handleDownloadTikritImage = async () => {
    if (!tikritSectionRef.current) return;
    try {
      setIsCapturingTikritImage(true);
      const canvas = await html2canvas(tikritSectionRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        logging: false
      });
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `قسم_التحقيق_فرع_تكريت_${selectedDate}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addToast({
        title: 'تم حفظ صورة التحقيق',
        message: 'تم حفظ صورة قسم التحقيق (فرع تكريت) كصورة عالية الدقة بنجاح 🖼️',
        type: 'success'
      });
    } catch (err) {
      console.error('Error generating Tikrit image:', err);
      showAlert('حدث خطأ أثناء حفظ صورة قسم التحقيق.', 'خطأ', 'danger');
    } finally {
      setIsCapturingTikritImage(false);
    }
  };

  // Firestore monthly item targets subscription
  const [monthlyItemTargets, setMonthlyItemTargets] = useState<MonthlyItemTarget[]>([]);
  const [remainingWorkingDays, setRemainingWorkingDays] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('remaining_working_days');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {}
    return 20;
  });

  const handleSaveWorkingDays = async () => {
    const val = parseInt(editDaysInput, 10);
    if (isNaN(val) || val < 1) {
      showAlert('يرجى إدخال عدد أيام عمل متبقية صحيح (أكبر من صفر)', 'تنبيه', 'warning');
      return;
    }
    setIsSavingDays(true);
    try {
      await setDoc(doc(db, 'app_settings', 'working_days_config'), { days: val }, { merge: true });
      setRemainingWorkingDays(val);
      localStorage.setItem('remaining_working_days', String(val));
      setIsEditingDays(false);
      addToast({
        title: 'تم الحفظ',
        message: `تم تحديث أيام العمل المتبقية إلى (${val}) يوم بنجاح ✅`,
        type: 'success'
      });
    } catch (err) {
      console.error('Error saving working days:', err);
      showAlert('حدث خطأ أثناء حفظ أيام العمل.', 'خطأ', 'danger');
    } finally {
      setIsSavingDays(false);
    }
  };

  // Load monthly_item_targets and working_days_config from Firestore
  useEffect(() => {
    const unsubTargets = onSnapshot(
      collection(db, 'monthly_item_targets'),
      (snapshot) => {
        const list: MonthlyItemTarget[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as MonthlyItemTarget;
          if (data) {
            list.push({ ...data, id: docSnap.id });
          }
        });
        setMonthlyItemTargets(list);
      },
      (err) => console.error('Error fetching monthly_item_targets:', err)
    );

    const unsubDays = onSnapshot(
      doc(db, 'app_settings', 'working_days_config'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data?.days !== undefined && typeof data.days === 'number') {
            setRemainingWorkingDays(data.days);
          }
        }
      },
      (err) => console.error('Error fetching working_days_config:', err)
    );

    return () => {
      unsubTargets();
      unsubDays();
    };
  }, []);

  // Filter delegates excluding 'الكل' and 'الأدمن' and generic hidden delegates
  const validDelegates = useMemo(() => {
    return delegatesList.filter(
      (d) => d && d !== 'الكل' && d !== 'الأدمن' && d !== 'مندوب عام 1' && d !== 'مندوب عام 2'
    );
  }, [delegatesList]);

  // Combined all sales source entries (excluding hidden delegates)
  const allSales = useMemo(() => {
    const list = rawSavedEntries.length > 0 ? rawSavedEntries : salesEntries;
    return list.filter(
      (e) => e.delegateName !== 'مندوب عام 1' && e.delegateName !== 'مندوب عام 2'
    );
  }, [rawSavedEntries, salesEntries]);

  // Category identification (Sauces / صلصات)
  const isSauceCategory = (catName?: string) => {
    if (!catName) return false;
    const norm = normalizeArabic(catName);
    return norm === normalizeArabic('صلصات') || norm.includes('صلص');
  };

  // ----------------------------------------------------
  // SECTION A: DAILY TRACKING FOR SAUCES (صلصات)
  // ----------------------------------------------------
  const dailySauceData = useMemo(() => {
    // 1. Sales for selected date in 'صلصات'
    const dateSales = allSales.filter(
      (e) => e.dateString === selectedDate && isSauceCategory(e.categoryName)
    );

    // 2. Breakdown per delegate
    const list = validDelegates.map((del) => {
      // Find daily target for this delegate in category 'صلصات'
      const targetObj = delegateTargets.find(
        (t) => isDelMatch(t.delegateName, del) && isSauceCategory(t.categoryName)
      );
      const dailyTargetKg = targetObj ? Number(targetObj.dailyTargetWeightKg) || 0 : 0;

      // Delegate sales on selected date
      const delSales = dateSales.filter((e) => isDelMatch(e.delegateName, del));
      const dailySalesKg = delSales.reduce((sum, e) => sum + (Number(e.totalWeightKg) || 0), 0);
      const totalPieces = delSales.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
      const totalInvoices = new Set(delSales.map((e) => e.customerCode || e.customerName || e.invoiceId || e.id)).size;

      // Breakdown of distinct products sold
      const productBreakdown: Record<string, { quantity: number; weightKg: number }> = {};
      delSales.forEach((e) => {
        const pName = e.productName || 'غير محدد';
        if (!productBreakdown[pName]) {
          productBreakdown[pName] = { quantity: 0, weightKg: 0 };
        }
        productBreakdown[pName].quantity += Number(e.quantity) || 0;
        productBreakdown[pName].weightKg += Number(e.totalWeightKg) || 0;
      });

      const percentage = dailyTargetKg > 0 ? (dailySalesKg / dailyTargetKg) * 100 : 0;
      const isAchieved = percentage >= 100;
      const remainingKg = dailyTargetKg > dailySalesKg ? dailyTargetKg - dailySalesKg : 0;

      return {
        delegateName: del,
        dailyTargetKg,
        dailySalesKg,
        totalPieces,
        totalInvoices,
        percentage,
        isAchieved,
        remainingKg,
        productBreakdown: Object.entries(productBreakdown).map(([name, data]) => ({
          productName: name,
          ...data
        }))
      };
    });

    // Filter by search term if provided
    const filtered = list.filter((item) => {
      if (!searchTerm) return true;
      return normalizeArabic(item.delegateName).includes(normalizeArabic(searchTerm));
    });

    // Totals across all delegates
    const totalDailyTarget = list.reduce((sum, i) => sum + i.dailyTargetKg, 0);
    const totalDailySales = list.reduce((sum, i) => sum + i.dailySalesKg, 0);
    const totalDailyPieces = list.reduce((sum, i) => sum + i.totalPieces, 0);
    const totalDailyInvoices = dateSales.length > 0 ? new Set(dateSales.map((e) => e.customerCode || e.customerName || e.invoiceId || e.id)).size : 0;
    const overallDailyPct = totalDailyTarget > 0 ? (totalDailySales / totalDailyTarget) * 100 : 0;
    const totalDailyRemaining = totalDailyTarget > totalDailySales ? totalDailyTarget - totalDailySales : 0;
    const achievedCount = list.filter((i) => i.isAchieved && i.dailyTargetKg > 0).length;

    return {
      delegates: filtered,
      allDelegates: list,
      totals: {
        totalDailyTarget,
        totalDailySales,
        totalDailyPieces,
        totalDailyInvoices,
        overallDailyPct,
        totalDailyRemaining,
        achievedCount
      }
    };
  }, [allSales, selectedDate, validDelegates, delegateTargets, searchTerm]);

  // ----------------------------------------------------
  // SECTION B: MONTHLY TRACKING FOR SAUCES (صلصات)
  // ----------------------------------------------------
  const monthlySauceData = useMemo(() => {
    const currentMonthPrefix = selectedDate ? selectedDate.substring(0, 7) : new Date().toISOString().substring(0, 7);

    // Filter monthlyItemTargets matching 'صلصات'
    const sauceMonthlyTargets = monthlyItemTargets.filter((t) => isSauceCategory(t.categoryName));

    // Also get all sales in current month for 'صلصات'
    const monthSales = allSales.filter(
      (e) => (e.dateString || '').startsWith(currentMonthPrefix) && isSauceCategory(e.categoryName)
    );

    const list = validDelegates.map((del) => {
      // Find monthly target record from Firestore monthly_item_targets
      const match = sauceMonthlyTargets.find((t) => isDelMatch(t.delegateName, del));

      // Find daily target in case monthly record wasn't uploaded yet
      const targetObj = delegateTargets.find(
        (t) => isDelMatch(t.delegateName, del) && isSauceCategory(t.categoryName)
      );
      const dailyTargetKg = targetObj ? Number(targetObj.dailyTargetWeightKg) || 0 : 0;
      const derivedMonthlyTarget = dailyTargetKg > 0 ? dailyTargetKg * 26 : 0;

      // Monthly target: from upload or derived
      const monthlyTargetKg = (match && Number(match.monthlyTarget) > 0)
        ? Number(match.monthlyTarget)
        : derivedMonthlyTarget;

      // Monthly sales: prioritize record from Excel/Firestore, fallback to app sales entries
      let monthlySalesKg = 0;
      if (match && match.monthlySales !== undefined && match.monthlySales > 0) {
        monthlySalesKg = Number(match.monthlySales);
      } else {
        const delMonthSales = monthSales.filter((e) => isDelMatch(e.delegateName, del));
        monthlySalesKg = delMonthSales.reduce((sum, e) => sum + (Number(e.totalWeightKg) || 0), 0);
      }

      const percentage = monthlyTargetKg > 0 ? (monthlySalesKg / monthlyTargetKg) * 100 : 0;
      const isAchieved = percentage >= 100;
      const remainingKg = monthlyTargetKg > monthlySalesKg ? monthlyTargetKg - monthlySalesKg : 0;

      // Required daily target to hit monthly goal
      const days = Math.max(1, remainingWorkingDays);
      const dailyRequiredKg = remainingKg > 0 ? remainingKg / days : 0;

      return {
        delegateName: del,
        monthlyTargetKg,
        monthlySalesKg,
        percentage,
        isAchieved,
        remainingKg,
        dailyRequiredKg,
        hasRecord: !!match
      };
    });

    // Sum up across ALL representatives combined
    const totalMonthlyTarget = list.reduce((sum, i) => sum + i.monthlyTargetKg, 0);
    const totalMonthlySales = list.reduce((sum, i) => sum + i.monthlySalesKg, 0);
    const overallMonthlyPct = totalMonthlyTarget > 0 ? (totalMonthlySales / totalMonthlyTarget) * 100 : 0;
    const totalMonthlyRemaining = totalMonthlyTarget > totalMonthlySales ? totalMonthlyTarget - totalMonthlySales : 0;
    const days = Math.max(1, remainingWorkingDays);
    const totalDailyRequired = totalMonthlyRemaining > 0 ? totalMonthlyRemaining / days : 0;
    const monthlyAchievedCount = list.filter((i) => i.isAchieved && i.monthlyTargetKg > 0).length;

    // Filter by search term if provided
    const filtered = list.filter((item) => {
      if (!searchTerm) return true;
      return normalizeArabic(item.delegateName).includes(normalizeArabic(searchTerm));
    });

    return {
      delegates: filtered,
      allDelegates: list,
      totals: {
        totalMonthlyTarget,
        totalMonthlySales,
        overallMonthlyPct,
        totalMonthlyRemaining,
        totalDailyRequired,
        monthlyAchievedCount,
        remainingWorkingDays: days,
        currentMonthPrefix
      }
    };
  }, [monthlyItemTargets, allSales, selectedDate, validDelegates, remainingWorkingDays, delegateTargets, searchTerm]);

  // Refresh data handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await syncData();
      addToast({
        title: 'تم التحديث',
        message: 'تمت مزامنة أحدث بيانات مبيعات وأهداف الصلصات بنجاح ✅',
        type: 'success'
      });
    } catch {
      showAlert('حدث خطأ أثناء تحديث البيانات.', 'خطأ', 'danger');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    try {
      setIsExportingExcel(true);
      const wb = XLSX.utils.book_new();

      // Sheet 1: Daily Sauces Tracking
      const dailyRows = dailySauceData.allDelegates.map((item, idx) => ({
        'ت': idx + 1,
        'اسم المندوب': item.delegateName,
        'التاريخ': selectedDate,
        'الهدف اليومي (كغم)': parseFloat(item.dailyTargetKg.toFixed(1)),
        'المبيعات اليومية (كغم)': parseFloat(item.dailySalesKg.toFixed(1)),
        'القطع المباعة': item.totalPieces,
        'عدد الفواتير': item.totalInvoices,
        'نسبة الإنجاز اليومية (%)': `${item.percentage.toFixed(1)}%`,
        'المتبقي (كغم)': parseFloat(item.remainingKg.toFixed(1)),
        'الحالة': item.isAchieved ? 'محقق' : 'قيد الإنجاز'
      }));
      // Add total row
      dailyRows.push({
        'ت': 'الإجمالي' as any,
        'اسم المندوب': 'إجمالي كافة المندوبين',
        'التاريخ': selectedDate,
        'الهدف اليومي (كغم)': parseFloat(dailySauceData.totals.totalDailyTarget.toFixed(1)),
        'المبيعات اليومية (كغم)': parseFloat(dailySauceData.totals.totalDailySales.toFixed(1)),
        'القطع المباعة': dailySauceData.totals.totalDailyPieces,
        'عدد الفواتير': dailySauceData.totals.totalDailyInvoices,
        'نسبة الإنجاز اليومية (%)': `${dailySauceData.totals.overallDailyPct.toFixed(1)}%`,
        'المتبقي (كغم)': parseFloat(dailySauceData.totals.totalDailyRemaining.toFixed(1)),
        'الحالة': dailySauceData.totals.overallDailyPct >= 100 ? 'محقق بالكامل' : 'قيد الإنجاز'
      });
      const wsDaily = XLSX.utils.json_to_sheet(dailyRows);
      XLSX.utils.book_append_sheet(wb, wsDaily, 'متابعة_الصلصات_اليومية');

      // Sheet 2: Monthly Sauces Tracking
      const monthlyRows = monthlySauceData.allDelegates.map((item, idx) => ({
        'ت': idx + 1,
        'اسم المندوب': item.delegateName,
        'الشهر': monthlySauceData.totals.currentMonthPrefix,
        'الهدف الشهري (كغم)': parseFloat(item.monthlyTargetKg.toFixed(1)),
        'المبيعات الشهرية لحد الآن (كغم)': parseFloat(item.monthlySalesKg.toFixed(1)),
        'نسبة الإنجاز الشهري (%)': `${item.percentage.toFixed(1)}%`,
        'المتبقي لنهاية الشهر (كغم)': parseFloat(item.remainingKg.toFixed(1)),
        'المطلوب يومياً لنهاية الشهر (كغم)': parseFloat(item.dailyRequiredKg.toFixed(1)),
        'الحالة': item.isAchieved ? 'محقق' : 'قيد الإنجاز'
      }));
      // Add monthly total row
      monthlyRows.push({
        'ت': 'الإجمالي' as any,
        'اسم المندوب': 'الإجمالي العام لكافة المندوبين',
        'الشهر': monthlySauceData.totals.currentMonthPrefix,
        'الهدف الشهري (كغم)': parseFloat(monthlySauceData.totals.totalMonthlyTarget.toFixed(1)),
        'المبيعات الشهرية لحد الآن (كغم)': parseFloat(monthlySauceData.totals.totalMonthlySales.toFixed(1)),
        'نسبة الإنجاز الشهري (%)': `${monthlySauceData.totals.overallMonthlyPct.toFixed(1)}%`,
        'المتبقي لنهاية الشهر (كغم)': parseFloat(monthlySauceData.totals.totalMonthlyRemaining.toFixed(1)),
        'المطلوب يومياً لنهاية الشهر (كغم)': parseFloat(monthlySauceData.totals.totalDailyRequired.toFixed(1)),
        'الحالة': monthlySauceData.totals.overallMonthlyPct >= 100 ? 'محقق بالكامل' : 'قيد الإنجاز'
      });
      const wsMonthly = XLSX.utils.json_to_sheet(monthlyRows);
      XLSX.utils.book_append_sheet(wb, wsMonthly, 'متابعة_الصلصات_الشهرية');

      XLSX.writeFile(wb, `تقرير_متابعة_الصلصات_${selectedDate}.xlsx`);
      addToast({
        title: 'تم التصدير',
        message: 'تم تصدير ملف إكسل لمتابعة الصلصات (اليومي والشهري) بنجاح 📊',
        type: 'success'
      });
    } catch (err) {
      console.error('Error exporting to Excel:', err);
      showAlert('حدث خطأ أثناء تصدير ملف الإكسل.', 'خطأ', 'danger');
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Download Report as High-Resolution Image
  const handleDownloadImage = async () => {
    if (!printContainerRef.current) return;
    try {
      setIsCapturingImage(true);
      const canvas = await html2canvas(printContainerRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        logging: false
      });
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `تقرير_متابعة_الصلصات_${selectedDate}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addToast({
        title: 'تم الحفظ كصورة',
        message: 'تم حفظ تقرير متابعة الأصناف كصورة عالية الدقة بنجاح 🖼️',
        type: 'success'
      });
    } catch (err) {
      console.error('Error generating image:', err);
      showAlert('حدث خطأ أثناء إنشاء الصورة.', 'خطأ', 'danger');
    } finally {
      setIsCapturingImage(false);
    }
  };

  // Restrict Access: Only Admin and Data Entry
  if (!isAdminOrDataEntry) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 bg-slate-900 border-2 border-red-500/60 rounded-2xl text-center space-y-4 text-white shadow-2xl">
        <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center text-red-400">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-red-400">صلاحية الوصول غير متوفرة</h2>
        <p className="text-sm font-bold text-slate-300 leading-relaxed">
          عذراً، صفحة <span className="text-amber-400 font-black">متابعة الأصناف (الصلصات)</span> مخصصة حصراً لمدير النظام (Admin) ومدخل البيانات (Data Entry).
        </p>
      </div>
    );
  }

  return (
    <div className={`max-w-6xl mx-auto px-2 sm:px-4 py-4 space-y-4 dir-rtl ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
      
      {/* Top Header Card */}
      <div className={`p-4 sm:p-5 rounded-2xl border shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
        isDarkMode
          ? 'bg-slate-900/95 border-amber-500/30 shadow-amber-950/20'
          : 'bg-gradient-to-r from-amber-50 via-white to-amber-50/70 border-amber-300 shadow-amber-500/10'
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-slate-950 shadow-md shrink-0">
            <Flame className="w-7 h-7 fill-slate-950 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                متابعة الأصناف — صنف الصلصات
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-black bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40">
                إدارة ومدخل بيانات 🔒
              </span>
            </div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">
              لوحة متقدمة لمتابعة أهداف ومبيعات مادة الصلصات يومياً وشهرياً لجميع المندوبين
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow transition-all disabled:opacity-50 cursor-pointer"
            title="تحديث البيانات فورياً"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={isExportingExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-black rounded-xl shadow transition-all disabled:opacity-50 cursor-pointer"
            title="تصدير تقرير الصلصات كملف إكسل"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isExportingExcel ? 'جاري التصدير...' : 'تصدير إكسل'}</span>
          </button>

          {!isCapturingImage && (
            <button
              type="button"
              onClick={handleDownloadImage}
              disabled={isCapturingImage}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-black rounded-xl shadow transition-all disabled:opacity-50 cursor-pointer"
              title="تحميل التقرير كصورة عالية الدقة"
            >
              <Image className="w-4 h-4" />
              <span>{isCapturingImage ? 'جاري الحفظ...' : 'حفظ كصورة'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Filter & Search Bar */}
      <div className={`p-3 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        {/* Section View Switcher */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveSection('all')}
            className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
              activeSection === 'all'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            عرض الكل (يومي + شهري)
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('daily')}
            className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
              activeSection === 'daily'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            المتابعة اليومية (Section A)
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('monthly')}
            className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
              activeSection === 'monthly'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            المتابعة الشهرية (Section B)
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث باسم المندوب..."
            className={`w-full pr-9 pl-3 py-1.5 text-xs font-bold rounded-xl border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
        </div>
      </div>

      {/* Main Printable Content Area */}
      <div ref={printContainerRef} className="space-y-6">

        {/* ==================================================== */}
        {/* SECTION A: DAILY TRACKING FOR SAUCES (صلصات)         */}
        {/* ==================================================== */}
        {(activeSection === 'all' || activeSection === 'daily') && (
          <div 
            ref={sectionARef}
            className={`rounded-2xl border shadow-xl overflow-hidden transition-all ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            {/* Section A Header */}
            <div className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isDarkMode ? 'bg-slate-950/90 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 border border-amber-500/30">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-black">
                      فقرة (A): متابعة الصلصات اليومية (لكل مندوب على حدة)
                    </h2>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-500/30">
                      تقرير يومي منفصل
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                    يعرض الهدف اليومي والمبيعات اليومية المحققة مفصلة لكل مندوب بشكل مستقل
                  </p>
                </div>
              </div>

              {/* Controls (Date + Download Image) */}
              <div className="flex items-center gap-2 flex-wrap">
                {!isCapturingSectionAImage && (
                  <button
                    type="button"
                    onClick={handleDownloadSectionAImage}
                    disabled={isCapturingSectionAImage}
                    className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-black rounded-xl shadow transition-all disabled:opacity-50 cursor-pointer"
                    title="تحميل التقرير اليومي كصورة عالية الدقة"
                  >
                    <Image className="w-4 h-4" />
                    <span>{isCapturingSectionAImage ? 'جاري الحفظ...' : 'تحميل صورة التقرير 🖼️'}</span>
                  </button>
                )}

                <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 shadow-xs">
                  <Calendar className="w-4 h-4 text-amber-500" />
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">التاريخ:</label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="bg-transparent text-xs font-black text-slate-900 dark:text-white focus:outline-none"
                  />
                  {selectedDate !== todayStr && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(todayStr)}
                      className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer"
                    >
                      اليوم
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Section A: Daily KPI Cards */}
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 border-b border-slate-200 dark:border-slate-800">
              <div className={`p-3 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">إجمالي هدف الصلصات اليوم</div>
                <div className="text-lg sm:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                  {formatWithCommas(parseFloat(dailySauceData.totals.totalDailyTarget.toFixed(1)), true)} كجم
                </div>
              </div>

              <div className={`p-3 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">مبيعات الصلصات المحققة اليوم</div>
                <div className="text-lg sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatWithCommas(parseFloat(dailySauceData.totals.totalDailySales.toFixed(1)), true)} كجم
                </div>
              </div>

              <div className={`p-3 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">نسبة الإنجاز اليومية</div>
                <div className={`text-lg sm:text-2xl font-black mt-1 ${
                  dailySauceData.totals.overallDailyPct >= 100
                    ? 'text-emerald-500'
                    : dailySauceData.totals.overallDailyPct >= 70
                    ? 'text-blue-500'
                    : 'text-rose-500'
                }`}>
                  {dailySauceData.totals.overallDailyPct.toFixed(1)}%
                </div>
              </div>

              <div className={`p-3 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">المندوبين المحققين للهدف</div>
                <div className="text-lg sm:text-2xl font-black text-indigo-500 mt-1">
                  {dailySauceData.totals.achievedCount} من {dailySauceData.allDelegates.length}
                </div>
              </div>
            </div>

            {/* Section A: Daily Table */}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className={`border-b font-black ${
                    isDarkMode ? 'bg-slate-950/80 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-700 border-slate-300'
                  }`}>
                    <th className="py-3 px-3 text-center w-12">#</th>
                    <th className="py-3 px-3">اسم المندوب</th>
                    <th className="py-3 px-3 text-center">المبيعات اليومية (كجم)</th>
                    <th className="py-3 px-3 text-center">القطع المباعة</th>
                    <th className="py-3 px-3 text-center">المتبقي (كجم)</th>
                    <th className="py-3 px-3 text-center w-36">نسبة الإنجاز %</th>
                    <th className="py-3 px-3 text-center">الحالة</th>
                    <th className="py-3 px-3 text-center">تفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-semibold">
                  {dailySauceData.delegates.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400 font-bold">
                        لا توجد بيانات مطابقة للبحث أو المبيعات لهذا اليوم.
                      </td>
                    </tr>
                  ) : (
                    dailySauceData.delegates.map((item, idx) => {
                      const isExpanded = expandedDelegate === item.delegateName;
                      return (
                        <React.Fragment key={item.delegateName}>
                          <tr className={`transition-colors ${
                            item.isAchieved && item.dailyTargetKg > 0
                              ? isDarkMode ? 'bg-emerald-950/20 hover:bg-emerald-950/30' : 'bg-emerald-50/50 hover:bg-emerald-50'
                              : isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                          }`}>
                            <td className="py-3 px-3 text-center font-bold text-slate-400">{idx + 1}</td>
                            <td className="py-3 px-3 font-black text-slate-900 dark:text-white">
                              <div className="flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span>{item.delegateName}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center font-black text-emerald-600 dark:text-emerald-400">
                              {formatWithCommas(parseFloat(item.dailySalesKg.toFixed(1)), true)}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-slate-600 dark:text-slate-400">
                              {formatWithCommas(item.totalPieces)}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-slate-500">
                              {formatWithCommas(parseFloat(item.remainingKg.toFixed(1)), true)}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px] font-black">
                                  <span>{item.percentage.toFixed(1)}%</span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-2 rounded-full transition-all duration-300 ${
                                      item.percentage >= 100
                                        ? 'bg-emerald-500'
                                        : item.percentage >= 70
                                        ? 'bg-blue-500'
                                        : 'bg-amber-500'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
                                  ></div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center">
                              {item.isAchieved && item.dailyTargetKg > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                  <CheckCircle2 className="w-3 h-3" /> محقق 🏆
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                                  <Clock className="w-3 h-3" /> قيد الإنجاز
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {item.productBreakdown.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setExpandedDelegate(isExpanded ? null : item.delegateName)}
                                  className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                                  title="عرض تفاصيل مواد الصلصات المباعة"
                                >
                                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400">---</span>
                              )}
                            </td>
                          </tr>

                          {/* Expanded Product Breakdown Subrow */}
                          {isExpanded && item.productBreakdown.length > 0 && (
                            <tr className={isDarkMode ? 'bg-slate-950/60' : 'bg-slate-50/80'}>
                              <td colSpan={8} className="p-3">
                                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
                                  <div className="flex items-center justify-between text-xs font-black text-amber-600 dark:text-amber-400">
                                    <span className="flex items-center gap-1.5">
                                      <Package className="w-4 h-4" />
                                      تفاصيل مبيعات الصلصات للمندوب ({item.delegateName}) في تاريخ {selectedDate}:
                                    </span>
                                    <span>{item.productBreakdown.length} أصناف مباعة</span>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                    {item.productBreakdown.map((p) => (
                                      <div
                                        key={p.productName}
                                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs"
                                      >
                                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[140px]" title={p.productName}>
                                          {p.productName}
                                        </span>
                                        <div className="flex items-center gap-2 text-[11px] font-black shrink-0">
                                          <span className="text-slate-500 dark:text-slate-400">{formatWithCommas(p.quantity)} ق</span>
                                          <span className="text-emerald-600 dark:text-emerald-400">{formatWithCommas(parseFloat(p.weightKg.toFixed(1)), true)} كجم</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>

                {/* Section A: Daily Totals Footer Row */}
                <tfoot>
                  <tr className={`border-t-2 font-black ${
                    isDarkMode ? 'bg-slate-950 text-white border-amber-500/60' : 'bg-amber-100/70 text-slate-950 border-amber-400'
                  }`}>
                    <td colSpan={2} className="py-3 px-3 text-right">
                      المجموع اليومي الكلي لكافة المندوبين:
                    </td>
                    <td className="py-3 px-3 text-center text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatWithCommas(parseFloat(dailySauceData.totals.totalDailySales.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-3 text-center text-slate-600 dark:text-slate-300">
                      {formatWithCommas(dailySauceData.totals.totalDailyPieces)}
                    </td>
                    <td className="py-3 px-3 text-center text-slate-600 dark:text-slate-300">
                      {formatWithCommas(parseFloat(dailySauceData.totals.totalDailyRemaining.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-3 text-center text-sm font-black">
                      {dailySauceData.totals.overallDailyPct.toFixed(1)}%
                    </td>
                    <td colSpan={2} className="py-3 px-3 text-center">
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-500 text-slate-950 shadow-xs">
                        {dailySauceData.totals.achievedCount} من {dailySauceData.allDelegates.length} محققين
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* SECTION B: MONTHLY TRACKING FOR SAUCES (صلصات)       */}
        {/* ==================================================== */}
        {(activeSection === 'all' || activeSection === 'monthly') && (
          <div 
            ref={sectionBRef}
            className={`rounded-2xl border shadow-xl overflow-hidden transition-all ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            {/* Section B Header */}
            <div className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isDarkMode ? 'bg-slate-950/90 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-500 border border-indigo-500/30">
                  <CalendarRange className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-black">
                      فقرة (B): متابعة الصلصات الشهرية (الإجمالي التراكمي لكافة المندوبين)
                    </h2>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                      تجميع شامل للشهر
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                    يجمع ويراكم إجمالي التاركت الشهري وإجمالي المبيعات الشهرية عبر كافة المندوبين مجتمعين للشهر بأكمله
                  </p>
                </div>
              </div>

              {/* Controls (Download Image + Working Days Left Badge) */}
              <div className="flex items-center gap-2 flex-wrap">
                {!isCapturingSectionBImage && (
                  <button
                    type="button"
                    onClick={handleDownloadSectionBImage}
                    disabled={isCapturingSectionBImage}
                    className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-black rounded-xl shadow transition-all disabled:opacity-50 cursor-pointer"
                    title="تحميل التقرير الشهري كصورة عالية الدقة"
                  >
                    <Image className="w-4 h-4" />
                    <span>{isCapturingSectionBImage ? 'جاري الحفظ...' : 'تحميل صورة التقرير 🖼️'}</span>
                  </button>
                )}

                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-xs font-bold self-start sm:self-auto">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>أيام العمل المتبقية:</span>
                  <span className="font-black text-sm">{remainingWorkingDays} يوم</span>
                </div>
              </div>
            </div>

            {/* Section B: Monthly KPI Cards (Total Combined Metrics) */}
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 border-b border-slate-200 dark:border-slate-800">
              <div className={`p-3.5 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">إجمالي التاركت الشهري للصلصات</div>
                <div className="text-lg sm:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                  {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlyTarget.toFixed(1)), true)} كجم
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">لكافة المندوبين مجتمعين</div>
              </div>

              <div className={`p-3.5 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">إجمالي المبيعات الشهرية لحد الآن</div>
                <div className="text-lg sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlySales.toFixed(1)), true)} كجم
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">محقق تراكمي</div>
              </div>

              <div className={`p-3.5 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">نسبة الإنجاز الشهري الإجمالية</div>
                <div className={`text-lg sm:text-2xl font-black mt-1 ${
                  monthlySauceData.totals.overallMonthlyPct >= 100
                    ? 'text-emerald-500'
                    : monthlySauceData.totals.overallMonthlyPct >= 70
                    ? 'text-blue-500'
                    : 'text-rose-500'
                }`}>
                  {monthlySauceData.totals.overallMonthlyPct.toFixed(1)}%
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">معدل الإنجاز التراكمي</div>
              </div>

              <div className={`p-3.5 rounded-xl border text-center ${
                isDarkMode ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">المطلوب يومياً لنهاية الشهر</div>
                <div className="text-lg sm:text-2xl font-black text-indigo-500 mt-1">
                  {formatWithCommas(parseFloat(monthlySauceData.totals.totalDailyRequired.toFixed(1)), true)} كجم/يوم
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">المتبقي: {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlyRemaining.toFixed(1)), true)} كجم</div>
              </div>
            </div>

            {/* Section B: Monthly Combined Progress Bar */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-black">
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  مستوى الإنجاز التراكمي الشامل لصنف الصلصات للشهر الحالي ({monthlySauceData.totals.currentMonthPrefix})
                </span>
                <span className="text-sm text-emerald-600 dark:text-emerald-400 font-black">
                  {monthlySauceData.totals.overallMonthlyPct.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden p-0.5">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    monthlySauceData.totals.overallMonthlyPct >= 100
                      ? 'bg-gradient-to-r from-emerald-500 to-lime-400'
                      : monthlySauceData.totals.overallMonthlyPct >= 70
                      ? 'bg-gradient-to-r from-blue-500 to-emerald-400'
                      : 'bg-gradient-to-r from-rose-500 to-amber-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, monthlySauceData.totals.overallMonthlyPct))}%` }}
                ></div>
              </div>
            </div>

            {/* Section B: Monthly Table */}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className={`border-b font-black ${
                    isDarkMode ? 'bg-slate-950/80 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-700 border-slate-300'
                  }`}>
                    <th className="py-3 px-3 text-center w-12">#</th>
                    <th className="py-3 px-3">اسم المندوب</th>
                    <th className="py-3 px-3 text-center">التاركت الشهري (كجم)</th>
                    <th className="py-3 px-3 text-center">المبيعات الشهرية لحد الآن (كجم)</th>
                    <th className="py-3 px-3 text-center">المتبقي لنهاية الشهر (كجم)</th>
                    <th className="py-3 px-3 text-center">المطلوب يومياً (كجم/يوم)</th>
                    <th className="py-3 px-3 text-center w-36">نسبة الإنجاز %</th>
                    <th className="py-3 px-3 text-center">المساهمة %</th>
                    <th className="py-3 px-3 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-semibold">
                  {monthlySauceData.delegates.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 font-bold">
                        لا توجد بيانات مطابقة للبحث.
                      </td>
                    </tr>
                  ) : (
                    monthlySauceData.delegates.map((item, idx) => {
                      const contributionPct = monthlySauceData.totals.totalMonthlySales > 0
                        ? (item.monthlySalesKg / monthlySauceData.totals.totalMonthlySales) * 100
                        : 0;

                      return (
                        <tr
                          key={item.delegateName}
                          className={`transition-colors ${
                            item.isAchieved && item.monthlyTargetKg > 0
                              ? isDarkMode ? 'bg-emerald-950/20 hover:bg-emerald-950/30' : 'bg-emerald-50/50 hover:bg-emerald-50'
                              : isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-3 px-3 text-center font-bold text-slate-400">{idx + 1}</td>
                          <td className="py-3 px-3 font-black text-slate-900 dark:text-white">
                            <div className="flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span>{item.delegateName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-amber-700 dark:text-amber-400">
                            {formatWithCommas(parseFloat(item.monthlyTargetKg.toFixed(1)), true)}
                          </td>
                          <td className="py-3 px-3 text-center font-black text-emerald-600 dark:text-emerald-400">
                            {formatWithCommas(parseFloat(item.monthlySalesKg.toFixed(1)), true)}
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-slate-500">
                            {formatWithCommas(parseFloat(item.remainingKg.toFixed(1)), true)}
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-indigo-600 dark:text-indigo-400">
                            {formatWithCommas(parseFloat(item.dailyRequiredKg.toFixed(1)), true)}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] font-black">
                                <span>{item.percentage.toFixed(1)}%</span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`h-2 rounded-full transition-all duration-300 ${
                                    item.percentage >= 100
                                      ? 'bg-emerald-500'
                                      : item.percentage >= 70
                                      ? 'bg-blue-500'
                                      : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-slate-600 dark:text-slate-400">
                            {contributionPct.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 text-center">
                            {item.isAchieved && item.monthlyTargetKg > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                <Award className="w-3 h-3" /> محقق شهري 🏆
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                                <Clock className="w-3 h-3" /> قيد المتابعة
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Section B: Monthly Totals Footer Row */}
                <tfoot>
                  <tr className={`border-t-2 font-black ${
                    isDarkMode ? 'bg-slate-950 text-white border-indigo-500/60' : 'bg-indigo-100/70 text-slate-950 border-indigo-300'
                  }`}>
                    <td colSpan={2} className="py-3 px-3 text-right">
                      الإجمالي التراكمي الشامل لكافة المندوبين:
                    </td>
                    <td className="py-3 px-3 text-center text-amber-700 dark:text-amber-400 text-sm">
                      {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlyTarget.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-3 text-center text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlySales.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-3 text-center text-slate-600 dark:text-slate-300 text-sm">
                      {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlyRemaining.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-3 text-center text-indigo-600 dark:text-indigo-400 text-sm">
                      {formatWithCommas(parseFloat(monthlySauceData.totals.totalDailyRequired.toFixed(1)), true)} كجم/يوم
                    </td>
                    <td className="py-3 px-3 text-center text-sm font-black">
                      {monthlySauceData.totals.overallMonthlyPct.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-center font-bold">100%</td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-indigo-500 text-white shadow-xs">
                        {monthlySauceData.totals.monthlyAchievedCount} من {monthlySauceData.allDelegates.length} محققين
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* SECTION C: TIKRIT BRANCH ACHIEVEMENT SUMMARY (فرع تكريت) */}
        {/* ==================================================== */}
        <div 
          ref={tikritSectionRef}
          className={`rounded-2xl border shadow-xl overflow-hidden p-4 sm:p-5 space-y-4 ${
            isDarkMode ? 'bg-slate-900 border-amber-500/40' : 'bg-gradient-to-br from-amber-50 via-white to-orange-50 border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800 flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-slate-950 shadow-md">
                <Award className="w-6 h-6 text-slate-950" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  قسم التحقيق — فرع تكريت
                </h3>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  ملخص الأداء الكلي لفرع تكريت (التاركت والمبيعات الشهرية واليومية)
                </p>
              </div>
            </div>

            {!isCapturingTikritImage && (
              <button
                type="button"
                onClick={handleDownloadTikritImage}
                disabled={isCapturingTikritImage}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-black rounded-xl shadow transition-all disabled:opacity-50 cursor-pointer"
                title="تحميل قسم التحقيق كصورة عالية الدقة"
              >
                <Image className="w-4 h-4" />
                <span>تحميل صورة التقرير 🖼️</span>
              </button>
            )}
          </div>

          {/* Table 1: Monthly Tikrit Branch Achievement */}
          <div className="space-y-1.5">
            <div className="text-xs font-black text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <span>📌 1. جدول التحقيق الشهري (فرع تكريت):</span>
            </div>
            <div className="overflow-x-auto w-full rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className={`border-b font-black ${
                    isDarkMode ? 'bg-slate-950 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-700 border-slate-300'
                  }`}>
                    <th className="py-3 px-4 text-center">الفرع</th>
                    <th className="py-3 px-4 text-center">التاركت الشهري الإجمالي (كجم)</th>
                    <th className="py-3 px-4 text-center">المبيعات الشهرية الإجمالية (كجم)</th>
                    <th className="py-3 px-4 text-center">نسبة التحقيق الشهري (%)</th>
                    <th className="py-3 px-4 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-semibold">
                  <tr className={isDarkMode ? 'bg-slate-900/80' : 'bg-white'}>
                    <td className="py-3 px-4 text-center font-black text-slate-900 dark:text-white">
                      فرع تكريت
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-amber-700 dark:text-amber-400 text-sm">
                      {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlyTarget.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-4 text-center font-black text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatWithCommas(parseFloat(monthlySauceData.totals.totalMonthlySales.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-black ${
                        monthlySauceData.totals.overallMonthlyPct >= 100
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                      }`}>
                        {monthlySauceData.totals.overallMonthlyPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {monthlySauceData.totals.overallMonthlyPct >= 100 ? (
                        <span className="font-black text-emerald-500">مُحقق بالكامل 🏆</span>
                      ) : (
                        <span className="font-bold text-slate-400">قيد الإنجاز ⏳</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 2: Daily Tikrit Branch Achievement */}
          <div className="space-y-1.5 pt-2">
            <div className="text-xs font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
              <span>📌 2. جدول التحقيق اليومي (فرع تكريت — تاريخ {selectedDate}):</span>
            </div>
            <div className="overflow-x-auto w-full rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className={`border-b font-black ${
                    isDarkMode ? 'bg-slate-950 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-700 border-slate-300'
                  }`}>
                    <th className="py-3 px-4 text-center">الفرع</th>
                    <th className="py-3 px-4 text-center">التاركت اليومي الإجمالي (كجم)</th>
                    <th className="py-3 px-4 text-center">المبيعات اليومية الإجمالية (كجم)</th>
                    <th className="py-3 px-4 text-center">نسبة التحقيق اليومي (%)</th>
                    <th className="py-3 px-4 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-semibold">
                  <tr className={isDarkMode ? 'bg-slate-900/80' : 'bg-white'}>
                    <td className="py-3 px-4 text-center font-black text-slate-900 dark:text-white">
                      فرع تكريت
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-amber-700 dark:text-amber-400 text-sm">
                      {formatWithCommas(parseFloat(dailySauceData.totals.totalDailyTarget.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-4 text-center font-black text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatWithCommas(parseFloat(dailySauceData.totals.totalDailySales.toFixed(1)), true)} كجم
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-black ${
                        dailySauceData.totals.overallDailyPct >= 100
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                      }`}>
                        {dailySauceData.totals.overallDailyPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {dailySauceData.totals.overallDailyPct >= 100 ? (
                        <span className="font-black text-emerald-500">مُحقق اليوم 🏆</span>
                      ) : (
                        <span className="font-bold text-slate-400">قيد الإنجاز اليوم ⏳</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
