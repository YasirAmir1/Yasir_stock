import React, { useState } from 'react';
import { DamagedProductItem, DamagedProductStatus } from '../types';
import { db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { 
  AlertTriangle, 
  ExternalLink, 
  Trash2, 
  Edit3, 
  Search, 
  Plus, 
  X, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Send,
  Download,
  Filter,
  FileDown,
  FileText
} from 'lucide-react';
import { generateDamagedProductPdf } from '../utils/damagedProductPdf';

interface DamagedProductsQCSectionProps {
  damagedProducts: DamagedProductItem[];
  onEdit: (item: DamagedProductItem) => void;
  onDelete: (id: string) => Promise<void>;
  onDeleteImage?: (itemId: string, imageIndex: number) => Promise<void>;
  onStatusChange: (id: string, newStatus: DamagedProductStatus) => Promise<void>;
  onAddNew: () => void;
  isDarkMode: boolean;
  currentUser: any;
}

export const DamagedProductsQCSection: React.FC<DamagedProductsQCSectionProps> = ({
  damagedProducts,
  onEdit,
  onDelete,
  onDeleteImage,
  onStatusChange,
  onAddNew,
  isDarkMode,
  currentUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('الكل');
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
    itemId?: string;
    imageIndex?: number;
    isInvoice?: boolean;
  } | null>(null);
  const [isUpdatingStatusId, setIsUpdatingStatusId] = useState<string | null>(null);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);
  const [isDeletingImageKey, setIsDeletingImageKey] = useState<string | null>(null);
  const [imageToDelete, setImageToDelete] = useState<{
    itemId: string;
    imageIndex?: number;
    isInvoice?: boolean;
    imageUrl?: string;
    productName?: string;
    customerName?: string;
  } | null>(null);

  // Filter items
  const filteredItems = damagedProducts.filter((item) => {
    // Status filter
    if (filterStatus !== 'الكل' && item.status !== filterStatus) {
      return false;
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchCustomer =
        item.customerName?.toLowerCase().includes(q) ||
        item.customerCode?.toLowerCase().includes(q) ||
        item.customerAddress?.toLowerCase().includes(q);
      const matchProduct =
        item.productName?.toLowerCase().includes(q) ||
        item.productCode?.toLowerCase().includes(q) ||
        item.batchNumber?.toLowerCase().includes(q);
      const matchDelegate = item.delegateName?.toLowerCase().includes(q);
      const matchReason = item.defectReason?.toLowerCase().includes(q);

      if (!matchCustomer && !matchProduct && !matchDelegate && !matchReason) {
        return false;
      }
    }

    return true;
  });

  const handleStatusChangeInternal = async (id: string, newStatus: DamagedProductStatus) => {
    try {
      setIsUpdatingStatusId(id);
      await onStatusChange(id, newStatus);
    } catch (err) {
      console.error('Error changing status:', err);
      alert('حدث خطأ أثناء تحديث الحالة.');
    } finally {
      setIsUpdatingStatusId(null);
    }
  };

  const handleDeleteInternal = async (id: string, name: string) => {
    const ok = window.confirm(`هل أنت متأكد من حذف تقرير المنتج التالف للزبون (${name})؟`);
    if (!ok) return;
    try {
      await onDelete(id);
    } catch (err) {
      console.error('Error deleting damaged product:', err);
      alert('حدث خطأ أثناء الحذف.');
    }
  };

  const openDeleteImageModal = (
    itemId: string,
    imageIndex: number,
    imageUrl?: string,
    productName?: string,
    customerName?: string,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    if (!currentUser?.isAdmin) return;
    setImageToDelete({
      itemId,
      imageIndex,
      imageUrl,
      productName,
      customerName,
    });
  };

  const openDeleteInvoiceImageModal = (
    itemId: string,
    imageUrl?: string,
    productName?: string,
    customerName?: string,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    if (!currentUser?.isAdmin) return;
    setImageToDelete({
      itemId,
      isInvoice: true,
      imageUrl,
      productName,
      customerName,
    });
  };

  const confirmDeleteImage = async () => {
    if (!imageToDelete || !currentUser?.isAdmin) return;
    const { itemId, imageIndex, isInvoice } = imageToDelete;
    const key = isInvoice ? `${itemId}-invoice` : `${itemId}-${imageIndex}`;
    try {
      setIsDeletingImageKey(key);
      if (isInvoice) {
        const docRef = doc(db, 'damaged_products', itemId);
        await updateDoc(docRef, { invoiceImage: '', updatedAt: Date.now() });
      } else if (onDeleteImage && imageIndex !== undefined) {
        await onDeleteImage(itemId, imageIndex);
      } else {
        const item = damagedProducts.find((p) => p.id === itemId);
        if (item && item.images && imageIndex !== undefined) {
          const newImages = item.images.filter((_, idx) => idx !== imageIndex);
          const docRef = doc(db, 'damaged_products', itemId);
          await updateDoc(docRef, { images: newImages, updatedAt: Date.now() });
        }
      }
      if (previewImage && previewImage.itemId === itemId && (isInvoice ? previewImage.isInvoice : previewImage.imageIndex === imageIndex)) {
        setPreviewImage(null);
      }
      setImageToDelete(null);
    } catch (err) {
      console.error('Error deleting image:', err);
      alert('حدث خطأ أثناء حذف الصورة.');
    } finally {
      setIsDeletingImageKey(null);
    }
  };

  const handleDownloadPdfInternal = async (item: DamagedProductItem) => {
    if (!currentUser?.isAdmin) return;
    try {
      setGeneratingPdfId(item.id);
      await generateDamagedProductPdf(item);
    } catch (err) {
      console.error('Error generating damaged product PDF:', err);
      alert('حدث خطأ أثناء إنشاء وتحميل استمارة الـ PDF.');
    } finally {
      setGeneratingPdfId(null);
    }
  };

  // Status color pill
  const getStatusColor = (status: DamagedProductStatus) => {
    switch (status) {
      case 'تم ارسال ايميل به':
        return 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800';
      case 'تم تعويضه':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
      case 'تم رفض التعويض':
        return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800';
      case 'لم يتم تعويضه لحد الان':
      default:
        return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
    }
  };

  return (
    <div
      id="damaged-products-qc-section"
      className={`rounded-2xl border p-3 sm:p-5 space-y-4 shadow-sm transition-all ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}
      dir="rtl"
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center border border-rose-500/30">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                منتجات تالفة (QC)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                {damagedProducts.length} تقرير
              </span>
            </div>
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              تقارير المنتجات التالفة وبلاغات الجودة المرفوعة من المندوبين مع التوثيق بالصور
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onAddNew}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs shadow-md shadow-rose-600/20 active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>تسجيل منتج تالف جديد</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في المنتجات التالفة (اسم أو كود الزبون، المنتج، رقم الدفعة، المندوب)..."
            className={`w-full pr-9 pl-8 p-2 rounded-xl border text-xs font-bold ${
              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold p-0.5"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={`p-2 rounded-xl border text-xs font-bold ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="الكل">جميع الحالات</option>
            <option value="لم يتم تعويضه لحد الان">لم يتم تعويضه لحد الان</option>
            <option value="تم ارسال ايميل به">تم ارسال ايميل به</option>
            <option value="تم تعويضه">تم تعويضه</option>
            <option value="تم رفض التعويض">تم رفض التعويض</option>
          </select>
        </div>
      </div>

      {/* QC Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-[11px] sm:text-xs text-right whitespace-nowrap">
          <thead
            className={`font-black ${
              isDarkMode ? 'bg-slate-800/90 text-slate-300 border-b border-slate-700' : 'bg-slate-100 text-slate-700 border-b border-slate-300'
            }`}
          >
            <tr>
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">الزبون</th>
              <th className="px-3 py-2.5">نوع وعنوان الزبون</th>
              <th className="px-3 py-2.5">المنتج وكود الصنف</th>
              <th className="px-3 py-2.5">اسم المندوب</th>
              <th className="px-3 py-2.5">رقم الدفعة (Batch)</th>
              <th className="px-3 py-2.5">تاريخ الشراء والكمية التالفة</th>
              <th className="px-3 py-2.5">سبب العيب / المشكلة</th>
              <th className="px-3 py-2.5">الصور المرفقة</th>
              <th className="px-3 py-2.5 text-center">حالة التعويض (QC)</th>
              {currentUser?.isAdmin && <th className="px-3 py-2.5 text-center">الإجراءات</th>}
            </tr>
          </thead>
          <tbody
            className={`divide-y font-bold ${
              isDarkMode ? 'divide-slate-800 bg-slate-900/60 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'
            }`}
          >
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={currentUser?.isAdmin ? 11 : 10} className="text-center py-10 text-slate-500 font-bold">
                  {damagedProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <AlertTriangle className="w-8 h-8 text-slate-400" />
                      <span>لا توجد تقارير منتجات تالفة مسجلة بعد.</span>
                      <button
                        type="button"
                        onClick={onAddNew}
                        className="text-rose-600 hover:underline text-xs mt-1"
                      >
                        + اضغط هنا لتسجيل أول تقرير
                      </button>
                    </div>
                  ) : (
                    <span>لا توجد نتائج مطابقة لبحثك.</span>
                  )}
                </td>
              </tr>
            ) : (
              filteredItems.map((item, idx) => (
                <tr
                  key={item.id}
                  className={`transition-colors hover:${isDarkMode ? 'bg-slate-800/40' : 'bg-slate-50'}`}
                >
                  {/* # Index */}
                  <td className="px-3 py-3 text-slate-400 font-mono text-[10px]">{idx + 1}</td>

                  {/* Customer Code & Name */}
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <span className="font-black text-slate-900 dark:text-white">{item.customerName}</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                        كود: {item.customerCode}
                      </span>
                    </div>
                  </td>

                  {/* Customer Type & Address */}
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-amber-600 dark:text-amber-400">
                        {item.customerType}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 max-w-[140px] truncate" title={item.customerAddress}>
                        {item.customerAddress || '—'}
                      </span>
                    </div>
                  </td>

                  {/* Product Name & Code */}
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <span className="font-black text-emerald-600 dark:text-emerald-400">{item.productName}</span>
                      {item.productCode && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                          كود: {item.productCode}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Representative Name */}
                  <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-200">
                    {item.delegateName}
                  </td>

                  {/* Batch Number */}
                  <td className="px-3 py-3 font-mono text-[11px]">
                    {item.batchNumber ? (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {item.batchNumber}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Purchase Date & Quantity */}
                  <td className="px-3 py-3">
                    <div className="flex flex-col font-mono text-[11px]">
                      <span>{item.purchaseDate || '—'}</span>
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-black">
                        الكمية: {item.purchaseQuantity || 1} قطعة
                      </span>
                    </div>
                  </td>

                  {/* Defect Reason */}
                  <td className="px-3 py-3 max-w-[200px] whitespace-normal">
                    <div className="text-[11px] text-slate-700 dark:text-slate-300 line-clamp-2" title={item.defectReason}>
                      {item.defectReason}
                    </div>
                  </td>

                  {/* Images - Clickable links stacked vertically one below another with Delete button for Admin */}
                  <td className="px-3 py-3">
                    {(item.images && item.images.length > 0) || item.invoiceImage ? (
                      <div className="flex flex-col gap-1.5 items-start">
                        {item.images && item.images.map((imgUrl, imgIdx) => {
                          const isDeletingThis = isDeletingImageKey === `${item.id}-${imgIdx}`;
                          return (
                            <div key={imgIdx} className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewImage({
                                    url: imgUrl,
                                    title: `${item.productName} - ${item.customerName} (صورة ${imgIdx + 1})`,
                                    itemId: item.id,
                                    imageIndex: imgIdx,
                                  })
                                }
                                className="text-[11px] text-sky-600 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300 hover:underline flex items-center gap-1 font-bold active:scale-95 transition-all cursor-pointer"
                                title="انقر لفتح الصورة بالحجم الكامل"
                              >
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                <span>رابط صورة {imgIdx + 1}</span>
                              </button>

                              {/* Delete Image Button: Visible and functional ONLY for Admin */}
                              {currentUser?.isAdmin && (
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={(e) => openDeleteImageModal(item.id, imgIdx, imgUrl, item.productName, item.customerName, e)}
                                  className="px-1.5 py-0.5 rounded text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 transition-colors flex items-center gap-0.5 text-[10px] font-bold disabled:opacity-50"
                                  title="حذف هذه الصورة (خاص بالإدارة)"
                                >
                                  {isDeletingThis ? (
                                    <span className="w-3 h-3 border-2 border-rose-600 border-t-transparent rounded-full animate-spin inline-block" />
                                  ) : (
                                    <>
                                      <Trash2 className="w-3 h-3 text-rose-500" />
                                      <span className="text-[9px]">حذف</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* Customer Invoice Image Link if attached */}
                        {item.invoiceImage && (
                          <div className="flex items-center gap-1.5 mt-0.5 pt-1 border-t border-slate-200 dark:border-slate-800 w-full">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImage({
                                  url: item.invoiceImage!,
                                  title: `فاتورة الزبون: ${item.customerName} - ${item.productName}`,
                                  itemId: item.id,
                                  isInvoice: true,
                                })
                              }
                              className="text-[11px] text-teal-600 hover:text-teal-500 dark:text-teal-400 dark:hover:text-teal-300 hover:underline flex items-center gap-1 font-bold active:scale-95 transition-all cursor-pointer"
                              title="انقر لفتح صورة فاتورة الزبون بالحجم الكامل"
                            >
                              <FileText className="w-3 h-3 shrink-0" />
                              <span>صورة الفاتورة 🧾</span>
                            </button>

                            {/* Delete Invoice Image for Admin */}
                            {currentUser?.isAdmin && (
                              <button
                                type="button"
                                disabled={isDeletingImageKey === `${item.id}-invoice`}
                                onClick={(e) => openDeleteInvoiceImageModal(item.id, item.invoiceImage!, item.productName, item.customerName, e)}
                                className="px-1.5 py-0.5 rounded text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 transition-colors flex items-center gap-0.5 text-[10px] font-bold disabled:opacity-50"
                                title="حذف صورة الفاتورة (خاص بالإدارة)"
                              >
                                {isDeletingImageKey === `${item.id}-invoice` ? (
                                  <span className="w-3 h-3 border-2 border-rose-600 border-t-transparent rounded-full animate-spin inline-block" />
                                ) : (
                                  <>
                                    <Trash2 className="w-3 h-3 text-rose-500" />
                                    <span className="text-[9px]">حذف</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 text-[10px]">لا توجد صور</span>
                    )}
                  </td>

                  {/* 2. Status Column: Editable only for Admin, view-only for representatives */}
                  <td className="px-3 py-3 text-center">
                    {currentUser?.isAdmin ? (
                      <div className="relative inline-block">
                        <select
                          value={item.status}
                          disabled={isUpdatingStatusId === item.id}
                          onChange={(e) =>
                            handleStatusChangeInternal(item.id, e.target.value as DamagedProductStatus)
                          }
                          className={`text-[11px] font-black px-2.5 py-1.5 rounded-xl border cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all ${getStatusColor(
                            item.status
                          )}`}
                          title="تعديل حالة التعويض (خاص بالإدارة)"
                        >
                          <option value="لم يتم تعويضه لحد الان">لم يتم تعويضه لحد الان</option>
                          <option value="تم ارسال ايميل به">تم ارسال ايميل به</option>
                          <option value="تم تعويضه">تم تعويضه</option>
                          <option value="تم رفض التعويض">تم رفض التعويض</option>
                        </select>
                      </div>
                    ) : (
                      <span
                        className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-xl border shadow-sm ${getStatusColor(
                          item.status
                        )}`}
                        title="حالة التعويض (للقراءة فقط للمندوب)"
                      >
                        {item.status}
                      </span>
                    )}
                  </td>

                  {/* 3. Actions Column: Visible and accessible exclusively to the Admin */}
                  {currentUser?.isAdmin && (
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                          title="تعديل التقرير"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteInternal(item.id, item.customerName)}
                          className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-colors"
                          title="حذف التقرير"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        {/* PDF Download Button per Customer - Positioned right next to Delete button, Admin only */}
                        <button
                          type="button"
                          disabled={generatingPdfId === item.id}
                          onClick={() => handleDownloadPdfInternal(item)}
                          className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 text-amber-600 dark:text-amber-400 transition-colors disabled:opacity-50"
                          title="تحميل استمارة تقرير الفحص (PDF)"
                        >
                          {generatingPdfId === item.id ? (
                            <span className="w-3.5 h-3.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin block" />
                          ) : (
                            <FileDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Lightbox Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
          dir="rtl"
        >
          <div
            className={`relative max-w-3xl w-full max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl border ${
              isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-200 dark:border-slate-800">
              <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white truncate">
                {previewImage.title}
              </h4>
              <div className="flex items-center gap-2">
                {/* Delete button in preview modal for Admin */}
                {currentUser?.isAdmin && previewImage.itemId !== undefined && (previewImage.imageIndex !== undefined || previewImage.isInvoice) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      if (previewImage.isInvoice) {
                        openDeleteInvoiceImageModal(previewImage.itemId!, previewImage.url, previewImage.title, undefined, e);
                      } else {
                        openDeleteImageModal(previewImage.itemId!, previewImage.imageIndex!, previewImage.url, previewImage.title, undefined, e);
                      }
                    }}
                    disabled={isDeletingImageKey === (previewImage.isInvoice ? `${previewImage.itemId}-invoice` : `${previewImage.itemId}-${previewImage.imageIndex}`)}
                    className="p-1.5 px-2 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 transition-colors flex items-center gap-1 text-xs font-bold disabled:opacity-50"
                    title={previewImage.isInvoice ? "حذف صورة الفاتورة (خاص بالإدارة)" : "حذف هذه الصورة (خاص بالإدارة)"}
                  >
                    <Trash2 className="w-4 h-4 text-rose-500" />
                    <span>{previewImage.isInvoice ? 'حذف صورة الفاتورة' : 'حذف الصورة'}</span>
                  </button>
                )}
                <a
                  href={previewImage.url}
                  download="damaged-product-image.jpg"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                  title="تحميل الصورة"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Image Body */}
            <div className="flex-1 overflow-auto p-2 sm:p-4 flex items-center justify-center bg-black/40">
              <img
                src={previewImage.url}
                alt="معاينة المنتج التالف"
                className="max-h-[75vh] w-auto max-w-full object-contain rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Delete Image Confirmation Modal */}
      {imageToDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => {
            if (!isDeletingImageKey) setImageToDelete(null);
          }}
          dir="rtl"
        >
          <div
            className={`relative max-w-md w-full rounded-2xl p-5 shadow-2xl border ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
            } animate-in zoom-in-95 duration-150`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Icon + Close */}
            <div className="flex items-start justify-between mb-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 flex items-center justify-center text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <button
                type="button"
                disabled={!!isDeletingImageKey}
                onClick={() => setImageToDelete(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="mb-5">
              <h3 className="text-base font-black text-slate-900 dark:text-white mb-2">
                {imageToDelete.isInvoice ? 'تأكيد حذف صورة الفاتورة' : 'تأكيد حذف الصورة'}
              </h3>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-relaxed mb-3">
                {imageToDelete.isInvoice
                  ? 'هل أنت متأكد من حذف صورة فاتورة الزبون من هذا التقرير؟'
                  : 'هل أنت متأكد من حذف هذه الصورة من التقرير؟'}
              </p>

              {/* Preview Thumbnail if available */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                {imageToDelete.imageUrl && (
                  <img
                    src={imageToDelete.imageUrl}
                    alt="صورة للحذف"
                    className="w-14 h-14 object-cover rounded-lg border border-slate-300 dark:border-slate-600 shadow-sm shrink-0"
                  />
                )}
                <div className="flex flex-col text-xs font-bold gap-0.5 min-w-0">
                  {imageToDelete.productName && (
                    <span className="text-slate-800 dark:text-slate-200 truncate">
                      {imageToDelete.productName}
                    </span>
                  )}
                  {imageToDelete.customerName && (
                    <span className="text-slate-500 dark:text-slate-400 text-[11px] truncate">
                      الزبون: {imageToDelete.customerName}
                    </span>
                  )}
                  <span className="text-rose-600 dark:text-rose-400 text-[10px] font-mono">
                    {imageToDelete.isInvoice ? 'صورة فاتورة الزبون 🧾' : `صورة رقم ${(imageToDelete.imageIndex ?? 0) + 1}`}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 font-medium">
                * ملاحظة: سيتم حذف هذه الصورة نهائياً وفورياً من تقرير المنتج التالف.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={!!isDeletingImageKey}
                onClick={() => setImageToDelete(null)}
                className="px-4 py-2 text-xs font-black rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={!!isDeletingImageKey}
                onClick={confirmDeleteImage}
                className="px-4 py-2 text-xs font-black rounded-xl bg-rose-600 hover:bg-rose-700 text-white transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
              >
                {isDeletingImageKey ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>جاري الحذف...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>تأكيد الحذف</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
