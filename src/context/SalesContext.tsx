import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, query, where, getDocs, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import localData from '../../data.json';
import * as XLSX from 'xlsx';
import {
  UserAccount,
  DelegateTarget,
  DelegateAccount,
  SalesEntry,
  CategoryReportItem,
  ToastNotification,
  DelegateEvaluation,
  DailyEvaluationRecord,
  ProductItem,
} from '../types';

export const DEFAULT_CATEGORIES_LIST = [
  'قشطة',
  'جبن 1',
  'جبن 2',
  'حليب بطل',
  'حليب باكيت',
  'جبن بيتزا',
  'دوغ',
  'عصير',
  'لبن',
  'دانيت',
  'حلويات',
  'بيتزا جاهز وبركر ومقرمش',
  'صوصج',
  'خضراوات مجمدة و فنكر',
  'صلصات',
  'منتجات بروتين',
  'منتج جديد',
];

export const DEFAULT_DELEGATE_ACCOUNTS_ENTITIES: DelegateAccount[] = [
  { username: 'YASIR', password: '377377', delegateName: 'الأدمن', monthlyTargetKg: 0, isAdmin: true },
  { username: 'najikala', password: '1111', delegateName: 'ناجي خلف', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'kldkala', password: '2222', delegateName: 'خلدون جمال', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'mohkala', password: '2222', delegateName: 'محمد جاسم', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'bkrkala', password: '3333', delegateName: 'بكر بدران', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'fslkala', password: '4444', delegateName: 'فيصل فؤاد', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'sbhkala', password: '5555', delegateName: 'صباح', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'del7', password: '1234', delegateName: 'مندوب عام 1', monthlyTargetKg: 1000, isAdmin: false },
  { username: 'del8', password: '1234', delegateName: 'مندوب عام 2', monthlyTargetKg: 1000, isAdmin: false },
];

const DELEGATE_NAME_MAP: Record<string, string> = {
  'مندوب 1': 'ناجي خلف',
  'مندوب 2': 'خلدون جمال',
  'مندوب 3': 'محمد جاسم',
  'مندوب 4': 'بكر بدران',
  'مندوب 5': 'فيصل فؤاد',
  'مندوب 6': 'صباح',
  'مندوب 7': 'مندوب عام 1',
  'مندوب 8': 'مندوب عام 2',
};

