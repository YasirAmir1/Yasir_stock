import React, { useState } from 'react';
import { GiftPromotion, ProductItem } from '../types';
import { 
  Gift, 
  Plus, 
  Edit3, 
  Trash2, 
  Calendar, 
  Check, 
  X, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  Info
} from 'lucide-react';

interface GiftsManagementTableProps {
  giftPromotions: GiftPromotion[];
  productsList: ProductItem[];
  isAdmin: boolean;
  isDarkMode: boolean;
  onAddGift: (gift: Omit<GiftPromotion, 'id' | 'createdAt'>) => Promise<void>;
  onUpdateGift: (id: string, gift: Partial<GiftPromotion>) => Promise<void>;
  onDeleteGift: (id: string) => Promise<void>;
}

export const GiftsManagementTable: React.FC<GiftsManagementTableProps> = ({
  giftPromotions,
  productsList,
  isAdmin,
  isDarkMode,
  onAddGift,
  onUpdateGift,
  onDeleteGift
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGift, setEditingGift] = useState<GiftPromotion | null>(null);

  // Form State
  const [selectedProductCode, setSelectedProductCode] = useState('');
  const [selectedProductName, setSelectedProductName] = useState('');
  const [conditionUnit, setConditionUnit] = useState<'piece' | 'carton'>('piece');
  const [conditionQuantity, setConditionQuantity] = useState<number | string>(15);
  const [requirementCondition, setRequirementCondition] = useState('كل 15 قطعة هدية 1 قطعة');
  const [giftQuantityPieces, setGiftQuantityPieces] = useState<number | string>(1);
  const [customerTypeCondition, setCustomerTypeCondition] = useState<'الكل' | 'مفرد' | 'جملة'>('الكل');
  const todayStr = new Date().toISOString().split('T')[0];
  const nextMonthStr = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(nextMonthStr);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleProductSelect = (code: string) => {
    setSelectedProductCode(code);
    const prod = productsList.find(p => String(p.productCode || '').trim() === String(code).trim());
    if (prod) {
      setSelectedProductName(prod.productName);
      if (!requirementCondition || requirementCondition === 'كل 15 قطعة هدية 1 قطعة') {
        const unitName = conditionUnit === 'carton' ? 'كارتون' : 'قطعة';
        setRequirementCondition(`كل ${conditionQuantity} ${unitName} هدية ${giftQuantityPieces} قطعة`);
      }
    }
  };

  const handleConditionChange = (qty: number | string, unit: 'piece' | 'carton', giftQty: number | string) => {
    setConditionQuantity(qty);
    setConditionUnit(unit);
    setGiftQuantityPieces(giftQty);
    const unitName = unit === 'carton' ? 'كارتون' : 'قطعة';
    setRequirementCondition(`كل ${qty || 0} ${unitName} هدية ${giftQty || 0} قطعة`);
  };

  const handleOpenAdd = () => {
    setEditingGift(null);
    const firstProd = productsList[0];
    if (firstProd) {
      setSelectedProductCode(firstProd.productCode || '');
      setSelectedProductName(firstProd.productName);
    } else {
      setSelectedProductCode('');
      setSelectedProductName('');
    }
    setConditionUnit('piece');
    setConditionQuantity(15);
    setGiftQuantityPieces(1);
    setCustomerTypeCondition('الكل');
    setRequirementCondition('كل 15 قطعة هدية 1 قطعة');
    setStartDate(todayStr);
    setEndDate(nextMonthStr);
    setNotes('');
    setFormError(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (gift: GiftPromotion) => {
    setEditingGift(gift);
    setSelectedProductCode(gift.productCode);
    setSelectedProductName(gift.productName);
    setConditionUnit(gift.conditionUnit || 'piece');
    setConditionQuantity(gift.conditionQuantity);
    setGiftQuantityPieces(gift.giftQuantityPieces);
    setCustomerTypeCondition(gift.customerType || 'الكل');
    setRequirementCondition(gift.requirementCondition);
    setStartDate(gift.startDate);
    setEndDate(gift.endDate);
    setNotes(gift.notes || '');
    setFormError(null);
    setShowAddModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cQty = Number(conditionQuantity);
    const gQty = Number(giftQuantityPieces);

    if (!selectedProductName.trim()) {
      setFormError('يرجى اختيار المنتج أو كتابة اسمه');
      return;
    }
    if (isNaN(cQty) || cQty <= 0) {
      setFormError('الكمية المشروطة يجب أن تكون أكبر من 0');
      return;
    }
    if (isNaN(gQty) || gQty <= 0) {
      setFormError('كمية الهدية بالقطع يجب أن تكون أكبر من 0');
      return;
    }
    if (!startDate || !endDate) {
      setFormError('يرجى تحديد تاريخ البدء والانتهاء');
      return;
    }

    if (editingGift) {
      await onUpdateGift(editingGift.id, {
        productCode: selectedProductCode,
        productName: selectedProductName,
        conditionUnit,
        conditionQuantity: cQty,
        giftQuantityPieces: gQty,
        customerType: customerTypeCondition,
        requirementCondition: requirementCondition.trim() || `كل ${cQty} ${conditionUnit === 'carton' ? 'كارتون' : 'قطعة'} هدية ${gQty} قطعة`,
        startDate,
        endDate,
        notes: notes.trim()
      });
    } else {
      await onAddGift({
        productCode: selectedProductCode,
        productName: selectedProductName,
        conditionUnit,
        conditionQuantity: cQty,
        giftQuantityPieces: gQty,
        customerType: customerTypeCondition,
        requirementCondition: requirementCondition.trim() || `كل ${cQty} ${conditionUnit === 'carton' ? 'كارتون' : 'قطعة'} هدية ${gQty} قطعة`,
        startDate,
        endDate,
        notes: notes.trim()
      });
    }

    setShowAddModal(false);
  };

  const handleQuickAdjustGiftPieces = async (gift: GiftPromotion, delta: number) => {
    const newQty = Math.max(1, (gift.giftQuantityPieces || 1) + delta);
    const unitName = (gift.conditionUnit || 'piece') === 'carton' ? 'كارتون' : 'قطعة';
    await onUpdateGift(gift.id, {
      giftQuantityPieces: newQty,
      requirementCondition: `كل ${gift.conditionQuantity} ${unitName} هدية ${newQty} قطعة`
    });
  };

  const handleQuickAdjustConditionQty = async (gift: GiftPromotion, delta: number) => {
    const newQty = Math.max(1, (gift.conditionQuantity || 1) + delta);
    const unitName = (gift.conditionUnit || 'piece') === 'carton' ? 'كارتون' : 'قطعة';
    await onUpdateGift(gift.id, {
      conditionQuantity: newQty,
      requirementCondition: `كل ${newQty} ${unitName} هدية ${gift.giftQuantityPieces} قطعة`
    });
  };

  return (
    <div className={`w-full rounded-2xl border shadow-lg overflow-hidden transition-all duration-300 ${
      isDarkMode 
        ? 'bg-slate-900 border-amber-600/30 shadow-amber-950/20' 
        : 'bg-white border-amber-300 shadow-amber-500/10'
    }`}>
      {/* Header Banner */}
      <div className={`p-3 sm:p-4 flex items-center justify-between gap-3 border-b ${
        isDarkMode ? 'bg-amber-950/40 border-amber-800/40 text-amber-200' : 'bg-gradient-to-r from-amber-50 via-amber-100/70 to-amber-50 border-amber-200 text-amber-900'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-xs">
            <Gift className="w-5 h-5 sm:w-6 sm:h-6 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-black tracking-tight">
                جدول عروض الهدايا الترويجية (Gifts Promotions)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white shadow-xs">
                {giftPromotions.length} {giftPromotions.length === 1 ? 'عرض' : 'عروض'}
              </span>
            </div>
            <p className="text-[10px] sm:text-xs font-semibold opacity-80 mt-0.5">
              {isAdmin 
                ? 'إدارة العروض الترويجية والهدايا المجانية التي تضاف تلقائياً لفواتير الزبائن عند تحقيق شروط الكمية.' 
                : 'العروض النشطة الحالية - تضاف الهدايا تلقائياً عند طلب الكميات المحددة.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-black text-xs sm:text-sm rounded-xl flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة عرض هدية</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title={isExpanded ? 'طي الجدول' : 'توسيع الجدول'}
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="p-3 sm:p-4">
          {giftPromotions.length === 0 ? (
            <div className="py-8 text-center flex flex-col items-center justify-center">
              <Gift className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                لا توجد عروض هدايا مسجلة حالياً
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs rounded-xl shadow-sm cursor-pointer"
                >
                  + أضف أول عرض هدية الآن
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className={`border-b text-[11px] font-black uppercase tracking-wider ${
                    isDarkMode ? 'bg-slate-800/60 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}>
                    <th className="py-2.5 px-3">كود المنتج</th>
                    <th className="py-2.5 px-3">اسم المنتج</th>
                    <th className="py-2.5 px-3">الشرط المراد تحقيقه</th>
                    <th className="py-2.5 px-3 text-center">نوع الزبون</th>
                    <th className="py-2.5 px-3 text-center">الكمية المشروطة</th>
                    <th className="py-2.5 px-3 text-center">كمية الهدية (بالقطع)</th>
                    <th className="py-2.5 px-3">تاريخ بدء التنفيذ</th>
                    <th className="py-2.5 px-3">تاريخ انتهاء التنفيذ</th>
                    <th className="py-2.5 px-3 text-center">الحالة</th>
                    {isAdmin && <th className="py-2.5 px-3 text-center">الإجراءات</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-semibold">
                  {giftPromotions.map((gift) => {
                    const today = new Date().toISOString().split('T')[0];
                    const isManuallyActive = gift.isActive !== false;
                    const isActive = isManuallyActive && (today >= gift.startDate && today <= gift.endDate);
                    const isUpcoming = isManuallyActive && (today < gift.startDate);
                    const isExpired = isManuallyActive && (today > gift.endDate);
                    const isPaused = !isManuallyActive;

                    return (
                      <tr 
                        key={gift.id} 
                        className={`transition-colors ${
                          isDarkMode 
                            ? (isActive ? 'hover:bg-slate-800/80 bg-slate-900/40' : 'bg-slate-950/40 opacity-70') 
                            : (isActive ? 'hover:bg-amber-50/50 bg-white' : 'bg-slate-50 opacity-70')
                        }`}
                      >
                        {/* كود المنتج */}
                        <td className="py-2.5 px-3 font-mono font-bold">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                            isDarkMode ? 'bg-slate-800 text-amber-300 border-slate-700' : 'bg-slate-100 text-amber-800 border-slate-300'
                          }`}>
                            {gift.productCode || 'بدون كود'}
                          </span>
                        </td>

                        {/* اسم المنتج */}
                        <td className="py-2.5 px-3 font-black text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span>{gift.productName}</span>
                          </div>
                        </td>

                        {/* الشرط المراد تحقيقه */}
                        <td className="py-2.5 px-3 font-bold text-amber-700 dark:text-amber-400">
                          {gift.requirementCondition}
                        </td>

                        {/* نوع الزبون */}
                        <td className="py-2.5 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                            gift.customerType === 'مفرد'
                              ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-700'
                              : gift.customerType === 'جملة'
                              ? 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-700'
                              : 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-700'
                          }`}>
                            {gift.customerType === 'مفرد' ? 'مفرد فقط' : gift.customerType === 'جملة' ? 'جملة فقط' : 'الكل (مفرد وجملة)'}
                          </span>
                        </td>

                        {/* الكمية */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="inline-flex items-center gap-1">
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleQuickAdjustConditionQty(gift, -1)}
                                className="w-5 h-5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-black text-xs hover:bg-slate-300 transition-colors flex items-center justify-center cursor-pointer"
                                title="إنقاص الكمية المشروطة"
                              >
                                -
                              </button>
                            )}
                            <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-black min-w-[50px] text-center">
                              {gift.conditionQuantity} {gift.conditionUnit === 'carton' ? 'كارتون' : 'قطعة'}
                            </span>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleQuickAdjustConditionQty(gift, 1)}
                                className="w-5 h-5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-black text-xs hover:bg-slate-300 transition-colors flex items-center justify-center cursor-pointer"
                                title="زيادة الكمية المشروطة"
                              >
                                +
                              </button>
                            )}
                          </div>
                        </td>

                        {/* كمية الهدية بالقطع */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="inline-flex items-center gap-1">
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleQuickAdjustGiftPieces(gift, -1)}
                                className="w-5 h-5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 font-black text-xs hover:bg-amber-300 transition-colors flex items-center justify-center cursor-pointer"
                                title="إنقاص كمية الهدية"
                              >
                                -
                              </button>
                            )}
                            <span className="px-2.5 py-0.5 rounded-lg bg-amber-500 text-white font-black shadow-xs min-w-[55px] text-center">
                              🎁 {gift.giftQuantityPieces} قطعة
                            </span>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleQuickAdjustGiftPieces(gift, 1)}
                                className="w-5 h-5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 font-black text-xs hover:bg-amber-300 transition-colors flex items-center justify-center cursor-pointer"
                                title="زيادة كمية الهدية"
                              >
                                +
                              </button>
                            )}
                          </div>
                        </td>

                        {/* تاريخ بدء التنفيذ */}
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          {gift.startDate}
                        </td>

                        {/* تاريخ انتهاء التنفيذ */}
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          {gift.endDate}
                        </td>

                        {/* الحالة */}
                        <td className="py-2.5 px-3 text-center">
                          {isPaused && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
                              معطل / متوقف ⏸️
                            </span>
                          )}
                          {!isPaused && isActive && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                              نشط وسارٍ ✅
                            </span>
                          )}
                          {!isPaused && isUpcoming && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                              قادم قريباً ⏳
                            </span>
                          )}
                          {!isPaused && isExpired && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                              منتهي ⌛
                            </span>
                          )}
                        </td>

                        {/* الإجراءات (أدمن) */}
                        {isAdmin && (
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(gift)}
                                className="p-1.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 hover:bg-amber-200 transition-colors cursor-pointer"
                                title="تعديل عرض الهدية"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onUpdateGift(gift.id, { isActive: gift.isActive === false ? true : false })}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  gift.isActive === false
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 hover:bg-emerald-200'
                                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200 hover:bg-purple-200'
                                }`}
                                title={gift.isActive === false ? 'تفعيل الهدية' : 'إلغاء تفعيل الهدية'}
                              >
                                {gift.isActive === false ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm(`هل أنت متأكد من حذف عرض الهدية للمنتج (${gift.productName})؟`)) {
                                    onDeleteGift(gift.id);
                                  }
                                }}
                                className="p-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 hover:bg-red-200 transition-colors cursor-pointer"
                                title="حذف عرض الهدية"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Gift Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in duration-200">
          <div 
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl p-5 sm:p-6 shadow-2xl border text-right space-y-4 max-h-[90vh] overflow-y-auto ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-500/20 text-amber-500 rounded-xl">
                  <Gift className="w-5 h-5" />
                </div>
                <h3 className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400">
                  {editingGift ? 'تعديل عرض الهدية' : 'إضافة عرض هدية ترويجي جديد'}
                </h3>
              </div>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-xs font-bold rounded-xl flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs font-bold">
              {/* Product Selection */}
              <div>
                <label className="block mb-1 text-slate-700 dark:text-slate-300">
                  اختر المنتج المشمول بالهدية
                </label>
                <select
                  value={selectedProductCode}
                  onChange={(e) => handleProductSelect(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  <option value="">-- اختر المنتج من الكتالوج --</option>
                  {productsList.map((p) => (
                    <option key={p.id} value={p.productCode}>
                      {p.productName} ({p.productCode}) - كارتون: {p.cartonQuantity} قطعة
                    </option>
                  ))}
                </select>
              </div>

              {/* Product Name Manual Override if needed */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block mb-1 text-slate-700 dark:text-slate-300">اسم المنتج</label>
                  <input
                    type="text"
                    value={selectedProductName}
                    onChange={(e) => setSelectedProductName(e.target.value)}
                    placeholder="اسم المنتج..."
                    className={`w-full p-2 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-700 dark:text-slate-300">كود المنتج</label>
                  <input
                    type="text"
                    value={selectedProductCode}
                    onChange={(e) => setSelectedProductCode(e.target.value)}
                    placeholder="كود المنتج..."
                    className={`w-full p-2 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              {/* Requirement / Condition */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block mb-1 text-slate-700 dark:text-slate-300">
                    الكمية المشروطة
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={conditionQuantity}
                    onChange={(e) => handleConditionChange(e.target.value, conditionUnit, giftQuantityPieces)}
                    className={`w-full p-2 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block mb-1 text-slate-700 dark:text-slate-300">
                    الوحدة (قطعة / كارتون)
                  </label>
                  <select
                    value={conditionUnit}
                    onChange={(e) => handleConditionChange(conditionQuantity, e.target.value as 'piece' | 'carton', giftQuantityPieces)}
                    className={`w-full p-2 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  >
                    <option value="piece">قطعة (Piece)</option>
                    <option value="carton">كارتون (Carton)</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-1 text-slate-700 dark:text-slate-300">
                    كمية الهدية (بالقطع)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={giftQuantityPieces}
                    onChange={(e) => handleConditionChange(conditionQuantity, conditionUnit, e.target.value)}
                    className={`w-full p-2 rounded-xl border text-xs font-black text-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              {/* Customer Type Condition: مفرد / جملة / الكل */}
              <div>
                <label className="block mb-1 text-slate-700 dark:text-slate-300">
                  نوع الزبون المشمول بالهدية (مفرد / جملة / الكل)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomerTypeCondition('الكل')}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                      customerTypeCondition === 'الكل'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    الكل (مفرد وجملة)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerTypeCondition('مفرد')}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                      customerTypeCondition === 'مفرد'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    مفرد فقط
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerTypeCondition('جملة')}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                      customerTypeCondition === 'جملة'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                        : isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    جملة فقط
                  </button>
                </div>
              </div>

              {/* Requirement Condition Text */}
              <div>
                <label className="block mb-1 text-slate-700 dark:text-slate-300">
                  صيغة الشرط التوضيحي (الشرط المراد تحقيقه)
                </label>
                <input
                  type="text"
                  value={requirementCondition}
                  onChange={(e) => setRequirementCondition(e.target.value)}
                  placeholder="مثال: كل 15 قطعة هدية 1 قطعة أو كل 1 كارتون هدية 2 قطعة"
                  className={`w-full p-2 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block mb-1 text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>تاريخ بدء التنفيذ</span>
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={`w-full p-2 rounded-xl border text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block mb-1 text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>تاريخ انتهاء التنفيذ</span>
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={`w-full p-2 rounded-xl border text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              {/* Optional Notes */}
              <div>
                <label className="block mb-1 text-slate-700 dark:text-slate-300">ملاحظات العرض (اختياري)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات توضيحية..."
                  className={`w-full p-2 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={`flex-1 py-2.5 rounded-xl font-bold ${
                    isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                  }`}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl font-black bg-amber-600 hover:bg-amber-500 text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingGift ? 'حفظ التعديلات' : 'إضافة العرض الآن'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
