import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where, writeBatch, DocumentReference } from 'firebase/firestore';
import { db } from './firebase';
import { cleanFirestoreData, logFirestoreErrorGracefully, safeOnSnapshot } from './firestoreUtils';
import { supabase } from '../supabaseClient';
import { RepLiveLocation, RouteItem, SalesEntry, UserAccount } from '../types';

export type GpsTrackingStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';
export const GPS_STATUS_EVENT = 'rep-gps-status-changed';
export const GPS_RETRY_REQUEST_EVENT = 'rep-gps-retry-request';
export const REP_TRAIL_UPDATED_EVENT = 'rep-gps-trail-updated';
export const REP_COORDS_EVENT = 'rep-gps-coords-changed';
export const OPEN_SHOP_ACTION_MODAL_EVENT = 'open-shop-action-modal';

export interface RepLiveCoords {
  latitude: number;
  longitude: number;
  updatedAt: number;
}

const SHOP_COORDS_CACHE_KEY = 'saladin_shop_coords_cache_v1';
const REP_TRAIL_STORAGE_PREFIX = 'saladin_rep_trail_v1_';

export const getRepTrailPoints = (repId: string): Array<[number, number]> => {
  if (typeof window === 'undefined' || !repId) return [];
  try {
    const todayIso = new Date().toISOString().split('T')[0];
    const raw = window.localStorage.getItem(`${REP_TRAIL_STORAGE_PREFIX}${todayIso}_${repId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (pt): pt is [number, number] =>
        Array.isArray(pt) && pt.length === 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
    );
  } catch {
    return [];
  }
};

export const appendRepTrailPoint = (
  repId: string,
  latitude: number,
  longitude: number
): void => {
  if (typeof window === 'undefined' || !repId) return;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) return;
  try {
    const todayIso = new Date().toISOString().split('T')[0];
    const storageKey = `${REP_TRAIL_STORAGE_PREFIX}${todayIso}_${repId}`;
    const current = getRepTrailPoints(repId);
    const lat = Number(latitude.toFixed(6));
    const lng = Number(longitude.toFixed(6));

    if (current.length > 0) {
      const [lastLat, lastLng] = current[current.length - 1];
      // Only append if moved at least ~25 meters to keep local storage tiny
      const dLat = Math.abs(lat - lastLat);
      const dLng = Math.abs(lng - lastLng);
      if (dLat < 0.00022 && dLng < 0.00022) return;
    }

    const next = [...current, [lat, lng] as [number, number]].slice(-500);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(REP_TRAIL_UPDATED_EVENT, { detail: { repId } }));
  } catch {
    // Ignore storage quota/privacy mode errors
  }
};

export interface CachedShopCoord {
  latitude: number;
  longitude: number;
  updatedAt: number;
}

export const dispatchGpsTrackingStatus = (status: GpsTrackingStatus) => {
  if (typeof window === 'undefined') return;
  (window as any).__repGpsTrackingStatus = status;
  window.dispatchEvent(new CustomEvent(GPS_STATUS_EVENT, { detail: { status } }));
};

export const getLastKnownGpsTrackingStatus = (): GpsTrackingStatus => {
  if (typeof window === 'undefined') return 'idle';
  return ((window as any).__repGpsTrackingStatus as GpsTrackingStatus) || 'idle';
};

export const dispatchRepLiveCoords = (coords: { latitude: number; longitude: number } | null) => {
  if (typeof window === 'undefined') return;
  const payload: RepLiveCoords | null =
    coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)
      ? { latitude: coords.latitude, longitude: coords.longitude, updatedAt: Date.now() }
      : null;
  (window as any).__repLatestCoords = payload;
  window.dispatchEvent(new CustomEvent(REP_COORDS_EVENT, { detail: { coords: payload } }));
};

export const getLastKnownRepCoords = (): RepLiveCoords | null => {
  if (typeof window === 'undefined') return null;
  return ((window as any).__repLatestCoords as RepLiveCoords | null) || null;
};

export const queueOpenShopActionModal = (route: RouteItem) => {
  if (typeof window === 'undefined') return;
  (window as any).__pendingShopActionRoute = route;
  window.dispatchEvent(new CustomEvent(OPEN_SHOP_ACTION_MODAL_EVENT, { detail: { route } }));
};

export const consumePendingShopActionRoute = (): RouteItem | null => {
  if (typeof window === 'undefined') return null;
  const pending = (window as any).__pendingShopActionRoute as RouteItem | null;
  (window as any).__pendingShopActionRoute = null;
  return pending || null;
};

/**
 * Cache static shop coordinates locally in localStorage to preserve cellular data & battery
 */
export const getCachedShopCoordinates = (): Record<string, CachedShopCoord> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SHOP_COORDS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const cacheShopCoordinatesLocally = (routesList: RouteItem[]): void => {
  if (typeof window === 'undefined' || !Array.isArray(routesList) || routesList.length === 0) return;
  try {
    const existing = getCachedShopCoordinates();
    let changed = false;
    const now = Date.now();
    for (const r of routesList) {
      const lat = parseCoordinate(r.latitude);
      const lng = parseCoordinate(r.longitude);
      const candidateKeys = [String(r.customerCode || '').trim(), String(r.id || '').trim()].filter(Boolean);
      if (candidateKeys.length === 0) continue;

      if (lat === null || lng === null) {
        const clearedAt = Number(r.locationClearedAt) || 0;
        if (clearedAt > 0) {
          for (const k of candidateKeys) {
            const cached = existing[k];
            if (cached && (!cached.updatedAt || cached.updatedAt <= clearedAt)) {
              delete existing[k];
              changed = true;
            }
          }
        }
        continue;
      }

      const key = candidateKeys[0];
      const prev = existing[key];
      if (!prev || prev.latitude !== lat || prev.longitude !== lng) {
        existing[key] = { latitude: lat, longitude: lng, updatedAt: now };
        changed = true;
      }
    }
    if (changed) {
      window.localStorage.setItem(SHOP_COORDS_CACHE_KEY, JSON.stringify(existing));
    }
  } catch {
    // Ignore localStorage quota/privacy mode errors
  }
};

export const removeCachedShopCoordinates = (route: Pick<RouteItem, 'id' | 'customerCode'>): void => {
  if (typeof window === 'undefined') return;
  try {
    const existing = getCachedShopCoordinates();
    let changed = false;
    const candidateKeys = [String(route.customerCode || '').trim(), String(route.id || '').trim()].filter(Boolean);
    for (const k of candidateKeys) {
      if (k in existing) {
        delete existing[k];
        changed = true;
      }
    }
    if (changed) {
      window.localStorage.setItem(SHOP_COORDS_CACHE_KEY, JSON.stringify(existing));
    }
  } catch {
    // Ignore localStorage errors
  }
};

export const resolveRouteCoordinatesWithCache = (
  route: RouteItem,
  cachedMap?: Record<string, CachedShopCoord>
): { latitude: number | null; longitude: number | null } => {
  const directLat = parseCoordinate(route.latitude);
  const directLng = parseCoordinate(route.longitude);
  if (directLat !== null && directLng !== null) {
    return { latitude: directLat, longitude: directLng };
  }
  const cache = cachedMap || getCachedShopCoordinates();
  const key = String(route.customerCode || route.id || '').trim();
  const hit = key ? cache[key] : undefined;
  const clearedAt = Number(route.locationClearedAt) || 0;
  if (clearedAt > 0 && (!hit?.updatedAt || hit.updatedAt <= clearedAt)) {
    return { latitude: null, longitude: null };
  }
  if (hit && Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)) {
    return { latitude: hit.latitude, longitude: hit.longitude };
  }
  return { latitude: null, longitude: null };
};

export type CustomerTier = 'gold' | 'silver' | 'bronze';

/**
 * Determine Customer Tier (Gold / Silver / Bronze) from explicit tier or sales volume
 */
export const computeCustomerTier = (
  route: RouteItem,
  salesEntries: SalesEntry[]
): { tier: CustomerTier; labelAr: string; totalWeightKg: number } => {
  if (route.tier === 'gold') return { tier: 'gold', labelAr: 'ذهبي', totalWeightKg: 0 };
  if (route.tier === 'silver') return { tier: 'silver', labelAr: 'فضي', totalWeightKg: 0 };
  if (route.tier === 'bronze') return { tier: 'bronze', labelAr: 'برونزي', totalWeightKg: 0 };

  const code = String(route.customerCode || '').trim();
  const normName = normalizeTrackingText(route.customerName);
  let totalWeightKg = 0;

  for (const e of salesEntries) {
    if (e.status === 'cancelled') continue;
    const matchCode = code && String(e.customerCode || '').trim() === code;
    const matchName = !matchCode && normName && normalizeTrackingText(e.customerName) === normName;
    if (matchCode || matchName) {
      totalWeightKg += Number(e.totalWeightKg) || 0;
    }
  }

  const isWholesale = route.customerType === 'جملة';
  if (totalWeightKg >= 200 || (isWholesale && totalWeightKg >= 120)) {
    return { tier: 'gold', labelAr: 'ذهبي', totalWeightKg };
  }
  if (totalWeightKg >= 50 || isWholesale) {
    return { tier: 'silver', labelAr: 'فضي', totalWeightKg };
  }
  return { tier: 'bronze', labelAr: 'برونزي', totalWeightKg };
};

/**
 * Haversine distance in meters between two WGS84 coordinates (zero network overhead, pure local math).
 */
export const calculateHaversineDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Normalize Arabic strings for route/delegate matching
 */
export const normalizeTrackingText = (text?: string | null): string => {
  if (!text) return '';
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ');
};

/**
 * Active Baghdad route day (switches to tomorrow's route at 6:00 PM Asia/Baghdad time)
 */
export const getActiveBaghdadRouteDay = (nowDate: Date = new Date()): string => {
  try {
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Baghdad',
      hour12: false,
      hour: 'numeric',
      minute: 'numeric',
    });
    const parts = timeFormatter.formatToParts(nowDate);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const isPast6PM = hour > 18 || (hour === 18 && minute >= 0);

    const targetDate = isPast6PM
      ? new Date(nowDate.getTime() + 24 * 60 * 60 * 1000)
      : nowDate;
    return new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(targetDate);
  } catch {
    return new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(nowDate);
  }
};

/**
 * Deterministic tracking ID per representative for single-row UPSERT in rep_live_locations
 */
export const getRepTrackingId = (user?: Partial<UserAccount> | null, fallbackName?: string): string => {
  const code = String(user?.delegateCode || '').trim();
  if (code) return code;
  const username = String(user?.username || '').trim().toLowerCase();
  if (username) return username.replace(/[^a-z0-9_-]/g, '_');
  const rawName = String(user?.name || fallbackName || 'rep').trim();
  return `rep_${normalizeTrackingText(rawName).replace(/\s+/g, '_')}`;
};

/**
 * Parse numeric GPS coordinate safely
 */
export const parseCoordinate = (val: unknown): number | null => {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : Number(String(val).trim().replace(',', '.'));
  if (!Number.isFinite(num) || num === 0) return null;
  return num;
};

/**
 * Check if a representative user is a field rep (not Admin / Data Entry / Sauce Viewer)
 */
export const isFieldRepresentativeUser = (user?: Partial<UserAccount> | null): boolean => {
  if (!user) return false;
  const lowerUser = String(user.username || '').toLowerCase();
  const isRafat =
    lowerUser === 'rafatdata' ||
    user.role === 'dataEntry' ||
    user.name === 'رأفت جمال' ||
    user.delegateName === 'رأفت جمال';
  const isSauce =
    lowerUser === 'mohammedsauce' ||
    user.role === 'sauceOnly' ||
    user.role === 'viewer' ||
    user.name === 'محمد الصلصات' ||
    user.delegateName === 'محمد الصلصات';
  if (user.isAdmin || user.role === 'admin' || user.name === 'الأدمن' || isRafat || isSauce) {
    return false;
  }
  return true;
};

/**
 * UPSERT representative's live location (single row per rep in both Supabase & Firestore)
 */
export const upsertRepLiveLocation = async (params: {
  repId: string;
  repName: string;
  delegateCode?: string;
  latitude: number;
  longitude: number;
  isActive?: boolean;
}): Promise<void> => {
  const nowIso = new Date().toISOString();
  const isActive = params.isActive !== false;
  const payload: RepLiveLocation = {
    rep_id: params.repId,
    rep_name: params.repName,
    delegate_code: params.delegateCode || '',
    latitude: params.latitude,
    longitude: params.longitude,
    is_active: isActive,
    updated_at: nowIso,
  };

  // 1. Firestore single-doc UPSERT
  try {
    await setDoc(doc(db, 'rep_live_locations', params.repId), cleanFirestoreData(payload), { merge: true });
  } catch (err) {
    logFirestoreErrorGracefully(err, 'upsertRepLiveLocation Firestore');
  }

  // 2. Supabase single-row UPSERT
  try {
    const { error } = await supabase
      .from('rep_live_locations')
      .upsert(
        {
          rep_id: params.repId,
          rep_name: params.repName,
          delegate_code: params.delegateCode || null,
          latitude: params.latitude,
          longitude: params.longitude,
          is_active: isActive,
          updated_at: nowIso,
        },
        { onConflict: 'rep_id' }
      );

    // If FK constraint on representatives(id) blocks direct upsert, ensure rep row exists first then retry
    if (error && (error.code === '23503' || error.message?.includes('foreign key'))) {
      await supabase
        .from('representatives')
        .upsert(
          {
            id: params.repId,
            name: params.repName,
            delegate_code: params.delegateCode || params.repId,
          },
          { onConflict: 'id' }
        );
      await supabase
        .from('rep_live_locations')
        .upsert(
          {
            rep_id: params.repId,
            rep_name: params.repName,
            delegate_code: params.delegateCode || null,
            latitude: params.latitude,
            longitude: params.longitude,
            is_active: isActive,
            updated_at: nowIso,
          },
          { onConflict: 'rep_id' }
        );
    }
  } catch {
    // Non-blocking fallback: Firestore listener keeps Admin map synchronized
  }
};

/**
 * Mark representative inactive in rep_live_locations (immediately hides their live pin on Admin map)
 */
export const deactivateRepLiveLocation = async (
  repId?: string | null,
  repName?: string | null
): Promise<void> => {
  const cleanId = String(repId || '').trim();
  const cleanName = String(repName || '').trim();
  if (!cleanId && !cleanName) return;

  const nowIso = new Date().toISOString();
  const candidateIds = new Set<string>();
  if (cleanId) candidateIds.add(cleanId);
  if (cleanName) {
    candidateIds.add(getRepTrackingId({ name: cleanName }, cleanName));
  }

  // 1. Update Firestore
  try {
    for (const id of candidateIds) {
      await setDoc(
        doc(db, 'rep_live_locations', id),
        cleanFirestoreData({
          rep_id: id,
          rep_name: cleanName || id,
          is_active: false,
          updated_at: nowIso,
        }),
        { merge: true }
      );
    }
    if (cleanName) {
      const byNameSnap = await getDocs(
        query(collection(db, 'rep_live_locations'), where('rep_name', '==', cleanName))
      );
      for (const docSnap of byNameSnap.docs) {
        await updateDoc(docSnap.ref, { is_active: false, updated_at: nowIso });
      }
    }
  } catch (err) {
    logFirestoreErrorGracefully(err, 'deactivateRepLiveLocation Firestore');
  }

  // 2. Update Supabase
  try {
    for (const id of candidateIds) {
      await supabase
        .from('rep_live_locations')
        .update({ is_active: false, updated_at: nowIso })
        .eq('rep_id', id);
    }
    if (cleanName) {
      await supabase
        .from('rep_live_locations')
        .update({ is_active: false, updated_at: nowIso })
        .eq('rep_name', cleanName);
    }
  } catch {
    // Silent fallback
  }
};

/**
 * Subscribe to active representative live locations (is_active = true) from both Firestore and Supabase Realtime
 */
export const subscribeToRepLiveLocations = (
  onLocations: (locations: RepLiveLocation[]) => void
): (() => void) => {
  const mergedMap = new Map<string, RepLiveLocation>();

  const emitActive = () => {
    const activeList = Array.from(mergedMap.values()).filter(
      (loc) =>
        loc.is_active === true &&
        Number.isFinite(loc.latitude) &&
        Number.isFinite(loc.longitude) &&
        loc.latitude !== 0 &&
        loc.longitude !== 0
    );
    onLocations(activeList);
  };

  const applyRow = (row: Partial<RepLiveLocation> | null | undefined) => {
    if (!row || !row.rep_id) return;
    if (row.is_active === false) {
      mergedMap.delete(row.rep_id);
      return;
    }
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const existing = mergedMap.get(row.rep_id);
    const incomingTime = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const existingTime = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;

    if (!existing || incomingTime >= existingTime) {
      mergedMap.set(row.rep_id, {
        rep_id: row.rep_id,
        rep_name: row.rep_name || existing?.rep_name || row.rep_id,
        delegate_code: row.delegate_code || existing?.delegate_code || '',
        latitude: lat,
        longitude: lng,
        is_active: true,
        updated_at: row.updated_at || new Date().toISOString(),
      });
    }
  };

  // 1. Firestore real-time snapshot
  const unsubFirestore = safeOnSnapshot(
    query(collection(db, 'rep_live_locations')),
    (snap: any) => {
      const firestoreIds = new Set<string>();
      snap.forEach((d: any) => {
        const data = d.data() || {};
        const repId = String(data.rep_id || d.id);
        firestoreIds.add(repId);
        if (data.is_active === false) {
          mergedMap.delete(repId);
        } else {
          applyRow({ ...data, rep_id: repId });
        }
      });
      emitActive();
    },
    (err: any) => {
      logFirestoreErrorGracefully(err, 'rep_live_locations listener');
    },
    'FleetMap-rep-live-locations'
  );

  // 2. Supabase initial fetch + Realtime channel
  let supabaseChannel: ReturnType<typeof supabase.channel> | null = null;
  (async () => {
    try {
      const { data } = await supabase
        .from('rep_live_locations')
        .select('*')
        .eq('is_active', true);
      if (Array.isArray(data)) {
        data.forEach((row) => applyRow(row as RepLiveLocation));
        emitActive();
      }

      supabaseChannel = supabase
        .channel('rep_live_locations_realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rep_live_locations' },
          (payload) => {
            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as any)?.rep_id;
              if (oldId) mergedMap.delete(String(oldId));
            } else {
              applyRow(payload.new as RepLiveLocation);
            }
            emitActive();
          }
        )
        .subscribe();
    } catch {
      // Supabase table optional if Firestore is active
    }
  })();

  return () => {
    unsubFirestore();
    if (supabaseChannel) {
      supabase.removeChannel(supabaseChannel);
    }
  };
};

/**
 * Safely resolve Firestore DocumentReference for a RouteItem
 */
const resolveRouteDocRef = async (route: RouteItem): Promise<{ ref: DocumentReference; exists: boolean }> => {
  if (route.id) {
    const directRef = doc(db, 'routes', route.id);
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) {
      return { ref: directRef, exists: true };
    }

    const byFieldIdSnap = await getDocs(query(collection(db, 'routes'), where('id', '==', route.id), limit(1)));
    if (!byFieldIdSnap.empty) {
      return { ref: byFieldIdSnap.docs[0].ref, exists: true };
    }
  }

  if (route.customerCode) {
    const byCodeSnap = await getDocs(query(collection(db, 'routes'), where('customerCode', '==', route.customerCode)));
    if (!byCodeSnap.empty) {
      const matched =
        byCodeSnap.docs.find((d) => {
          const data = d.data();
          return String(data.customerName || '').trim() === String(route.customerName || '').trim();
        }) || byCodeSnap.docs[0];
      return { ref: matched.ref, exists: true };
    }
  }

  return { ref: doc(db, 'routes', route.id || `route_${Date.now()}`), exists: false };
};

/**
 * Save/Update GPS coordinates (latitude, longitude) for a customer shop in Firestore `routes` and Supabase `customers`
 */
export const saveCustomerCoordinates = async (
  route: RouteItem,
  latitude: number,
  longitude: number,
  updatedBy?: string,
  extraFields?: Record<string, unknown>
): Promise<{ success: boolean; message: string }> => {
  try {
    const normalizedLat = Number(latitude.toFixed(6));
    const normalizedLng = Number(longitude.toFixed(6));
    const shopLocation = formatShopLocationString(normalizedLat, normalizedLng);

    const payload = cleanFirestoreData({
      latitude: normalizedLat,
      longitude: normalizedLng,
      shopLocation,
      locationClearedAt: 0,
      updatedAt: Date.now(),
      updatedBy: updatedBy || 'المستخدم',
      ...(extraFields || {}),
    });

    const { ref, exists } = await resolveRouteDocRef(route);
    if (exists) {
      await updateDoc(ref, { ...payload, id: ref.id });
    } else {
      await setDoc(ref, cleanFirestoreData({ ...route, ...payload, id: ref.id }), { merge: true });
    }

    // Ensure ALL route documents sharing the same customerCode receive the pinned coordinates & extraFields
    const cleanCustomerCode = String(route.customerCode || '').trim();
    if (cleanCustomerCode) {
      try {
        const allCodeSnap = await getDocs(
          query(collection(db, 'routes'), where('customerCode', '==', cleanCustomerCode))
        );
        for (const d of allCodeSnap.docs) {
          if (d.id !== ref.id) {
            await updateDoc(d.ref, payload);
          }
        }
      } catch {
        // Non-blocking secondary route sync
      }
    }

    // Immediately persist in local shop coordinate cache
    cacheShopCoordinatesLocally([
      {
        ...route,
        id: ref.id,
        latitude: normalizedLat,
        longitude: normalizedLng,
        shopLocation,
      },
    ]);

    // Mirror updates to any matching documents in Firestore `rep_shop_locations` (non-blocking)
    try {
      const updatedIso = new Date().toISOString();
      const locUpdatePayload = cleanFirestoreData({
        latitude: normalizedLat,
        longitude: normalizedLng,
        shopLocation,
        updatedAt: updatedIso,
        updatedBy: updatedBy || 'الأدمن',
      });
      const updatedLocIds = new Set<string>();
      const cleanCode = String(route.customerCode || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanRouteId = String(route.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const candidateIds = [
        cleanCode ? `cust_${cleanCode}` : '',
        cleanRouteId ? `route_${cleanRouteId}` : '',
      ].filter(Boolean);

      for (const candId of candidateIds) {
        const candRef = doc(db, 'rep_shop_locations', candId);
        const candSnap = await getDoc(candRef);
        if (candSnap.exists()) {
          await updateDoc(candRef, locUpdatePayload);
          updatedLocIds.add(candId);
        }
      }

      if (route.customerCode) {
        const byCodeLocs = await getDocs(
          query(collection(db, 'rep_shop_locations'), where('customerCode', '==', String(route.customerCode).trim()))
        );
        for (const d of byCodeLocs.docs) {
          if (!updatedLocIds.has(d.id)) {
            await updateDoc(d.ref, locUpdatePayload);
            updatedLocIds.add(d.id);
          }
        }
      }

      if (route.id) {
        const byRouteLocs = await getDocs(
          query(collection(db, 'rep_shop_locations'), where('routeId', '==', route.id))
        );
        for (const d of byRouteLocs.docs) {
          if (!updatedLocIds.has(d.id)) {
            await updateDoc(d.ref, locUpdatePayload);
            updatedLocIds.add(d.id);
          }
        }
      }
    } catch {
      // Non-blocking sync to rep_shop_locations
    }

    // Mirror to Supabase customers table (non-blocking)
    try {
      const custId = route.customerCode || ref.id;
      await supabase.from('customers').upsert(
        {
          id: custId,
          customer_code: route.customerCode || custId,
          customer_name: route.customerName,
          customer_address: route.customerAddress || '',
          customer_phone: route.customerPhone || '',
          customer_type: route.customerType || 'مفرد',
          delegate_name: route.delegateName || '',
          delegate_code: route.delegateCode || '',
          path: route.path || '',
          latitude,
          longitude,
          visited_today: Boolean(route.visitedToday),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    } catch {
      // Silent fallback
    }

    return {
      success: true,
      message: `تم حفظ إحداثيات موقع المحل (${route.customerName}) بنجاح 📍✅`,
    };
  } catch (err: any) {
    console.error('Error saving customer coordinates:', err);
    return {
      success: false,
      message: err?.message || 'حدث خطأ أثناء حفظ إحداثيات المحل',
    };
  }
};

/**
 * Clear/Delete saved GPS coordinates for a customer shop across `routes`, `rep_shop_locations`, localStorage cache, and Supabase
 * so representatives can re-capture the shop's location inside Shop Actions ("3- موقع المحل").
 */
export const deleteCustomerCoordinates = async (
  route: RouteItem,
  deletedBy?: string
): Promise<{ success: boolean; message: string; clearedAt: number }> => {
  const clearedAt = Date.now();
  try {
    const clearPayload = {
      latitude: null,
      longitude: null,
      shopLocation: '',
      repLocationSaved: false,
      locationClearedAt: clearedAt,
      updatedAt: clearedAt,
      updatedBy: deletedBy || 'الأدمن',
    };

    const { ref, exists } = await resolveRouteDocRef(route);
    if (exists) {
      await updateDoc(ref, clearPayload);
    }

    // Clear coordinates on ALL route documents sharing the same customerCode
    const cleanCustomerCode = String(route.customerCode || '').trim();
    if (cleanCustomerCode) {
      try {
        const allCodeSnap = await getDocs(
          query(collection(db, 'routes'), where('customerCode', '==', cleanCustomerCode))
        );
        for (const d of allCodeSnap.docs) {
          if (d.id !== ref.id) {
            await updateDoc(d.ref, clearPayload);
          }
        }
      } catch {
        // Non-blocking secondary route sync
      }
    }

    // Delete any matching records from Firestore `rep_shop_locations`
    try {
      const deletedIds = new Set<string>();
      const cleanCodeKey = cleanCustomerCode.replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanRouteKey = String(route.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const candidateIds = [
        cleanCodeKey ? `cust_${cleanCodeKey}` : '',
        cleanRouteKey ? `route_${cleanRouteKey}` : '',
      ].filter(Boolean);

      for (const candId of candidateIds) {
        const candRef = doc(db, 'rep_shop_locations', candId);
        const candSnap = await getDoc(candRef);
        if (candSnap.exists()) {
          await deleteDoc(candRef);
          deletedIds.add(candId);
        }
      }

      if (cleanCustomerCode) {
        const byCodeLocs = await getDocs(
          query(collection(db, 'rep_shop_locations'), where('customerCode', '==', cleanCustomerCode))
        );
        for (const d of byCodeLocs.docs) {
          if (!deletedIds.has(d.id)) {
            await deleteDoc(d.ref);
            deletedIds.add(d.id);
          }
        }
      }

      if (route.id) {
        const byRouteLocs = await getDocs(
          query(collection(db, 'rep_shop_locations'), where('routeId', '==', route.id))
        );
        for (const d of byRouteLocs.docs) {
          if (!deletedIds.has(d.id)) {
            await deleteDoc(d.ref);
            deletedIds.add(d.id);
          }
        }
      }
    } catch {
      // Non-blocking cleanup of rep_shop_locations
    }

    // Clear local shop coordinate cache immediately
    removeCachedShopCoordinates(route);

    // Clear Supabase customers mirror coordinates (non-blocking)
    try {
      const custId = cleanCustomerCode || ref.id;
      await supabase
        .from('customers')
        .update({
          latitude: null,
          longitude: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', custId);
    } catch {
      // Silent fallback
    }

    return {
      success: true,
      clearedAt,
      message: `تم حذف موقع المحل (${route.customerName}) بنجاح — يمكن للمندوب الآن إضافة موقعه من جديد في إجراءات المحل.`,
    };
  } catch (err: any) {
    console.error('Error deleting customer coordinates:', err);
    return {
      success: false,
      clearedAt,
      message: err?.message || 'حدث خطأ أثناء حذف موقع المحل',
    };
  }
};

/**
 * Update Supabase `customers.visited_today = true` and route status when an invoice is saved
 */
export const markCustomerVisitedToday = async (
  customerCode?: string,
  customerName?: string
): Promise<void> => {
  const code = String(customerCode || '').trim();
  if (!code && !customerName) return;

  try {
    if (code) {
      await supabase
        .from('customers')
        .update({ visited_today: true, updated_at: new Date().toISOString() })
        .or(`customer_code.eq.${code},id.eq.${code}`);
    } else if (customerName) {
      await supabase
        .from('customers')
        .update({ visited_today: true, updated_at: new Date().toISOString() })
        .eq('customer_name', customerName.trim());
    }
  } catch {
    // Non-blocking: live green pin status also resolves from today's salesEntries in real-time
  }
};

/**
 * Parse a single Excel cell or user input representing a shop's location:
 * Supports "34.6158, 43.6786", "34.6158، 43.6786", "34.6158 / 43.6786", or Google Maps links (@lat,lng, ?q=lat,lng, !3dlat!4dlng, /search/lat,lng, geo:lat,lng)
 */
export const parseShopLocationString = (
  input: unknown
): { latitude: number | null; longitude: number | null } => {
  if (input === null || input === undefined) return { latitude: null, longitude: null };
  let raw = String(input)
    .trim()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/،/g, ',');

  if (!raw) return { latitude: null, longitude: null };

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw.replace(/%2C/gi, ',').replace(/%2B/gi, '+');
  }

  const validatePair = (latVal: number, lngVal: number) => {
    if (
      Number.isFinite(latVal) &&
      Number.isFinite(lngVal) &&
      latVal !== 0 &&
      lngVal !== 0 &&
      latVal >= -90 &&
      latVal <= 90 &&
      lngVal >= -180 &&
      lngVal <= 180
    ) {
      return { latitude: Number(latVal.toFixed(6)), longitude: Number(lngVal.toFixed(6)) };
    }
    return { latitude: null, longitude: null };
  };

  // 1. Check Google Maps !3dLAT!4dLNG exact pin pattern
  const dataPinMatch = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataPinMatch) {
    const parsed = validatePair(Number(dataPinMatch[1]), Number(dataPinMatch[2]));
    if (parsed.latitude !== null) return parsed;
  }

  // 2. Check Google Maps @LAT,LNG, /search/LAT,LNG, /place/LAT,LNG, geo:LAT,LNG, or query params (?q=, ?ll=, ?center=, ?daddr=, ?saddr=, ?query=)
  const urlCoordMatch = decoded.match(
    /(?:@|\/maps\/search\/|\/maps\/place\/|geo:|[?&](?:q|ll|center|daddr|saddr|query)=)(-?\d+(?:\.\d+)?)\s*[,+]\s*(-?\d+(?:\.\d+)?)/i
  );
  if (urlCoordMatch) {
    const parsed = validatePair(Number(urlCoordMatch[1]), Number(urlCoordMatch[2]));
    if (parsed.latitude !== null) return parsed;
  }

  // 3. Plain coordinate pair (skip if input is an unresolved http URL whose path digits could confuse)
  if (!/https?:\/\//i.test(decoded)) {
    const pairMatch = decoded.match(/(-?\d+(?:\.\d+)?)\s*[,;/|\s]\s*(-?\d+(?:\.\d+)?)/);
    if (pairMatch) {
      const parsed = validatePair(Number(pairMatch[1]), Number(pairMatch[2]));
      if (parsed.latitude !== null) return parsed;
    }
  }

  return { latitude: null, longitude: null };
};

export const extractHttpUrlFromText = (input: unknown): string | null => {
  if (input === null || input === undefined) return null;
  const match = String(input).match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : null;
};

export const isShortOrExternalMapsUrl = (input: unknown): boolean => {
  const urlStr = extractHttpUrlFromText(input);
  if (!urlStr) return false;
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return (
      host === 'maps.app.goo.gl' ||
      host === 'goo.gl' ||
      host === 'g.co' ||
      host === 'maps.apple.com' ||
      /^(?:www\.|maps\.)?google\.[a-z.]{2,10}$/i.test(host)
    );
  } catch {
    return false;
  }
};

export const resolveShopLocationInput = async (
  input: unknown
): Promise<{ latitude: number | null; longitude: number | null; resolvedUrl?: string; wasResolvedFromLink?: boolean }> => {
  const syncParsed = parseShopLocationString(input);
  if (syncParsed.latitude !== null && syncParsed.longitude !== null) {
    return syncParsed;
  }

  const urlStr = extractHttpUrlFromText(input);
  if (!urlStr || !isShortOrExternalMapsUrl(urlStr)) {
    return { latitude: null, longitude: null };
  }

  try {
    const res = await fetch('/api/resolve-maps-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlStr }),
    });
    if (!res.ok) return { latitude: null, longitude: null };
    const data = await res.json();
    const lat = parseCoordinate(data?.latitude);
    const lng = parseCoordinate(data?.longitude);
    if (lat !== null && lng !== null) {
      return {
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        resolvedUrl: data?.resolvedUrl,
        wasResolvedFromLink: true,
      };
    }
  } catch {
    // Fallback gracefully
  }

  return { latitude: null, longitude: null };
};

export const resolveShopLocationInputsBatch = async (
  inputs: string[]
): Promise<Record<string, { latitude: number | null; longitude: number | null }>> => {
  const out: Record<string, { latitude: number | null; longitude: number | null }> = {};
  const urlToInputs = new Map<string, string[]>();

  for (const raw of inputs) {
    const key = String(raw || '').trim();
    if (!key) continue;
    const syncParsed = parseShopLocationString(key);
    if (syncParsed.latitude !== null && syncParsed.longitude !== null) {
      out[key] = syncParsed;
      continue;
    }
    const urlStr = extractHttpUrlFromText(key);
    if (urlStr && isShortOrExternalMapsUrl(urlStr)) {
      const list = urlToInputs.get(urlStr) || [];
      list.push(key);
      urlToInputs.set(urlStr, list);
    }
  }

  const uniqueUrls = Array.from(urlToInputs.keys());
  if (uniqueUrls.length === 0) return out;

  try {
    const res = await fetch('/api/resolve-maps-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: uniqueUrls }),
    });
    if (!res.ok) return out;
    const data = await res.json();
    const results = (data?.results || {}) as Record<
      string,
      { latitude: number | null; longitude: number | null }
    >;

    for (const [urlStr, matchedInputs] of urlToInputs.entries()) {
      const hit = results[urlStr];
      const lat = parseCoordinate(hit?.latitude);
      const lng = parseCoordinate(hit?.longitude);
      if (lat !== null && lng !== null) {
        const pair = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
        matchedInputs.forEach((origKey) => {
          out[origKey] = pair;
        });
      }
    }
  } catch {
    // Non-blocking fallback
  }

  return out;
};

/**
 * Format latitude & longitude into a clean single Excel cell value
 */
export const formatShopLocationString = (lat?: number | null, lng?: number | null): string => {
  const pLat = parseCoordinate(lat);
  const pLng = parseCoordinate(lng);
  if (pLat === null || pLng === null) return '';
  return `${pLat.toFixed(6)}, ${pLng.toFixed(6)}`;
};

/**
 * Mirror route/customer coordinates to Supabase `customers` table (non-blocking)
 */
export const syncCustomerRowsToSupabase = async (routesList: RouteItem[]): Promise<void> => {
  try {
    const withCoords = routesList.filter(
      (r) => parseCoordinate(r.latitude) !== null && parseCoordinate(r.longitude) !== null
    );
    if (withCoords.length === 0) return;

    const payload = withCoords.map((r) => ({
      id: r.customerCode || r.id,
      customer_code: r.customerCode || r.id,
      customer_name: r.customerName,
      customer_address: r.customerAddress || '',
      customer_phone: r.customerPhone || '',
      customer_type: r.customerType || 'مفرد',
      delegate_name: r.delegateName || '',
      delegate_code: r.delegateCode || '',
      path: r.path || '',
      latitude: parseCoordinate(r.latitude),
      longitude: parseCoordinate(r.longitude),
      visited_today: Boolean(r.visitedToday),
      updated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < payload.length; i += 200) {
      await supabase.from('customers').upsert(payload.slice(i, i + 200), { onConflict: 'id' });
    }
  } catch {
    // Non-blocking fallback
  }
};

/**
 * Bulk-update GPS coordinates for existing route customers from an uploaded Excel file
 * without overwriting or deleting other route records.
 */
export const bulkUpdateRouteLocations = async (
  updates: Array<{ route: RouteItem; latitude: number; longitude: number }>,
  updatedBy?: string
): Promise<number> => {
  if (updates.length === 0) return 0;

  let updatedCount = 0;
  const now = Date.now();
  const routesSnap = await getDocs(collection(db, 'routes'));
  const docById = new Map<string, DocumentReference>();
  const docByFieldId = new Map<string, DocumentReference>();
  const docsByCode = new Map<string, DocumentReference[]>();

  routesSnap.docs.forEach((d) => {
    docById.set(d.id, d.ref);
    const data = d.data();
    if (data?.id) docByFieldId.set(String(data.id), d.ref);
    if (data?.customerCode) {
      const code = String(data.customerCode).trim();
      const arr = docsByCode.get(code) || [];
      arr.push(d.ref);
      docsByCode.set(code, arr);
    }
  });

  let batch = writeBatch(db);
  let batchOps = 0;
  const supabaseRoutes: RouteItem[] = [];

  for (const item of updates) {
    const refsToUpdate = new Set<DocumentReference>();
    if (item.route.id && docById.has(item.route.id)) {
      refsToUpdate.add(docById.get(item.route.id)!);
    } else if (item.route.id && docByFieldId.has(item.route.id)) {
      refsToUpdate.add(docByFieldId.get(item.route.id)!);
    }
    const code = String(item.route.customerCode || '').trim();
    if (refsToUpdate.size === 0 && code && docsByCode.has(code)) {
      docsByCode.get(code)!.forEach((r) => refsToUpdate.add(r));
    }

    if (refsToUpdate.size === 0 && item.route.id) {
      refsToUpdate.add(doc(db, 'routes', item.route.id));
    }

    for (const ref of refsToUpdate) {
      const normalizedLat = Number(item.latitude.toFixed(6));
      const normalizedLng = Number(item.longitude.toFixed(6));
      batch.set(
        ref,
        cleanFirestoreData({
          id: ref.id,
          latitude: normalizedLat,
          longitude: normalizedLng,
          shopLocation: formatShopLocationString(normalizedLat, normalizedLng),
          updatedAt: now,
          updatedBy: updatedBy || 'الأدمن (ملف إكسل)',
        }),
        { merge: true }
      );
      batchOps++;
      if (batchOps === 400) {
        await batch.commit();
        batch = writeBatch(db);
        batchOps = 0;
      }
    }

    updatedCount++;
    supabaseRoutes.push({
      ...item.route,
      latitude: Number(item.latitude.toFixed(6)),
      longitude: Number(item.longitude.toFixed(6)),
      shopLocation: formatShopLocationString(item.latitude, item.longitude),
    });
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  await syncCustomerRowsToSupabase(supabaseRoutes);
  return updatedCount;
};

