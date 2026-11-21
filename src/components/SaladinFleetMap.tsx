import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteItem, RepLiveLocation, SalesEntry, UnsuccessfulVisit } from '../types';
import {
  cacheShopCoordinatesLocally,
  getActiveBaghdadRouteDay,
  getCachedShopCoordinates,
  getLastKnownRepCoords,
  normalizeTrackingText,
  parseCoordinate,
  REP_COORDS_EVENT,
  RepLiveCoords,
  resolveRouteCoordinatesWithCache,
  saveCustomerCoordinates,
  subscribeToRepLiveLocations,
  calculateHaversineDistanceMeters,
} from '../lib/fleetTrackingService';
import { getEffectiveRouteDay } from '../utils/routeUtils';
import { formatEnglishDate, formatEnglishTime } from '../utils/dateUtils';
import { getBaghdadDateAndSeconds, useSales } from '../context/SalesContext';
import { parseArabicDigits } from '../utils/numberUtils';
import { hasDelegateRecordedVisitInLastHour } from '../utils/salesAnalysisUtils';
import {
  MapPin,
  Navigation,
  RefreshCw,
  Store,
  Crosshair,
  CheckCircle2,
  X,
  Maximize2,
  ExternalLink,
  Copy,
  Save,
  AlertTriangle,
} from 'lucide-react';

// Saladin Governorate center & bounds covering all districts (Shirqat, Baiji, Tikrit, Samarra, Balad, Dujail, Tuz Khurmatu)
const TIKRIT_CENTER: [number, number] = [34.69, 43.90];
const DEFAULT_ZOOM = 8;
const SALADIN_BOUNDS: L.LatLngBoundsExpression = [
  [33.82, 43.18],
  [35.56, 44.68],
];

interface SaladinFleetMapProps {
  routes: RouteItem[];
  salesEntries: SalesEntry[];
  unsuccessfulVisits?: UnsuccessfulVisit[];
  isDarkMode?: boolean;
  canEditCoordinates?: boolean;
  canManageGeofence?: boolean;
  selectedDayFilter?: string;
  selectedDelegateFilter?: string;
  repViewOnly?: boolean;
  restrictRepId?: string;
  restrictRepName?: string;
  restrictDelegateCode?: string;
  restrictUsername?: string;
  restrictDay?: string;
  onSelectCustomerAction?: (route: RouteItem) => void;
  canCreateInvoiceForRoute?: (route: RouteItem) => boolean;
  onNotify?: (msg: string) => void;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const createRepDivIcon = (repName: string, showIdleRedAlert = false): L.DivIcon => {
  const safeName = escapeHtml(repName);
  const statusDotHtml = showIdleRedAlert
    ? `<span title="تنبيه: لم يسجل أي زيارة خلال آخر ربع ساعة" style="position:relative;display:inline-flex;width:9px;height:9px;flex-shrink:0;align-items:center;justify-content:center;">
        <span class="rep-idle-pulse-ring" style="position:absolute;inset:-3px;border-radius:9999px;background:rgba(239,68,68,0.85);"></span>
        <span style="position:relative;width:8px;height:8px;border-radius:9999px;background:#ef4444;border:1.5px solid #ffffff;box-shadow:0 0 8px #ef4444;display:inline-block;"></span>
      </span>`
    : `<span style="width:7px;height:7px;border-radius:9999px;background:#4ade80;box-shadow:0 0 6px #4ade80;display:inline-block;flex-shrink:0;"></span>`;
  const badgeBorder = showIdleRedAlert ? '#fecaca' : '#ffffff';
  return L.divIcon({
    className: 'custom-rep-pin',
    html: `
      <div dir="rtl" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);pointer-events:auto;">
        <div style="display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,#0369a1,#0284c7);color:#ffffff;padding:3px 9px;border-radius:10px;font-size:11px;font-weight:900;white-space:nowrap;box-shadow:0 4px 12px rgba(2,132,199,0.48);border:2px solid ${badgeBorder};margin-bottom:4px;font-family:'Cairo',sans-serif;">
          ${statusDotHtml}
          <span>المندوب: ${safeName}</span>
        </div>
        <div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
          <div class="rep-marker-pulse-ring" style="position:absolute;inset:-4px;border-radius:9999px;background:rgba(14,165,233,0.45);border:2px solid rgba(56,189,248,0.85);"></div>
          <div style="position:relative;width:34px;height:34px;border-radius:9999px;background:linear-gradient(135deg,#0284c7,#2563eb);border:3px solid #ffffff;box-shadow:0 4px 12px rgba(3,105,161,0.55);display:flex;align-items:center;justify-content:center;color:#ffffff;">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path>
              <path d="M15 18H9"></path>
              <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path>
              <circle cx="17" cy="18" r="2"></circle>
              <circle cx="7" cy="18" r="2"></circle>
            </svg>
          </div>
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -44],
  });
};

const createShopDivIcon = (
  isVisitedToday: boolean,
  customerName: string,
  isWithinGeofence: boolean,
  isUnsuccessfulVisitToday = false
): L.DivIcon => {
  const isYellow = !isVisitedToday && (isUnsuccessfulVisitToday || isWithinGeofence);
  const color = isVisitedToday ? '#16a34a' : (isYellow ? '#eab308' : '#dc2626');
  const ring = isVisitedToday ? 'rgba(22,163,74,0.28)' : (isYellow ? 'rgba(234,179,8,0.35)' : 'rgba(220,38,38,0.28)');
  const badgeBg = isVisitedToday ? '#ecfdf5' : (isYellow ? '#fefce8' : '#fef2f2');
  const badgeText = isVisitedToday ? '#14532d' : (isYellow ? '#713f12' : '#7f1d1d');
  const isRed = !isVisitedToday && !isYellow;
  const safeName = escapeHtml(customerName);

  const checkmarkCornerHtml = isVisitedToday
    ? `<span style="position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:9999px;background:#ffffff;border:1.5px solid #16a34a;color:#16a34a;display:flex;align-items:center;justify-content:center;font-size:7.5px;font-weight:900;box-shadow:0 1px 3px rgba(0,0,0,0.25);">✓</span>`
    : isUnsuccessfulVisitToday
    ? `<span style="position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:9999px;background:#ffffff;border:1.5px solid #ca8a04;color:#ca8a04;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;box-shadow:0 1px 3px rgba(0,0,0,0.25);">!</span>`
    : isWithinGeofence
    ? `<span style="position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:9999px;background:#ffffff;border:1.5px solid #eab308;color:#eab308;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:900;box-shadow:0 1px 3px rgba(0,0,0,0.25);">📍</span>`
    : '';

  return L.divIcon({
    className: 'custom-shop-pin',
    html: `
      <div dir="rtl" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:pointer;">
        <div style="display:inline-flex;align-items:center;gap:3px;background:${badgeBg};color:${badgeText};padding:1px 5px;border-radius:6px;font-size:8.5px;font-weight:900;white-space:nowrap;box-shadow:0 1.5px 5px rgba(0,0,0,0.2);border:1.5px solid ${color};margin-bottom:2px;font-family:'Cairo',sans-serif;">
          ${isVisitedToday ? '<span style="color:#16a34a;font-weight:900;">✓</span>' : isUnsuccessfulVisitToday ? '<span style="color:#ca8a04;font-weight:900;">●</span>' : isWithinGeofence ? '<span style="color:#eab308;font-weight:900;">📍</span>' : ''}
          <span style="max-width:85px;overflow:hidden;text-overflow:ellipsis;">${safeName}</span>
        </div>
        ${isRed ? `<div style="background:#dc2626;color:#ffffff;padding:1px 5px;border-radius:4px;font-size:7.5px;font-weight:900;white-space:nowrap;margin-bottom:2px;box-shadow:0 1px 3px rgba(0,0,0,0.3);animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;">طلب جديد 🔔</div>` : ''}
        <div style="position:relative;width:20px;height:20px;border-radius:6px;background:${color};border:1.5px solid #ffffff;box-shadow:0 0 0 2px ${ring}, 0 2px 5px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;color:#ffffff;">
          ${checkmarkCornerHtml}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l2-5h14l2 5"></path>
            <path d="M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"></path>
            <path d="M9 21V13h6v8"></path>
          </svg>
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -28],
  });
};

