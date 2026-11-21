import { SalesEntry } from '../types';
import { getInvoiceKey } from './numberUtils';
import { normalizeArabicText } from '../context/SalesContext';

export interface DelegateInvoiceAnalysisMetrics {
  todayCount: number;
  lastHourCount: number;
  lastInvoiceTimestamp: number | null;
}

export function parseEntryTimestamp(entry: SalesEntry): number {
  const raw: unknown = entry.timestamp;
  if (typeof raw === 'number' && !Number.isNaN(raw) && raw > 0) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { toMillis?: () => number; seconds?: number };
    if (typeof obj.toMillis === 'function') {
      const ms = obj.toMillis();
      if (ms > 0) return ms;
    }
    if (typeof obj.seconds === 'number' && obj.seconds > 0) {
      return obj.seconds * 1000;
    }
  }
  if (typeof raw === 'string' && raw.trim()) {
    const num = Number(raw);
    if (!Number.isNaN(num) && num > 0) return num;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  if (entry.invoiceId && /^\d{13}_/.test(String(entry.invoiceId))) {
    const prefixTs = Number(String(entry.invoiceId).split('_')[0]);
    if (!Number.isNaN(prefixTs) && prefixTs > 0) return prefixTs;
  }
  return 0;
}

export function isEntryValid(entry?: SalesEntry | null): boolean {
  if (!entry) return false;
  if (entry.status === 'cancelled') return false;
  return true;
}

/**
 * Unified sales analysis function to compute and compare invoice counts
 * across HeaderDelegateActivityBar (last hour & today) and Report11Screen,
 * strictly verifying timestamp, isCancelled status, and delegate identifiers.
 */
export function computeUnifiedDelegateInvoiceStats(
  entries: SalesEntry[],
  delegatesList: string[],
  selectedDate: string,
  nowMs: number = Date.now(),
  hourWindowMs: number = 60 * 60 * 1000
): Record<string, DelegateInvoiceAnalysisMetrics> {
  const cutoffMs = nowMs - hourWindowMs;
  const upperBoundMs = nowMs + 120000; // 2 minutes drift tolerance

  const result: Record<string, DelegateInvoiceAnalysisMetrics> = {};

  delegatesList.forEach((del) => {
    result[del.trim()] = {
      todayCount: 0,
      lastHourCount: 0,
      lastInvoiceTimestamp: null,
    };
  });

  const todayEntriesByDel = new Map<string, Set<string>>();
  const lastHourEntriesByDel = new Map<string, Set<string>>();
  const lastTsByDel = new Map<string, number>();

  delegatesList.forEach((del) => {
    todayEntriesByDel.set(del.trim(), new Set<string>());
    lastHourEntriesByDel.set(del.trim(), new Set<string>());
  });

  entries.forEach((entry) => {
    if (!isEntryValid(entry)) return;
    if (entry.dateString && entry.dateString !== selectedDate) return;

    const delName = (entry.delegateName || '').trim();
    const matchedDel =
      delegatesList.find(
        (d) => normalizeArabicText(d) === normalizeArabicText(delName)
      ) || delName;

    if (!matchedDel || !delegatesList.includes(matchedDel)) return;

    const invKey = getInvoiceKey(entry) || entry.id;
    if (!invKey) return;

    const ts = parseEntryTimestamp(entry);

    // Today total unique invoices
    todayEntriesByDel.get(matchedDel)?.add(invKey);

    // Last hour unique invoices
    if (ts >= cutoffMs && ts <= upperBoundMs) {
      lastHourEntriesByDel.get(matchedDel)?.add(invKey);
    }

    const currentLast = lastTsByDel.get(matchedDel) || 0;
    if (ts > currentLast) {
      lastTsByDel.set(matchedDel, ts);
    }
  });

  delegatesList.forEach((del) => {
    const clean = del.trim();
    result[clean] = {
      todayCount: todayEntriesByDel.get(clean)?.size || 0,
      lastHourCount: lastHourEntriesByDel.get(clean)?.size || 0,
      lastInvoiceTimestamp: lastTsByDel.get(clean) || null,
    };
  });

  return result;
}

