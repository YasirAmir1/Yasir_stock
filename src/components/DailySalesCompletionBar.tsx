import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSales } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { Check, Clock, CheckCircle2, AlertTriangle, Users } from 'lucide-react';

export const DailySalesCompletionBar: React.FC = () => {
  const {
    currentUser,
    selectedDelegate,
    salesEntries,
    productsList = [],
    isDarkMode,
    setUserMessage,
    addToast,
    delegatesList = [],
  } = useSales();

  // Hidden for Rafat / Data Entry
  const isRafat =
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.role === 'dataEntry' ||
    currentUser?.name === 'رأفت جمال';

  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [isCompletedLoaded, setIsCompletedLoaded] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdownText, setCountdownText] = useState('00:00:00');
  const [isPast3PM, setIsPast3PM] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Determine active delegate
  const activeDelegateName = currentUser?.isAdmin
    ? selectedDelegate && selectedDelegate !== 'الكل'
      ? selectedDelegate
      : ''
    : currentUser?.name || '';

  const isDelegateCompleted = activeDelegateName ? !!completedDelegates[activeDelegateName] : false;

  // Real-time listener for today's daily_sales_completion
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'daily_sales_completion'), where('date', '==', today));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const completed: Record<string, boolean> = {};
        snap.forEach((d) => {
          const data = d.data();
          if (data.delegate) {
            completed[data.delegate] = true;
          }
        });
        setCompletedDelegates(completed);
        setIsCompletedLoaded(true);
      },
      (err) => {
        console.error('Error listening to daily_sales_completion:', err);
        setIsCompletedLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  // Countdown timer calculation to 3:00 PM (Asia/Baghdad)
  useEffect(() => {
    const calculateCountdown = () => {
      try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Baghdad',
          hour12: false,
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        });
        const parts = formatter.formatToParts(now);
        const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
        const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);

        const currentSeconds = hour * 3600 + minute * 60 + second;
        const targetSeconds = 15 * 3600; // 3:00 PM = 15:00:00

        const diff = targetSeconds - currentSeconds;
        setSecondsRemaining(diff);

        if (diff <= 0) {
          setIsPast3PM(true);
          setCountdownText('00:00:00');

          // Trigger automatic completion only once if not completed yet and Firestore status is loaded
          if (
            isCompletedLoaded &&
            activeDelegateName &&
            !completedDelegates[activeDelegateName]
          ) {
            const today = new Date().toISOString().split('T')[0];
            const alertKey = `daily_auto_completion_alert_${today}_${activeDelegateName}`;
            if (!localStorage.getItem(alertKey)) {
              localStorage.setItem(alertKey, 'true');
              triggerAutoCompletion(activeDelegateName);
            }
          }
        } else {
          setIsPast3PM(false);
          const h = Math.floor(diff / 3600);
          const m = Math.floor((diff % 3600) / 60);
          const s = diff % 60;
          const pad = (n: number) => n.toString().padStart(2, '0');
          setCountdownText(`${pad(h)}:${pad(m)}:${pad(s)}`);
        }
      } catch (err) {
        console.error('Error calculating countdown:', err);
      }
    };

    calculateCountdown();
    const interval = setInterval(calculateCountdown, 1000);
    return () => clearInterval(interval);
  }, [activeDelegateName, completedDelegates, isCompletedLoaded]);

  // Today's summary totals for active delegate
  const { totalWeight, totalPrice } = useMemo(() => {
    if (!activeDelegateName) return { totalWeight: 0, totalPrice: 0 };
    const today = new Date().toISOString().split('T')[0];
    const delegateEntries = salesEntries.filter(
      (e) =>
        e.dateString === today &&
        (e.delegateName === activeDelegateName ||
          (currentUser?.isAdmin && activeDelegateName === 'الأدمن'))
    );
    const weight = delegateEntries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
    const price = delegateEntries.reduce((sum, e) => {
      const prod = productsList.find((p) => p.productName === e.productName);
      const unitPrice = prod
        ? e.priceMode === 'wholesale'
          ? prod.wholesalePrice || 0
          : prod.retailPrice || 0
        : 0;
      return sum + unitPrice * (e.quantity || 0);
    }, 0);
    return { totalWeight: weight, totalPrice: price };
  }, [salesEntries, activeDelegateName, productsList, currentUser]);

  // Auto completion trigger at 3:00 PM
  const triggerAutoCompletion = async (delegateName: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const alertKey = `daily_auto_completion_alert_${today}_${delegateName}`;
      localStorage.setItem(alertKey, 'true');

      await setDoc(doc(db, 'daily_sales_completion', delegateName), {
        delegate: delegateName,
        date: today,
        completedAt: new Date().toISOString(),
        autoCompleted: true,
      });
      addToast({
        message: `تم إغلاق وإكمال مبيعات اليوم للمندوب (${delegateName}) تلقائياً بحلول الساعة 3:00 م ✅`,
        type: 'info',
        delegateName,
        title: 'إغلاق تلقائي 3:00 م',
        percentage: 0,
      });
      setUserMessage(`تم إكمال مبيعات اليوم تلقائياً للمندوب (${delegateName}) بحلول الساعة 3:00 م ✅`);
    } catch (err) {
      console.error('Error in auto-completion:', err);
    }
  };

  // Manual completion confirmation
  const handleConfirmCompletion = async () => {
    if (!activeDelegateName || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const alertKey = `daily_auto_completion_alert_${today}_${activeDelegateName}`;
      localStorage.setItem(alertKey, 'true');

      await setDoc(doc(db, 'daily_sales_completion', activeDelegateName), {
        delegate: activeDelegateName,
        date: today,
        completedAt: new Date().toISOString(),
        autoCompleted: false,
      });
      addToast({
        message: `تم إكمال مبيعات اليوم بنجاح للمندوب (${activeDelegateName}) ✅`,
        type: 'success',
        delegateName: activeDelegateName,
        title: 'اكتمال المبيعات',
        percentage: 0,
      });
      setUserMessage(`تم إكمال مبيعات اليوم بنجاح للمندوب (${activeDelegateName})! ✅`);
      setShowConfirmModal(false);
    } catch (err) {
      console.error('Error confirming daily sales completion:', err);
      alert('حدث خطأ أثناء حفظ إنهاء المبيعات. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isRafat) return null;

  // Number of delegates completed today for Admin overview
  const completedCount = Object.keys(completedDelegates).length;
  const totalDelegatesCount = delegatesList.length || 0;

  return (
    <>
      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          dir="rtl"
          onClick={() => !isSubmitting && setShowConfirmModal(false)}
        >
          <div
            className={`w-full max-w-sm rounded-2xl p-5 shadow-2xl border text-right space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode
                ? 'bg-slate-900 border-red-500/40 text-white'
                : 'bg-white border-red-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black">تأكيد إنهاء مبيعات اليوم</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                  {activeDelegateName}
                </p>
              </div>
            </div>

            <p className="text-xs font-bold leading-relaxed text-slate-600 dark:text-slate-300">
              هل أنت متأكد من إكمال مبيعات اليوم؟ بعد التأكيد سيتم قفل إدخال الفواتير الجديدة لهذا اليوم.
            </p>

            <div
              className={`p-3 rounded-xl space-y-1.5 text-xs font-black border ${
                isDarkMode
                  ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                  : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">إجمالي وزن اليوم:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-black">
                  {totalWeight.toFixed(2)} كجم
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">إجمالي مبالغ اليوم:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-black">
                  {Math.round(totalPrice).toLocaleString()} د.ع
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowConfirmModal(false)}
                className={`flex-1 py-2.5 rounded-xl font-black text-xs border transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                }`}
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmCompletion}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'جاري التأكيد...' : 'تأكيد الإنهاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The Split Two-Halves Bar: 50% Button, 50% Countdown on Mobile, Tablet & Desktop */}
      <div className="w-full" dir="rtl">
        <div
          className={`p-1.5 sm:p-2.5 rounded-2xl border shadow-sm transition-all ${
            isDarkMode
              ? 'bg-slate-900/90 border-slate-800 text-white'
              : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2.5 items-stretch">
            {/* Half 1: Action Button / Completed Status (Exactly 50%) */}
            <div className="w-full flex">
              {activeDelegateName ? (
                isDelegateCompleted ? (
                  <div className="w-full h-11 sm:h-12 px-1.5 sm:px-3 bg-emerald-500/10 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 rounded-xl font-black text-[10px] sm:text-xs md:text-sm flex items-center justify-center gap-1 sm:gap-2 shadow-inner text-center">
                    <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-emerald-500" />
                    <span className="truncate">اكتملت مبيعات اليوم ✅</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    className="w-full h-11 sm:h-12 px-1.5 sm:px-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white rounded-xl font-black text-[10px] sm:text-xs md:text-sm shadow-md hover:shadow-lg transition-all active:scale-95 flex items-center justify-center gap-1 sm:gap-2 cursor-pointer border border-red-700 text-center"
                  >
                    <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="truncate">لقد أكملت مبيعات اليوم</span>
                  </button>
                )
              ) : (
                /* Admin view when all delegates selected */
                <div
                  className={`w-full h-11 sm:h-12 px-1.5 sm:px-3 rounded-xl font-black text-[10px] sm:text-xs md:text-sm flex items-center justify-center gap-1 sm:gap-2 border text-center ${
                    isDarkMode
                      ? 'bg-slate-800/80 border-slate-700 text-amber-300'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-amber-500" />
                  <span className="truncate">
                    اكتمل: {completedCount} من {totalDelegatesCount}
                  </span>
                </div>
              )}
            </div>

            {/* Half 2: Countdown Timer to 3:00 PM (Exactly 50%) */}
            <div className="w-full flex">
              <div
                className={`w-full h-11 sm:h-12 px-1.5 sm:px-3 rounded-xl border flex items-center justify-center gap-1 sm:gap-2 transition-all text-center ${
                  isPast3PM
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400'
                    : secondsRemaining < 1800
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-600 dark:text-rose-400 animate-pulse'
                    : isDarkMode
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                    : 'bg-slate-100 border-slate-200 text-slate-800'
                }`}
              >
                <Clock
                  className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${
                    isPast3PM
                      ? 'text-amber-500'
                      : secondsRemaining < 1800
                      ? 'text-rose-500'
                      : 'text-emerald-500'
                  }`}
                />

                <div className="flex flex-col sm:flex-row items-center justify-center leading-tight sm:gap-1.5">
                  <span className="text-[9px] sm:text-[10px] md:text-xs font-bold text-slate-500 dark:text-slate-400 truncate">
                    {isPast3PM ? 'إغلاق (3:00 م):' : 'إغلاق تلقائي (3:00 م):'}
                  </span>
                  <div className="flex items-center gap-1" dir="ltr">
                    <span className="font-mono font-black text-xs sm:text-sm md:text-base tracking-wider">
                      {countdownText}
                    </span>
                    {isPast3PM && (
                      <span className="text-[8px] sm:text-[9px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 py-0.2 rounded" dir="rtl">
                        انتهى
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
