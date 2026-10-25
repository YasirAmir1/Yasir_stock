import React, { useState, useEffect } from 'react';
import { dialogService, DialogState } from '../utils/dialogService';
import { AlertTriangle, CheckCircle2, Info, HelpCircle, X } from 'lucide-react';

export const GlobalDialogModal: React.FC = () => {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    const unsubscribe = dialogService.subscribe((newDialog) => {
      setDialog(newDialog);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!dialog?.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleClose(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog]);

  if (!dialog || !dialog.isOpen) return null;

  const handleClose = (result: boolean) => {
    if (dialog.resolve) {
      dialog.resolve(result);
    }
    setDialog(null);
  };

  const isConfirm = dialog.type === 'confirm';
  const variant = dialog.variant || (isConfirm ? 'warning' : 'info');

  return (
    <div 
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200" 
      dir="rtl"
      onClick={() => {
        // If alert, clicking outside can dismiss
        if (!isConfirm) handleClose(true);
      }}
    >
      <div 
        className="w-full max-w-sm sm:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-7 text-center relative overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle decorative top glow line */}
        <div 
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            variant === 'danger'
              ? 'bg-red-500'
              : variant === 'warning'
              ? 'bg-amber-500'
              : 'bg-emerald-500'
          }`} 
        />

        {/* Close icon button on top corner */}
        <button
          onClick={() => handleClose(false)}
          className="absolute top-4 left-4 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="إغلاق"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon Badge */}
        <div className="flex justify-center mb-4 mt-1">
          <div 
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center border shadow-lg ${
              variant === 'danger'
                ? 'bg-red-500/10 border-red-500/30 text-red-500 shadow-red-500/10'
                : variant === 'warning'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 shadow-amber-500/10'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-emerald-500/10'
            }`}
          >
            {variant === 'danger' ? (
              <AlertTriangle className="w-7 h-7 sm:w-8 sm:h-8 stroke-[2.2]" />
            ) : variant === 'warning' ? (
              <HelpCircle className="w-7 h-7 sm:w-8 sm:h-8 stroke-[2.2]" />
            ) : (
              <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8 stroke-[2.2]" />
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
          {dialog.title || (isConfirm ? 'تأكيد العملية' : 'تنبيه')}
        </h3>

        {/* Message */}
        <p className="text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300 leading-relaxed mb-6 whitespace-pre-wrap px-2">
          {dialog.message}
        </p>

        {/* Action Buttons */}
        {isConfirm ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleClose(true)}
              className={`flex-1 py-2.5 px-4 rounded-xl text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all cursor-pointer ${
                variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-500 shadow-red-600/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
              }`}
            >
              {dialog.confirmText || 'تأكيد'}
            </button>
            <button
              onClick={() => handleClose(false)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs sm:text-sm border border-slate-300 dark:border-slate-700 active:scale-95 transition-all cursor-pointer"
            >
              {dialog.cancelText || 'إلغاء'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => handleClose(true)}
            className="w-full py-2.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
          >
            {dialog.confirmText || 'حسناً'}
          </button>
        )}
      </div>
    </div>
  );
};
