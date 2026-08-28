import React, { useEffect } from 'react';
import { useSales } from '../context/SalesContext';
import { ToastNotification } from '../types';
import {
  Target,
  Zap,
  Trophy,
  CheckCircle2,
  Info,
  X,
  Sparkles,
  Flame,
  Award,
  Crown,
  BellRing,
} from 'lucide-react';

interface ToastItemProps {
  toast: ToastNotification;
  onClose: (id: string) => void;
  isDarkMode: boolean;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose, isDarkMode }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, 6500);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  // Determine styling based on toast type
  let containerStyles = '';
  let badgeStyles = '';
  let progressBarColor = '';
  let icon = <Info className="w-6 h-6" />;
  let badgeText = '';

  switch (toast.type) {
    case 'milestone_50':
      containerStyles = isDarkMode
        ? 'bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-2 border-indigo-500/80 text-white shadow-indigo-900/40'
        : 'bg-gradient-to-r from-indigo-50 via-blue-50 to-white border-2 border-indigo-500 text-slate-900 shadow-indigo-200';
      badgeStyles = 'bg-indigo-500 text-white';
      progressBarColor = 'bg-indigo-500';
      icon = <Target className="w-6 h-6 text-indigo-400 animate-pulse" />;
      badgeText = '50% من الهدف 🎯';
      break;

    case 'milestone_75':
      containerStyles = isDarkMode
        ? 'bg-gradient-to-r from-slate-900 via-amber-950 to-slate-900 border-2 border-amber-500 text-white shadow-amber-900/40'
        : 'bg-gradient-to-r from-amber-50 via-orange-50 to-white border-2 border-amber-500 text-slate-900 shadow-amber-200';
      badgeStyles = 'bg-amber-500 text-slate-950 font-black';
      progressBarColor = 'bg-amber-500';
      icon = <Flame className="w-6 h-6 text-amber-400 animate-bounce" />;
      badgeText = '75% اقتربت جداً! ⚡';
      break;

    case 'milestone_100':
      containerStyles = isDarkMode
        ? 'bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 border-2 border-emerald-400 ring-4 ring-emerald-500/30 text-white shadow-emerald-900/50'
        : 'bg-gradient-to-r from-emerald-50 via-teal-50 to-green-100 border-2 border-emerald-600 ring-4 ring-emerald-400/40 text-slate-900 shadow-emerald-200';
      badgeStyles = 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-black';
      progressBarColor = 'bg-emerald-500';
      icon = <Trophy className="w-7 h-7 text-amber-300 animate-bounce" />;
      badgeText = '100% تم تحقيق الهدف كاملًا! 🏆';
      break;

    case 'reminder':
      containerStyles = isDarkMode
        ? 'bg-gradient-to-r from-slate-900 via-amber-950 to-slate-900 border-2 border-amber-400 text-white shadow-amber-900/50'
        : 'bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 border-2 border-amber-500 text-slate-900 shadow-amber-200';
      badgeStyles = 'bg-amber-500 text-slate-950 font-black';
      progressBarColor = 'bg-amber-500';
      icon = <BellRing className="w-6 h-6 text-amber-400 animate-bounce" />;
      badgeText = 'تذكير مبيعات ⏰';
      break;

    case 'success':
      containerStyles = isDarkMode
        ? 'bg-slate-900 border-2 border-emerald-500 text-white shadow-slate-900'
        : 'bg-white border-2 border-emerald-500 text-slate-900 shadow-lg';
      badgeStyles = 'bg-emerald-500 text-white';
      progressBarColor = 'bg-emerald-500';
      icon = <CheckCircle2 className="w-6 h-6 text-emerald-400" />;
      badgeText = 'نجاح';
      break;

    default:
      containerStyles = isDarkMode
        ? 'bg-slate-900 border-2 border-slate-700 text-white'
        : 'bg-white border-2 border-slate-300 text-slate-900';
      badgeStyles = 'bg-slate-600 text-white';
      progressBarColor = 'bg-slate-500';
      icon = <Info className="w-6 h-6 text-blue-400" />;
      badgeText = 'تنبيه';
      break;
  }

  return (
    <div
      className={`relative w-full max-w-md p-4 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 transform animate-in slide-in-from-top-5 fade-in ${containerStyles}`}
    >
      {/* Celebration Sparkles for 100% Target */}
      {toast.type === 'milestone_100' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
          <div className="absolute -top-2 -right-2 text-amber-300 animate-ping opacity-75">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="absolute top-1 left-2 text-emerald-300 animate-pulse">
            <Crown className="w-5 h-5" />
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 dir-rtl">
        {/* Icon Container */}
        <div className="p-2.5 rounded-xl bg-slate-950/40 border border-white/10 shrink-0 shadow-inner">
          {icon}
        </div>

        {/* Text Content */}
        <div className="flex-1 space-y-1 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-black text-sm sm:text-base leading-tight truncate">
              {toast.title}
            </h4>
            <span className={`px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black shrink-0 ${badgeStyles}`}>
              {badgeText}
            </span>
          </div>

          <p className="text-xs sm:text-sm font-semibold opacity-90 leading-relaxed break-words">
            {toast.message}
          </p>

          {toast.percentage > 0 && (
            <div className="pt-1 flex items-center gap-2 text-xs font-bold opacity-80">
              <span>نسبة الإنجاز الحالية:</span>
              <strong className="text-sm font-black underline">{toast.percentage.toFixed(1)}%</strong>
            </div>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={() => onClose(toast.id)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          title="إغلاق"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Auto-Dismiss Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
        <div
          className={`h-full ${progressBarColor} transition-all ease-linear`}
          style={{
            animation: 'toastProgress 6.5s linear forwards',
          }}
        />
      </div>

      <style>{`
        @keyframes toastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast, isDarkMode } = useSales();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[94vw] max-w-md space-y-3 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onClose={removeToast} isDarkMode={isDarkMode} />
        </div>
      ))}
    </div>
  );
};
