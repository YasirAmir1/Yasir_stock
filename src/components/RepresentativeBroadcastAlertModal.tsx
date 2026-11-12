import React, { useEffect } from 'react';
import { Bell, CheckCircle2, Clock, ShieldAlert, Sparkles, X, Volume2 } from 'lucide-react';
import { BroadcastAlert } from '../types';
import { playBroadcastAlertToneAndVibrate } from '../utils/soundAlert';

interface RepresentativeBroadcastAlertModalProps {
  alert: BroadcastAlert | null;
  onAcknowledge: (alertId: string) => void;
  isDarkMode: boolean;
}

export const RepresentativeBroadcastAlertModal: React.FC<RepresentativeBroadcastAlertModalProps> = ({
  alert,
  onAcknowledge,
  isDarkMode,
}) => {
  useEffect(() => {
    if (alert) {
      // Fire audio tone and device vibration [200, 100, 200] ms
      playBroadcastAlertToneAndVibrate().catch(() => {});
    }
  }, [alert?.id]);

  if (!alert) return null;

  const createdAtFormatted = alert.created_at
    ? new Date(alert.created_at).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`w-full max-w-md rounded-3xl border-2 shadow-2xl p-5 sm:p-6 text-right space-y-4 relative overflow-hidden transition-all animate-in zoom-in-95 duration-200 ${
          isDarkMode
            ? 'bg-slate-900 border-amber-500/50 text-white shadow-amber-950/40'
            : 'bg-white border-amber-500/60 text-slate-900 shadow-amber-500/20'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative Top Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 animate-pulse" />

        {/* Header with Pulsing Bell */}
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-500 flex items-center justify-center shadow-inner">
                <Bell className="w-6 h-6 animate-[bounce_1s_infinite]" />
              </div>
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white leading-tight">
                  إشعار وتوجيه عام من الإدارة
                </h3>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                <span>المرسل: {alert.sender_id || 'الأدمن'}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {createdAtFormatted}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Message Content Box */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/80 border border-amber-300/40 dark:border-amber-800/40">
          <p className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
            {alert.message}
          </p>
        </div>

        {/* Expiration Note */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-semibold px-1">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" />
            <span>صالح لليوم فقط (ينتهي تلقائياً الساعة 23:59:59)</span>
          </span>
          <button
            type="button"
            onClick={() => playBroadcastAlertToneAndVibrate()}
            className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5 cursor-pointer"
            title="إعادة سماع النغمة"
          >
            <Volume2 className="w-3 h-3" />
            <span>نغمة التنبيه</span>
          </button>
        </div>

        {/* Primary Action Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => onAcknowledge(alert.id)}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 active:scale-98 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>فهمت ذلك وتأكيد القراءة ✅</span>
          </button>
        </div>
      </div>
    </div>
  );
};
