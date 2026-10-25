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
  Tag,
  TrendingUp,
  AlertCircle,
  Trash2
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
}

export const StoreNotificationsModal: React.FC<StoreNotificationsModalProps> = ({
  isOpen,
  onClose,
  inventoryLogs = [],
  isDarkMode,
  productsList = [],
  isSauceUser = false,
  isAdmin = false,
  onDeleteLog
}) => {
  const [activeTab, setActiveTab] = useState<'logs' | 'prices'>('logs');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Helper: check if a product meets delegate visibility requirements
  const isEligibleForDelegate = (item: RestockedProductItem) => {
    if (isSauceUser && item.categoryName?.trim() !== 'صلصات') {
      return false;
    }
    const itemStock = Number(item.stockCartons) || 0;
    if (itemStock < 6 || item.isAvailable === false || item.isVisible === false) {
      return false;
    }

    if (productsList && productsList.length > 0) {
      const liveProd = productsList.find(
        p => (item.productCode && p.productCode && p.productCode.trim().toLowerCase() === item.productCode.trim().toLowerCase()) ||
             (item.productName && p.productName && p.productName.trim().toLowerCase() === item.productName.trim().toLowerCase())
      );
      if (liveProd) {
        if (isSauceUser && liveProd.categoryName?.trim() !== 'صلصات') return false;
        if (liveProd.isAvailable === false || liveProd.isVisible === false || (liveProd.stockCartons || 0) < 6) {
          return false;
        }
      }
    }

    return true;
  };

  // Filter products whose price was updated within the last 5 days
  const recentPriceChanges = useMemo(() => {
    const now = Date.now();
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    return productsList.filter(p => {
      if (isSauceUser && p.categoryName?.trim() !== 'صلصات') return false;
      if (!p.priceUpdatedAt) return false;
      const diffMs = now - p.priceUpdatedAt;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= 5;
    }).sort((a, b) => (b.priceUpdatedAt || 0) - (a.priceUpdatedAt || 0));
  }, [productsList, isSauceUser]);

  const handleExpandLog = (logId: string) => {
    if (expandedLogId === logId) {
      setExpandedLogId(null);
    } else {
      setExpandedLogId(logId);
      // Track view time for expiry logic
      const storageKey = `opened_log_${logId}`;
      if (!localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, Date.now().toString());
      }
    }
  };

  // Sort all logs descending by timestamp and filter out logs opened more than 1 hour ago
  const sortedLogs = useMemo(() => {
    const now = Date.now();
    const oneHourMs = 1 * 60 * 60 * 1000;
    
    return [...inventoryLogs].filter(log => {
      const storageKey = `opened_log_${log.id}`;
      const openedAt = localStorage.getItem(storageKey);
      
      if (openedAt) {
        // If opened, check if it's been more than 1 hour
        return (now - parseInt(openedAt)) <= oneHourMs;
      }
      // If not opened, show it
      return true;
    }).sort((a, b) => b.timestamp - a.timestamp);
  }, [inventoryLogs]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
      dir="rtl"
    >
      <div 
        className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl border overflow-hidden ${
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
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                  إشعارات المخزن والتحديثات
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white shadow-xs">
                  متابعة مباشرة
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                سجل عمليات الجرد وتتبع المنتجات وتغيرات الأسعار الحديثة
              </p>
            </div>
          </div>

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

        {/* Tab Navigation Controller */}
        <div className={`flex border-b px-4 sm:px-6 pt-3 gap-2 sm:gap-4 shrink-0 ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`cursor-pointer pb-3 px-3 sm:px-4 text-xs sm:text-sm font-black flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'logs'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4 text-emerald-500" />
            <span>الجرد والوصول الحديث</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              activeTab === 'logs'
                ? 'bg-emerald-600 text-white'
                : isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'
            }`}>
              {inventoryLogs.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('prices')}
            className={`cursor-pointer pb-3 px-3 sm:px-4 text-xs sm:text-sm font-black flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'prices'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Tag className="w-4 h-4 text-amber-500" />
            <span>أسعار تغيرت</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              activeTab === 'prices'
                ? 'bg-emerald-600 text-white'
                : isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'
            }`}>
              {recentPriceChanges.length}
            </span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* TAB 1: LOGS & RESTOCKED */}
          {activeTab === 'logs' && (
            <div className="space-y-3.5">
              {sortedLogs.length === 0 ? (
                <div className={`text-center py-12 rounded-2xl border border-dashed p-6 ${
                  isDarkMode ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
                }`}>
                  <History className="w-12 h-12 mx-auto mb-3 opacity-30 text-emerald-500" />
                  <p className="font-black text-sm">لم يتم تسجيل أي عملية رفع جرد بعد</p>
                  <p className="text-xs mt-1 text-slate-400">
                    عند استخدام زر "رفع جرد" في صفحة المنتجات، سيتم توثيق كل عملية جرد وتوقيتها هنا تلقائياً.
                  </p>
                </div>
              ) : (
                sortedLogs.map((log, idx) => {
                  const isExpanded = expandedLogId === log.id;
                  const eligibleRestocked = (log.restockedProducts || []).filter(isEligibleForDelegate);

                  return (
                    <div
                      key={log.id || idx}
                      className={`rounded-2xl border transition-all overflow-hidden ${
                        isDarkMode 
                          ? 'bg-slate-800/80 border-slate-700/80 hover:border-slate-600' 
                          : 'bg-white border-slate-200 shadow-sm hover:border-slate-300'
                      }`}
                    >
                      {/* Summary Header Row */}
                      <div
                        className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                        onClick={() => handleExpandLog(log.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black shrink-0 shadow-inner">
                            <CheckCircle2 className="w-5 h-5" />
                          </div>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">
                                عملية رفع جرد #{sortedLogs.length - idx}
                              </h4>
                              {eligibleRestocked.length > 0 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white shadow-xs flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  <span>{eligibleRestocked.length} منتج وصل حديثاً</span>
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  تحديث كميات
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
                            <span className="text-slate-700 dark:text-slate-300">
                              المنتجات المؤهلة للظهور للمندوبين المضافة حديثاً في هذا الجرد:
                            </span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                              {eligibleRestocked.length} منتج
                            </span>
                          </div>

                          {eligibleRestocked.length === 0 ? (
                            <p className="text-xs text-slate-400 font-bold italic py-1">
                              تم تحديث المخزون ومطابقة الكميات لكافة الأصناف بنجاح.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {eligibleRestocked.map((prod, pIdx) => (
                                <div
                                  key={pIdx}
                                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                                    isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <p className="font-black text-xs text-slate-900 dark:text-white truncate">
                                      {prod.productName}
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-mono">
                                      {prod.categoryName} • كود: {prod.productCode}
                                    </p>
                                  </div>

                                  <div className="text-left shrink-0">
                                    <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-black bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                      {Math.floor(Number(prod.stockCartons || 0)).toLocaleString('en-US')} كارتون
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: PRICE CHANGES (أسعار تغيرت) */}
          {activeTab === 'prices' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-2xl border flex items-center gap-2.5 text-xs font-bold ${
                isDarkMode 
                  ? 'bg-amber-950/30 border-amber-800/60 text-amber-300' 
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <TrendingUp className="w-4 h-4 shrink-0 text-amber-500" />
                <span>
                  هذه القائمة تعرض المنتجات التي تم تعديل أسعارها مؤخراً (خلال آخر 5 أيام فقط). يتم إخفاء المنتج تلقائياً بعد مرور 5 أيام على تعديله.
                </span>
              </div>

              {recentPriceChanges.length === 0 ? (
                <div className={`text-center py-12 rounded-2xl border border-dashed p-6 ${
                  isDarkMode ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
                }`}>
                  <Tag className="w-12 h-12 mx-auto mb-3 opacity-30 text-amber-500" />
                  <p className="font-black text-sm">لا توجد تغييرات في الأسعار خلال آخر 5 أيام</p>
                  <p className="text-xs mt-1 text-slate-400">
                    عند قيام الآدمن بتعديل أسعار أي صنف في النظام، سيظهر السعر الجديد هنا فوراً لجميع المستخدمين.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recentPriceChanges.map((prod, idx) => {
                    const updatedAt = prod.priceUpdatedAt ? new Date(prod.priceUpdatedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                    
                    return (
                      <div
                        key={prod.id || idx}
                        className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 shadow-sm ${
                          isDarkMode 
                            ? 'bg-slate-800/80 border-slate-700 hover:border-amber-500/50' 
                            : 'bg-white border-slate-200 hover:border-amber-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span className="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                سعر مُحدث 🏷️
                              </span>
                              {prod.categoryName && (
                                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  {prod.categoryName}
                                </span>
                              )}
                            </div>
                            <h4 className="font-black text-sm text-slate-900 dark:text-white truncate" title={prod.productName}>
                              {prod.productName}
                            </h4>
                            {prod.productCode && (
                              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                                كود: {prod.productCode}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Prices Grid */}
                        <div className={`grid grid-cols-2 gap-2 p-2.5 rounded-xl border ${
                          isDarkMode ? 'bg-slate-900/80 border-slate-700' : 'bg-amber-50/50 border-amber-100'
                        }`}>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                              سعر الجملة الجديد:
                            </span>
                            <span className="text-sm font-black text-amber-600 dark:text-amber-400 font-mono">
                              {Number(prod.wholesalePrice || 0).toLocaleString('en-US')} <span className="text-[10px]">د.ع</span>
                            </span>
                            {prod.previousWholesalePrice !== undefined && prod.previousWholesalePrice !== prod.wholesalePrice && (
                              <span className="text-[9px] text-slate-400 font-mono line-through">
                                السابق: {Number(prod.previousWholesalePrice).toLocaleString('en-US')}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-col border-r border-slate-200 dark:border-slate-700 pr-2">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                              سعر المفرد الجديد:
                            </span>
                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">
                              {Number(prod.retailPrice || 0).toLocaleString('en-US')} <span className="text-[10px]">د.ع</span>
                            </span>
                            {prod.previousRetailPrice !== undefined && prod.previousRetailPrice !== prod.retailPrice && (
                              <span className="text-[9px] text-slate-400 font-mono line-through">
                                السابق: {Number(prod.previousRetailPrice).toLocaleString('en-US')}
                              </span>
                            )}
                          </div>
                        </div>

                        {updatedAt && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-100 dark:border-slate-700/60">
                            <Clock className="w-3 h-3" />
                            <span>تاريخ التحديث: {updatedAt}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className={`p-3.5 sm:p-4 border-t flex items-center justify-end gap-3 ${
          isDarkMode ? 'bg-slate-800/80 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
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
  );
};
