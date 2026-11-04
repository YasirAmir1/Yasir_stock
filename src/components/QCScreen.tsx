import React, { useState, useEffect, useMemo } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, query, updateDoc, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { safeOnSnapshot } from '../lib/firestoreUtils';
import { DamagedProductItem, DamagedProductStatus, RouteItem } from '../types';
import { DamagedProductsQCSection } from './DamagedProductsQCSection';
import { DamagedProductsModal } from './DamagedProductsModal';
import { 
  AlertTriangle, 
  Calendar
} from 'lucide-react';

export const QCScreen: React.FC = () => {
  const { currentUser, isDarkMode, addToast, delegatesList = [], productsList = [], routes: contextRoutes = [] } = useSales();
  const [damagedProducts, setDamagedProducts] = useState<DamagedProductItem[]>([]);
  const [isDamagedProductModalOpen, setIsDamagedProductModalOpen] = useState(false);
  const [editingDamagedProduct, setEditingDamagedProduct] = useState<DamagedProductItem | null>(null);
  const [routes, setRoutes] = useState<RouteItem[]>(() => contextRoutes);

  useEffect(() => {
    if (contextRoutes.length > 0) {
      setRoutes(contextRoutes);
    }
  }, [contextRoutes]);

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
