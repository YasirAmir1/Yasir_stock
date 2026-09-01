import React, { useState } from 'react';
import { SalesProvider, useSales } from './context/SalesContext';
import { EntryScreen } from './components/EntryScreen';
import { ReportsScreen } from './components/ReportsScreen';
import { AdminScreen } from './components/AdminScreen';
import { EvaluationsScreen } from './components/EvaluationsScreen';
import { ProductsScreen } from './components/ProductsScreen';
import { LoginScreen } from './components/LoginScreen';
import { CalculatorModal } from './components/CalculatorModal';
import { LowAchievementWidget } from './components/LowAchievementWidget';
import { AccountSwitcherModal } from './components/AccountSwitcherModal';
import { ToastContainer } from './components/ToastContainer';
import { AppLogo } from './components/AppLogo';
import { ScrollToTopButton } from './components/ScrollToTopButton';
import { DelegatePanelModal } from './components/DelegatePanelModal';
import { DelegateAlertsListener } from './components/DelegateAlertsListener';
import {
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
  } = useSales();
  const [activeTab, setActiveTab] = useState<'entry' | 'reports' | 'evaluations' | 'products' | 'admin'>('entry');
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showCalculatorModal, setShowCalculatorModal] = useState(false);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [largeFont, setLargeFont] = useState(false);

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <div
      className={`min-h-screen flex flex-col dir-rtl transition-colors duration-300 ${
        isDarkMode ? 'bg-emerald-950 text-slate-100' : 'bg-slate-100 text-slate-900'
      }`}
    >
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

      {/* Calculator Modal */}
      <CalculatorModal
        isOpen={showCalculatorModal}
        onClose={() => setShowCalculatorModal(false)}
      />

      {/* Delegate Modal */}
      {showDelegateModal && (
        <DelegatePanelModal
          onClose={() => setShowDelegateModal(false)}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Account Switcher Modal */}
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

      {/* Top Header Bar - Pinned */}
      <header className="sticky top-0 z-40 w-full">
        <div
          className={`backdrop-blur-md transition-all duration-300 border-b ${
            isDarkMode
              ? 'bg-slate-900/95 border-emerald-500/30 shadow-xl text-white'
              : 'bg-white/95 border-emerald-600/20 shadow-md text-slate-900'
          }`}
        >
          <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
            {/* Top row for Mobile (Logo + Delegate Name) & Logo for Desktop */}
            <div className="flex items-center justify-between w-full sm:w-auto shrink-0">
              {/* Brand Logo & App Title */}
              <div className="flex items-center gap-2.5 shrink-0">
                <AppLogo size="md" />
                <div className="flex flex-col">
                  <h1
                    className={`font-black text-base sm:text-lg tracking-tight leading-none ${
                      isDarkMode ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    Tikrit Sales
                  </h1>
                  <span
                    className={`text-[10px] sm:text-xs font-bold mt-0.5 ${
                      isDarkMode ? 'text-emerald-400' : 'text-emerald-700'
                    }`}
                  >
                    Build by: Eng.Yasir
                  </span>
                </div>
              </div>
              
              {/* User Info Card (Mobile Only) */}
              <div
                className={`sm:hidden px-2.5 py-1 rounded-xl border flex flex-col text-right ${
                  isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                    : 'bg-emerald-50/80 border-emerald-200 text-slate-900'
                }`}
              >
                <span className="font-extrabold text-xs leading-tight">
                  {currentUser.name}
                </span>
                <span
                  className={`text-[10px] font-bold ${
                    isDarkMode ? 'text-emerald-400' : 'text-emerald-700'
                  }`}
                >
                  {currentUser.roleName}
                </span>
              </div>
            </div>

            {/* Buttons Group & Desktop User Profile Info */}
            <div className="flex items-center justify-center sm:justify-end gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
              {/* User Info Card (Desktop Only) */}
              <div
                className={`hidden sm:flex px-2.5 py-1 rounded-xl border flex-col text-right ${
                  isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                    : 'bg-emerald-50/80 border-emerald-200 text-slate-900'
                }`}
              >
                <span className="font-extrabold text-xs leading-tight">
                  {currentUser.name}
                </span>
                <span
                  className={`text-[10px] font-bold ${
                    isDarkMode ? 'text-emerald-400' : 'text-emerald-700'
                  }`}
                >
                  {currentUser.roleName}
                </span>
              </div>

              {/* Delegate Button */}
              {!currentUser.isAdmin && (
                <button
                  onClick={() => setShowDelegateModal(true)}
                  className={`p-2 sm:px-3 sm:py-2 rounded-xl border font-black text-xs flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm active:scale-95 min-w-[54px] sm:min-w-[60px] ${
                    isDarkMode
                      ? 'bg-slate-800 text-blue-300 hover:bg-slate-700 border-slate-700'
                      : 'bg-blue-100 text-blue-950 hover:bg-blue-200 border-blue-300'
                  }`}
                  title="لوحة المندوب"
                >
                  <User className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="text-[10px] sm:text-[11px] leading-tight">المندوب</span>
                </button>
              )}

              {/* Calculator Button */}
              <button
                onClick={() => setShowCalculatorModal(true)}
                className={`p-2 sm:px-3 sm:py-2 rounded-xl border font-black text-xs flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm active:scale-95 min-w-[54px] sm:min-w-[60px] ${
                  isDarkMode
                    ? 'bg-slate-800 text-emerald-300 hover:bg-slate-700 border-slate-700'
                    : 'bg-emerald-100 text-emerald-950 hover:bg-emerald-200 border-emerald-300'
                }`}
                title="فتح الحاسبة السريعة"
              >
                <Calculator className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-[10px] sm:text-[11px] leading-tight">حاسبة</span>
              </button>

              {/* Font Size Toggle Button */}
              <button
                onClick={() => setLargeFont(!largeFont)}
                className={`p-2 sm:px-3 sm:py-2 rounded-xl border font-black text-xs flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm active:scale-95 min-w-[54px] sm:min-w-[60px] ${
                  largeFont
                    ? (isDarkMode ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : 'bg-amber-100 text-amber-800 border-amber-300')
                    : (isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300')
                }`}
                title="تكبير الخط"
              >
                <Type className={`w-5 h-5 shrink-0 ${largeFont ? (isDarkMode ? 'text-amber-400' : 'text-amber-600') : (isDarkMode ? 'text-slate-400' : 'text-slate-600')}`} />
                <span className="text-[10px] sm:text-[11px] leading-tight">الخط</span>
              </button>

              {/* Admin Button (Placed between Calculator and Theme Toggle) */}
              {(currentUser.isAdmin || currentUser.name === 'الأدمن') && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`p-2 sm:px-3 sm:py-2 rounded-xl border font-black text-xs flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm active:scale-95 min-w-[54px] sm:min-w-[60px] ${
                    activeTab === 'admin'
                      ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md scale-105'
                      : isDarkMode
                      ? 'bg-slate-800 text-amber-300 hover:bg-slate-700 border-slate-700'
                      : 'bg-amber-100 text-amber-950 hover:bg-amber-200 border-amber-300'
                  }`}
                  title="صفحة الادمن"
                >
                  <Shield className="w-5 h-5 text-amber-500 shrink-0" />
                  <span className="text-[10px] sm:text-[11px] leading-tight">الادمن</span>
                </button>
              )}

              {/* Theme Toggle Button */}
              <button
                onClick={toggleDarkMode}
                className={`p-2 sm:px-3 sm:py-2 rounded-xl border font-black text-xs flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm active:scale-95 min-w-[54px] sm:min-w-[60px] ${
                  isDarkMode
                    ? 'bg-slate-800 text-amber-300 hover:bg-slate-700 border-slate-700'
                    : 'bg-emerald-100 text-emerald-950 hover:bg-emerald-200 border-emerald-300'
                }`}
                title={isDarkMode ? 'التحويل للوضع الفاتح' : 'التحويل للوضع المظلم'}
              >
                {isDarkMode ? (
                  <>
                    <Sun className="w-5 h-5 text-amber-400 fill-amber-400/20 shrink-0" />
                    <span className="text-[10px] sm:text-[11px] leading-tight">فاتح</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-5 h-5 text-emerald-800 fill-emerald-800/20 shrink-0" />
                    <span className="text-[10px] sm:text-[11px] leading-tight">داكن</span>
                  </>
                )}
              </button>

              {/* Logout Button */}
              <button
                onClick={() => {
                  setActiveTab('entry');
                  logout();
                }}
                className={`p-2 sm:px-3 sm:py-2 rounded-xl border font-black text-xs flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm active:scale-95 min-w-[54px] sm:min-w-[60px] ${
                  isDarkMode
                    ? 'bg-red-950/80 text-red-300 hover:bg-red-900 border-red-800/80'
                    : 'bg-red-600 text-white hover:bg-red-700 border-red-600'
                }`}
                title="تسجيل الخروج والعودة لشاشة الدخول"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span className="text-[10px] sm:text-[11px] leading-tight">خروج</span>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs (Always sticky at top) */}
        <div
          className={`sticky top-0 z-45 backdrop-blur-md transition-colors border-b ${
            isDarkMode
              ? 'bg-slate-900/95 border-slate-800 text-white shadow-lg'
              : 'bg-white/95 border-slate-200 text-slate-900 shadow-md'
          }`}
        >
          <div className="max-w-5xl mx-auto px-3 sm:px-4 flex">
          <button
            onClick={() => setActiveTab('entry')}
            className={`flex-1 py-3 px-2 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'entry'
                ? isDarkMode
                  ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                  : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                : isDarkMode
                ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>ادخال</span>
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`flex-1 py-3 px-2 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 transition-all ${
              activeTab === 'reports'
                ? isDarkMode
                  ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                  : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                : isDarkMode
                ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            <span>التقرير</span>
          </button>

          {/* EVALUATIONS TAB (تقييمات) */}
          <button
            onClick={() => setActiveTab('evaluations')}
            className={`flex-1 py-3 px-2 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 transition-all ${
              activeTab === 'evaluations'
                ? isDarkMode
                  ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                  : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                : isDarkMode
                ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <Award className="w-4 h-4 text-amber-400" />
            <span>تقييمات</span>
          </button>

          {/* PRODUCTS TAB (المنتجات) */}
          <button
            onClick={() => setActiveTab('products')}
            className={`flex-1 py-3 px-2 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 transition-all ${
              activeTab === 'products'
                ? isDarkMode
                  ? 'border-emerald-400 text-emerald-300 bg-emerald-900/30'
                  : 'border-emerald-600 text-emerald-800 bg-emerald-100/70'
                : isDarkMode
                ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <Package className="w-4 h-4 text-emerald-400" />
            <span>المنتجات</span>
          </button>
          </div>
        </div>
      </header>

      {/* Products Under 50% Widget - Visible in Reports Tab Only */}
      {activeTab === 'reports' && <LowAchievementWidget />}

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

      {/* Main Screen Body */}
      <main className="flex-1 pb-12 pt-2">
        {activeTab === 'entry' && <EntryScreen />}
        {activeTab === 'reports' && <ReportsScreen />}
        {activeTab === 'evaluations' && <EvaluationsScreen />}
        {activeTab === 'products' && <ProductsScreen largeFont={largeFont} />}
        {activeTab === 'admin' && <AdminScreen />}
      </main>

      {/* Footer */}
      <footer
        className={`border-t py-4 text-center text-xs font-bold transition-colors ${
          isDarkMode
            ? 'bg-slate-950 border-slate-800/80 text-slate-400'
            : 'bg-slate-200 border-slate-300 text-slate-700'
        }`}
      >
        برمجة المهندس ياسر المعجون
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <SalesProvider>
      <MainAppContent />
    </SalesProvider>
  );
};

export default App;
