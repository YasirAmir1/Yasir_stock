import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSales } from '../context/SalesContext';

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
    if (!currentUser || currentUser.isAdmin) return;

    const delegateName = currentUser.name;
    const alertsQ = query(collection(db, 'delegate_alerts'), where('delegateName', '==', delegateName));
    
    const unsub = onSnapshot(alertsQ, (snap) => {
      const loaded: AlertData[] = [];
      snap.forEach(d => {
        const data = d.data() as AlertData;
        if (!data.notified) {
          loaded.push({ ...data, id: d.id });
        }
      });
      setActiveAlerts(loaded);
    });

    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (activeAlerts.length === 0) return;

    const checkAlerts = () => {
      const now = Date.now();
      activeAlerts.forEach(async (alertItem) => {
        // If the current time is past the target time
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

    // Check immediately and then every 30 seconds
    checkAlerts();
    const interval = setInterval(checkAlerts, 30000);

    return () => clearInterval(interval);
  }, [activeAlerts]);

  return null;
};
