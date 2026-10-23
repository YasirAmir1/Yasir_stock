import React, { useState, useEffect, lazy, Suspense } from 'react';
import { SalesProvider, useSales } from './context/SalesContext';
import { LoginScreen } from './components/LoginScreen';
import { WeatherWidget } from './components/WeatherWidget';
import { ToastContainer } from './components/ToastContainer';
import { AppLogo } from './components/AppLogo';
import { ScrollToTopButton } from './components/ScrollToTopButton';
import { DelegateAlertsListener } from './components/DelegateAlertsListener';
import { UnreadBadge } from './components/UnreadBadge';
import { BottomNav } from './components/BottomNav';
import { GlobalDialogModal } from './components/GlobalDialogModal';
import { PWAInstallButton } from './components/PWAInstallButton';

// Code-split heavy screens for optimized initial bundle size
const EntryScreen = lazy(() => import('./components/EntryScreen').then(m => ({ default: m.EntryScreen })));
const ReportsScreen = lazy(() => import('./components/ReportsScreen').then(m => ({ default: m.ReportsScreen })));
const AdminScreen = lazy(() => import('./components/AdminScreen').then(m => ({ default: m.AdminScreen })));
const EvaluationsScreen = lazy(() => import('./components/EvaluationsScreen').then(m => ({ default: m.EvaluationsScreen })));
const ProductsScreen = lazy(() => import('./components/ProductsScreen').then(m => ({ default: m.ProductsScreen })));
const RoutesScreen = lazy(() => import('./components/RoutesScreen').then(m => ({ default: m.RoutesScreen })));
const OldInvoicesScreen = lazy(() => import('./components/OldInvoicesScreen').then(m => ({ default: m.OldInvoicesScreen })));
const ReturnsScreen = lazy(() => import('./components/ReturnsScreen').then(m => ({ default: m.ReturnsScreen })));
const QCScreen = lazy(() => import('./components/QCScreen').then(m => ({ default: m.QCScreen })));
const ItemTrackingScreen = lazy(() => import('./components/ItemTrackingScreen').then(m => ({ default: m.ItemTrackingScreen })));

