import React, { useState } from 'react';
import { useSales } from '../context/SalesContext';
import { AppLogo } from './AppLogo';
import { Lock, User, Key, Eye, EyeOff, Target, Sun, Moon, LogIn } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { loginWithCredentials, isDarkMode, toggleDarkMode } = useSales();
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim() || !passwordInput.trim()) {
      setLoginError('يرجى كتابة اسم المستخدم والرمز السري');
      return;
    }

    const res = loginWithCredentials(usernameInput, passwordInput);
    if (!res.success) {
      setLoginError(res.error || 'اسم المستخدم أو الرمز السري غير صحيح');
    }
  };

  const autofillCredentials = (u: string, p: string) => {
    setUsernameInput(u);
    setPasswordInput(p);
    setLoginError(null);
  };

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center p-4 dir-rtl transition-colors duration-300 ${
        isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'
      }`}
    >
      {/* Top Header Controls */}
      <div className="absolute top-4 right-4 left-4 max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AppLogo size="md" />
          <div>
            <h1 className={`font-black text-2xl tracking-tighter ${isDarkMode ? 'text-emerald-400' : 'text-emerald-900'}`}>
              Tikrit Sales
            </h1>
            <p className="text-xs font-bold text-slate-500 mt-0.5">
              برمجة: المهندس ياسر المعجون
            </p>
          </div>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleDarkMode}
          className={`px-3 py-1.5 rounded-xl border font-extrabold text-xs flex items-center gap-1.5 transition-all shadow-sm ${
            isDarkMode
              ? 'bg-slate-900 text-amber-300 hover:bg-slate-800 border-slate-800'
              : 'bg-white text-slate-800 hover:bg-slate-50 border-slate-300'
          }`}
        >
          {isDarkMode ? (
            <>
              <Sun className="w-4 h-4 text-amber-400 fill-amber-400/20" />
              <span className="hidden sm:inline">الوضع الفاتح</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-emerald-800 fill-emerald-800/20" />
              <span className="hidden sm:inline">الوضع المظلم</span>
            </>
          )}
        </button>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md my-auto pt-16 pb-8">
        <div
          className={`rounded-2xl border shadow-2xl p-6 sm:p-8 space-y-6 transition-all ${
            isDarkMode
              ? 'bg-emerald-950/80 border-emerald-800/80 shadow-emerald-950/50 text-white'
              : 'bg-white border-slate-200 shadow-slate-300 text-slate-900'
          }`}
        >
          {/* Card Header Icon */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center py-2">
              <AppLogo size="xl" className="drop-shadow-xl" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight">تسجيل الدخول للنظام</h2>
            <p className={`text-xs ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              أدخل اسم المستخدم والرمز السري للبدء في استخدام التطبيق
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div>
              <label className={`block text-xs font-bold mb-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                اسم المستخدم
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => {
                    setUsernameInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="أدخل اسم المستخدم"
                  className={`w-full pl-3 pr-10 py-3 rounded-xl border font-bold text-sm focus:outline-none transition-all ${
                    isDarkMode
                      ? 'bg-slate-900/90 border-slate-700 text-white focus:border-emerald-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                  }`}
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label className={`block text-xs font-bold mb-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                الرمز السري (كلمة المرور)
              </label>
              <div className="relative">
                <Key className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="أدخل الرمز السري"
                  className={`w-full pl-10 pr-10 py-3 rounded-xl border font-bold text-sm focus:outline-none transition-all ${
                    isDarkMode
                      ? 'bg-slate-900/90 border-slate-700 text-white focus:border-emerald-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-600'
                  }`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                    isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error Banner */}
            {loginError && (
              <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/60 text-red-200 text-xs font-bold text-center animate-in fade-in">
                {loginError}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm rounded-xl shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
            >
              <LogIn className="w-5 h-5" />
              <span>تسجيل الدخول</span>
            </button>
          </form>

        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-slate-400 font-bold mt-6">
          برمجة المهندس ياسر المعجون
        </p>
      </div>
    </div>
  );
};
