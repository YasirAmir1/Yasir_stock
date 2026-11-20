import React from 'react';
import { useSales } from '../context/SalesContext';
import { AdminProductDemandPanel } from './AdminProductDemandPanel';
import {
  TrendingUp,
  Shield,
  ShieldAlert,
  ArrowRight,
  Sparkles,
  BarChart3,
  Boxes,
  FileSpreadsheet
} from 'lucide-react';

export const ForecastScreen: React.FC = () => {
  const {
    currentUser,
    productsList,
    allSalesEntries = [],
    isDarkMode,
    getProductLiveStock,
    setActiveTab
  } = useSales();

  // Strict Admin access check (exclude Data Entry)
  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.name?.includes('مدخل') ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );
  const isAdmin = Boolean(
    (currentUser?.isAdmin ||
      currentUser?.name === 'الأدمن' ||
      currentUser?.role === 'admin' ||
      currentUser?.email === 'yasiramirit@gmail.com') &&
      !isDataEntry
  );

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 p-6 sm:p-8 text-center space-y-5 rounded-3xl border shadow-xl bg-white dark:bg-slate-900 border-rose-500/30" dir="rtl">
        <div className="w-16 h-16 mx-auto rounded-3xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 shadow-md">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">
            وصول مقيد — صفحة الأدمن فقط
          </h2>
          <p className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
            صفحة «فوركاست» (Forecast) مخصصة حصرياً للمدير والإدارة العليا لتحليل وتوقع الطلب وتسهيل قرارات الشراء والتوريد بالكارتون.
          </p>
        </div>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('entry')}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <span>العودة لشاشة الفواتير</span>
            <ArrowRight className="w-4 h-4 rotate-180" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-4 space-y-5" dir="rtl">
      {/* Page Title & Breadcrumb Header */}
      <div className={`p-4 sm:p-5 rounded-3xl border shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 ${
        isDarkMode ? 'bg-slate-900/90 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-lg shrink-0">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-400">
                الرئيسية / الإدارة
              </span>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Shield className="w-3 h-3" />
                خاص بالأدمن فقط 🔒
              </span>
            </div>
            <h1 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              صفحة فوركاست (Forecast)
              <span className="text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400">
                — التنبؤ بالطلب وجرد الأكثر طلباً بالكارتون
              </span>
            </h1>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">
              تحليل مباشر لفواتير Firestore الحية والأرشيف وتقسيم الطلب أسبوعياً وبالكارتون، مع فلترة المفرد والجملة وتصدير ملفات Excel
            </p>
          </div>
        </div>

        {/* Quick Highlights / Navigation Buttons */}
        <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('products')}
            className={`px-3 py-2 rounded-xl text-xs font-black border transition-colors cursor-pointer flex items-center gap-1.5 ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
            }`}
          >
            <Boxes className="w-3.5 h-3.5 text-emerald-500" />
            <span>كتالوج المنتجات</span>
          </button>
        </div>
      </div>

      {/* Main Forecast & Demand Table Panel */}
      <AdminProductDemandPanel
        isStandalonePage={true}
        productsList={productsList}
        allSalesEntries={allSalesEntries}
        isDarkMode={isDarkMode}
        getProductLiveStock={getProductLiveStock}
      />
    </div>
  );
};

export default ForecastScreen;
