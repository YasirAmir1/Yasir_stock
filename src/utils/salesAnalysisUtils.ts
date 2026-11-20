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
