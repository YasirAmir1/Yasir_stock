import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSales, getBaghdadDateAndSeconds } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, query, where } from 'firebase/firestore';
import { logFirestoreErrorGracefully, safeOnSnapshot } from '../lib/firestoreUtils';
import {
  appendRepTrailPoint,
  cacheShopCoordinatesLocally,
  calculateHaversineDistanceMeters,
  deactivateRepLiveLocation,
  dispatchGpsTrackingStatus,
  dispatchRepLiveCoords,
  getActiveBaghdadRouteDay,
  getCachedShopCoordinates,
  getRepTrackingId,
  GPS_RETRY_REQUEST_EVENT,
  GpsTrackingStatus,
  isFieldRepresentativeUser,
  normalizeTrackingText,
  OPEN_SHOP_ACTION_MODAL_EVENT,
  queueOpenShopActionModal,
  resolveRouteCoordinatesWithCache,
  upsertRepLiveLocation,
} from '../lib/fleetTrackingService';
import { getEffectiveRouteDay } from '../utils/routeUtils';
import { playBroadcastAlertToneAndVibrate } from '../utils/soundAlert';
import { RouteItem } from '../types';
import { X, AlertTriangle, RefreshCw, BellRing, ClipboardList } from 'lucide-react';

const SYNC_INTERVAL_MS = 60000; // 60 seconds (1 minute)

