import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, query, where, getDocs, getDoc, runTransaction, increment } from 'firebase/firestore';
import { db, storage } from '../lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { isQuotaExceededError, cleanFirestoreData, setGlobalQuotaExceeded, isGlobalQuotaExceeded } from '../lib/firestoreUtils';
import localData from '../../data.json';
import * as XLSX from 'xlsx';
import { parseArabicDigits, parseArabicNumber, getInvoiceKey } from '../utils/numberUtils';
import {
  UserAccount,
  DelegateTarget,
  DelegateAccount,
  SalesEntry,
  CategoryReportItem,
  ToastNotification,
  ProductItem,
  RouteItem,
  AppTab,
  GiftPromotion,
  InventoryLogRecord,
  RestockedProductItem
} from '../types';

export const DEFAULT_CATEGORIES_LIST = [
  'الكل',
  'قشطة',
  'جبن 1',
  'جبن ويلي',
  'لبن',
  'جبن بيتزا',
  'حليب بطل',
  'حليب باكيت',
  'دوغ',
  'عصير',
  'صوصج',
  'دانيت',
  'حلويات',
  'مربى',
  'بيتزا جاهز وبركر ومقرمش',
  'خضراوات مجمدة و فنكر',
  'صلصات',
  'منتجات بروتين',
  'بروميلك',
  'سولاتا',
  'عصير بروتين',
  'منتج جديد',
  'برو شيك',
  'حليب دنو',
  'ماء اطفال',
];

export const DEFAULT_DELEGATE_ACCOUNTS_ENTITIES: DelegateAccount[] = [
  { username: 'YASIR', password: '377377', delegateName: 'الأدمن', monthlyTargetKg: 0, isAdmin: true },
  { username: 'najikala', password: '1111', delegateName: 'ناجي خلف', delegateCode: '60037899', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'kldkala', password: '2222', delegateName: 'خلدون جمال', delegateCode: '60032667', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'mohkala', password: '2222', delegateName: 'محمد جاسم', delegateCode: '60037329', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'bkrkala', password: '3333', delegateName: 'بكر بدران', delegateCode: '60042244', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'fslkala', password: '4444', delegateName: 'فيصل فؤاد', delegateCode: '60042245', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'sbhkala', password: '6666', delegateName: 'صباح فرحان', delegateCode: '60041445', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'del7', password: '1234', delegateName: 'مندوب عام 1', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'del8', password: '1234', delegateName: 'مندوب عام 2', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'rafatdata', password: '10001', delegateName: 'رأفت جمال', monthlyTargetKg: 0, isAdmin: true, role: 'dataEntry' },
  { username: 'mohammedsauce', password: 'm12343', delegateName: 'محمد الصلصات', monthlyTargetKg: 0, isAdmin: false, role: 'sauceOnly' },
];

const DELEGATE_NAME_MAP: Record<string, string> = {
  'مندوب 1': 'ناجي خلف',
  'مندوب 2': 'خلدون جمال',
  'مندوب 3': 'محمد جاسم',
  'مندوب 4': 'بكر بدران',
  'مندوب 5': 'فيصل فؤاد',
  'مندوب 6': 'صباح فرحان',
  'مندوب 7': 'مندوب عام 1',
  'مندوب 8': 'مندوب عام 2',
};

const mapDelegateName = (name: string): string => {
  return DELEGATE_NAME_MAP[name] || name;
};

export const isExcludedReportDelegate = (name?: string | null): boolean => {
  if (!name) return false;
  const n = name.trim();
  return (
    n === 'مندوب عام 1' ||
    n === 'مندوب عام 2' ||
    n === 'مندوب 7' ||
    n === 'مندوب 8' ||
    n.toLowerCase() === 'del7' ||
    n.toLowerCase() === 'del8'
  );
};

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

export interface DelegateLockStatus {
  isLocked: boolean;
  daysRemaining: number;
  setDateStr: string;
  unlockDateStr: string;
  setTimestamp: number;
}

