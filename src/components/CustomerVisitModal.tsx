import React from 'react';
import { ShoppingBag, AlertTriangle, X, Store, MapPin, User, Calendar } from 'lucide-react';
import { RouteItem } from '../types';

interface CustomerVisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  route: RouteItem | null;
  onSelectCreateInvoice: (route: RouteItem) => void;
  onSelectUnsuccessfulVisit: (route: RouteItem) => void;
  isDarkMode?: boolean;
}

export const CustomerVisitModal: React.FC<CustomerVisitModalProps> = ({
  isOpen,
  onClose,
  route,
  onSelectCreateInvoice,
  onSelectUnsuccessfulVisit,
  isDarkMode = false,
}) => {
  if (!isOpen || !route) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className={`w-full max-w-md rounded-2xl p-5 sm:p-6 shadow-2xl border text-right space-y-4 animate-in zoom-in-95 duration-200 ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-900 dark:text-white">
                تسجيل زيارة المحل
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                {route.customerName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Customer Quick Summary */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 font-bold">كود الزبون:</span>
            <span className="font-mono font-black text-slate-900 dark:text-white">
              {route.customerCode || '-'}
            </span>
          </div>
          {route.customerAddress && (
            <div className="flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{route.customerAddress}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400">
            {route.path && (
              <span className="flex items-center gap-1 font-bold">
                <Calendar className="w-3 h-3 text-slate-400" />
                المسار: {route.path}
              </span>
            )}
            {route.delegateName && (
              <span className="flex items-center gap-1 font-bold">
                <User className="w-3 h-3 text-slate-400" />
                {route.delegateName}
              </span>
            )}
          </div>
        </div>

        {/* Action Options Prompt */}
        <p className="text-xs font-black text-slate-600 dark:text-slate-300">
          اختر نوع الإجراء المطلوب تنفيذه لهذه الزيارة:
        </p>

        {/* Options Grid */}
        <div className="space-y-3">
          {/* Option 1: Create Invoice */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectCreateInvoice(route);
            }}
            className="w-full p-4 rounded-xl border border-emerald-500/40 bg-gradient-to-l from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-850 hover:border-emerald-500 hover:shadow-md hover:shadow-emerald-500/10 active:scale-98 transition-all flex items-center justify-between gap-3 text-right cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 group-hover:scale-105 transition-transform shrink-0">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-black text-sm text-emerald-900 dark:text-emerald-300">
                    ١. إنشاء فاتورة
                  </h4>
                  <span className="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                    مبيعات
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium leading-relaxed">
                  المتابعة لإصدار فاتورة مبيعات للمحل مع التحقق من شروط المسار المسبقة.
                </p>
              </div>
            </div>
            <span className="text-emerald-600 dark:text-emerald-400 font-black text-lg group-hover:-translate-x-1 transition-transform">
              ←
            </span>
          </button>

          {/* Option 2: Unsuccessful Visit */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectUnsuccessfulVisit(route);
            }}
            className="w-full p-4 rounded-xl border border-amber-500/40 bg-gradient-to-l from-amber-50 to-white dark:from-amber-950/40 dark:to-slate-850 hover:border-amber-500 hover:shadow-md hover:shadow-amber-500/10 active:scale-98 transition-all flex items-center justify-between gap-3 text-right cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-amber-500 text-white shadow-sm shadow-amber-500/30 group-hover:scale-105 transition-transform shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-black text-sm text-amber-900 dark:text-amber-300">
                    ٢. زيارة غير ناجحة
                  </h4>
                  <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                    توثيق
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium leading-relaxed">
                  التقاط صورة لبراد الزبون وتوثيق سبب عدم نجاح الزيارة للأدمن.
                </p>
              </div>
            </div>
            <span className="text-amber-600 dark:text-amber-400 font-black text-lg group-hover:-translate-x-1 transition-transform">
              ←
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-black transition-colors cursor-pointer"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerVisitModal;