export const RepresentativeLiveTracker: React.FC = () => {
  const {
    currentUser,
    isLoggedIn,
    routes,
    salesEntries,
    allSalesEntries,
    setActiveTab,
    addToast,
    isDarkMode,
    geofenceRadiusMeters,
  } = useSales();

  const isRepUser = useMemo(
    () => Boolean(isLoggedIn && isFieldRepresentativeUser(currentUser)),
    [isLoggedIn, currentUser]
  );

  const repId = useMemo(() => getRepTrackingId(currentUser), [currentUser]);
  const repName = useMemo(
    () => String(currentUser?.name || currentUser?.delegateName || currentUser?.username || '').trim(),
    [currentUser]
  );

  const [isCompletedToday, setIsCompletedToday] = useState<boolean>(false);
  const [gpsStatus, setGpsStatus] = useState<GpsTrackingStatus>('idle');
  const [showPermissionPrompt, setShowPermissionPrompt] = useState<boolean>(false);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);
  const [exitReminderAlert, setExitReminderAlert] = useState<{
    route: RouteItem;
    distanceMeters: number;
  } | null>(null);

  const latestCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastSyncTimestampRef = useRef<number>(0);
  const insideGeofenceShopsRef = useRef<Set<string>>(new Set());
  const exitRemindedShopsRef = useRef<Set<string>>(new Set());
  const cachedCoordsRef = useRef(getCachedShopCoordinates());
  const geofenceRadiusRef = useRef<number>(geofenceRadiusMeters || 100);
  geofenceRadiusRef.current = geofenceRadiusMeters || 100;

  // Listen to today's completion status for this representative
  useEffect(() => {
    if (!isRepUser || !repName) {
      setIsCompletedToday(false);
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'daily_sales_completion'), where('date', '==', today));
    const unsub = safeOnSnapshot(
      q,
      (snap: any) => {
        const normRep = normalizeTrackingText(repName);
        let completed = false;
        snap.forEach((d: any) => {
          const data = d.data();
          const docDel = normalizeTrackingText(data?.delegate || d.id);
          if (docDel && normRep && (docDel === normRep || docDel.includes(normRep) || normRep.includes(docDel))) {
            completed = true;
          }
        });
        setIsCompletedToday(completed);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'RepTracker-completion'),
      'RepTracker-completion'
    );
    return () => unsub();
  }, [isRepUser, repName]);

  // Today's assigned route customers with GPS coordinates
  const todayAssignedRoutesRef = useRef<RouteItem[]>([]);
  const visitedTodayKeysRef = useRef<{ codes: Set<string>; nameDelegatesNoCode: Set<string> }>({
    codes: new Set(),
    nameDelegatesNoCode: new Set(),
  });

  useEffect(() => {
    const todayStr = getBaghdadDateAndSeconds().todayStr;
    const codes = new Set<string>();
    const nameDelegatesNoCode = new Set<string>();
    [...salesEntries, ...allSalesEntries].forEach((e) => {
      if (e.dateString === todayStr && e.status !== 'cancelled') {
        const eCode = String(e.customerCode || '').trim();
        if (eCode) {
          codes.add(eCode);
        } else if (e.customerName) {
          nameDelegatesNoCode.add(
            `${normalizeTrackingText(e.customerName)}::${normalizeTrackingText(e.delegateName)}`
          );
        }
      }
    });
    visitedTodayKeysRef.current = { codes, nameDelegatesNoCode };
    setExitReminderAlert((prev) => {
      if (!prev) return null;
      const pCode = String(prev.route.customerCode || '').trim();
      const pName = normalizeTrackingText(prev.route.customerName);
      const pDel = normalizeTrackingText(prev.route.delegateName);
      const matched = pCode
        ? codes.has(pCode)
        : Boolean(pName && nameDelegatesNoCode.has(`${pName}::${pDel}`));
      if (matched || prev.route.visitedToday) {
        return null;
      }
      return prev;
    });
  }, [salesEntries, allSalesEntries]);

  useEffect(() => {
    if (!isRepUser || !currentUser) {
      todayAssignedRoutesRef.current = [];
      return;
    }
    cacheShopCoordinatesLocally(routes);
    const cacheMap = getCachedShopCoordinates();
    cachedCoordsRef.current = cacheMap;

    const activeDayNorm = normalizeTrackingText(getActiveBaghdadRouteDay());
    const curName = normalizeTrackingText(currentUser.name);
    const curCode = normalizeTrackingText(currentUser.delegateCode);
    const curUser = normalizeTrackingText(currentUser.username);

    todayAssignedRoutesRef.current = routes.filter((r) => {
      const { latitude: lat, longitude: lng } = resolveRouteCoordinatesWithCache(r, cacheMap);
      if (lat === null || lng === null) return false;

      const rDelName = normalizeTrackingText(r.delegateName);
      const rDelCode = normalizeTrackingText(r.delegateCode);
      const matchesRep =
        (curName !== '' && (rDelName.includes(curName) || curName.includes(rDelName))) ||
        (curCode !== '' && (rDelCode === curCode || rDelName.includes(curCode))) ||
        (curUser !== '' && (rDelName.includes(curUser) || rDelCode === curUser));
      if (!matchesRep) return false;

      const effDay = normalizeTrackingText(getEffectiveRouteDay(r));
      return effDay.includes(activeDayNorm) || activeDayNorm.includes(effDay);
    });
  }, [isRepUser, currentUser, routes]);

  // Run local Haversine check against today's assigned customers
  const evaluateLocalGeofencing = (lat: number, lng: number) => {
    const assigned = todayAssignedRoutesRef.current;
    if (!assigned.length) return;

    const radiusMeters = geofenceRadiusRef.current || 100;
    const { codes, nameDelegatesNoCode } = visitedTodayKeysRef.current;

    for (const r of assigned) {
      const { latitude: shopLat, longitude: shopLng } = resolveRouteCoordinatesWithCache(
        r,
        cachedCoordsRef.current
      );
      if (shopLat === null || shopLng === null) continue;

      const cCode = String(r.customerCode || '').trim();
      const cNameNorm = normalizeTrackingText(r.customerName);
      const rDelNorm = normalizeTrackingText(r.delegateName);
      const shopKey = cCode || r.id;

      // Skip already visited/invoiced shops today
      const alreadyVisitedToday =
        Boolean(r.visitedToday) ||
        (cCode ? codes.has(cCode) : Boolean(cNameNorm && nameDelegatesNoCode.has(`${cNameNorm}::${rDelNorm}`)));
      if (alreadyVisitedToday) {
        insideGeofenceShopsRef.current.delete(shopKey);
        exitRemindedShopsRef.current.add(shopKey);
        continue;
      }

      const distance = calculateHaversineDistanceMeters(lat, lng, shopLat, shopLng);

      if (distance <= radiusMeters) {
        // Track entry silently without arrival notification or auto-opening invoice/action modal
        insideGeofenceShopsRef.current.add(shopKey);
        exitRemindedShopsRef.current.delete(shopKey);
      } else {
        // Check if representative just left the configured geofence without recording an invoice
        if (insideGeofenceShopsRef.current.has(shopKey) && !exitRemindedShopsRef.current.has(shopKey)) {
          insideGeofenceShopsRef.current.delete(shopKey);
          exitRemindedShopsRef.current.add(shopKey);

          // Trigger audio alert + device vibration
          playBroadcastAlertToneAndVibrate();
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
              navigator.vibrate([300, 120, 300, 120, 350]);
            } catch {}
          }

          // Trigger visual toast + interactive quick-action reminder banner
          addToast({
            title: 'هل نسيت تسجيل الزيارة لهذا المحل؟',
            message: `تمت مغادرة موقع المحل (${r.customerName}) دون تسجيل فاتورة أو زيارة`,
            type: 'reminder',
            delegateName: repName,
          });

          setExitReminderAlert({
            route: r,
            distanceMeters: Math.round(distance),
          });
        }
      }
    }
  };

  // Publish GPS tracking status for status indicators (e.g., RoutesScreen banner)
  useEffect(() => {
    dispatchGpsTrackingStatus(gpsStatus);
  }, [gpsStatus]);

  // Listen to retry requests triggered from RoutesScreen or UI
  useEffect(() => {
    const onRetry = () => {
      setShowPermissionPrompt(false);
      setRetryTrigger((v) => v + 1);
    };
    window.addEventListener(GPS_RETRY_REQUEST_EVENT, onRetry);
    return () => window.removeEventListener(GPS_RETRY_REQUEST_EVENT, onRetry);
  }, []);

  // Watch browser geolocation permission changes dynamically when supported
  useEffect(() => {
    if (!isRepUser || typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let cancelled = false;
    let permStatusObj: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (cancelled || !permStatusObj) return;
      if (permStatusObj.state === 'granted') {
        setShowPermissionPrompt(false);
        setRetryTrigger((v) => v + 1);
      } else if (permStatusObj.state === 'denied') {
        setGpsStatus('denied');
        setShowPermissionPrompt(true);
      }
    };

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((statusObj) => {
        if (cancelled) return;
        permStatusObj = statusObj;
        if (statusObj.state === 'denied') {
          setGpsStatus('denied');
        }
        statusObj.addEventListener('change', handlePermChange);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (permStatusObj) {
        permStatusObj.removeEventListener('change', handlePermChange);
      }
    };
  }, [isRepUser]);

  // Start/Stop geolocation capture (getCurrentPosition + watchPosition) & 60-second UPSERT interval
  useEffect(() => {
    if (!isRepUser || !repId) {
      setGpsStatus('idle');
      dispatchRepLiveCoords(null);
      return;
    }

    // Immediately deactivate if rep completed today's sales
    if (isCompletedToday) {
      setGpsStatus('idle');
      setShowPermissionPrompt(false);
      dispatchRepLiveCoords(null);
      deactivateRepLiveLocation(repId, repName);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('unavailable');
      return;
    }

    setGpsStatus('requesting');

    const syncNowIfDue = (force = false) => {
      const coords = latestCoordsRef.current;
      if (!coords) return;
      const now = Date.now();
      if (force || now - lastSyncTimestampRef.current >= SYNC_INTERVAL_MS) {
        lastSyncTimestampRef.current = now;
        upsertRepLiveLocation({
          repId,
          repName,
          delegateCode: currentUser?.delegateCode,
          latitude: Number(coords.latitude.toFixed(6)),
          longitude: Number(coords.longitude.toFixed(6)),
          isActive: true,
        });
      }
    };

    const handlePosition = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      setGpsStatus('active');
      setShowPermissionPrompt(false);
      latestCoordsRef.current = { latitude, longitude };
      dispatchRepLiveCoords({ latitude, longitude });
      // Append breadcrumb to rep's local today route trail (zero network overhead)
      appendRepTrailPoint(repId, latitude, longitude);
      // First fix pushes immediately, subsequent updates sync every 60s
      syncNowIfDue(lastSyncTimestampRef.current === 0);
      // Pure local client-side geofence evaluation
      evaluateLocalGeofencing(latitude, longitude);
    };

    const handlePositionError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setGpsStatus('denied');
        setShowPermissionPrompt(true);
      } else {
        console.warn('Geolocation watch warning:', err.message);
      }
    };

    // Trigger immediate GPS acquisition when shift/route begins
    navigator.geolocation.getCurrentPosition(handlePosition, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000,
    });

    const watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 20000,
    });

    const intervalId = setInterval(() => {
      syncNowIfDue(true);
    }, SYNC_INTERVAL_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(intervalId);
    };
  }, [isRepUser, isCompletedToday, repId, repName, currentUser?.delegateCode, retryTrigger]);

  const handleQuickOpenShopActions = (targetRoute: RouteItem) => {
    setExitReminderAlert(null);
    queueOpenShopActionModal(targetRoute);
    setActiveTab('routes');
    window.dispatchEvent(new CustomEvent(OPEN_SHOP_ACTION_MODAL_EVENT, { detail: { route: targetRoute } }));
  };

  if (
    !exitReminderAlert &&
    !(gpsStatus === 'denied' && showPermissionPrompt && !isCompletedToday)
  ) {
    return null;
  }

  const exitReminderBanner = exitReminderAlert ? (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[75] w-[94vw] max-w-md animate-in slide-in-from-top-5 fade-in duration-200"
      dir="rtl"
    >
      <div
        className={`rounded-2xl p-4 shadow-2xl border-2 space-y-3 ${
          isDarkMode
            ? 'bg-gradient-to-br from-slate-900 via-amber-950/90 to-slate-900 border-amber-500 text-white'
            : 'bg-gradient-to-br from-amber-50 via-white to-orange-50 border-amber-500 text-slate-900'
        }`}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-start gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center shadow-md shrink-0 animate-bounce">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-black text-sm text-amber-700 dark:text-amber-300 leading-snug">
                هل نسيت تسجيل الزيارة لهذا المحل؟
              </h4>
              <p className="text-xs font-black text-slate-800 dark:text-slate-100 mt-0.5">
                {exitReminderAlert.route.customerName} ({exitReminderAlert.route.customerCode})
              </p>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                تم رصد مغادرة موقع المحل دون تسجيل فاتورة أو توثيق الزيارة
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExitReminderAlert(null)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
            title="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleQuickOpenShopActions(exitReminderAlert.route)}
            className="flex-1 py-2.5 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <ClipboardList className="w-4 h-4 shrink-0" />
            <span>فتح قائمة الإجراءات للمحل</span>
          </button>
          <button
            type="button"
            onClick={() => setExitReminderAlert(null)}
            className={`py-2.5 px-3 rounded-xl font-bold text-xs cursor-pointer transition-colors ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                : 'bg-slate-200/80 hover:bg-slate-300 text-slate-700'
            }`}
          >
            تجاهل
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (gpsStatus === 'denied' && showPermissionPrompt && !isCompletedToday) {
    return (
      <>
        {exitReminderBanner}
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          dir="rtl"
          onClick={() => setShowPermissionPrompt(false)}
        >
          <div
            className={`w-full max-w-sm rounded-3xl p-5 shadow-2xl border-2 text-right space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode
                ? 'bg-slate-900 border-amber-500/60 text-white'
                : 'bg-white border-amber-500 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center shadow-lg shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-amber-600 dark:text-amber-400">
                    مطلوب تفعيل صلاحية الموقع (GPS)
                  </h3>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    تم رفض الوصول إلى الموقع الجغرافي
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPermissionPrompt(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div
              className={`p-3.5 rounded-2xl border text-xs font-bold leading-relaxed space-y-2 ${
                isDarkMode
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  : 'bg-amber-50 border-amber-200 text-amber-950'
              }`}
            >
              <p className="font-black">
                اضغط على أيقونة القفل 🔒 أو الإعدادات في شريط العنوان أعلى المتصفح ثم اختر: السماح بالموقع (Location → Allow).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRetryTrigger((v) => v + 1);
                }}
                className="flex-1 py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>إعادة المحاولة / تفعيل الموقع</span>
              </button>
              <button
                type="button"
                onClick={() => setShowPermissionPrompt(false)}
                className={`py-2.5 px-4 rounded-2xl font-bold text-xs cursor-pointer transition-all ${
                  isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                لاحقاً
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return exitReminderBanner;
};

