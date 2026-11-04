import React, { useEffect, useState } from 'react';
import { collection, query, where, doc, writeBatch, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSales } from '../context/SalesContext';
import { DebtItem } from '../types';
import { logFirestoreErrorGracefully, isGlobalQuotaExceeded, safeOnSnapshot } from '../lib/firestoreUtils';

interface AlertData {
  id: string;
  note: string;
  targetTime: number;
  notified?: boolean;
}

export const DelegateAlertsListener: React.FC = () => {
  const { currentUser, addToast } = useSales();
  const [activeAlerts, setActiveAlerts] = useState<AlertData[]>([]);

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

    let unsub: (() => void) | undefined;
    if (isAdminOrDataEntry) {
      const alertsQ = collection(db, 'admin_data_entry_alerts');
      unsub = safeOnSnapshot(
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
    } else {
      const delegateName = currentUser.name;
      const alertsQ = query(collection(db, 'delegate_alerts'), where('delegateName', '==', delegateName));
      unsub = safeOnSnapshot(
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
    }

    const checkDebts = async () => {
      if (isGlobalQuotaExceeded()) return;
      try {
        // Selective query: non-admins only fetch their own debts
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

        // Eliminate N+1 roundtrips with a single batch commit
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
      if (unsub) unsub();
      clearInterval(interval);
    };
  }, [currentUser, isAdminOrDataEntry, addToast]);

  useEffect(() => {
    if (activeAlerts.length === 0) return;
    const checkAlerts = () => {
      const now = Date.now();
      activeAlerts.forEach(async (alertItem) => {
        if (now >= alertItem.targetTime) {
           addToast({
             title: 'تنبيه جديد 🔔',
             message: alertItem.note,
             type: 'milestone_100'
           });

           // Also attempt browser push notification if permitted
           if ('Notification' in window && Notification.permission === 'granted') {
             try {
               new Notification('تنبيه كالة تكريت 📊', {
                 body: alertItem.note,
                 icon: '/favicon.ico'
               });
             } catch (e) {}
           } else if ('Notification' in window && Notification.permission === 'default') {
             try {
               Notification.requestPermission();
             } catch (e) {}
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
