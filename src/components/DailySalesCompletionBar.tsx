import React, { useState, useEffect, useMemo } from 'react';
import { useSales, DEFAULT_CATEGORIES_LIST, isExcludedDelegateCategory } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, doc, query, setDoc, where, writeBatch, deleteDoc } from 'firebase/firestore';
import { safeOnSnapshot, logFirestoreErrorGracefully } from '../lib/firestoreUtils';
import { formatWithCommas } from '../utils/numberUtils';
import { Check, Clock, CheckCircle2, AlertTriangle, Users, Pencil, ChevronDown, X } from 'lucide-react';

export const DailySalesCompletionBar: React.FC = () => {
  const {
    currentUser,
    selectedDelegate,
    salesEntries = [],
    productsList = [],
    isDarkMode,
    setUserMessage,
    addToast,
    delegatesList = [],
    delegateTargets = [],
  } = useSales();

  // Rafat / Data Entry check
  const isRafat =
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.role === 'dataEntry' ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال' ||
    Boolean(currentUser?.name && currentUser.name.includes('رأفت')) ||
    Boolean(currentUser?.delegateName && currentUser.delegateName.includes('رأفت'));

  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [completedDelegatesList, setCompletedDelegatesList] = useState<Array<{ delegate: string; completedAt: string; systemType?: string }>>([]);
  const [isCompletedLoaded, setIsCompletedLoaded] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdownText, setCountdownText] = useState('00:00:00');
  const [isPastTargetTime, setIsPastTargetTime] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Configurable auto-lock time (default 15:00 / 3:00 PM)
  const [targetAutoLockTime, setTargetAutoLockTime] = useState('15:00');
  const [showEditTimeModal, setShowEditTimeModal] = useState(false);
  const [newTimeInput, setNewTimeInput] = useState('15:00');
  const [isUpdatingTime, setIsUpdatingTime] = useState(false);

  // Activation Modal State
  const [showActivationModal, setShowActivationModal] = useState(false);
  const [selectedActivationDelegates, setSelectedActivationDelegates] = useState<Record<string, boolean>>({});
  const [savingStatusMap, setSavingStatusMap] = useState<Record<string, boolean>>({});

  // Monthly targets for low achievement warnings
  const [monthlyItemTargets, setMonthlyItemTargets] = useState<Array<{ categoryName: string; delegateName: string; monthlyTarget: number; monthlySales: number }>>([]);

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
    const unsub = safeOnSnapshot(
      q,
      (snap: any) => {
        const completed: Record<string, boolean> = {};
        const list: Array<{ delegate: string; completedAt: string; systemType?: string }> = [];
        snap.forEach((d: any) => {
          const data = d.data();
          if (data.delegate) {
            completed[data.delegate] = true;
            if (data.completedAt) {
              list.push({
                delegate: data.delegate,
                completedAt: data.completedAt,
                systemType: data.systemType || 'APP',
              });
            }
          }
        });
        list.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
        setCompletedDelegates(completed);
        setCompletedDelegatesList(list);
        setIsCompletedLoaded(true);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'daily_sales_completion');
        setIsCompletedLoaded(true);
      },
      'CompletionBar-completion'
    );
    return () => unsub();
  }, []);

  // Real-time listener for configurable auto_lock_time setting
  useEffect(() => {
    const unsub = safeOnSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (docSnap: any) => {
        if (docSnap.exists() && docSnap.data()?.time) {
          const t = docSnap.data().time;
          setTargetAutoLockTime(t);
          setNewTimeInput(t);
        }
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'auto_lock_time');
      },
      'CompletionBar-auto-lock'
    );
    return () => unsub();
  }, []);

  // Real-time listener for report11_targets (monthly target Warnings)
  useEffect(() => {
    const unsub = safeOnSnapshot(
      collection(db, 'report11_targets'),
      (snapshot: any) => {
        const list: any[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data();
          if (data && data.delegateName) {
            list.push({ ...data, id: docSnap.id });
          }
        });
        setMonthlyItemTargets(list);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'report11_targets'),
      'CompletionBar-report11-targets'
    );
    return () => unsub();
  }, []);

  // Format targetAutoLockTime for Arabic display (e.g. 15:00 -> 03:00 م)
  const formattedTargetTime = useMemo(() => {
    try {
      const [hStr, mStr] = targetAutoLockTime.split(':');
      let h = parseInt(hStr || '15', 10);
      const m = mStr || '00';
      const ampm = h >= 12 ? 'م' : 'ص';
      h = h % 12;
      h = h ? h : 12;
      return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
    } catch {
      return '3:00 م';
    }
  }, [targetAutoLockTime]);

  // Countdown timer calculation to targetAutoLockTime (Asia/Baghdad)
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

        const [hStr, mStr] = targetAutoLockTime.split(':');
        const targetHours = parseInt(hStr || '15', 10);
        const targetMinutes = parseInt(mStr || '00', 10);
        const targetSeconds = targetHours * 3600 + targetMinutes * 60;

        const diff = targetSeconds - currentSeconds;
        setSecondsRemaining(diff);

        if (diff <= 0) {
          setIsPastTargetTime(true);
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
          setIsPastTargetTime(false);
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
  }, [activeDelegateName, completedDelegates, isCompletedLoaded, targetAutoLockTime]);

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

      // Archive delegate's today invoices into sales_entries_archive
      try {
        const delegateEntries = salesEntries.filter(
          (e) =>
            (e.delegateName === delegateName || (e as any).delegateCode === delegateName) &&
            e.dateString === today
        );
        if (delegateEntries.length > 0) {
          const batch = writeBatch(db);
          delegateEntries.forEach((entry) => {
            if (entry.id) {
              const archiveRef = doc(db, 'sales_entries_archive', entry.id);
              batch.set(
                archiveRef,
                { ...entry, archivedAt: new Date().toISOString(), archiveReason: 'closing_time_expired' },
                { merge: true }
              );
            }
          });
          await batch.commit();
        }
      } catch (archiveErr) {
        console.error('Error auto-archiving entries on auto completion:', archiveErr);
      }

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
      await setDoc(doc(db, 'daily_sales_completion', activeDelegateName), {
        delegate: activeDelegateName,
        date: today,
        completedAt: new Date().toISOString(),
        systemType: 'APP',
      });

      // Archive delegate's today invoices into sales_entries_archive
      try {
        const delegateEntries = salesEntries.filter(
          (e) =>
            (e.delegateName === activeDelegateName || (e as any).delegateCode === activeDelegateName) &&
            e.dateString === today
        );
        if (delegateEntries.length > 0) {
          const batch = writeBatch(db);
          delegateEntries.forEach((entry) => {
            if (entry.id) {
              const archiveRef = doc(db, 'sales_entries_archive', entry.id);
              batch.set(
                archiveRef,
                { ...entry, archivedAt: new Date().toISOString(), archiveReason: 'delegate_completed_sales' },
                { merge: true }
              );
            }
          });
          await batch.commit();
        }
      } catch (archiveErr) {
        console.error('Error archiving entries on manual completion:', archiveErr);
      }

      addToast({
        message: `تم إنهاء وإكمال مبيعات اليوم بنجاح للمندوب (${activeDelegateName}) ✅`,
        type: 'success',
        delegateName: activeDelegateName,
        title: 'إكمال المبيعات',
        percentage: 100,
      });
      setUserMessage('تم إكمال مبيعات اليوم بنجاح! ✅');
      setShowConfirmModal(false);
    } catch (err) {
      console.error('Error confirming daily sales completion:', err);
      alert('حدث خطأ أثناء حفظ إنهاء المبيعات. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Save configurable auto lock time (Admin Only, disabled for data entry / Rafat)
  const handleSaveAutoLockTime = async () => {
    if (!newTimeInput || isUpdatingTime || isRafat) return;
    setIsUpdatingTime(true);
    try {
      await setDoc(doc(db, 'settings', 'auto_lock_time'), {
        time: newTimeInput,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || 'Admin',
      });
      addToast({
        message: `تم تحديث وقت الإغلاق التلقائي بنجاح إلى (${formattedTargetTime}) ✅`,
        type: 'success',
        title: 'تحديث التوقيت',
        percentage: 0,
        delegateName: currentUser?.name || 'Admin',
      });
      setUserMessage(`تم تحديث وقت الإغلاق التلقائي للمبيعات إلى (${newTimeInput}) بنجاح ✅`);
      setShowEditTimeModal(false);
    } catch (err) {
      console.error('Error saving auto lock time:', err);
      alert('حدث خطأ أثناء حفظ التوقيت الجديد. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsUpdatingTime(false);
    }
  };

  // Activation modal handlers
  const handleOpenActivationModal = () => {
    const initial: Record<string, boolean> = {};
    delegatesList.forEach(del => {
      initial[del] = !!completedDelegates[del];
    });
    setSelectedActivationDelegates(initial);
    setShowActivationModal(true);
  };

  const handleSaveActivation = async () => {
    const today = new Date().toISOString().split('T')[0];
    try {
      for (const del of delegatesList) {
        const docRef = doc(db, 'daily_sales_completion', del);
        if (selectedActivationDelegates[del]) {
          await setDoc(docRef, {
            delegate: del,
            date: today,
            completedAt: new Date().toISOString(),
            systemType: 'APP',
          }, { merge: true });
        } else {
          await deleteDoc(docRef);
        }
      }
      setUserMessage('تم تحديث حالة تفعيل مبيعات المندوبين بنجاح ✅');
      setShowActivationModal(false);
    } catch (err) {
      console.error("Error updating activation:", err);
      setUserMessage('حدث خطأ أثناء حفظ حالة التفعيل.');
    }
  };

  // Update System Type (SAP / APP) for a delegate
  const handleUpdateSystemType = async (delName: string, newType: string) => {
    const today = new Date().toISOString().split('T')[0];
    try {
      const docRef = doc(db, 'daily_sales_completion', delName);
      await setDoc(docRef, {
        delegate: delName,
        date: today,
        completedAt: new Date().toISOString(),
        systemType: newType,
      }, { merge: true });

      setSavingStatusMap(prev => ({ ...prev, [delName]: true }));
      setTimeout(() => {
        setSavingStatusMap(prev => ({ ...prev, [delName]: false }));
      }, 1500);
      setUserMessage(`تم حفظ نظام ${newType} للمندوب ${delName} بنجاح ✅`);
    } catch (err) {
      console.error("Error updating system type:", err);
      setUserMessage('حدث خطأ أثناء حفظ نوع النظام.');
    }
  };

  // Helper to format completion timestamp
  const formatCompletionTime = (isoStr?: string) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return '';
    }
  };

  // Resilient delegate matching
  const normalizeDelName = (name?: string): string => {
    if (!name) return '';
    const trimmed = name.trim();
    const DELEGATE_NAME_MAP: Record<string, string> = {
      'مندوب 1': 'ناجي خلف',
      'مندوب 2': 'خلدون جمال',
      'مندوب 3': 'محمد جاسم',
      'مندوب 4': 'بكر بدران',
      'مندوب 5': 'فيصل فؤاد',
      'مندوب 6': 'صباح فرحان',
      'مندوب 7': 'مندوب عام 1',
      'مندوب 8': 'مندوب عام 2',
    };
    const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim().toLowerCase();
    if (DELEGATE_NAME_MAP[trimmed]) return norm(DELEGATE_NAME_MAP[trimmed]);
    for (const [k, v] of Object.entries(DELEGATE_NAME_MAP)) {
      if (trimmed.includes(k) || trimmed.includes(v)) {
        return norm(v);
      }
    }
    return norm(trimmed);
  };

  const isDelMatch = (nameA?: string, nameB?: string): boolean => {
    if (!nameA || !nameB) return false;
    const a = normalizeDelName(nameA);
    const b = normalizeDelName(nameB);
    if (a === b) return true;
    return (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
  };

  // Today's entries
  const todaysEntries = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return salesEntries.filter(e => e.dateString === today);
  }, [salesEntries]);

  // Priority Table Delegates
  const priorityTableDelegates = useMemo(() => {
    const completedMap = new Map<string, { completedAt: string; systemType: string }>();
    completedDelegatesList.forEach((item) => {
      completedMap.set(item.delegate.trim().toLowerCase(), {
        completedAt: item.completedAt,
        systemType: item.systemType || 'APP',
      });
    });

    if (!isPastTargetTime) {
      return completedDelegatesList.map((item, idx) => ({
        delegate: item.delegate,
        completedAt: item.completedAt,
        systemType: item.systemType || 'APP',
        hasManuallyCompleted: true,
        displayRank: idx + 1,
      }));
    }

    const allNamesSet = new Set<string>();
    delegatesList.forEach((d) => { if (d && d.trim()) allNamesSet.add(d.trim()); });
    todaysEntries.forEach((e) => { if (e.delegateName && e.delegateName.trim()) allNamesSet.add(e.delegateName.trim()); });
    completedDelegatesList.forEach((c) => { if (c.delegate && c.delegate.trim()) allNamesSet.add(c.delegate.trim()); });

    const allDelegates = Array.from(allNamesSet);

    const completedItems: Array<{
      delegate: string;
      completedAt: string;
      systemType: string;
      hasManuallyCompleted: boolean;
      totalWeight: number;
    }> = [];

    const remainingItems: Array<{
      delegate: string;
      completedAt?: string;
      systemType: string;
      hasManuallyCompleted: boolean;
      totalWeight: number;
    }> = [];

    allDelegates.forEach((delName) => {
      const lower = delName.toLowerCase();
      const delEntries = todaysEntries.filter((e) => isDelMatch(e.delegateName, delName));
      const totalWeight = delEntries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);

      let foundCompleted: { completedAt: string; systemType: string } | undefined;
      for (const [key, val] of completedMap.entries()) {
        if (isDelMatch(key, lower)) {
          foundCompleted = val;
          break;
        }
      }

      if (foundCompleted) {
        completedItems.push({
          delegate: delName,
          completedAt: foundCompleted.completedAt,
          systemType: foundCompleted.systemType,
          hasManuallyCompleted: true,
          totalWeight,
        });
      } else {
        remainingItems.push({
          delegate: delName,
          systemType: 'APP',
          hasManuallyCompleted: false,
          totalWeight,
        });
      }
    });

    completedItems.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
    remainingItems.sort((a, b) => b.totalWeight - a.totalWeight);

    const combined = [...completedItems, ...remainingItems];

    return combined.map((item, idx) => ({
      ...item,
      displayRank: idx + 1,
    }));
  }, [isPastTargetTime, completedDelegatesList, delegatesList, todaysEntries]);

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

      {/* Edit Auto Lock Time Modal (Admin Only, hidden for Rafat) */}
      {showEditTimeModal && currentUser?.isAdmin && !isRafat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          dir="rtl"
          onClick={() => !isUpdatingTime && setShowEditTimeModal(false)}
        >
          <div
            className={`w-full max-w-sm rounded-2xl p-5 shadow-2xl border text-right space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode
                ? 'bg-slate-900 border-amber-500/40 text-white'
                : 'bg-white border-amber-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black">تعديل وقت الإغلاق التلقائي للمبيعات</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                  يُطبق فوراً على جميع المندوبين
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black text-slate-600 dark:text-slate-300">
                اختر وقت الإغلاق التلقائي الجديد:
              </label>
              <input
                type="time"
                value={newTimeInput}
                onChange={(e) => setNewTimeInput(e.target.value)}
                className={`w-full p-3 rounded-xl border text-base font-black font-mono text-center focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={isUpdatingTime}
                onClick={() => setShowEditTimeModal(false)}
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
                disabled={isUpdatingTime}
                onClick={handleSaveAutoLockTime}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isUpdatingTime ? 'جاري الحفظ...' : 'حفظ التوقيت'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activation Modal (إدارة وتفعيل مبيعات المندوبين) */}
      {showActivationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" dir="rtl">
          <div className={`w-full max-w-md rounded-2xl p-5 shadow-2xl border space-y-4 ${
            isDarkMode ? 'bg-slate-900 border-amber-500/40 text-white' : 'bg-white border-amber-200 text-slate-900'
          }`}>
            <div className="flex items-center justify-between border-b border-slate-700/50 pb-3">
              <h3 className="text-base font-black flex items-center gap-2 text-amber-400">
                <span>⚙️ إدارة وتفعيل مبيعات المندوبين</span>
              </h3>
              <button onClick={() => setShowActivationModal(false)} className="text-slate-400 hover:text-white transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs font-bold text-slate-400">
              تفعيل أو إلغاء تفعيل إتمام مبيعات اليوم للمندوبين يدوياً:
            </p>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {delegatesList.map(del => (
                <label key={del} className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                  selectedActivationDelegates[del]
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-300'
                }`}>
                  <span className="font-black text-xs">{del}</span>
                  <input
                    type="checkbox"
                    checked={!!selectedActivationDelegates[del]}
                    onChange={(e) => setSelectedActivationDelegates({
                      ...selectedActivationDelegates,
                      [del]: e.target.checked
                    })}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-700/50">
              <button
                onClick={() => setShowActivationModal(false)}
                className="flex-1 py-2 rounded-xl font-black text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveActivation}
                className="flex-1 py-2 rounded-xl font-black text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md cursor-pointer"
              >
                حفظ التغيرات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="w-full space-y-3" dir="rtl">
        {/* The Split Two-Halves Bar: 50% Button, 50% Countdown */}
        <div
          className={`p-1.5 sm:p-2.5 rounded-2xl border shadow-xl transition-all duration-500 ${
            isDarkMode
              ? 'bg-gradient-to-br from-[#0a1b4b] via-[#08153a] to-[#050c26] border-[#1e293b] text-white'
              : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2.5 items-stretch">
            {/* Half 1: Action Button / Completed Status */}
            <div className="w-full flex">
              {activeDelegateName ? (
                isDelegateCompleted ? (
                  <div className="w-full min-h-[46px] sm:min-h-[52px] px-1.5 sm:px-3 bg-emerald-500/10 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 rounded-xl font-black text-[10px] sm:text-xs md:text-sm flex items-center justify-center gap-1 sm:gap-2 shadow-inner text-center">
                    <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-emerald-500" />
                    <span className="truncate">اكتملت مبيعات اليوم ✅</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    className="w-full min-h-[46px] sm:min-h-[52px] px-1.5 sm:px-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white rounded-xl font-black text-[10px] sm:text-xs md:text-sm shadow-md hover:shadow-lg transition-all active:scale-95 flex items-center justify-center gap-1 sm:gap-2 cursor-pointer border border-red-700 text-center"
                  >
                    <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="truncate">لقد أكملت مبيعات اليوم</span>
                  </button>
                )
              ) : (
                /* Admin view when all delegates selected */
                <div
                  className={`w-full min-h-[46px] sm:min-h-[52px] px-1.5 sm:px-3 rounded-xl font-black text-[10px] sm:text-xs md:text-sm flex items-center justify-center gap-1 sm:gap-2 border text-center ${
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

            {/* Half 2: Ultra-Modern Countdown Timer Box */}
            <div className="w-full flex">
              <div
                className={`relative overflow-hidden w-full min-h-[48px] sm:min-h-[54px] px-2.5 sm:px-3 py-1.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-1.5 sm:gap-2 transition-all duration-300 shadow-sm backdrop-blur-xs ${
                  isPastTargetTime
                    ? isDarkMode
                      ? 'bg-gradient-to-r from-amber-950/30 via-slate-900 to-amber-950/20 border-amber-500/40 text-amber-300 shadow-amber-950/10'
                      : 'bg-gradient-to-r from-amber-50/95 via-white to-amber-50/70 border-amber-300 text-amber-950 shadow-amber-900/5'
                    : secondsRemaining < 1800
                    ? isDarkMode
                      ? 'bg-gradient-to-r from-rose-950/40 via-slate-900 to-rose-950/30 border-rose-500/60 text-rose-300 animate-pulse'
                      : 'bg-gradient-to-r from-rose-50 via-white to-rose-50 border-rose-300 text-rose-900 animate-pulse'
                    : isDarkMode
                    ? 'bg-gradient-to-r from-emerald-950/40 via-slate-900/90 to-slate-900 border-emerald-500/40 text-emerald-300 shadow-emerald-950/20'
                    : 'bg-gradient-to-r from-emerald-50/95 via-white to-emerald-50/60 border-emerald-300 text-emerald-950 shadow-emerald-900/5'
                }`}
              >
                {/* Explanatory Title & Target Closing Time */}
                <div className="flex items-center gap-1.5 shrink-0 text-center sm:text-right">
                  <div
                    className={`p-1 sm:p-1.5 rounded-lg flex items-center justify-center shrink-0 shadow-xs ${
                      isPastTargetTime
                        ? 'bg-amber-500/20 text-amber-500 dark:text-amber-400'
                        : secondsRemaining < 1800
                        ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400'
                        : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </div>

                  <div className="flex flex-col sm:flex-row items-center sm:items-center gap-1 sm:gap-2">
                    <span className="text-[10px] sm:text-xs font-black text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      توقيت إغلاق المبيعات:
                    </span>

                    <div className="flex items-center gap-1">
                      <span className="inline-flex items-center gap-0.5 text-[11px] sm:text-xs font-black text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 dark:bg-emerald-500/25 px-2 py-0.5 rounded-lg border border-emerald-500/35 shadow-xs font-mono">
                        <span className="text-slate-400 dark:text-slate-500 font-sans font-bold">[</span>
                        <span>{formattedTargetTime}</span>
                        <span className="text-slate-400 dark:text-slate-500 font-sans font-bold">]</span>
                      </span>
                      {currentUser?.isAdmin && !isRafat && (
                        <button
                          type="button"
                          onClick={() => {
                            setNewTimeInput(targetAutoLockTime);
                            setShowEditTimeModal(true);
                          }}
                          className="p-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400 transition-colors cursor-pointer shrink-0"
                          title="تعديل وقت الإغلاق التلقائي"
                        >
                          <Pencil className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Modern UI Segmented Digital Countdown Timer */}
                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0" dir="ltr">
                  <div className="flex items-center gap-1">
                    {/* Hours */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-md font-mono font-black text-xs sm:text-sm border shadow-inner min-w-[24px] sm:min-w-[27px] text-center ${
                          isPastTargetTime
                            ? 'bg-amber-950/40 border-amber-500/40 text-amber-400'
                            : secondsRemaining < 1800
                            ? 'bg-rose-950/40 border-rose-500/60 text-rose-300'
                            : isDarkMode
                            ? 'bg-slate-950/90 border-emerald-500/40 text-emerald-300'
                            : 'bg-emerald-950/10 border-emerald-300 text-emerald-900'
                        }`}
                      >
                        {(countdownText || '00:00:00').split(':')[0] || '00'}
                      </div>
                      <span className="text-[7px] sm:text-[8px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">ساعة</span>
                    </div>

                    <span className="font-mono font-black text-xs sm:text-sm text-emerald-500/80 -mt-2 animate-pulse">:</span>

                    {/* Minutes */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-md font-mono font-black text-xs sm:text-sm border shadow-inner min-w-[24px] sm:min-w-[27px] text-center ${
                          isPastTargetTime
                            ? 'bg-amber-950/40 border-amber-500/40 text-amber-400'
                            : secondsRemaining < 1800
                            ? 'bg-rose-950/40 border-rose-500/60 text-rose-300'
                            : isDarkMode
                            ? 'bg-slate-950/90 border-emerald-500/40 text-emerald-300'
                            : 'bg-emerald-950/10 border-emerald-300 text-emerald-900'
                        }`}
                      >
                        {(countdownText || '00:00:00').split(':')[1] || '00'}
                      </div>
                      <span className="text-[7px] sm:text-[8px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">دقيقة</span>
                    </div>

                    <span className="font-mono font-black text-xs sm:text-sm text-emerald-500/80 -mt-2 animate-pulse">:</span>

                    {/* Seconds */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-md font-mono font-black text-xs sm:text-sm border shadow-inner min-w-[24px] sm:min-w-[27px] text-center ${
                          isPastTargetTime
                            ? 'bg-amber-950/40 border-amber-500/40 text-amber-400'
                            : secondsRemaining < 1800
                            ? 'bg-rose-950/40 border-rose-500/60 text-rose-300'
                            : isDarkMode
                            ? 'bg-slate-950/90 border-emerald-500/40 text-emerald-300'
                            : 'bg-emerald-950/10 border-emerald-300 text-emerald-900'
                        }`}
                      >
                        {(countdownText || '00:00:00').split(':')[2] || '00'}
                      </div>
                      <span className="text-[7px] sm:text-[8px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">ثانية</span>
                    </div>
                  </div>

                  {/* Status Indicator */}
                  {isPastTargetTime ? (
                    <span
                      className="text-[8px] sm:text-[9px] font-black bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-1 rounded-md border border-amber-500/30 shrink-0 self-start mt-0.5"
                      dir="rtl"
                    >
                      انتهى
                    </span>
                  ) : (
                    <div className="flex flex-col items-center self-start mt-0.5" dir="rtl">
                      <span className="inline-flex items-center gap-1 text-[8px] sm:text-[9px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-md border border-emerald-500/30 shrink-0">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                        متبقي
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 📊 Admin Completed Delegates Priority Table */}
        {currentUser?.isAdmin && (isPastTargetTime ? priorityTableDelegates.length > 0 : completedDelegatesList.length > 0) && (
          <div className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl p-2.5 sm:p-4 text-white shadow-xl space-y-3 w-full animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs sm:text-sm font-black text-amber-400 flex items-center gap-1.5">
                  <span>📊</span>
                  <span>جدول المندوبين الذين أكملوا مبيعات اليوم (حسب التسلسل الزمني للأسبقية):</span>
                </h3>
                {isPastTargetTime && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black">
                    ✓ بعد الإغلاق الرسمي ({formattedTargetTime}) — عرض كافة المندوبين ({priorityTableDelegates.length})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleOpenActivationModal}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0"
              >
                <span>⚙️ إدارة وتفعيل المبيعات</span>
              </button>
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full min-w-[580px] text-xs text-center border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-300 font-bold">
                    <th className="p-2">نظام (SAP / APP)</th>
                    <th className="p-2">اسم المندوب</th>
                    <th className="p-2">عدد الفواتير الكلية</th>
                    <th className="p-2">الهدف اليومي للمندوب</th>
                    <th className="p-2">وزن المبيعات اليومي</th>
                    <th className="p-2">النسبة المئوية بين الهدف والمبيعات</th>
                    <th className="p-2">المبلغ الكلي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {priorityTableDelegates.map((item) => {
                    const delName = item.delegate;
                    const delEntries = todaysEntries.filter(e => isDelMatch(e.delegateName, delName));
                    const invoiceCount = new Set(delEntries.map(e => `${e.dateString || ''}_${e.customerCode || e.customerName || e.invoiceId || e.id}`)).size;
                    const totalWeight = delEntries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                    const totalAmount = delEntries.reduce((sum, e) => {
                      const prod = productsList.find(p => p.productName === e.productName);
                      const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                      return sum + (price * e.quantity);
                    }, 0);
                    const targetWeight = DEFAULT_CATEGORIES_LIST.filter(c => !isExcludedDelegateCategory(c)).reduce((sum, cat) => {
                      const found = delegateTargets.find(t => 
                        isDelMatch(t.delegateName, delName) &&
                        t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
                      );
                      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
                    }, 0);
                    const pct = targetWeight > 0 ? (totalWeight / targetWeight) * 100 : 0;

                    const delMonthlyTargets = monthlyItemTargets.filter(t => isDelMatch(t.delegateName, delName));
                    const totalMonthlyTarget = delMonthlyTargets.reduce((sum, t) => sum + (Number(t.monthlyTarget) || 0), 0);
                    const totalMonthlySales = delMonthlyTargets.reduce((sum, t) => sum + (Number(t.monthlySales) || 0), 0);
                    const monthlyPct = totalMonthlyTarget > 0 ? (totalMonthlySales / totalMonthlyTarget) * 100 : 0;
                    const isLowMonthlyAchievement = totalMonthlyTarget > 0 && monthlyPct < 30;

                    return (
                      <tr key={delName} className={`transition-all ${
                        isLowMonthlyAchievement 
                          ? 'bg-rose-950/50 hover:bg-rose-900/60 border-b border-rose-500/40 shadow-[inset_0_0_10px_rgba(244,63,94,0.15)]' 
                          : 'hover:bg-slate-800/50'
                      }`}>
                        <td 
                          className="p-2 text-center cursor-pointer"
                          onClick={(e) => {
                            const selectEl = e.currentTarget.querySelector('select');
                            if (selectEl) selectEl.focus();
                          }}
                        >
                          <div className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-xl border transition-all ${
                            savingStatusMap[delName]
                              ? 'border-emerald-400 bg-emerald-500/30 scale-105 animate-pulse shadow-lg'
                              : isDarkMode
                              ? 'bg-slate-800 border-slate-700'
                              : 'bg-slate-100 border-slate-300'
                          }`}>
                            <select
                              value={item.systemType || 'SAP'}
                              onChange={(e) => handleUpdateSystemType(delName, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className={`bg-transparent font-black text-xs cursor-pointer focus:outline-none ${
                                item.systemType === 'APP'
                                  ? 'text-blue-400 font-extrabold'
                                  : 'text-amber-400 font-extrabold'
                              }`}
                            >
                              <option value="SAP" className="bg-slate-900 text-amber-400 font-bold">SAP</option>
                              <option value="APP" className="bg-slate-900 text-blue-400 font-bold">APP</option>
                            </select>
                            {savingStatusMap[delName] && (
                              <span className="text-[10px] text-emerald-300 font-bold">✓</span>
                            )}
                          </div>
                        </td>
                        <td className="p-2 font-bold text-white">
                          <div className="flex flex-col items-center justify-center">
                            <div className="flex items-center gap-1.5 flex-wrap justify-center">
                              <span>{delName}</span>
                              {isLowMonthlyAchievement && (
                                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-slate-950 font-black text-[9px] shadow-sm animate-pulse" title={`إنجاز شهري أقل من 30% (${monthlyPct.toFixed(1)}%)`}>
                                  ⚠️ منخفض (<strong className="font-mono">{monthlyPct.toFixed(0)}%</strong>)
                                </span>
                              )}
                            </div>
                            {item.hasManuallyCompleted && item.completedAt ? (
                              <span className="text-[9px] text-emerald-400 font-bold mt-0.5">
                                أتم المبيعات: {formatCompletionTime(item.completedAt)}
                              </span>
                            ) : isPastTargetTime ? (
                              <span className="text-[9px] text-slate-400 font-normal mt-0.5">
                                إغلاق رسمي ({formattedTargetTime})
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="p-2 font-bold">{formatWithCommas(invoiceCount)}</td>
                        <td className="p-2 font-bold">{formatWithCommas(parseFloat(targetWeight.toFixed(1)), true)} كجم</td>
                        <td className="p-2 font-bold text-emerald-300">{formatWithCommas(parseFloat(totalWeight.toFixed(1)), true)} كجم</td>
                        <td className={`p-2 font-extrabold ${pct < 100 ? 'text-red-500' : 'text-emerald-400'}`}>{pct.toFixed(1)}%</td>
                        <td className="p-2 font-extrabold text-indigo-300">{formatWithCommas(totalAmount, true)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
