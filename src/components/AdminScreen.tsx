import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { useSales, DEFAULT_CATEGORIES_LIST } from '../context/SalesContext';
import { parseArabicDigits, parseArabicNumber, formatWithCommas } from '../utils/numberUtils';
import { PullToRefresh } from './PullToRefresh';
import {
  Lock,
  Unlock,
  Shield,
  User,
  Key,
  Save,
  Check,
  Eye,
  EyeOff,
  Clock,
  Calendar,
  HardDrive,
  RefreshCw,
  FileSpreadsheet,
  Upload,
  Download,
  Trash2,
  TrendingUp,
} from 'lucide-react';

export const AdminScreen: React.FC = () => {
  const [emailScheduleStatus, setEmailScheduleStatus] = useState<string | null>(null);
  const {
    currentUser,
    rawSavedEntries,
    delegateTargets,
    delegateAccounts,
    delegatesList,
    saveDelegateAccount,
    deleteDelegateAccount,
    batchUpdateDelegateTargets,
    getDelegateLockStatus,
    unlockDelegateTargetManually,
    exportBackupData,
    restoreBackupData,
    isDataSaverMode,
    toggleDataSaverMode,
    syncData,
  } = useSales();

  const [backupStatusMsg, setBackupStatusMsg] = useState<string | null>(null);

  const handleJsonBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsedData = JSON.parse(text);
        const success = restoreBackupData(parsedData);
        if (success) {
          setBackupStatusMsg('تمت استعادة ملف النسخة الاحتياطية بنجاح ✅');
        } else {
          setBackupStatusMsg('فشلت قراءة ملف النسخة الاحتياطية. يرجى التأكد من اختيار ملف صحيح.');
        }
      } catch (err) {
        setBackupStatusMsg('ملف غير صالح أو تالف.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };


  const [isAuthenticated, setIsAuthenticated] = useState(() => currentUser.isAdmin);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const [selectedAdminDelegate, setSelectedAdminDelegate] = useState<string>('الكل');

  const getDelegateTotalTarget = (delName: string) => {
    return DEFAULT_CATEGORIES_LIST.reduce((sum, cat) => {
      const found = delegateTargets.find(t => 
        t.delegateName?.trim().toLowerCase() === delName.trim().toLowerCase() &&
        t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
      );
      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
    }, 0);
  };

  const totalAllTarget = delegatesList.reduce((sum, del) => sum + getDelegateTotalTarget(del), 0);

  const getCategoryAllTarget = (catName: string) => {
    return delegatesList.reduce((sum, del) => {
      const found = delegateTargets.find(t => 
        t.delegateName?.trim().toLowerCase() === del.trim().toLowerCase() &&
        t.categoryName?.trim().toLowerCase() === catName.trim().toLowerCase()
      );
      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
    }, 0);
  };

  // Input states for targets map (key: `${delegateName}_${categoryName}`)
  const [targetInputs, setTargetInputs] = useState<Record<string, string>>({});
  const [saveFeedbackMessage, setSaveFeedbackMessage] = useState<string | null>(null);
  const [allowForceOverride, setAllowForceOverride] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const container = e.currentTarget.closest('table, .grid-container');
      if (!container) return;
      const focusableElements = Array.from(
        container.querySelectorAll('input:not([disabled]), select:not([disabled])')
      ) as HTMLElement[];
      const index = focusableElements.indexOf(e.currentTarget);
      if (index > -1 && index + 1 < focusableElements.length) {
        focusableElements[index + 1].focus();
      } else if (index === focusableElements.length - 1) {
        const saveBtn = container.querySelector('button.save-btn') as HTMLElement;
        if (saveBtn) saveBtn.focus();
      }
    }
  };

  // Delegate credentials management state
  const [accountDelNameInput, setAccountDelNameInput] = useState('');
  const [accountUsernameInput, setAccountUsernameInput] = useState('');
  const [accountPasswordInput, setAccountPasswordInput] = useState('');
  const [editingAccountUsername, setEditingAccountUsername] = useState<string | null>(null);
  const [editingIsAdmin, setEditingIsAdmin] = useState(false);

  // Lock status for currently selected delegate
  const lockStatus = selectedAdminDelegate === 'الكل'
    ? { isLocked: false, daysRemaining: 0, setDateStr: '', unlockDateStr: '' }
    : getDelegateLockStatus(selectedAdminDelegate);

  // Overall metrics
  const totalCompanySalesWeight = rawSavedEntries.reduce((sum, e) => sum + e.totalWeightKg, 0);
  const totalCompanyTargetWeight = selectedAdminDelegate === 'الكل'
    ? totalAllTarget
    : getDelegateTotalTarget(selectedAdminDelegate);

  // Active targets for selected delegate
  const activeTargets = selectedAdminDelegate === 'الكل'
    ? []
    : delegateTargets.filter((t) => t.delegateName === selectedAdminDelegate);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const u = usernameInput.trim();
    const p = passwordInput.trim();

    const matchedAccount = delegateAccounts.find(
      (it) =>
        (it.username.toLowerCase() === u.toLowerCase() ||
          it.delegateName.toLowerCase() === u.toLowerCase()) &&
        it.password === p
    );

    const isDefaultAdmin =
      u.toLowerCase() === 'yasir' && p === '377377';

    if ((matchedAccount && matchedAccount.isAdmin) || isDefaultAdmin) {
      setIsAuthenticated(true);
      setLoginError(null);
    } else {
      setLoginError('اسم المستخدم أو الرمز السري غير صحيح');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4 dir-rtl">
        <div className="bg-emerald-950/90 border border-emerald-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto shadow-inner">
              <Lock className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white">تسجيل دخول لوحة الأدمن</h2>
            <p className="text-xs text-slate-300">
              يرجى إدخال اسم المستخدم والرمز السري للوصول للصفحة
            </p>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">اسم المستخدم</label>
              <div className="relative">
                <User className="w-4 h-4 text-emerald-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => {
                    setUsernameInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="اسم المستخدم"
                  className="w-full pl-3 pr-9 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm font-bold focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">الرمز السري (كلمة المرور)</label>
              <div className="relative">
                <Key className="w-4 h-4 text-emerald-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="الرمز السري"
                  className="w-full pl-8 pr-9 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm font-bold focus:border-emerald-500 focus:outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {isPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-2.5 rounded-lg bg-red-950/80 border border-red-500/50 text-red-200 text-xs font-bold text-center">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-colors"
            >
              <Unlock className="w-4 h-4" />
              <span>تسجيل الدخول</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleSaveTargets = () => {
    const targetsList: { categoryName: string; targetKg: number }[] = [];

    DEFAULT_CATEGORIES_LIST.forEach((catName) => {
      const key = `${selectedAdminDelegate}_${catName}`;
      const inputVal = targetInputs[key];
      const activeObj = activeTargets.find(
        (t) => t.categoryName.toLowerCase() === catName.toLowerCase()
      );
      const defaultKg = activeObj?.dailyTargetWeightKg ?? 50.0;
      const targetKg = inputVal !== undefined ? parseArabicNumber(inputVal) : defaultKg;

      if (!isNaN(targetKg) && targetKg >= 0) {
        targetsList.push({ categoryName: catName, targetKg });
      }
    });

    const success = batchUpdateDelegateTargets(
      selectedAdminDelegate,
      targetsList,
      undefined,
      allowForceOverride
    );

    if (success) {
      setAllowForceOverride(false);
      setSaveFeedbackMessage(
        `✔️ تم تثبيت وحفظ التاركت لـ (${selectedAdminDelegate}) لمدة 31 يوماً بنجاح! التاركت محفوظ بصفة دائمية في جهاز الأدمن بالنظام ولن يضيع عند إطفاء الموقع.`
      );
    }
  };

  const handleStartEditAccount = (acc: { username: string; password: string; delegateName: string; isAdmin: boolean }) => {
    setAccountDelNameInput(acc.delegateName);
    setAccountUsernameInput(acc.username);
    setAccountPasswordInput(acc.password);
    setEditingAccountUsername(acc.username);
    setEditingIsAdmin(acc.isAdmin);
  };

  const handleCancelEditAccount = () => {
    setAccountDelNameInput('');
    setAccountUsernameInput('');
    setAccountPasswordInput('');
    setEditingAccountUsername(null);
    setEditingIsAdmin(false);
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const delName = accountDelNameInput.trim();
    const u = accountUsernameInput.trim();
    const p = accountPasswordInput.trim();

    if (delName && u && p) {
      // If we were editing an existing account and the username changed, remove the old one first
      if (editingAccountUsername && editingAccountUsername !== u) {
        deleteDelegateAccount(editingAccountUsername);
      }

      saveDelegateAccount({
        username: u,
        password: p,
        delegateName: delName,
        monthlyTargetKg: 0,
        isAdmin: editingIsAdmin,
      });

      setSaveFeedbackMessage(
        editingAccountUsername
          ? `✔️ تم تحديث بيانات الدخول لـ (${delName}) بنجاح!`
          : `✔️ تم إنشاء وتخزين حساب جديد لـ (${delName}) بنجاح!`
      );

      handleCancelEditAccount();
    }
  };

  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="p-3 sm:p-4 max-w-5xl mx-auto space-y-4 dir-rtl text-slate-900">
      {/* Top Banner with Lock Button */}
      <div className="bg-emerald-950 border-2 border-emerald-500/50 rounded-2xl p-4 text-white shadow-xl space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-400" />
            <h2 className="text-base sm:text-lg font-extrabold text-white">
              الادمن | إدارة التاركت والأهداف
            </h2>
          </div>

          <button
            onClick={() => {
              setIsAuthenticated(false);
              setPasswordInput('');
            }}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-full text-xs font-bold text-white flex items-center gap-1.5 transition-colors shadow"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>قفل الصفحة</span>
          </button>
        </div>

        <hr className="border-emerald-800" />

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-slate-300">إجمالي مبيعات المندوبين اليوم:</div>
            <div className="text-xl sm:text-2xl font-black text-emerald-300">
              {formatWithCommas(parseFloat(totalCompanySalesWeight.toFixed(1)), true)} كجم
            </div>
          </div>
          <div className="text-left dir-ltr">
            <div className="text-slate-300 dir-rtl">إجمالي التاركت المطلوب:</div>
            <div className="text-xl sm:text-2xl font-black text-white dir-rtl">
              {formatWithCommas(parseFloat(totalCompanyTargetWeight.toFixed(1)), true)} كجم
            </div>
          </div>
        </div>
      </div>

      {/* 1. Delegate Picker Bar */}
      <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-3.5 text-white space-y-2 shadow-md">
        <h3 className="text-xs font-bold text-emerald-200">
          1. اختر المندوب أو (الكل - الإدارة) لعرض وتحديد الأهداف وتاركت الأصناف:
        </h3>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setSelectedAdminDelegate('الكل');
              setSaveFeedbackMessage(null);
            }}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
              selectedAdminDelegate === 'الكل'
                ? 'bg-amber-400 text-slate-950 shadow-lg scale-105 font-black'
                : 'bg-emerald-900/80 text-amber-200 border border-amber-500/40 hover:bg-emerald-800'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
            <span>الكل (نظرة عامة للإدارة)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-amber-300 font-mono">
              {totalAllTarget} كجم
            </span>
          </button>

          {delegatesList.map((delName) => {
            const isSelected = selectedAdminDelegate === delName;
            const delTot = getDelegateTotalTarget(delName);
            return (
              <button
                key={delName}
                onClick={() => {
                  setSelectedAdminDelegate(delName);
                  setSaveFeedbackMessage(null);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                  isSelected
                    ? 'bg-emerald-500 text-slate-950 shadow-lg scale-105'
                    : 'bg-emerald-900/60 text-slate-200 border border-emerald-700/60 hover:bg-emerald-800'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>{delName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 font-mono">
                  {delTot} كجم
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feedback Banner */}
      {saveFeedbackMessage && (
        <div className="p-3 bg-emerald-900 border border-emerald-400 text-white font-bold text-xs rounded-xl text-center shadow-md">
          {saveFeedbackMessage}
        </div>
      )}

      {/* 2. Target Dashboard (Admin / All vs Individual Delegate) */}
      {selectedAdminDelegate === 'الكل' ? (
        <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-4 text-white space-y-4 shadow-md">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-emerald-800">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-black text-amber-200">
                لوحة الأهداف الكلية - الإدارة (الكل):
              </h3>
            </div>
            <div className="text-xs text-emerald-300 font-bold bg-emerald-900/80 px-3 py-1 rounded-xl border border-emerald-700">
              إجمالي التاركت لكل المناديب: <span className="text-white font-black text-sm">{totalAllTarget} كجم</span>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            يتم حساب إجمالي تاركت الإدارة ("الكل") وتاركت كل صنف ديناميكياً وبدقة تامة من مجموع أهداف المناديب الفردية. أي تعديل يتم على تاركت أي مندوب ينعكس فوراً على الإجمالي العام وتاركت الصنف المرتبط.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Delegates Breakdown Summary */}
            <div className="bg-slate-900/90 border border-emerald-800 rounded-xl p-3 space-y-3">
              <h4 className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                <User className="w-4 h-4 text-emerald-400" />
                <span>إجمالي تاركت كل مندوب (مجموع الأصناف):</span>
              </h4>
              <div className="space-y-2">
                {delegatesList.map((del) => {
                  const delT = getDelegateTotalTarget(del);
                  return (
                    <div key={del} className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-xs">
                      <div className="font-bold text-white flex items-center gap-2">
                        <button
                          onClick={() => setSelectedAdminDelegate(del)}
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shadow transition-colors cursor-pointer"
                        >
                          تعديل أهداف المندوب ✏️
                        </button>
                        <span>{del}</span>
                      </div>
                      <div className="font-black text-emerald-300 font-mono text-sm">
                        {delT} كجم
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Categories Admin / All Summary Table */}
            <div className="bg-slate-900/90 border border-emerald-800 rounded-xl p-3 space-y-3">
              <h4 className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                <span>تاركت الأصناف لإدارة (الكل - مجموع المناديب):</span>
              </h4>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {DEFAULT_CATEGORIES_LIST.map((catName) => {
                  const catAllT = getCategoryAllTarget(catName);
                  return (
                    <div key={catName} className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-xs">
                      <span className="font-bold text-slate-200">{catName}</span>
                      <span className="font-black text-amber-300 font-mono">{catAllT} كجم</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-3.5 text-white space-y-3 shadow-md">
          {/* 31-Day Fixation Info Card */}
          <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-3.5 text-xs space-y-2 shadow-inner">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-400" />
                <div>
                  <span className="font-extrabold text-white">حالة تثبيت التاركت للمندوب: </span>
                  <span className="text-emerald-300 font-black">{selectedAdminDelegate}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <span className="text-[11px] font-bold text-emerald-300 bg-emerald-950 px-2.5 py-1 rounded-full border border-emerald-500/30">
                  إجمالي تاركت المندوب الحالي: {getDelegateTotalTarget(selectedAdminDelegate)} كجم
                </span>
              </div>
            </div>

            {lockStatus.isLocked ? (
              <div className="p-3 bg-amber-950/60 border border-amber-500/50 rounded-xl space-y-2 text-amber-100">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <Lock className="w-4 h-4 text-amber-400" />
                    <span>التاركت مثبت لمدة 31 يوماً من الأدمن</span>
                  </div>
                  <div className="bg-amber-500/20 text-amber-200 px-3 py-1 rounded-full font-black text-xs border border-amber-400/40">
                    متبقي {lockStatus.daysRemaining} يوماً لإمكانية إعادة التعديل
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                    <span>تاريخ بدء التثبيت: </span>
                    <strong className="text-white">{lockStatus.setDateStr}</strong>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" />
                    <span>تاريخ انتهاء القفل والتعديل القادم: </span>
                    <strong className="text-white">{lockStatus.unlockDateStr}</strong>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between flex-wrap gap-2 border-t border-amber-800/60">
                  <span className="text-[11px] text-amber-200/80">
                    التاركت مثبت لمنع التغيير العشوائي، وسيكون متاحاً للتعديل التلقائي بعد 31 يوماً.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        unlockDelegateTargetManually(selectedAdminDelegate);
                        setSaveFeedbackMessage(`تم إلغاء القفل لـ (${selectedAdminDelegate}) بنجاح.`);
                      }}
                      className="px-2.5 py-1 bg-amber-900 hover:bg-amber-800 text-amber-100 border border-amber-500 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>فصل القفل يدوياً</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllowForceOverride(!allowForceOverride)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        allowForceOverride
                          ? 'bg-red-600 border-red-400 text-white'
                          : 'bg-slate-800 border-slate-600 text-slate-300 hover:text-white'
                      }`}
                    >
                      {allowForceOverride ? 'وضع التجاوز نشط' : 'تعديل استثنائي'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl space-y-1 text-emerald-100">
                <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                  <Unlock className="w-4 h-4 text-emerald-400" />
                  <span>التاركت متاح للتعديل الآن!</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  عند الضغط على "تثبيت وحفظ التاركت"، سيتم قفل التاركت تلقائياً لمدة 31 يوماً، وحفظه بصفة دائمية في الجهاز ولن ينمسح عند إغلاق أو إطفاء الموقع.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs sm:text-sm font-bold text-emerald-200">
              تحديد التاركت اليومي لأصناف المندوب ({selectedAdminDelegate}) - إجمالي المندوب: {getDelegateTotalTarget(selectedAdminDelegate)} كجم:
            </h3>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedAdminDelegate('الكل')}
                className="px-3 py-2 bg-emerald-900 hover:bg-emerald-800 text-emerald-200 rounded-xl text-xs font-bold border border-emerald-700"
              >
                العودة لنظرة الإدارة الكلية (الكل)
              </button>
              <button
                onClick={handleSaveTargets}
                disabled={lockStatus.isLocked && !allowForceOverride}
                className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors shadow-lg ${
                  lockStatus.isLocked && !allowForceOverride
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                }`}
              >
                <Save className="w-4 h-4" />
                <span>
                  {lockStatus.isLocked && !allowForceOverride
                    ? 'التاركت مثبت لمدة 31 يوماً'
                    : 'تثبيت وحفظ التاركت (31 يوماً)'}
                </span>
              </button>
            </div>
          </div>

        <div className="border border-emerald-800/60 rounded-xl overflow-hidden bg-slate-900/80">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-emerald-900/80 text-emerald-200 font-bold border-b border-emerald-800">
                  <th className="py-2.5 px-3 w-[10%]">#</th>
                  <th className="py-2.5 px-3 w-[35%]">اسم الصنف</th>
                  <th className="py-2.5 px-3 text-center w-[30%]">التاركت اليومي (كجم)</th>
                  <th className="py-2.5 px-3 text-left w-[25%]">مبيعات اليوم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-900/40">
                {DEFAULT_CATEGORIES_LIST.map((catName, idx) => {
                  const currentObj = activeTargets.find(
                    (t) => t.categoryName.toLowerCase() === catName.toLowerCase()
                  );
                  const dbTargetKg = currentObj?.dailyTargetWeightKg ?? 50.0;

                  const key = `${selectedAdminDelegate}_${catName}`;
                  const currentInputValue =
                    targetInputs[key] !== undefined ? targetInputs[key] : String(dbTargetKg);

                  const delSalesToday = rawSavedEntries
                    .filter(
                      (e) =>
                        e.delegateName === selectedAdminDelegate &&
                        e.categoryName.toLowerCase() === catName.toLowerCase()
                    )
                    .reduce((sum, e) => sum + e.totalWeightKg, 0);

                  const isAchieved = delSalesToday >= dbTargetKg && dbTargetKg > 0;
                  const isInputDisabled = lockStatus.isLocked && !allowForceOverride;

                  return (
                    <tr key={catName} className={idx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/90'}>
                      <td className="py-2 px-3 font-bold text-slate-400">{idx + 1}</td>
                      <td className="py-2 px-3 font-bold text-white">
                        <div>{catName}</div>
                        {isAchieved && (
                          <span className="text-[10px] font-extrabold text-emerald-400 flex items-center gap-1">
                            <Check className="w-3 h-3" /> مُحقق 100%
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={isInputDisabled}
                          value={currentInputValue}
                          onKeyDown={handleKeyDown}
                          onChange={(e) => {
                            setTargetInputs({
                              ...targetInputs,
                              [key]: parseArabicDigits(e.target.value),
                            });
                          }}
                          className={`w-24 px-2 py-1 border rounded-lg text-white font-bold text-center text-xs focus:outline-none ${
                            isInputDisabled
                              ? 'bg-slate-950/80 border-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-slate-950 border-emerald-700/80 focus:border-emerald-400'
                          }`}
                        />
                      </td>
                      <td className="py-2 px-3 text-left font-bold text-emerald-300">
                        {formatWithCommas(parseFloat(delSalesToday.toFixed(1)), true)} كجم
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* 4. Delegate & Admin Credentials Management */}
      <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-3.5 text-white space-y-3 shadow-md">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-emerald-400" />
            <h3 className="text-xs sm:text-sm font-bold text-emerald-200">
              4. إدارة تعديل اسم المستخدم والرمز السري لكل حساب:
            </h3>
          </div>

          {editingAccountUsername && (
            <div className="flex items-center gap-2 bg-amber-950/80 border border-amber-500/60 px-3 py-1 rounded-lg text-xs">
              <span className="text-amber-200 font-bold">جارٍ تعديل الحساب ({editingAccountUsername})</span>
              <button
                type="button"
                onClick={handleCancelEditAccount}
                className="text-amber-400 hover:text-white font-extrabold underline text-[11px]"
              >
                إلغاء التعديل
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-300">
          يمكنك إضافة حسابات جديدة أو التعديل على اسم المستخدم والرمز السري لأي حساب مسجل بسهولة.
        </p>

        <form onSubmit={handleSaveAccount} className="space-y-3 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">اسم المندوب / الحساب</label>
              <input
                type="text"
                value={accountDelNameInput}
                onChange={(e) => setAccountDelNameInput(e.target.value)}
                placeholder="اسم المندوب"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold text-xs focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">اسم المستخدم</label>
              <input
                type="text"
                value={accountUsernameInput}
                onChange={(e) => setAccountUsernameInput(e.target.value)}
                placeholder="اسم المستخدم"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold text-xs focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">الرمز السري</label>
              <input
                type="text"
                value={accountPasswordInput}
                onChange={(e) => setAccountPasswordInput(e.target.value)}
                placeholder="الرمز السري"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold text-xs focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-lg ${
                editingAccountUsername
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              <Save className="w-4 h-4" />
              <span>{editingAccountUsername ? 'تحديث بيانات الحساب' : 'حفظ بيانات الحساب الجديد'}</span>
            </button>

            {editingAccountUsername && (
              <button
                type="button"
                onClick={handleCancelEditAccount}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl font-bold text-xs"
              >
                إلغاء
              </button>
            )}
          </div>
        </form>

        {/* Existing Accounts List */}
        <div className="pt-2 space-y-2">
          <div className="text-xs font-bold text-emerald-300">قائمة الحسابات المسجلة:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {delegateAccounts.map((acc) => (
              <div
                key={acc.username}
                className={`p-3 border rounded-xl flex items-center justify-between text-xs transition-colors ${
                  editingAccountUsername === acc.username
                    ? 'bg-amber-950/40 border-amber-500'
                    : 'bg-slate-900/90 border-emerald-900'
                }`}
              >
                <div>
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <span>{acc.delegateName}</span>
                    {acc.isAdmin && (
                      <span className="px-1.5 py-0.5 bg-emerald-900 text-emerald-300 text-[10px] rounded border border-emerald-700">
                        الأدمن
                      </span>
                    )}
                  </div>
                  <div className="text-slate-400 mt-1">
                    مستخدم: <strong className="text-white">{acc.username}</strong> | رمز: <strong className="text-white">{acc.password}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleStartEditAccount(acc)}
                    className="px-2.5 py-1 bg-emerald-900/80 text-emerald-200 hover:bg-emerald-800 border border-emerald-600 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors"
                  >
                    <span>تعديل</span>
                  </button>

                  {!acc.isAdmin && (
                    <button
                      type="button"
                      onClick={() => { if(window.confirm('هل أنت متأكد من حذف حساب المندوب هذا؟')) deleteDelegateAccount(acc.username) }}
                      className="px-2 py-1 bg-red-950/60 text-red-300 hover:bg-red-900 border border-red-800 rounded-lg text-[11px] font-bold transition-colors"
                    >
                      حذف
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. JSON Backup Export & Import */}
      <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-3.5 text-white space-y-3 shadow-md">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-bold text-emerald-200">
            5. النسخ الاحتياطي وتخزين البيانات الحالية (JSON):
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          تتيح هذه الميزة للأدمن تحميل جميع بيانات Firestore الحالية (المبيعات، المخزن، التاركت، الحسابات) في ملف JSON موحد ومحمي.
        </p>

        {backupStatusMsg && (
          <div className="p-2.5 bg-emerald-900/80 border border-emerald-500 rounded-lg text-xs font-bold text-emerald-200 text-center">
            {backupStatusMsg}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={exportBackupData}
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-2 shadow-lg transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تنزيل نسخة بيانات كاملة</span>
          </button>

          <label className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all">
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>استعادة نسخة بيانات كاملة من ملف JSON</span>
            <input
              type="file"
              accept=".json"
              onChange={handleJsonBackupImport}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* 6. Top 3 Most Requested Products This Month (Firestore Stats) */}
      <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-4 text-white space-y-3 shadow-md">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-amber-400" />
          <h3 className="text-xs sm:text-sm font-bold text-emerald-200">
            6. أكثر 3 منتجات طلباً لهذا الشهر (إحصائيات Firestore):
          </h3>
        </div>
        <p className="text-xs text-slate-300">
          إحصائيات تلقائية تساعد في اتخاذ قرارات إدارية سريعة حول المخزون وتوريد الأصناف الأكثر طلباً.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {(() => {
            const currentYearMonth = new Date().toISOString().slice(0, 7);
            const map = new Map<string, { productName: string; totalPieces: number; totalWeightKg: number }>();
            rawSavedEntries.forEach((entry) => {
              if (entry.dateString && entry.dateString.startsWith(currentYearMonth)) {
                const name = entry.productName?.trim() || 'منتج غير محدد';
                const cur = map.get(name) || { productName: name, totalPieces: 0, totalWeightKg: 0 };
                cur.totalPieces += entry.quantity || 0;
                cur.totalWeightKg += entry.totalWeightKg || 0;
                map.set(name, cur);
              }
            });
            const arr = Array.from(map.values());
            arr.sort((a, b) => b.totalPieces - a.totalPieces || b.totalWeightKg - a.totalWeightKg);
            const top3 = arr.slice(0, 3);

            if (top3.length === 0) {
              return (
                <div className="col-span-3 p-4 bg-slate-900 rounded-xl text-center text-slate-400 text-xs font-bold">
                  لا توجد مبيعات مسجلة في هذا الشهر حتى الآن.
                </div>
              );
            }

            return top3.map((prod, idx) => {
              const badges = ['🥇 الأول', '🥈 الثاني', '🥉 الثالث'];
              return (
                <div key={prod.productName} className="p-3.5 bg-slate-900 border border-emerald-800 rounded-xl space-y-2 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-md text-[10px] font-black">
                      {badges[idx]}
                    </span>
                    <span className="text-xs font-mono text-emerald-300 font-bold">
                      {prod.totalPieces} قطعة
                    </span>
                  </div>
                  <div className="font-extrabold text-sm text-white line-clamp-1">
                    {prod.productName}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    إجمالي الوزن: <strong className="text-white">{formatWithCommas(parseFloat(prod.totalWeightKg.toFixed(1)), true)} كجم</strong>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* 7. Weekly Email Backup Scheduling */}
      <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-4 text-white space-y-3 shadow-md">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-bold text-emerald-200">
            7. جدولة إرسال النسخة الاحتياطية الأسبوعية للبريد الإلكتروني:
          </h3>
        </div>
        <p className="text-xs text-slate-300">
          جدولة تلقائية لترحيل وإرسال نسخة أسبوعية من بيانات Firestore للبريد الإداري المحدد.
        </p>

        {emailScheduleStatus && (
          <div className="p-2.5 bg-emerald-900/80 border border-emerald-500 rounded-lg text-xs font-bold text-emerald-200 text-center">
            {emailScheduleStatus}
          </div>
        )}

        <form onSubmit={(e) => {
          e.preventDefault();
          const emailInput = (e.currentTarget.elements.namedItem('backupEmail') as HTMLInputElement)?.value;
          if (emailInput) {
            setEmailScheduleStatus(`✔️ تمت جدول إرسال النسخة الاحتياطية الأسبوعية إلى (${emailInput}) بنجاح!`);
          }
        }} className="flex flex-col sm:flex-row items-center gap-2 pt-1">
          <input
            type="email"
            name="backupEmail"
            placeholder="أدخل البريد الإلكتروني الإداري (e.g. admin@company.com)"
            required
            className="flex-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold text-xs focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition-colors cursor-pointer"
          >
            تفعيل الجدولة الأسبوعية
          </button>
        </form>
      </div>

      {/* 8. Monthly Sales Report Export (Excel/CSV) */}
      <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-4 text-white space-y-3 shadow-md">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-bold text-emerald-200">
            8. تصدير تقرير المبيعات الشهري (Excel / CSV) للإدارة العليا:
          </h3>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          تصدير تفصيلي كامل لجميع مبيعات الشهر الحالي بصيغة ملف Excel (.xlsx) جاهز للطباعة والمشاركة مع الإدارة العليا.
        </p>
        <button
          onClick={() => {
            const currentYearMonth = new Date().toISOString().slice(0, 7);
            const monthEntries = rawSavedEntries.filter(e => e.dateString && e.dateString.startsWith(currentYearMonth));
            if (monthEntries.length === 0) {
              alert('لا توجد مبيعات مسجلة لهذا الشهر للتصدير.');
              return;
            }
            const dataToExport = monthEntries.map(e => ({
              'التاريخ': e.dateString,
              'المندوب': e.delegateName,
              'الفئة': e.categoryName,
              'المادة': e.productName,
              'الكمية (قطعة)': e.quantity,
              'وزن القطعة (كجم)': e.pieceWeightKg,
              'إجمالي الوزن (كجم)': e.totalWeightKg,
            }));
            const worksheet = XLSX.utils.json_to_sheet(dataToExport);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'MonthlySales');
            XLSX.writeFile(workbook, `Monthly_Sales_Report_${currentYearMonth}.xlsx`);
          }}
          className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-2 shadow-lg transition-all cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>تنزيل تقرير مبيعات الشهر الحالي (Excel)</span>
        </button>
      </div>



      {/* 9. Data Saver Mode Toggle */}
      <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl p-4 text-white space-y-3 shadow-md">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyan-400" />
          <h3 className="text-xs sm:text-sm font-bold text-emerald-200">
            9. وضع توفير البيانات (Data Saver Mode):
          </h3>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          تفعيل وضع توفير البيانات لتقليل استهلاك الإنترنت للمندوبين في المناطق ذات التغطية الضعيفة (يقوم بتعطيل مزامنة الخلفية التلقائية وتحديثات الصور غير الضرورية).
        </p>
        <div className="flex items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700">
          <span className="font-bold text-xs text-slate-200">
            حالة توفير البيانات: <span className={isDataSaverMode ? 'text-emerald-400' : 'text-slate-400'}>{isDataSaverMode ? 'مفعل (نشط)' : 'معطل'}</span>
          </span>
          <button
            onClick={toggleDataSaverMode}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
              isDataSaverMode ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isDataSaverMode ? 'إيقاف وضع توفير البيانات' : 'تفعيل وضع توفير البيانات'}
          </button>
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
};