export function parseUnsuccessfulVisitTimestamp(visit: {
  timestamp?: unknown;
  createdAt?: unknown;
}): number {
  const rawTs = visit.timestamp;
  if (typeof rawTs === 'number' && !Number.isNaN(rawTs) && rawTs > 0) {
    return rawTs;
  }
  if (rawTs && typeof rawTs === 'object') {
    const obj = rawTs as { toMillis?: () => number; seconds?: number };
    if (typeof obj.toMillis === 'function') {
      const ms = obj.toMillis();
      if (ms > 0) return ms;
    }
    if (typeof obj.seconds === 'number' && obj.seconds > 0) {
      return obj.seconds * 1000;
    }
  }
  const rawCreated = visit.createdAt;
  if (typeof rawCreated === 'string' && rawCreated.trim()) {
    const parsed = Date.parse(rawCreated);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  if (rawCreated && typeof rawCreated === 'object') {
    const obj = rawCreated as { toMillis?: () => number; seconds?: number };
    if (typeof obj.toMillis === 'function') {
      const ms = obj.toMillis();
      if (ms > 0) return ms;
    }
    if (typeof obj.seconds === 'number' && obj.seconds > 0) {
      return obj.seconds * 1000;
    }
  }
  return 0;
}

export function doesDelegateMatchIdentifier(
  candidateName?: string | null,
  candidateCode?: string | null,
  targetName?: string | null,
  targetCode?: string | null
): boolean {
  const cCode = String(candidateCode || '').trim().toLowerCase();
  const tCode = String(targetCode || '').trim().toLowerCase();
  if (cCode && tCode && cCode === tCode) return true;

  const cNorm = normalizeArabicText(String(candidateName || '').trim());
  const tNorm = normalizeArabicText(String(targetName || '').trim());
  if (!cNorm || !tNorm) return false;
  if (cNorm === tNorm) return true;
  if (cNorm.length >= 3 && tNorm.length >= 3) {
    return cNorm.includes(tNorm) || tNorm.includes(cNorm);
  }
  return false;
}

export function hasDelegateRecordedVisitInLastHour(params: {
  delegateName?: string | null;
  delegateCode?: string | null;
  salesEntries: SalesEntry[];
  unsuccessfulVisits?: Array<{
    delegateName?: string;
    delegateCode?: string;
    timestamp?: unknown;
    createdAt?: unknown;
  }>;
  nowMs?: number;
  windowMs?: number;
}): { hasRecentVisit: boolean; recentVisitCount: number; lastVisitTs: number | null } {
  const nowMs = params.nowMs ?? Date.now();
  const windowMs = params.windowMs ?? 60 * 60 * 1000;
  const cutoffMs = nowMs - windowMs;
  const upperBoundMs = nowMs + 120000;

  let recentVisitCount = 0;
  let lastVisitTs = 0;
  const seenKeys = new Set<string>();

  params.salesEntries.forEach((entry) => {
    if (!isEntryValid(entry)) return;
    if (
      !doesDelegateMatchIdentifier(
        entry.delegateName,
        undefined,
        params.delegateName,
        params.delegateCode
      )
    ) {
      return;
    }
    const ts = parseEntryTimestamp(entry);
    if (ts > lastVisitTs) lastVisitTs = ts;
    if (ts >= cutoffMs && ts <= upperBoundMs) {
      const key = getInvoiceKey(entry) || entry.id || `${ts}`;
      if (!seenKeys.has(`inv:${key}`)) {
        seenKeys.add(`inv:${key}`);
        recentVisitCount += 1;
      }
    }
  });

  (params.unsuccessfulVisits || []).forEach((visit, idx) => {
    if (
      !doesDelegateMatchIdentifier(
        visit.delegateName,
        visit.delegateCode,
        params.delegateName,
        params.delegateCode
      )
    ) {
      return;
    }
    const ts = parseUnsuccessfulVisitTimestamp(visit);
    if (ts > lastVisitTs) lastVisitTs = ts;
    if (ts >= cutoffMs && ts <= upperBoundMs) {
      const key = `${ts}_${idx}`;
      if (!seenKeys.has(`uv:${key}`)) {
        seenKeys.add(`uv:${key}`);
        recentVisitCount += 1;
      }
    }
  });

  return {
    hasRecentVisit: recentVisitCount > 0,
    recentVisitCount,
    lastVisitTs: lastVisitTs > 0 ? lastVisitTs : null,
  };
}

