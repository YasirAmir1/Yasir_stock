import React from 'react';
import { useSales } from '../context/SalesContext';
import { UserCheck, Shield, User, X } from 'lucide-react';

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountSelect?: (isAdmin: boolean) => void;
}

export const AccountSwitcherModal: React.FC<AccountSwitcherModalProps> = ({
  isOpen,
  onClose,
  onAccountSelect,
}) => {
  const { currentUser, availableAccounts, loginAccount } = useSales();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 dir-rtl">
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-800/80 p-4 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-base">اختر حساب تسجيل الدخول</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-slate-300">
            اختر حسابك للبدء بتسجيل المبيعات أو إدارة التاركت والأهداف:
          </p>

          <div className="space-y-2">
            {availableAccounts.map((acc) => {
              const isCurrent = currentUser.name === acc.name;
              return (
                <div
                  key={acc.username || acc.name}
                  onClick={() => {
                    loginAccount(acc);
                    if (onAccountSelect) {
                      onAccountSelect(acc.isAdmin);
                    }
                    onClose();
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isCurrent
                      ? 'bg-emerald-900/40 border-emerald-500/60 text-white shadow-md'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-200 hover:bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg ${
                        acc.isAdmin ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                      }`}
                    >
                      {acc.isAdmin ? <Shield className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-white">{acc.name}</div>
                      <div className="text-xs text-slate-400">{acc.roleName}</div>
                    </div>
                  </div>

                  {isCurrent && (
                    <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-emerald-500 text-slate-950">
                      نشط
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3 bg-slate-800/40 border-t border-slate-700/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};
