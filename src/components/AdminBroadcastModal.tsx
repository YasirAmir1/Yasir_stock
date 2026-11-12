import React, { useState, useEffect } from 'react';
import {
  X,
  Send,
  Bell,
  Clock,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Users,
  MessageSquarePlus,
  ShieldAlert
} from 'lucide-react';
import { BroadcastAlert } from '../types';
import {
  broadcastAdminAlert,
  fetchAllRecentBroadcasts,
  deleteBroadcastAlert,
  getTodayEndOfDayIso
} from '../lib/broadcastService';
import { useSales } from '../context/SalesContext';

interface AdminBroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}

const TEMPLATES = [
  'تنبيه هام لجميع المناديب: يرجى تسليم فواتير اليوم قبل الساعة 8:00 مساءً.',
  'تذكير بمتابعة هدف حليب بطل والأصناف الإضافية لتحقيق المستهدف اليومي.',
  'يرجى مراجعة وتأكيد أرصدة الزبائن النقدية ومطابقتها مع كشف المبيعات.',
  'تنبيه: تم تحديث أسعار بعض المنتجات في قائمة المواد، يرجى الاطلاع عليها.',
  'عاشت الأيادي على تحقيق مستهدف اليوم! استمروا بهذا الأداء المميز 👏'
];

export const AdminBroadcastModal: React.FC<AdminBroadcastModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
}) => {
  const { currentUser, setUserMessage } = useSales();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [history, setHistory] = useState<BroadcastAlert[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const items = await fetchAllRecentBroadcasts(15);
      setHistory(items);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory();
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      setFeedback({ type: 'error', text: 'يرجى كتابة نص الإشعار أولاً' });
      return;
    }

    setIsSending(true);
    setFeedback(null);
    try {
      const senderName = currentUser?.name || 'الأدمن';
      const res = await broadcastAdminAlert(trimmed, senderName);
      if (res.success && res.alert) {
        setMessage('');
        setFeedback({ type: 'success', text: 'تم بث الإشعار بنجاح لجميع المناديب في الميدان 📢🚀' });
        setUserMessage('تم بث الإشعار العام للمناديب بنجاح 📢✅');
        await loadHistory();
      } else {
        setFeedback({ type: 'error', text: res.error || 'فشل إرسال الإشعار' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'حدث خطأ أثناء الإرسال' });
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = window.confirm('هل أنت متأكد من رغبتك في حذف/إلغاء هذا الإشعار؟');
    if (!ok) return;

    const success = await deleteBroadcastAlert(id);
    if (success) {
      setHistory((prev) => prev.filter((item) => item.id !== id));
      setUserMessage('تم حذف الإشعار بنجاح 🗑️');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`w-full max-w-2xl max-h-[92vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden text-right transition-all animate-in zoom-in-95 duration-200 ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-gradient-to-r from-emerald-600/10 via-transparent to-amber-500/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-500 flex items-center justify-center shadow-xs">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white leading-tight">
                  بث إشعار عام للمناديب (Admin Broadcast)
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] font-black">
                  خاص بالأدمن 🔒
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                إرسال تنبيهات فورية تظهر كنافذة منبثقة مع صوت واهتزاز على أجهزة المناديب
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Form Box */}
          <div className="space-y-3">
            <label className="block text-xs font-black text-slate-800 dark:text-slate-200">
              نص الإشعار والتوجيه العام للمناديب:
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="اكتب التوجيه أو الإشعار العام هنا ليظهر فوراً على شاشات الأجهزة اللوحية للمناديب أثناء العمل الميداني..."
              rows={4}
              maxLength={500}
              className="w-full p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all resize-none"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span>ينتهي تلقائياً بنهاية اليوم (الساعة 23:59:59)</span>
              </span>
              <span>{message.length} / 500 حرف</span>
            </div>

            {/* Quick Templates */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>قوالب رسائل جاهزة وسريعة:</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((tmpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setMessage(tmpl)}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors text-right cursor-pointer"
                  >
                    {tmpl.slice(0, 42)}...
                  </button>
                ))}
              </div>
            </div>

            {/* Feedback Message */}
            {feedback && (
              <div
                className={`p-3 rounded-xl text-xs font-black flex items-center gap-2 ${
                  feedback.type === 'success'
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Send Button */}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleSend}
                disabled={isSending || !message.trim()}
                className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isSending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جاري البث لجميع المناديب...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>بث فوري لجميع المناديب (Real-time Broadcast) 📢</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Broadcast History & Active Alerts */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h4 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-200">
                  سجل التنبيهات والبث المرسل:
                </h4>
              </div>
              <button
                type="button"
                onClick={loadHistory}
                disabled={isLoadingHistory}
                className="text-[11px] font-bold text-slate-500 hover:text-emerald-600 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
            </div>

            {history.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 font-bold">
                لا توجد إشعارات مرسلة بعد اليوم
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((alert) => {
                  const isExpired = new Date(alert.expires_at).getTime() <= Date.now();
                  const timeFormatted = alert.created_at
                    ? new Date(alert.created_at).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
                    : '';
                  const dateFormatted = alert.created_at
                    ? new Date(alert.created_at).toLocaleDateString('ar-IQ')
                    : '';

                  return (
                    <div
                      key={alert.id}
                      className={`p-3.5 rounded-2xl border transition-all flex items-start justify-between gap-3 ${
                        isExpired
                          ? 'bg-slate-100/60 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 opacity-60'
                          : 'bg-white dark:bg-slate-950 border-amber-300/40 dark:border-amber-800/40 shadow-xs'
                      }`}
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[9px] font-black ${
                              isExpired
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {isExpired ? 'منتهي الصلاحية' : 'نشط على أجهزة المناديب 📢'}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                            {dateFormatted} - {timeFormatted}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            (المرسل: {alert.sender_id})
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                          {alert.message}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDelete(alert.id)}
                        className="p-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer shrink-0"
                        title="حذف هذا الإشعار"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