// Code-split heavy on-demand modals and widgets
const CalculatorModal = lazy(() => import('./components/CalculatorModal').then(m => ({ default: m.CalculatorModal })));
const DelegatePanelModal = lazy(() => import('./components/DelegatePanelModal').then(m => ({ default: m.DelegatePanelModal })));
const AccountSwitcherModal = lazy(() => import('./components/AccountSwitcherModal').then(m => ({ default: m.AccountSwitcherModal })));
const LowAchievementWidget = lazy(() => import('./components/LowAchievementWidget').then(m => ({ default: m.LowAchievementWidget })));
import './utils/dialogService';
import { getFormattedWeekday } from './utils/dateUtils';
import {
  RotateCcw,
  FileText,
  BarChart2,
  FileSpreadsheet,
  Shield,
  CheckCircle2,
  X,
  Target,
  Sun,
  Moon,
  LogOut,
  Calculator,
  Award,
  Package,
  Type,
  User,
  MapPin,
  Bell,
  History,
  Layers,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

const MainAppContent: React.FC = () => {
  const {
    currentUser,
    userMessage,
    setUserMessage,
    isDarkMode,
    toggleDarkMode,
    isLoggedIn,
    logout,
    isOnline,
    pendingSyncCount,
    activeTab,
    setActiveTab,
    showQuickAdd,
    setShowQuickAdd,
    delegateAccounts,
    fetchUnifiedDataFromFirestore,
    isDataRefreshing,
    isNetworkDelayed,
  } = useSales();
  const [isLoading, setIsLoading] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showCalculatorModal, setShowCalculatorModal] = useState(false);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [largeFont, setLargeFont] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Role Access Control for Item Tracking (متابعة الأصناف): Admin, Data Entry, and mohammedsauce
  const isAllowedItemTracking = Boolean(
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'dataEntry' ||
    currentUser?.role === 'sauceOnly' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.username?.toLowerCase() === 'mohammedsauce' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.roleName?.includes('أدمن') ||
    currentUser?.roleName?.includes('ادمن') ||
    currentUser?.name === 'الأدمن' ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );

  const isSauceUser = Boolean(
    currentUser?.username?.toLowerCase() === 'mohammedsauce' ||
    currentUser?.role === 'sauceOnly' ||
    currentUser?.role === 'viewer' ||
    currentUser?.name === 'محمد الصلصات' ||
    currentUser?.delegateName === 'محمد الصلصات' ||
    currentUser?.username?.toLowerCase() === 'محمد الصلصات'
  );

  // Strictly enforce that mohammedsauce is always on products or item_tracking
  useEffect(() => {
    if (isSauceUser && activeTab !== 'products' && activeTab !== 'item_tracking') {
      setActiveTab('item_tracking');
    }
  }, [isSauceUser, activeTab, setActiveTab]);

  const handleTabChange = (tab: string) => {
    setIsLoading(true);
    setActiveTab(tab as any);
    setTimeout(() => setIsLoading(false), 500);
  };

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <div
      className={`min-h-screen flex flex-col dir-rtl transition-colors duration-300 w-full max-w-[100vw] ${
        isDarkMode ? 'bg-emerald-950 text-slate-100' : 'bg-slate-100 text-slate-900'
      }`}
    >
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-md">
          <div className="relative w-32 h-32 flex items-center justify-center animate-pulse">
            {/* Background circle */}
            <div className="absolute w-32 h-32 border-[12px] border-slate-200 rounded-full"></div>
            {/* Gradient progress circle */}
            <div className="absolute w-32 h-32 border-[12px] border-transparent border-t-emerald-400 border-r-emerald-700 rounded-full animate-[spin_1s_ease-in-out_infinite] drop-shadow-lg"></div>
            {/* Text */}
            <span className="text-xs font-black text-slate-700 leading-none text-center">كالة تكريت</span>
          </div>
        </div>
      )}
      {/* Offline / Sync Banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-center font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md z-50">
          <span>⚠️ أنت تعمل حالياً في وضع عدم الاتصال (Offline). سيتم حفظ مبيعاتك محلياً ومزامنتها تلقائياً عند اتصال الإنترنت.</span>
        </div>
      )}
      {isOnline && pendingSyncCount > 0 && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-center font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md z-50 animate-pulse">
          <span>🔄 جاري مزامنة ({pendingSyncCount}) من المدخلات المعلقة مع قاعدة البيانات...</span>
        </div>
      )}
      {/* Toast Notifications Overlay */}
      <ToastContainer />
      <DelegateAlertsListener />

      {/* Scroll to Top Floating Button */}
      <ScrollToTopButton />

      {/* Calculator Modal - Lazy Loaded */}
      {showCalculatorModal && (
        <Suspense fallback={null}>
          <CalculatorModal
            isOpen={showCalculatorModal}
            onClose={() => setShowCalculatorModal(false)}
          />
        </Suspense>
      )}

      {/* Delegate Modal - Lazy Loaded */}
      {showDelegateModal && (
        <Suspense fallback={null}>
          <DelegatePanelModal
            onClose={() => setShowDelegateModal(false)}
            isDarkMode={isDarkMode}
          />
        </Suspense>
      )}

      {/* Account Switcher Modal - Lazy Loaded */}
      {showAccountModal && (
        <Suspense fallback={null}>
          <AccountSwitcherModal
            isOpen={showAccountModal}
            onClose={() => setShowAccountModal(false)}
            onAccountSelect={(isAdmin) => {
              if (isAdmin) {
                setActiveTab('admin');
              } else {
                setActiveTab('entry');
              }
            }}
          />
        </Suspense>
      )}

      {/* Top Header Bar & Navigation Tabs - Pinned / Sticky on Laptop view */}
      <header className="sticky top-0 z-50 w-full box-sizing-border-box max-w-[100vw] overflow-x-hidden shadow-md">
        <div
          className={`backdrop-blur-md transition-all duration-300 border-b ${
            isDarkMode
              ? 'bg-slate-900/95 border-emerald-500/30 text-white'
              : 'bg-white/95 border-emerald-600/20 text-slate-900'
          }`}
        >
          <div className="header-container max-w-5xl mx-auto px-2 sm:px-5 py-1.5 sm:py-3 flex items-center justify-between gap-1.5 sm:gap-2.5 flex-wrap rounded-2xl">
            {/* Top row for Mobile (Logo + Delegate Name with Connection & Weather) & Logo for Desktop */}
            <div className="flex items-center justify-between w-full sm:w-auto shrink-0 gap-1.5">
              {/* Brand Logo & App Title */}
              <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
                <AppLogo size="sm" />
                <div className="flex flex-col">
                  <h1
                    className={`font-black text-xs sm:text-lg tracking-tight leading-none ${
                      isDarkMode ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    Tikrit Sales
                  </h1>
                  <span
                    className={`text-[8px] sm:text-xs font-bold mt-0.5 ${
                      isDarkMode ? 'text-emerald-400' : 'text-emerald-700'
                    }`}
                  >
                    Build by: Eng.Yasir
                  </span>
                </div>
              </div>
              
              {/* Mobile Delegate, Weather, and Real-Time Connection Indicator Group */}
              <div className="sm:hidden flex items-center gap-1 shrink-0">
                {/* Visual Connection Status Indicator & Weather Widget */}
                <WeatherWidget isDarkMode={isDarkMode} compact={true} />

                {/* User Info Card (Mobile Only) */}
                <div
                  className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-xl border flex ${
                    currentUser?.isAdmin ? 'items-center justify-center text-center' : 'flex-col text-right'
                  } ${
                    isDarkMode
                      ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                      : 'bg-emerald-50/80 border-emerald-200 text-slate-900'
                  }`}
                >
                  <div className={`flex flex-col ${currentUser?.isAdmin ? 'items-center justify-center text-center' : 'text-right'}`}>
                      <span className="font-extrabold text-[10px] sm:text-[11px] leading-tight">
                          {currentUser?.name || 'مستخدم'}
                      </span>
                      {isSauceUser ? (
                        <span className="text-[8px] font-black text-amber-500">
                          حساب مشاهدة
                        </span>
                      ) : !currentUser?.isAdmin && (
                        <span className={`text-[8px] font-black ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                            {delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.delegateCode || currentUser?.delegateCode || 'لا يوجد كود'}
                        </span>
                      )}
                  </div>
                  {!currentUser?.isAdmin && !isSauceUser && (delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.delegateCode || currentUser?.delegateCode) && (
                      <div className="relative">
                          <button 
                              onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip); }}
                              className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-emerald-600 text-white text-[7.5px] font-black shrink-0 cursor-pointer hover:bg-emerald-700 transition-colors"
                          >
                              {(delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.delegateCode || currentUser?.delegateCode || '').slice(-2)}
                          </button>
                          {showTooltip && (
                              <div className="absolute top-7 left-0 z-50 w-44 p-2.5 rounded-xl shadow-xl border text-right text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                                  <p className="font-black text-slate-900 dark:text-white mb-1">{currentUser?.delegateName || currentUser?.name}</p>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                      آخر تحديث: {(delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.targetSetTimestamp || currentUser?.targetSetTimestamp) ? new Date(delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.targetSetTimestamp || currentUser?.targetSetTimestamp!).toLocaleDateString('ar-EG') : 'غير متوفر'}
                                  </p>
                                  <button onClick={() => setShowTooltip(false)} className="mt-2 text-[9px] text-red-500 font-bold w-full text-center">إغلاق</button>
                              </div>
                          )}
                      </div>
                  )}
                </div>
              </div>
            </div>

            {/* Buttons Group & Desktop User Profile Info */}
            <div className="flex items-center justify-between sm:justify-end gap-1 sm:gap-2 shrink-0 w-full sm:w-auto overflow-x-auto no-scrollbar py-0.5">
              <PWAInstallButton />
              {/* User Info Card (Desktop Only) */}
              <div
                className={`hidden sm:flex px-3 py-1.5 rounded-xl border ${
                  currentUser?.isAdmin ? 'items-center justify-center text-center' : 'flex-col text-right'
                } ${
                  isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                    : 'bg-emerald-50/80 border-emerald-200 text-slate-900'
                }`}
              >
                <div className={`flex flex-col ${currentUser?.isAdmin ? 'items-center justify-center text-center' : 'text-right'}`}>
                    <span className="font-extrabold text-xs sm:text-sm leading-tight">
                        {currentUser?.name || 'مستخدم'}
                    </span>
                    {isSauceUser ? (
                      <span className="text-[9px] font-black text-amber-500">
                        حساب مشاهدة
                      </span>
                    ) : !currentUser?.isAdmin && (
                      <span className={`text-[9px] font-black ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                          {delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.delegateCode || currentUser?.delegateCode || 'لا يوجد كود'}
                      </span>
                    )}
                </div>
                {!currentUser?.isAdmin && !isSauceUser && (delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.delegateCode || currentUser?.delegateCode) && (
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip); }}
                            className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-600 text-white text-[9px] font-black shrink-0 cursor-pointer hover:bg-emerald-700 transition-colors"
                        >
                            {(delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.delegateCode || currentUser?.delegateCode || '').slice(-2)}
                        </button>
                        {showTooltip && (
                            <div className="absolute top-7 right-0 z-50 w-48 p-3 rounded-xl shadow-xl border text-right text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                                <p className="font-black text-slate-900 dark:text-white mb-1">{currentUser?.delegateName || currentUser?.name}</p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                    آخر تحديث: {(delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.targetSetTimestamp || currentUser?.targetSetTimestamp) ? new Date(delegateAccounts?.find(a => a.username?.toLowerCase() === currentUser?.username?.toLowerCase() || a.delegateName === currentUser?.name)?.targetSetTimestamp || currentUser?.targetSetTimestamp!).toLocaleDateString('ar-EG') : 'غير متوفر'}
                                </p>
                                <button onClick={() => setShowTooltip(false)} className="mt-2 text-[9px] text-red-500 font-bold w-full text-center">إغلاق</button>
                            </div>
                        )}
                    </div>
                )}
              </div>

              {/* Notification Button (Available for Admin, Data Entry, and Delegates - Hidden for mohammedsauce) */}
              {!isSauceUser && (
                <button
                  onClick={() => setShowDelegateModal(true)}
                  onMouseEnter={() => import('./components/DelegatePanelModal')}
                  className={`px-1.5 py-1 sm:px-2.5 sm:py-2 rounded-xl border font-black text-[8.5px] sm:text-xs flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all shadow-sm active:scale-95 min-w-[34px] sm:min-w-[58px] shrink-0 cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 text-blue-300 hover:bg-slate-700 border-slate-700'
                      : 'bg-blue-100 text-blue-950 hover:bg-blue-200 border-blue-300'
                  }`}
                  title="لوحة الإشعارات والتنبيهات"
                >
                  <div className="relative flex items-center justify-center">
                    <Bell className={`w-3.5 h-3.5 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400 shrink-0 ${unreadCount > 0 ? 'animate-pulse' : ''}`} />
                    <UnreadBadge delegateName={currentUser.name} isAdmin={currentUser.isAdmin} role={currentUser.role} onCountChange={setUnreadCount} />
                  </div>
                  <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">اشعارات</span>
                </button>
              )}

              {/* Calculator Button */}
              <button
                onClick={() => setShowCalculatorModal(true)}
                onMouseEnter={() => import('./components/CalculatorModal')}
                className={`px-1.5 py-1 sm:px-2.5 sm:py-2 rounded-xl border font-black text-[8.5px] sm:text-xs flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all shadow-sm active:scale-95 min-w-[34px] sm:min-w-[58px] shrink-0 ${
                  isDarkMode
                    ? 'bg-slate-800 text-emerald-300 hover:bg-slate-700 border-slate-700'
                    : 'bg-emerald-100 text-emerald-950 hover:bg-emerald-200 border-emerald-300'
                }`}
                title="فتح الحاسبة السريعة"
              >
                <Calculator className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">الحاسبة</span>
              </button>

              {/* Refresh Data Button with Optimistic UI & Latency-Aware Indicator */}
              <button
                onClick={() => {
                  fetchUnifiedDataFromFirestore();
                }}
                disabled={isDataRefreshing}
                className={`px-1.5 py-1 sm:px-2.5 sm:py-2 rounded-xl border font-black text-[8.5px] sm:text-xs flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all shadow-sm active:scale-95 min-w-[34px] sm:min-w-[58px] shrink-0 cursor-pointer ${
                  isDataRefreshing ? 'opacity-90' : ''
                } ${
                  isDarkMode
                    ? 'bg-slate-800 text-indigo-300 hover:bg-slate-700 border-slate-700'
                    : 'bg-indigo-100 text-indigo-950 hover:bg-indigo-200 border-indigo-300'
                }`}
                title="تحديث فوري للبيانات من الذاكرة المحلية وقاعدة البيانات"
              >
                <div className="relative flex items-center justify-center">
                  <RefreshCw className={`w-3.5 h-3.5 sm:w-5 sm:h-5 text-indigo-600 dark:text-indigo-400 shrink-0 ${isNetworkDelayed ? 'animate-spin' : isDataRefreshing ? 'rotate-180 transition-transform duration-300' : 'hover:rotate-180 transition-transform duration-500'}`} />
                  {/* Small Latency-Aware Network Indicator - ONLY visible when real network delay occurs */}
                  {isNetworkDelayed && (
                    <span className="absolute -top-1 -right-1 flex h-1.5 w-1.5 sm:h-2 sm:w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-amber-500" title="جاري الاتصال بالشبكة..."></span>
                    </span>
                  )}
                </div>
                <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">
                  {isNetworkDelayed ? 'مزامنة..' : 'تحديث'}
                </span>
              </button>

              {/* Weather Widget (Tikrit) - Desktop Only (on mobile it is positioned beside delegate name) */}
              <div className="hidden sm:flex">
                <WeatherWidget isDarkMode={isDarkMode} />
              </div>
              
              {/* Date Display */}
              <div className={`px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-xl border font-black text-[8px] sm:text-xs flex flex-col items-center justify-center gap-0.5 shadow-sm min-w-[48px] sm:min-w-[76px] shrink-0 ${
                isDarkMode
                  ? 'bg-slate-800 text-emerald-300 border-slate-700'
                  : 'bg-emerald-50 text-emerald-950 border-emerald-200'
              }`}>
                <span className="text-[7.5px] sm:text-[11px] leading-tight font-extrabold">{getFormattedWeekday()}</span>
                <span className="text-[7.5px] sm:text-[11px] leading-tight font-extrabold" style={{ direction: 'ltr' }}>{new Date().toLocaleDateString('en-GB')}</span>
              </div>

              {/* Font Size Toggle Button */}
              {activeTab === 'products' && (
                <button
                  onClick={() => setLargeFont(!largeFont)}
                  className={`px-1.5 py-1 sm:px-2.5 sm:py-2 rounded-xl border font-black text-[8.5px] sm:text-xs flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all shadow-sm active:scale-95 min-w-[34px] sm:min-w-[58px] shrink-0 ${
                    largeFont
                      ? (isDarkMode ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : 'bg-amber-100 text-amber-800 border-amber-300')
                      : (isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300')
                  }`}
                  title="تكبير الخط"
                >
                  <Type className={`w-3.5 h-3.5 sm:w-5 sm:h-5 shrink-0 ${largeFont ? (isDarkMode ? 'text-amber-400' : 'text-amber-600') : (isDarkMode ? 'text-slate-400' : 'text-slate-600')}`} />
                  <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">الخط</span>
                </button>
              )}

              {/* Admin Button (Placed between Calculator and Theme Toggle - Hidden for Rafat, Data Entry, and mohammedsauce) */}
              {(currentUser.isAdmin || currentUser.name === 'الأدمن') &&
                currentUser.username?.toLowerCase() !== 'rafatdata' &&
                currentUser.role !== 'dataEntry' &&
                !isSauceUser && (
                <button
                  onClick={() => setActiveTab('admin')}
                  onMouseEnter={() => import('./components/AdminScreen')}
                  className={`px-1.5 py-1 sm:px-2.5 sm:py-2 rounded-xl border font-black text-[8.5px] sm:text-xs flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all shadow-sm active:scale-95 min-w-[34px] sm:min-w-[58px] shrink-0 ${
                    activeTab === 'admin'
                      ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md scale-105'
                      : isDarkMode
                      ? 'bg-slate-800 text-amber-300 hover:bg-slate-700 border-slate-700'
                      : 'bg-amber-100 text-amber-950 hover:bg-amber-200 border-amber-300'
                  }`}
                  title="صفحة الادمن"
                >
                  <Shield className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-amber-500 shrink-0" />
                  <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">أدمن</span>
                </button>
              )}

              {/* Theme Toggle Button */}
              <button
                onClick={toggleDarkMode}
                className={`px-1.5 py-1 sm:px-2.5 sm:py-2 rounded-xl border font-black text-[8.5px] sm:text-xs flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all shadow-sm active:scale-95 min-w-[34px] sm:min-w-[58px] shrink-0 ${
                  isDarkMode
                    ? 'bg-slate-800 text-amber-300 hover:bg-slate-700 border-slate-700'
                    : 'bg-emerald-100 text-emerald-950 hover:bg-emerald-200 border-emerald-300'
                }`}
                title={isDarkMode ? 'التحويل للوضع الفاتح' : 'التحويل للوضع المظلم'}
              >
                {isDarkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-amber-400 fill-amber-400/20 shrink-0" />
                    <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">فاتح</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-emerald-800 fill-emerald-800/20 shrink-0" />
                    <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">داكن</span>
                  </>
                )}
              </button>

              {/* Logout Button */}
              <button
                onClick={() => setShowLogoutModal(true)}
                className={`px-1.5 py-1 sm:px-2.5 sm:py-2 rounded-xl border font-black text-[8.5px] sm:text-xs flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all shadow-sm active:scale-95 min-w-[34px] sm:min-w-[58px] shrink-0 ${
                  isDarkMode
                    ? 'bg-red-950/80 text-red-300 hover:bg-red-900 border-red-800/80'
                    : 'bg-red-600 text-white hover:bg-red-700 border-red-600'
                }`}
                title="تسجيل الخروج والعودة لشاشة الدخول"
              >
                <LogOut className="w-3.5 h-3.5 sm:w-5 sm:h-5 shrink-0" />
                <span className="text-[8px] sm:text-[11px] leading-tight font-extrabold">خروج</span>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs (Pinned inside desktop sticky header) */}
        <div
          className={`transition-colors border-b hidden sm:flex ${
            isDarkMode
              ? 'bg-slate-900/95 border-slate-800 text-white'
              : 'bg-white/95 border-slate-200 text-slate-900'
          }`}
        >
          <div className="max-w-5xl mx-auto px-1 sm:px-4 flex flex-wrap">
          {!isSauceUser && (
            <button
              onClick={() => handleTabChange('entry')}
              onMouseEnter={() => import('./components/EntryScreen')}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[60px] ${
                activeTab === 'entry'
                  ? isDarkMode
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                    : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>الفواتير</span>
            </button>
          )}

          {/* OLD INVOICES TAB (الفواتير القديمة) - DIRECTLY ADJACENT TO ENTRY - STRICTLY ADMIN ONLY */}
          {currentUser?.isAdmin && !isSauceUser && (
            <button
              onClick={() => handleTabChange('old_invoices')}
              onMouseEnter={() => import('./components/OldInvoicesScreen')}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[70px] ${
                activeTab === 'old_invoices'
                  ? isDarkMode
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                    : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <History className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
              <span>الفواتير القديمة</span>
            </button>
          )}

          {!isSauceUser && (
            <button
              onClick={() => handleTabChange('routes')}
              onMouseEnter={() => import('./components/RoutesScreen')}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[60px] ${
                activeTab === 'routes'
                  ? isDarkMode
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                    : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <MapPin className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
              <span>المسارات</span>
            </button>
          )}

          {!isSauceUser && (
            <button
              onClick={() => handleTabChange('reports')}
              onMouseEnter={() => {
                import('./components/ReportsScreen');
                import('./components/LowAchievementWidget');
              }}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[60px] ${
                activeTab === 'reports'
                  ? isDarkMode
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                    : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <BarChart2 className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>التقارير</span>
            </button>
          )}

          {/* ITEM TRACKING TAB (متابعة الأصناف) - ADMIN, DATA ENTRY & MOHAMMEDSAUCE */}
          {isAllowedItemTracking && (
            <button
              onClick={() => handleTabChange('item_tracking')}
              onMouseEnter={() => import('./components/ItemTrackingScreen')}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[70px] ${
                activeTab === 'item_tracking'
                  ? isDarkMode
                    ? 'border-amber-400 text-amber-300 bg-amber-900/30'
                    : 'border-amber-600 text-amber-800 bg-amber-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Layers className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400" />
              <span>متابعة الأصناف</span>
            </button>
          )}

          {/* EVALUATIONS TAB (تقييمات) */}
          {!isSauceUser && (
            <button
              onClick={() => handleTabChange('evaluations')}
              onMouseEnter={() => import('./components/EvaluationsScreen')}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[60px] ${
                activeTab === 'evaluations'
                  ? isDarkMode
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                    : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Award className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400" />
              <span>التقييمات</span>
            </button>
          )}

          {/* PRODUCTS TAB (المنتجات) */}
          <button
            onClick={() => {
              setShowQuickAdd(false);
              handleTabChange('products');
            }}
            onMouseEnter={() => import('./components/ProductsScreen')}
            className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[60px] ${
              activeTab === 'products'
                ? isDarkMode
                  ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                  : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                : isDarkMode
                ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <Package className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
            <span>المنتجات</span>
          </button>

          {/* RETURNS TAB (المرتجعات) */}
          {!isSauceUser && (
            <button
              onClick={() => {
                setShowQuickAdd(false);
                handleTabChange('returns');
              }}
              onMouseEnter={() => import('./components/ReturnsScreen')}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[60px] ${
                activeTab === 'returns'
                  ? isDarkMode
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                    : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <RotateCcw className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
              <span>المرتجعات</span>
            </button>
          )}

          {/* QC TAB (QC) */}
          {!isSauceUser && (
            <button
              onClick={() => {
                setShowQuickAdd(false);
                handleTabChange('qc');
              }}
              onMouseEnter={() => import('./components/QCScreen')}
              className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-extrabold flex items-center justify-center gap-1 border-b-2 transition-all min-w-[60px] ${
                activeTab === 'qc'
                  ? isDarkMode
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                    : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4 text-amber-500" />
              <span>QC</span>
            </button>
          )}

          </div>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200" 
          onClick={() => setShowLogoutModal(false)}
        >
          <div 
            className={`p-6 rounded-3xl shadow-2xl w-full max-w-sm border text-right space-y-4 ring-1 ring-black/10 dark:ring-white/10 animate-in zoom-in-95 duration-200 ${
              isDarkMode 
                ? 'bg-slate-900/95 backdrop-blur-sm border-slate-700 text-white' 
                : 'bg-white/95 backdrop-blur-sm border-slate-200 text-slate-900'
            }`} 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 rounded-2xl">
                <LogOut className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-base">تأكيد تسجيل الخروج</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">هل أنت متأكد أنك تريد تسجيل الخروج؟</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowLogoutModal(false)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs border transition-colors ${isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}`}
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  setShowLogoutModal(false);
                  setActiveTab('entry');
                  logout();
                }}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-md transition-all"
              >
                تأكيد الخروج
              </button>
            </div>
          </div>
        </div>
      )}
        


      {/* Products Under 50% Widget - Visible in Reports Tab Only (Lazy Loaded) */}
      {!isSauceUser && activeTab === 'reports' && (
        <Suspense fallback={null}>
          <LowAchievementWidget />
        </Suspense>
      )}

      {/* Global Message Toast */}
      {userMessage && (
        <div className="max-w-5xl mx-auto w-full px-3 sm:px-4 pt-3">
          <div
            className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between gap-2 shadow-lg animate-in fade-in slide-in-from-top-2 border ${
              isDarkMode
                ? 'bg-emerald-900/90 border-emerald-400 text-emerald-100'
                : 'bg-emerald-100 border-emerald-500 text-emerald-950'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2
                className={`w-4 h-4 shrink-0 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}
              />
              <span>{userMessage}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Screen Body - Strict Protection */}
      <main className="flex-1 pb-20 sm:pb-12 pt-2">
        <Suspense fallback={
          <div className="flex items-center justify-center py-24">
            <div className="relative w-16 h-16 flex items-center justify-center animate-pulse">
              <div className="absolute w-16 h-16 border-[6px] border-slate-200 rounded-full"></div>
              <div className="absolute w-16 h-16 border-[6px] border-transparent border-t-emerald-500 rounded-full animate-spin"></div>
            </div>
          </div>
        }>
          {isSauceUser ? (
            <>
              {activeTab === 'item_tracking' ? (
                <ItemTrackingScreen />
              ) : (
                <ProductsScreen largeFont={largeFont} />
              )}
            </>
          ) : (
            <>
              {activeTab === 'entry' && <EntryScreen />}
              {activeTab === 'old_invoices' && currentUser?.isAdmin && <OldInvoicesScreen />}
              {activeTab === 'routes' && <RoutesScreen />}
              {activeTab === 'reports' && <ReportsScreen />}
              {activeTab === 'evaluations' && <EvaluationsScreen />}
              {activeTab === 'products' && <ProductsScreen largeFont={largeFont} />}
              {activeTab === 'returns' && <ReturnsScreen />}
              {activeTab === 'qc' && <QCScreen />}
              {activeTab === 'item_tracking' && isAllowedItemTracking && <ItemTrackingScreen />}
              {activeTab === 'admin' && (
                currentUser.username?.toLowerCase() !== 'rafatdata' && currentUser.role !== 'dataEntry' ? (
                  <AdminScreen />
                ) : (
                  <EntryScreen />
                )
              )}
            </>
          )}
        </Suspense>
      </main>

      {/* Bottom Navigation (Mobile Only) */}
      <BottomNav 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isDarkMode={isDarkMode} 
        setShowQuickAdd={setShowQuickAdd} 
        isAdmin={currentUser?.isAdmin}
        canAccessItemTracking={isAllowedItemTracking}
        isSauceUser={isSauceUser}
      />

      {/* Footer */}
      <footer
        className={`border-t py-4 text-center text-xs font-bold transition-colors ${
          isDarkMode
            ? 'bg-slate-950 border-slate-800/80 text-slate-400'
            : 'bg-slate-200 border-slate-300 text-slate-700'
        }`}
      >
تصميم وبرمجة  |  مهندس ياسر المعجون  |  كالة فرع صلاح الدين      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <SalesProvider>
      <MainAppContent />
      <GlobalDialogModal />
    </SalesProvider>
  );
};

export default App;
