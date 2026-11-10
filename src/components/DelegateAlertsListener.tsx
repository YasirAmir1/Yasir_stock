import React, { useEffect, useState, useRef } from 'react';
import { collection, query, where, doc, writeBatch, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSales } from '../context/SalesContext';
import { DebtItem } from '../types';
import { logFirestoreErrorGracefully, isGlobalQuotaExceeded, safeOnSnapshot } from '../lib/firestoreUtils';
import { playNotificationSound } from '../utils/soundAlert';

interface AlertData {
  id: string;
  note: string;
  targetTime: number;
  notified?: boolean;
}

export const DelegateAlertsListener: React.FC = () => {
  const { currentUser, addToast } = useSales();
  const [activeAlerts, setActiveAlerts] = useState<AlertData[]>([]);

  // Refs to prevent false audio alerts on initial page mount/load
  const isInitialNotifsLoaded = useRef(false);
  const knownNotifIds = useRef(new Set<string>());
  const lastTaskTimestamp = useRef<number>(Date.now());
  const initialTaskLoaded = useRef(false);
  const initialNotesLoaded = useRef(false);
  const knownNoteActionIds = useRef(new Set<string>());

  const isAdminOrDataEntry = Boolean(
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.name === 'الأدمن' ||
    currentUser?.name?.includes('مدخل')
  );

  useEffect(() => {
    if (!currentUser || isGlobalQuotaExceeded()) return;

    const unsubs: (() => void)[] = [];

    // 1. SCHEDULED ALERTS LISTENER
    if (isAdminOrDataEntry) {
      const alertsQ = collection(db, 'admin_data_entry_alerts');
      const unsub = safeOnSnapshot(
        alertsQ, 
        (snap: any) => {
          const loaded: AlertData[] = [];
          snap.forEach((d: any) => {
            const data = d.data() as AlertData;
            if (!data.notified) {
              if (data.note && (data.note.includes('قام الأدمن بتحديث') || data.note.includes('أهدافك ومبيعاتك') || data.note.includes('ملف أهداف'))) {
                updateDoc(doc(db, 'admin_data_entry_alerts', d.id), { notified: true }).catch(() => {});
                return;
              }
              loaded.push({ ...data, id: d.id });
            }
          });
          setActiveAlerts(loaded);
        },
        (err: any) => logFirestoreErrorGracefully(err, 'admin_data_entry_alerts'),
        'delegate_alerts_admin'
      );
      unsubs.push(unsub);
    } else {
      const delegateName = currentUser.name;
      const alertsQ = query(collection(db, 'delegate_alerts'), where('delegateName', '==', delegateName));
      const unsub = safeOnSnapshot(
        alertsQ, 
        (snap: any) => {
          const loaded: AlertData[] = [];
          snap.forEach((d: any) => {
            const data = d.data() as AlertData;
            if (!data.notified) {
              if (data.note && (data.note.includes('قام الأدمن بتحديث') || data.note.includes('أهدافك ومبيعاتك') || data.note.includes('ملف أهداف'))) {
                updateDoc(doc(db, 'delegate_alerts', d.id), { notified: true }).catch(() => {});
                return;
              }
              loaded.push({ ...data, id: d.id });
            }
          });
          setActiveAlerts(loaded);
        },
        (err: any) => logFirestoreErrorGracefully(err, 'delegate_alerts'),
        'delegate_alerts_user'
      );
      unsubs.push(unsub);
    }

    // 2. REAL-TIME ADMIN NOTIFICATIONS TO DELEGATES (Audio Chime on Arrival)
    if (!isAdminOrDataEntry) {
      const notifsQ = collection(db, 'admin_notifications');
      const unsubNotifs = safeOnSnapshot(
        notifsQ,
        (snap: any) => {
          if (!isInitialNotifsLoaded.current) {
            snap.forEach((d: any) => knownNotifIds.current.add(d.id));
            isInitialNotifsLoaded.current = true;
            return;
          }

          snap.docChanges().forEach((change: any) => {
            if (change.type === 'added' && !knownNotifIds.current.has(change.doc.id)) {
              knownNotifIds.current.add(change.doc.id);
              const notifData = change.doc.data();
              
              // Play audio alert chime!
              playNotificationSound();

              addToast({
                title: 'إشعار جديد من الإدارة 📢',
                message: notifData.text || 'وصلك إشعار وتوجيه جديد من الإدارة',
                type: 'milestone_100'
              });

              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  new Notification('إشعار جديد من الإدارة 📢', {
                    body: notifData.text || 'وصلك إشعار وتوجيه جديد من الإدارة',
                    icon: '/favicon.ico'
                  });
                } catch {
                  // Ignore
                }
              }
            }
          });
        },
        (err: any) => logFirestoreErrorGracefully(err, 'admin_notifications_listener'),
        'delegate_alerts_admin_notifs'
      );
      unsubs.push(unsubNotifs);

      // 3. DAILY TASKS LISTENER (Audio Chime when admin assigns/updates tasks)
      const taskDocRef = doc(db, 'admin_daily_tasks', currentUser.name);
      const unsubTask = safeOnSnapshot(
        taskDocRef,
        (dSnap: any) => {
          if (!initialTaskLoaded.current) {
            if (dSnap.exists()) {
              lastTaskTimestamp.current = dSnap.data().timestamp || Date.now();
            }
            initialTaskLoaded.current = true;
            return;
          }

          if (dSnap.exists()) {
            const data = dSnap.data();
            const newTimestamp = data.timestamp || 0;
            if (newTimestamp > lastTaskTimestamp.current) {
              lastTaskTimestamp.current = newTimestamp;
              
              // Play audio alert chime!
              playNotificationSound();

              addToast({
                title: 'مهمة يومية جديدة 📋',
                message: data.taskText ? `تم تحديث المهام: ${data.taskText.slice(0, 50)}...` : 'قام الأدمن بتعيين مهمة يومية جديدة لك',
                type: 'milestone_100'
              });

              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  new Notification('مهمة يومية جديدة 📋', {
                    body: data.taskText || 'قام الأدمن بتعيين مهمة يومية جديدة لك',
                    icon: '/favicon.ico'
                  });
                } catch {
                  // Ignore
                }
              }
            }
          }
        },
        (err: any) => logFirestoreErrorGracefully(err, 'admin_daily_tasks_listener'),
        'delegate_alerts_daily_tasks'
      );
      unsubs.push(unsubTask);

      // 4. CUSTOMER NOTES ACTION LISTENER (Audio Chime when admin takes action on note)
      const delegateNotesQ = query(collection(db, 'delegate_notes'), where('delegateName', '==', currentUser.name));
      const unsubNotes = safeOnSnapshot(
        delegateNotesQ,
        (snap: any) => {
          if (!initialNotesLoaded.current) {
            snap.forEach((d: any) => {
              const data = d.data();
              if (data.actionTaken || data.actionTakenAt) {
                knownNoteActionIds.current.add(d.id);
              }
            });
            initialNotesLoaded.current = true;
            return;
          }

          snap.docChanges().forEach((change: any) => {
            const noteData = change.doc.data();
            const isActionNow = Boolean(noteData.actionTaken || noteData.actionTakenAt);
            if (isActionNow && !knownNoteActionIds.current.has(change.doc.id)) {
              knownNoteActionIds.current.add(change.doc.id);
              
              // Play audio alert chime!
              playNotificationSound();

              addToast({
                title: 'تم اتخاذ إجراء بشأن الزبون ✅',
                message: `قام الأدمن باتخاذ إجراء بخصوص الزبون (${noteData.customerName || 'المحدد'})`,
                type: 'milestone_100'
              });
            }
          });
        },
        (err: any) => logFirestoreErrorGracefully(err, 'delegate_notes_action_listener'),
        'delegate_alerts_notes_action'
      );
      unsubs.push(unsubNotes);
    } else {
      // 5. FOR ADMIN / DATA ENTRY: Sound alert when a delegate sends a new note
      const adminNotesQ = collection(db, 'admin_data_entry_notes');
      let initialAdminNotes = false;
      const knownAdminNoteIds = new Set<string>();

      const unsubAdminNotes = safeOnSnapshot(
        adminNotesQ,
        (snap: any) => {
          if (!initialAdminNotes) {
            snap.forEach((d: any) => knownAdminNoteIds.add(d.id));
            initialAdminNotes = true;
            return;
          }

          snap.docChanges().forEach((change: any) => {
            if (change.type === 'added' && !knownAdminNoteIds.has(change.doc.id)) {
              knownAdminNoteIds.add(change.doc.id);
              const noteData = change.doc.data();
              
              playNotificationSound();

              addToast({
                title: 'ملاحظة جديدة من مندوب 📝',
                message: `${noteData.delegateName || 'مندوب'}: ${noteData.customerName || noteData.note || 'ملاحظة جديدة'}`,
                type: 'milestone_100'
              });
            }
          });
        },
        (err: any) => logFirestoreErrorGracefully(err, 'admin_notes_sound_listener'),
        'delegate_alerts_admin_notes'
      );
      unsubs.push(unsubAdminNotes);
    }

    // 6. DEBTS DUE DATES CHECK
    const checkDebts = async () => {
      if (isGlobalQuotaExceeded()) return;
      try {
        const debtsQuery = currentUser.isAdmin
          ? collection(db, 'debts')
          : query(collection(db, 'debts'), where('delegateName', '==', currentUser.name));

        const debtsSnap = await getDocs(debtsQuery);
        const now = Date.now();
        const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
        const batch = writeBatch(db);
        let updateCount = 0;

        debtsSnap.forEach((d) => {
          const debt = { id: d.id, ...d.data() } as DebtItem;
          const dueDate = new Date(debt.paymentDueDate).getTime();
          
          if (dueDate - now <= twoDaysInMs && dueDate - now > 0 && !debt.notified) {
            playNotificationSound();
            addToast({
              type: 'reminder',
              title: 'تنبيه موعد سداد دين ⏳',
              message: `فاتورة الزبون (${debt.customerName}) تستحق السداد خلال يومين!`,
              delegateName: debt.delegateName,
            });
            batch.update(d.ref, { notified: true });
            updateCount++;
          }
        });

        if (updateCount > 0) {
          await batch.commit().catch(() => {});
        }
      } catch (err) {
        logFirestoreErrorGracefully(err, 'checkDebts');
      }
    };

    checkDebts();
    const interval = setInterval(checkDebts, 3600000); // Hourly

    return () => {
      unsubs.forEach(u => u());
      clearInterval(interval);
    };
  }, [currentUser, isAdminOrDataEntry, addToast]);

  // Periodic active scheduled alerts check (runs every 10 seconds)
  useEffect(() => {
    if (activeAlerts.length === 0) return;
    const checkAlerts = () => {
      const now = Date.now();
      activeAlerts.forEach(async (alertItem) => {
        if (now >= alertItem.targetTime) {
          // Play audio notification chime!
          playNotificationSound();

          addToast({
            title: 'تنبيه جديد 🔔',
            message: alertItem.note,
            type: 'milestone_100'
          });

          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('تنبيه كالة تكريت 📊', {
                body: alertItem.note,
                icon: '/favicon.ico'
              });
            } catch {}
          } else if ('Notification' in window && Notification.permission === 'default') {
            try {
              Notification.requestPermission();
            } catch {}
          }

          try {
            if (isAdminOrDataEntry) {
              await updateDoc(doc(db, 'admin_data_entry_alerts', alertItem.id), { notified: true });
            } else {
              await updateDoc(doc(db, 'delegate_alerts', alertItem.id), { notified: true });
            }
          } catch (e) {
            console.error('Error updating alert status:', e);
          }
        }
      });
    };
    checkAlerts();
    const interval = setInterval(checkAlerts, 10000);
    return () => clearInterval(interval);
  }, [activeAlerts, isAdminOrDataEntry, addToast]);

  return null;
};
