import React, { useState, useEffect, useMemo } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, query, updateDoc, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { safeOnSnapshot } from '../lib/firestoreUtils';
import { DamagedProductItem, DamagedProductStatus, RouteItem, ProductItem } from '../types';
import { DamagedProductsQCSection } from './DamagedProductsQCSection';
import { DamagedProductsModal } from './DamagedProductsModal';
import { 
  AlertTriangle, 
  PackageX, 
  Coins, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Send, 
  XCircle, 
  TrendingDown, 
  Layers, 
  Sparkles,
  ShieldCheck,
  Info
} from 'lucide-react';
import { formatWithCommas } from '../utils/numberUtils';

export const QCScreen: React.FC = () => {
  const { currentUser, isDarkMode, addToast, delegatesList = [], productsList = [] } = useSales();
  const [damagedProducts, setDamagedProducts] = useState<DamagedProductItem[]>([]);
  const [isDamagedProductModalOpen, setIsDamagedProductModalOpen] = useState(false);
  const [editingDamagedProduct, setEditingDamagedProduct] = useState<DamagedProductItem | null>(null);
  const [routes, setRoutes] = useState<RouteItem[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'damaged_products'));
    const unsub = safeOnSnapshot(
      q,
      (snap: any) => {
        const list: DamagedProductItem[] = [];
        snap.forEach((d: any) => {
          list.push({ id: d.id, ...d.data() } as DamagedProductItem);
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setDamagedProducts(list);
      },
      (err: any) => {
        console.error('Damaged products listener error in QCScreen:', err);
      },
      'QCScreen-damaged-products'
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = safeOnSnapshot(collection(db, 'routes'), (snapshot: any) => {
      const items: RouteItem[] = [];
      snapshot.forEach((doc: any) => {
        items.push({ id: doc.id, ...doc.data() } as RouteItem);
      });
      setRoutes(items);
    }, (err: any) => {
      console.error('Error fetching routes in QCScreen:', err);
    }, 'QCScreen-routes');
    return () => unsub();
  }, []);

  // Today's Baghdad date (YYYY-MM-DD)
  const todayDateStr = useMemo(() => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
  }, []);

  const todayArabicFormatted = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('ar-IQ', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Baghdad'
      }).format(new Date());
    } catch {
      return todayDateStr;
    }
  }, [todayDateStr]);

  // Statistics for damaged products recorded today & estimated financial value
  const todayStats = useMemo(() => {
    // Lookup map for fast product price resolution
    const prodMap = new Map<string, ProductItem>();
    productsList.forEach((p) => {
      if (p.productCode) prodMap.set(p.productCode.trim().toLowerCase(), p);
      if (p.productName) prodMap.set(p.productName.trim().toLowerCase(), p);
    });

    const resolveItemUnitPrice = (item: DamagedProductItem): number => {
      const codeKey = (item.productCode || '').trim().toLowerCase();
      const nameKey = (item.productName || '').trim().toLowerCase();
      const prod = prodMap.get(codeKey) || prodMap.get(nameKey);
      if (!prod) return 0;

      const isWholesale = item.customerType === 'جملة';
      const wPrice = Number(prod.wholesalePrice) || 0;
      const rPrice = Number(prod.retailPrice) || 0;

      if (isWholesale) {
        return wPrice > 0 ? wPrice : rPrice;
      } else {
        return rPrice > 0 ? rPrice : wPrice;
      }
    };

    // Filter items recorded today (by createdAt date or purchaseDate)
    const todayItems = damagedProducts.filter((item) => {
      let itemDate = '';
      if (item.createdAt) {
        try {
          itemDate = new Date(item.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
        } catch {}
      }
      return itemDate === todayDateStr || item.purchaseDate === todayDateStr;
    });

    let totalTodayPieces = 0;
    let totalTodayEstimatedValue = 0;
    let pendingCount = 0;
    let compensatedCount = 0;
    let emailedCount = 0;
    let rejectedCount = 0;

    todayItems.forEach((item) => {
      const qty = Number(item.purchaseQuantity) || 0;
      totalTodayPieces += qty;
      const unitPrice = resolveItemUnitPrice(item);
      totalTodayEstimatedValue += qty * unitPrice;

      if (item.status === 'لم يتم تعويضه لحد الان') pendingCount++;
      else if (item.status === 'تم تعويضه') compensatedCount++;
      else if (item.status === 'تم ارسال ايميل به') emailedCount++;
      else if (item.status === 'تم رفض التعويض') rejectedCount++;
    });

    // All-time totals for comparative supervisory insight
    let allTimePieces = 0;
    let allTimeEstimatedValue = 0;
    damagedProducts.forEach((item) => {
      const qty = Number(item.purchaseQuantity) || 0;
      allTimePieces += qty;
      const unitPrice = resolveItemUnitPrice(item);
      allTimeEstimatedValue += qty * unitPrice;
    });

    return {
      todayItemsCount: todayItems.length,
      todayPieces: totalTodayPieces,
      todayValue: totalTodayEstimatedValue,
      pendingCount,
      compensatedCount,
      emailedCount,
      rejectedCount,
      allTimePieces,
      allTimeValue: allTimeEstimatedValue,
      allTimeItemsCount: damagedProducts.length,
    };
  }, [damagedProducts, productsList, todayDateStr]);

  const handleSaveDamagedProduct = async (
    data: Omit<DamagedProductItem, 'id' | 'createdAt'>,
    existingId?: string
  ) => {
    const id = existingId || `dp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const docRef = doc(db, 'damaged_products', id);
    const payload: DamagedProductItem = {
      id,
      ...data,
      createdAt: existingId ? (editingDamagedProduct?.createdAt || Date.now()) : Date.now(),
      createdBy: currentUser?.name || currentUser?.delegateName || 'مستخدم',
      updatedAt: Date.now(),
    };
    await setDoc(docRef, payload);
    addToast?.({ message: 'تم حفظ تقرير المنتج التالف بنجاح ✅', type: 'success', delegateName: currentUser?.name || '', title: 'منتجات تالفة', percentage: 0 });
  };

  const handleDeleteDamagedProduct = async (id: string) => {
    await deleteDoc(doc(db, 'damaged_products', id));
    addToast?.({ message: 'تم حذف تقرير المنتج التالف', type: 'info', delegateName: currentUser?.name || '', title: 'منتجات تالفة', percentage: 0 });
  };

  const handleDeleteDamagedProductImage = async (itemId: string, imageIndex: number) => {
    if (!currentUser?.isAdmin) return;
    const item = damagedProducts.find((p) => p.id === itemId);
    if (!item || !item.images || !item.images[imageIndex]) return;
    const newImages = item.images.filter((_, idx) => idx !== imageIndex);
    const docRef = doc(db, 'damaged_products', itemId);
    await updateDoc(docRef, { images: newImages, updatedAt: Date.now() });
    addToast?.({ message: 'تم حذف الصورة من تقرير المنتج التالف بنجاح ✅', type: 'success', delegateName: currentUser?.name || '', title: 'منتجات تالفة', percentage: 0 });
  };

  const handleStatusChangeDamagedProduct = async (id: string, newStatus: DamagedProductStatus) => {
    const docRef = doc(db, 'damaged_products', id);
    await updateDoc(docRef, { status: newStatus, updatedAt: Date.now() });
    addToast?.({ message: `تم تحديث حالة المنتج التالف إلى: ${newStatus}`, type: 'success', delegateName: currentUser?.name || '', title: 'منتجات تالفة', percentage: 0 });
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-5">
      {/* Page Header */}
      <div className={`p-4 sm:p-5 rounded-2xl border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-xl">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black">إدارة منتجات تالفة (QC)</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">متابعة وفحص المنتجات التالفة، المرتجعات المخزنية، وتقييم الخسائر التشغيلية</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between sm:justify-end">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border ${isDarkMode ? 'bg-slate-800/80 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
            <Calendar className="w-3.5 h-3.5 text-amber-500" />
            <span>{todayArabicFormatted}</span>
          </div>
        </div>
      </div>

      {/* Supervisors Executive Action Card - Today's Summary & Financial Impact */}
      <div className={`rounded-2xl border shadow-sm p-4 sm:p-5 relative overflow-hidden transition-all ${
        isDarkMode 
          ? 'bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-850 border-slate-800 text-white' 
          : 'bg-gradient-to-br from-white via-amber-50/20 to-rose-50/20 border-slate-200 text-slate-900'
      }`}>
        {/* Subtle decorative glow */}
        <div className="absolute top-0 -left-20 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Card Header with Badges */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200/60 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black">موجز تقييم توالف اليوم لاتخاذ القرار</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse">
                  تسجيل اليوم الحصري
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                إجمالي المنتجات التالفة المسجلة اليوم مع التقدير المالي المباشر لمعاونة المشرفين في سرعة اتخاذ القرارات والتعويضات
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-3 py-1 rounded-lg">
            <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span>تاريخ الرصد: <strong className="text-slate-700 dark:text-slate-200">{todayDateStr}</strong></span>
          </div>
        </div>

        {/* 4 Grid Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* 1. Total Damaged Pieces Today */}
          <div className={`p-4 rounded-xl border relative transition-transform hover:-translate-y-0.5 ${
            isDarkMode 
              ? 'bg-slate-800/80 border-slate-700/80' 
              : 'bg-white border-rose-200/70 shadow-sm'
          }`}>
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">
                  إجمالي القطع التالفة اليوم
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-rose-600 dark:text-rose-400 tracking-tight">
                    {formatWithCommas(todayStats.todayPieces)}
                  </span>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">قطعة</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500">
                <PackageX className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">عدد البلاغات اليومية:</span>
              <span className="font-extrabold text-slate-700 dark:text-slate-200">
                {todayStats.todayItemsCount} {todayStats.todayItemsCount === 1 ? 'بلاغ' : 'بلاغات'}
              </span>
            </div>
          </div>

          {/* 2. Total Estimated Financial Value Today */}
          <div className={`p-4 rounded-xl border relative transition-transform hover:-translate-y-0.5 ${
            isDarkMode 
              ? 'bg-slate-800/80 border-slate-700/80' 
              : 'bg-white border-amber-200/70 shadow-sm'
          }`}>
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">
                  إجمالي القيمة المالية المقدرة اليوم
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
                    {formatWithCommas(todayStats.todayValue, true)}
                  </span>
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-300">د.ع</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                <Coins className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">احتساب القيمة:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                حسب نوع الزبون (جملة / مفرد)
              </span>
            </div>
          </div>

          {/* 3. Action Status Breakdown (Decision Making) */}
          <div className={`p-4 rounded-xl border relative transition-transform hover:-translate-y-0.5 ${
            isDarkMode 
              ? 'bg-slate-800/80 border-slate-700/80' 
              : 'bg-white border-blue-200/70 shadow-sm'
          }`}>
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                موقف معالجة حالات اليوم
              </span>
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  بانتظار التعويض (مطلوب إجراء):
                </span>
                <span className="font-black text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10">
                  {todayStats.pendingCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  تم تعويضها بنجاح:
                </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {todayStats.compensatedCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  تم إرسال إيميل بها:
                </span>
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {todayStats.emailedCount}
                </span>
              </div>
              {todayStats.rejectedCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    تم رفض التعويض:
                  </span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">
                    {todayStats.rejectedCount}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 4. Comparative Perspective & All-Time Context */}
          <div className={`p-4 rounded-xl border relative transition-transform hover:-translate-y-0.5 ${
            isDarkMode 
              ? 'bg-slate-800/80 border-slate-700/80' 
              : 'bg-white border-slate-200/90 shadow-sm'
          }`}>
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                المجموع التراكمي الإجمالي
              </span>
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <Layers className="w-4 h-4" />
              </div>
            </div>

            <div className="space-y-2 mt-1">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">كافة القطع التالفة المسجلة:</div>
                <div className="text-base font-extrabold text-slate-800 dark:text-slate-200">
                  {formatWithCommas(todayStats.allTimePieces)} <span className="text-xs font-normal text-slate-500">قطعة</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">إجمالي القيمة التراكمية:</div>
                <div className="text-xs font-bold text-purple-600 dark:text-purple-400">
                  {formatWithCommas(todayStats.allTimeValue, true)} د.ع
                </div>
              </div>
            </div>
            
            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>إجمالي السجلات الكلي:</span>
              <span className="font-bold">{todayStats.allTimeItemsCount} تقرير</span>
            </div>
          </div>
        </div>
      </div>

      {/* QC Section Table */}
      <DamagedProductsQCSection
        damagedProducts={damagedProducts}
        onEdit={(item) => {
          setEditingDamagedProduct(item);
          setIsDamagedProductModalOpen(true);
        }}
        onDelete={handleDeleteDamagedProduct}
        onDeleteImage={handleDeleteDamagedProductImage}
        onStatusChange={handleStatusChangeDamagedProduct}
        onAddNew={() => {
          setEditingDamagedProduct(null);
          setIsDamagedProductModalOpen(true);
        }}
        isDarkMode={isDarkMode}
        currentUser={currentUser}
      />

      {/* Damaged Products Modal */}
      <DamagedProductsModal
        isOpen={isDamagedProductModalOpen}
        onClose={() => {
          setIsDamagedProductModalOpen(false);
          setEditingDamagedProduct(null);
        }}
        editingItem={editingDamagedProduct}
        onSave={handleSaveDamagedProduct}
        routes={routes}
        productsList={productsList}
        delegatesList={delegatesList}
        currentDelegateName={currentUser?.delegateName || currentUser?.name || ''}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};
