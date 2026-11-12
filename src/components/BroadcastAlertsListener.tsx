import React, { useEffect, useState, useRef } from 'react';
import { BroadcastAlert } from '../types';
import {
  fetchActiveBroadcastAlerts,
  subscribeToBroadcastAlerts,
  getAcknowledgedAlertIds,
  markAlertAsAcknowledged
} from '../lib/broadcastService';
import { playBroadcastAlertToneAndVibrate } from '../utils/soundAlert';
import { RepresentativeBroadcastAlertModal } from './RepresentativeBroadcastAlertModal';
import { useSales } from '../context/SalesContext';

export const BroadcastAlertsListener: React.FC = () => {
  const { currentUser, isDarkMode } = useSales();
  const [currentAlert, setCurrentAlert] = useState<BroadcastAlert | null>(null);
  const queueRef = useRef<BroadcastAlert[]>([]);

  // Only field representatives should receive popup modals (Admins create them)
  const isRepresentative = Boolean(
    currentUser &&
    !currentUser.isAdmin &&
    currentUser.role !== 'admin' &&
    currentUser.name !== 'الأدمن'
  );

  useEffect(() => {
    if (!isRepresentative) return;

    let isMounted = true;

    // 1. Initial check for any active, non-expired broadcast that hasn't been acknowledged
    const checkInitialAlerts = async () => {
      try {
        const active = await fetchActiveBroadcastAlerts();
        if (!isMounted) return;

        const acknowledgedSet = getAcknowledgedAlertIds();
        const unread = active.filter(
          (a) =>
            !acknowledgedSet.has(a.id) &&
            new Date(a.expires_at).getTime() > Date.now()
        );

        if (unread.length > 0) {
          queueRef.current = unread.slice(1);
          setCurrentAlert(unread[0]);
        }
      } catch (err) {
        console.warn('Initial broadcast check failed:', err);
      }
    };

    checkInitialAlerts();

    // 2. Real-time listener for incoming broadcast alerts
    const unsubscribe = subscribeToBroadcastAlerts((newAlert) => {
      if (!isMounted) return;

      const acknowledgedSet = getAcknowledgedAlertIds();
      if (
        !acknowledgedSet.has(newAlert.id) &&
        new Date(newAlert.expires_at).getTime() > Date.now()
      ) {
        setCurrentAlert((prev) => {
          if (!prev) {
            playBroadcastAlertToneAndVibrate().catch(() => {});
            return newAlert;
          }
          // If already showing an alert, queue the new one
          if (!queueRef.current.some((a) => a.id === newAlert.id)) {
            queueRef.current.push(newAlert);
          }
          return prev;
        });
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isRepresentative, currentUser?.name]);

  const handleAcknowledge = (alertId: string) => {
    markAlertAsAcknowledged(alertId);

    // If more alerts in queue, show next
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      setCurrentAlert(next);
      playBroadcastAlertToneAndVibrate().catch(() => {});
    } else {
      setCurrentAlert(null);
    }
  };

  if (!isRepresentative || !currentAlert) {
    return null;
  }

  return (
    <RepresentativeBroadcastAlertModal
      alert={currentAlert}
      onAcknowledge={handleAcknowledge}
      isDarkMode={isDarkMode}
    />
  );
};
