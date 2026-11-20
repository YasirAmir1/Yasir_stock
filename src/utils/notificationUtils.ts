export interface DelegateNotificationIdentity {
  name?: string;
  delegateName?: string;
  delegateCode?: string;
  username?: string;
}

export const normalizeNotifyIdentity = (val?: string | null): string =>
  String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/\s+/g, ' ');

/**
 * Checks whether an admin_notifications document belongs to the current representative.
 * Global notifications (no targetDelegateName / targetDelegateCode / targetUsername) match all delegates.
 * Targeted notifications match only the specific representative.
 */
export const isNotificationForDelegate = (
  notif: any,
  user?: DelegateNotificationIdentity | null
): boolean => {
  if (!notif) return false;

  const targetName = normalizeNotifyIdentity(notif.targetDelegateName);
  const targetCode = normalizeNotifyIdentity(notif.targetDelegateCode);
  const targetUser = normalizeNotifyIdentity(notif.targetUsername);

  // Global broadcast notification (no targeting fields set)
  if (!targetName && !targetCode && !targetUser) {
    return true;
  }

  if (!user) return false;

  const myName = normalizeNotifyIdentity(user.name);
  const myDelName = normalizeNotifyIdentity(user.delegateName);
  const myCode = normalizeNotifyIdentity(user.delegateCode);
  const myUser = normalizeNotifyIdentity(user.username);

  if (targetUser && myUser && targetUser === myUser) return true;
  if (targetCode && myCode && targetCode === myCode) return true;
  if (targetName && ((myName && targetName === myName) || (myDelName && targetName === myDelName))) {
    return true;
  }

  return false;
};
