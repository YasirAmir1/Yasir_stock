import React, { useState, useEffect, useRef } from 'react';
import { DamagedProductItem, ProductItem, RouteItem } from '../types';
import { X, Camera, ImagePlus, Trash2, Save, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';

interface DamagedProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingItem: DamagedProductItem | null;
  onSave: (data: Omit<DamagedProductItem, 'id' | 'createdAt'>, existingId?: string) => Promise<void>;
  routes: RouteItem[];
  productsList: ProductItem[];
  delegatesList: string[];
  currentDelegateName: string;
  isDarkMode: boolean;
}

// Utility to compress image to max ~800px width/height JPEG quality 0.72
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 800;
        const maxHeight = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

export const DamagedProductsModal: React.FC<DamagedProductsModalProps> = ({
  isOpen,
  onClose,
  editingItem,
  onSave,
  routes,
  productsList,
  delegatesList,
  currentDelegateName,
  isDarkMode,
}) => {
  const [customerCode, setCustomerCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerType, setCustomerType] = useState<'مفرد' | 'جملة'>('مفرد');
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [delegateName, setDelegateName] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [purchaseQuantity, setPurchaseQuantity] = useState<number | ''>(1);
  const [defectReason, setDefectReason] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Initialize form when opening or editing
  useEffect(() => {
    if (!isOpen) return;

    if (editingItem) {
      setCustomerCode(editingItem.customerCode || '');
      setCustomerName(editingItem.customerName || '');
      setCustomerAddress(editingItem.customerAddress || '');
      setCustomerType(editingItem.customerType || 'مفرد');
      setProductName(editingItem.productName || '');
      setProductCode(editingItem.productCode || '');
      setDelegateName(editingItem.delegateName || currentDelegateName || '');
      setBatchNumber(editingItem.batchNumber || '');
      setPurchaseDate(editingItem.purchaseDate || new Date().toISOString().split('T')[0]);
      setPurchaseQuantity(editingItem.purchaseQuantity || 1);
      setDefectReason(editingItem.defectReason || '');
      setImages(editingItem.images || []);
    } else {
      // New form
      setCustomerCode('');
      setCustomerName('');
      setCustomerAddress('');
      setCustomerType('مفرد');
      setProductName('');
      setProductCode('');
      setDelegateName(currentDelegateName || (delegatesList[0] || ''));
      setBatchNumber('');
      setPurchaseDate(new Date().toISOString().split('T')[0]);
      setPurchaseQuantity(1);
      setDefectReason('');
      setImages([]);
    }
    setErrorMessage(null);
  }, [isOpen, editingItem, currentDelegateName, delegatesList]);

  if (!isOpen) return null;

  // Auto-fill customer details if matching customerCode
  const handleCustomerCodeChange = (code: string) => {
    setCustomerCode(code);
    const matched = routes.find(
      (r) => String(r.customerCode).trim().toLowerCase() === String(code).trim().toLowerCase()
    );
    if (matched) {
      if (matched.customerName) setCustomerName(matched.customerName);
      if (matched.customerAddress) setCustomerAddress(matched.customerAddress);
      if (matched.customerType) setCustomerType(matched.customerType);
      if (matched.delegateName && !delegateName) setDelegateName(matched.delegateName);
    }
  };

  // Auto-fill productCode if matching productName from productsList
  const handleProductNameChange = (name: string) => {
    setProductName(name);
    const matched = productsList.find(
      (p) => p.productName.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (matched && matched.productCode) {
      setProductCode(matched.productCode);
    }
  };

  // Auto-fill productName if matching productCode from productsList
  const handleProductCodeChange = (code: string) => {
    setProductCode(code);
    const matched = productsList.find(
      (p) => String(p.productCode).trim().toLowerCase() === code.trim().toLowerCase()
    );
    if (matched && matched.productName) {
      setProductName(matched.productName);
    }
  };

  // Handle image files selection/capture
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsCompressing(true);
    setErrorMessage(null);
    try {
      const newBase64s: string[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (file.type.startsWith('image/')) {
          const compressed = await compressImage(file);
          newBase64s.push(compressed);
        }
      }
      setImages((prev) => [...prev, ...newBase64s]);
    } catch (err) {
      console.error('Error compressing images:', err);
      setErrorMessage('حدث خطأ أثناء معالجة الصور. يرجى تجربة صور أخرى.');
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const removeImage = (indexToRemove: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation
    if (!customerCode.trim()) {
      setErrorMessage('يرجى إدخال كود الزبون');
      return;
    }
    if (!customerName.trim()) {
      setErrorMessage('يرجى إدخال اسم الزبون');
      return;
    }
    if (!productName.trim()) {
      setErrorMessage('يرجى إدخال اسم المنتج');
      return;
    }
    if (!delegateName.trim()) {
      setErrorMessage('يرجى اختيار اسم المندوب');
      return;
    }
    if (!defectReason.trim()) {
      setErrorMessage('يرجى كتابة سبب العيب أو مشكلة المنتج بالتفصيل');
      return;
    }

    // Minimum 3 images required
    if (images.length < 3) {
      setErrorMessage(`يجب إرفاق 3 صور للمنتج على الأقل للتوثيق والفحص (المرفق حالياً: ${images.length} صور)`);
      return;
    }

    try {
      setIsSubmitting(true);
      await onSave(
        {
          customerCode: customerCode.trim(),
          customerName: customerName.trim(),
          customerAddress: customerAddress.trim(),
          customerType,
          productName: productName.trim(),
          productCode: productCode.trim(),
          delegateName: delegateName.trim(),
          batchNumber: batchNumber.trim(),
          purchaseDate: purchaseDate.trim(),
          purchaseQuantity: Number(purchaseQuantity) || 1,
          defectReason: defectReason.trim(),
          images,
          status: editingItem?.status || 'لم يتم تعويضه لحد الان',
        },
        editingItem?.id
      );
      onClose();
    } catch (err: any) {
      console.error('Error saving damaged product:', err);
      setErrorMessage(err?.message || 'حدث خطأ أثناء حفظ تقرير المنتج التالف.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className={`w-full max-w-2xl h-[92dvh] sm:h-auto sm:max-h-[88vh] flex flex-col rounded-2xl shadow-2xl border transition-all overflow-hidden ${
          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center border border-rose-500/30 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-rose-600 dark:text-rose-400">
                {editingItem ? 'تعديل تقرير منتج تالف' : 'تسجيل منتج تالف (Damaged Products)'}
              </h3>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                توثيق مشاكل المنتجات والعيوب لمتابعة ومراجعة الجودة (QC)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Container with Docked Footer */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3.5 text-xs sm:text-sm overscroll-contain">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Section 1: Customer Info */}
            <div className="p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
              <h4 className="font-black text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span>👤</span>
                <span>بيانات الزبون</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Customer Code */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    كود الزبون <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={customerCode}
                    onChange={(e) => handleCustomerCodeChange(e.target.value)}
                    placeholder="مثال: 1042 أو ابحث بالمسار"
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>

                {/* Customer Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    اسم الزبون <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="اسم المحل أو الزبون"
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>

                {/* Customer Address */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    عنوان الزبون
                  </label>
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="المدينة / المنطقة / الشارع"
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>

                {/* Customer Type */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    نوع الزبون (لست مفرد / جملة) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value as 'مفرد' | 'جملة')}
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  >
                    <option value="مفرد">مفرد (Retail)</option>
                    <option value="جملة">جملة (Wholesale)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: Product & Representative Info */}
            <div className="p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
              <h4 className="font-black text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span>📦</span>
                <span>بيانات المنتج والمندوب</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Product Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    اسم المنتج <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    list="products-datalist"
                    value={productName}
                    onChange={(e) => handleProductNameChange(e.target.value)}
                    placeholder="اختر أو اكتب اسم المنتج"
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                  <datalist id="products-datalist">
                    {productsList.map((p) => (
                      <option key={p.id} value={p.productName}>
                        {p.productCode ? `(${p.productCode}) ${p.productName}` : p.productName}
                      </option>
                    ))}
                  </datalist>
                </div>

                {/* Product Code */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    كود المنتج
                  </label>
                  <input
                    type="text"
                    value={productCode}
                    onChange={(e) => handleProductCodeChange(e.target.value)}
                    placeholder="كود الصنف"
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>

                {/* Representative Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    اسم المندوب (اختر اسم المندوب) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={delegateName}
                    onChange={(e) => setDelegateName(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  >
                    <option value="">-- اختر المندوب --</option>
                    {delegatesList.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Batch Number */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    رقم الدفعة (Batch number مكتوب أسفل الإكسباير)
                  </label>
                  <input
                    type="text"
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    placeholder="مثال: L-240801 / BATCH-09"
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>

                {/* Purchase Date */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    تاريخ شراء الزبون
                  </label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>

                {/* 1. Field Label & Meaning Update: Damaged Quantity in Pieces (الكمية التالفة بالقطع) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    الكمية التالفة بالقطع <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={purchaseQuantity}
                    onChange={(e) => setPurchaseQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="عدد القطع التالفة"
                    className={`w-full p-2.5 rounded-xl border font-bold ${
                      isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Defect Reason */}
            <div className="p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                سبب العيب (ما هي مشكلة المنتج؟) <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={defectReason}
                onChange={(e) => setDefectReason(e.target.value)}
                placeholder="صف المشكلة بدقة: مثل تلف التغليف، انتفاخ العبوة، تغير الرائحة أو الطعم، كسر، تسريب، اكسباير..."
                className={`w-full p-2.5 rounded-xl border font-bold resize-none ${
                  isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                }`}
              />
            </div>

            {/* Section 4: Image Upload / Camera Capture (Minimum 3 images) */}
            <div className="p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-black text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <span>📸</span>
                    <span>صور وتوثيق المنتج التالف (3 صور على الأقل)</span>
                    <span className="text-rose-500">*</span>
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                    يرجى التقاط أو إرفاق صور واضحة للمنتج، العيب، وتاريخ الإنتاج/رقم الدفعة
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Camera Capture Input */}
                  <input
                    type="file"
                    ref={cameraInputRef}
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isCompressing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-sm active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>كاميرا 📷</span>
                  </button>

                  {/* Multiple File Upload */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCompressing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>إرفاق صور 🖼️</span>
                  </button>
                </div>
              </div>

              {/* Validation Badge */}
              <div
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-between ${
                  images.length >= 3
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {images.length >= 3 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  )}
                  <span>
                    {images.length >= 3
                      ? `✓ تم إرفاق ${images.length} صور بنجاح (المطلب مستوفى)`
                      : `⚠️ يجب إرفاق 3 صور على الأقل (تم إرفاق: ${images.length} من 3)`}
                  </span>
                </div>
                {isCompressing && <span className="text-[11px] animate-pulse">جاري ضغط الصور... ⏳</span>}
              </div>

              {/* Images Thumbnails Grid */}
              {images.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5 pt-1">
                  {images.map((imgUrl, idx) => (
                    <div
                      key={idx}
                      className="relative group rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 aspect-square bg-slate-900 shadow-sm"
                    >
                      <img
                        src={imgUrl}
                        alt={`صورة ${idx + 1}`}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <div className="absolute top-1 right-1 bg-black/70 text-white rounded-md text-[9px] px-1 font-mono">
                        #{idx + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute bottom-1 right-1 bg-rose-600 hover:bg-rose-500 text-white rounded-md p-1 shadow-md transition-all active:scale-90"
                        title="حذف هذه الصورة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 4. Docked Modal Actions Footer: Always fully visible on mobile & desktop */}
          <div className="shrink-0 p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/95 flex items-center gap-2.5 shadow-lg">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold border transition-colors cursor-pointer text-xs sm:text-sm ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                  : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              إلغاء
            </button>

            <button
              type="submit"
              disabled={isSubmitting || isCompressing || images.length < 3}
              className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 disabled:opacity-50 text-white font-black shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer text-xs sm:text-sm"
            >
              {isSubmitting ? (
                <span>جاري الحفظ... ⏳</span>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>حفظ التقرير</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
