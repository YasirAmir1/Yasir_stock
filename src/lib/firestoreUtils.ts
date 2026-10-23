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
