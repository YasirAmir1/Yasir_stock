/**
 * Centralized Firestore Error and Quota Exceeded Handler.
 * Prevents unhandled exceptions, suppresses backoff spam when quota is reached,
 * and ensures the application falls back gracefully to local IndexedDB and localStorage caches.
 */

import { onSnapshot } from 'firebase/firestore';

export const setGlobalQuotaExceeded = () => {
  try {
    sessionStorage.setItem('fs_quota_exceeded', 'true');
    sessionStorage.setItem('fs_quota_exceeded_time', String(Date.now()));
    localStorage.setItem('fs_quota_exceeded_time', String(Date.now()));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('firestore-quota-exceeded'));
    }
  } catch {}
};

export const isGlobalQuotaExceeded = (): boolean => {
  try {
    const val = sessionStorage.getItem('fs_quota_exceeded');
    const time = Number(sessionStorage.getItem('fs_quota_exceeded_time') || localStorage.getItem('fs_quota_exceeded_time') || '0');
    if (val === 'true' || time > 0) {
      if (Date.now() - time < 12 * 60 * 60 * 1000) {
        return true;
      }
    }
  } catch {}
  return false;
};

export const isQuotaExceededError = (err: any): boolean => {
  if (!err) return false;
  const code = String(err?.code || '');
  const message = String(err?.message || err || '');
  return (
    code === 'resource-exhausted' ||
    message.includes('resource-exhausted') ||
    message.includes('Quota exceeded') ||
    message.includes('overloading the backend')
  );
};

export const logFirestoreErrorGracefully = (err: any, context = 'Firestore') => {
  if (!err) return;
  if (isQuotaExceededError(err)) {
    setGlobalQuotaExceeded();
    const now = Date.now();
    const lastWarn = Number(sessionStorage.getItem('fs_quota_warn_time') || '0');
    if (now - lastWarn > 300000) {
      sessionStorage.setItem('fs_quota_warn_time', String(now));
      console.warn(`[Firestore Quota] Limit reached in ${context}. Operating smoothly on local cache.`);
    }
  } else {
    console.error(`[Firestore Error] in ${context}:`, err);
  }
};

/**
 * Safe wrapper around Firestore onSnapshot.
 * Suppresses subscriptions when quota is exceeded, handles quota errors gracefully,
 * and immediately unsubscribes to prevent exponential backoff loops.
 */
export const safeOnSnapshot = (
  refOrQuery: any,
  onNext: (snapshot: any) => void,
  onError?: (err: any) => void,
  contextName = 'Firestore'
): (() => void) => {
  if (isGlobalQuotaExceeded()) {
    return () => {};
  }

  let unsubInternal: (() => void) | null = null;
  try {
    unsubInternal = onSnapshot(
      refOrQuery,
      onNext,
      (err) => {
        logFirestoreErrorGracefully(err, contextName);
        if (isQuotaExceededError(err)) {
          if (unsubInternal) {
            try {
              unsubInternal();
            } catch {}
            unsubInternal = null;
          }
        }
        if (onError) onError(err);
      }
    );
  } catch (err) {
    logFirestoreErrorGracefully(err, contextName);
    if (onError) onError(err);
    return () => {};
  }

  return () => {
    if (unsubInternal) {
      try {
        unsubInternal();
      } catch {}
      unsubInternal = null;
    }
  };
};

/**
 * Recursively strips `undefined` fields from an object or array to ensure it is valid for Firestore setDoc / updateDoc.
 * Firestore throws a fatal error if any field is `undefined`.
 */
export const cleanFirestoreData = <T = any>(obj: T): T => {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => (typeof item === 'object' && item !== null && !(item instanceof Date) ? cleanFirestoreData(item) : item)) as any;
  }
  const result: any = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (value !== undefined) {
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        result[key] = cleanFirestoreData(value);
      } else {
        result[key] = value;
      }
    }
  }
  return result as T;
};

