import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSales, DEFAULT_CATEGORIES_LIST, getFixedDelegatePhone } from '../context/SalesContext';
import { RouteItem, SalesEntry, ShopLocationRecord } from '../types';
import { db } from '../lib/firebase';
import { collection, writeBatch, doc, getDocs, setDoc, query, deleteDoc, where } from 'firebase/firestore';
import { logFirestoreErrorGracefully, isGlobalQuotaExceeded, safeOnSnapshot } from '../lib/firestoreUtils';
import { parseArabicDigits, parseArabicNumber, formatWithCommas } from '../utils/numberUtils';
import { PullToRefresh } from './PullToRefresh';
import { CollapsibleCard } from './admin/CollapsibleCard';
import { AdminSavedLocationsMap, CustomerSalesSummary } from './admin/AdminSavedLocationsMap';
import { formatShopLocationString } from '../lib/fleetTrackingService';
import { showConfirm } from '../utils/dialogService';
import { formatEnglishDateTime } from '../utils/dateUtils';
import {
  Lock,
  Unlock,
  Shield,
  User,
  Key,
  Save,
  Check,
  Eye,
  EyeOff,
  Clock,
  Calendar,
  HardDrive,
  RefreshCw,
  FileSpreadsheet,
  Upload,
  Download,
  Trash2,
  TrendingUp,
  Map as MapIcon,
  ClipboardList,
  Bell,
  ChevronDown,
  ChevronUp,
  FileText,
  Database,
  Battery,
  BatteryCharging,
  Zap,
  Tablet,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  MapPin
} from 'lucide-react';
import { SupabaseManagerModal } from './SupabaseManagerModal';


interface DebtItem {
  id: string;
  customerCode: string;
  customerName: string;
  amountDue: number;
  invoiceDate: string;
  paymentDueDate: string;
  delegateName: string;
}

interface AlertItem {
  id: string;
  delegateName: string;
  note: string;
  targetTime: number; // timestamp
  createdAt: number;
}

interface NoteItem {
  id: string;
  delegateName: string;
  content: string;
  createdAt: number;
}

