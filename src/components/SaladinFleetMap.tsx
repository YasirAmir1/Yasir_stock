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
  deleteCustomerCoordinates,
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
  Search,
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
  onLocationSaved?: (route: RouteItem, latitude: number, longitude: number) => void;
  onLocationDeleted?: (route: RouteItem, clearedAt: number) => void;
  strictAuthoritativeRoutes?: boolean;
  onFocusUnsuccessfulVisit?: (route: RouteItem) => void;
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

const createPendingPinDivIcon = (customerName: string): L.DivIcon => {
  const safeName = escapeHtml(customerName);
  return L.divIcon({
    className: 'custom-pending-pin',
    html: `
      <div dir="rtl" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:grab;">
        <div style="display:inline-flex;align-items:center;gap:4px;background:#f59e0b;color:#0f172a;padding:3px 9px;border-radius:10px;font-size:10.5px;font-weight:900;white-space:nowrap;box-shadow:0 4px 12px rgba(245,158,11,0.45);border:2px solid #ffffff;margin-bottom:4px;font-family:'Cairo',sans-serif;">
          <span>📍 موقع التثبيت:</span>
          <span style="max-width:130px;overflow:hidden;text-overflow:ellipsis;">${safeName}</span>
        </div>
        <div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
          <div class="rep-marker-pulse-ring" style="position:absolute;inset:-5px;border-radius:9999px;background:rgba(245,158,11,0.4);border:2px solid rgba(217,119,6,0.9);"></div>
          <div style="position:relative;width:28px;height:28px;border-radius:9999px;background:linear-gradient(135deg,#f59e0b,#d97706);border:2.5px solid #ffffff;box-shadow:0 4px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#ffffff;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
          </div>
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -34],
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
  onLocationSaved,
  onLocationDeleted,
  strictAuthoritativeRoutes = false,
  onFocusUnsuccessfulVisit,
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
  const canAdminPinShop = Boolean(canEditCoordinates && isStrictAdminOnMap && !repViewOnly);
  const isStrictlyAdminForGeofence = Boolean(
    canManageGeofence && isStrictAdminOnMap
  );

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routePathLayerRef = useRef<L.LayerGroup | null>(null);
  const shopsLayerRef = useRef<L.LayerGroup | null>(null);
  const repsLayerRef = useRef<L.LayerGroup | null>(null);
  const pendingPinLayerRef = useRef<L.LayerGroup | null>(null);

  // Persistent marker maps enable smooth animated position transitions without tile/marker re-creation
  const shopMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const shopMarkerMetaRef = useRef<Map<string, string>>(new Map());
  const repMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const repMarkerMetaRef = useRef<Map<string, string>>(new Map());
  const onSelectActionRef = useRef(onSelectCustomerAction);
  onSelectActionRef.current = onSelectCustomerAction;
  const canCreateInvoiceRef = useRef(canCreateInvoiceForRoute);
  canCreateInvoiceRef.current = canCreateInvoiceForRoute;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const onLocationSavedRef = useRef(onLocationSaved);
  onLocationSavedRef.current = onLocationSaved;
  const onLocationDeletedRef = useRef(onLocationDeleted);
  onLocationDeletedRef.current = onLocationDeleted;
  const onFocusUnsuccessfulVisitRef = useRef(onFocusUnsuccessfulVisit);
  onFocusUnsuccessfulVisitRef.current = onFocusUnsuccessfulVisit;
  const duplicateFocusIdxRef = useRef<number>(0);

  const [liveReps, setLiveReps] = useState<RepLiveLocation[]>([]);
  const [localRepCoords, setLocalRepCoords] = useState<RepLiveCoords | null>(() =>
    repViewOnly ? getLastKnownRepCoords() : null
  );
  const [showAllDaysOnMap, setShowAllDaysOnMap] = useState<boolean>(() => !repViewOnly);
  const hasAutoFittedRef = useRef<boolean>(false);
  const [assignMode, setAssignMode] = useState<boolean>(false);
  const [assignRouteId, setAssignRouteId] = useState<string>('');
  const [assignSearchQuery, setAssignSearchQuery] = useState<string>('');
  const [pendingPinCoords, setPendingPinCoords] = useState<{ lat: number; lng: number } | null>(null);
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
    if (strictAuthoritativeRoutes) return {};
    cacheShopCoordinatesLocally(routes);
    return getCachedShopCoordinates();
  }, [routes, strictAuthoritativeRoutes]);

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

      const cCode = String(v.customerCode || '').trim().replace(/\.0+$/, '');
      const hasRealCode = cCode !== '' && !/^cust-\d+$/i.test(cCode);
      if (hasRealCode) codeSet.add(cCode);
      if (!hasRealCode && v.customerName) {
        nameDelegateSet.add(
          `${normalizeTrackingText(v.customerName)}::${normalizeTrackingText(v.delegateName)}`
        );
      }
    });

    return { codeSet, nameDelegateSet };
  }, [unsuccessfulVisits, todayIsoDate]);

  const isCustomerUnsuccessfulToday = (r: RouteItem): boolean => {
    const cCode = String(r.customerCode || '').trim().replace(/\.0+$/, '');
    const hasRealCode = cCode !== '' && !/^cust-\d+$/i.test(cCode);
    if (hasRealCode) {
      return unsuccessfulTodayKeys.codeSet.has(cCode);
    }
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
    type RawMappedItem = {
      key: string;
      identityKey: string;
      route: RouteItem;
      routeDays: string[];
      lat: number;
      lng: number;
      visited: boolean;
      unsuccessfulVisitedToday: boolean;
    };

    // Bind every map pin STRICTLY by customerCode (when present) and NEVER by customerName.
    // customerName is used ONLY for display; deduplicate multi-day route entries for the same customerCode
    // so one physical shop appears as ONE pin on the map instead of duplicating/spiderfying with itself.
    const dedupedByIdentity = new Map<string, RawMappedItem>();

    mapTargetRoutes.forEach((r) => {
      const coords = strictAuthoritativeRoutes
        ? { latitude: parseCoordinate(r.latitude), longitude: parseCoordinate(r.longitude) }
        : resolveRouteCoordinatesWithCache(r, cachedCoordsMap);
      const { latitude: lat, longitude: lng } = coords;
      if (lat === null || lng === null) return;

      const cleanCode = String(r.customerCode || '').trim().replace(/\.0+$/, '').toLowerCase();
      const isRealCode = cleanCode !== '' && !/^cust-\d+$/i.test(cleanCode);
      const identityKey = isRealCode
        ? `code:${cleanCode}`
        : `route:${String(r.id || `${r.path || ''}_${lat}_${lng}`)}`;

      const visited = isCustomerVisitedToday(r);
      const unsuccessfulVisitedToday = isCustomerUnsuccessfulToday(r);
      const effDay = getEffectiveRouteDay(r);

      const existing = dedupedByIdentity.get(identityKey);
      if (existing) {
        if (effDay && !existing.routeDays.includes(effDay)) {
          existing.routeDays.push(effDay);
        }
        existing.visited = existing.visited || visited;
        existing.unsuccessfulVisitedToday = existing.unsuccessfulVisitedToday || unsuccessfulVisitedToday;
        return;
      }

      dedupedByIdentity.set(identityKey, {
        key: identityKey,
        identityKey,
        route: r,
        routeDays: effDay ? [effDay] : [],
        lat,
        lng,
        visited,
        unsuccessfulVisitedToday,
      });
    });

    const rawItems = Array.from(dedupedByIdentity.values());

    // Group by rounded coordinates (~1.1m) to detect genuinely DIFFERENT customerCodes sharing coordinates
    const coordGroups = new Map<string, RawMappedItem[]>();
    rawItems.forEach((item) => {
      const bucketKey = `${item.lat.toFixed(5)}_${item.lng.toFixed(5)}`;
      const arr = coordGroups.get(bucketKey) || [];
      arr.push(item);
      coordGroups.set(bucketKey, arr);
    });

    return rawItems.map((item) => {
      const bucketKey = `${item.lat.toFixed(5)}_${item.lng.toFixed(5)}`;
      const group = coordGroups.get(bucketKey) || [item];
      const uniquePeersMap = new Map<string, RouteItem>();
      group.forEach((g) => {
        if (g.identityKey !== item.identityKey && !uniquePeersMap.has(g.identityKey)) {
          uniquePeersMap.set(g.identityKey, g.route);
        }
      });
      const sharedPeers = Array.from(uniquePeersMap.values());

      const displayLat = item.lat;
      const displayLng = item.lng;

      return {
        ...item,
        displayLat,
        displayLng,
        sharedPeers,
      };
    });
  }, [mapTargetRoutes, visitedTodayKeys, unsuccessfulTodayKeys, cachedCoordsMap, strictAuthoritativeRoutes]);

  const overlappingCustomerItems = useMemo(
    () => mappedCustomers.filter((c) => c.sharedPeers.length > 0),
    [mappedCustomers]
  );

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
    const pendingPinLayer = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    routePathLayerRef.current = routePathLayer;
    shopsLayerRef.current = shopsLayer;
    repsLayerRef.current = repsLayer;
    pendingPinLayerRef.current = pendingPinLayer;

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
      pendingPinLayerRef.current = null;
    };
  }, []);

  // Deduplicated shop list for Admin coordinate pinning (searches across all shops by name or customer code)
  const assignableRoutes = useMemo(() => {
    const deduped = new Map<string, RouteItem>();
    routes.forEach((r) => {
      const cleanCode = String(r.customerCode || '').trim().replace(/\.0+$/, '').toLowerCase();
      const isRealCode = cleanCode !== '' && !/^cust-\d+$/i.test(cleanCode);
      const key = isRealCode ? `code:${cleanCode}` : `id:${r.id}`;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, r);
      } else if (
        parseCoordinate(existing.latitude) === null &&
        parseCoordinate(r.latitude) !== null
      ) {
        deduped.set(key, r);
      }
    });
    return Array.from(deduped.values()).sort((a, b) =>
      String(a.customerName || '').localeCompare(String(b.customerName || ''), 'ar')
    );
  }, [routes]);

  const filteredAssignableRoutes = useMemo(() => {
    const raw = parseArabicDigits(assignSearchQuery).trim();
    if (!raw) return assignableRoutes;
    const rawLower = raw.toLowerCase();
    const normQuery = normalizeTrackingText(raw);
    return assignableRoutes.filter((r) => {
      const rawCode = parseArabicDigits(String(r.customerCode || '')).trim().replace(/\.0+$/, '').toLowerCase();
      const normName = normalizeTrackingText(r.customerName);
      const normDel = normalizeTrackingText(r.delegateName);
      return (
        (rawCode !== '' && rawCode.includes(rawLower)) ||
        (normQuery !== '' && (normName.includes(normQuery) || normDel.includes(normQuery)))
      );
    });
  }, [assignableRoutes, assignSearchQuery]);

  const selectedAssignRoute = useMemo(
    () =>
      assignableRoutes.find((r) => r.id === assignRouteId) ||
      routes.find((r) => r.id === assignRouteId) ||
      null,
    [assignableRoutes, routes, assignRouteId]
  );

  // Handle strict Admin-only click-on-map preview pin placement (Save requires clicking "حفظ")
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const container = map.getContainer();
    const isPinningReady = canAdminPinShop && assignMode && Boolean(assignRouteId);
    container.style.cursor = isPinningReady ? 'crosshair' : '';

    const onMapClick = (ev: L.LeafletMouseEvent) => {
      if (!canAdminPinShop || !assignMode || !assignRouteId || isSavingCoord) return;
      const targetExists = routes.some((r) => r.id === assignRouteId);
      if (!targetExists) return;
      setPendingPinCoords({
        lat: Number(ev.latlng.lat.toFixed(6)),
        lng: Number(ev.latlng.lng.toFixed(6)),
      });
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
      container.style.cursor = '';
    };
  }, [canAdminPinShop, assignMode, assignRouteId, isSavingCoord, routes]);

  // Render & drag-adjust the pending shop location marker before Admin clicks Save
  useEffect(() => {
    const layer = pendingPinLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!canAdminPinShop || !assignMode || !selectedAssignRoute || !pendingPinCoords) {
      return;
    }

    const previewMarker = L.marker([pendingPinCoords.lat, pendingPinCoords.lng], {
      icon: createPendingPinDivIcon(selectedAssignRoute.customerName || selectedAssignRoute.customerCode || 'المحل'),
      draggable: true,
      zIndexOffset: 2000,
    });

    previewMarker.on('dragend', () => {
      const pos = previewMarker.getLatLng();
      setPendingPinCoords({
        lat: Number(pos.lat.toFixed(6)),
        lng: Number(pos.lng.toFixed(6)),
      });
    });

    previewMarker.addTo(layer);
  }, [canAdminPinShop, assignMode, selectedAssignRoute, pendingPinCoords]);

  const handleSelectAssignRoute = (routeId: string) => {
    setAssignRouteId(routeId);
    setPendingPinCoords(null);
    if (!routeId) return;
    const chosen = assignableRoutes.find((r) => r.id === routeId) || routes.find((r) => r.id === routeId);
    if (!chosen) return;
    const coords = strictAuthoritativeRoutes
      ? { latitude: parseCoordinate(chosen.latitude), longitude: parseCoordinate(chosen.longitude) }
      : resolveRouteCoordinatesWithCache(chosen, cachedCoordsMap);
    const map = mapInstanceRef.current;
    if (map && coords.latitude !== null && coords.longitude !== null) {
      try {
        map.flyTo([coords.latitude, coords.longitude], Math.max(map.getZoom(), 15), {
          animate: true,
          duration: 0.65,
        });
      } catch {
        map.setView([coords.latitude, coords.longitude], Math.max(map.getZoom(), 15), { animate: true });
      }
    }
  };

  const handleSavePinnedLocation = async () => {
    if (!canAdminPinShop || !selectedAssignRoute || !pendingPinCoords || isSavingCoord) return;
    setIsSavingCoord(true);
    const { lat, lng } = pendingPinCoords;
    const res = await saveCustomerCoordinates(
      selectedAssignRoute,
      lat,
      lng,
      currentUser?.name || 'الأدمن (خريطة صلاح الدين)'
    );
    setIsSavingCoord(false);

    if (res.success) {
      onLocationSavedRef.current?.(selectedAssignRoute, lat, lng);
      onNotifyRef.current?.(res.message);
      const map = mapInstanceRef.current;
      if (map) {
        try {
          map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { animate: true, duration: 0.6 });
        } catch {
          // Ignore flyTo errors
        }
      }
      setAssignMode(false);
      setAssignRouteId('');
      setAssignSearchQuery('');
      setPendingPinCoords(null);
    } else {
      onNotifyRef.current?.(res.message);
    }
  };

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
    mappedCustomers.forEach(({ key, route, routeDays, lat, lng, displayLat, displayLng, visited, unsuccessfulVisitedToday, sharedPeers }) => {
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
      const sharedKeySig = sharedPeers.map((p) => `${p.customerCode}:${p.customerName}`).join(',');
      const routeDaysLabel = routeDays.length > 0 ? routeDays.join('، ') : getEffectiveRouteDay(route);

      const metaSig = `${visited ? 1 : 0}|${unsuccessfulVisitedToday ? 1 : 0}|${isWithinGeofence ? 1 : 0}|${showVisitBtn ? 1 : 0}|${canCreateInvoice ? 1 : 0}|${geofenceRadiusMeters}|${lat}|${lng}|${displayLat}|${displayLng}|${route.customerCode}|${route.customerName}|${route.customerAddress || ''}|${routeDaysLabel}|${route.delegateName || ''}|${isStrictAdminOnMap ? 1 : 0}|${sharedKeySig}`;

      const buildPopupContent = () => {
        const distanceBadge = repViewOnly
          ? (isWithinGeofence
              ? `<div style="margin-top:4px;"><span style="display:inline-block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:10px;">📍 متواجد عند موقع المحل</span></div>`
              : `<div style="margin-top:4px;"><span style="display:inline-block;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;padding:2px 8px;border-radius:9999px;font-weight:800;font-size:10px;">📍 يلزم التواجد عند موقع المحل</span></div>`)
          : '';

        const closedBadge = !canCreateInvoice && (!repViewOnly || isWithinGeofence)
          ? `<div style="margin-top:4px;"><span style="display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:2px 8px;border-radius:9999px;font-weight:800;font-size:10px;">🔒 انتهى وقت إكمال المبيعات</span></div>`
          : '';

        const sharedWarningHtml = sharedPeers.length > 0
          ? `<div style="margin-top:6px;padding:5px 7px;border-radius:8px;background:#fffbeb;border:1px solid #f59e0b;color:#92400e;font-size:10px;font-weight:800;line-height:1.45;">
              ⚠️ تنبيه: يشترك بنفس الإحداثيات مع ${sharedPeers
                .slice(0, 3)
                .map((p) => `<b>${escapeHtml(p.customerName)}</b> (${escapeHtml(p.customerCode || '-')})`)
                .join('، ')}${sharedPeers.length > 3 ? ` و${sharedPeers.length - 3} آخرين` : ''}
            </div>`
          : '';

        const popupContent = document.createElement('div');
        popupContent.dir = 'rtl';
        popupContent.style.minWidth = '215px';
        popupContent.style.fontFamily = "'Cairo',sans-serif";
        popupContent.innerHTML = `
          <div style="margin-bottom:3px;">
            <span style="font-weight:900;font-size:13px;color:#0f172a;">${escapeHtml(route.customerName)}</span>
          </div>
          <div style="font-size:11px;color:#475569;">الكود: <b>${escapeHtml(route.customerCode)}</b> | المسار: <b>${escapeHtml(routeDaysLabel)}</b></div>
          <div style="font-size:11px;color:#475569;">المندوب: <b>${escapeHtml(route.delegateName || '-')}</b></div>
          ${route.customerAddress ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">📍 ${escapeHtml(route.customerAddress)}</div>` : ''}
          <div id="popup-status-badge-wrap"></div>
          <div>${distanceBadge}</div>
          ${closedBadge}
          ${sharedWarningHtml}
        `;

        const statusBadgeWrap = popupContent.querySelector('#popup-status-badge-wrap');
        if (statusBadgeWrap) {
          const badgeSpan = document.createElement('span');
          if (visited) {
            badgeSpan.style.cssText = 'display:inline-block;background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:11px;margin-top:4px;';
            badgeSpan.textContent = '✅ تم حفظ فاتورة اليوم';
          } else if (unsuccessfulVisitedToday) {
            const isClickableAdmin = isStrictAdminOnMap;
            badgeSpan.style.cssText = `display:inline-block;background:#fef9c3;color:#854d0e;border:1.5px solid #fde047;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:11px;margin-top:4px;${isClickableAdmin ? 'cursor:pointer;box-shadow:0 1px 4px rgba(202,138,4,0.4);text-decoration:underline;' : ''}`;
            badgeSpan.textContent = isClickableAdmin ? '🟡 زيارة غير ناجحة اليوم (انقر للانتقال للجدول ↗)' : '🟡 زيارة غير ناجحة اليوم';
            if (isClickableAdmin) {
              badgeSpan.title = 'انقر للانتقال إلى تفاصيل هذه الزيارة في جدول الزيارات غير الناجحة';
              badgeSpan.onclick = (e) => {
                e.stopPropagation();
                onFocusUnsuccessfulVisitRef.current?.(route);
              };
            }
          } else {
            badgeSpan.style.cssText = 'display:inline-block;background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:9999px;font-weight:900;font-size:11px;margin-top:4px;';
            badgeSpan.textContent = '🔴 ضمن المسار - لم يُزار بعد';
          }
          statusBadgeWrap.appendChild(badgeSpan);
        }

        const actionsRow = document.createElement('div');
        actionsRow.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

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

        if (isStrictAdminOnMap) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.textContent = sharedPeers.length > 0 ? '🗑️ حذف الموقع المكرر' : '🗑️ حذف الموقع';
          delBtn.title = 'حذف إحداثيات هذا المحل ليتم تحديدها من جديد';
          delBtn.style.cssText =
            'width:100%;padding:5px 8px;border-radius:8px;border:1px solid #fecdd3;background:#fff1f2;color:#be123c;font-weight:800;font-size:10.5px;cursor:pointer;white-space:nowrap;';
          delBtn.onclick = async () => {
            delBtn.disabled = true;
            delBtn.textContent = 'جاري الحذف...';
            const res = await deleteCustomerCoordinates(route, currentUser?.name || 'الأدمن');
            if (res.success) {
              onLocationDeletedRef.current?.(route, res.clearedAt);
              onNotifyRef.current?.(res.message);
            } else {
              delBtn.disabled = false;
              delBtn.textContent = sharedPeers.length > 0 ? '🗑️ حذف الموقع المكرر' : '🗑️ حذف الموقع';
              onNotifyRef.current?.(res.message);
            }
          };
          actionsRow.appendChild(delBtn);
        }

        popupContent.appendChild(actionsRow);
        return popupContent;
      };

      const existingMarker = shopMarkersRef.current.get(key);
      if (existingMarker) {
        const curLatLng = existingMarker.getLatLng();
        if (Math.abs(curLatLng.lat - displayLat) > 1e-6 || Math.abs(curLatLng.lng - displayLng) > 1e-6) {
          existingMarker.setLatLng([displayLat, displayLng]);
        }
        if (shopMarkerMetaRef.current.get(key) !== metaSig) {
          existingMarker.setIcon(createShopDivIcon(visited, route.customerName, isWithinGeofence, unsuccessfulVisitedToday));
          existingMarker.setPopupContent(buildPopupContent());
          shopMarkerMetaRef.current.set(key, metaSig);
        }
      } else {
        const marker = L.marker([displayLat, displayLng], {
          icon: createShopDivIcon(visited, route.customerName, isWithinGeofence, unsuccessfulVisitedToday),
        });
        marker.bindPopup(buildPopupContent());
        marker.addTo(layer);
        shopMarkersRef.current.set(key, marker);
        shopMarkerMetaRef.current.set(key, metaSig);
      }
    });
  }, [mappedCustomers, canCreateInvoiceForRoute, visibleLiveReps, localRepCoords, geofenceRadiusMeters, repViewOnly, isStrictAdminOnMap, currentUser?.name]);

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

  const handleFocusNextOverlappingShop = () => {
    const map = mapInstanceRef.current;
    if (!map || overlappingCustomerItems.length === 0) return;
    const idx = duplicateFocusIdxRef.current % overlappingCustomerItems.length;
    duplicateFocusIdxRef.current = (idx + 1) % overlappingCustomerItems.length;
    const target = overlappingCustomerItems[idx];
    try {
      map.flyTo([target.displayLat, target.displayLng], 17, { animate: true, duration: 0.7 });
    } catch {
      map.setView([target.displayLat, target.displayLng], 17, { animate: true });
    }
    const marker = shopMarkersRef.current.get(target.key);
    if (marker) marker.openPopup();
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

          {canAdminPinShop && (
            <button
              type="button"
              onClick={() => {
                setAssignMode((m) => !m);
                setAssignRouteId('');
                setAssignSearchQuery('');
                setPendingPinCoords(null);
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

      {/* Strict Admin-Only Step-by-Step Shop Coordinate Pinning Panel */}
      {assignMode && canAdminPinShop && (
        <div
          className={`p-3 border-b space-y-2.5 text-xs ${
            isDarkMode ? 'bg-amber-950/35 border-amber-800/60' : 'bg-amber-50/90 border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-black text-amber-900 dark:text-amber-200">
              <MapPin className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>تثبيت موقع محل على الخريطة (خاص بالأدمن فقط)</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setAssignMode(false);
                setAssignRouteId('');
                setAssignSearchQuery('');
                setPendingPinCoords(null);
              }}
              title="إغلاق"
              className="p-1.5 rounded-lg hover:bg-amber-200/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step 1: Choose Shop or Customer Code */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <span className="font-black text-amber-800 dark:text-amber-300 shrink-0">
              1- اختر المحل أو كود الزبون:
            </span>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={assignSearchQuery}
                onChange={(e) => {
                  setAssignSearchQuery(e.target.value);
                  if (assignRouteId) {
                    setAssignRouteId('');
                    setPendingPinCoords(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredAssignableRoutes.length > 0 && !assignRouteId) {
                    e.preventDefault();
                    const rawQ = parseArabicDigits(assignSearchQuery).trim().replace(/\.0+$/, '').toLowerCase();
                    const exactCodeMatch = filteredAssignableRoutes.find(
                      (r) => parseArabicDigits(String(r.customerCode || '')).trim().replace(/\.0+$/, '').toLowerCase() === rawQ
                    );
                    handleSelectAssignRoute((exactCodeMatch || filteredAssignableRoutes[0]).id);
                  }
                }}
                placeholder="ابحث باسم المحل أو كود الزبون..."
                className={`w-full pr-8 pl-7 py-2 rounded-xl border text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white placeholder:text-slate-500'
                    : 'bg-white border-amber-300 text-slate-900 placeholder:text-slate-400'
                }`}
              />
              {assignSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setAssignSearchQuery('');
                    setAssignRouteId('');
                    setPendingPinCoords(null);
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={assignRouteId}
              onChange={(e) => handleSelectAssignRoute(e.target.value)}
              className={`flex-1 min-w-[230px] p-2 rounded-xl border text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500 ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-amber-300 text-slate-900'
              }`}
            >
              <option value="">
                -- اختر المحل أو كود الزبون ({filteredAssignableRoutes.length}) --
              </option>
              {filteredAssignableRoutes.map((r) => {
                const hasPin = parseCoordinate(r.latitude) !== null && parseCoordinate(r.longitude) !== null;
                return (
                  <option key={r.id} value={r.id}>
                    {r.customerName} | كود: {r.customerCode || '-'} {r.delegateName ? `- ${r.delegateName}` : ''} {hasPin ? '📍' : '(غير محدد)'}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Quick 1-click search matches when typing shop name or customer code */}
          {assignSearchQuery.trim() !== '' && !selectedAssignRoute && (
            <div className="flex flex-wrap items-center gap-1.5">
              {filteredAssignableRoutes.length === 0 ? (
                <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                  لا يوجد محل مطابق لـ &quot;{assignSearchQuery}&quot;
                </span>
              ) : (
                filteredAssignableRoutes.slice(0, 6).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelectAssignRoute(r.id)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-black transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-slate-900 hover:bg-amber-900/50 border-amber-700/60 text-amber-200'
                        : 'bg-white hover:bg-amber-100 border-amber-300 text-amber-900'
                    }`}
                  >
                    {r.customerName} ({r.customerCode || '-'})
                  </button>
                ))
              )}
            </div>
          )}

          {/* Step 2 & Step 3: Map Click Selection & Explicit Save Button */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-200/70 dark:border-amber-800/40">
            <div className="flex flex-wrap items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
              {!selectedAssignRoute ? (
                <span>2- اختر المحل أو كود الزبون أولاً لتتمكن من تحديد موقعه على الخريطة.</span>
              ) : !pendingPinCoords ? (
                <span>
                  2- المحل المختار:{' '}
                  <b className="text-slate-900 dark:text-white">
                    {selectedAssignRoute.customerName} ({selectedAssignRoute.customerCode || '-'})
                  </b>{' '}
                  — انقر الآن على موقع المحل فوق الخريطة لتحديده ثم اضغط حفظ.
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span>
                    2- تم تحديد موقع{' '}
                    <b className="text-slate-900 dark:text-white">
                      {selectedAssignRoute.customerName} ({selectedAssignRoute.customerCode || '-'})
                    </b>
                    :
                  </span>
                  <span
                    dir="ltr"
                    className="px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono text-[11px]"
                  >
                    {pendingPinCoords.lat.toFixed(6)}, {pendingPinCoords.lng.toFixed(6)}
                  </span>
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                    (يمكنك سحب الدبوس أو النقر بمكان آخر للتعديل)
                  </span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSavePinnedLocation}
                disabled={!selectedAssignRoute || !pendingPinCoords || isSavingCoord}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 disabled:cursor-not-allowed text-white font-black text-xs shadow-sm flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {isSavingCoord ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{isSavingCoord ? 'جاري الحفظ...' : 'حفظ'}</span>
              </button>
            </div>
          </div>
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

      {/* Admin Overlapping / Duplicate Shop Coordinates Alert */}
      {!repViewOnly && (isStrictAdminOnMap || isDataEntryUser) && overlappingCustomerItems.length > 0 && (
        <div
          className={`px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs ${
            isDarkMode ? 'bg-amber-950/40 border-amber-800/60 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-1.5 font-black text-[11px]">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              تنبيه: يوجد ({overlappingCustomerItems.length}) محلات مختلفة مسجلة على نفس الإحداثيات تماماً (تم فصل دبابيسها مؤقتاً لسهولة النقر عليها).
            </span>
          </div>
          <button
            type="button"
            onClick={handleFocusNextOverlappingShop}
            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black shadow-xs cursor-pointer transition-colors shrink-0"
          >
            الانتقال للموقع المكرر التالي
          </button>
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
