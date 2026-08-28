import React, { useState } from 'react';
import { useSales } from '../context/SalesContext';
import { Lock, User, Key, X } from 'lucide-react';

interface DelegateLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DelegateLoginModal: React.FC<DelegateLoginModalProps> = ({ isOpen, onClose }) => {
  const { delegateAccounts, loginAccount } = useSales();
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const u = usernameInput.trim();
    const p = passwordInput.trim();

    const matched = delegateAccounts.find(
      (it) =>
        (it.username.toLowerCase() === u.toLowerCase() ||
          it.delegateName.toLowerCase() === u.toLowerCase()) &&
        it.password === p
    );

    if (matched) {
      loginAccount({
        name: matched.delegateName,
        roleName: matched.isAdmin ? 'مدير النظام' : 'مندوب مبيعات',
        isAdmin: matched.isAdmin,
        username: matched.username,
        monthlyTargetKg: matched.monthlyTargetKg,
      });
      setUsernameInput('');
      setPasswordInput('');
      setLoginError(null);
      onClose();
    } else {
      setLoginError('اسم المستخدم أو الرمز السري غير صحيح');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 dir-rtl">
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-800/80 p-4 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-base">تسجيل دخول المندوب</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleLogin} className="p-4 space-y-4">
          <p className="text-xs text-slate-300">
            يرجى إدخال اسم المستخدم والرمز السري المحدد لك من قبل الأدمن:
          </p>

          <div className="space-y-3">
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
                  className="w-full pl-3 pr-9 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-bold focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">الرمز السري (كلمة المرور)</label>
              <div className="relative">
                <Key className="w-4 h-4 text-emerald-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="الرمز السري"
                  className="w-full pl-3 pr-9 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-bold focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            {loginError && (
              <div className="p-2.5 rounded-lg bg-red-950/80 border border-red-500/50 text-red-200 text-xs font-bold text-center">
                {loginError}
              </div>
            )}
          </div>

          <div className="pt-2 flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-900/40"
            >
              دخول
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
