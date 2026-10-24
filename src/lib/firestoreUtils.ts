/**
 * Centralized Firestore Error and Quota Exceeded Handler.
 * Prevents unhandled exceptions, suppresses backoff spam when quota is reached,
 * and ensures the application falls back gracefully to local IndexedDB and localStorage caches.
 */

export const isQuotaExceededError = (err: any): boolean => {
  if (!err) return false;
  const code = String(err.code || '');
  const message = String(err.message || err);
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

