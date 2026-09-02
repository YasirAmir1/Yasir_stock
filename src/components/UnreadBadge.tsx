import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

export const UnreadBadge: React.FC<{ delegateName: string }> = ({ delegateName }) => {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!delegateName) return;

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
  }, [delegateName]);

  if (unreadCount === 0) return null;

  return (
    <div className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black w-4 h-4 flex items-center justify-center rounded-full shadow-sm animate-pulse">
      {unreadCount > 9 ? '9+' : unreadCount}
    </div>
  );
};