export const SaladinFleetMap: React.FC<SaladinFleetMapProps> = ({
  routes,
  salesEntries,
  unsuccessfulVisits = [],
  isDarkMode = false,
  canEditCoordinates = false,
  canManageGeofence = false,
  selectedDayFilter = '',
  selectedDelegateFilter = '',
  repViewOnly = false,
  restrictRepId = '',
  restrictRepName = '',
  restrictDelegateCode = '',
  restrictUsername = '',
  restrictDay = '',
  onSelectCustomerAction,
  canCreateInvoiceForRoute,
  onNotify,
}) => {
  const { geofenceRadiusMeters, updateGeofenceRadiusMeters, currentUser } = useSales();
  const isDataEntryUser = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.name?.includes('مدخل') ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );
  const isStrictAdminOnMap = Boolean(
    !repViewOnly &&
    !isDataEntryUser &&
    (currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.name === 'الأدمن')
  );
  const isStrictlyAdminForGeofence = Boolean(
    canManageGeofence && isStrictAdminOnMap
  );

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routePathLayerRef = useRef<L.LayerGroup | null>(null);
  const shopsLayerRef = useRef<L.LayerGroup | null>(null);
  const repsLayerRef = useRef<L.LayerGroup | null>(null);

  // Persistent marker maps enable smooth animated position transitions without tile/marker re-creation
  const shopMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const shopMarkerMetaRef = useRef<Map<string, string>>(new Map());
  const repMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const repMarkerMetaRef = useRef<Map<string, string>>(new Map());
  const onSelectActionRef = useRef(onSelectCustomerAction);
  onSelectActionRef.current = onSelectCustomerAction;
  const canCreateInvoiceRef = useRef(canCreateInvoiceForRoute);
  canCreateInvoiceRef.current = canCreateInvoiceForRoute;

  const [liveReps, setLiveReps] = useState<RepLiveLocation[]>([]);
  const [localRepCoords, setLocalRepCoords] = useState<RepLiveCoords | null>(() =>
    repViewOnly ? getLastKnownRepCoords() : null
  );
  const [showAllDaysOnMap, setShowAllDaysOnMap] = useState<boolean>(() => !repViewOnly);
  const hasAutoFittedRef = useRef<boolean>(false);
  const [assignMode, setAssignMode] = useState<boolean>(false);
  const [assignRouteId, setAssignRouteId] = useState<string>('');
  const [isSavingCoord, setIsSavingCoord] = useState<boolean>(false);
  const [geofenceInput, setGeofenceInput] = useState<string>(() => String(geofenceRadiusMeters || 100));
  const [isSavingGeofence, setIsSavingGeofence] = useState<boolean>(false);
  const [focusedRepId, setFocusedRepId] = useState<string | null>(null);
  const [activityNowMs, setActivityNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    setActivityNowMs(Date.now());
    const timer = window.setInterval(() => setActivityNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [salesEntries, unsuccessfulVisits]);

  useEffect(() => {
    setGeofenceInput(String(geofenceRadiusMeters || 100));
  }, [geofenceRadiusMeters]);

  const handleSaveGeofenceRadius = async () => {
    if (!isStrictlyAdminForGeofence || isSavingGeofence) return;
    const normalized = parseArabicDigits(geofenceInput).trim();
    const parsed = Math.round(Number(normalized));
    setIsSavingGeofence(true);
    await updateGeofenceRadiusMeters(parsed);
    setIsSavingGeofence(false);
  };
  const [externalMapTarget, setExternalMapTarget] = useState<{
    customerName: string;
    customerCode: string;
    lat: number;
    lng: number;
  } | null>(null);

  const activeTodayName = useMemo(() => getActiveBaghdadRouteDay(), []);
  const todayIsoDate = getBaghdadDateAndSeconds().todayStr;

  // Cache static shop coordinates locally whenever route list loads/updates
  const cachedCoordsMap = useMemo(() => {
    cacheShopCoordinatesLocally(routes);
    return getCachedShopCoordinates();
  }, [routes]);

  // Build lookup set for customers that have at least one non-cancelled invoice today (by exact customerCode)
  const visitedTodayKeys = useMemo(() => {
    const codeSet = new Set<string>();
    const nameDelegateNoCodeSet = new Set<string>();
    salesEntries.forEach((e) => {
      if (e.dateString === todayIsoDate && e.status !== 'cancelled') {
        const eCode = String(e.customerCode || '').trim();
        if (eCode) {
          codeSet.add(eCode);
        } else if (e.customerName) {
          nameDelegateNoCodeSet.add(
            `${normalizeTrackingText(e.customerName)}::${normalizeTrackingText(e.delegateName)}`
          );
        }
      }
    });
    return { codeSet, nameDelegateNoCodeSet };
  }, [salesEntries, todayIsoDate]);

  // Build lookup set for customers that have an unsuccessful visit recorded today
  const unsuccessfulTodayKeys = useMemo(() => {
    const codeSet = new Set<string>();
    const nameDelegateSet = new Set<string>();
    const todayFormatted = formatEnglishDate(new Date());

    const getBaghdadDateKey = (ts: number): string => {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Baghdad',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date(ts));
        const y = parts.find((p) => p.type === 'year')?.value || '';
        const m = parts.find((p) => p.type === 'month')?.value || '';
        const d = parts.find((p) => p.type === 'day')?.value || '';
        return y && m && d ? `${y}-${m}-${d}` : '';
      } catch {
        return '';
      }
    };

    unsuccessfulVisits.forEach((v) => {
      const isToday =
        (v.date && v.date === todayFormatted) ||
        (v.timestamp && getBaghdadDateKey(v.timestamp) === todayIsoDate) ||
        (v.createdAt && getBaghdadDateKey(new Date(v.createdAt).getTime()) === todayIsoDate);

      if (!isToday) return;

      const cCode = String(v.customerCode || '').trim();
      if (cCode) codeSet.add(cCode);
      if (v.customerName) {
        nameDelegateSet.add(
          `${normalizeTrackingText(v.customerName)}::${normalizeTrackingText(v.delegateName)}`
        );
        nameDelegateSet.add(normalizeTrackingText(v.customerName));
      }
    });

    return { codeSet, nameDelegateSet };
  }, [unsuccessfulVisits, todayIsoDate]);

  const isCustomerUnsuccessfulToday = (r: RouteItem): boolean => {
    const cCode = String(r.customerCode || '').trim();
    if (cCode && unsuccessfulTodayKeys.codeSet.has(cCode)) return true;
    const cNorm = normalizeTrackingText(r.customerName);
    const delNorm = normalizeTrackingText(r.delegateName);
    if (cNorm && unsuccessfulTodayKeys.nameDelegateSet.has(`${cNorm}::${delNorm}`)) return true;
    return false;
  };

  const isCustomerVisitedToday = (r: RouteItem): boolean => {
    const cCode = String(r.customerCode || '').trim();
    if (cCode) {
      if (visitedTodayKeys.codeSet.has(cCode)) return true;
      return Boolean(r.visitedToday);
    }
    const cNorm = normalizeTrackingText(r.customerName);
    const delNorm = normalizeTrackingText(r.delegateName);
    if (cNorm && visitedTodayKeys.nameDelegateNoCodeSet.has(`${cNorm}::${delNorm}`)) return true;
    return Boolean(r.visitedToday);
  };

  // Routes relevant for the map (when repViewOnly=true: strictly this rep's today route only)
  const mapTargetRoutes = useMemo(() => {
    const targetDay = repViewOnly
      ? restrictDay || activeTodayName
      : selectedDayFilter || (showAllDaysOnMap ? '' : activeTodayName);
    const normTargetDay = normalizeTrackingText(targetDay);
    const normDelFilter = normalizeTrackingText(selectedDelegateFilter);

    const normRepName = normalizeTrackingText(restrictRepName);
    const normRepCode = normalizeTrackingText(restrictDelegateCode);
    const normRepUser = normalizeTrackingText(restrictUsername);

    return routes.filter((r) => {
      if (repViewOnly) {
        const rDel = normalizeTrackingText(r.delegateName);
        const rCode = normalizeTrackingText(r.delegateCode);
        const matchesThisRep =
          (normRepName !== '' && (rDel.includes(normRepName) || normRepName.includes(rDel))) ||
          (normRepCode !== '' && (rCode === normRepCode || rDel.includes(normRepCode))) ||
          (normRepUser !== '' && (rDel.includes(normRepUser) || rCode === normRepUser));
        if (!matchesThisRep) return false;
      } else if (normDelFilter) {
        const rDel = normalizeTrackingText(r.delegateName);
        const rCode = normalizeTrackingText(r.delegateCode);
        if (!rDel.includes(normDelFilter) && !normDelFilter.includes(rDel) && rCode !== normDelFilter) {
          return false;
        }
      }
      if (normTargetDay) {
        const effDay = normalizeTrackingText(getEffectiveRouteDay(r));
        if (!effDay.includes(normTargetDay) && !normTargetDay.includes(effDay)) {
          return false;
        }
      }
      return true;
    });
  }, [
    routes,
    repViewOnly,
    restrictDay,
    restrictRepName,
    restrictDelegateCode,
    restrictUsername,
    selectedDayFilter,
    selectedDelegateFilter,
    showAllDaysOnMap,
    activeTodayName,
  ]);

  const mappedCustomers = useMemo(() => {
    return mapTargetRoutes
      .map((r) => {
        const { latitude: lat, longitude: lng } = resolveRouteCoordinatesWithCache(r, cachedCoordsMap);
        if (lat === null || lng === null) return null;
        return {
          key: String(r.id || `${r.customerCode}_${r.path}_${r.delegateName}`),
          route: r,
          lat,
          lng,
          visited: isCustomerVisitedToday(r),
          unsuccessfulVisitedToday: isCustomerUnsuccessfulToday(r),
        };
      })
      .filter(
        (
          x
        ): x is {
          key: string;
          route: RouteItem;
          lat: number;
          lng: number;
          visited: boolean;
          unsuccessfulVisitedToday: boolean;
        } => x !== null
      );
  }, [mapTargetRoutes, visitedTodayKeys, unsuccessfulTodayKeys, cachedCoordsMap]);

  const visitedCount = useMemo(() => mappedCustomers.filter((c) => c.visited).length, [mappedCustomers]);
  const unsuccessfulCount = useMemo(
    () => mappedCustomers.filter((c) => !c.visited && c.unsuccessfulVisitedToday).length,
    [mappedCustomers]
  );
  const unvisitedCount = mappedCustomers.length - visitedCount - unsuccessfulCount;

  // Filter live rep pins: enforce strictly ONE latest pin per rep (and when repViewOnly=true, only this rep)
  const visibleLiveReps = useMemo(() => {
    const filtered = !repViewOnly
      ? liveReps
      : (() => {
          const normRepId = normalizeTrackingText(restrictRepId);
          const normRepName = normalizeTrackingText(restrictRepName);
          const normRepCode = normalizeTrackingText(restrictDelegateCode);
          const normRepUser = normalizeTrackingText(restrictUsername);

          return liveReps.filter((rep) => {
            const idNorm = normalizeTrackingText(rep.rep_id);
            const nameNorm = normalizeTrackingText(rep.rep_name);
            const codeNorm = normalizeTrackingText(rep.delegate_code);
            return (
              (normRepId && (idNorm === normRepId || codeNorm === normRepId)) ||
              (normRepCode && (codeNorm === normRepCode || idNorm === normRepCode)) ||
              (normRepName && (nameNorm === normRepName || nameNorm.includes(normRepName) || normRepName.includes(nameNorm))) ||
              (normRepUser && (idNorm === normRepUser || nameNorm.includes(normRepUser)))
            );
          });
        })();

    const deduped: Array<{ tokens: Set<string>; latest: RepLiveLocation; latestMs: number }> = [];
    for (const rep of filtered) {
      const tokens = [
        normalizeTrackingText(rep.rep_name),
        normalizeTrackingText(rep.delegate_code),
        normalizeTrackingText(rep.rep_id),
      ].filter(Boolean);
      const curMs = rep.updated_at ? new Date(rep.updated_at).getTime() : 0;
      const existing = deduped.find((d) => tokens.some((t) => d.tokens.has(t)));
      if (existing) {
        tokens.forEach((t) => existing.tokens.add(t));
        if (curMs >= existing.latestMs) {
          existing.latest = rep;
          existing.latestMs = curMs;
        }
      } else {
        deduped.push({ tokens: new Set(tokens), latest: rep, latestMs: curMs });
      }
    }
    return deduped.map((d) => d.latest);
  }, [liveReps, repViewOnly, restrictRepId, restrictRepName, restrictDelegateCode, restrictUsername]);

  // Admin-only per-rep last-hour visit check (flags inactive reps with pulsing red dot)
  const repLastHourStatusMap = useMemo(() => {
    const statusMap = new Map<string, { isIdleLastHour: boolean; lastVisitTs: number | null }>();
    if (!isStrictAdminOnMap) return statusMap;

    visibleLiveReps.forEach((rep) => {
      const check = hasDelegateRecordedVisitInLastHour({
        delegateName: rep.rep_name || rep.rep_id,
        delegateCode: rep.delegate_code,
        salesEntries,
        unsuccessfulVisits,
        nowMs: activityNowMs,
        windowMs: 15 * 60 * 1000,
      });
      statusMap.set(rep.rep_id, {
        isIdleLastHour: !check.hasRecentVisit,
        lastVisitTs: check.lastVisitTs,
      });
    });

    return statusMap;
  }, [isStrictAdminOnMap, visibleLiveReps, salesEntries, unsuccessfulVisits, activityNowMs]);

  // Subscribe to rep_live_locations (is_active = true)
  useEffect(() => {
    const unsub = subscribeToRepLiveLocations((locs) => {
      setLiveReps(locs);
    });
    return () => unsub();
  }, []);

  // Listen to real-time local GPS updates for instant geofence button visibility on delegate devices
  useEffect(() => {
    if (!repViewOnly) {
      setLocalRepCoords(null);
      return;
    }
    setLocalRepCoords(getLastKnownRepCoords());
    const onCoordsUpdate = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{ coords?: RepLiveCoords | null } | RepLiveCoords | null>
      ).detail;
      const nextCoords =
        detail && typeof detail === 'object' && 'coords' in detail
          ? detail.coords ?? null
          : (detail as RepLiveCoords | null) ?? null;
      setLocalRepCoords(nextCoords);
    };
    window.addEventListener(REP_COORDS_EVENT, onCoordsUpdate);
    return () => window.removeEventListener(REP_COORDS_EVENT, onCoordsUpdate);
  }, [repViewOnly]);

  // Initialize Leaflet Map centered on Tikrit, Saladin Governorate
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapInstanceRef.current) return;

    let isDisposed = false;
    const map = L.map(container, {
      center: TIKRIT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });
    try {
      map.fitBounds(SALADIN_BOUNDS, { padding: [12, 12], animate: false });
    } catch {
      map.setView(TIKRIT_CENTER, DEFAULT_ZOOM, { animate: false });
    }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const routePathLayer = L.layerGroup().addTo(map);
    const shopsLayer = L.layerGroup().addTo(map);
    const repsLayer = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    routePathLayerRef.current = routePathLayer;
    shopsLayerRef.current = shopsLayer;
    repsLayerRef.current = repsLayer;

    // Ensure proper tile rendering inside dynamically expanded containers
    const resizeTimer = window.setTimeout(() => {
      if (isDisposed || mapInstanceRef.current !== map || !container.isConnected) return;
      const internalMap = map as unknown as { _mapPane?: HTMLElement };
      if (!internalMap._mapPane) return;
      try {
        map.invalidateSize();
      } catch {
        // Ignore if map was torn down concurrently
      }
    }, 250);

    return () => {
      isDisposed = true;
      window.clearTimeout(resizeTimer);
      shopMarkersRef.current.clear();
      shopMarkerMetaRef.current.clear();
      repMarkersRef.current.clear();
      repMarkerMetaRef.current.clear();
      try {
        map.remove();
      } catch {
        // Ignore cleanup error if already removed
      }
      mapInstanceRef.current = null;
      routePathLayerRef.current = null;
      shopsLayerRef.current = null;
      repsLayerRef.current = null;
    };
  }, []);

  // Handle Admin click-on-map coordinate pinning mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const container = map.getContainer();
    container.style.cursor = assignMode && assignRouteId ? 'crosshair' : '';

    const onMapClick = async (ev: L.LeafletMouseEvent) => {
      if (!assignMode || !assignRouteId || isSavingCoord) return;
      const targetRoute = routes.find((r) => r.id === assignRouteId);
      if (!targetRoute) return;

      setIsSavingCoord(true);
      const { lat, lng } = ev.latlng;
      const res = await saveCustomerCoordinates(
        targetRoute,
        Number(lat.toFixed(6)),
        Number(lng.toFixed(6)),
        'الأدمن (خريطة صلاح الدين)'
      );
      setIsSavingCoord(false);

      if (res.success) {
        onNotify?.(res.message);
        setAssignMode(false);
        setAssignRouteId('');
      } else {
        onNotify?.(res.message);
      }
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
      container.style.cursor = '';
    };
  }, [assignMode, assignRouteId, isSavingCoord, routes, onNotify]);

  // Incrementally update Customer Shop Markers without recreating existing unchanged markers or tiles
  useEffect(() => {
    const layer = shopsLayerRef.current;
    if (!layer) return;

    const activeKeys = new Set(mappedCustomers.map((c) => c.key));

    // 1. Remove markers no longer visible in current filter
    for (const [key, marker] of shopMarkersRef.current.entries()) {
      if (!activeKeys.has(key)) {
        layer.removeLayer(marker);
        shopMarkersRef.current.delete(key);
        shopMarkerMetaRef.current.delete(key);
      }
    }

    // 2. Add new markers or update existing ones in-place
    mappedCustomers.forEach(({ key, route, lat, lng, visited, unsuccessfulVisitedToday }) => {
      const delNameNorm = normalizeTrackingText(route.delegateName);
      const rep = visibleLiveReps.find(r => {
        const rName = normalizeTrackingText(r.rep_name);
        const rCode = normalizeTrackingText(r.delegate_code);
        return (delNameNorm && (rName.includes(delNameNorm) || delNameNorm.includes(rName) || rCode === delNameNorm));
      }) || visibleLiveReps[0];

      const activeRepCoords = repViewOnly
        ? localRepCoords
          ? { latitude: localRepCoords.latitude, longitude: localRepCoords.longitude }
          : rep
          ? { latitude: rep.latitude, longitude: rep.longitude }
          : null
        : rep
        ? { latitude: rep.latitude, longitude: rep.longitude }
        : null;

      const distanceMeters = activeRepCoords && lat !== null && lng !== null
        ? calculateHaversineDistanceMeters(activeRepCoords.latitude, activeRepCoords.longitude, lat, lng)
        : null;

      const isWithinGeofence = distanceMeters !== null && distanceMeters <= geofenceRadiusMeters;
      const baseCanCreate = onSelectActionRef.current
        ? canCreateInvoiceRef.current
          ? canCreateInvoiceRef.current(route)
          : true
        : false;
      const canCreateInvoice = baseCanCreate && (!repViewOnly || isWithinGeofence);
      const showVisitBtn = Boolean(onSelectActionRef.current && !visited && (!repViewOnly || isWithinGeofence));

      const metaSig = `${visited ? 1 : 0}|${unsuccessfulVisitedToday ? 1 : 0}|${isWithinGeofence ? 1 : 0}|${showVisitBtn ? 1 : 0}|${canCreateInvoice ? 1 : 0}|${geofenceRadiusMeters}|${lat}|${lng}|${route.customerName}|${route.customerAddress || ''}|${getEffectiveRouteDay(route)}|${route.delegateName || ''}`;

      const buildPopupContent = () => {
        const statusBadge = visited
          ? `<span style="display:inline-block;background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:11px;margin-top:4px;">✅ تم حفظ فاتورة اليوم</span>`
          : unsuccessfulVisitedToday
          ? `<span style="display:inline-block;background:#fef9c3;color:#854d0e;border:1px solid #fde047;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:11px;margin-top:4px;">🟡 زيارة غير ناجحة اليوم</span>`
          : `<span style="display:inline-block;background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:11px;margin-top:4px;">🔴 ضمن المسار - لم يُزار بعد</span>`;

        const distanceBadge = repViewOnly
          ? (isWithinGeofence
              ? `<div style="margin-top:4px;"><span style="display:inline-block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:10px;">📍 متواجد عند موقع المحل</span></div>`
              : `<div style="margin-top:4px;"><span style="display:inline-block;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;padding:2px 8px;border-radius:9999px;font-weight:800;font-size:10px;">📍 يلزم التواجد عند موقع المحل</span></div>`)
          : '';

        const closedBadge = !canCreateInvoice && (!repViewOnly || isWithinGeofence)
          ? `<div style="margin-top:4px;"><span style="display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:2px 8px;border-radius:9999px;font-weight:800;font-size:10px;">🔒 انتهى وقت إكمال المبيعات</span></div>`
          : '';

        const popupContent = document.createElement('div');
        popupContent.dir = 'rtl';
        popupContent.style.minWidth = '215px';
        popupContent.style.fontFamily = "'Cairo',sans-serif";
        popupContent.innerHTML = `
          <div style="margin-bottom:3px;">
            <span style="font-weight:900;font-size:13px;color:#0f172a;">${escapeHtml(route.customerName)}</span>
          </div>
          <div style="font-size:11px;color:#475569;">الكود: <b>${escapeHtml(route.customerCode)}</b> | المسار: <b>${escapeHtml(getEffectiveRouteDay(route))}</b></div>
          <div style="font-size:11px;color:#475569;">المندوب: <b>${escapeHtml(route.delegateName || '-')}</b></div>
          ${route.customerAddress ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">📍 ${escapeHtml(route.customerAddress)}</div>` : ''}
          <div>${statusBadge}</div>
          <div>${distanceBadge}</div>
          ${closedBadge}
        `;

        const actionsRow = document.createElement('div');
        actionsRow.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:6px;';

        if (showVisitBtn) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'زيارة';
          btn.title = `تسجيل زيارة للمحل (إنشاء فاتورة أو توثيق زيارة غير ناجحة)`;
          btn.style.cssText =
            'flex:1;padding:6px 8px;border-radius:8px;border:none;background:#059669;color:#fff;font-weight:800;font-size:11px;cursor:pointer;white-space:nowrap;';
          btn.onclick = () => onSelectActionRef.current?.(route);
          actionsRow.appendChild(btn);
        }

        const locBtn = document.createElement('button');
        locBtn.type = 'button';
        locBtn.textContent = '📍 موقع';
        locBtn.title = 'فتح موقع الزبون في تطبيق الخرائط';
        locBtn.style.cssText = showVisitBtn
          ? 'padding:6px 10px;border-radius:8px;border:1px solid #0284c7;background:#0284c7;color:#fff;font-weight:800;font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0;'
          : 'flex:1;padding:6px 10px;border-radius:8px;border:1px solid #0284c7;background:#0284c7;color:#fff;font-weight:800;font-size:11px;cursor:pointer;white-space:nowrap;';
        locBtn.onclick = () =>
          setExternalMapTarget({
            customerName: route.customerName,
            customerCode: route.customerCode,
            lat,
            lng,
          });
        actionsRow.appendChild(locBtn);

        popupContent.appendChild(actionsRow);
        return popupContent;
      };

      const existingMarker = shopMarkersRef.current.get(key);
      if (existingMarker) {
        const curLatLng = existingMarker.getLatLng();
        if (Math.abs(curLatLng.lat - lat) > 1e-6 || Math.abs(curLatLng.lng - lng) > 1e-6) {
          existingMarker.setLatLng([lat, lng]);
        }
        if (shopMarkerMetaRef.current.get(key) !== metaSig) {
          existingMarker.setIcon(createShopDivIcon(visited, route.customerName, isWithinGeofence, unsuccessfulVisitedToday));
          existingMarker.setPopupContent(buildPopupContent());
          shopMarkerMetaRef.current.set(key, metaSig);
        }
      } else {
        const marker = L.marker([lat, lng], {
          icon: createShopDivIcon(visited, route.customerName, isWithinGeofence, unsuccessfulVisitedToday),
        });
        marker.bindPopup(buildPopupContent());
        marker.addTo(layer);
        shopMarkersRef.current.set(key, marker);
        shopMarkerMetaRef.current.set(key, metaSig);
      }
    });
  }, [mappedCustomers, canCreateInvoiceForRoute, visibleLiveReps, localRepCoords, geofenceRadiusMeters, repViewOnly]);

  // Draw planned route line only when Admin filters by a specific delegate (never draw lines between shops for representatives)
  useEffect(() => {
    const layer = routePathLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (repViewOnly || !selectedDelegateFilter) return;

    // Dashed polyline connecting filtered delegate's route stops for Admin review
    if (mappedCustomers.length >= 2) {
      const stopCoords: L.LatLngTuple[] = mappedCustomers.map((c) => [c.lat, c.lng]);
      L.polyline(stopCoords, {
        color: '#0d9488',
        weight: 3,
        opacity: 0.72,
        dashArray: '7, 8',
      }).addTo(layer);
    }
  }, [repViewOnly, selectedDelegateFilter, mappedCustomers]);

  // Smoothly animate Moving Live Representative Pins (is_active = true) via in-place setLatLng
  useEffect(() => {
    const layer = repsLayerRef.current;
    if (!layer) return;

    const activeIds = new Set(visibleLiveReps.map((r) => r.rep_id));

    // 1. Remove reps who turned inactive or disappeared
    for (const [id, marker] of repMarkersRef.current.entries()) {
      if (!activeIds.has(id)) {
        layer.removeLayer(marker);
        repMarkersRef.current.delete(id);
        repMarkerMetaRef.current.delete(id);
      }
    }

    // 2. Smoothly move existing rep markers or create newly active ones
    visibleLiveReps.forEach((rep) => {
      const displayName = rep.rep_name || rep.rep_id;
      const idleStatus = repLastHourStatusMap.get(rep.rep_id);
      const isIdleLastHour = Boolean(isStrictAdminOnMap && idleStatus?.isIdleLastHour);
      const updatedMs = rep.updated_at ? new Date(rep.updated_at).getTime() : 0;
      const locationAgeMs = updatedMs > 0 ? Math.max(0, activityNowMs - updatedMs) : Infinity;
      const isGpsStale = locationAgeMs > 3 * 60 * 1000;
      const ageMinutes = Math.floor(locationAgeMs / 60000);
      const ageLabel =
        !Number.isFinite(ageMinutes)
          ? 'غير معروف'
          : ageMinutes >= 60
          ? `${Math.floor(ageMinutes / 60)} ساعة${ageMinutes % 60 > 0 ? ` و${ageMinutes % 60} د` : ''}`
          : `${ageMinutes} دقيقة`;
      const metaSig = `${displayName}|${isIdleLastHour ? 1 : 0}`;
      const updatedFormatted = rep.updated_at
        ? formatEnglishTime(rep.updated_at, true, '-')
        : '-';
      const lastVisitFormatted = idleStatus?.lastVisitTs
        ? formatEnglishTime(new Date(idleStatus.lastVisitTs).toISOString(), true, '-')
        : '';

      const popupHtml = `
        <div dir="rtl" style="font-family:'Cairo',sans-serif;min-width:205px;">
          <div style="font-weight:900;font-size:13px;color:#0369a1;">🚚 المندوب: ${escapeHtml(displayName)}</div>
          ${
            isIdleLastHour
              ? `<div style="font-size:11px;color:#dc2626;font-weight:900;margin-top:3px;background:#fef2f2;border:1px solid #fecaca;padding:2px 6px;border-radius:6px;">🔴 لم يسجل أي زيارة خلال آخر ربع ساعة</div>`
              : isGpsStale
              ? `<div style="font-size:11px;color:#b45309;font-weight:900;margin-top:3px;background:#fffbeb;border:1px solid #fde68a;padding:2px 6px;border-radius:6px;">⚠️ توقف تحديث GPS منذ ${escapeHtml(ageLabel)}</div>`
              : `<div style="font-size:11px;color:#16a34a;font-weight:800;margin-top:2px;">● متصل الآن في الميدان (بث GPS مباشر)</div>`
          }
          ${
            lastVisitFormatted
              ? `<div style="font-size:11px;color:#475569;margin-top:3px;">آخر زيارة مسجلة: <b>${escapeHtml(lastVisitFormatted)}</b></div>`
              : ''
          }
          <div style="font-size:11px;color:${isGpsStale ? '#b45309' : '#475569'};margin-top:2px;">آخر تحديث موقع: <b>${escapeHtml(updatedFormatted)}</b>${isGpsStale && Number.isFinite(ageMinutes) ? ` <span style="font-size:10px;">(منذ ${escapeHtml(ageLabel)})</span>` : ''}</div>
          <div style="font-size:10px;color:#64748b;font-family:monospace;margin-top:2px;" dir="ltr">${rep.latitude.toFixed(5)}, ${rep.longitude.toFixed(5)}</div>
        </div>
      `;

      const existingMarker = repMarkersRef.current.get(rep.rep_id);
      if (existingMarker) {
        // Smooth CSS-transitioned glide to new coordinate without clearing layers/tiles
        existingMarker.setLatLng([rep.latitude, rep.longitude]);
        if (repMarkerMetaRef.current.get(rep.rep_id) !== metaSig) {
          existingMarker.setIcon(createRepDivIcon(displayName, isIdleLastHour));
          repMarkerMetaRef.current.set(rep.rep_id, metaSig);
        }
        existingMarker.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([rep.latitude, rep.longitude], {
          icon: createRepDivIcon(displayName, isIdleLastHour),
          zIndexOffset: 1000,
        });
        marker.bindPopup(popupHtml);
        marker.addTo(layer);
        repMarkersRef.current.set(rep.rep_id, marker);
        repMarkerMetaRef.current.set(rep.rep_id, metaSig);
      }
    });
  }, [visibleLiveReps, repLastHourStatusMap, isStrictAdminOnMap, activityNowMs]);

  // Auto-fit bounds when multiple points exist, otherwise keep full Saladin Governorate view
  useEffect(() => {
    if (hasAutoFittedRef.current) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const points: L.LatLngTuple[] = [
      ...visibleLiveReps.map((r): L.LatLngTuple => [r.latitude, r.longitude]),
      ...mappedCustomers.map((c): L.LatLngTuple => [c.lat, c.lng]),
    ];
    if (points.length < 2) return;
    hasAutoFittedRef.current = true;
    try {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12, animate: false });
    } catch {
      // Fallback to default Saladin Governorate bounds
    }
  }, [mappedCustomers, visibleLiveReps]);

  const handleRecenterTikrit = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    setFocusedRepId(null);
    try {
      map.fitBounds(SALADIN_BOUNDS, { padding: [16, 16], animate: true });
    } catch {
      map.setView(TIKRIT_CENTER, DEFAULT_ZOOM, { animate: true });
    }
  };

  const handleFitAllPoints = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    setFocusedRepId(null);
    const points: L.LatLngTuple[] = [
      ...visibleLiveReps.map((r): L.LatLngTuple => [r.latitude, r.longitude]),
      ...mappedCustomers.map((c): L.LatLngTuple => [c.lat, c.lng]),
    ];
    if (points.length === 0) {
      handleRecenterTikrit();
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
  };

  const handleFocusRepLocation = (rep: RepLiveLocation) => {
    const map = mapInstanceRef.current;
    const internalMap = map as unknown as { _mapPane?: HTMLElement } | null;
    if (!map || !internalMap?._mapPane) return;
    if (!Number.isFinite(rep.latitude) || !Number.isFinite(rep.longitude)) return;

    setFocusedRepId(rep.rep_id);
    try {
      map.flyTo([rep.latitude, rep.longitude], 16, {
        animate: true,
        duration: 0.85,
      });
    } catch {
      map.setView([rep.latitude, rep.longitude], 16, { animate: true });
    }

    const repMarker = repMarkersRef.current.get(rep.rep_id);
    if (repMarker) {
      repMarker.openPopup();
    }
  };

  return (
    <div
      className={`rounded-2xl border shadow-lg overflow-hidden transition-colors ${
        isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}
      dir="rtl"
    >
      {/* Map Header & Live Counters */}
      <div
        className={`p-3 sm:p-4 border-b flex flex-wrap items-center justify-between gap-2.5 ${
          isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-black text-sm sm:text-base flex items-center gap-1.5">
              <span>{repViewOnly ? 'خريطة مسار ومحلات محافظة صلاح الدين' : 'خريطة متابعة المندوبين والمسارات — محافظة صلاح الدين'}</span>
            </h3>
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              {repViewOnly ? (
                <>
                  مسارك الحالي اليوم فقط:{' '}
                  <span className="text-emerald-600 dark:text-emerald-400 font-black">
                    {restrictDay || activeTodayName}
                  </span>
                </>
              ) : selectedDayFilter ? (
                <>
                  تكريت والاقضية • اليوم المحدد:{' '}
                  <span className="text-emerald-600 dark:text-emerald-400 font-black">
                    {selectedDayFilter}
                  </span>
                </>
              ) : showAllDaysOnMap ? (
                <>
                  صلاح الدين • عرض{' '}
                  <span className="text-emerald-600 dark:text-emerald-400 font-black">
                    جميع مواقع المحلات ({mappedCustomers.length})
                  </span>
                </>
              ) : (
                <>
                  تكريت والاقضية • مسار اليوم النشط:{' '}
                  <span className="text-emerald-600 dark:text-emerald-400 font-black">
                    {activeTodayName}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Status Summary Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-black">
          {!repViewOnly && (
            <div className="px-2.5 py-1 rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
              <span>{`مندوبين نشطين: ${visibleLiveReps.length}`}</span>
            </div>
          )}
          {!repViewOnly && (
            <div className="px-2.5 py-1 rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              <span>جميع المواقع: {mappedCustomers.length}</span>
            </div>
          )}
          <div className="px-2.5 py-1 rounded-xl bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 flex items-center gap-1">
            <Store className="w-3.5 h-3.5" />
            <span>لم يطلب بعد: {unvisitedCount}</span>
          </div>
          {unsuccessfulCount > 0 && (
            <div className="px-2.5 py-1 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>زيارة غير ناجحة: {unsuccessfulCount}</span>
            </div>
          )}
          <div className="px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>طلب اليوم: {visitedCount}</span>
          </div>
        </div>
      </div>

      {/* Controls Toolbar */}
      <div
        className={`px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleRecenterTikrit}
            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-black text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Crosshair className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>توسيط صلاح الدين / تكريت</span>
          </button>

          <button
            type="button"
            onClick={handleFitAllPoints}
            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-black text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>{repViewOnly ? 'احتواء مساري اليوم' : 'احتواء جميع المواقع'}</span>
          </button>

          {!repViewOnly && (
            <button
              type="button"
              onClick={() => setShowAllDaysOnMap((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl font-black text-[11px] border transition-colors cursor-pointer ${
                showAllDaysOnMap
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {showAllDaysOnMap ? 'عرض محلات اليوم فقط' : 'عرض جميع أيام المسار'}
            </button>
          )}

          {canEditCoordinates && !repViewOnly && (
            <button
              type="button"
              onClick={() => {
                setAssignMode((m) => !m);
                setAssignRouteId('');
              }}
              className={`px-2.5 py-1.5 rounded-xl font-black text-[11px] flex items-center gap-1 border transition-colors cursor-pointer ${
                assignMode
                  ? 'bg-amber-500 text-slate-950 border-amber-500'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>{assignMode ? 'إغلاق تثبيت المواقع' : 'تثبيت موقع محل على الخريطة'}</span>
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] font-bold text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block"></span>
            مندوب نشط
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block"></span>
            محل بدون فاتورة
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block"></span>
            تم حفظ فاتورة اليوم
          </span>
        </div>
      </div>

      {/* Admin Click-to-Assign Customer Location Bar */}
      {assignMode && canEditCoordinates && (
        <div
          className={`p-3 border-b flex flex-wrap items-center gap-2 text-xs ${
            isDarkMode ? 'bg-amber-950/40 border-amber-800/60' : 'bg-amber-50 border-amber-200'
          }`}
        >
          <span className="font-black text-amber-800 dark:text-amber-300">
            1- اختر المحل:
          </span>
          <select
            value={assignRouteId}
            onChange={(e) => setAssignRouteId(e.target.value)}
            className={`flex-1 min-w-[200px] p-2 rounded-xl border text-xs font-bold ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-amber-300 text-slate-900'
            }`}
          >
            <option value="">-- اختر المحل لتحديد موقعه على الخريطة --</option>
            {mapTargetRoutes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.customerName} ({r.customerCode}) - {r.delegateName}
                {parseCoordinate(r.latitude) ? ' 📍' : ' (غير محدد)'}
              </option>
            ))}
          </select>
          <span className="font-bold text-amber-700 dark:text-amber-300">
            {assignRouteId ? '2- انقر الآن على موقع المحل فوق الخريطة لحفظ الإحداثيات' : ''}
          </span>
          {isSavingCoord && <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />}
          <button
            type="button"
            onClick={() => {
              setAssignMode(false);
              setAssignRouteId('');
            }}
            className="p-1.5 rounded-lg hover:bg-amber-200/60 text-amber-800 dark:text-amber-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Strict Admin-Only Dynamic Geofence Distance Setting */}
      {isStrictlyAdminForGeofence && (
        <div
          className={`px-3 py-2.5 border-b flex flex-wrap items-center justify-between gap-2.5 text-xs ${
            isDarkMode ? 'bg-slate-800/60 border-slate-700 text-slate-200' : 'bg-emerald-50/70 border-emerald-200 text-slate-800'
          }`}
        >
          <div className="flex items-start gap-2 max-w-xl">
            <Navigation className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <p className="font-bold leading-relaxed text-[11px] sm:text-xs">
              <span className="font-black text-emerald-700 dark:text-emerald-300">شرط المسافة المسموح بها في الخريطة والتطبيق:</span>{' '}
              حدد المسافة المطلوبة بالمتر لتنبيهات المندوب والسماح بإنشاء الفاتورة (المسافة المعتمدة حالياً:{' '}
              <span className="font-black text-emerald-700 dark:text-emerald-300">{geofenceRadiusMeters} متر</span>
              ).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={geofenceInput}
                onChange={(e) => setGeofenceInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveGeofenceRadius();
                  }
                }}
                placeholder="100"
                className={`w-20 px-2.5 py-1.5 rounded-xl border text-center font-black text-xs outline-none focus:ring-2 focus:ring-emerald-500 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-600 text-white'
                    : 'bg-white border-emerald-300 text-slate-900'
                }`}
                dir="ltr"
              />
              <span className="font-black text-[11px] text-slate-600 dark:text-slate-300">متر</span>
            </div>
            <button
              type="button"
              onClick={handleSaveGeofenceRadius}
              disabled={isSavingGeofence}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-black text-xs shadow-sm flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {isSavingGeofence ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>حفظ</span>
            </button>
          </div>
        </div>
      )}

      {/* Strict Admin-Only Quick Zoom to Live Representative Location */}
      {isStrictAdminOnMap && (
        <div
          className={`px-3 py-2 border-b flex flex-wrap items-center gap-2 text-xs ${
            isDarkMode ? 'bg-slate-900/90 border-slate-800 text-slate-200' : 'bg-sky-50/70 border-sky-200/80 text-slate-800'
          }`}
        >
          <span className="inline-flex items-center gap-1.5 font-black text-[11px] text-sky-700 dark:text-sky-300 shrink-0">
            <Crosshair className="w-3.5 h-3.5" />
            <span>تقريب لموقع المندوب الحالي:</span>
          </span>
          {visibleLiveReps.length === 0 ? (
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              لا يوجد مندوب نشط بموقع GPS حالياً
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {visibleLiveReps.map((rep) => {
                const repLabel = rep.rep_name || rep.rep_id;
                const isFocused = focusedRepId === rep.rep_id;
                const isIdleLastHour = Boolean(repLastHourStatusMap.get(rep.rep_id)?.isIdleLastHour);
                return (
                  <button
                    key={rep.rep_id}
                    type="button"
                    onClick={() => handleFocusRepLocation(rep)}
                    title={
                      isIdleLastHour
                        ? `تنبيه: ${repLabel} لم يسجل أي زيارة خلال آخر ربع ساعة • اضغط للتقريب إلى موقعه`
                        : `تقريب الخريطة إلى موقع ${repLabel}`
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all cursor-pointer active:scale-95 whitespace-nowrap shadow-xs ${
                      isFocused
                        ? 'bg-sky-600 text-white ring-2 ring-sky-400/60 shadow-sky-600/30'
                        : isIdleLastHour
                          ? isDarkMode
                            ? 'bg-rose-950/60 hover:bg-rose-900/70 text-rose-100 border border-rose-500/70'
                            : 'bg-white hover:bg-rose-50 text-rose-900 border border-rose-400'
                          : isDarkMode
                            ? 'bg-slate-800 hover:bg-sky-900/60 text-sky-200 border border-sky-700/60'
                            : 'bg-white hover:bg-sky-100 text-sky-800 border border-sky-300'
                    }`}
                  >
                    {isIdleLastHour ? (
                      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-85" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 ring-1 ring-white/80" />
                      </span>
                    ) : (
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isFocused ? 'bg-emerald-300 animate-ping' : 'bg-emerald-500'}`} />
                    )}
                    <span>{repLabel}</span>
                  </button>
                );
              })}
              {visibleLiveReps.some((rep) => repLastHourStatusMap.get(rep.rep_id)?.isIdleLastHour) && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-rose-600 dark:text-rose-400 mr-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
                  <span>لم يسجل زيارة خلال آخر ربع ساعة</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Leaflet Map Canvas */}
      <div className="relative w-full h-[520px] sm:h-[620px] lg:h-[680px] z-0">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      {/* External Navigation App Chooser Modal (Google Maps / Apple Maps / MAPS.ME / Geo URI) */}
      {externalMapTarget && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
          dir="rtl"
          onClick={() => setExternalMapTarget(null)}
        >
          <div
            className={`w-full max-w-sm rounded-3xl p-5 shadow-2xl border space-y-3.5 text-right animate-in zoom-in-95 duration-150 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-sky-600 text-white flex items-center justify-center shadow-sm shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-sm text-slate-900 dark:text-white">
                    فتح موقع الزبون بتطبيق خارجي
                  </h4>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    {externalMapTarget.customerName} ({externalMapTarget.customerCode})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExternalMapTarget(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${externalMapTarget.lat},${externalMapTarget.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setExternalMapTarget(null)}
                className="w-full py-2.5 px-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm flex items-center justify-between shadow-sm transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Navigation className="w-4 h-4" />
                  <span>خرائط جوجل (Google Maps)</span>
                </span>
                <ExternalLink className="w-4 h-4 opacity-90" />
              </a>

              <a
                href={`https://maps.apple.com/?daddr=${externalMapTarget.lat},${externalMapTarget.lng}&q=${encodeURIComponent(
                  externalMapTarget.customerName
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setExternalMapTarget(null)}
                className={`w-full py-2.5 px-3.5 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-between border transition-colors ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-900 text-white'
                }`}
              >
                <span className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  <span>خرائط أبل (Apple Maps)</span>
                </span>
                <ExternalLink className="w-4 h-4 opacity-90" />
              </a>

              <a
                href={`mapsme://map?ll=${externalMapTarget.lat},${externalMapTarget.lng}&n=${encodeURIComponent(
                  externalMapTarget.customerName
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setExternalMapTarget(null)}
                className="w-full py-2.5 px-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-black text-xs sm:text-sm flex items-center justify-between shadow-sm transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Navigation className="w-4 h-4" />
                  <span>تطبيق مابس مي (MAPS.ME)</span>
                </span>
                <ExternalLink className="w-4 h-4 opacity-90" />
              </a>

              <a
                href={`geo:${externalMapTarget.lat},${externalMapTarget.lng}?q=${externalMapTarget.lat},${externalMapTarget.lng}(${encodeURIComponent(
                  externalMapTarget.customerName
                )})`}
                onClick={() => setExternalMapTarget(null)}
                className={`w-full py-2.5 px-3.5 rounded-2xl font-black text-xs flex items-center justify-between border transition-colors ${
                  isDarkMode
                    ? 'bg-sky-950/50 hover:bg-sky-900/50 border-sky-800 text-sky-300'
                    : 'bg-sky-50 hover:bg-sky-100 border-sky-200 text-sky-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  <span>فتح بتطبيق الخرائط الافتراضي بالجهاز</span>
                </span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="pt-1 flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <span dir="ltr">
                {externalMapTarget.lat.toFixed(6)}, {externalMapTarget.lng.toFixed(6)}
              </span>
              <button
                type="button"
                onClick={() => {
                  const text = `${externalMapTarget.lat.toFixed(6)}, ${externalMapTarget.lng.toFixed(6)}`;
                  navigator.clipboard?.writeText(text).then(() => {
                    onNotify?.('تم نسخ إحداثيات المحل بنجاح 📋');
                  });
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-sans font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>نسخ الإحداثيات</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
