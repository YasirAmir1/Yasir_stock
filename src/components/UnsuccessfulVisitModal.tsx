import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Loader2,
  Trash2,
  AlertTriangle,
  MapPin,
  Calendar,
  Clock,
  CheckCircle2,
  Lock,
  X,
} from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cleanFirestoreData } from '../lib/firestoreUtils';
import { RouteItem, UnsuccessfulVisit, UserAccount } from '../types';
import { formatEnglishDate, formatEnglishTime, getFormattedWeekday } from '../utils/dateUtils';

interface UnsuccessfulVisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  route: RouteItem | null;
  currentUser: UserAccount | null;
  effectiveDelegateCode?: string;
  isDarkMode?: boolean;
  onSuccess?: (visit: UnsuccessfulVisit) => void;
  onNotify?: (title: string, message: string, type?: 'success' | 'reminder' | 'info') => void;
}

const compressImageFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 800;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(ev.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.72);
        resolve(compressedDataUrl);
      };
      img.onerror = () => reject(new Error('تعذر تحميل الصورة'));
      img.src = ev.target?.result as string;
    };
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.readAsDataURL(file);
  });
};

export const UnsuccessfulVisitModal: React.FC<UnsuccessfulVisitModalProps> = ({
  isOpen,
  onClose,
  route,
  currentUser,
  effectiveDelegateCode,
  isDarkMode = false,
  onSuccess,
  onNotify,
}) => {
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lockWarning, setLockWarning] = useState<string>('');
  const [shakeTrigger, setShakeTrigger] = useState<boolean>(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const reasonTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Immediately focus the reason input whenever the modal opens for a shop
  useEffect(() => {
    if (isOpen && route) {
      setReason('');
      setPhotoDataUrl('');
      setLockWarning('');
      setShakeTrigger(false);
      const timer = window.setTimeout(() => {
        reasonTextareaRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, route?.id, route?.customerCode]);

  const triggerBlockedCloseWarning = () => {
    setLockWarning('لا يمكن إغلاق النافذة بدون كتابة سبب الزيارة غير الناجحة وحفظه أولاً.');
    setShakeTrigger(true);
    reasonTextareaRef.current?.focus();
    window.setTimeout(() => setShakeTrigger(false), 450);
  };

  // Prevent dismissing via Escape key without entering and saving the reason
  useEffect(() => {
    if (!isOpen || !route) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        triggerBlockedCloseWarning();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, route]);

  if (!isOpen || !route) return null;

  const hasValidReason = reason.trim().length > 0;

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressing(true);
      const compressed = await compressImageFile(file);
      setPhotoDataUrl(compressed);
      onNotify?.('تم التقاط الصورة بنجاح', 'تم تجهيز صورة براد الزبون بنجاح.', 'info');
    } catch (err: any) {
      console.error('Image compression error:', err);
      onNotify?.('خطأ بالصورة', 'تعذر معالجة الصورة، يرجى المحاولة مرة أخرى.', 'reminder');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      triggerBlockedCloseWarning();
      onNotify?.('السبب مطلوب', 'يرجى كتابة سبب عدم نجاح الزيارة للمحل أولاً.', 'reminder');
      return;
    }

    if (isSubmitting || isCompressing) return;
    setIsSubmitting(true);

    const now = new Date();
    const visitId = `uv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const routeDay = route.path || getFormattedWeekday(now);
    const dateFormatted = formatEnglishDate(now);
    const timeFormatted = formatEnglishTime(now);

    const delegateName =
      route.delegateName || currentUser?.name || currentUser?.delegateName || 'مندوب';
    const delegateCode =
      route.delegateCode || effectiveDelegateCode || currentUser?.delegateCode || '';

    const record: UnsuccessfulVisit = {
      id: visitId,
      customerCode: String(route.customerCode || '').trim(),
      customerName: route.customerName,
      customerAddress: route.customerAddress || '',
      customerType: route.customerType || 'مفرد',
      delegateName,
      delegateCode,
      routeDay,
      date: dateFormatted,
      timeFormatted,
      timestamp: Date.now(),
      refrigeratorPhoto: photoDataUrl || undefined,
      reason: trimmedReason,
      latitude: route.latitude !== null && route.latitude !== undefined ? Number(route.latitude) : undefined,
      longitude: route.longitude !== null && route.longitude !== undefined ? Number(route.longitude) : undefined,
      recordedBy: currentUser?.username || currentUser?.name || delegateName,
      createdAt: now.toISOString(),
    };

    // 1. Instant local backup + optimistic UI update (immediately turns shop yellow & updates lists without waiting)
    try {
      const localKey = 'unsuccessful_visits_backup';
      const cached = JSON.parse(localStorage.getItem(localKey) || '[]');
      localStorage.setItem(localKey, JSON.stringify([record, ...cached.slice(0, 99)]));
    } catch {}

    onSuccess?.(record);
    onNotify?.(
      'تم تسجيل الزيارة غير الناجحة فوراً ✅',
      `تم حفظ سبب الزيارة لمحل (${route.customerName}) وإرساله للأدمن بنجاح.`,
      'success'
    );

    // 2. Sync to Firestore in background so the rep never waits on network latency
    setDoc(doc(db, 'unsuccessful_visits', visitId), cleanFirestoreData(record)).catch((dbErr) => {
      console.warn('Background firestore save warning:', dbErr);
    });

    setPhotoDataUrl('');
    setReason('');
    setLockWarning('');
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150"
      onClick={triggerBlockedCloseWarning}
      dir="rtl"
    >
      <div
        className={`w-full max-w-md rounded-2xl p-5 sm:p-6 shadow-2xl border-2 text-right space-y-4 my-auto animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto transition-transform ${
          shakeTrigger ? 'translate-x-1 border-rose-500' : 'border-amber-500/70'
        } ${
          isDarkMode
            ? 'bg-slate-900 text-white'
            : 'bg-white text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — No Close Button: Reason is Mandatory */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-900 dark:text-white">
                توثيق زيارة غير ناجحة
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                {route.customerName}
                {route.customerCode ? ` (${route.customerCode})` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-[10px] font-black">
              <Lock className="w-3 h-3" />
              <span>السبب إلزامي</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Compact Shop Info Strip */}
        <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
          {route.customerAddress ? (
            <span className="flex items-center gap-1 font-bold truncate max-w-[65%]">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{route.customerAddress}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 font-bold">
              <Calendar className="w-3 h-3 text-slate-400" />
              <span>المسار: {route.path || 'اليوم'}</span>
            </span>
          )}
          <span className="flex items-center gap-1 font-mono font-bold text-slate-500 dark:text-slate-400">
            <Clock className="w-3 h-3" />
            <span>{formatEnglishTime(new Date())}</span>
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Primary Immediate Section: Mandatory Reason Input (Auto-Focused) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="unsuccessful-visit-reason"
                className="block text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100"
              >
                اكتب سبب عدم نجاح الزيارة فوراً <span className="text-rose-500">*</span>
              </label>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  hasValidReason
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                }`}
              >
                {hasValidReason ? 'جاهز للحفظ ✓' : 'مطلوب للمتابعة'}
              </span>
            </div>

            <textarea
              id="unsuccessful-visit-reason"
              ref={reasonTextareaRef}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (e.target.value.trim()) setLockWarning('');
              }}
              rows={3}
              autoFocus
              placeholder="اكتب السبب مباشرة هنا (مثال: المحل مغلق، صاحب المحل غير موجود، البراد ممتلئ...)"
              className={`w-full p-3 rounded-xl border-2 text-xs sm:text-sm font-bold focus:outline-none transition-all placeholder:text-slate-400 ${
                lockWarning
                  ? 'border-rose-500 bg-rose-50/40 dark:bg-rose-950/20 text-slate-900 dark:text-white focus:ring-2 focus:ring-rose-500'
                  : 'border-amber-400 dark:border-amber-600 bg-white dark:bg-slate-850 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500'
              }`}
              required
            />

            {lockWarning ? (
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300 text-[11px] font-black flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{lockWarning}</span>
              </div>
            ) : (
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                لا يمكن إغلاق هذه النافذة قبل كتابة السبب والضغط على حفظ.
              </p>
            )}
          </div>

          {/* Secondary Section: Rear Camera Only Refrigerator Photo */}
          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="block text-xs font-black text-slate-700 dark:text-slate-200">
              صورة براد الزبون بالكاميرا (اختياري)
            </label>

            {/* Hidden file input for rear camera only */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={cameraInputRef}
              onChange={handlePhotoSelected}
              className="hidden"
            />

            {photoDataUrl ? (
              <div className="relative rounded-2xl border-2 border-emerald-500/40 bg-slate-950/5 dark:bg-slate-950/40 p-2 overflow-hidden flex flex-col items-center">
                <div className="relative w-full max-h-44 rounded-xl overflow-hidden bg-black flex items-center justify-center">
                  <img
                    src={photoDataUrl}
                    alt="براد الزبون"
                    className="max-h-44 w-auto object-contain mx-auto"
                  />
                  <div className="absolute top-2 right-2 bg-emerald-600/90 text-white text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>تم التقاط الصورة</span>
                  </div>
                </div>

                <div className="w-full flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>إعادة الالتقاط</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPhotoDataUrl('')}
                    className="py-1.5 px-3 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={isCompressing}
                onClick={() => cameraInputRef.current?.click()}
                className="w-full py-2.5 px-4 rounded-xl border-2 border-dashed border-amber-400/70 dark:border-amber-700/70 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                {isCompressing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                )}
                <span>التقاط صورة للبراد بالكاميرا</span>
              </button>
            )}
          </div>

          {/* Submit Action (Single Mandatory Path — No Cancel/Dismiss Without Reason) */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={isSubmitting || isCompressing}
              className={`w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-black shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 ${
                hasValidReason
                  ? 'bg-amber-500 hover:bg-amber-400 active:scale-98 text-slate-950 shadow-amber-500/25'
                  : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shadow-none'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>حفظ السبب وتأكيد الزيارة غير الناجحة</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UnsuccessfulVisitModal;
