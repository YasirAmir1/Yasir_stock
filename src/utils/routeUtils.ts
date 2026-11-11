import { RouteItem } from '../types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Check if a route temporary override is currently active and not expired
 */
export const isRouteOverrideActive = (r?: Partial<RouteItem> | null): boolean => {
  if (!r) return false;
  const isOverride = Boolean(r.isTemporaryOverride ?? (r as any)?.is_temporary_override);
  const expiresAt = Number(r.overrideExpiresAt ?? (r as any)?.override_expires_at) || 0;
  if (!isOverride || !expiresAt) return false;
  return Date.now() < expiresAt;
};

/**
 * Get the effective route day (returns tempAssignedDay if override is active, otherwise path)
 */
export const getEffectiveRouteDay = (r?: Partial<RouteItem> | null): string => {
  if (!r) return '';
  if (isRouteOverrideActive(r)) {
    const tempDay = r.tempAssignedDay || (r as any)?.assigned_day;
    if (tempDay) return tempDay;
  }
  return r.path || '';
};

/**
 * Get timestamp for Today at 21:00:00 (9:00 PM local time)
 */
export const getToday9PMTimestamp = (): number => {
  const now = new Date();
  const today9PM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0);
  return today9PM.getTime();
};

/**
 * Temporarily shift a customer's route day until 21:00 today
 */
export const shiftCustomerRouteTemporarily = async (
  route: RouteItem,
  targetDay: string,
  adminName?: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const expiresAt = getToday9PMTimestamp();
    const originalPath = route.originalPath || route.path;

    const payload = {
      isTemporaryOverride: true,
      tempAssignedDay: targetDay,
      overrideExpiresAt: expiresAt,
      originalPath: originalPath,
      // Snake_case aliases for compatibility with Supabase
      is_temporary_override: true,
      assigned_day: targetDay,
      override_expires_at: expiresAt,
      updatedAt: Date.now(),
      updatedBy: adminName || 'الأدمن',
    };

    const routeRef = doc(db, 'routes', route.id);
    await updateDoc(routeRef, payload);

    return {
      success: true,
      message: `تم تحويل مسار المحل (${route.customerName}) مؤقتاً إلى يوم (${targetDay}) حتى الساعة 9:00 مساءً 🗓️⚡`,
    };
  } catch (err: any) {
    console.error('Error shifting route temporarily:', err);
    return {
      success: false,
      message: err.message || 'حدث خطأ أثناء تحويل المسار',
    };
  }
};

/**
 * Revert a customer's temporary route override back to default path
 */
export const revertCustomerRouteOverride = async (
  route: RouteItem,
  adminName?: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const payload = {
      isTemporaryOverride: false,
      tempAssignedDay: '',
      overrideExpiresAt: 0,
      // Snake_case aliases
      is_temporary_override: false,
      assigned_day: '',
      override_expires_at: 0,
      updatedAt: Date.now(),
      updatedBy: adminName || 'الأدمن',
    };

    const routeRef = doc(db, 'routes', route.id);
    await updateDoc(routeRef, payload);

    return {
      success: true,
      message: `تم إلغاء التحويل المؤقت وإعادة المحل (${route.customerName}) لمساره الأصلي (${route.originalPath || route.path}) 🔄`,
    };
  } catch (err: any) {
    console.error('Error reverting route override:', err);
    return {
      success: false,
      message: err.message || 'حدث خطأ أثناء إرجاع المسار',
    };
  }
};
