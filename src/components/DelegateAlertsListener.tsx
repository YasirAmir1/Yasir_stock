import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSales } from '../context/SalesContext';
import { DebtItem } from '../types';

interface AlertData {
  id: string;
  note: string;
  targetTime: number;
  notified?: boolean;
}

export const DelegateAlertsListener: React.FC = () => {
  const { currentUser } = useSales();
  const [activeAlerts, setActiveAlerts] = useState<AlertData[]>([]);

  useEffect(() => {
    if (!currentUser) return;

    let unsub: () => void;
    if (!currentUser.isAdmin) {
      const delegateName = currentUser.name;
      const alertsQ = query(collection(db, 'delegate_alerts'), where('delegateName', '==', delegateName));
      unsub = onSnapshot(alertsQ, (snap) => {
        const loaded: AlertData[] = [];
        snap.forEach(d => {
          const data = d.data() as AlertData;
          if (!data.notified) {
            loaded.push({ ...data, id: d.id });
          }
        });
        setActiveAlerts(loaded);
      });
    }

    const checkDebts = async () => {
      const debtsSnap = await getDocs(collection(db, 'debts'));
      const now = Date.now();
      const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;

      debtsSnap.forEach(async (d) => {
        const debt = { id: d.id, ...d.data() } as DebtItem;
        const dueDate = new Date(debt.paymentDueDate).getTime();
        
        if (dueDate - now <= twoDaysInMs && dueDate - now > 0 && !debt.notified) {
          if (currentUser.isAdmin || currentUser.name === debt.delegateName) {
            alert(`تنبيه: فاتورة الزبون ${debt.customerName} تستحق السداد خلال يومين!`);
            await updateDoc(doc(db, 'debts', d.id), { notified: true });
          }
        }
      });
    };

    checkDebts();
    const interval = setInterval(checkDebts, 3600000); // Hourly

    return () => {
      if (unsub) unsub();
      clearInterval(interval);
    };
  }, [currentUser]);

  useEffect(() => {
    if (activeAlerts.length === 0) return;
    const checkAlerts = () => {
      const now = Date.now();
      activeAlerts.forEach(async (alertItem) => {
        if (now >= alertItem.targetTime) {
           alert(`تنبيه جديد: ${alertItem.note}`);
           try {
             await updateDoc(doc(db, 'delegate_alerts', alertItem.id), { notified: true });
           } catch (e) {
             console.error('Error updating alert status:', e);
           }
        }
      });
    };
    checkAlerts();
    const interval = setInterval(checkAlerts, 30000);
    return () => clearInterval(interval);
  }, [activeAlerts]);

  return null;
};