export const AdminScreen: React.FC = () => {
  const {
    currentUser,
    rawSavedEntries,
    delegateTargets,
    delegateAccounts,
    delegatesList,
    saveDelegateAccount,
    addDelegateAccount,
    updateDelegateIdentity,
    resetDelegateAccount,
    deleteDelegateAccount,
    batchUpdateDelegateTargets,
    getDelegateLockStatus,
    unlockDelegateTargetManually,
    exportBackupData,
    restoreBackupData,
    isDarkMode,
    refreshAllData,
    allSalesEntries,
    selectedDate,
    isPowerSavingMode,
    togglePowerSavingMode,
    powerSavingSyncConfig,
    updatePowerSavingSyncConfig,
    batteryLevel,
    isBatteryCharging,
  } = useSales();

  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [editingDebt, setEditingDebt] = useState<DebtItem | null>(null);
  const [editDebtValues, setEditDebtValues] = useState<Partial<DebtItem>>({});
  const [showSupabaseModal, setShowSupabaseModal] = useState<boolean>(false);

  // --- Tablet Power Saving & Sync Frequency Settings State (Admin Only) ---
  const [reduceSyncFreq, setReduceSyncFreq] = useState<boolean>(
    powerSavingSyncConfig?.reduceSyncFrequencyOnPowerSave ?? true
  );
  const [syncIntervalMins, setSyncIntervalMins] = useState<number>(
    powerSavingSyncConfig?.powerSaveSyncIntervalMinutes ?? 30
  );
  const [autoLowBattery, setAutoLowBattery] = useState<boolean>(
    powerSavingSyncConfig?.autoEnableOnLowBattery ?? true
  );
  const [isSavingPowerConfig, setIsSavingPowerConfig] = useState<boolean>(false);

  useEffect(() => {
    if (powerSavingSyncConfig) {
      setReduceSyncFreq(powerSavingSyncConfig.reduceSyncFrequencyOnPowerSave);
      setSyncIntervalMins(powerSavingSyncConfig.powerSaveSyncIntervalMinutes);
      setAutoLowBattery(powerSavingSyncConfig.autoEnableOnLowBattery);
    }
  }, [powerSavingSyncConfig]);

  const handleSavePowerSavingSyncConfig = async () => {
    setIsSavingPowerConfig(true);
    try {
      await updatePowerSavingSyncConfig({
        reduceSyncFrequencyOnPowerSave: reduceSyncFreq,
        powerSaveSyncIntervalMinutes: syncIntervalMins,
        autoEnableOnLowBattery: autoLowBattery,
      });
    } finally {
      setIsSavingPowerConfig(false);
    }
  };

  const handleSaveDailyTask = async () => {
    if (!dailyTaskDelegate || !dailyTaskText.trim()) {
      setDailyTaskMessage('يرجى اختيار المندوب وكتابة المهمة');
      return;
    }
    try {
      await setDoc(doc(db, 'dailyTasks', dailyTaskDelegate), {
        delegateName: dailyTaskDelegate,
        taskText: dailyTaskText.trim(),
        updatedAt: Date.now()
      });
      setDailyTaskMessage('تم حفظ المهمة اليومية بنجاح ✅');
      setDailyTaskText('');
    } catch (e) {
      console.error(e);
      setDailyTaskMessage('حدث خطأ أثناء الحفظ');
    }
  };

  useEffect(() => {
    if (isGlobalQuotaExceeded()) return;
    const q = query(collection(db, 'debts'));
    const unsub = safeOnSnapshot(
      q, 
      (snap: any) => {
        const arr: DebtItem[] = [];
        snap.forEach((d: any) => arr.push({ id: d.id, ...d.data() } as DebtItem));
        setDebts(arr);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'admin_debts'),
      'admin_debts'
    );
    return unsub;
  }, []);

  // --- Saved Shop Locations (rep_shop_locations) & Admin Excel/Map State ---
  const [savedShopLocations, setSavedShopLocations] = useState<ShopLocationRecord[]>([]);
  const [showSavedLocationsMap, setShowSavedLocationsMap] = useState<boolean>(false);
  const [isExportingSalesAndLocations, setIsExportingSalesAndLocations] = useState<boolean>(false);
  const [exportSalesLocStatus, setExportSalesLocStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isGlobalQuotaExceeded()) return;
    const q = query(collection(db, 'rep_shop_locations'));
    const unsub = safeOnSnapshot(
      q,
      (snap: any) => {
        const list: ShopLocationRecord[] = [];
        snap.forEach((d: any) => {
          const data = d.data();
          const lat = Number(data?.latitude);
          const lng = Number(data?.longitude);
          if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
            list.push({
              id: d.id,
              routeId: data?.routeId || d.id,
              customerCode: data?.customerCode || '',
              customerName: data?.customerName || '',
              customerAddress: data?.customerAddress || '',
              customerType: data?.customerType === 'جملة' ? 'جملة' : 'مفرد',
              path: data?.path || '',
              delegateName: data?.delegateName || data?.savedBy || '',
              delegateCode: data?.delegateCode || '',
              latitude: lat,
              longitude: lng,
              accuracyMeters: typeof data?.accuracyMeters === 'number' ? data.accuracyMeters : undefined,
              savedBy: data?.savedBy || data?.delegateName || '',
              savedByCode: data?.savedByCode || '',
              savedAt: data?.savedAt || '',
              timestamp: Number(data?.timestamp) || 0,
              dateString: data?.dateString || '',
            });
          }
        });
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setSavedShopLocations(list);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'admin_rep_shop_locations'),
      'admin_rep_shop_locations'
    );
    return unsub;
  }, []);

  const salesStatsByCustomer = useMemo(() => {
    const map = new Map<string, CustomerSalesSummary>();
    const combinedMap = new Map<string, SalesEntry>();
    [...rawSavedEntries, ...allSalesEntries].forEach((entry) => {
      if (entry && entry.id && entry.status !== 'cancelled') {
        combinedMap.set(entry.id, entry);
      }
    });

    const invoiceTracker = new Map<string, Set<string>>();

    combinedMap.forEach((entry) => {
      const codeKey = (entry.customerCode || '').trim().toLowerCase();
      const nameKey = (entry.customerName || '').trim().toLowerCase();
      const keys: string[] = [];
      if (codeKey) keys.push(`code:${codeKey}`);
      if (nameKey) keys.push(`name:${nameKey}`);

      const invKey = entry.invoiceId || `${entry.dateString}_${entry.customerName}_${entry.delegateName}_${entry.timestamp}`;

      keys.forEach((k) => {
        const existing = map.get(k) || {
          invoicesCount: 0,
          totalWeightKg: 0,
          totalQuantity: 0,
          lastDate: '',
        };
        let invSet = invoiceTracker.get(k);
        if (!invSet) {
          invSet = new Set<string>();
          invoiceTracker.set(k, invSet);
        }
        if (!invSet.has(invKey)) {
          invSet.add(invKey);
          existing.invoicesCount += 1;
        }
        existing.totalWeightKg += Number(entry.totalWeightKg) || 0;
        existing.totalQuantity += Number(entry.quantity) || 0;
        if (entry.dateString && (!existing.lastDate || entry.dateString > existing.lastDate)) {
          existing.lastDate = entry.dateString;
        }
        map.set(k, existing);
      });
    });

    return map;
  }, [allSalesEntries, rawSavedEntries]);

  const handleExportAllSalesAndLocationsExcel = async () => {
    setIsExportingSalesAndLocations(true);
    setExportSalesLocStatus('جاري تجميع كافة بيانات المبيعات ومواقع المحلات المحفوظة...');
    try {
      // 1. Gather all sales entries (memory + Firestore active & archive)
      const salesById = new Map<string, SalesEntry>();
      [...rawSavedEntries, ...allSalesEntries].forEach((entry) => {
        if (entry && entry.id) salesById.set(entry.id, entry);
      });

      const locationsById = new Map<string, ShopLocationRecord>();
      savedShopLocations.forEach((loc) => locationsById.set(loc.id, loc));

      if (!isGlobalQuotaExceeded()) {
        const [activeRes, archiveRes, locsRes] = await Promise.allSettled([
          getDocs(collection(db, 'sales_entries')),
          getDocs(collection(db, 'sales_entries_archive')),
          getDocs(collection(db, 'rep_shop_locations')),
        ]);

        if (activeRes.status === 'fulfilled') {
          activeRes.value.forEach((d) => {
            const data = d.data() as SalesEntry;
            salesById.set(d.id, { ...data, id: d.id });
          });
        }
        if (archiveRes.status === 'fulfilled') {
          archiveRes.value.forEach((d) => {
            const data = d.data() as SalesEntry;
            salesById.set(d.id, { ...data, id: d.id });
          });
        }
        if (locsRes.status === 'fulfilled') {
          locsRes.value.forEach((d) => {
            const data = d.data() as any;
            const lat = Number(data?.latitude);
            const lng = Number(data?.longitude);
            if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
              locationsById.set(d.id, {
                id: d.id,
                routeId: data?.routeId || d.id,
                customerCode: data?.customerCode || '',
                customerName: data?.customerName || '',
                customerAddress: data?.customerAddress || '',
                customerType: data?.customerType === 'جملة' ? 'جملة' : 'مفرد',
                path: data?.path || '',
                delegateName: data?.delegateName || data?.savedBy || '',
                delegateCode: data?.delegateCode || '',
                latitude: lat,
                longitude: lng,
                accuracyMeters: typeof data?.accuracyMeters === 'number' ? data.accuracyMeters : undefined,
                savedBy: data?.savedBy || data?.delegateName || '',
                savedByCode: data?.savedByCode || '',
                savedAt: data?.savedAt || '',
                timestamp: Number(data?.timestamp) || 0,
                dateString: data?.dateString || '',
              });
            }
          });
        }
      }

      const allLocationsList = Array.from(locationsById.values()).sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
      );
      const allSalesList = Array.from(salesById.values()).sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
      );

      // Lookup maps for matching sales entries with saved shop locations
      const locByCode = new Map<string, ShopLocationRecord>();
      const locByName = new Map<string, ShopLocationRecord>();
      allLocationsList.forEach((loc) => {
        const cKey = (loc.customerCode || '').trim().toLowerCase();
        const nKey = (loc.customerName || '').trim().toLowerCase();
        if (cKey) locByCode.set(cKey, loc);
        if (nKey) locByName.set(nKey, loc);
      });

      const findLocationForSale = (entry: SalesEntry): ShopLocationRecord | undefined => {
        const cKey = (entry.customerCode || '').trim().toLowerCase();
        if (cKey && locByCode.has(cKey)) return locByCode.get(cKey);
        const nKey = (entry.customerName || '').trim().toLowerCase();
        if (nKey && locByName.has(nKey)) return locByName.get(nKey);
        return undefined;
      };

      // Aggregate per-customer sales for the locations sheet
      const statsByCode = new Map<string, { invoices: Set<string>; weight: number; lastDate: string }>();
      const statsByName = new Map<string, { invoices: Set<string>; weight: number; lastDate: string }>();
      allSalesList.forEach((s) => {
        if (s.status === 'cancelled') return;
        const invKey = s.invoiceId || `${s.dateString}_${s.customerName}_${s.delegateName}_${s.timestamp}`;
        const w = Number(s.totalWeightKg) || 0;
        const cKey = (s.customerCode || '').trim().toLowerCase();
        const nKey = (s.customerName || '').trim().toLowerCase();
        if (cKey) {
          const cur = statsByCode.get(cKey) || { invoices: new Set<string>(), weight: 0, lastDate: '' };
          cur.invoices.add(invKey);
          cur.weight += w;
          if (s.dateString && s.dateString > cur.lastDate) cur.lastDate = s.dateString;
          statsByCode.set(cKey, cur);
        }
        if (nKey) {
          const cur = statsByName.get(nKey) || { invoices: new Set<string>(), weight: 0, lastDate: '' };
          cur.invoices.add(invKey);
          cur.weight += w;
          if (s.dateString && s.dateString > cur.lastDate) cur.lastDate = s.dateString;
          statsByName.set(nKey, cur);
        }
      });

      // Sheet 1: Saved Shop Locations
      const locationRows = allLocationsList.map((loc, idx) => {
        const cKey = (loc.customerCode || '').trim().toLowerCase();
        const nKey = (loc.customerName || '').trim().toLowerCase();
        const st =
          (cKey ? statsByCode.get(cKey) : undefined) ||
          (nKey ? statsByName.get(nKey) : undefined);
        return {
          'ت': idx + 1,
          'كود الزبون': loc.customerCode || '-',
          'اسم المحل': loc.customerName || '-',
          'نوع البيع': loc.customerType || 'مفرد',
          'المسار': loc.path || '-',
          'العنوان': loc.customerAddress || '-',
          'مندوب الخط': loc.delegateName || '-',
          'حُفظ بواسطة المندوب': loc.savedBy || loc.delegateName || '-',
          'موقع المحل': loc.shopLocation || formatShopLocationString(loc.latitude, loc.longitude),
          'خط العرض (Latitude)': Number(loc.latitude.toFixed(6)),
          'خط الطول (Longitude)': Number(loc.longitude.toFixed(6)),
          'دقة GPS (متر)': loc.accuracyMeters ?? '-',
          'تاريخ الحفظ': loc.dateString || '-',
          'وقت الحفظ': formatEnglishDateTime(loc.savedAt, '-'),
          'عدد فواتير المبيعات': st ? st.invoices.size : 0,
          'إجمالي وزن المبيعات (كجم)': st ? Number(st.weight.toFixed(2)) : 0,
          'آخر تاريخ بيع': st?.lastDate || '-',
        };
      });

      // Sheet 2: All Sales Entries + Joined Location Data
      const salesRows = allSalesList.map((s, idx) => {
        const matchedLoc = findLocationForSale(s);
        return {
          'ت': idx + 1,
          'رقم الفاتورة': s.invoiceId || s.id,
          'التاريخ': s.dateString || '-',
          'المندوب': s.delegateName || '-',
          'كود الزبون': s.customerCode || '-',
          'اسم المحل / الزبون': s.customerName || '-',
          'نوع المحل': s.customerType || (s.priceMode === 'wholesale' ? 'جملة' : 'مفرد'),
          'عنوان الزبون': s.customerAddress || matchedLoc?.customerAddress || '-',
          'رقم الهاتف': s.customerPhone || '-',
          'الصنف': s.categoryName || '-',
          'المنتج': s.productName || '-',
          'الكمية': Number(s.quantity) || 0,
          'وحدة الإدخال': s.entryUnit === 'carton' ? 'كارتون' : 'قطعة',
          'الكمية المدخلة': Number(s.enteredQuantity ?? s.quantity) || 0,
          'وزن القطعة (كجم)': Number(s.pieceWeightKg) || 0,
          'الوزن الكلي (كجم)': Number((Number(s.totalWeightKg) || 0).toFixed(2)),
          'بونص / هدية': s.isGift ? 'نعم' : 'لا',
          'الحالة': s.status === 'cancelled' ? 'ملغاة' : 'فعالة',
          'حالة موقع المحل': matchedLoc ? 'محفوظ من المندوب' : 'غير محدد',
          'موقع المحل': matchedLoc
            ? matchedLoc.shopLocation || formatShopLocationString(matchedLoc.latitude, matchedLoc.longitude)
            : '-',
          'خط العرض (Latitude)': matchedLoc ? Number(matchedLoc.latitude.toFixed(6)) : '',
          'خط الطول (Longitude)': matchedLoc ? Number(matchedLoc.longitude.toFixed(6)) : '',
          'المندوب الذي حفظ الموقع': matchedLoc ? matchedLoc.savedBy || matchedLoc.delegateName : '-',
        };
      });

      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };

      const wsLocations = XLSX.utils.json_to_sheet(
        locationRows.length > 0
          ? locationRows
          : [{ 'ملاحظة': 'لا توجد مواقع محلات محفوظة من قبل المناديب حتى الآن' }]
      );
      wsLocations['!cols'] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 26 },
        { wch: 10 },
        { wch: 18 },
        { wch: 24 },
        { wch: 18 },
        { wch: 20 },
        { wch: 24 },
        { wch: 16 },
        { wch: 16 },
        { wch: 12 },
        { wch: 14 },
        { wch: 22 },
        { wch: 16 },
        { wch: 20 },
        { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, wsLocations, 'مواقع المحلات المحفوظة');

      const wsSales = XLSX.utils.json_to_sheet(
        salesRows.length > 0
          ? salesRows
          : [{ 'ملاحظة': 'لا توجد بيانات مبيعات مسجلة حالياً' }]
      );
      wsSales['!cols'] = [
        { wch: 6 },
        { wch: 18 },
        { wch: 13 },
        { wch: 18 },
        { wch: 14 },
        { wch: 25 },
        { wch: 10 },
        { wch: 24 },
        { wch: 15 },
        { wch: 18 },
        { wch: 26 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 16 },
        { wch: 10 },
        { wch: 10 },
        { wch: 18 },
        { wch: 24 },
        { wch: 15 },
        { wch: 15 },
        { wch: 20 },
      ];
      XLSX.utils.book_append_sheet(wb, wsSales, 'بيانات المبيعات والمواقع');

      const todayStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `كافة_المبيعات_ومواقع_المحلات_${todayStr}.xlsx`);

      setExportSalesLocStatus(
        `تم تصدير ملف Excel بنجاح (${salesRows.length} سجل مبيعات، و ${allLocationsList.length} موقع محل محفوظ).`
      );
    } catch (err) {
      console.error('Error exporting sales and locations excel:', err);
      setExportSalesLocStatus('حدث خطأ أثناء تصدير ملف Excel. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsExportingSalesAndLocations(false);
    }
  };

  const [dailyTaskDelegate, setDailyTaskDelegate] = useState<string>('');
  const [dailyTaskText, setDailyTaskText] = useState<string>('');
  const [dailyTaskMessage, setDailyTaskMessage] = useState<string | null>(null);

  // --- Admin Note State ---
  const [noteCustomerCode, setNoteCustomerCode] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteExpiryHours, setNoteExpiryHours] = useState('');
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  
  const handleSaveAdminNote = async () => {
    if (!noteCustomerCode || !noteContent || !noteExpiryHours) {
        setNoteMessage('يرجى ملء جميع الحقول');
        return;
    }
    const expiryTimestamp = Date.now() + parseInt(noteExpiryHours) * 60 * 60 * 1000;
    await setDoc(doc(collection(db, 'admin_notes')), {
        customerCode: noteCustomerCode,
        note: noteContent,
        expiryTimestamp: expiryTimestamp
    });
    setNoteMessage('تم حفظ الملاحظة');
    setNoteCustomerCode('');
    setNoteContent('');
    setNoteExpiryHours('');
    setTimeout(() => setNoteMessage(null), 3000);
  };
  const [newDelegateData, setNewDelegateData] = useState({ oldName: '', oldUsername: '', newName: '', newUsername: '', newPassword: '' });
  const [backupStatusMsg, setBackupStatusMsg] = useState<string | null>(null);

  const [globalNotifText, setGlobalNotifText] = useState<string>('');
  const [globalNotifMessage, setGlobalNotifMessage] = useState<string | null>(null);

  const handleSaveDebt = async (debt: DebtItem) => {
    try {
      const docRef = doc(db, 'debts', debt.id);
      await setDoc(docRef, editDebtValues, { merge: true });
      setEditingDebt(null);
      setEditDebtValues({});
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteDebt = async (debtId: string) => {
    if (!(await showConfirm("هل أنت متأكد من حذف هذا الدين؟"))) return;
    try {
      await deleteDoc(doc(db, 'debts', debtId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveGlobalNotification = async () => {
    if (!globalNotifText) {
      setGlobalNotifMessage('يرجى كتابة نص الإشعار.');
      return;
    }
    setGlobalNotifMessage('جاري الإرسال...');
    try {
      const notifId = `notif_${Date.now()}`;
      await setDoc(doc(db, 'admin_notifications', notifId), {
        text: globalNotifText,
        timestamp: Date.now()
      });
      setGlobalNotifMessage('تم إرسال الإشعار لجميع المندوبين بنجاح!');
      setGlobalNotifText('');
    } catch (err) {
      console.error(err);
      setGlobalNotifMessage('حدث خطأ أثناء إرسال الإشعار.');
    }
  };

  const handleJsonBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsedData = JSON.parse(text);
        const success = restoreBackupData(parsedData);
        if (success) {
          setBackupStatusMsg('تمت استعادة ملف النسخة الاحتياطية بنجاح ✅');
        } else {
          setBackupStatusMsg('فشلت قراءة ملف النسخة الاحتياطية. يرجى التأكد من اختيار ملف صحيح.');
        }
      } catch (err) {
        setBackupStatusMsg('ملف غير صالح أو تالف.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };


  const [isAuthenticated, setIsAuthenticated] = useState(() => !!currentUser?.isAdmin);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);



  const getDelegateTotalTarget = (delName: string) => {
    return DEFAULT_CATEGORIES_LIST.reduce((sum, cat) => {
      const found = delegateTargets.find(t => 
        t.delegateName?.trim().toLowerCase() === delName.trim().toLowerCase() &&
        t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
      );
      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
    }, 0);
  };

  const totalAllTarget = delegatesList.reduce((sum, del) => sum + getDelegateTotalTarget(del), 0);

  const getCategoryAllTarget = (catName: string) => {
    return delegatesList.reduce((sum, del) => {
      const found = delegateTargets.find(t => 
        t.delegateName?.trim().toLowerCase() === del.trim().toLowerCase() &&
        t.categoryName?.trim().toLowerCase() === catName.trim().toLowerCase()
      );
      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
    }, 0);
  };

  // Input states for targets map
  const [targetInputs, setTargetInputs] = useState<Record<string, string>>({});
  const [saveFeedbackMessage, setSaveFeedbackMessage] = useState<string | null>(null);
  const [allowForceOverride, setAllowForceOverride] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const container = e.currentTarget.closest('table, .grid-container');
      if (!container) return;
      const focusableElements = Array.from(
        container.querySelectorAll('input:not([disabled]), select:not([disabled])')
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

  // Delegate credentials management state
  const [accountDelNameInput, setAccountDelNameInput] = useState('');
  const [accountUsernameInput, setAccountUsernameInput] = useState('');
  const [accountPasswordInput, setAccountPasswordInput] = useState('');
  const [accountDelegateCodeInput, setAccountDelegateCodeInput] = useState('');
  const [editingAccountUsername, setEditingAccountUsername] = useState<string | null>(null);
  const [editingIsAdmin, setEditingIsAdmin] = useState(false);

  const rafatCurrentAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'rafatdata' || d.role === 'dataEntry');
  const [rafatUsernameInput, setRafatUsernameInput] = useState(rafatCurrentAcc?.username || 'rafatdata');
  const [rafatPasswordInput, setRafatPasswordInput] = useState(rafatCurrentAcc?.password || '10001');

  const mohammedCurrentAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'mohammedsauce' || d.role === 'sauceOnly');
  const [mohammedUsernameInput, setMohammedUsernameInput] = useState(mohammedCurrentAcc?.username || 'mohammedsauce');
  const [mohammedPasswordInput, setMohammedPasswordInput] = useState(mohammedCurrentAcc?.password || 'm12343');

  useEffect(() => {
    if (rafatCurrentAcc) {
      setRafatUsernameInput(rafatCurrentAcc.username);
      setRafatPasswordInput(rafatCurrentAcc.password);
    }
  }, [rafatCurrentAcc?.username, rafatCurrentAcc?.password]);

  useEffect(() => {
    if (mohammedCurrentAcc) {
      setMohammedUsernameInput(mohammedCurrentAcc.username);
      setMohammedPasswordInput(mohammedCurrentAcc.password);
    }
  }, [mohammedCurrentAcc?.username, mohammedCurrentAcc?.password]);

  // Overall metrics
  const totalCompanySalesWeight = rawSavedEntries.reduce((sum, e) => sum + e.totalWeightKg, 0);
  const totalCompanyTargetWeight = totalAllTarget;

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const u = usernameInput.trim();
    const p = passwordInput.trim();

    const matchedAccount = delegateAccounts.find(
      (it) =>
        (it.username.toLowerCase() === u.toLowerCase() ||
          it.delegateName.toLowerCase() === u.toLowerCase()) &&
        it.password === p
    );

    const isDefaultAdmin =
      u.toLowerCase() === 'yasir' && p === '377377';

    if ((matchedAccount && matchedAccount.isAdmin) || isDefaultAdmin) {
      setIsAuthenticated(true);
      setLoginError(null);
    } else {
      setLoginError('اسم المستخدم أو الرمز السري غير صحيح');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4 dir-rtl">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-500/40 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-6 text-slate-800 dark:text-white transition-colors">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
              <Lock className="w-8 h-8" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">تسجيل دخول لوحة الأدمن</h2>
            <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
              يرجى إدخال اسم المستخدم والرمز السري للوصول للوحة التحكم
            </p>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">اسم المستخدم</label>
              <div className="relative">
                <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => {
                    setUsernameInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="اسم المستخدم"
                  className="w-full pl-3 pr-10 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-sm font-bold focus:border-emerald-500 dark:focus:border-emerald-400 focus:outline-none transition-colors"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">الرمز السري (كلمة المرور)</label>
              <div className="relative">
                <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="الرمز السري"
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-sm font-bold focus:border-emerald-500 dark:focus:border-emerald-400 focus:outline-none transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white p-1"
                >
                  {isPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-200 text-xs font-bold text-center">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition-all cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>تسجيل الدخول</span>
            </button>
          </form>
        </div>
      </div>
    );
  }



  const handleStartEditAccount = (acc: { username: string; password: string; delegateName: string; isAdmin: boolean; delegateCode?: string }) => {
    setAccountDelNameInput(acc.delegateName);
    setAccountUsernameInput(acc.username);
    setAccountPasswordInput(acc.password);
    setAccountDelegateCodeInput(acc.delegateCode || '');
    setEditingAccountUsername(acc.username);
    setEditingIsAdmin(acc.isAdmin);
  };

  const handleCancelEditAccount = () => {
    setAccountDelNameInput('');
    setAccountUsernameInput('');
    setAccountPasswordInput('');
    setAccountDelegateCodeInput('');
    setEditingAccountUsername(null);
    setEditingIsAdmin(false);
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const delName = accountDelNameInput.trim();
    const u = accountUsernameInput.trim();
    const p = accountPasswordInput.trim();

    if (delName && u && p) {
      // If we were editing an existing account and the username changed, remove the old one first
      if (editingAccountUsername && editingAccountUsername !== u) {
        deleteDelegateAccount(editingAccountUsername);
      }

      saveDelegateAccount({
        username: u,
        password: p,
        delegateName: delName,
        monthlyTargetKg: 0,
        isAdmin: editingIsAdmin,
        delegateCode: accountDelegateCodeInput.trim() || undefined,
      });

      setSaveFeedbackMessage(
        editingAccountUsername
          ? `✔️ تم تحديث بيانات الدخول لـ (${delName}) بنجاح!`
          : `✔️ تم إنشاء وتخزين حساب جديد لـ (${delName}) بنجاح!`
      );

      handleCancelEditAccount();
    }
  };

  return (
    <PullToRefresh onRefresh={async () => { await refreshAllData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="p-3 sm:p-4 max-w-5xl mx-auto space-y-5 dir-rtl text-slate-800 dark:text-slate-100 transition-colors">
        
      {/* Top Banner with Lock Button */}
      <div className="bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 border border-emerald-600/40 dark:border-emerald-500/30 rounded-3xl p-5 text-white shadow-xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
              <Shield className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white">
                لوحة تحكم الأدمن | إدارة الأهداف والتاركت
              </h2>
              <p className="text-xs text-emerald-200/80 font-medium">مراقبة الأداء وتعيين الأهداف والحسابات</p>
            </div>
          </div>

          <button
            onClick={() => {
              setIsAuthenticated(false);
              setPasswordInput('');
            }}
            className="px-3.5 py-2 bg-white/15 hover:bg-white/25 border border-white/20 rounded-xl text-xs font-black text-white flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>قفل الصفحة</span>
          </button>
        </div>

        <hr className="border-white/15" />

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-2xl bg-black/20 border border-white/10">
            <div className="text-emerald-200/90 font-bold mb-1">إجمالي مبيعات المناديب اليوم:</div>
            <div className="text-xl sm:text-2xl font-black text-emerald-300 tracking-tight">
              {formatWithCommas(parseFloat(totalCompanySalesWeight.toFixed(0)), true)} كجم
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-black/20 border border-white/10 text-left dir-ltr">
            <div className="text-slate-200/90 font-bold mb-1 dir-rtl">إجمالي التاركت المطلوب:</div>
            <div className="text-xl sm:text-2xl font-black text-white dir-rtl tracking-tight">
              {formatWithCommas(parseFloat(totalCompanyTargetWeight.toFixed(0)), true)} كجم
            </div>
          </div>
        </div>
      </div>

      {/* Saved Shop Locations (Leaflet Map) & Full Sales/Locations Excel Export */}
      <div className="bg-white dark:bg-slate-900 border-2 border-teal-500/35 dark:border-teal-700/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-teal-200">
                مراجعة المواقع الجغرافية للمحلات وتصدير كافة المبيعات (Excel &amp; Leaflet):
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                تصدير ملف إكسل شامل لجميع المبيعات مع مواقع المحلات، وعرض جميع دبابيس المواقع التي حددها المندوبون على الخريطة التفاعلية.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-xl bg-teal-50 dark:bg-teal-950/70 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 text-[11px] font-black">
              المواقع المحفوظة: {savedShopLocations.length}
            </span>
            <span className="px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[11px] font-black">
              سجلات المبيعات: {allSalesEntries.length}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportAllSalesAndLocationsExcel}
            disabled={isExportingSalesAndLocations}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 active:scale-95 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              {isExportingSalesAndLocations
                ? 'جاري تجهيز ملف Excel...'
                : 'تصدير كافة بيانات المبيعات والمواقع المحفوظة (Excel)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowSavedLocationsMap((prev) => !prev)}
            className={`px-4 py-2.5 rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer ${
              showSavedLocationsMap
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-teal-600 hover:bg-teal-500 text-white'
            }`}
          >
            <MapIcon className="w-4 h-4" />
            <span>
              {showSavedLocationsMap
                ? 'إخفاء خريطة مواقع المحلات المحفوظة (Leaflet)'
                : `عرض جميع مواقع المحلات المحفوظة على الخريطة (Leaflet) (${savedShopLocations.length})`}
            </span>
          </button>
        </div>

        {exportSalesLocStatus && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-200 text-center">
            {exportSalesLocStatus}
          </div>
        )}

        {showSavedLocationsMap && (
          <AdminSavedLocationsMap
            locations={savedShopLocations}
            salesStatsByCustomer={salesStatsByCustomer}
            isDarkMode={isDarkMode}
          />
        )}
      </div>




      {/* 4. Delegate & Admin Credentials Management */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
              4. إدارة تعديل اسم المستخدم والرمز السري لكل حساب:
            </h3>
          </div>

          {editingAccountUsername && (
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-500/60 px-3 py-1 rounded-xl text-xs">
              <span className="text-amber-900 dark:text-amber-200 font-bold">جارٍ تعديل الحساب ({editingAccountUsername})</span>
              <button
                type="button"
                onClick={handleCancelEditAccount}
                className="text-amber-700 dark:text-amber-400 hover:underline font-black text-[11px] cursor-pointer"
              >
                إلغاء التعديل
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
          يمكنك إضافة حسابات جديدة أو التعديل على اسم المستخدم والرمز السري لأي حساب مسجل بسهولة.
        </p>

        <form onSubmit={handleSaveAccount} className="space-y-3 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">اسم المندوب / الحساب</label>
              <input
                type="text"
                value={accountDelNameInput}
                onChange={(e) => setAccountDelNameInput(e.target.value)}
                placeholder="اسم المندوب"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">اسم المستخدم</label>
              <input
                type="text"
                value={accountUsernameInput}
                onChange={(e) => setAccountUsernameInput(e.target.value)}
                placeholder="اسم المستخدم"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">الرمز السري</label>
              <input
                type="text"
                value={accountPasswordInput}
                onChange={(e) => setAccountPasswordInput(e.target.value)}
                placeholder="الرمز السري"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
                required
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">كود المندوب</label>
            <input
              type="text"
              value={accountDelegateCodeInput}
              onChange={(e) => setAccountDelegateCodeInput(e.target.value)}
              placeholder="كود المندوب"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:border-emerald-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              className={`flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 cursor-pointer ${
                editingAccountUsername
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              <Save className="w-4 h-4" />
              <span>{editingAccountUsername ? 'تحديث بيانات الحساب' : 'حفظ بيانات الحساب الجديد'}</span>
            </button>

            {editingAccountUsername && (
              <button
                type="button"
                onClick={async () => {
                  if (await showConfirm('هل أنت متأكد من حذف حساب المندوب هذا تماماً من النظام؟')) {
                    deleteDelegateAccount(editingAccountUsername);
                    handleCancelEditAccount();
                  }
                }}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                حذف الحساب
              </button>
            )}

            {editingAccountUsername && (
              <button
                type="button"
                onClick={handleCancelEditAccount}
                className="px-4 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-xl font-bold text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            )}
          </div>
        </form>

        {/* Existing Accounts List */}
        <div className="pt-3 space-y-2.5 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-black text-emerald-800 dark:text-emerald-300">قائمة الحسابات المسجلة:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {delegateAccounts.map((acc, idx) => (
              <div
                key={acc.username || `acc-${idx}`}
                className={`p-3.5 border rounded-2xl flex items-center justify-between text-xs transition-all shadow-xs ${
                  editingAccountUsername === acc.username
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400'
                    : 'bg-slate-50 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div>
                  <div className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>{acc.delegateName}</span>
                    {acc.isAdmin && (
                      <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold rounded-md border border-emerald-300 dark:border-emerald-700">
                        الأدمن
                      </span>
                    )}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 mt-1 font-medium">
                    مستخدم: <strong className="text-slate-800 dark:text-slate-200 font-mono">{acc.username}</strong> | رمز: <strong className="text-slate-800 dark:text-slate-200 font-mono">{acc.password}</strong>
                  </div>
                  {(() => {
                    const phone = getFixedDelegatePhone(acc.delegateName, acc.delegateCode, acc.username) || acc.phone;
                    const isFixed = Boolean(getFixedDelegatePhone(acc.delegateName, acc.delegateCode, acc.username));
                    if (!phone) return null;
                    return (
                      <div className="text-emerald-700 dark:text-emerald-400 mt-1 font-bold flex items-center gap-1.5 text-[11px]">
                        <span>واتساب: <strong className="font-mono" dir="ltr">{phone}</strong></span>
                        {isFixed && (
                          <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 px-1 py-0.2 rounded-sm font-bold">
                            🔒 ثابت ومحمي
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStartEditAccount(acc)}
                    className="px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <span>تعديل</span>
                  </button>

                  {!acc.isAdmin && (
                    <button
                      type="button"
                      onClick={async () => { if(await showConfirm('هل أنت متأكد من حذف حساب المندوب هذا؟')) deleteDelegateAccount(acc.username) }}
                      className="px-2.5 py-1.5 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-800 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                    >
                      حذف
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. JSON Backup Export & Import */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <HardDrive className="w-4 h-4" />
          </div>
          <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
            5. النسخ الاحتياطي وتخزين البيانات الحالية (JSON):
          </h3>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
          تتيح هذه الميزة للأدمن تحميل جميع بيانات Firestore الحالية (المبيعات، المخزن، التاركت، الحسابات) في ملف JSON موحد ومحمي.
        </p>

        {backupStatusMsg && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-500 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-200 text-center">
            {backupStatusMsg}
          </div>
        )}

        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            onClick={exportBackupData}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تنزيل نسخة بيانات كاملة</span>
          </button>

          <label className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-xs">
            <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>استعادة نسخة بيانات كاملة من ملف JSON</span>
            <input
              type="file"
              accept=".json"
              onChange={handleJsonBackupImport}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Supabase Backend API & Storage Integration Card */}
      <div className="bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
              ربط وتكامل Supabase Backend & Storage (PostgreSQL & S3):
            </h3>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300">
            sales-bucket 🟢
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
          ربط وتزامن جداول المنتجات، المندوبين، والمبيعات مع Supabase (عبر <code className="font-mono">.from().select()</code>)، وتخزين شيتات مبيعات الإكسل وصور الفواتير في سحابة Supabase Storage وتوليد الروابط العامة.
        </p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            onClick={() => setShowSupabaseModal(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all cursor-pointer"
          >
            <Database className="w-4 h-4" />
            <span>لوحة تحكم Supabase ومساحة التخزين</span>
          </button>
        </div>
      </div>

      {/* Supabase Manager Modal */}
      {showSupabaseModal && (
        <SupabaseManagerModal
          isOpen={showSupabaseModal}
          onClose={() => setShowSupabaseModal(false)}
          isDarkMode={isDarkMode}
        />
      )}

      {/* 9. Data Saver Mode & Tablet Battery Sync Frequency Settings (Admin Only) */}
      {currentUser?.isAdmin && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-5 shadow-sm dark:shadow-md transition-colors">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <BatteryCharging className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200 flex items-center gap-2">
                  <span>9. إعدادات توفير الطاقة ومزامنة بطارية الأجهزة اللوحية (Tablet Battery & Sync)</span>
                </h3>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                  إدارة معدل المزامنة التلقائية للأجهزة اللوحية المستخدمة من قبل المندوبين
                </span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] font-black">
              خاص بالادمن فقط 🔒
            </span>
          </div>

          {/* Quick Toggle for Power Saving Mode on this device */}
          <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-950/80 p-3 sm:p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className={`w-4 h-4 ${isPowerSavingMode ? 'text-amber-500' : 'text-slate-400'}`} />
              <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                حالة وضع توفير الطاقة للجهاز الحالي:{' '}
                <span className={isPowerSavingMode ? 'text-amber-500 font-black' : 'text-slate-500 font-bold'}>
                  {isPowerSavingMode ? 'مفعل (نشط 🔋)' : 'معطل (طبيعي ⚡)'}
                </span>
              </span>
            </div>
            <button
              onClick={togglePowerSavingMode}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 cursor-pointer shadow-xs ${
                isPowerSavingMode
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {isPowerSavingMode ? 'إيقاف وضع توفير الطاقة' : 'تفعيل وضع توفير الطاقة'}
            </button>
          </div>

          {/* Dedicated Field Tablets Battery Saver & Reduced Sync Frequency Settings */}
          <div className="bg-gradient-to-br from-emerald-50/50 via-slate-50 to-teal-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4 sm:p-5 rounded-2xl border-2 border-emerald-500/30 dark:border-emerald-600/30 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Tablet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white">
                    تقليل تكرار مزامنة البيانات التلقائية عند تفعيل وضع توفير الطاقة
                  </h4>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                  خيار موجه للحفاظ على عمر البطارية للأجهزة اللوحية (Tablets) المستخدمة من قبل المندوبين أثناء العمل الميداني. يقوم هذا الخيار بإطالة الفترات الزمنية بين عمليات الاتصال التلقائية بالسحابة، مما يمنع استنزاف بطارية التابلت ويوفر استهلاك البيانات أثناء الجولات والزيارات الميدانية.
                </p>
              </div>

              {/* Master Switch for reducing sync frequency */}
              <button
                type="button"
                onClick={() => setReduceSyncFreq(!reduceSyncFreq)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  reduceSyncFreq ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
                title="تبديل تفعيل تقليل تكرار المزامنة"
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    reduceSyncFreq ? '-translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Sync Interval Options (Visible when enabled) */}
            {reduceSyncFreq ? (
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>تحديد معدل تكرار المزامنة التلقائية في وضع توفير الطاقة:</span>
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                    (المعدل الافتراضي الطبيعي: كل 5 دقائق)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {/* 15 Minutes */}
                  <button
                    type="button"
                    onClick={() => setSyncIntervalMins(15)}
                    className={`p-3 rounded-xl border-2 text-right transition-all cursor-pointer flex flex-col justify-between ${
                      syncIntervalMins === 15
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 shadow-xs'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-xs text-slate-900 dark:text-white">كل 15 دقيقة</span>
                      {syncIntervalMins === 15 && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                    </div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                      توفير معتدل - مزامنة منتظمة
                    </span>
                  </button>

                  {/* 30 Minutes (Recommended) */}
                  <button
                    type="button"
                    onClick={() => setSyncIntervalMins(30)}
                    className={`p-3 rounded-xl border-2 text-right transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden ${
                      syncIntervalMins === 30
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 shadow-xs ring-1 ring-emerald-400'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1">
                        <span className="font-black text-xs text-slate-900 dark:text-white">كل 30 دقيقة</span>
                      </div>
                      {syncIntervalMins === 30 ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/60 px-1 rounded">
                          موصى به للأجهزة اللوحية
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                      توفير عالي - يضاعف صمود البطارية
                    </span>
                  </button>

                  {/* 60 Minutes */}
                  <button
                    type="button"
                    onClick={() => setSyncIntervalMins(60)}
                    className={`p-3 rounded-xl border-2 text-right transition-all cursor-pointer flex flex-col justify-between ${
                      syncIntervalMins === 60
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 shadow-xs'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-xs text-slate-900 dark:text-white">كل ساعة (60 دقيقة)</span>
                      {syncIntervalMins === 60 && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                    </div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                      أقصى توفير للطاقة للأيام الشاقة
                    </span>
                  </button>

                  {/* On Action / Save Only (0 Minutes) */}
                  <button
                    type="button"
                    onClick={() => setSyncIntervalMins(0)}
                    className={`p-3 rounded-xl border-2 text-right transition-all cursor-pointer flex flex-col justify-between ${
                      syncIntervalMins === 0
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 shadow-xs'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-xs text-slate-900 dark:text-white">عند الحفظ فقط (يدوي)</span>
                      {syncIntervalMins === 0 && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                    </div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                      إيقاف الاستعلام التلقائي تماماً
                    </span>
                  </button>
                </div>

                {/* Smart Tablet Battery Integration & Auto Trigger */}
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Battery className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        قراءة شحن بطارية الجهاز الحالي:
                      </span>
                    </div>
                    {batteryLevel !== null ? (
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span
                          className={`font-black ${
                            batteryLevel > 50
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : batteryLevel > 20
                              ? 'text-amber-500'
                              : 'text-red-500'
                          }`}
                        >
                          {batteryLevel}%
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {isBatteryCharging ? '(متصل بالشاحن ⚡)' : '(يعمل على البطارية 🔋)'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        (متاح على الأجهزة اللوحية ومتصفحات Chrome/Android)
                      </span>
                    )}
                  </div>

                  {/* Battery level progress bar if available */}
                  {batteryLevel !== null && (
                    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          batteryLevel > 50
                            ? 'bg-emerald-500'
                            : batteryLevel > 20
                            ? 'bg-amber-500'
                            : 'bg-red-500 animate-pulse'
                        }`}
                        style={{ width: `${batteryLevel}%` }}
                      />
                    </div>
                  )}

                  {/* Auto-enable option on low battery */}
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={autoLowBattery}
                      onChange={(e) => setAutoLowBattery(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 dark:border-slate-700 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      تفعيل وضع توفير الطاقة تلقائياً عند انخفاض شحن بطارية التابلت إلى 20% فأقل
                    </span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-xl text-center text-xs text-slate-500 dark:text-slate-400 font-bold">
                ⚠️ تقليل تكرار المزامنة متوقف حالياً. ستعمل الأجهزة اللوحية بالمزامنة الاعتيادية المتقاربة (كل 5 دقائق).
              </div>
            )}

            {/* Active Status Summary Banner */}
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold flex items-center justify-between gap-2 flex-wrap">
              <span className="text-slate-700 dark:text-slate-200 text-[11px]">
                📌 <span className="font-black">السياسة النشطة حالياً:</span>{' '}
                {isPowerSavingMode && reduceSyncFreq
                  ? syncIntervalMins === 0
                    ? 'المزامنة عند الحفظ فقط (صفر استهلاك خلفي للبطارية 🔋)'
                    : `المزامنة التلقائية كل ${syncIntervalMins} دقيقة في وضع توفير الطاقة 🔋`
                  : 'المزامنة التلقائية كل 5 دقائق (الوضع الطبيعي ⚡)'}
              </span>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-black">
                {reduceSyncFreq ? 'مفعل للمندوبين ✅' : 'معطل ❌'}
              </span>
            </div>

            {/* Save & Broadcast Button */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleSavePowerSavingSyncConfig}
                disabled={isSavingPowerConfig}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-black flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                {isSavingPowerConfig ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جاري حفظ وتعميم الإعداد...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>حفظ وتعميم الإعداد على جميع تابلت المندوبين ☁️</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Note Section */}
      <CollapsibleCard title="إدارة ملاحظات المندوبين" icon={<Bell className="w-5 h-5 text-amber-500 dark:text-amber-300" />}>
        <div className="space-y-3">
          <input
            placeholder="كود الزبون"
            value={noteCustomerCode}
            onChange={(e) => setNoteCustomerCode(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
          />
          <textarea
            placeholder="نص الملاحظة"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            rows={3}
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
          />
          <input
            type="number"
            placeholder="مدة الصلاحية (بالساعات)"
            value={noteExpiryHours}
            onChange={(e) => setNoteExpiryHours(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
          />
          <button
            onClick={handleSaveAdminNote}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-98"
          >
            حفظ الملاحظة
          </button>
          {noteMessage && <p className="text-center text-xs text-emerald-700 dark:text-emerald-300 font-bold">{noteMessage}</p>}
        </div>
      </CollapsibleCard>


      {/* 12. Manage Delegate Accounts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 text-slate-800 dark:text-white space-y-4 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Shield className="w-4 h-4" />
          </div>
          <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-emerald-200">
            إدارة حسابات خاصة (تعديل الاسم والرمز):
          </h3>
        </div>
        
        {/* Rafat Account Card */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-4 space-y-3">
          <label className="text-xs font-black text-emerald-800 dark:text-emerald-300">التحكم بحساب مدخل البيانات (رأفت جمال):</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input 
              type="text" placeholder="اسم المستخدم" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={rafatUsernameInput} onChange={e => setRafatUsernameInput(e.target.value)}
            />
            <input 
              type="text" placeholder="كلمة المرور" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={rafatPasswordInput} onChange={e => setRafatPasswordInput(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              const u = rafatUsernameInput.trim().toLowerCase();
              const p = rafatPasswordInput.trim();
              if (!u || !p) {
                alert('يرجى ملء اسم المستخدم وكلمة المرور لمدخل البيانات');
                return;
              }

              const rafatAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'rafatdata' || d.role === 'dataEntry') || {
                username: 'rafatdata',
                password: '10001',
                delegateName: 'رأفت جمال',
                monthlyTargetKg: 0,
                isAdmin: true,
                role: 'dataEntry' as const,
              };

              const updatedRafat = { 
                ...rafatAcc, 
                username: u, 
                password: p,
                delegateName: 'رأفت جمال',
                isAdmin: true,
                role: 'dataEntry' as const,
              };
              saveDelegateAccount(updatedRafat);
              
              if (rafatAcc.username && rafatAcc.username.toLowerCase() !== u) {
                deleteDelegateAccount(rafatAcc.username);
              }

              setSaveFeedbackMessage('تم تحديث بيانات مدخل البيانات بنجاح.');
              setTimeout(() => setSaveFeedbackMessage(null), 3000);
            }}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-black shadow-md cursor-pointer transition-all"
          >
            حفظ بيانات مدخل البيانات
          </button>
          {saveFeedbackMessage && <div className="text-[10px] text-emerald-600 dark:text-emerald-400 text-center font-bold">{saveFeedbackMessage}</div>}
          
          <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 space-y-1 border border-slate-200 dark:border-slate-700 shadow-xs">
              <p>اسم المستخدم: <span className="text-slate-900 dark:text-white font-black font-mono">{rafatUsernameInput}</span></p>
              <p>كلمة المرور: <span className="text-slate-900 dark:text-white font-black font-mono">{rafatPasswordInput}</span></p>
          </div>
        </div>

        {/* Mohammed Sauce User Account Management */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800/60 rounded-xl p-4 space-y-3">
          <label className="text-xs font-black text-amber-800 dark:text-amber-300">التحكم بحساب المستخدم (mohammedsauce):</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input 
              type="text" placeholder="اسم المستخدم" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={mohammedUsernameInput} onChange={e => setMohammedUsernameInput(e.target.value)}
            />
            <input 
              type="text" placeholder="كلمة المرور" className="p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none transition-colors"
              value={mohammedPasswordInput} onChange={e => setMohammedPasswordInput(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              const u = mohammedUsernameInput.trim().toLowerCase();
              const p = mohammedPasswordInput.trim();
              if (!u || !p) {
                alert('يرجى ملء اسم المستخدم وكلمة المرور للمستخدم mohammedsauce');
                return;
              }

              const mohammedAcc = delegateAccounts.find(d => d.username?.toLowerCase() === 'mohammedsauce' || d.role === 'sauceOnly') || {
                username: 'mohammedsauce',
                password: 'm12343',
                delegateName: 'محمد الصلصات',
                monthlyTargetKg: 0,
                isAdmin: false,
                role: 'sauceOnly' as const,
              };

              const updatedMohammed = { 
                ...mohammedAcc, 
                username: u, 
                password: p,
                delegateName: 'محمد الصلصات',
                isAdmin: false,
                role: 'sauceOnly' as const,
              };
              saveDelegateAccount(updatedMohammed);
              
              if (mohammedAcc.username && mohammedAcc.username.toLowerCase() !== u) {
                deleteDelegateAccount(mohammedAcc.username);
              }

              setSaveFeedbackMessage('تم تحديث بيانات المستخدم mohammedsauce بنجاح.');
              setTimeout(() => setSaveFeedbackMessage(null), 3000);
            }}
            className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-500 active:scale-95 text-white rounded-xl text-xs font-black shadow-md cursor-pointer transition-all"
          >
            حفظ بيانات المستخدم mohammedsauce
          </button>
          <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 space-y-1 border border-slate-200 dark:border-slate-700 shadow-xs">
              <p>اسم المستخدم: <span className="text-slate-900 dark:text-white font-black font-mono">{mohammedUsernameInput}</span></p>
              <p>كلمة المرور: <span className="text-slate-900 dark:text-white font-black font-mono">{mohammedPasswordInput}</span></p>
              <p className="text-amber-600 dark:text-amber-400 font-bold">الصلاحيات: مخصص لصفحة المنتجات (الصلصات فقط) وصفحة الصلصات.</p>
          </div>
        </div>
      </div>



        {/* Assign Daily Task */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800 rounded-xl p-3.5 space-y-3">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            تعيين المهام اليومية للمندوب
          </label>
          {dailyTaskMessage && (
            <div className={`p-2.5 rounded-xl border text-xs font-bold text-center ${dailyTaskMessage.includes('بنجاح') ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'}`}>
              {dailyTaskMessage}
            </div>
          )}
          <select
            value={dailyTaskDelegate}
            onChange={(e) => setDailyTaskDelegate(e.target.value)}
            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs font-bold focus:border-emerald-500 focus:outline-none"
          >
            <option value="">-- اختر المندوب --</option>
            {delegatesList.map((del) => (
              <option key={del} value={del}>{del}</option>
            ))}
          </select>
          <textarea
            value={dailyTaskText}
            onChange={(e) => setDailyTaskText(e.target.value)}
            placeholder="اكتب المهام اليومية هنا..."
            rows={3}
            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleSaveDailyTask}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
          >
            <Check className="w-4 h-4" /> حفظ المهمة اليومية
          </button>
        </div>
      </div>

      {/* 11. Global Notifications Management */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 text-slate-800 dark:text-white space-y-3 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-emerald-200">
            11. إرسال إشعارات عامة للمندوبين:
          </h3>
        </div>
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800 rounded-xl p-3.5 space-y-3">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <Bell className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            نص الإشعار الجديد
          </label>
          {globalNotifMessage && (
            <div className={`p-2.5 rounded-xl border text-xs font-bold text-center ${globalNotifMessage.includes('بنجاح') ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'}`}>
              {globalNotifMessage}
            </div>
          )}
          <textarea
            value={globalNotifText}
            onChange={(e) => setGlobalNotifText(e.target.value)}
            placeholder="اكتب الإشعار هنا وسيظهر لجميع المندوبين..."
            rows={3}
            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-bold focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleSaveGlobalNotification}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
          >
            <Check className="w-4 h-4" /> حفظ وإرسال الإشعار
          </button>
        </div>
      </div>

      {/* 13. Manage Debts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl p-4 text-slate-800 dark:text-white space-y-3 shadow-sm dark:shadow-md transition-colors">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-emerald-200">
            13. إدارة الديون:
          </h3>
        </div>
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-emerald-800 rounded-xl p-3.5 space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                  <th className="p-2 font-bold">الاسم</th>
                  <th className="p-2 font-bold">الكود</th>
                  <th className="p-2 font-bold">المبلغ</th>
                  <th className="p-2 font-bold">تاريخ الفاتورة</th>
                  <th className="p-2 font-bold">تاريخ التسديد</th>
                  <th className="p-2 font-bold">اسم المندوب</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950">
                {debts.map((d, idx) => (
                  <tr key={d.id || `debt-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs font-medium" defaultValue={d.customerName} id={`name-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs font-mono" defaultValue={d.customerCode} id={`code-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs font-bold" defaultValue={d.amountDue} type="number" id={`amount-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs" defaultValue={d.invoiceDate} type="date" id={`invDate-${d.id}`} /></td>
                    <td className="p-2"><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 text-slate-900 dark:text-white text-xs" defaultValue={d.paymentDueDate} type="date" id={`payDate-${d.id}`} /></td>
                    <td className="p-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{d.delegateName}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <button onClick={async() => {
                            const name = (document.getElementById(`name-${d.id}`) as HTMLInputElement).value;
                            const code = (document.getElementById(`code-${d.id}`) as HTMLInputElement).value;
                            const amount = parseFloat((document.getElementById(`amount-${d.id}`) as HTMLInputElement).value);
                            const invDate = (document.getElementById(`invDate-${d.id}`) as HTMLInputElement).value;
                            const payDate = (document.getElementById(`payDate-${d.id}`) as HTMLInputElement).value;
                            await setDoc(doc(db, 'debts', d.id), { customerName: name, customerCode: code, amountDue: amount, invoiceDate: invDate, paymentDueDate: payDate, delegateName: d.delegateName });
                            alert('تم التحديث');
                        }} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95">حفظ</button>
                        <button onClick={async() => {
                            if(await showConfirm('هل أنت متأكد من الحذف؟')) await deleteDoc(doc(db, 'debts', d.id));
                        }} className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-emerald-500/80 bg-emerald-50/50 dark:bg-slate-900/50">
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg placeholder:text-slate-400" placeholder="الاسم" id="new-debt-name" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg placeholder:text-slate-400 font-mono" placeholder="الكود" id="new-debt-code" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg placeholder:text-slate-400 font-bold" placeholder="المبلغ" type="number" id="new-debt-amount" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg" type="date" id="new-debt-inv-date" /></td>
                    <td className="p-2"><input className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg" type="date" id="new-debt-pay-date" /></td>
                    <td className="p-2">
                        <select className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs p-1.5 rounded-lg mb-1 font-semibold" id="new-debt-delegate">
                            {delegatesList.map((d, idx) => <option key={`${d}-${idx}`} value={d}>{d}</option>)}
                        </select>
                        <button onClick={async () => {
                             const name = (document.getElementById('new-debt-name') as HTMLInputElement).value;
                             const code = (document.getElementById('new-debt-code') as HTMLInputElement).value;
                             const amount = parseFloat((document.getElementById('new-debt-amount') as HTMLInputElement).value);
                             const invDate = (document.getElementById('new-debt-inv-date') as HTMLInputElement).value;
                             const payDate = (document.getElementById('new-debt-pay-date') as HTMLInputElement).value;
                             const delegate = (document.getElementById('new-debt-delegate') as HTMLSelectElement).value;
                             
                             if (!code || !name || isNaN(amount) || !invDate || !payDate || !delegate) return alert('يرجى ملء كافة البيانات');
                             
                             await setDoc(doc(collection(db, 'debts')), { customerName: name, customerCode: code, amountDue: amount, invoiceDate: invDate, paymentDueDate: payDate, delegateName: delegate });
                             alert('تم الإضافة');
                             (document.getElementById('new-debt-name') as HTMLInputElement).value = '';
                             (document.getElementById('new-debt-code') as HTMLInputElement).value = '';
                             (document.getElementById('new-debt-amount') as HTMLInputElement).value = '';
                        }} className="text-white font-bold bg-emerald-600 hover:bg-emerald-500 p-1.5 rounded-lg w-full text-xs shadow-xs transition-all cursor-pointer">إضافة</button>
                    </td>
                    <td className="p-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PullToRefresh>
  );
};