const mapDelegateName = (name: string): string => {
  return DELEGATE_NAME_MAP[name] || name;
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
  rawSavedEntries: SalesEntry[];
  savedEntries: SalesEntry[];
  categoryReports: CategoryReportItem[];
  userMessage: string | null;
  targetLockMap: Record<string, number>;
  isDarkMode: boolean;
  isLoggedIn: boolean;
  isOnline: boolean;
  pendingSyncCount: number;
  isDataSaverMode: boolean;
  toggleDarkMode: () => void;
  toggleDataSaverMode: () => void;
  setUserMessage: (msg: string | null) => void;
  loginAccount: (acc: UserAccount) => void;
  loginWithCredentials: (username: string, password: string) => { success: boolean; error?: string };
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
  deleteDelegateAccount: (username: string) => void;
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
  getDailyDelegateEvaluations: (targetDate?: string) => {
    evaluations: DelegateEvaluation[];
    bestDelegate: DelegateEvaluation | null;
  };
  getDelegateEvaluations: (targetDate?: string, periodType?: 'daily' | 'weekly' | 'monthly') => {
    evaluations: DelegateEvaluation[];
    bestDelegate: DelegateEvaluation | null;
    periodStartStr: string;
    periodEndStr: string;
  };
  dailyEvaluationsHistory: DailyEvaluationRecord[];
  saveDailyEvaluationsToFirestore: (targetDate?: string) => Promise<void>;
  fetchUnifiedDataFromFirestore: () => Promise<void>;
  productsList: ProductItem[];
  importProductsFromExcel: (file: File) => Promise<void>;
  updateProduct: (id: string, updatedData: Partial<ProductItem>) => void;
  addProduct: () => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  deleteAllProducts: () => Promise<void>;
  syncData: () => Promise<void>;
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

export const SalesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const todayDateString = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [selectedDate, setSelectedDate] = useState<string>(todayDateString);

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
    };
  });

  const [selectedDelegate, setSelectedDelegate] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('app_current_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.isAdmin) {
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

  const [delegateTargets, setDelegateTargets] = useState<DelegateTarget[]>([]);
  const [salesEntries, setSalesEntries] = useState<SalesEntry[]>([]);
  const [allSalesEntries, setAllSalesEntries] = useState<SalesEntry[]>([]);
  const [targetLockMap, setTargetLockMap] = useState<Record<string, number>>({});
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [dailyEvaluationsHistory, setDailyEvaluationsHistory] = useState<DailyEvaluationRecord[]>([]);

  const DEFAULT_PRODUCTS_LIST: ProductItem[] = [
    { id: 'p1', productName: 'قشطة عربية فاخرة', cartonQuantity: 12, categoryName: 'قشطة', productCode: 'QSH-001', pieceWeightKg: 0.200 },
    { id: 'p2', productName: 'جبنة بيضاء بلدية', cartonQuantity: 24, categoryName: 'أجبان', productCode: 'CHS-002', pieceWeightKg: 0.500 },
    { id: 'p3', productName: 'زبدة طبيعية نقية', cartonQuantity: 10, categoryName: 'زبدة', productCode: 'BUT-003', pieceWeightKg: 0.250 },
    { id: 'p4', productName: 'قشطة بلدي طازجة', cartonQuantity: 15, categoryName: 'قشطة', productCode: 'QSH-004', pieceWeightKg: 0.300 },
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
    const unsub = onSnapshot(
      collection(db, 'products_catalog'),
      (snapshot) => {
        const products: ProductItem[] = [];
        if (!snapshot.empty) {
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as ProductItem;
            if (data) {
              products.push({ ...data, id: docSnap.id });
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
        console.error('Products listener error:', err);
      }
    );
    return () => unsub();
  }, []);

  const importProductsFromExcel = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

      const parsedProducts: ProductItem[] = jsonData.map((row, index) => {
        const productName = row['اسم المنتج'] || row['المنتج'] || row['اسم'] || row['Product Name'] || row['Product'] || `منتج ${index + 1}`;
        const cartonQuantity = row['عدد في الكارتون'] || row['عدد الكارتون'] || row['Carton Qty'] || row['Qty'] || 12;
        const categoryName = row['صنف المنتج'] || row['الصنف'] || row['الفئة'] || row['Category'] || 'قشطة';
        const productCode = row['كود المنتج'] || row['الكود'] || row['Code'] || `PRD-${100 + index}`;
        const pieceWeightKg = row['وزن القطعة الواحدة'] || row['وزن القطعة'] || row['الوزن'] || row['Piece Weight'] || row['Weight'] || 0.2;
        const retailPrice = row['سعر المفرد'] || row['سعر القطعة مفرد'] || row['Retail Price'] || 0;
        const wholesalePrice = row['سعر الجملة'] || row['سعر القطعة جملة'] || row['Wholesale Price'] || 0;
        const stockCartons = row['المخزن'] || row['كارتون بالمخزن'] || row['عدد كارتون بالمخزن'] || row['Stock'] || 0;
        const imageUrl = row['صورة'] || row['صورة المنتج'] || row['Image'] || '';

        return {
          id: `prod_${Date.now()}_${index}`,
          productName: String(productName),
          cartonQuantity: Number(cartonQuantity) || cartonQuantity,
          categoryName: String(categoryName),
          productCode: String(productCode),
          pieceWeightKg: Number(pieceWeightKg) || pieceWeightKg,
          retailPrice: Number(retailPrice) || 0,
          wholesalePrice: Number(wholesalePrice) || 0,
          stockCartons: Number(stockCartons) || 0,
          imageUrl: String(imageUrl),
          isAvailable: true,
        };
      });

      if (parsedProducts.length > 0) {
        // Update local state immediately for fast feedback
        setProductsList(parsedProducts);
        try {
          localStorage.setItem('app_products_catalog', JSON.stringify(parsedProducts));
        } catch {}
        
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
            insertBatch.set(docRef, prod);
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

        setUserMessage(`تم استيراد ${parsedProducts.length} منتج بنجاح من ملف الإكسل 📊✅`);
      } else {
        setUserMessage('لم يتم العثور على بيانات صالحة في ملف الإكسل المرفق.');
      }
    } catch (error) {
      console.error('Error importing excel:', error);
      setUserMessage('حدث خطأ أثناء قراءة ملف الإكسل. تأكد من صحة الملف.');
    }
  };

  const updateProduct = async (id: string, updatedData: Partial<ProductItem>) => {
    // Update local state immediately
    setProductsList(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...updatedData } : p);
      try {
        localStorage.setItem('app_products_catalog', JSON.stringify(next));
      } catch {}
      return next;
    });

    // Save to Firestore
    try {
      const docRef = doc(db, 'products_catalog', id);
      await setDoc(docRef, updatedData, { merge: true });
    } catch (err) {
      console.error('Error updating product in Firestore:', err);
    }
    
    setUserMessage('تم تحديث بيانات المنتج بنجاح ✅');
  };

  const addProduct = async () => {
    const newProduct: ProductItem = {
      id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      productName: 'منتج جديد',
      cartonQuantity: 1,
      categoryName: 'عام',
      productCode: `PRD-${Date.now().toString().slice(-4)}`,
      pieceWeightKg: 1,
      retailPrice: 0,
      wholesalePrice: 0,
      stockCartons: 0,
      imageUrl: '',
      isAvailable: true,
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
      await setDoc(docRef, newProduct);
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
      for (const entry of pending) {
        try {
          const entryRef = doc(db, 'sales_entries', entry.id);
          await setDoc(entryRef, entry, { merge: true });
        } catch (err) {
          console.error('Failed to sync entry:', entry.id, err);
          remaining.push(entry);
        }
      }
      savePendingQueue(remaining);
      if (remaining.length === 0 && pending.length > 0) {
        setUserMessage('تمت مزامنة جميع المبيعات المعلقة مع قاعدة البيانات بنجاح 🔄✅');
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

  const [isDataSaverMode, setIsDataSaverMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('is_data_saver_mode') === 'true';
    } catch {
      return false;
    }
  });

  const toggleDataSaverMode = () => {
    setIsDataSaverMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem('is_data_saver_mode', String(next));
      } catch {}
      setUserMessage(next ? 'تم تفعيل وضع توفير البيانات 📶📉' : 'تم إيقاف وضع توفير البيانات 📶📈');
      return next;
    });
  };

  // 5-minute periodic background polling / data refresh
  useEffect(() => {
    const pollingInterval = setInterval(() => {
      if (navigator.onLine && !isDataSaverMode) {
        syncPendingEntries();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(pollingInterval);
  }, [isDataSaverMode]);

  useEffect(() => {
    const unsubAll = onSnapshot(collection(db, 'sales_entries'), (snapshot) => {
      const entriesMap = new Map<string, SalesEntry>();
      snapshot.forEach((doc) => {
        const data = doc.data() as SalesEntry;
        if (data && data.id) {
          entriesMap.set(data.id, data);
        }
      });
      setAllSalesEntries(Array.from(entriesMap.values()));
    }, (err) => {
      console.error('All sales entries listener error:', err);
    });
    return () => unsubAll();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'daily_evaluations'), (snapshot) => {
      const records: DailyEvaluationRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as DailyEvaluationRecord;
        if (data) {
          records.push({ ...data, id: docSnap.id });
        }
      });
      setDailyEvaluationsHistory(records);
    }, (err) => {
      console.error('Daily evaluations history error:', err);
    });
    return () => unsub();
  }, []);

  const saveDailyEvaluationsToFirestore = async (targetDate?: string) => {
    const queryDate = targetDate || selectedDate;
    const { evaluations } = getDelegateEvaluations(queryDate, 'daily');
    if (evaluations.length === 0) return;

    try {
      const batch = writeBatch(db);
      evaluations.forEach((item) => {
        const id = `${queryDate}_${item.delegateName.trim()}`;
        const ref = doc(db, 'daily_evaluations', id);
        const record: DailyEvaluationRecord = {
          id,
          dateString: queryDate,
          delegateName: item.delegateName,
          totalScore: item.totalScore,
          totalWeightKg: item.totalWeightKg || item.totalKg,
          totalPieces: item.totalPieces,
          breakdown: item.breakdown || {
            timeScore: 0,
            salesScore: 0,
            itemsScore: 0,
            piecesScore: 0,
            cartonsScore: 0,
            targetCategoriesScore: 0,
          },
          timestamp: Date.now(),
        };
        batch.set(ref, record, { merge: true });
      });
      await batch.commit();
      setUserMessage(`تم حفظ التقييمات اليومية لتاريخ ${queryDate} في قاعدة البيانات بنجاح ✅`);
    } catch (e) {
      console.error('Error saving daily evaluations to firestore:', e);
      setUserMessage('حدث خطأ أثناء حفظ التقييمات اليومية في قاعدة البيانات.');
    }
  };

  useEffect(() => {
    if (userMessage) {
      const timer = setTimeout(() => {
        setUserMessage(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [userMessage]);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

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
  };

  useEffect(() => {
    let salesQuery;
    if (currentUser.isAdmin) {
      if (selectedDelegate === 'الكل') {
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
        where('delegateName', '==', currentUser.name)
      );
    }

    const unsubSales = onSnapshot(
      salesQuery,
      (snapshot) => {
        const entriesMap = new Map<string, SalesEntry>();
        snapshot.forEach((doc) => {
          const data = doc.data() as SalesEntry;
          if (data && data.id) {
            entriesMap.set(data.id, data);
          }
        });
        const pending = getPendingQueue();
        pending.forEach((entry) => {
          if (entry.dateString === selectedDate) {
            if (currentUser.isAdmin) {
              if (selectedDelegate === 'الكل' || entry.delegateName?.trim().toLowerCase() === selectedDelegate?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            } else {
              if (entry.delegateName?.trim().toLowerCase() === currentUser.name?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            }
          }
        });
        setSalesEntries(Array.from(entriesMap.values()));
      },
      (err) => {
        console.error('Sales listener error (offline fallback active):', err);
        const entriesMap = new Map<string, SalesEntry>();
        const pending = getPendingQueue();
        pending.forEach((entry) => {
          if (entry.dateString === selectedDate) {
            if (currentUser.isAdmin) {
              if (selectedDelegate === 'الكل' || entry.delegateName?.trim().toLowerCase() === selectedDelegate?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            } else {
              if (entry.delegateName?.trim().toLowerCase() === currentUser.name?.trim().toLowerCase()) {
                entriesMap.set(entry.id, entry);
              }
            }
          }
        });
        setSalesEntries(Array.from(entriesMap.values()));
      }
    );

    let targetsQuery;
    if (currentUser.isAdmin) {
      targetsQuery = collection(db, 'delegate_targets');
    } else {
      targetsQuery = query(
        collection(db, 'delegate_targets'),
        where('delegateName', '==', currentUser.name)
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
      },
      (err) => {
        console.error('Targets listener error:', err);
      }
    );

    let locksQuery;
    if (currentUser.isAdmin) {
      locksQuery = collection(db, 'target_locks');
    } else {
      locksQuery = query(
        collection(db, 'target_locks'),
        where('delegateName', '==', currentUser.name)
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
      },
      (err) => {
        console.error('Locks listener error:', err);
      }
    );

    if (currentUser.isAdmin) {
      getDocs(collection(db, 'delegate_accounts'))
        .then((snapshot) => {
          const accs: DelegateAccount[] = [];
          snapshot.forEach((doc) => {
            const data = doc.data() as DelegateAccount;
            if (data && data.username) {
              accs.push(data);
            }
          });
          if (accs.length > 0) {
            setDelegateAccounts(accs);
          }
        })
        .catch((err) => {
          console.error('Accounts fetch error:', err);
        });
    }

    return () => {
      unsubSales();
      unsubTargets();
      unsubLocks();
    };
  }, [currentUser.isAdmin, currentUser.name, selectedDate, selectedDelegate]);

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

    const newCommittedEntries: SalesEntry[] = newEntriesData.map((data, idx) => {
      const id = `${now}_${idx}_${Math.random().toString(36).substr(2, 5)}`;
      return { ...data, id, timestamp: now };
    });

    if (!navigator.onLine) {
      const pending = getPendingQueue();
      savePendingQueue([...pending, ...newCommittedEntries]);
      setSalesEntries((prev) => [...prev, ...newCommittedEntries]);
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

      await batch.commit();

      setUserMessage('تم حفظ المبيعات بنجاح ومزامنتها فوراً مع الأدمن ✅');
      checkAndTriggerMilestoneToasts(activeDelegateName, prevWeight, newWeight, dailyTargetKg);
    } catch (e) {
      console.error('Error saving sales entries, queueing offline:', e);
      const pending = getPendingQueue();
      savePendingQueue([...pending, ...newCommittedEntries]);
      setSalesEntries((prev) => [...prev, ...newCommittedEntries]);
      setUserMessage('تعذر الاتصال بالخادم. تم حفظ المبيعات محلياً وسيتم مزامنتها لاحقاً 📴');
    }
  };

  const deleteSalesEntry = async (id: string) => {
    setSalesEntries(prev => prev.filter(e => e.id !== id));
    try {
      await deleteDoc(doc(db, 'sales_entries', id));
      setUserMessage('تم حذف المنتج المسجل بنجاح');
    } catch (e) {
      console.error('Error deleting entry:', e);
    }
  };

  const updateSalesEntry = async (id: string, updatedData: Partial<SalesEntry>) => {
    setSalesEntries(prev => prev.map(e => e.id === id ? { ...e, ...updatedData } : e));
    try {
      const entryRef = doc(db, 'sales_entries', id);
      await setDoc(entryRef, updatedData, { merge: true });
      setUserMessage('تم تعديل بيانات المنتج المسجل بنجاح');
    } catch (e) {
      console.error('Error updating entry:', e);
    }
  };

  const availableAccounts = useMemo(() => {
    const accs: UserAccount[] = [
      { name: 'الأدمن', roleName: 'مدير النظام', isAdmin: true, username: 'YASIR', monthlyTargetKg: 0 },
    ];

    delegateAccounts
      .filter((a) => !a.isAdmin)
      .forEach((a) => {
        accs.push({
          name: a.delegateName,
          roleName: 'مندوب مبيعات',
          isAdmin: false,
          username: a.username,
          monthlyTargetKg: a.monthlyTargetKg,
        });
      });

    return accs;
  }, [delegateAccounts]);

  const delegatesList = useMemo(() => {
    return Array.from(new Set(availableAccounts.filter((a) => !a.isAdmin).map((a) => a.name)));
  }, [availableAccounts]);

  const rawSavedEntries = useMemo(() => {
    return salesEntries.filter((entry) => entry.dateString === selectedDate);
  }, [salesEntries, selectedDate]);

  const savedEntries = useMemo(() => {
    if (currentUser.isAdmin) {
      if (selectedDelegate === 'الكل') return rawSavedEntries;
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

    const filteredEntries =
      effectiveDelegate === 'الكل'
        ? rawSavedEntries
        : rawSavedEntries.filter(
            (e) => e.delegateName?.trim().toLowerCase() === effectiveDelegate?.trim().toLowerCase()
          );

    const reports = DEFAULT_CATEGORIES_LIST.map((displayName, index) => {
      const salesWeightForCategory = filteredEntries
        .filter(
          (e) => (e.categoryName || '').trim().toLowerCase() === (displayName || '').trim().toLowerCase()
        )
        .reduce((sum, item) => sum + item.totalWeightKg, 0);

      let targetKg = 0;

      if (effectiveDelegate !== 'الكل' && effectiveDelegate !== 'الأدمن') {
        const found = delegateTargets.find(
          (t) =>
            t.delegateName?.trim().toLowerCase() === effectiveDelegate?.trim().toLowerCase() &&
            (t.categoryName || '').trim().toLowerCase() === (displayName || '').trim().toLowerCase()
        );
        targetKg = found ? (Number(found.dailyTargetWeightKg) || 0) : 0;
      } else {
        targetKg = delegatesList.reduce((sum, del) => {
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

    return reports.sort((a, b) => (a.percentage !== b.percentage ? a.percentage - b.percentage : a.categoryId - b.categoryId));
  }, [currentUser, selectedDelegate, rawSavedEntries, delegateTargets]);

  const loginAccount = (account: UserAccount) => {
    const normalizedAccount: UserAccount = {
      ...account,
      name: mapDelegateName(account.name),
    };
    setCurrentUser(normalizedAccount);
    const now = Date.now();
    setLoginTimestamp(now);
    if (!normalizedAccount.isAdmin) {
      setSelectedDelegate(normalizedAccount.name);
    } else {
      setSelectedDelegate('الكل');
    }
    setIsLoggedIn(true);
    localStorage.setItem('app_is_logged_in', 'true');
    localStorage.setItem('app_current_user', JSON.stringify(normalizedAccount));
    setUserMessage(`تم تسجيل الدخول بنجاح كـ: ${normalizedAccount.name}`);
  };

  const loginWithCredentials = (
    usernameInput: string,
    passwordInput: string
  ): { success: boolean; error?: string } => {
    const u = usernameInput.trim().toLowerCase();
    const p = passwordInput.trim();

    const matched = delegateAccounts.find(
      (it) => (it.username.toLowerCase() === u || it.delegateName.toLowerCase() === u) && it.password === p
    );

    if (matched) {
      const userAcc: UserAccount = {
        name: matched.delegateName,
        roleName: matched.isAdmin ? 'مدير النظام' : 'مندوب مبيعات',
        isAdmin: matched.isAdmin,
        username: matched.username,
        monthlyTargetKg: matched.monthlyTargetKg,
      };
      loginAccount(userAcc);
      return { success: true };
    }

    if (u === 'yasir' && p === '377377') {
      const adminAcc: UserAccount = {
        name: 'الأدمن',
        roleName: 'مدير النظام',
        isAdmin: true,
        username: 'YASIR',
        monthlyTargetKg: 0,
      };
      loginAccount(adminAcc);
      return { success: true };
    }

    return { success: false, error: 'اسم المستخدم أو الرمز السري غير صحيح' };
  };

  const logout = () => {
    setIsLoggedIn(false);
    localStorage.setItem('app_is_logged_in', 'false');
    localStorage.removeItem('app_current_user');
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

      if (monthlyTargetKg !== undefined) {
        const accMatch = delegateAccounts.find(
          (a) => a.delegateName?.trim().toLowerCase() === delegateName?.trim().toLowerCase()
        );
        if (accMatch) {
          const updatedAcc = { ...accMatch, monthlyTargetKg, targetSetTimestamp: now };
          const accRef = doc(db, 'delegate_accounts', accMatch.username.toLowerCase());
          batch.set(accRef, updatedAcc, { merge: true });
        }
      }

      const lockDocId = delegateName.replace(/[\/\s]/g, '_');
      const lockRef = doc(db, 'target_locks', lockDocId);
      batch.set(
        lockRef,
        { delegateName, lockTimestamp: now, updatedAt: new Date(now).toISOString() },
        { merge: true }
      );

      batch.commit();
      setUserMessage(`تم تثبيت وتحديث التاركت للمندوب (${delegateName}) لمدة 31 يوماً بنجاح ✅`);
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

  const deleteDelegateAccount = async (username: string) => {
    try {
      const docId = username.trim().toLowerCase();
      await deleteDoc(doc(db, 'delegate_accounts', docId));
      setUserMessage('تم حذف حساب المندوب بنجاح');
    } catch (e) {
      console.error('Error deleting account:', e);
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

  const getDelegateEvaluations = (
    targetDate?: string,
    periodType: 'daily' | 'weekly' | 'monthly' = 'daily'
  ) => {
    const queryDate = targetDate || selectedDate;

    if (periodType === 'weekly') {
      const d = new Date(queryDate);
      const dayOfWeek = d.getDay();
      const diffToStart = d.getDate() - dayOfWeek;
      const startOfWeek = new Date(new Date(queryDate).setDate(diffToStart)).toISOString().split('T')[0];

      const weekDates: string[] = [];
      let curr = new Date(startOfWeek);
      const end = new Date(queryDate);
      while (curr <= end) {
        weekDates.push(curr.toISOString().split('T')[0]);
        curr.setDate(curr.getDate() + 1);
      }

      const delegateWeekMap = new Map<string, { scores: number[]; totalKg: number; totalPieces: number; breakdowns: any[] }>();
      delegatesList.forEach((del) => {
        delegateWeekMap.set(del, { scores: [], totalKg: 0, totalPieces: 0, breakdowns: [] });
      });

      weekDates.forEach((dateStr) => {
        const savedForDate = dailyEvaluationsHistory.filter((r: DailyEvaluationRecord) => r.dateString === dateStr);
        if (savedForDate.length > 0) {
          savedForDate.forEach((rec: DailyEvaluationRecord) => {
            const cur = delegateWeekMap.get(rec.delegateName) || { scores: [], totalKg: 0, totalPieces: 0, breakdowns: [] };
            cur.scores.push(rec.totalScore);
            cur.totalKg += rec.totalWeightKg;
            cur.totalPieces += rec.totalPieces;
            cur.breakdowns.push(rec.breakdown);
            delegateWeekMap.set(rec.delegateName, cur);
          });
        } else {
          const dayEntries = allSalesEntries.filter((e) => e.dateString === dateStr);
          delegatesList.forEach((delName) => {
            const delEntries = dayEntries.filter((e) => e.delegateName?.trim().toLowerCase() === delName.trim().toLowerCase());
            const wKg = delEntries.reduce((s, e) => s + e.totalWeightKg, 0);
            const pPieces = delEntries.reduce((s, e) => s + e.quantity, 0);
            if (delEntries.length > 0) {
              const cur = delegateWeekMap.get(delName) || { scores: [], totalKg: 0, totalPieces: 0, breakdowns: [] };
              const estScore = Math.min(100, Math.round((wKg / 800) * 80 + 20));
              cur.scores.push(estScore);
              cur.totalKg += wKg;
              cur.totalPieces += pPieces;
              cur.breakdowns.push({ timeScore: 10, salesScore: 15, itemsScore: 15, piecesScore: 15, cartonsScore: 15, targetCategoriesScore: 15 });
              delegateWeekMap.set(delName, cur);
            }
          });
        }
      });

      const evaluations: DelegateEvaluation[] = delegatesList.map((delName) => {
        const data = delegateWeekMap.get(delName) || { scores: [], totalKg: 0, totalPieces: 0, breakdowns: [] };
        const avgScore = data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 0;

        const avgBreakdown = { timeScore: 0, salesScore: 0, itemsScore: 0, piecesScore: 0, cartonsScore: 0, targetCategoriesScore: 0 };
        if (data.breakdowns.length > 0) {
          data.breakdowns.forEach((b) => {
            avgBreakdown.timeScore += b.timeScore || 0;
            avgBreakdown.salesScore += b.salesScore || 0;
            avgBreakdown.itemsScore += b.itemsScore || 0;
            avgBreakdown.piecesScore += b.piecesScore || 0;
            avgBreakdown.cartonsScore += b.cartonsScore || 0;
            avgBreakdown.targetCategoriesScore += b.targetCategoriesScore || 0;
          });
          const len = data.breakdowns.length;
          avgBreakdown.timeScore = Math.round(avgBreakdown.timeScore / len);
          avgBreakdown.salesScore = Math.round(avgBreakdown.salesScore / len);
          avgBreakdown.itemsScore = Math.round(avgBreakdown.itemsScore / len);
          avgBreakdown.piecesScore = Math.round(avgBreakdown.piecesScore / len);
          avgBreakdown.cartonsScore = Math.round(avgBreakdown.cartonsScore / len);
          avgBreakdown.targetCategoriesScore = Math.round(avgBreakdown.targetCategoriesScore / len);
        }

        return {
          delegateName: delName,
          totalScore: avgScore,
          totalWeightKg: data.totalKg,
          totalKg: data.totalKg,
          totalPieces: data.totalPieces,
          breakdown: avgBreakdown,
        };
      });

      evaluations.sort((a, b) => b.totalScore - a.totalScore || (b.totalKg || 0) - (a.totalKg || 0));
      const bestDelegate = evaluations.length > 0 && evaluations[0].totalScore > 0 ? evaluations[0] : null;

      return {
        evaluations,
        bestDelegate,
        periodStartStr: startOfWeek,
        periodEndStr: queryDate,
      };
    }

    let relevantEntries = allSalesEntries;

    if (periodType === 'daily') {
      relevantEntries = allSalesEntries.filter((e) => e.dateString === queryDate);
    } else if (periodType === 'monthly') {
      const yearMonth = queryDate.slice(0, 7);
      relevantEntries = allSalesEntries.filter((e) => e.dateString && e.dateString.startsWith(yearMonth));
    }

    const evaluationsMap = new Map<string, { totalWeightKg: number; totalPieces: number; entriesCount: number; firstEntryTime: number | null }>();
    delegatesList.forEach((del) => {
      evaluationsMap.set(del, { totalWeightKg: 0, totalPieces: 0, entriesCount: 0, firstEntryTime: null });
    });

    relevantEntries.forEach((entry) => {
      const name = entry.delegateName?.trim() || 'غير محدد';
      const cur = evaluationsMap.get(name) || { totalWeightKg: 0, totalPieces: 0, entriesCount: 0, firstEntryTime: null };
      
      cur.totalWeightKg += entry.totalWeightKg || 0;
      cur.totalPieces += entry.quantity || 0;
      cur.entriesCount += 1;

      if (entry.timestamp) {
        if (!cur.firstEntryTime || entry.timestamp < cur.firstEntryTime) {
          cur.firstEntryTime = entry.timestamp;
        }
      }

      evaluationsMap.set(name, cur);
    });

    const baseDayTime = new Date(queryDate).setHours(8, 0, 0, 0);

    const evaluations: DelegateEvaluation[] = delegatesList.map((delName) => {
      const stats = evaluationsMap.get(delName) || { totalWeightKg: 0, totalPieces: 0, entriesCount: 0, firstEntryTime: null };
      
      const delTargetObj = delegateTargets.filter((t) => t.delegateName?.trim().toLowerCase() === delName.trim().toLowerCase());
      const targetSum = delTargetObj.reduce((sum, t) => sum + t.dailyTargetWeightKg, 0) || 800;

      let firstEntryScore = 0;
      if (stats.firstEntryTime) {
        const diffMinutes = (stats.firstEntryTime - baseDayTime) / (1000 * 60);
        if (diffMinutes <= 0) {
          firstEntryScore = 10;
        } else if (diffMinutes <= 120) {
          firstEntryScore = 8;
        } else if (diffMinutes <= 300) {
          firstEntryScore = 5;
        } else {
          firstEntryScore = 2;
        }
      }

      const weightAchievementPct = targetSum > 0 ? Math.min(100, (stats.totalWeightKg / targetSum) * 100) : 0;
      const weightScore = (weightAchievementPct / 100) * 18;

      const entriesScore = Math.min(18, (stats.entriesCount / 5) * 18);
      const piecesScore = Math.min(18, (stats.totalPieces / 50) * 18);
      const totalWeightScore = Math.min(18, (stats.totalWeightKg / 300) * 18);
      const consistencyScore = stats.entriesCount > 0 ? 18 : 0;

      const totalScore = Math.round(firstEntryScore + weightScore + entriesScore + piecesScore + totalWeightScore + consistencyScore);

      return {
        delegateName: delName,
        totalScore: Math.min(100, totalScore),
        totalWeightKg: stats.totalWeightKg,
        totalKg: stats.totalWeightKg,
        totalPieces: stats.totalPieces,
        breakdown: {
          timeScore: Math.round(firstEntryScore * 10),
          salesScore: Math.round(weightScore * 5.5),
          itemsScore: Math.round(entriesScore * 5.5),
          piecesScore: Math.round(piecesScore * 5.5),
          cartonsScore: Math.round(totalWeightScore * 5.5),
          targetCategoriesScore: Math.round(consistencyScore * 5.5),
        },
      };
    });

    evaluations.sort((a, b) => b.totalScore - a.totalScore || (b.totalKg || 0) - (a.totalKg || 0));
    const bestDelegate = evaluations.length > 0 && evaluations[0].totalScore > 0 ? evaluations[0] : null;

    return {
      evaluations,
      bestDelegate,
      periodStartStr: queryDate,
      periodEndStr: queryDate,
    };
  };

  const getDailyDelegateEvaluations = (targetDate?: string) => {
    const res = getDelegateEvaluations(targetDate, 'daily');
    return {
      evaluations: res.evaluations,
      bestDelegate: res.bestDelegate,
    };
  };

  const fetchUnifiedDataFromFirestore = async () => {};

  return (
    <SalesContext.Provider
      value={{
        currentUser,
        selectedDate,
        selectedDelegate,
        loginTimestamp,
        availableAccounts,
        delegatesList,
        delegateAccounts,
        delegateTargets,
        salesEntries,
        rawSavedEntries,
        savedEntries,
        categoryReports,
        userMessage,
        targetLockMap,
        isDarkMode,
        isLoggedIn,
        isOnline,
        pendingSyncCount,
        isDataSaverMode,
        toggleDarkMode,
        toggleDataSaverMode,
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
        deleteDelegateAccount,
        toasts,
        addToast,
        removeToast,
        exportBackupData,
        restoreBackupData,
        getDailyDelegateEvaluations,
        getDelegateEvaluations,
        dailyEvaluationsHistory,
        saveDailyEvaluationsToFirestore,
        fetchUnifiedDataFromFirestore,
        checkAndTriggerMilestoneToasts,
        productsList,
        importProductsFromExcel,
        updateProduct,
        addProduct,
        deleteProduct,
        deleteAllProducts,
        syncData: syncPendingEntries,
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