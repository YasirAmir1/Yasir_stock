import { supabase } from '../supabaseClient';
import { BroadcastAlert } from '../types';

const ACKNOWLEDGED_KEY = 'acknowledged_broadcast_ids';

/**
 * Calculates end of current day (23:59:59.999 local time) in ISO format
 */
export function getTodayEndOfDayIso(): string {
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return endOfDay.toISOString();
}

/**
 * Fetches active broadcast alerts where expires_at is in the future
 */
export async function fetchActiveBroadcastAlerts(): Promise<BroadcastAlert[]> {
  try {
    const nowIso = new Date().toISOString();
    // Try 'notifications' table first, fallback to 'broadcast_alerts'
    let { data, error } = await supabase
      .from('notifications')
      .select('id, message, sender_id, created_at, expires_at')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error || !data || data.length === 0) {
      const res2 = await supabase
        .from('broadcast_alerts')
        .select('id, message, sender_id, created_at, expires_at')
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(20);
      data = res2.data;
    }

    return (data || []) as BroadcastAlert[];
  } catch (err) {
    console.warn('Exception in fetchActiveBroadcastAlerts:', err);
    return [];
  }
}

/**
 * Fetches recent broadcast alerts (including expired ones) for the admin audit log
 */
export async function fetchAllRecentBroadcasts(limit = 30): Promise<BroadcastAlert[]> {
  try {
    let { data, error } = await supabase
      .from('notifications')
      .select('id, message, sender_id, created_at, expires_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) {
      const res2 = await supabase
        .from('broadcast_alerts')
        .select('id, message, sender_id, created_at, expires_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      data = res2.data;
    }

    return (data || []) as BroadcastAlert[];
  } catch {
    return [];
  }
}

/**
 * Broadcasts an admin notification message to all field representatives
 * Automatically sets expires_at to end of today at 23:59:59 and saves to both notifications & broadcast_alerts
 */
export async function broadcastAdminAlert(
  message: string,
  senderId = 'الأدمن'
): Promise<{ success: boolean; alert?: BroadcastAlert; error?: string }> {
  const trimmed = message.trim();
  if (!trimmed) {
    return { success: false, error: 'نص الإشعار مطلوب' };
  }

  const alertId = `bcast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();
  const expiresAtIso = getTodayEndOfDayIso();

  const record = {
    id: alertId,
    message: trimmed,
    sender_id: senderId,
    target_role: 'representatives',
    created_at: nowIso,
    expires_at: expiresAtIso,
  };

  try {
    // Insert into notifications table
    const { error: err1 } = await supabase
      .from('notifications')
      .insert(record);

    // Also insert into broadcast_alerts table for redundancy
    await supabase
      .from('broadcast_alerts')
      .insert({
        id: alertId,
        message: trimmed,
        sender_id: senderId,
        created_at: nowIso,
        expires_at: expiresAtIso,
      });

    if (err1) {
      console.warn('Warning inserting into notifications table:', err1);
    }

    return {
      success: true,
      alert: {
        id: alertId,
        message: trimmed,
        sender_id: senderId,
        created_at: nowIso,
        expires_at: expiresAtIso,
      },
    };
  } catch (err: any) {
    console.error('Exception in broadcastAdminAlert:', err);
    return { success: false, error: err?.message || 'تعذر إرسال الإشعار' };
  }
}

/**
 * Deletes or revokes a broadcast alert from Supabase
 */
export async function deleteBroadcastAlert(id: string): Promise<boolean> {
  try {
    await supabase.from('notifications').delete().eq('id', id);
    const { error } = await supabase.from('broadcast_alerts').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Subscribes to new real-time broadcast alerts via Supabase Realtime for both tables
 */
export function subscribeToBroadcastAlerts(
  onNewAlert: (alert: BroadcastAlert) => void
): () => void {
  const channelName = `broadcast_alerts_realtime_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      },
      (payload) => {
        if (payload.new) {
          const alert = payload.new as BroadcastAlert;
          if (new Date(alert.expires_at).getTime() > Date.now()) {
            onNewAlert(alert);
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'broadcast_alerts',
      },
      (payload) => {
        if (payload.new) {
          const alert = payload.new as BroadcastAlert;
          if (new Date(alert.expires_at).getTime() > Date.now()) {
            onNewAlert(alert);
          }
        }
      }
    )
    .subscribe();

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {}
  };
}

/**
 * Retrieves the set of alert IDs already acknowledged locally by the representative
 */
export function getAcknowledgedAlertIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ACKNOWLEDGED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(arr);
      }
    }
  } catch {}
  return new Set<string>();
}

/**
 * Marks an alert as acknowledged locally by the representative so it doesn't pop up again
 */
export function markAlertAsAcknowledged(id: string): void {
  try {
    const set = getAcknowledgedAlertIds();
    set.add(id);
    localStorage.setItem(ACKNOWLEDGED_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}
