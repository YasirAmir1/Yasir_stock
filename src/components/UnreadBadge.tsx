import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

export const UnreadBadge: React.FC<{ delegateName: string; isAdmin?: boolean; role?: string }> = ({ delegateName, isAdmin, role }) => {
  const [unreadCount, setUnreadCount] = useState(0);

  const isAdminOrDataEntry = Boolean(isAdmin || role === 'dataEntry' || delegateName === 'الأدمن' || delegateName?.includes('مدخل'));

  useEffect(() => {
    if (!delegateName) return;

    if (isAdminOrDataEntry) {
      let alertsCount = 0;
      let notesCount = 0;

      const unsubAlerts = onSnapshot(collection(db, 'admin_data_entry_alerts'), (snap) => {
        alertsCount = snap.size;
        setUnreadCount(alertsCount + notesCount);
      });

      const unsubNotes = onSnapshot(collection(db, 'admin_data_entry_notes'), (snap) => {
        notesCount = snap.size;
        setUnreadCount(alertsCount + notesCount);
      });

      return () => {
        unsubAlerts();
        unsubNotes();
      };
    }

    let notifs: any[] = [];
    let reads: Record<string, number> = {};
    let taskTime = 0;
    let taskReadTime = 0;
    
    const updateCount = () => {
      let count = 0;
      const twelveHoursMs = 12 * 60 * 60 * 1000;
      const now = Date.now();
      
      // Check notifications
      for (const n of notifs) {
        const readAt = reads[n.id];
        if (!readAt) {
          count++; // Unread
        } else if (now - readAt > twelveHoursMs) {
          // Expired (disappears completely), so it's not unread. It shouldn't even be shown.
        } else {
          // Read but not expired. Not unread.
        }
      }
      
      // Check tasks
      if (taskTime > taskReadTime) {
        count++;
      }
      
      setUnreadCount(count);
    };

    const unsubNotifs = onSnapshot(collection(db, 'admin_notifications'), (snap) => {
      notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCount();
    });

    const readsQ = query(collection(db, 'delegate_notification_reads'), where('delegateName', '==', delegateName));
    const unsubReads = onSnapshot(readsQ, (snap) => {
      reads = {};
      snap.forEach(d => {
        const data = d.data();
        reads[data.notificationId] = data.readAt;
      });
      updateCount();
    });

    const unsubTask = onSnapshot(doc(db, 'admin_daily_tasks', delegateName), (d) => {
      taskTime = d.exists() ? (d.data().timestamp || 0) : 0;
      updateCount();
    });

    const unsubTaskRead = onSnapshot(doc(db, 'delegate_task_reads', delegateName), (d) => {
      taskReadTime = d.exists() ? (d.data().lastReadTimestamp || 0) : 0;
      updateCount();
    });

    return () => {
      unsubNotifs();
      unsubReads();
      unsubTask();
      unsubTaskRead();
    };
  }, [delegateName, isAdminOrDataEntry]);

  if (unreadCount === 0) return null;

  return (
    <div className="absolute -top-1 -right-1 sm:-top-1.5 sm:-right-1.5 bg-red-500 text-white text-[7px] sm:text-[9px] font-black w-3 h-3 sm:w-4 sm:h-4 flex items-center justify-center rounded-full shadow-sm animate-pulse pointer-events-none">
      {unreadCount > 9 ? '9+' : unreadCount}
    </div>
  );
};
