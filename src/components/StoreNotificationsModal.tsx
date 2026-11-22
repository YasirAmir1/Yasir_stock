import React, { useState, useMemo } from 'react';
import { InventoryLogRecord, RestockedProductItem, ProductItem } from '../types';
import { 
  X, 
  History, 
  User, 
  Boxes, 
  CheckCircle2, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  Trash2,
  Truck,
  ArrowLeft,
  CheckCheck
} from 'lucide-react';

interface StoreNotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryLogs: InventoryLogRecord[];
  isDarkMode: boolean;
  productsList?: ProductItem[];
  isSauceUser?: boolean;
  isAdmin?: boolean;
  onDeleteLog?: (logId: string) => Promise<void>;
  userLastReadTimestamp?: number;
  onMarkAllRead?: () => void;
}

export const StoreNotificationsModal: React.FC<StoreNotificationsModalProps> = ({
  isOpen,
  onClose,
  inventoryLogs = [],
  isDarkMode,
  productsList = [],
  isSauceUser = false,
  isAdmin = false,
  onDeleteLog,
  userLastReadTimestamp = 0,
  onMarkAllRead
}) => {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Helper: check if a product meets delegate visibility requirements
  const isEligibleForDelegate = (item: RestockedProductItem) => {
    if (isSauceUser && item.categoryName?.trim() !== 'صلصات') {
      return false;
    }
    const itemStock = Number(item.stockCartons) || 0;
    if (itemStock < 3 || item.isAvailable === false || item.isVisible === false) {
      return false;
    }

    if (productsList && productsList.length > 0) {
      const itemCodeNorm = (item.productCode || '').trim().replace(/\.0+$/, '').toLowerCase();
      const itemNameNorm = (item.productName || '').trim().toLowerCase();
      const liveProd =
        (itemCodeNorm
          ? productsList.find(p => (p.productCode || '').trim().replace(/\.0+$/, '').toLowerCase() === itemCodeNorm)
          : undefined) ||
        productsList.find(p => {
          const pNameNorm = (p.productName || '').trim().toLowerCase();
          if (!itemNameNorm || pNameNorm !== itemNameNorm) return false;
          const pCodeNorm = (p.productCode || '').trim().replace(/\.0+$/, '').toLowerCase();
          return !itemCodeNorm || !pCodeNorm || /^prd-\d+$/i.test(itemCodeNorm) || /^prd-\d+$/i.test(pCodeNorm);
        });
      if (liveProd) {
        if (isSauceUser && liveProd.categoryName?.trim() !== 'صلصات') return false;
        const unitsPerCarton = Number(liveProd.unitsPerCarton || liveProd.cartonQuantity) || 12;
        const baselineUnits = Number(
          liveProd.totalUnits !== undefined 
            ? liveProd.totalUnits 
            : (liveProd.totalPieces !== undefined 
                ? liveProd.totalPieces 
                : ((Number(liveProd.totalCartons ?? liveProd.stockCartons ?? 0)) * unitsPerCarton))
        );
        const liveCartons = Math.floor(baselineUnits / unitsPerCarton);
        if (liveProd.isAvailable === false || liveProd.isVisible === false || liveCartons < 3) {
          return false;
        }
      }
    }

    return true;
  };

  const handleExpandLog = (logId: string) => {
    if (expandedLogId === logId) {
      setExpandedLogId(null);
    } else {
      setExpandedLogId(logId);
    }
  };

  // All logs sorted descending by timestamp (no 1-hour auto-hiding so logs remain accessible)
  const sortedLogs = useMemo(() => {
    return [...inventoryLogs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [inventoryLogs]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[150] flex items-center justify-center p-2 sm:p-5 bg-black/70 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto"
      onClick={onClose}
      dir="rtl"
    >
      <div 
        className={`w-full max-w-[95vw] sm:max-w-3xl max-h-[88dvh] my-auto flex flex-col rounded-2xl sm:rounded-3xl shadow-2xl border overflow-hidden ${
          isDarkMode ? 'bg-slate-900 border-emerald-500/30 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className={`p-4 sm:p-5 border-b flex items-center justify-between gap-3 ${
          isDarkMode ? 'bg-slate-800/80 border-slate-800' : 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-100'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 shrink-0">
              <Boxes className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                  إشعارات المخزن والتحديثات
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white shadow-xs">
                  {isAdmin ? 'سجل الأرشيف الكامل للأدمن' : 'متابعة مباشرة'}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                {isAdmin 
                  ? 'سجل وتفاصيل كافة عمليات رفع الجرد (الحديثة والقديمة) وتتبع وصول المنتجات' 
                  : 'سجل وتفاصيل عمليات رفع الجرد وتتبع وصول المنتجات الحديثة والمخزون'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onMarkAllRead && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                title="تحديد كافة الإشعارات كمقروءة وإيقاف التنبيه"
              >
                <CheckCheck className="w-4 h-4" />
                <span className="hidden sm:inline">قراءة الكل</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                isDarkMode 
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
              title="إغلاق النافذة"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="space-y-3.5">
            {sortedLogs.length === 0 ? (
              <div className={`text-center py-12 rounded-2xl border border-dashed p-6 ${
                isDarkMode ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
              }`}>
                <History className="w-12 h-12 mx-auto mb-3 opacity-30 text-emerald-500" />
                <p className="font-black text-sm">لم يتم تسجيل أي عملية رفع جرد بعد</p>
                <p className="text-xs mt-1 text-slate-400">
                  عند استخدام زر "رفع جرد" في صفحة المنتجات، سيتم توثيق كل عملية جرد وتوقيتها هنا تلقائياً لجميع المستخدمين.
                </p>
              </div>
            ) : (
              sortedLogs.map((log, idx) => {
                const isExpanded = expandedLogId === log.id;
                const isUnread = (log.timestamp || 0) > userLastReadTimestamp;
                const eligibleRestocked = isAdmin 
                  ? (log.restockedProducts || []) 
                  : (log.restockedProducts || []).filter(isEligibleForDelegate);

                // حساب إجمالي الكراتين الواصلة أو المتاحة في عملية الجرد هذه
                const totalArrivedCartons = eligibleRestocked.reduce((acc, p) => {
                  const curr = Math.floor(Number(p.stockCartons || 0));
                  const prev = p.previousStock !== undefined ? Math.floor(Number(p.previousStock)) : 0;
                  const arrived = p.addedCartons !== undefined 
                    ? Math.floor(Number(p.addedCartons)) 
                    : (curr > prev ? curr - prev : curr);
                  return acc + Math.max(0, arrived);
                }, 0);

                return (
                  <div
                    key={log.id || idx}
                    className={`rounded-2xl border transition-all overflow-hidden ${
                      isUnread 
                        ? (isDarkMode ? 'bg-emerald-950/30 border-emerald-500/50 shadow-md shadow-emerald-950/50' : 'bg-emerald-50/80 border-emerald-300 shadow-md shadow-emerald-100')
                        : (isDarkMode ? 'bg-slate-800/80 border-slate-700/80 hover:border-slate-600' : 'bg-white border-slate-200 shadow-sm hover:border-slate-300')
                    }`}
                  >
                    {/* Summary Header Row */}
                    <div
                      className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                      onClick={() => handleExpandLog(log.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 shadow-inner ${
                          isUnread 
                            ? 'bg-emerald-600 text-white shadow-emerald-600/30 animate-pulse' 
                            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        }`}>
                          <CheckCircle2 className="w-5 h-5" />
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">
                              عملية رفع جرد #{sortedLogs.length - idx}
                            </h4>
                            {isUnread && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950 shadow-xs animate-bounce">
                                جديد 🔔
                              </span>
                            )}
                            {eligibleRestocked.length > 0 ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white shadow-xs flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  <span>{eligibleRestocked.length} منتج متاح بالمخزن</span>
                                </span>
                                {totalArrivedCartons > 0 && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-mono flex items-center gap-1">
                                    <Truck className="w-3 h-3" />
                                    <span>+{totalArrivedCartons.toLocaleString('en-US')} كارتون</span>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                جرد ومطابقة
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap font-bold">
                            <span className="flex items-center gap-1 font-mono text-emerald-600 dark:text-emerald-400">
                              <Clock className="w-3.5 h-3.5" />
                              {log.dateFormatted}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              المدخل: {log.uploaderName || 'مسؤول المخزن'}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Boxes className="w-3.5 h-3.5 text-slate-400" />
                              إجمالي الأصناف: {log.totalProductsCount}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isAdmin && onDeleteLog && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm('هل أنت متأكد من حذف عملية رفع الجرد هذه؟')) {
                                onDeleteLog(log.id);
                              }
                            }}
                            className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-400 dark:hover:bg-red-800 transition-colors"
                            title="حذف عملية رفع الجرد"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <span className="text-xs text-slate-400 font-bold hidden sm:inline">
                          {isExpanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {/* Expanded details section */}
                    {isExpanded && (
                      <div className={`p-4 border-t space-y-3 ${
                        isDarkMode ? 'bg-slate-900/60 border-slate-700' : 'bg-slate-50/70 border-slate-100'
                      }`}>
                        <div className="flex items-center justify-between text-xs font-black">
                          <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Truck className="w-4 h-4 text-emerald-500" />
                            {isAdmin 
                              ? 'الكميات والأصناف في عملية الجرد هذه (سجل كامل للأدمن):' 
                              : 'المنتجات والأصناف المتوفرة للمندوبين في هذا الجرد:'}
                          </span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-mono font-black">
                            {eligibleRestocked.length} منتج
                          </span>
                        </div>

                        {eligibleRestocked.length === 0 ? (
                          <p className="text-xs text-slate-400 font-bold italic py-2 text-center">
                            تم تحديث ومطابقة كميات المخزون لكافة الأصناف بنجاح.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {eligibleRestocked.map((prod, pIdx) => {
                              const currStock = Math.floor(Number(prod.stockCartons || 0));
                              const prevStock = prod.previousStock !== undefined ? Math.floor(Number(prod.previousStock)) : 0;
                              const arrivedCartons = prod.addedCartons !== undefined 
                                ? Math.floor(Number(prod.addedCartons)) 
                                : (currStock > prevStock ? currStock - prevStock : 0);
                              const isBrandNew = prevStock === 0;

                              return (
                                <div
                                  key={pIdx}
                                  className={`p-3 rounded-2xl border flex flex-col justify-between gap-2.5 transition-all ${
                                    isDarkMode 
                                      ? 'bg-slate-800/95 border-slate-700 hover:border-emerald-500/40' 
                                      : 'bg-white border-slate-200 shadow-sm hover:border-emerald-400'
                                  }`}
                                >
                                  {/* Top row: Name & Arrived Badge */}
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="font-black text-xs sm:text-sm text-slate-900 dark:text-white truncate" title={prod.productName}>
                                        {prod.productName}
                                      </p>
                                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                        {prod.categoryName} • كود: {prod.productCode}
                                      </p>
                                    </div>

                                    {/* Prominent Cartons Badge */}
                                    <div className="text-left shrink-0">
                                      <div className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-mono font-black text-xs sm:text-sm shadow-md shadow-emerald-600/20 flex items-center gap-1">
                                        <Truck className="w-3.5 h-3.5 shrink-0" />
                                        <span>{currStock.toLocaleString('en-US')}</span>
                                        <span className="text-[10px] font-bold">كارتون</span>
                                      </div>
                                      <span className="block text-[9px] text-emerald-600 dark:text-emerald-400 font-black text-center mt-0.5">
                                        {arrivedCartons > 0 ? `+${arrivedCartons} وارد جديد` : 'متوفر بالمخزن'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Bottom row: Previous Stock vs Current Stock Breakdown */}
                                  <div className={`pt-2 border-t flex items-center justify-between text-[11px] font-bold ${
                                    isDarkMode ? 'border-slate-700/70 text-slate-400' : 'border-slate-100 text-slate-500'
                                  }`}>
                                    <div className="flex items-center gap-1">
                                      <span>السابق:</span>
                                      <span className="font-mono font-black text-slate-700 dark:text-slate-300">
                                        {prevStock.toLocaleString('en-US')}
                                      </span>
                                      <span className="text-[9px]">كارتون</span>
                                      {isBrandNew && (
                                        <span className="text-[9px] font-black text-teal-600 dark:text-teal-400 bg-teal-500/10 px-1 rounded">
                                          جديد
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1">
                                      <ArrowLeft className="w-3 h-3 text-slate-400 shrink-0" />
                                      <span className="text-slate-700 dark:text-slate-300 font-black">الحالي:</span>
                                      <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-xs">
                                        {currStock.toLocaleString('en-US')}
                                      </span>
                                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400">كارتون</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className={`p-3.5 sm:p-4 border-t flex items-center justify-between gap-3 ${
          isDarkMode ? 'bg-slate-800/80 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
            إجمالي عمليات الجرد المحفوظة: <span className="font-mono font-black text-emerald-600">{inventoryLogs.length}</span>
          </div>

          <div className="flex items-center gap-2">
            {onMarkAllRead && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-black transition-all cursor-pointer"
              >
                تحديد الكل كمقروء
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-black transition-all cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