interface SalesContextType {
  currentUser: UserAccount;
  selectedDate: string;
  selectedDelegate: string;
  loginTimestamp: number;
  availableAccounts: UserAccount[];
  delegatesList: string[];
  delegateAccounts: DelegateAccount[];
  delegateTargets: DelegateTarget[];
  salesEntries: SalesEntry[];
  allSalesEntries: SalesEntry[];
  rawSavedEntries: SalesEntry[];
  savedEntries: SalesEntry[];
  categoryReports: CategoryReportItem[];
  userMessage: string | null;
  targetLockMap: Record<string, number>;
  isDarkMode: boolean;
  isLoggedIn: boolean;
  isOnline: boolean;
  pendingSyncCount: number;
  syncFailureAlert: boolean;
  isPowerSavingMode: boolean;
  isFirestoreQuotaExceeded: boolean;
  toggleDarkMode: () => void;
  togglePowerSavingMode: () => void;
  setUserMessage: (msg: string | null) => void;
  loginAccount: (acc: UserAccount) => void;
  loginWithCredentials: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  setSelectedDelegate: (delName: string) => void;
  setSelectedDate: (dateStr: string) => void;
  saveSalesEntries: (entries: Omit<SalesEntry, 'id' | 'timestamp'>[]) => void;
  deleteSalesEntry: (id: string) => void;
  updateSalesEntry: (id: string, updatedData: Partial<SalesEntry>) => void;
  updateDelegateTarget: (delegateName: string, categoryName: string, targetKg: number) => void;
  batchUpdateDelegateTargets: (
    delegateName: string,
    targetsList: { categoryName: string; targetKg: number }[],
    monthlyTargetKg?: number,
    forceUnlock?: boolean
  ) => boolean;
  getDelegateLockStatus: (delegateName: string) => DelegateLockStatus;
  unlockDelegateTargetManually: (delegateName: string) => void;
  saveDelegateAccount: (acc: DelegateAccount) => void;
  updateDelegateIdentity: (oldName: string, newName: string, oldUsername: string, newUsername: string, newPassword: string) => Promise<void>;
  resetDelegateAccount: (username: string) => Promise<void>;
  deleteDelegateAccount: (username: string) => void;
  addDelegateAccount: (acc: DelegateAccount) => void;
  syncData: () => Promise<void>;
  toasts: ToastNotification[];
  addToast: (toast: Omit<ToastNotification, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;
  checkAndTriggerMilestoneToasts: (
    delegateName: string,
    prevWeightKg: number,
    newWeightKg: number,
    dailyTargetKg: number
  ) => void;
  exportBackupData: () => void;
  restoreBackupData: (backupObj: any) => boolean;
  fetchUnifiedDataFromFirestore: () => Promise<void>;
  isDataRefreshing: boolean;
  isNetworkDelayed: boolean;
  productsList: ProductItem[];
  inventoryStockByCode: Record<string, number>;
  importProductsFromExcel: (file: File) => Promise<void>;
  importRoutesFromExcel: (file: File) => Promise<void>;
  updateProduct: (id: string, updatedData: Partial<ProductItem>) => void;
  uploadProductImage: (id: string, file: File) => Promise<string | null>;
  addProduct: () => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  deleteAllProducts: () => Promise<void>;
  giftPromotions: GiftPromotion[];
  addGiftPromotion: (gift: Omit<GiftPromotion, 'id' | 'createdAt'>) => Promise<void>;
  updateGiftPromotion: (id: string, updatedData: Partial<GiftPromotion>) => Promise<void>;
  deleteGiftPromotion: (id: string) => Promise<void>;
  prefilledEntryData: { customerCode: string, customerName: string, customerAddress: string, customerType?: 'مفرد' | 'جملة', customerInvoiceType?: 'مفرد' | 'جملة', lastInvoiceToday?: Partial<SalesEntry>, isEditing?: boolean } | null;
  showQuickAdd: boolean;
  setPrefilledEntryData: (data: { customerCode: string, customerName: string, customerAddress: string, customerType?: 'مفرد' | 'جملة', customerInvoiceType?: 'مفرد' | 'جملة', lastInvoiceToday?: Partial<SalesEntry>, isEditing?: boolean } | null) => void;
  setShowQuickAdd: (show: boolean) => void;
  routes: RouteItem[];
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  countUniqueInvoices: (date: string, delegateName: string, priceMode: 'retail' | 'wholesale') => number;
  inventoryLogs: InventoryLogRecord[];
  deleteInventoryLog: (logId: string) => Promise<void>;
  resetInventory: () => Promise<void>;
  processOrder: (orderEntries: Omit<SalesEntry, 'id' | 'timestamp'>[]) => Promise<void>;
  todaySalesByProductName: Record<string, number>;
  getProductLiveStock: (prod: ProductItem) => { totalUnits: number, cartons: number, pieces: number, unitsPerCarton: number, soldToday: number };
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

export const SalesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const todayDateString = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState<string>(todayDateString);

  const [isPowerSavingMode, setIsPowerSavingMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('is_data_saver_mode') === 'true';
    } catch {
      return false;
    }
  });

  const [currentUser, setCurrentUser] = useState<UserAccount>(() => {
    const saved = localStorage.getItem('app_current_user');

    if (saved) {
      try {
        const parsed = JSON.parse(saved);

        return {
          ...parsed,
          name: mapDelegateName(parsed.name),
        };
      } catch (e) {
        console.error('Error restoring current user:', e);
      }
    }

    return {
      name: 'ناجي خلف',
      roleName: 'مندوب مبيعات',
      isAdmin: false,
      username: 'najikala',
      monthlyTargetKg: 1500,
      delegateCode: '60037899',
    };
  });

  const [selectedDelegate, setSelectedDelegate] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('app_current_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.isAdmin || parsed.role === 'sauceOnly' || parsed.username?.toLowerCase() === 'mohammedsauce' || parsed.name === 'محمد الصلصات')) {
          return 'الكل';
        } else if (parsed && parsed.name) {
          return mapDelegateName(parsed.name);
        }
      }
    } catch (e) {}
    return 'الكل';
  });
  const [loginTimestamp, setLoginTimestamp] = useState<number>(Date.now());

  const initialLocalAccounts = Array.isArray((localData as any)?.delegate_accounts)
    ? ((localData as any).delegate_accounts as DelegateAccount[])
    : [];

  const [delegateAccounts, setDelegateAccounts] = useState<DelegateAccount[]>(
    initialLocalAccounts.length > 0
      ? initialLocalAccounts
      : DEFAULT_DELEGATE_ACCOUNTS_ENTITIES
  );

  const [delegateTargets, setDelegateTargets] = useState<DelegateTarget[]>(() => {
    try {
      const cached = localStorage.getItem('cache_delegate_targets');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const [salesEntries, setSalesEntries] = useState<SalesEntry[]>(() => {
    try {
      const cached = localStorage.getItem('cache_sales_entries');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const [allSalesEntries, setAllSalesEntries] = useState<SalesEntry[]>(() => {
    try {
      const cached = localStorage.getItem('cache_all_sales_entries');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const [targetLockMap, setTargetLockMap] = useState<Record<string, number>>(() => {
    try {
      const cached = localStorage.getItem('cache_target_locks');
      if (cached) return JSON.parse(cached);
    } catch {}
    return {};
  });

  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded] = useState<boolean>(() => {
    return isGlobalQuotaExceeded();
  });

  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const addToast = (
    toastData: Omit<ToastNotification, 'id' | 'timestamp'>
  ) => {
    const newToast: ToastNotification = {
      ...toastData,
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };

    setToasts((prev) => [newToast, ...prev].slice(0, 5));
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleFirestoreError = (err: any, contextName = '') => {
    if (!err) return;
    if (isQuotaExceededError(err)) {
      setGlobalQuotaExceeded();
      setIsFirestoreQuotaExceeded(true);
      console.warn(`Firestore quota reached in ${contextName}. Operating on local offline cache.`);
      try {
        const lastShown = Number(sessionStorage.getItem('quota_warning_shown') || '0');
        if (Date.now() - lastShown > 300000) {
          sessionStorage.setItem('quota_warning_shown', String(Date.now()));
          addToast({
            title: 'حصة قاعدة البيانات اليومية (Firestore Quota)',
            message: 'تم بلوغ الحد الأقصى للحصة المجانية اليومية لـ Firestore. يستمر التطبيق بالعمل بسلاسة من الذاكرة المحلية والنسخ الاحتياطية (Cache Mode).',
            type: 'info',
          });
        }
      } catch {}
    } else {
      console.error(`Firestore error in ${contextName}:`, err);
    }
  };

  const [isDataRefreshing, setIsDataRefreshing] = useState<boolean>(false);
  const [isNetworkDelayed, setIsNetworkDelayed] = useState<boolean>(false);
  const [prefilledEntryData, setPrefilledEntryData] = useState<{ customerCode: string, customerName: string, customerAddress: string, customerType?: 'مفرد' | 'جملة', customerInvoiceType?: 'مفرد' | 'جملة', lastInvoiceToday?: Partial<SalesEntry>, isEditing?: boolean } | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [routes, setRoutes] = useState<RouteItem[]>(() => {
    try {
      const cached = localStorage.getItem('cache_routes');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    try {
      const savedUser = localStorage.getItem('app_current_user');
      if (savedUser) {
        const u = JSON.parse(savedUser);
        if (u?.username?.toLowerCase() === 'mohammedsauce' || u?.role === 'sauceOnly') {
          return 'item_tracking';
        }
      }
    } catch {
      // fallback
    }
    return 'reports';
  });

  useEffect(() => {
    if (isPowerSavingMode || isFirestoreQuotaExceeded) return;
    const q = query(collection(db, 'routes'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const loaded: RouteItem[] = [];
        snap.forEach(d => loaded.push({ id: d.id, ...d.data() } as RouteItem));
        setRoutes(loaded);
        try {
          localStorage.setItem('cache_routes', JSON.stringify(loaded));
        } catch {}
      },
      (err) => {
        handleFirestoreError(err, 'routes');
      }
    );
    return () => unsub();
  }, [isPowerSavingMode]);

  useEffect(() => {
    // Seed and guarantee rafatdata exists in Firestore
    const rafatSeed: DelegateAccount = {
      username: 'rafatdata',
      password: '10001',
      delegateName: 'رأفت جمال',
      monthlyTargetKg: 0,
      isAdmin: true,
      role: 'dataEntry',
    };
    setDoc(doc(db, 'delegate_accounts', 'rafatdata'), rafatSeed, { merge: true })
      .catch((err) => console.error('Failed to seed rafatdata to Firestore:', err));

    // Seed and guarantee mohammedsauce exists in Firestore as sauceOnly view account
    const mohammedSeed: DelegateAccount = {
      username: 'mohammedsauce',
      password: 'm12343',
      delegateName: 'محمد الصلصات',
      monthlyTargetKg: 0,
      isAdmin: false,
      role: 'sauceOnly',
    };
    setDoc(doc(db, 'delegate_accounts', 'mohammedsauce'), mohammedSeed, { merge: true })
      .catch((err) => console.error('Failed to seed mohammedsauce to Firestore:', err));
  }, []);

  const DEFAULT_PRODUCTS_LIST: ProductItem[] = [
    { id: 'p1', productName: 'قشطة عربية فاخرة', unitsPerCarton: 12, totalPieces: 120, totalUnits: 120, totalCartons: 10, cartonQuantity: 12, categoryName: 'قشطة', productCode: 'QSH-001', pieceWeightKg: 0.200 },
  ];

  const [productsList, setProductsList] = useState<ProductItem[]>(() => {
    try {
      const saved = localStorage.getItem('app_products_catalog');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_PRODUCTS_LIST;
  });

  useEffect(() => {
    if (isFirestoreQuotaExceeded) return;
    const unsub = onSnapshot(
      collection(db, 'products_catalog'),
      (snapshot) => {
        const products: ProductItem[] = [];
        if (!snapshot.empty) {
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as any;
            if (data) {
              const unitsPerCarton = Number(data.unitsPerCarton || data.cartonQuantity) || 12;
              const totalUnits = Number(
                data.totalUnits !== undefined 
                  ? data.totalUnits 
                  : (data.totalPieces !== undefined 
                      ? data.totalPieces 
                      : ((Number(data.totalCartons ?? data.stockCartons ?? 0)) * unitsPerCarton))
              );
              const totalCartons = data.totalCartons !== undefined 
                ? Number(data.totalCartons) 
                : Math.floor(totalUnits / unitsPerCarton);

              products.push({
                ...data,
                id: docSnap.id,
                unitsPerCarton,
                cartonQuantity: unitsPerCarton,
                totalPieces: totalUnits,
                totalUnits,
                totalCartons,
                stockCartons: totalCartons,
              });
            }
          });
        } else {
          // If empty, fall back to default
          DEFAULT_PRODUCTS_LIST.forEach(p => products.push(p));
        }
        
        setProductsList(products);
        try {
          localStorage.setItem('app_products_catalog', JSON.stringify(products));
        } catch {}
      },
      (err) => {
        handleFirestoreError(err, 'products_catalog');
      }
    );
    return () => unsub();
  }, [isFirestoreQuotaExceeded]);

  const [inventoryLogs, setInventoryLogs] = useState<InventoryLogRecord[]>(() => {
    try {
      const saved = localStorage.getItem('app_inventory_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (isPowerSavingMode || isFirestoreQuotaExceeded) return;
    const unsub = onSnapshot(
      collection(db, 'inventory_notifications'),
      (snapshot) => {
        const logs: InventoryLogRecord[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          if (d) {
            logs.push({
              id: docSnap.id,
              timestamp: d.timestamp || 0,
              dateFormatted: d.dateFormatted || '',
              uploaderName: d.uploaderName || 'مسؤول المخزن',
              totalProductsCount: d.totalProductsCount || 0,
              restockedCount: d.restockedCount || 0,
              restockedProducts: d.restockedProducts || [],
            });
          }
        });
        logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setInventoryLogs(logs);
        try {
          localStorage.setItem('app_inventory_logs', JSON.stringify(logs));
        } catch {}
      },
      (err) => {
        handleFirestoreError(err, 'inventory_notifications');
      }
    );
    return () => unsub();
  }, [isPowerSavingMode]);

  const [inventoryStockByCode, setInventoryStockByCode] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('inventory_stock_by_code');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  useEffect(() => {
    if (isPowerSavingMode || isFirestoreQuotaExceeded) return;
    const unsub = onSnapshot(
      doc(db, 'app_settings', 'inventory_stock'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data && data.stockByCode) {
            setInventoryStockByCode(data.stockByCode);
            try {
              localStorage.setItem('inventory_stock_by_code', JSON.stringify(data.stockByCode));
            } catch {}
          }
        }
      },
      (err) => {
        console.error('Error fetching inventory_stock setting:', err);
      }
    );
    return () => unsub();
  }, [isPowerSavingMode, isFirestoreQuotaExceeded]);

  const todaySalesByProductName = useMemo(() => {
    const map: Record<string, number> = {};
    const today = new Date().toISOString().split('T')[0];
    
    // Use allSalesEntries which is already synced with Firestore
    allSalesEntries.forEach(entry => {
      if (entry.dateString === today && entry.status !== 'cancelled') {
        const name = (entry.productName || '').trim().toLowerCase();
        if (name) {
          map[name] = (map[name] || 0) + (Number(entry.quantity) || 0);
        }
      }
    });
    return map;
  }, [allSalesEntries]);

  const getProductLiveStock = (prod: ProductItem) => {
    const name = (prod.productName || '').trim().toLowerCase();
    const soldToday = todaySalesByProductName[name] || 0;
    const unitsPerCarton = Number(prod.unitsPerCarton || prod.cartonQuantity) || 12;
    
    // إجمالي المخزون المتاح (baseline units before sales)
    const baselineUnits = Number(
      prod.totalUnits !== undefined 
        ? prod.totalUnits 
        : (prod.totalPieces !== undefined 
            ? prod.totalPieces 
            : ((Number(prod.totalCartons ?? prod.stockCartons ?? 0)) * unitsPerCarton))
    );

    // المتبقي في المخزن = (إجمالي المخزون - المبيعات المسجلة اليوم)
    const liveTotalUnits = Math.max(0, baselineUnits - soldToday);
    const cartons = Math.floor(liveTotalUnits / unitsPerCarton);
    const pieces = liveTotalUnits % unitsPerCarton;

    return {
      totalUnits: liveTotalUnits,
      cartons,
      pieces,
      unitsPerCarton,
      soldToday
    };
  };

  const deleteInventoryLog = async (logId: string) => {
    try {
      await deleteDoc(doc(db, 'inventory_notifications', logId));
      setUserMessage('تم حذف عملية الجرد بنجاح 🗑️');
    } catch (err) {
      console.error('Error deleting inventory log:', err);
      setUserMessage('حدث خطأ أثناء حذف العملية');
    }
  };

  const importProductsFromExcel = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

      const existingImages = new globalThis.Map<string, string>();
      const existingProductsByCode = new globalThis.Map<string, ProductItem>();
      const existingProductsByName = new globalThis.Map<string, ProductItem>();
      productsList.forEach(p => {
        if (p.productCode) {
          const codeKey = String(p.productCode).trim().toLowerCase();
          existingProductsByCode.set(codeKey, p);
          if (p.imageUrl) existingImages.set(String(p.productCode).trim(), p.imageUrl);
        }
        if (p.productName) {
          const nameKey = String(p.productName).trim().toLowerCase();
          existingProductsByName.set(nameKey, p);
          if (p.imageUrl && !existingImages.has(nameKey)) existingImages.set(nameKey, p.imageUrl);
        }
      });

      const parsedProducts: ProductItem[] = jsonData.map((row, index) => {
        const productName = String(
          row['اسم المنتج'] ??
          row['المنتج'] ??
          row['اسم'] ??
          row['اسم المادة'] ??
          row['المادة'] ??
          row['Product Name'] ??
          row['Product'] ??
          `منتج ${index + 1}`
        ).trim();

        const productCodeRaw = 
          row['كود المنتج'] ??
          row['كود'] ??
          row['الكود'] ??
          row['كود الصنف'] ??
          row['رمز المنتج'] ??
          row['رمز'] ??
          row['الرمز'] ??
          row['كود المادة'] ??
          row['رمز المادة'] ??
          row['Code'] ??
          row['Product Code'] ??
          row['ProductCode'] ??
          row['Item Code'] ??
          row['ItemCode'] ??
          `PRD-${100 + index}`;
        const productCode = String(productCodeRaw).trim();

        const cartonQuantityVal = 
          row['عدد بالكارتون'] ??
          row['عدد في الكارتون'] ??
          row['عدد الكارتون'] ??
          row['العدد بالكرتون'] ??
          row['العدد بالكارتون'] ??
          row['Carton Qty'] ??
          row['Qty'] ??
          12;
        const unitsPerCarton = parseArabicNumber(cartonQuantityVal) || 12;

        const categoryName = String(
          row['صنف المنتج'] ??
          row['الصنف'] ??
          row['الفئة'] ??
          row['Category'] ??
          'قشطة'
        ).trim();

        const pieceWeightKg = parseArabicNumber(
          row['وزن القطعة الواحدة'] ??
          row['وزن القطعة'] ??
          row['الوزن'] ??
          row['Piece Weight'] ??
          row['Weight'] ??
          0.2
        ) || 0.2;

        const retailPrice = parseArabicNumber(
          row['سعر القطعة مفرد'] ??
          row['سعر  القطعة مفرد'] ??
          row['سعر المفرد'] ??
          row['Retail Price'] ??
          0
        );

        const wholesalePrice = parseArabicNumber(
          row['سعر القطعة جملة'] ??
          row['سعر الجملة'] ??
          row['Wholesale Price'] ??
          0
        );

        // Matching all possible headers for current store cartons
        const stockCartonsVal = 
          row['المخزن الحالي (كارتون)'] ??
          row['المخزن الحالي(كارتون)'] ??
          row['المخزن الحالي (كرتون)'] ??
          row['المخزن الحالي'] ??
          row['عدد الكارتون المتوفر بالمخزن'] ??
          row['عدد كارتون بالمخزن'] ??
          row['كارتون بالمخزن'] ??
          row['الكمية (كارتون)'] ??
          row['الكمية بالكارتون'] ??
          row['الكمية (كرتون)'] ??
          row['الكمية بالكرتون'] ??
          row['رصيد المخزن'] ??
          row['الرصيد (كارتون)'] ??
          row['الرصيد'] ??
          row['المخزن'] ??
          row['كارتون'] ??
          row['كرتون'] ??
          row['الكمية'] ??
          row['كمية'] ??
          row['Stock'] ??
          row['Cartons'] ??
          row['Carton'] ??
          row['Current Stock'] ??
          row['Qty'] ??
          row['Quantity'] ??
          0;
        const stockCartonsNum = parseArabicNumber(stockCartonsVal);

        let imageUrl = String(row['صورة'] ?? row['صورة المنتج'] ?? row['Image'] ?? '').trim();
        if (!imageUrl) {
          if (existingImages.has(productCode)) {
            imageUrl = existingImages.get(productCode)!;
          } else if (existingImages.has(productName.toLowerCase())) {
            imageUrl = existingImages.get(productName.toLowerCase())!;
          }
        }

        const totalPieces = stockCartonsNum * unitsPerCarton;
        const isAvailableBool = row['isAvailable'] !== false;
        const isVisibleBool = isAvailableBool && totalPieces >= (6 * unitsPerCarton);

        // If existing product found by code or name, reuse its id to maintain consistency
        const matchedExisting = (productCode ? existingProductsByCode.get(productCode.toLowerCase()) : undefined) ||
          existingProductsByName.get(productName.toLowerCase());
        const prodId = matchedExisting ? matchedExisting.id : `prod_${Date.now()}_${index}`;

        return {
          id: prodId,
          productName,
          unitsPerCarton,
          cartonQuantity: unitsPerCarton,
          totalPieces,
          totalUnits: totalPieces,
          totalCartons: stockCartonsNum,
          initialStockCartons: stockCartonsNum,
          stockCartons: stockCartonsNum,
          categoryName,
          productCode,
          pieceWeightKg,
          retailPrice,
          wholesalePrice,
          imageUrl,
          isAvailable: isAvailableBool,
          isVisible: isVisibleBool,
        };
      });

      if (parsedProducts.length > 0) {
        // Compare previous products state with new inventory to detect newly arrived / restocked products
        const prevProductsByCode = new Map<string, ProductItem>();
        const prevProductsByName = new Map<string, ProductItem>();
        productsList.forEach(p => {
          if (p.productCode) prevProductsByCode.set(String(p.productCode).trim().toLowerCase(), p);
          if (p.productName) prevProductsByName.set(String(p.productName).trim().toLowerCase(), p);
        });

        const restockedList: RestockedProductItem[] = [];

        parsedProducts.forEach(newProd => {
          const codeKey = (newProd.productCode || '').trim().toLowerCase();
          const nameKey = (newProd.productName || '').trim().toLowerCase();
          const prevProd = prevProductsByCode.get(codeKey) || prevProductsByName.get(nameKey);

          const newTotalPieces = newProd.totalPieces;
          const unitsPerCarton = newProd.unitsPerCarton;
          
          // شرط الظهور للمندوبين: متاح و 3 كارتون فأكثر
          // أي منتج يتم تنفيذ شرط حجب المندوبين عليه (< 3 كارتون أو غير متاح) لا يتم عرضه في إشعارات المخزن
          const meetsDelegateCondition = newProd.isAvailable !== false && newTotalPieces >= (3 * unitsPerCarton) && newProd.isVisible !== false;
          if (!meetsDelegateCondition) {
            return;
          }

          if (prevProd) {
            const prevTotalPieces = prevProd.totalPieces || 0;
            const prevMetDelegate = prevProd.isAvailable !== false && prevTotalPieces >= (3 * (prevProd.unitsPerCarton || 12)) && prevProd.isVisible !== false;

            // كان محجوباً أو غير متاح للمندوبين، والآن أصبح ظاهراً لهم بوصول كمية كافية
            if (!prevMetDelegate) {
              restockedList.push({
                productName: newProd.productName,
                productCode: newProd.productCode,
                categoryName: newProd.categoryName,
                stockCartons: Math.floor(newTotalPieces / unitsPerCarton),
                previousStock: Math.floor(prevTotalPieces / (prevProd.unitsPerCarton || 12)),
                addedCartons: Math.floor((newTotalPieces - prevTotalPieces) / unitsPerCarton),
                imageUrl: newProd.imageUrl || '',
                pieceWeightKg: newProd.pieceWeightKg,
                isAvailable: newProd.isAvailable,
                isVisible: newProd.isVisible,
              });
            }
          } else {
            // منتج جديد مضاف للمخزن يحقق شرط الظهور للمندوبين
            const addedStockCartons = Math.floor(newTotalPieces / unitsPerCarton);
            restockedList.push({
              productName: newProd.productName,
              productCode: newProd.productCode,
              categoryName: newProd.categoryName,
              stockCartons: addedStockCartons,
              previousStock: 0,
              addedCartons: addedStockCartons,
              imageUrl: newProd.imageUrl || '',
              pieceWeightKg: newProd.pieceWeightKg,
              isAvailable: newProd.isAvailable,
              isVisible: newProd.isVisible
            });
          }
        });

        // Generate formatted timestamp with English numerals
        const now = new Date();
        const dateFormatted = now.toLocaleDateString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }) + ' ' + now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });

        const logId = `inv_log_${Date.now()}`;
        const newInventoryLog: InventoryLogRecord = {
          id: logId,
          timestamp: Date.now(),
          dateFormatted,
          uploaderName: (currentUser?.isAdmin ? (selectedDelegate && selectedDelegate !== 'الكل' ? selectedDelegate : 'الأدمن') : currentUser?.name) || 'مسؤول المخزن',
          totalProductsCount: parsedProducts.length,
          restockedCount: restockedList.length,
          restockedProducts: restockedList,
        };

        // Save inventory notification to Firestore
        try {
          await setDoc(doc(db, 'inventory_notifications', logId), newInventoryLog);
        } catch (err) {
          console.error('Error saving inventory notification log to Firestore:', err);
        }

        // Update local state immediately for fast feedback
        setProductsList(parsedProducts);
        
        // Build inventoryStockByCode map
        const newStockByCode: Record<string, number> = {};
        parsedProducts.forEach(p => {
          const code = String(p.productCode || '').trim();
          const name = String(p.productName || '').trim();
          const cartons = Number(p.initialStockCartons ?? p.stockCartons ?? 0);
          if (code) {
            newStockByCode[code] = cartons;
            newStockByCode[code.toLowerCase()] = cartons;
          }
          if (name) {
            newStockByCode[name] = cartons;
          }
        });
        setInventoryStockByCode(prev => ({ ...prev, ...newStockByCode }));

        try {
          localStorage.setItem('app_products_catalog', JSON.stringify(parsedProducts));
          localStorage.setItem('inventory_stock_by_code', JSON.stringify(newStockByCode));
          const todayKey = new Date().toISOString().split('T')[0];
          const fixedStockMap: Record<string, number> = {};
          parsedProducts.forEach(p => {
            fixedStockMap[p.id] = (p as any).initialStockCartons || p.stockCartons || 0;
            if (p.productCode) fixedStockMap[p.productCode] = (p as any).initialStockCartons || p.stockCartons || 0;
          });
          localStorage.setItem(`fixed_inventory_${todayKey}`, JSON.stringify(fixedStockMap));

          await setDoc(doc(db, 'app_settings', 'inventory_stock'), {
            stockByCode: newStockByCode,
            updatedAt: Date.now(),
            updatedAtFormatted: dateFormatted
          }, { merge: true });
        } catch (err) {
          console.error('Error saving inventory settings to Firestore:', err);
        }
        
        // Save to Firestore using chunked batches to handle >500 limits, and clear old products first
        try {
          // 1. Delete old products
          const oldProductsSnap = await getDocs(collection(db, 'products_catalog'));
          if (!oldProductsSnap.empty) {
            let deleteBatch = writeBatch(db);
            let deleteCount = 0;
            for (const oldDoc of oldProductsSnap.docs) {
              deleteBatch.delete(oldDoc.ref);
              deleteCount++;
              if (deleteCount === 450) {
                await deleteBatch.commit();
                deleteBatch = writeBatch(db);
                deleteCount = 0;
              }
            }
            if (deleteCount > 0) {
              await deleteBatch.commit();
            }
          }

          // 2. Add new products in chunks
          let insertBatch = writeBatch(db);
          let insertCount = 0;
          for (const prod of parsedProducts) {
            const docRef = doc(db, 'products_catalog', prod.id);
            insertBatch.set(docRef, cleanFirestoreData(prod));
            insertCount++;
            if (insertCount === 450) {
              await insertBatch.commit();
              insertBatch = writeBatch(db);
              insertCount = 0;
            }
          }
          if (insertCount > 0) {
            await insertBatch.commit();
          }
        } catch (err) {
          console.error('Error saving imported products to Firestore:', err);
        }

        if (restockedList.length > 0) {
          setUserMessage(`تم استيراد ${parsedProducts.length} منتج بنجاح، وتوثيق وصول (${restockedList.length}) منتجات متوفرة جديدة في إشعارات المخزن 📦🌟`);
        } else {
          setUserMessage(`تم استيراد وتحديث ${parsedProducts.length} منتج بنجاح من ملف الإكسل 📊✅`);
        }
      } else {
        setUserMessage('لم يتم العثور على بيانات صالحة في ملف الإكسل المرفق.');
      }
    } catch (error) {
      console.error('Error importing excel:', error);
      setUserMessage('حدث خطأ أثناء قراءة ملف الإكسل. تأكد من صحة الملف.');
    }
  };

  const importRoutesFromExcel = async (file: File) => {
    // ... need to define this, maybe just empty function for now to fix the crash
    console.log("Importing routes not fully implemented yet");
  };

  const updateProduct = async (id: string, updatedData: Partial<ProductItem>) => {
    const dataToUpdate = { ...updatedData };
    if (dataToUpdate.imageUrl !== undefined) {
      dataToUpdate.imageUpdatedAt = Date.now();
    }
    const cleaned = cleanFirestoreData(dataToUpdate);

    // Update local state immediately
    setProductsList(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...cleaned } : p);
      try {
        localStorage.setItem('app_products_catalog', JSON.stringify(next));
      } catch {}
      return next;
    });

    // Save to Firestore
    try {
      const docRef = doc(db, 'products_catalog', id);
      await setDoc(docRef, cleaned, { merge: true });
    } catch (err) {
      console.error('Error updating product in Firestore:', err);
    }
    
    setUserMessage('تم تحديث بيانات المنتج بنجاح ✅');
  };

  const uploadProductImage = async (id: string, file: File): Promise<string | null> => {
    try {
      const storageRef = ref(storage, `products/${id}/${Date.now()}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      await updateProduct(id, { imageUrl: downloadURL });
      return downloadURL;
    } catch (err) {
      console.error('Error uploading image to Storage:', err);
      setUserMessage('حدث خطأ أثناء رفع الصورة');
      return null;
    }
  };

  const addProduct = async () => {
    const newProduct: ProductItem = {
      id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      productName: 'منتج جديد',
      unitsPerCarton: 12,
      totalPieces: 0,
      categoryName: 'عام',
      productCode: `PRD-${Date.now().toString().slice(-4)}`,
      pieceWeightKg: 1,
      retailPrice: 0,
      wholesalePrice: 0,
      imageUrl: '',
      isAvailable: true,
      isVisible: true,
      isGift: false,
    };
    
    setProductsList(prev => {
      const next = [newProduct, ...prev];
      try {
        localStorage.setItem('app_products_catalog', JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      const docRef = doc(db, 'products_catalog', newProduct.id);
      await setDoc(docRef, cleanFirestoreData(newProduct));
    } catch (err) {
      console.error('Error adding product to Firestore:', err);
    }
    
    setUserMessage('تمت إضافة منتج جديد فارغ، يمكنك تعديله الآن ✅');
  };

  
  const deleteProduct = async (id: string) => {
    setProductsList(prev => {
      const next = prev.filter(p => p.id !== id);
      try {
        localStorage.setItem('app_products_catalog', JSON.stringify(next));
      } catch {}
      return next;
    });
    try {
      const docRef = doc(db, 'products_catalog', id);
      await deleteDoc(docRef);
    } catch (err) {
      console.error('Error deleting product:', err);
    }
    setUserMessage('تم حذف المنتج بنجاح 🗑️✅');
  };

  const resetInventory = async () => {
    try {
      setProductsList(prev => {
        const next = prev.map(p => ({
          ...p,
          stockCartons: 0,
          isVisible: false,
          isAvailable: false
        }));
        try {
          localStorage.setItem('app_products_catalog', JSON.stringify(next));
        } catch {}
        return next;
      });

      const snapshot = await getDocs(collection(db, 'products_catalog'));
      if (!snapshot.empty) {
        let batch = writeBatch(db);
        let count = 0;
        for (const d of snapshot.docs) {
          batch.update(d.ref, { stockCartons: 0, isVisible: false, isAvailable: false });
          count++;
          if (count === 450) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          await batch.commit();
        }
      }
      setUserMessage('تم تصفير كميات المخزون بالكامل بنجاح 🔄🗑️');
    } catch (err) {
      console.error('Error resetting inventory:', err);
      setUserMessage('حدث خطأ أثناء تصفير المخزون');
    }
  };

  const processOrder = async (orderEntries: Omit<SalesEntry, 'id' | 'timestamp'>[]) => {
    if (orderEntries.length === 0) return;

    // 1. Group requested quantities by product to handle duplicate rows in the order
    const requestedUnitsByProduct = new Map<string, { product: ProductItem; requestedUnits: number }>();

    for (const entry of orderEntries) {
      const product = productsList.find(
        p => p.productName?.trim().toLowerCase() === entry.productName?.trim().toLowerCase()
      );
      if (product) {
        const unitsPerCarton = Number(product.unitsPerCarton || product.cartonQuantity) || 12;
        const requestedUnits = entry.entryUnit === 'carton' 
          ? Number(entry.enteredQuantity || 0) * unitsPerCarton 
          : Number(entry.quantity || entry.enteredQuantity || 0);

        const current = requestedUnitsByProduct.get(product.id) || { product, requestedUnits: 0 };
        current.requestedUnits += requestedUnits;
        requestedUnitsByProduct.set(product.id, current);
      }
    }

    // Pre-validate locally against current productsList
    for (const [, item] of requestedUnitsByProduct) {
      const currentPieces = Number(item.product.totalUnits ?? item.product.totalPieces ?? 0);
      if (currentPieces < item.requestedUnits) {
        const unitsPerCarton = Number(item.product.unitsPerCarton || item.product.cartonQuantity) || 12;
        const availCartons = Math.floor(currentPieces / unitsPerCarton);
        const availPieces = currentPieces % unitsPerCarton;
        const msg = `الكمية المطلوبة تتجاوز المخزون المتوفر للمنتج (${item.product.productName}). المتاح: ${availCartons} كارتون و ${availPieces} قطعة.`;
        setUserMessage(msg);
        addToast?.({
          type: 'reminder',
          title: 'الكمية المطلوبة تتجاوز المخزون المتوفر ⚠️',
          message: msg
        });
        return; // Abort order
      }
    }

    // 2. Process stock reduction in Firestore Transaction for safe concurrency
    try {
      if (navigator.onLine) {
        await runTransaction(db, async (transaction) => {
          // Read all product documents first
          const productUpdates: {
            docRef: any;
            newTotalUnits: number;
            newTotalCartons: number;
            isAvailable: boolean;
            unitsPerCarton: number;
            prodId: string;
          }[] = [];

          for (const [prodId, item] of requestedUnitsByProduct) {
            const prodRef = doc(db, 'products_catalog', prodId);
            const snap = await transaction.get(prodRef);

            let currentTotalUnits = Number(item.product.totalUnits ?? item.product.totalPieces ?? 0);
            let unitsPerCarton = Number(item.product.unitsPerCarton || item.product.cartonQuantity) || 12;

            if (snap.exists()) {
              const data = snap.data() as any;
              unitsPerCarton = Number(data.unitsPerCarton || data.cartonQuantity) || unitsPerCarton;
              currentTotalUnits = Number(
                data.totalUnits !== undefined 
                  ? data.totalUnits 
                  : (data.totalPieces !== undefined 
                      ? data.totalPieces 
                      : ((Number(data.totalCartons ?? data.stockCartons ?? 0)) * unitsPerCarton))
              );
            }

            if (currentTotalUnits < item.requestedUnits) {
              throw new Error(`OVERSELL:${item.product.productName}:${currentTotalUnits}:${unitsPerCarton}`);
            }

            const newTotalUnits = Math.max(0, currentTotalUnits - item.requestedUnits);
            const newTotalCartons = Math.floor(newTotalUnits / unitsPerCarton);
            const isAvailable = newTotalUnits >= (6 * unitsPerCarton);

            productUpdates.push({
              docRef: prodRef,
              newTotalUnits,
              newTotalCartons,
              isAvailable,
              unitsPerCarton,
              prodId
            });
          }

          // Write all updates - STOCK DECREMENT REMOVED AS PER REQUEST TO USE FORMULA (TOTAL - TODAY SALES)
          // ONLY UPDATING OTHER FIELDS IF NECESSARY, BUT CURRENTLY NOT NEEDED IN TRANSACTION
        });
      }

      // Update local state immediately - NO LOCAL DECREMENT, FORMULA HANDLES IT
      // 3. Save sales entries
      await saveSalesEntries(orderEntries);

    } catch (err: any) {
      if (err?.message?.startsWith('OVERSELL:')) {
        const [, pName, currentUnitsStr, upcStr] = err.message.split(':');
        const cUnits = Number(currentUnitsStr) || 0;
        const upc = Number(upcStr) || 12;
        const cCartons = Math.floor(cUnits / upc);
        const cPieces = cUnits % upc;
        const msg = `الكمية المطلوبة تتجاوز المخزون المتوفر للمنتج (${pName}). المتاح حالياً: ${cCartons} كارتون و ${cPieces} قطعة.`;
        setUserMessage(msg);
        addToast?.({
          type: 'reminder',
          title: 'الكمية المطلوبة تتجاوز المخزون المتوفر ⚠️',
          message: msg
        });
      } else {
        console.error('Error processing real-time stock reduction:', err);
        // Fallback: still save offline
        await saveSalesEntries(orderEntries);
      }
    }
  };

  const deleteAllProducts = async () => {
    setProductsList([]);
    try {
      localStorage.setItem('app_products_catalog', JSON.stringify([]));
    } catch {}
    
    try {
      const oldProductsSnap = await getDocs(collection(db, 'products_catalog'));
      if (!oldProductsSnap.empty) {
        let deleteBatch = writeBatch(db);
        let deleteCount = 0;
        for (const oldDoc of oldProductsSnap.docs) {
          deleteBatch.delete(oldDoc.ref);
          deleteCount++;
          if (deleteCount === 450) {
            await deleteBatch.commit();
            deleteBatch = writeBatch(db);
            deleteCount = 0;
          }
        }
        if (deleteCount > 0) {
          await deleteBatch.commit();
        }
      }
    } catch (err) {
      console.error('Error deleting all products:', err);
    }
    setUserMessage('تم حذف جميع المنتجات بنجاح 🗑️✅');
  };

  // Gift Promotions Management (العروض والهدايا الترويجية)
  const [giftPromotions, setGiftPromotions] = useState<GiftPromotion[]>(() => {
    try {
      const saved = localStorage.getItem('app_gift_promotions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    if (isPowerSavingMode || isFirestoreQuotaExceeded) return;
    const unsub = onSnapshot(
      collection(db, 'gift_promotions'),
      (snapshot) => {
        const list: GiftPromotion[] = [];
        if (!snapshot.empty) {
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as GiftPromotion;
            if (data) {
              list.push({ ...data, id: docSnap.id });
            }
          });
        }
        setGiftPromotions(list);
        try {
          localStorage.setItem('app_gift_promotions', JSON.stringify(list));
        } catch {}
      },
      (err) => {
        handleFirestoreError(err, 'gift_promotions');
      }
    );
    return () => unsub();
  }, [isPowerSavingMode]);

  const addGiftPromotion = async (giftData: Omit<GiftPromotion, 'id' | 'createdAt'>) => {
    const newId = `gift_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newGift: GiftPromotion = {
      ...giftData,
      id: newId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setGiftPromotions(prev => {
      const next = [newGift, ...prev];
      try {
        localStorage.setItem('app_gift_promotions', JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      const docRef = doc(db, 'gift_promotions', newId);
      await setDoc(docRef, cleanFirestoreData(newGift));
    } catch (err) {
      console.error('Error adding gift promotion to Firestore:', err);
    }

    setUserMessage(`تمت إضافة عرض الهدية للمنتج (${giftData.productName}) بنجاح 🎁✅`);
  };

  const updateGiftPromotion = async (id: string, updatedData: Partial<GiftPromotion>) => {
    const updatePayload = { ...updatedData, updatedAt: Date.now() };
    const cleaned = cleanFirestoreData(updatePayload);
    setGiftPromotions(prev => {
      const next = prev.map(g => (g.id === id ? { ...g, ...updatePayload } : g));
      try {
        localStorage.setItem('app_gift_promotions', JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      const docRef = doc(db, 'gift_promotions', id);
      await setDoc(docRef, cleaned, { merge: true });
    } catch (err) {
      console.error('Error updating gift promotion in Firestore:', err);
    }

    setUserMessage('تم تحديث بيانات عرض الهدية بنجاح 🎁✨');
  };

  const deleteGiftPromotion = async (id: string) => {
    setGiftPromotions(prev => {
      const next = prev.filter(g => g.id !== id);
      try {
        localStorage.setItem('app_gift_promotions', JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      const docRef = doc(db, 'gift_promotions', id);
      await deleteDoc(docRef);
    } catch (err) {
      console.error('Error deleting gift promotion from Firestore:', err);
    }

    setUserMessage('تم حذف عرض الهدية بنجاح 🗑️🎁');
  };

  // Strict Data Retention Policy:
  // Invoices and sales entries are NEVER deleted automatically.
  // Records in current month tables remain intact throughout the month,
  // and old/historical invoices are permanently retained (only manual deletion by Admin is permitted).

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('pending_sales_entries');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.length : 0;
    } catch {
      return 0;
    }
  });

  const getPendingQueue = (): SalesEntry[] => {
    try {
      const raw = localStorage.getItem('pending_sales_entries');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  const savePendingQueue = (queue: SalesEntry[]) => {
    try {
      localStorage.setItem('pending_sales_entries', JSON.stringify(queue));
      setPendingSyncCount(queue.length);
    } catch (e) {
      console.error('Error saving pending queue:', e);
    }
  };

  const syncPendingEntries = async () => {
    if (!navigator.onLine) return;
    const pending = getPendingQueue();
    if (pending.length === 0) return;

    try {
      const remaining: SalesEntry[] = [];
      
      // Process pending entries in batches
      let batch = writeBatch(db);
      let batchCount = 0;
      const CHUNK_SIZE = 450;
      let committedCount = 0;

      for (const entry of pending) {
        try {
          const entryRef = doc(db, 'sales_entries', entry.id);
          batch.set(entryRef, entry, { merge: true });
          batchCount++;

          if (batchCount === CHUNK_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            committedCount += batchCount;
            batchCount = 0;
          }
        } catch (err) {
          console.error('Failed to add entry to batch:', entry.id, err);
          remaining.push(entry);
        }
      }

      if (batchCount > 0) {
        await batch.commit();
        committedCount += batchCount;
      }

      savePendingQueue(remaining);
      if (remaining.length === 0 && pending.length > 0) {
        setUserMessage(`تمت مزامنة ${committedCount} مبيعة معلقة مع قاعدة البيانات بنجاح 🔄✅`);
      } else if (remaining.length > 0) {
        setUserMessage(`تمت مزامنة ${committedCount} مبيعة بنجاح، وفشل مزامنة ${remaining.length} مبيعة 🔄⚠️`);
      }
    } catch (e) {
      console.error('Error in syncPendingEntries:', e);
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncPendingEntries();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (navigator.onLine) {
      syncPendingEntries();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [syncFailureAlert, setSyncFailureAlert] = useState<boolean>(false);

  // Periodically check connection and pending sync status
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentUser.isAdmin && navigator.onLine) {
        const pending = getPendingQueue();
        if (pending.length > 0) {
          // If pending entries are older than 2 minutes, trigger alert
          const now = Date.now();
          const oldest = pending.reduce((min, p) => Math.min(min, p.timestamp || now), now);
          if (now - oldest > 120000) {
            setSyncFailureAlert(true);
          } else {
            setSyncFailureAlert(false);
          }
        } else {
          setSyncFailureAlert(false);
        }
      } else {
        setSyncFailureAlert(false);
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [currentUser.isAdmin]);

  const togglePowerSavingMode = () => {
    setIsPowerSavingMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem('is_data_saver_mode', String(next));
      } catch {}
      setUserMessage(next ? 'تم تفعيل وضع توفير الطاقة 🔋🔌' : 'تم إيقاف وضع توفير الطاقة 🔋🔋');
      return next;
    });
  };

  // 5-minute periodic background polling / data refresh
  useEffect(() => {
    const pollingInterval = setInterval(() => {
      if (navigator.onLine && !isPowerSavingMode) {
        syncPendingEntries();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(pollingInterval);
  }, [isPowerSavingMode]);

  useEffect(() => {
    if (isFirestoreQuotaExceeded) return;
    let archiveMap = new globalThis.Map<string, SalesEntry>();
    // Pre-load any existing archive entries once to guarantee complete historical records
    getDocs(collection(db, 'sales_entries_archive')).then((snap) => {
      snap.forEach((doc) => {
        const data = doc.data() as SalesEntry;
        if (data && data.id) {
          archiveMap.set(data.id, data);
        }
      });
    }).catch((err) => {
      handleFirestoreError(err, 'sales_entries_archive');
    });

    const unsubAll = onSnapshot(collection(db, 'sales_entries'), (snapshot) => {
      const entriesMap = new globalThis.Map<string, SalesEntry>();
      // First populate archived records
      archiveMap.forEach((entry, id) => {
        entriesMap.set(id, entry);
      });
      // Merge live sales entries (overrides archive if present)
      snapshot.forEach((doc) => {
        const data = doc.data() as SalesEntry;
        if (data && data.id) {
          entriesMap.set(data.id, data);
        }
      });
      const allArr = Array.from(entriesMap.values());
      setAllSalesEntries(allArr);
      try {
        localStorage.setItem('cache_all_sales_entries', JSON.stringify(allArr));
      } catch {}
    }, (err) => {
      handleFirestoreError(err, 'sales_entries_all');
    });
    return () => unsubAll();
  }, [isFirestoreQuotaExceeded]);

  useEffect(() => {
    try {
      localStorage.setItem('cache_sales_entries', JSON.stringify(salesEntries));
    } catch {}
  }, [salesEntries]);



  useEffect(() => {
    if (userMessage) {
      const timer = setTimeout(() => {
        setUserMessage(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [userMessage]);

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    const loginFlag = localStorage.getItem('app_is_logged_in') === 'true';
    const savedUser = localStorage.getItem('app_current_user');

    return loginFlag && !!savedUser;
  });

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('app_is_dark_mode');
    return saved === 'true';
  });

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
  };

  useEffect(() => {
    localStorage.setItem('app_is_dark_mode', String(isDarkMode));
  }, [isDarkMode]);

  const checkAndTriggerMilestoneToasts = (
    delegateName: string,
    prevWeightKg: number,
    newWeightKg: number,
    dailyTargetKg: number
  ) => {
    if (dailyTargetKg <= 0) return;

    const prevPct = (prevWeightKg / dailyTargetKg) * 100;
    const newPct = (newWeightKg / dailyTargetKg) * 100;

    if (prevPct < 50 && newPct >= 50) {
      addToast({
        type: 'milestone_50',
        title: 'وصلت إلى 50% من الهدف اليومي! 🎯',
        message: `أحسنت يا بطل (${delegateName})! أتممت 50% من هدفك اليومي (${newPct.toFixed(0)}%).`,
        percentage: newPct,
        delegateName,
      });
    }

    if (prevPct < 75 && newPct >= 75) {
      addToast({
        type: 'milestone_75',
        title: 'وصلت إلى 75% من الهدف اليومي! ⚡',
        message: `إنجاز ممتاز يا (${delegateName})! وصلت إلى 75% من هدفك اليومي.`,
        percentage: newPct,
        delegateName,
      });
    }

    if (prevPct < 100 && newPct >= 100) {
      addToast({
        type: 'milestone_100',
        title: 'تهانينا! تحقيق 100% من الهدف اليومي! 🏆🎉',
        message: `أداء استثنائي يا (${delegateName})! حققت كامل التاركت اليومي بنجاح (${newPct.toFixed(0)}%)!`,
        percentage: newPct,
        delegateName,
      });
    }
    
    if (prevPct <= 100 && newPct > 100) {
      addToast({
        type: 'success',
        title: 'تجاوزت الهدف اليومي! 🚀',
        message: `أنت رائع يا (${delegateName})! لقد تجاوزت هدفك اليومي بنسبة (${newPct.toFixed(0)}%). استمر في هذا الأداء الرائع!`,
        percentage: newPct,
        delegateName,
      });
    }
  };

  // 1. Independent listener for delegate accounts (only once on mount, immune to date/delegate switching)
  useEffect(() => {
    if (isFirestoreQuotaExceeded) return;
    const unsubAccounts = onSnapshot(
      collection(db, 'delegate_accounts'),
      (snapshot) => {
        const accs: DelegateAccount[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as DelegateAccount;
          if (data && data.username) {
            accs.push(data);
          }
        });

        // Merge with default accounts to guarantee accounts like rafatdata and YASIR always exist
        const mergedAccs = [...accs];
        DEFAULT_DELEGATE_ACCOUNTS_ENTITIES.forEach((defAcc) => {
          const exists = mergedAccs.some(
            (a) => a.username.toLowerCase() === defAcc.username.toLowerCase()
          );
          if (!exists) {
            mergedAccs.push(defAcc);
            // Persist missing default account to Firestore so it stays synced
            setDoc(doc(db, 'delegate_accounts', defAcc.username.toLowerCase()), defAcc, { merge: true })
              .catch((err) => handleFirestoreError(err, 'sync_default_account'));
          }
        });

        if (mergedAccs.length > 0) {
          setDelegateAccounts(mergedAccs);
        }
      },
      (err) => {
        handleFirestoreError(err, 'delegate_accounts');
        setDelegateAccounts((prev) => (prev.length > 0 ? prev : DEFAULT_DELEGATE_ACCOUNTS_ENTITIES));
      }
    );

    return () => unsubAccounts();
  }, [isFirestoreQuotaExceeded]);

  // 2. Independent listener for targets and locks (depends only on user role/name, not date/delegate)
  useEffect(() => {
    if (isFirestoreQuotaExceeded) return;
    const isSauceUser =
      currentUser?.role === 'sauceOnly' ||
      currentUser?.username?.toLowerCase() === 'mohammedsauce' ||
      currentUser?.name === 'محمد الصلصات';

    let targetsQuery;
    if (currentUser?.isAdmin || isSauceUser) {
      targetsQuery = collection(db, 'delegate_targets');
    } else {
      targetsQuery = query(
        collection(db, 'delegate_targets'),
        where('delegateName', '==', currentUser?.name || '')
      );
    }

    const unsubTargets = onSnapshot(
      targetsQuery,
      (snapshot) => {
        const targets: DelegateTarget[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data() as DelegateTarget;
          if (data) {
            targets.push({ ...data, id: doc.id });
          }
        });
        setDelegateTargets(targets);
        try {
          localStorage.setItem('cache_delegate_targets', JSON.stringify(targets));
        } catch {}
      },
      (err) => {
        handleFirestoreError(err, 'delegate_targets');
      }
    );

    let locksQuery;
    if (currentUser?.isAdmin || isSauceUser) {
      locksQuery = collection(db, 'target_locks');
    } else {
      locksQuery = query(
        collection(db, 'target_locks'),
        where('delegateName', '==', currentUser?.name || '')
      );
    }

    const unsubLocks = onSnapshot(
      locksQuery,
      (snapshot) => {
        const locks: Record<string, number> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const delName = data.delegateName || docSnap.id;
          if (delName && data.lockTimestamp) {
            locks[delName] = Number(data.lockTimestamp);
          }
        });
        setTargetLockMap(locks);
        try {
          localStorage.setItem('cache_target_locks', JSON.stringify(locks));
        } catch {}
      },
      (err) => {
        handleFirestoreError(err, 'target_locks');
      }
    );

    return () => {
      unsubTargets();
      unsubLocks();
    };
  }, [currentUser?.isAdmin, currentUser?.name, currentUser?.role, currentUser?.username, isFirestoreQuotaExceeded]);

  // 3. Independent listener for sales entries (scoped to selected date and delegate)
  useEffect(() => {
    if (isFirestoreQuotaExceeded) return;
    const isSauceUser =
      currentUser?.role === 'sauceOnly' ||
      currentUser?.username?.toLowerCase() === 'mohammedsauce' ||
      currentUser?.name === 'محمد الصلصات';

    let salesQuery;
    if (currentUser?.isAdmin || isSauceUser) {
      if (selectedDelegate === 'الكل' || isSauceUser) {
        salesQuery = query(collection(db, 'sales_entries'), where('dateString', '==', selectedDate));
      } else {
        salesQuery = query(
          collection(db, 'sales_entries'),
          where('dateString', '==', selectedDate),
          where('delegateName', '==', selectedDelegate)
        );
      }
    } else {
      salesQuery = query(
        collection(db, 'sales_entries'),
        where('dateString', '==', selectedDate),
        where('delegateName', '==', currentUser?.name || '')
      );
    }

    const unsubSales = onSnapshot(
      salesQuery,
      (snapshot) => {
        const entriesMap = new globalThis.Map<string, SalesEntry>();
        snapshot.forEach((doc) => {
          const data = doc.data() as SalesEntry;
          if (data && data.id) {
            entriesMap.set(data.id, data);
          }
        });
        const pending = getPendingQueue();
        pending.forEach((entry) => {
          if (entry.dateString === selectedDate) {
            if (currentUser?.isAdmin || isSauceUser) {
              if (selectedDelegate === 'الكل' || isSauceUser || entry.delegateName?.trim().toLowerCase() === selectedDelegate?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            } else {
              if (entry.delegateName?.trim().toLowerCase() === currentUser?.name?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            }
          }
        });
        setSalesEntries(Array.from(entriesMap.values()));
      },
      (err) => {
        handleFirestoreError(err, 'sales_entries');
        const entriesMap = new globalThis.Map<string, SalesEntry>();
        const pending = getPendingQueue();
        pending.forEach((entry) => {
          if (entry.dateString === selectedDate) {
            if (currentUser?.isAdmin || isSauceUser) {
              if (selectedDelegate === 'الكل' || isSauceUser || entry.delegateName?.trim().toLowerCase() === selectedDelegate?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            } else {
              if (entry.delegateName?.trim().toLowerCase() === currentUser?.name?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            }
          }
        });
        setSalesEntries(Array.from(entriesMap.values()));
      }
    );

    return () => {
      unsubSales();
    };
  }, [currentUser?.isAdmin, currentUser?.name, currentUser?.role, currentUser?.username, selectedDate, selectedDelegate, isFirestoreQuotaExceeded]);

  const saveSalesEntries = async (
    newEntriesData: Omit<SalesEntry, 'id' | 'timestamp'>[]
  ) => {
    if (newEntriesData.length === 0) return;

    const activeDelegateName = newEntriesData[0].delegateName;
    const addedWeight = newEntriesData.reduce((sum, e) => sum + e.totalWeightKg, 0);
    

    const prevWeight = salesEntries
      .filter(
        (e) =>
          e.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase() &&
          e.dateString === selectedDate
      )
      .reduce((sum, e) => sum + e.totalWeightKg, 0);

    const newWeight = prevWeight + addedWeight;

    const delTargets = delegateTargets.filter(
      (t) => t.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase()
    );

    const dailyTargetKg = delTargets.reduce((sum, t) => sum + t.dailyTargetWeightKg, 0) || 800;
    const now = Date.now();

    const newCommittedEntries: SalesEntry[] = [];
    const updatedEntries: SalesEntry[] = [];

    newEntriesData.forEach((data, idx) => {
      const existing = salesEntries.find(
        (e) => 
          e.dateString === selectedDate &&
          e.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase() &&
          e.customerName?.trim() === data.customerName?.trim() &&
          e.productName === data.productName &&
          e.priceMode === data.priceMode &&
          Boolean(e.isGift) === Boolean(data.isGift)
      );
      
      if (existing) {
        const alreadyUpdatedIndex = updatedEntries.findIndex(e => e.id === existing.id);
        if (alreadyUpdatedIndex >= 0) {
           const prevUpd = updatedEntries[alreadyUpdatedIndex];
           updatedEntries[alreadyUpdatedIndex] = {
             ...prevUpd,
             quantity: prevUpd.quantity + data.quantity,
             enteredQuantity: (prevUpd.enteredQuantity || 0) + (data.enteredQuantity || 0),
             totalWeightKg: prevUpd.totalWeightKg + data.totalWeightKg
           };
        } else {
           updatedEntries.push({
             ...existing,
             quantity: existing.quantity + data.quantity,
             enteredQuantity: (existing.enteredQuantity || 0) + (data.enteredQuantity || 0),
             totalWeightKg: existing.totalWeightKg + data.totalWeightKg
           });
        }
      } else {
        const alreadyNewIndex = newCommittedEntries.findIndex(e => 
          e.productName === data.productName && 
          e.customerName?.trim() === data.customerName?.trim() && 
          e.priceMode === data.priceMode &&
          Boolean(e.isGift) === Boolean(data.isGift)
        );
        if (alreadyNewIndex >= 0) {
           const prevNew = newCommittedEntries[alreadyNewIndex];
           newCommittedEntries[alreadyNewIndex] = {
             ...prevNew,
             quantity: prevNew.quantity + data.quantity,
             enteredQuantity: (prevNew.enteredQuantity || 0) + (data.enteredQuantity || 0),
             totalWeightKg: prevNew.totalWeightKg + data.totalWeightKg
           };
        } else {
           const id = `${now}_${idx}_${Math.random().toString(36).substr(2, 5)}`;
           newCommittedEntries.push({ ...data, id, timestamp: now });
        }
      }
    });

    if (!navigator.onLine) {
      const pending = getPendingQueue();
      savePendingQueue([...pending, ...newCommittedEntries, ...updatedEntries]);
      setSalesEntries((prev) => {
        let next = [...prev];
        updatedEntries.forEach(upd => {
           const i = next.findIndex(x => x.id === upd.id);
           if(i >= 0) next[i] = upd;
        });
        return [...next, ...newCommittedEntries];
      });
      setUserMessage('أنت في وضع عدم الاتصال. تم حفظ المبيعات محلياً وسيتم مزامنتها تلقائياً عند الاتصال 📴');
      checkAndTriggerMilestoneToasts(activeDelegateName, prevWeight, newWeight, dailyTargetKg);
      return;
    }

    try {
      const batch = writeBatch(db);
      newCommittedEntries.forEach((entry) => {
        const entryRef = doc(db, 'sales_entries', entry.id);
        batch.set(entryRef, entry);
      });
      updatedEntries.forEach((entry) => {
        const entryRef = doc(db, 'sales_entries', entry.id);
        batch.set(entryRef, entry, { merge: true });
      });
      await batch.commit();
      setUserMessage('تم حفظ المبيعات بنجاح ومزامنتها فوراً مع الأدمن ✅');
      checkAndTriggerMilestoneToasts(activeDelegateName, prevWeight, newWeight, dailyTargetKg);
    } catch (e) {
      console.error('Error saving sales entries, queueing offline:', e);
      const pending = getPendingQueue();
      savePendingQueue([...pending, ...newCommittedEntries, ...updatedEntries]);
      setSalesEntries((prev) => {
        let next = [...prev];
        updatedEntries.forEach(upd => {
           const i = next.findIndex(x => x.id === upd.id);
           if(i >= 0) next[i] = upd;
        });
        return [...next, ...newCommittedEntries];
      });
      setUserMessage('تعذر الاتصال بالخادم. تم حفظ المبيعات محلياً وسيتم مزامنتها لاحقاً 📴');
    }
  };

  const deleteSalesEntry = async (id: string) => {
    const entry = allSalesEntries.find(e => e.id === id);
    setSalesEntries(prev => prev.filter(e => e.id !== id));
    setAllSalesEntries(prev => prev.filter(e => e.id !== id));
    try {
      await deleteDoc(doc(db, 'sales_entries', id));
      setUserMessage('تم حذف المنتج المسجل بنجاح ✅');
    } catch (e) {
      console.error('Error deleting entry:', e);
    }
  };

  const updateSalesEntry = async (id: string, updatedData: Partial<SalesEntry>) => {
    const entry = allSalesEntries.find(e => e.id === id);
    if (!entry) return;

    const newStatus = updatedData.status;
    const isCancelling = newStatus === 'cancelled' && entry.status !== 'cancelled';
    
    const cleaned = cleanFirestoreData(updatedData);
    setSalesEntries(prev => prev.map(e => e.id === id ? { ...e, ...cleaned } : e));
    setAllSalesEntries(prev => prev.map(e => e.id === id ? { ...e, ...cleaned } : e));
    
    try {
      await setDoc(doc(db, 'sales_entries', id), cleaned, { merge: true });
      setUserMessage('تم تعديل بيانات الطلب بنجاح');
    } catch (e) {
      console.error('Error updating entry:', e);
      setUserMessage('حدث خطأ أثناء تحديث الطلب');
    }
  };

  const availableAccounts = useMemo(() => {
    const accs: UserAccount[] = [
      { name: 'الأدمن', roleName: 'مدير النظام', isAdmin: true, username: 'YASIR', monthlyTargetKg: 0 },
    ];

    delegateAccounts.forEach((a) => {
      if (a.username.toLowerCase() === 'yasir') return;
      const isSauce =
        a.username?.toLowerCase() === 'mohammedsauce' ||
        a.role === 'sauceOnly' ||
        a.delegateName === 'محمد الصلصات';

      accs.push({
        name: a.delegateName,
        roleName: isSauce
          ? 'حساب مشاهدة'
          : a.isAdmin
          ? (a.role === 'dataEntry' ? 'مدخل بيانات / مدير' : 'مدير النظام')
          : 'مندوب مبيعات',
        isAdmin: isSauce ? false : a.isAdmin,
        role: isSauce ? 'sauceOnly' : a.role,
        username: a.username,
        monthlyTargetKg: isSauce ? 0 : a.monthlyTargetKg,
        delegateCode: isSauce ? undefined : a.delegateCode,
      });
    });

    if (!accs.some((a) => a.username?.toLowerCase() === 'rafatdata')) {
      accs.push({
        name: 'رأفت جمال',
        roleName: 'مدخل بيانات / مدير',
        isAdmin: true,
        role: 'dataEntry',
        username: 'rafatdata',
        monthlyTargetKg: 0,
      });
    }

    return accs;
  }, [delegateAccounts]);

  const delegatesList = useMemo(() => {
    return Array.from(
      new Set(
        availableAccounts
          .filter(
            (a) =>
              !a.isAdmin &&
              a.role !== 'dataEntry' &&
              a.role !== 'sauceOnly' &&
              a.role !== 'viewer' &&
              a.username?.toLowerCase() !== 'mohammedsauce' &&
              a.name !== 'محمد الصلصات' &&
              !a.name?.toLowerCase().includes('sauce') &&
              !isExcludedReportDelegate(a.name) &&
              !isExcludedReportDelegate(a.username)
          )
          .map((a) => a.name)
      )
    );
  }, [availableAccounts]);

  const rawSavedEntries = useMemo(() => {
    return salesEntries.filter((entry) => entry.dateString === selectedDate);
  }, [salesEntries, selectedDate]);

  const savedEntries = useMemo(() => {
    if (currentUser.isAdmin) {
      if (selectedDelegate === 'الكل') {
        return rawSavedEntries.filter((e) => !isExcludedReportDelegate(e.delegateName));
      }
      return rawSavedEntries.filter(
        (e) => e.delegateName?.trim().toLowerCase() === selectedDelegate?.trim().toLowerCase()
      );
    }
    return rawSavedEntries.filter(
      (e) => e.delegateName?.trim().toLowerCase() === currentUser.name?.trim().toLowerCase()
    );
  }, [rawSavedEntries, currentUser, selectedDelegate]);

  const categoryReports = useMemo(() => {
    const effectiveDelegate = !currentUser.isAdmin ? currentUser.name : selectedDelegate;

    let filteredEntries =
      effectiveDelegate === 'الكل' || effectiveDelegate === 'الأدمن'
        ? rawSavedEntries
        : rawSavedEntries.filter(
            (e) => e.delegateName?.trim().toLowerCase() === effectiveDelegate?.trim().toLowerCase()
          );

    filteredEntries = filteredEntries.filter((e) => !isExcludedReportDelegate(e.delegateName));

    const reports = DEFAULT_CATEGORIES_LIST.map((displayName, index) => {
      const salesWeightForCategory = filteredEntries
        .filter(
          (e) => (e.categoryName || '').trim().toLowerCase() === (displayName || '').trim().toLowerCase()
        )
        .reduce((sum, item) => sum + (Number(item.totalWeightKg) || 0), 0);

      let targetKg = 0;

      if (effectiveDelegate !== 'الكل' && effectiveDelegate !== 'الأدمن') {
        const found = delegateTargets.find(
          (t) =>
            t.delegateName?.trim().toLowerCase() === effectiveDelegate?.trim().toLowerCase() &&
            (t.categoryName || '').trim().toLowerCase() === (displayName || '').trim().toLowerCase()
        );
        targetKg = found ? (Number(found.dailyTargetWeightKg) || 0) : 0;
      } else {
        targetKg = (delegatesList || []).reduce((sum, del) => {
          const found = delegateTargets.find(
            (t) =>
              t.delegateName?.trim().toLowerCase() === del.trim().toLowerCase() &&
              (t.categoryName || '').trim().toLowerCase() === (displayName || '').trim().toLowerCase()
          );
          return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
        }, 0);
      }

      const percentage = targetKg > 0 ? (salesWeightForCategory / targetKg) * 100.0 : 0.0;
      const isAchieved = percentage >= 100.0;
      const remainingWeightKg = targetKg > salesWeightForCategory ? targetKg - salesWeightForCategory : 0;

      return {
        categoryId: index + 1,
        categoryName: displayName,
        dailySalesWeightKg: salesWeightForCategory,
        dailyTargetWeightKg: targetKg,
        percentage,
        isAchieved,
        remainingWeightKg,
      };
    });

    return reports.sort((a, b) => {
      const pA = isNaN(a.percentage) ? 0 : a.percentage;
      const pB = isNaN(b.percentage) ? 0 : b.percentage;
      return pA !== pB ? pA - pB : a.categoryId - b.categoryId;
    });
  }, [currentUser, selectedDelegate, rawSavedEntries, delegateTargets, delegatesList]);

  const loginAccount = (account: UserAccount) => {
    const isSauce =
      account.username?.toLowerCase() === 'mohammedsauce' ||
      account.role === 'sauceOnly' ||
      account.name === 'محمد الصلصات' ||
      account.delegateName === 'محمد الصلصات';

    const normalizedAccount: UserAccount = {
      ...account,
      name: mapDelegateName(account.name),
      roleName: isSauce ? 'حساب مشاهدة' : account.roleName,
      isAdmin: isSauce ? false : account.isAdmin,
      role: isSauce ? 'sauceOnly' : account.role,
      monthlyTargetKg: isSauce ? 0 : (account.monthlyTargetKg || 0),
      delegateCode: isSauce ? undefined : account.delegateCode,
    };
    setCurrentUser(normalizedAccount);
    const now = Date.now();
    setLoginTimestamp(now);
    if (isSauce) {
      setSelectedDelegate('الكل');
      setActiveTab('item_tracking');
    } else if (!normalizedAccount.isAdmin) {
      setSelectedDelegate(normalizedAccount.name);
    } else {
      setSelectedDelegate('الكل');
    }
    setIsLoggedIn(true);
    localStorage.setItem('app_is_logged_in', 'true');
    localStorage.setItem('app_current_user', JSON.stringify(normalizedAccount));
    setUserMessage(`تم تسجيل الدخول بنجاح كـ: ${normalizedAccount.name}`);
  };

  const loginWithCredentials = async (
    usernameInput: string,
    passwordInput: string
  ): Promise<{ success: boolean; error?: string }> => {
    const u = usernameInput.trim().toLowerCase();
    const p = parseArabicDigits(passwordInput.trim());

    // 1. Check in local delegateAccounts state (normalized Arabic digits)
    let matched: any = delegateAccounts.find(
      (it) =>
        (it.username.toLowerCase() === u || it.delegateName.toLowerCase() === u) &&
        parseArabicDigits(it.password) === p
    );

    // 2. Direct Firestore check to verify live against the database
    if (!matched) {
      try {
        const docRef = doc(db, 'delegate_accounts', u);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as DelegateAccount;
          if (data && parseArabicDigits(data.password) === p) {
            matched = data;
          }
        } else {
          const q = query(collection(db, 'delegate_accounts'), where('username', '==', u));
          const querySnap = await getDocs(q);
          if (!querySnap.empty) {
            const data = querySnap.docs[0].data() as DelegateAccount;
            if (data && parseArabicDigits(data.password) === p) {
              matched = data;
            }
          }
        }
      } catch (err) {
        console.error('Firestore direct lookup error during login:', err);
      }
    }

    // 3. Fallback check in DEFAULT_DELEGATE_ACCOUNTS_ENTITIES
    if (!matched) {
      matched = DEFAULT_DELEGATE_ACCOUNTS_ENTITIES.find(
        (it) =>
          (it.username.toLowerCase() === u || it.delegateName.toLowerCase() === u) &&
          parseArabicDigits(it.password) === p
      );
    }

    // 4. Explicit fallback for rafatdata / رأفت جمال (10001)
    if (
      !matched &&
      (u === 'rafatdata' || u === 'رأفت' || u === 'رأفت جمال') &&
      p === '10001'
    ) {
      matched = {
        username: 'rafatdata',
        password: '10001',
        delegateName: 'رأفت جمال',
        monthlyTargetKg: 0,
        isAdmin: true,
        role: 'dataEntry',
      };
      setDoc(doc(db, 'delegate_accounts', 'rafatdata'), matched, { merge: true }).catch(console.error);
    }

    // 4.5. Explicit fallback for mohammedsauce / محمد الصلصات (m12343)
    if (
      !matched &&
      (u === 'mohammedsauce' || u === 'محمد الصلصات') &&
      p === 'm12343'
    ) {
      matched = {
        username: 'mohammedsauce',
        password: 'm12343',
        delegateName: 'محمد الصلصات',
        monthlyTargetKg: 0,
        isAdmin: false,
        role: 'sauceOnly',
      };
      setDoc(doc(db, 'delegate_accounts', 'mohammedsauce'), matched, { merge: true }).catch(console.error);
    }

    // 5. Explicit fallback for YASIR (377377)
    if (!matched && u === 'yasir' && p === '377377') {
      matched = {
        name: 'الأدمن',
        roleName: 'مدير النظام',
        isAdmin: true,
        username: 'YASIR',
        monthlyTargetKg: 0,
      };
    }

    if (matched) {
      // Ensure the account is synced to Firestore
      if (matched.username) {
        setDoc(doc(db, 'delegate_accounts', matched.username.toLowerCase()), matched, { merge: true })
          .catch((e) => console.error('Failed to sync account to Firestore:', e));
      }

      const isSauce =
        matched.username?.toLowerCase() === 'mohammedsauce' ||
        matched.role === 'sauceOnly' ||
        matched.delegateName === 'محمد الصلصات' ||
        matched.name === 'محمد الصلصات';

      const userAcc: UserAccount = {
        name: matched.delegateName || matched.name,
        roleName: isSauce
          ? 'حساب مشاهدة'
          : matched.isAdmin
          ? (matched.role === 'dataEntry' ? 'مدخل بيانات / مدير' : 'مدير النظام')
          : 'مندوب مبيعات',
        isAdmin: isSauce ? false : !!matched.isAdmin,
        role: isSauce ? 'sauceOnly' : matched.role,
        username: matched.username,
        monthlyTargetKg: isSauce ? 0 : (matched.monthlyTargetKg || 0),
        delegateCode: isSauce ? undefined : matched.delegateCode,
      };
      loginAccount(userAcc);
      return { success: true };
    }

    return { success: false, error: 'اسم المستخدم أو الرمز السري غير صحيح' };
  };

  const logout = () => {
    setIsLoggedIn(false);
    localStorage.setItem('app_is_logged_in', 'false');
    localStorage.removeItem('app_current_user');
    setCurrentUser({
      name: 'ناجي خلف',
      roleName: 'مندوب مبيعات',
      isAdmin: false,
      username: 'najikala',
      monthlyTargetKg: 1500,
      delegateCode: '60037899',
    });
    setSelectedDelegate('الكل');
    setPrefilledEntryData(null);
    setShowQuickAdd(false);
    setActiveTab('entry');
    setUserMessage('تم تسجيل الخروج بنجاح');
  };



  const getDelegateLockStatus = (delegateName: string): DelegateLockStatus => {
    const setTimestamp = targetLockMap[delegateName] || 0;
    if (!setTimestamp) {
      return { isLocked: false, daysRemaining: 0, setDateStr: 'غير محدد', unlockDateStr: 'متاح', setTimestamp: 0 };
    }
    const elapsedMs = Date.now() - setTimestamp;
    const daysElapsed = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    const isLocked = elapsedMs < THIRTY_ONE_DAYS_MS;
    const daysRemaining = isLocked ? Math.max(1, 31 - daysElapsed) : 0;
    return {
      isLocked,
      daysRemaining,
      setDateStr: new Date(setTimestamp).toLocaleDateString('ar-EG'),
      unlockDateStr: new Date(setTimestamp + THIRTY_ONE_DAYS_MS).toLocaleDateString('ar-EG'),
      setTimestamp,
    };
  };

  const unlockDelegateTargetManually = async (delegateName: string) => {
    try {
      const docId = delegateName.replace(/[\/\s]/g, '_');
      await deleteDoc(doc(db, 'target_locks', docId));
      setUserMessage(`تم إلغاء قفل التاركت للمندوب (${delegateName}) بنجاح.`);
    } catch (e) {
      console.error('Error unlocking target:', e);
    }
  };

  const updateDelegateTarget = async (delegateName: string, categoryName: string, targetKg: number) => {
    const now = Date.now();
    // Update local state immediately to avoid race condition and delay
    setDelegateTargets((prev) => {
      const idx = prev.findIndex(
        (t) =>
          t.delegateName?.trim().toLowerCase() === delegateName?.trim().toLowerCase() &&
          t.categoryName?.trim().toLowerCase() === categoryName?.trim().toLowerCase()
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], dailyTargetWeightKg: targetKg, lastUpdatedTimestamp: now };
        return next;
      }
      return [
        ...prev,
        {
          id: `${delegateName}_${categoryName}`.replace(/[\/\s]/g, '_'),
          delegateName,
          categoryName,
          dailyTargetWeightKg: targetKg,
          lastUpdatedTimestamp: now,
        },
      ];
    });

    try {
      const docId = `${delegateName}_${categoryName}`.replace(/[\/\s]/g, '_');
      await setDoc(
        doc(db, 'delegate_targets', docId),
        {
          delegateName,
          categoryName,
          dailyTargetWeightKg: targetKg,
          lastUpdatedTimestamp: now,
          updatedAt: new Date(now).toISOString(),
        },
        { merge: true }
      );
      setIsOnline(true);
      setSyncFailureAlert(false);
      setPendingSyncCount(getPendingQueue().length);
    } catch (e) {
      console.error('Error updating delegate target:', e);
    }
  };

  const batchUpdateDelegateTargets = (
    delegateName: string,
    targetsList: { categoryName: string; targetKg: number }[],
    monthlyTargetKg?: number,
    forceUnlock: boolean = false
  ): boolean => {
    const lockStatus = getDelegateLockStatus(delegateName);
    if (lockStatus.isLocked && !forceUnlock) {
      setUserMessage(`عذراً! التاركت للمندوب (${delegateName}) مثبت لمدة 31 يوماً.`);
      return false;
    }

    const now = Date.now();

    // 1. Immediately update local targets to avoid race conditions and UI delay
    setDelegateTargets((prev) => {
      const filtered = prev.filter(
        (t) => t.delegateName?.trim().toLowerCase() !== delegateName.trim().toLowerCase()
      );
      const newTargets = targetsList.map((item) => ({
        id: `${delegateName}_${item.categoryName}`.replace(/[\/\s]/g, '_'),
        delegateName,
        categoryName: item.categoryName,
        dailyTargetWeightKg: item.targetKg,
        lastUpdatedTimestamp: now,
      }));
      return [...filtered, ...newTargets];
    });

    setTargetLockMap((prev) => ({ ...prev, [delegateName]: now }));

    // 2. Preserve cumulative monthly target without overwriting or losing saved values
    const accMatch = delegateAccounts.find(
      (a) =>
        a.delegateName?.trim().toLowerCase() === delegateName?.trim().toLowerCase() ||
        a.username?.toLowerCase() === delegateName?.trim().toLowerCase()
    );

    let effectiveMonthlyTarget: number;
    if (monthlyTargetKg !== undefined && monthlyTargetKg > 0) {
      effectiveMonthlyTarget = monthlyTargetKg;
    } else if (accMatch?.monthlyTargetKg && accMatch.monthlyTargetKg > 0) {
      effectiveMonthlyTarget = accMatch.monthlyTargetKg;
    } else {
      // Calculate cumulative target across 26 working days of daily category targets
      effectiveMonthlyTarget = targetsList.reduce((sum, item) => sum + (Number(item.targetKg) || 0), 0) * 26;
    }

    if (accMatch) {
      setDelegateAccounts((prev) =>
        prev.map((a) =>
          a.username.toLowerCase() === accMatch.username.toLowerCase()
            ? { ...a, monthlyTargetKg: effectiveMonthlyTarget, targetSetTimestamp: now }
            : a
        )
      );
    }

    try {
      const batch = writeBatch(db);
      targetsList.forEach((item) => {
        const docId = `${delegateName}_${item.categoryName}`.replace(/[\/\s]/g, '_');
        const targetRef = doc(db, 'delegate_targets', docId);
        batch.set(
          targetRef,
          {
            delegateName,
            categoryName: item.categoryName,
            dailyTargetWeightKg: item.targetKg,
            lastUpdatedTimestamp: now,
            updatedAt: new Date(now).toISOString(),
          },
          { merge: true }
        );
      });

      if (accMatch) {
        const updatedAcc = { ...accMatch, monthlyTargetKg: effectiveMonthlyTarget, targetSetTimestamp: now };
        const accRef = doc(db, 'delegate_accounts', accMatch.username.toLowerCase());
        batch.set(accRef, updatedAcc, { merge: true });
      }

      const lockDocId = delegateName.replace(/[\/\s]/g, '_');
      const lockRef = doc(db, 'target_locks', lockDocId);
      batch.set(
        lockRef,
        { delegateName, lockTimestamp: now, updatedAt: new Date(now).toISOString() },
        { merge: true }
      );

      // Commit to Firestore and update sync status immediately upon success
      batch
        .commit()
        .then(() => {
          setIsOnline(true);
          setSyncFailureAlert(false);
          setPendingSyncCount(getPendingQueue().length);
          setUserMessage(`تم تثبيت وتحديث التاركت للمندوب (${delegateName}) لمدة 31 يوماً بنجاح ومزامنته فوراً ✅`);
        })
        .catch((err) => {
          console.error('Batch update target commit error:', err);
          setUserMessage(`فشل مزامنة التاركت مع السيرفر: ${err.message || ''}`);
        });

      return true;
    } catch (e) {
      console.error('Batch update target error:', e);
      setUserMessage('حدث خطأ أثناء حفظ الأهداف.');
      return false;
    }
  };

  const saveDelegateAccount = async (acc: DelegateAccount) => {
    try {
      const docId = acc.username.trim().toLowerCase();
      await setDoc(doc(db, 'delegate_accounts', docId), acc, { merge: true });
      setUserMessage(`تم حفظ بيانات المندوب (${acc.delegateName}) بنجاح`);
    } catch (e) {
      console.error('Error saving account:', e);
    }
  };

  const addDelegateAccount = async (acc: DelegateAccount) => {
    try {
      const docId = acc.username.trim().toLowerCase();
      await setDoc(doc(db, 'delegate_accounts', docId), acc);
      setDelegateAccounts(prev => [...prev, acc]);
      setUserMessage(`تم إضافة المندوب (${acc.delegateName}) بنجاح`);
    } catch (e) {
      console.error('Error adding account:', e);
      setUserMessage('حدث خطأ أثناء إضافة المندوب.');
    }
  };

  const updateDelegateIdentity = async (oldName: string, newName: string, oldUsername: string, newUsername: string, newPassword: string) => {
    try {
      // 1. Rename DelegateAccount
      const oldDocId = oldUsername.trim().toLowerCase();
      const newDocId = newUsername.trim().toLowerCase();
      
      const accSnap = await getDoc(doc(db, 'delegate_accounts', oldDocId));
      if (!accSnap.exists()) {
        setUserMessage('لم يتم العثور على حساب المندوب.');
        return;
      }
      
      const accData = accSnap.data() as DelegateAccount;
      const batch = writeBatch(db);
      
      // Update Account
      batch.delete(doc(db, 'delegate_accounts', oldDocId));
      batch.set(doc(db, 'delegate_accounts', newDocId), { ...accData, delegateName: newName, username: newUsername, password: newPassword });
      
      // Update Sales Entries
      const salesSnap = await getDocs(query(collection(db, 'sales_entries'), where('delegateName', '==', oldName)));
      salesSnap.forEach(d => batch.update(d.ref, { delegateName: newName }));
      
      // Update Targets
      const targetsSnap = await getDocs(query(collection(db, 'delegate_targets'), where('delegateName', '==', oldName)));
      targetsSnap.forEach(d => batch.update(d.ref, { delegateName: newName }));
      
      // Update Locks
      const locksSnap = await getDocs(query(collection(db, 'target_locks'), where('delegateName', '==', oldName)));
      locksSnap.forEach(d => batch.update(d.ref, { delegateName: newName }));

      // Update Alerts/Notes (assuming collections exist)
      const alertsSnap = await getDocs(query(collection(db, 'delegate_alerts'), where('delegateName', '==', oldName)));
      alertsSnap.forEach(d => batch.update(d.ref, { delegateName: newName }));
      
      const notesSnap = await getDocs(query(collection(db, 'delegate_notes'), where('delegateName', '==', oldName)));
      notesSnap.forEach(d => batch.update(d.ref, { delegateName: newName }));

      await batch.commit();
      setUserMessage(`تم تحديث بيانات المندوب إلى ${newName} بنجاح.`);
    } catch (e) {
      console.error('Error updating delegate identity:', e);
      setUserMessage('حدث خطأ أثناء التحديث.');
    }
  };

  const resetDelegateAccount = async (username: string) => {
    try {
      const accSnap = await getDoc(doc(db, 'delegate_accounts', username.trim().toLowerCase()));
      if (!accSnap.exists()) {
        setUserMessage('لم يتم العثور على حساب المندوب.');
        return;
      }
      const accData = accSnap.data() as DelegateAccount;

      const batch = writeBatch(db);
      
      // Delete old
      batch.delete(doc(db, 'delegate_accounts', username.trim().toLowerCase()));
      
      // Create new default
      const defaultUser = 'del2-9';
      batch.set(doc(db, 'delegate_accounts', defaultUser), {
        username: defaultUser,
        password: '1234',
        delegateName: 'مندوب',
        monthlyTargetKg: 1000,
        isAdmin: false
      });

      // Reset targets for this delegateName
      const targetsSnap = await getDocs(query(collection(db, 'delegate_targets'), where('delegateName', '==', accData.delegateName)));
      targetsSnap.forEach(d => batch.update(d.ref, { dailyTargetWeightKg: 1 }));

      await batch.commit();
      setUserMessage('تم إعادة تعيين حساب المندوب بنجاح إلى الإعدادات الأولية ✅');
    } catch (e) {
      console.error('Error resetting delegate account:', e);
      setUserMessage('حدث خطأ أثناء إعادة التعيين.');
    }
  };

  const deleteDelegateAccount = async (username: string) => {
    try {
      const docId = username.trim().toLowerCase();
      // Delete the account document completely
      await deleteDoc(doc(db, 'delegate_accounts', docId));

      // Update local state to remove the deleted account
      setDelegateAccounts(prev => prev.filter(acc => acc.username.toLowerCase() !== docId));
      
      setUserMessage('تم حذف حساب المندوب تماماً من النظام');
    } catch (e) {
      console.error('Error deleting account:', e);
      setUserMessage('حدث خطأ أثناء الحذف.');
    }
  };

  const exportBackupData = () => {
    const backupData = { salesEntries, delegateTargets, delegateAccounts, targetLockMap };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${selectedDate}.json`;
    a.click();
    a.remove();
    setUserMessage('تم تصدير النسخة الاحتياطية بنجاح ✅');
  };

  const restoreBackupData = (backupObj: any): boolean => {
    try {
      if (!backupObj) return false;
      if (backupObj.salesEntries) setSalesEntries(backupObj.salesEntries);
      setUserMessage('تمت استعادة البيانات بنجاح ✅');
      return true;
    } catch (e) {
      setUserMessage('فشلت الاستعادة.');
      return false;
    }
  };

  const fetchUnifiedDataFromFirestore = async () => {
    if (isDataRefreshing) return;
    setIsDataRefreshing(true);
    setIsNetworkDelayed(false);

    // Latency-Aware Timer: Only display delay indicator if network takes > 350ms
    const delayTimer = setTimeout(() => {
      setIsNetworkDelayed(true);
    }, 350);

    try {
      const isSauceUser =
        currentUser?.role === 'sauceOnly' ||
        currentUser?.username?.toLowerCase() === 'mohammedsauce' ||
        currentUser?.name === 'محمد الصلصات';

      // 1. Fetch live sales entries and archive in parallel
      const [salesSnap, archiveSnap] = await Promise.all([
        getDocs(collection(db, 'sales_entries')),
        getDocs(collection(db, 'sales_entries_archive')).catch(() => null),
      ]);

      const incomingMap = new globalThis.Map<string, SalesEntry>();
      if (archiveSnap) {
        archiveSnap.forEach((docSnap) => {
          const data = docSnap.data() as SalesEntry;
          if (data && data.id) {
            incomingMap.set(data.id, data);
          }
        });
      }
      salesSnap.forEach((docSnap) => {
        const data = docSnap.data() as SalesEntry;
        if (data && data.id) {
          incomingMap.set(data.id, data);
        }
      });

      // Synchronously update allSalesEntries and salesEntries without blanking
      const mergedArray = Array.from(incomingMap.values());
      setAllSalesEntries(mergedArray);

      // Update salesEntries matching the current date & delegate
      let currentFiltered = mergedArray.filter((e) => e.dateString === selectedDate);
      if (!currentUser?.isAdmin && !isSauceUser) {
        currentFiltered = currentFiltered.filter(
          (e) => e.delegateName?.trim().toLowerCase() === currentUser?.name?.trim().toLowerCase()
        );
      } else if (selectedDelegate !== 'الكل' && !isSauceUser) {
        currentFiltered = currentFiltered.filter(
          (e) => e.delegateName?.trim().toLowerCase() === selectedDelegate?.trim().toLowerCase()
        );
      }
      setSalesEntries(currentFiltered);

      try {
        localStorage.setItem('cache_all_sales_entries', JSON.stringify(mergedArray));
        localStorage.setItem('cache_sales_entries', JSON.stringify(currentFiltered));
      } catch {}

      // 2. Fetch delegate targets
      let targetsQuery;
      if (currentUser?.isAdmin || isSauceUser) {
        targetsQuery = collection(db, 'delegate_targets');
      } else {
        targetsQuery = query(
          collection(db, 'delegate_targets'),
          where('delegateName', '==', currentUser?.name || '')
        );
      }
      const targetsSnap = await getDocs(targetsQuery);
      const incomingTargets: DelegateTarget[] = [];
      targetsSnap.forEach((docSnap) => {
        const data = docSnap.data() as DelegateTarget;
        if (data) incomingTargets.push({ ...data, id: docSnap.id });
      });
      setDelegateTargets(incomingTargets);
      try {
        localStorage.setItem('cache_delegate_targets', JSON.stringify(incomingTargets));
      } catch {}

      // 3. Fetch target locks
      let locksQuery;
      if (currentUser?.isAdmin || isSauceUser) {
        locksQuery = collection(db, 'target_locks');
      } else {
        locksQuery = query(
          collection(db, 'target_locks'),
          where('delegateName', '==', currentUser?.name || '')
        );
      }
      const locksSnap = await getDocs(locksQuery);
      const incomingLocks: Record<string, number> = {};
      locksSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const delName = data.delegateName || docSnap.id;
        if (delName && data.lockTimestamp) {
          incomingLocks[delName] = Number(data.lockTimestamp);
        }
      });
      setTargetLockMap(incomingLocks);
      try {
        localStorage.setItem('cache_target_locks', JSON.stringify(incomingLocks));
      } catch {}

      // 4. Fetch delegate accounts
      const accountsSnap = await getDocs(collection(db, 'delegate_accounts'));
      const accs: DelegateAccount[] = [];
      accountsSnap.forEach((docSnap) => {
        const data = docSnap.data() as DelegateAccount;
        if (data && data.username) accs.push(data);
      });
      if (accs.length > 0) {
        const merged = [...accs];
        DEFAULT_DELEGATE_ACCOUNTS_ENTITIES.forEach((defAcc) => {
          if (!merged.some((a) => a.username.toLowerCase() === defAcc.username.toLowerCase())) {
            merged.push(defAcc);
          }
        });
        setDelegateAccounts(merged);
      }

      // 5. Fetch products catalog
      const prodsSnap = await getDocs(collection(db, 'products_catalog'));
      const prods: ProductItem[] = [];
      prodsSnap.forEach((docSnap) => {
        const data = docSnap.data() as ProductItem;
        if (data) prods.push({ ...data, id: docSnap.id });
      });
      if (prods.length > 0) {
        setProductsList(prods);
        try {
          localStorage.setItem('app_products_catalog', JSON.stringify(prods));
        } catch {}
      }

      // 6. Fetch routes
      const routesSnap = await getDocs(collection(db, 'routes'));
      const loadedRoutes: RouteItem[] = [];
      routesSnap.forEach((docSnap) => {
        loadedRoutes.push({ id: docSnap.id, ...docSnap.data() } as RouteItem);
      });
      if (loadedRoutes.length > 0) {
        setRoutes(loadedRoutes);
      }

      // Always display a clear, reassuring success notification confirming refresh
      const adminDetailedMsg = currentUser.isAdmin
        ? 'تم تحديث ومزامنة كافة البيانات والفواتير بنجاح من Firestore ☁️'
        : 'تم تحديث ومزامنة كافة البيانات والفواتير بنجاح 🔄✅';

      addToast({
        title: 'تم تحديث البيانات',
        message: adminDetailedMsg,
        type: 'success',
      });
      setUserMessage(adminDetailedMsg);
    } catch (err: any) {
      console.error('Error fetching unified data from Firestore:', err);
      const adminErrMsg = currentUser.isAdmin
        ? 'تعذر الاتصال بـ Firestore، تم تحميل البيانات من الذاكرة المؤقتة (Cache) 💾⚠️'
        : 'تعذر الاتصال بالخادم، تم الإبقاء على بياناتك الحالية دون أي مساس.';
      addToast({
        title: 'تنبيه',
        message: adminErrMsg,
        type: 'info',
      });
    } finally {
      clearTimeout(delayTimer);
      setIsDataRefreshing(false);
      setIsNetworkDelayed(false);
    }
  };

  const countUniqueInvoices = (
    date: string,
    delegateName: string,
    priceMode: 'retail' | 'wholesale'
  ): number => {
    const filtered = salesEntries.filter(
      (e) =>
        e.dateString === date &&
        (delegateName === 'الكل' || e.delegateName === delegateName) &&
        e.priceMode === priceMode
    );
    const uniqueInvoiceIds = new Set(filtered.map(getInvoiceKey));
    return uniqueInvoiceIds.size;
  };

  return (
    <SalesContext.Provider
      value={{
        currentUser,
        countUniqueInvoices,
        selectedDate,
        selectedDelegate,
        loginTimestamp,
        availableAccounts,
        delegatesList,
        delegateAccounts,
        delegateTargets,
        salesEntries,
        allSalesEntries,
        rawSavedEntries,
        savedEntries,
        categoryReports,
        userMessage,
        targetLockMap,
        isDarkMode,
        isLoggedIn,
        isOnline,
        pendingSyncCount,
        isPowerSavingMode,
        isFirestoreQuotaExceeded,
        syncFailureAlert,
        toggleDarkMode,
        togglePowerSavingMode,
        setUserMessage,
        loginAccount,
        loginWithCredentials,
        logout,
        setSelectedDelegate,
        setSelectedDate,
        saveSalesEntries,
        deleteSalesEntry,
        updateSalesEntry,
        updateDelegateTarget,
        batchUpdateDelegateTargets,
        getDelegateLockStatus,
        unlockDelegateTargetManually,
        saveDelegateAccount,
        addDelegateAccount,
        updateDelegateIdentity,
        resetDelegateAccount,
        deleteDelegateAccount,
        toasts,
        addToast,
        removeToast,
        exportBackupData,
        restoreBackupData,
        fetchUnifiedDataFromFirestore,
        isDataRefreshing,
        isNetworkDelayed,
        checkAndTriggerMilestoneToasts,
        productsList,
        inventoryStockByCode,
        importProductsFromExcel,
        importRoutesFromExcel,
        updateProduct,
        uploadProductImage,
        addProduct,
        deleteProduct,
        deleteAllProducts,
        giftPromotions,
        addGiftPromotion,
        updateGiftPromotion,
        deleteGiftPromotion,
        syncData: syncPendingEntries,
        prefilledEntryData,
        showQuickAdd,
        setPrefilledEntryData,
        setShowQuickAdd,
        routes,
        activeTab,
        setActiveTab,
        inventoryLogs,
        deleteInventoryLog,
        resetInventory,
        processOrder,
        todaySalesByProductName,
        getProductLiveStock,
      }}
    >
      {children}
    </SalesContext.Provider>
  );
};

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) {
    throw new Error('useSales must be used within SalesProvider');
  }
  return context;
};