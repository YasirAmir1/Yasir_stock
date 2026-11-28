import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSales, getBaghdadDateAndSeconds } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, query, where } from 'firebase/firestore';
import { logFirestoreErrorGracefully, safeOnSnapshot } from '../lib/firestoreUtils';
import {
  appendRepTrailPoint,
  cacheShopCoordinatesLocally,
  calculateHaversineDistanceMeters,
  checkGeolocationPermissionState,
  deactivateRepLiveLocation,
  detectMobileOs,
  dispatchGpsTrackingStatus,
  dispatchRepLiveCoords,
  getPendingRepGpsCoords,
  getRepTrackingId,
  GPS_OPEN_HELP_MODAL_EVENT,
  GPS_POSITION_GRANTED_EVENT,
  GPS_RETRY_REQUEST_EVENT,
  GpsTrackingStatus,
  isFieldRepresentativeUser,
  isGeolocationSecureContext,
  mapGeolocationErrorToStatus,
  markPendingRepGpsCoordsSynced,
  normalizeTrackingText,
  REP_GPS_FORCE_SYNC_EVENT,
  requestGeolocationFromUserGesture,
  savePendingRepGpsCoords,
  upsertRepLiveLocation,
} from '../lib/fleetTrackingService';
import { X, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';

const SYNC_INTERVAL_MS = 10000; // 10 seconds live GPS capture & sync interval
const MIN_MOVEMENT_SYNC_MS = 3000; // Push faster (3s) when rep moves >= 40m
const MOVEMENT_SYNC_DISTANCE_METERS = 30;
const RETRY_SYNC_DELAY_MS = 3000; // Fast 3s retry if upload failed while network recovers

export const RepresentativeLiveTracker: React.FC = () => {
  const {
    currentUser,
    isLoggedIn,
    routes,
    salesEntries,
    allSalesEntries,
    isDarkMode,
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

  const mobileOs = useMemo(() => detectMobileOs(), []);

  const [isCompletedToday, setIsCompletedToday] = useState<boolean>(false);
  const [gpsStatus, setGpsStatus] = useState<GpsTrackingStatus>('idle');
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState<boolean>(false);
  const [isModalClosedByUser, setIsModalClosedByUser] = useState<boolean>(false);
  const [isRequestingFromModal, setIsRequestingFromModal] = useState<boolean>(false);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);

  const permissionGrantedRef = useRef<boolean>(false);
  permissionGrantedRef.current = permissionGranted;
  const hasAcquiredFixRef = useRef<boolean>(false);
  const pendingGesturePosRef = useRef<GeolocationPosition | null>(null);
  const processIncomingPositionRef = useRef<((pos: GeolocationPosition, forceSync?: boolean) => void) | null>(null);

  const latestCoordsRef = useRef<{ latitude: number; longitude: number; updatedAt: number } | null>(null);
  const lastSyncedCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastSyncTimestampRef = useRef<number>(0);
  const isSyncingRef = useRef<boolean>(false);
  const pendingOnlineSyncRef = useRef<boolean>(false);
  const requestFreshFixRef = useRef<((forceSync?: boolean) => void) | null>(null);
  const prevSalesCountRef = useRef<number>(0);

  // Listen to today's completion status for this representative
  useEffect(() => {
    if (!isRepUser || !repName) {
      setIsCompletedToday(false);
      return;
    }

    const today = getBaghdadDateAndSeconds().todayStr;
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

  useEffect(() => {
    const totalCount = salesEntries.length + allSalesEntries.length;
    if (prevSalesCountRef.current > 0 && totalCount > prevSalesCountRef.current) {
      requestFreshFixRef.current?.(true);
    }
    prevSalesCountRef.current = totalCount;
  }, [salesEntries, allSalesEntries]);

  useEffect(() => {
    if (!isRepUser || !currentUser) return;
    cacheShopCoordinatesLocally(routes);
  }, [isRepUser, currentUser, routes]);

  // Publish GPS tracking status for status indicators (e.g., RoutesScreen banner)
  useEffect(() => {
    dispatchGpsTrackingStatus(gpsStatus);
  }, [gpsStatus]);

  // Listen to synchronous user-gesture location events & explicit help modal triggers
  useEffect(() => {
    const onPositionGranted = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const pos = detail?.position as GeolocationPosition | undefined;
      hasAcquiredFixRef.current = true;
      setShowPermissionPrompt(false);
      setIsModalClosedByUser(false);
      setIsRequestingFromModal(false);
      setGpsStatus('active');

      if (pos) {
        if (permissionGrantedRef.current && processIncomingPositionRef.current) {
          processIncomingPositionRef.current(pos, true);
        } else {
          pendingGesturePosRef.current = pos;
          setPermissionGranted(true);
          setRetryTrigger((v) => v + 1);
        }
      } else {
        setPermissionGranted(true);
        setRetryTrigger((v) => v + 1);
      }
    };

    const onOpenHelpModal = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const nextStatus = detail?.status as GpsTrackingStatus | undefined;
      if (nextStatus) {
        setGpsStatus(nextStatus);
        if (nextStatus === 'denied' || nextStatus === 'insecure' || nextStatus === 'unavailable') {
          setPermissionGranted(false);
        }
      }
      setIsRequestingFromModal(false);
      setIsModalClosedByUser(false);
      setShowPermissionPrompt(true);
    };

    const onLegacyRetry = () => {
      if (permissionGrantedRef.current) {
        setShowPermissionPrompt(false);
        setIsModalClosedByUser(false);
        setRetryTrigger((v) => v + 1);
      } else {
        setIsModalClosedByUser(false);
        setShowPermissionPrompt(true);
      }
    };

    window.addEventListener(GPS_POSITION_GRANTED_EVENT, onPositionGranted);
    window.addEventListener(GPS_OPEN_HELP_MODAL_EVENT, onOpenHelpModal);
    window.addEventListener(GPS_RETRY_REQUEST_EVENT, onLegacyRetry);
    return () => {
      window.removeEventListener(GPS_POSITION_GRANTED_EVENT, onPositionGranted);
      window.removeEventListener(GPS_OPEN_HELP_MODAL_EVENT, onOpenHelpModal);
      window.removeEventListener(GPS_RETRY_REQUEST_EVENT, onLegacyRetry);
    };
  }, []);

  // Check HTTPS, browser support & permission state WITHOUT auto-triggering permission prompt on mount;
  // mandatory modal remains shown until GPS is enabled & active.
  useEffect(() => {
    if (!isRepUser || !repId || isCompletedToday) {
      hasAcquiredFixRef.current = false;
      setPermissionGranted(false);
      setShowPermissionPrompt(false);
      return;
    }

    let cancelled = false;
    let permStatusObj: PermissionStatus | null = null;

    const syncPermissionState = async () => {
      const state = await checkGeolocationPermissionState();
      if (cancelled) return;

      if (state === 'insecure') {
        setPermissionGranted(false);
        setGpsStatus('insecure');
        setShowPermissionPrompt(true);
        return;
      }

      if (state === 'unavailable') {
        setPermissionGranted(false);
        setGpsStatus('unavailable');
        setShowPermissionPrompt(true);
        return;
      }

      if (state === 'granted') {
        setShowPermissionPrompt(false);
        setPermissionGranted(true);
        return;
      }

      if (state === 'denied') {
        setPermissionGranted(false);
        setGpsStatus('denied');
        setShowPermissionPrompt(true);
        return;
      }

      // state === 'prompt': show mandatory activation modal without auto-calling geolocation before tap
      if (!permissionGrantedRef.current) {
        setGpsStatus('prompt');
        setShowPermissionPrompt(true);
      }
    };

    void syncPermissionState();

    // Observe dynamic permission changes & also re-check when returning from mobile OS Settings app
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((statusObj) => {
          if (cancelled) return;
          permStatusObj = statusObj;
          statusObj.addEventListener('change', syncPermissionState);
        })
        .catch(() => {});
    }

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void syncPermissionState();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if (permStatusObj) {
        permStatusObj.removeEventListener('change', syncPermissionState);
      }
    };
  }, [isRepUser, repId, isCompletedToday]);

  // Deactivate tracking cleanly on logout or day completion, and flush offline backlog if awaiting permission
  useEffect(() => {
    if (!isRepUser || !repId) {
      setGpsStatus('idle');
      requestFreshFixRef.current = null;
      dispatchRepLiveCoords(null);
      return;
    }

    if (isCompletedToday) {
      setGpsStatus('idle');
      setShowPermissionPrompt(false);
      requestFreshFixRef.current = null;
      dispatchRepLiveCoords(null);
      deactivateRepLiveLocation(repId, repName);
      return;
    }

    if (!permissionGranted) {
      // Flush any unsynced coordinates captured prior to reload if online, without invoking geolocation API
      const persistedPending = getPendingRepGpsCoords(repId);
      if (persistedPending && !persistedPending.synced) {
        dispatchRepLiveCoords({
          latitude: persistedPending.latitude,
          longitude: persistedPending.longitude,
        });
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          void upsertRepLiveLocation({
            repId,
            repName,
            delegateCode: currentUser?.delegateCode,
            latitude: persistedPending.latitude,
            longitude: persistedPending.longitude,
            isActive: true,
            updatedAtIso:
              Date.now() - persistedPending.capturedAt > 60000
                ? new Date(persistedPending.capturedAt).toISOString()
                : new Date().toISOString(),
          }).then((ok) => {
            if (ok) markPendingRepGpsCoordsSynced(repId, persistedPending.capturedAt);
          });
        }
      }
    }
  }, [isRepUser, isCompletedToday, repId, repName, currentUser?.delegateCode, permissionGranted]);

  // Start/Stop active geolocation capture ONLY once permission is granted or activated via user gesture
  useEffect(() => {
    if (!isRepUser || !repId || isCompletedToday || !permissionGranted) {
      requestFreshFixRef.current = null;
      processIncomingPositionRef.current = null;
      return;
    }

    if (!isGeolocationSecureContext()) {
      setGpsStatus('insecure');
      setPermissionGranted(false);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('unavailable');
      setPermissionGranted(false);
      return;
    }

    let disposed = false;
    let watchId: number | null = null;
    let retryTimerId: number | null = null;
    let lastWatchFixAt = Date.now();
    let requestStartedAt = 0;

    if (!pendingGesturePosRef.current) {
      setGpsStatus('requesting');
    }

    // Hydrate any unsynced coordinates saved while offline (survives app reload / background tab discard)
    const persistedPending = getPendingRepGpsCoords(repId);
    if (persistedPending && !persistedPending.synced) {
      latestCoordsRef.current = {
        latitude: persistedPending.latitude,
        longitude: persistedPending.longitude,
        updatedAt: persistedPending.capturedAt,
      };
      pendingOnlineSyncRef.current = true;
      dispatchRepLiveCoords({
        latitude: persistedPending.latitude,
        longitude: persistedPending.longitude,
      });
    }

    const clearRetryTimer = () => {
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
        retryTimerId = null;
      }
    };

    const scheduleFastRetry = () => {
      if (disposed || retryTimerId !== null) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      retryTimerId = window.setTimeout(() => {
        retryTimerId = null;
        if (!disposed && pendingOnlineSyncRef.current) {
          void syncNowIfDue(true);
        }
      }, RETRY_SYNC_DELAY_MS);
    };

    const syncNowIfDue = async (force = false) => {
      if (disposed) return;
      // Fallback to persisted pending GPS record if memory ref was cleared
      if (!latestCoordsRef.current) {
        const stored = getPendingRepGpsCoords(repId);
        if (stored && !stored.synced) {
          latestCoordsRef.current = {
            latitude: stored.latitude,
            longitude: stored.longitude,
            updatedAt: stored.capturedAt,
          };
          pendingOnlineSyncRef.current = true;
        }
      }
      const coords = latestCoordsRef.current;
      if (!coords) return;

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        pendingOnlineSyncRef.current = true;
        savePendingRepGpsCoords(repId, coords.latitude, coords.longitude, coords.updatedAt, false);
        return;
      }

      if (isSyncingRef.current) {
        if (force) pendingOnlineSyncRef.current = true;
        return;
      }

      const now = Date.now();
      if (!force && !pendingOnlineSyncRef.current && now - lastSyncTimestampRef.current < SYNC_INTERVAL_MS) {
        return;
      }

      const capturedAtSnapshot = coords.updatedAt;
      const latSnapshot = Number(coords.latitude.toFixed(6));
      const lngSnapshot = Number(coords.longitude.toFixed(6));
      // Always store exact capture time of this newest coordinate
      const updatedAtIso = new Date(capturedAtSnapshot).toISOString();

      isSyncingRef.current = true;
      try {
        const ok = await upsertRepLiveLocation({
          repId,
          repName,
          delegateCode: currentUser?.delegateCode,
          latitude: latSnapshot,
          longitude: lngSnapshot,
          isActive: true,
          updatedAtIso,
        });
        if (ok) {
          clearRetryTimer();
          lastSyncTimestampRef.current = Date.now();
          lastSyncedCoordsRef.current = { latitude: latSnapshot, longitude: lngSnapshot };
          markPendingRepGpsCoordsSynced(repId, capturedAtSnapshot);

          // If even newer coordinates arrived while upload was in flight, immediately flush them next
          const newest = latestCoordsRef.current;
          if (newest && newest.updatedAt > capturedAtSnapshot) {
            pendingOnlineSyncRef.current = true;
            scheduleFastRetry();
          } else {
            pendingOnlineSyncRef.current = false;
          }
        } else {
          pendingOnlineSyncRef.current = true;
          savePendingRepGpsCoords(repId, latSnapshot, lngSnapshot, capturedAtSnapshot, false);
          scheduleFastRetry();
        }
      } finally {
        isSyncingRef.current = false;
      }
    };

    const handlePosition = (position: GeolocationPosition, forceSyncOverride = false) => {
      if (disposed) return;
      const { latitude, longitude } = position.coords;
      const now = Date.now();
      lastWatchFixAt = now;
      hasAcquiredFixRef.current = true;
      setGpsStatus('active');
      setShowPermissionPrompt(false);

      // Completely replace any previous coordinate with the newly captured position
      latestCoordsRef.current = { latitude, longitude, updatedAt: now };
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      savePendingRepGpsCoords(repId, latitude, longitude, now, false);
      if (isOffline) {
        pendingOnlineSyncRef.current = true;
      }

      dispatchRepLiveCoords({ latitude, longitude });
      appendRepTrailPoint(repId, latitude, longitude);

      // Push immediately on first fix, 30s interval, movement >= 40m (after 10s), or pending offline flush
      let movedSignificantly = false;
      if (lastSyncedCoordsRef.current && now - lastSyncTimestampRef.current >= MIN_MOVEMENT_SYNC_MS) {
        const movedMeters = calculateHaversineDistanceMeters(
          lastSyncedCoordsRef.current.latitude,
          lastSyncedCoordsRef.current.longitude,
          latitude,
          longitude
        );
        movedSignificantly = movedMeters >= MOVEMENT_SYNC_DISTANCE_METERS;
      }

      void syncNowIfDue(
        forceSyncOverride ||
          lastSyncTimestampRef.current === 0 ||
          pendingOnlineSyncRef.current ||
          movedSignificantly
      );
    };

    processIncomingPositionRef.current = handlePosition;

    const handlePositionError = (err: GeolocationPositionError) => {
      if (disposed) return;
      const mapped = mapGeolocationErrorToStatus(err);
      if (mapped === 'denied') {
        setPermissionGranted(false);
        setGpsStatus('denied');
        setShowPermissionPrompt(true);
      } else if (mapped === 'gps_off') {
        setGpsStatus('gps_off');
        setShowPermissionPrompt(true);
      } else if (mapped === 'timeout') {
        setGpsStatus('timeout');
        if (!hasAcquiredFixRef.current) {
          setShowPermissionPrompt(true);
        }
      } else {
        console.warn('Geolocation watch warning:', err.message);
      }
    };

    const requestFreshPosition = (forceSync = false) => {
      if (disposed) return;
      const now = Date.now();
      if (!forceSync && requestStartedAt > 0 && now - requestStartedAt < 10000) return;
      if (forceSync && requestStartedAt > 0 && now - requestStartedAt < 4000) return;
      requestStartedAt = now;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          requestStartedAt = 0;
          handlePosition(pos, forceSync);
        },
        (err) => {
          if (disposed) {
            requestStartedAt = 0;
            return;
          }
          // Permission denied or device GPS switched OFF: report immediately, do NOT fall back to old/coarse location
          if (err.code === 1 || err.code === 2) {
            requestStartedAt = 0;
            handlePositionError(err);
            return;
          }
          // On TIMEOUT indoors (code === 3), try fresh (maximumAge: 0) network/Wi-Fi triangulation once
          navigator.geolocation.getCurrentPosition(
            (fallbackPos) => {
              requestStartedAt = 0;
              handlePosition(fallbackPos, forceSync);
            },
            (fallbackErr) => {
              requestStartedAt = 0;
              handlePositionError(fallbackErr);
            },
            {
              enableHighAccuracy: false,
              maximumAge: 0,
              timeout: 8000,
            }
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 12000,
        }
      );
    };

    requestFreshFixRef.current = requestFreshPosition;

    const startWatch = () => {
      if (disposed) return;
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {}
        watchId = null;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos) => handlePosition(pos, false),
        handlePositionError,
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        }
      );
    };

    // Consume synchronous position obtained from user tap right away, or request a fresh position
    if (pendingGesturePosRef.current) {
      const gesturePos = pendingGesturePosRef.current;
      pendingGesturePosRef.current = null;
      handlePosition(gesturePos, true);
    } else {
      if (pendingOnlineSyncRef.current && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        void syncNowIfDue(true);
      }
      requestFreshPosition(true);
    }
    startWatch();

    // Every 30 seconds: acquire a brand-new uncached GPS position, discard previous location, and push to server
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      if (now - lastWatchFixAt > 15000) {
        startWatch();
      }
      requestFreshPosition(true);
    }, SYNC_INTERVAL_MS);

    // Immediately flush last offline-captured coordinates AND acquire fresh GPS when internet returns
    const handleOnline = () => {
      clearRetryTimer();
      const stored = getPendingRepGpsCoords(repId);
      if (stored && !stored.synced && (!latestCoordsRef.current || stored.capturedAt >= latestCoordsRef.current.updatedAt)) {
        latestCoordsRef.current = {
          latitude: stored.latitude,
          longitude: stored.longitude,
          updatedAt: stored.capturedAt,
        };
      }
      if (latestCoordsRef.current) {
        pendingOnlineSyncRef.current = true;
        void syncNowIfDue(true);
      }
      startWatch();
      requestFreshPosition(true);
    };

    const handleOffline = () => {
      clearRetryTimer();
      if (latestCoordsRef.current) {
        pendingOnlineSyncRef.current = true;
        savePendingRepGpsCoords(
          repId,
          latestCoordsRef.current.latitude,
          latestCoordsRef.current.longitude,
          latestCoordsRef.current.updatedAt,
          false
        );
      }
    };

    // Also react to mobile network transitions (e.g. Wi-Fi <-> 4G/3G) via NetworkInformation API when available
    const netConn = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
    const handleNetworkChange = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        handleOnline();
      } else {
        handleOffline();
      }
    };

    // Immediately flush pending offline fix & re-acquire GPS when delegate unlocks phone or returns to the app
    const handleAppResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (pendingOnlineSyncRef.current && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        void syncNowIfDue(true);
      }
      const staleWatch = Date.now() - lastWatchFixAt > 15000;
      const staleSync = Date.now() - lastSyncTimestampRef.current >= 15000;
      if (staleWatch) {
        startWatch();
      }
      if (staleWatch || staleSync || pendingOnlineSyncRef.current || !latestCoordsRef.current) {
        requestFreshPosition(true);
      }
    };

    const handleForceSyncEvent = () => {
      requestFreshPosition(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleAppResume);
    window.addEventListener('pageshow', handleAppResume);
    document.addEventListener('visibilitychange', handleAppResume);
    window.addEventListener(REP_GPS_FORCE_SYNC_EVENT, handleForceSyncEvent);
    if (netConn && typeof netConn.addEventListener === 'function') {
      netConn.addEventListener('change', handleNetworkChange);
    }

    return () => {
      disposed = true;
      requestFreshFixRef.current = null;
      processIncomingPositionRef.current = null;
      clearRetryTimer();
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {}
      }
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleAppResume);
      window.removeEventListener('pageshow', handleAppResume);
      document.removeEventListener('visibilitychange', handleAppResume);
      window.removeEventListener(REP_GPS_FORCE_SYNC_EVENT, handleForceSyncEvent);
      if (netConn && typeof netConn.removeEventListener === 'function') {
        netConn.removeEventListener('change', handleNetworkChange);
      }
    };
  }, [isRepUser, isCompletedToday, repId, repName, currentUser?.delegateCode, permissionGranted, retryTrigger]);

  const handleModalActivateClick = () => {
    setIsRequestingFromModal(true);
    // Synchronously invoke getCurrentPosition inside the click handler (required for iOS Safari & Android Chrome)
    requestGeolocationFromUserGesture({
      openHelpOnError: true,
      onSuccess: () => {
        setIsRequestingFromModal(false);
        setShowPermissionPrompt(false);
      },
      onError: () => {
        setIsRequestingFromModal(false);
      },
    });
  };

  const hasBlockingGpsIssue =
    isRepUser &&
    !isCompletedToday &&
    (gpsStatus === 'prompt' ||
      gpsStatus === 'denied' ||
      gpsStatus === 'gps_off' ||
      gpsStatus === 'insecure' ||
      gpsStatus === 'unavailable' ||
      (gpsStatus === 'timeout' && !hasAcquiredFixRef.current) ||
      (gpsStatus === 'requesting' && (showPermissionPrompt || !hasAcquiredFixRef.current)));

  const isMandatoryGpsModalVisible = hasBlockingGpsIssue && !isModalClosedByUser;

  if (!isMandatoryGpsModalVisible) {
    return null;
  }

  if (isMandatoryGpsModalVisible) {
    const modalTitle =
      gpsStatus === 'insecure'
        ? 'الموقع يتطلب اتصالاً آمناً (HTTPS)'
        : gpsStatus === 'gps_off'
        ? 'خدمة الموقع (GPS) متوقفة في الهاتف'
        : gpsStatus === 'timeout'
        ? 'انتهت مهلة تحديد الموقع (GPS)'
        : gpsStatus === 'unavailable'
        ? 'المتصفح لا يدعم تحديد الموقع (GPS)'
        : gpsStatus === 'prompt' || gpsStatus === 'requesting'
        ? 'تفعيل صلاحية الموقع (GPS)'
        : 'مطلوب تفعيل صلاحية الموقع (GPS)';

    const modalSubtitle =
      gpsStatus === 'insecure'
        ? 'يمنع نظام الهاتف استخدام GPS على روابط HTTP غير المشفرة'
        : gpsStatus === 'gps_off'
        ? 'يرجى تشغيل GPS / خدمات الموقع من إعدادات الهاتف للمتابعة'
        : gpsStatus === 'timeout'
        ? 'تعذر التقاط إشارة GPS دقيقة في الوقت المحدد'
        : gpsStatus === 'unavailable'
        ? 'استخدم متصفح Chrome على Android أو Safari على iPhone'
        : gpsStatus === 'prompt' || gpsStatus === 'requesting'
        ? 'يرجى تفعيل صلاحية الموقع (GPS) لتأكيد الزيارات والمسار'
        : 'تم رفض الوصول إلى الموقع الجغرافي — يرجى تفعيله من الإعدادات';

    return (
      <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
          dir="rtl"
          onClick={() => setIsModalClosedByUser(true)}
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
                    {modalTitle}
                  </h3>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    {modalSubtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalClosedByUser(true)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0 transition-colors"
                title="إغلاق مؤقت (سيُطلب عند إنشاء فاتورة للزبون)"
                aria-label="إغلاق مؤقت"
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
              {gpsStatus === 'insecure' ? (
                <p>
                  يرجى فتح التطبيق عبر رابط آمن يبدأ بـ <span dir="ltr" className="font-mono">https://</span> لأن متصفحات Android وiPhone توقف صلاحية GPS تلقائياً على الاتصالات غير الآمنة (HTTP).
                </p>
              ) : gpsStatus === 'gps_off' ? (
                <>
                  <p className="font-black">لتشغيل GPS في الهاتف:</p>
                  {mobileOs === 'ios' ? (
                    <p>• في iPhone: الإعدادات ← الخصوصية والأمن ← خدمات الموقع (تفعيل)، ثم اختر Safari ← «أثناء استخدام التطبيق» وفعّل «الموقع الدقيق».</p>
                  ) : mobileOs === 'android' ? (
                    <p>• في Android: اسحب شريط الإشعارات وفعّل «الموقع / Location»، أو من الإعدادات ← الموقع ← تفعيل مع تفعيل «دقة الموقع العالية».</p>
                  ) : (
                    <>
                      <p>• في Android: فعّل الموقع (Location) من شريط الإشعارات أو الإعدادات.</p>
                      <p>• في iPhone: الإعدادات ← الخصوصية والأمن ← خدمات الموقع ← تفعيل.</p>
                    </>
                  )}
                </>
              ) : gpsStatus === 'timeout' ? (
                <>
                  <p className="font-black">نصائح لتحسين سرعة التقاط GPS:</p>
                  <p>• انتقل إلى مكان مكشوف أو قرب نافذة واضحة.</p>
                  <p>• تأكد من تفعيل «الموقع الدقيق / Precise Location» والإنترنت أو Wi-Fi ثم أعد المحاولة.</p>
                </>
              ) : gpsStatus === 'unavailable' ? (
                <p>
                  المتصفح المستخدم حالياً لا يوفر واجهة تحديد الموقع. يرجى فتح النظام من متصفح Google Chrome على Android أو Safari على iPhone.
                </p>
              ) : gpsStatus === 'prompt' || gpsStatus === 'requesting' ? (
                <>
                  <p className="font-black">
                    اضغط على «تفعيل الموقع الآن» ثم اختر السماح (Allow) مع تفعيل «الموقع الدقيق / Precise Location» لتأكيد زيارة المحلات وتحديث المسار.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-black">لتفعيل صلاحية الموقع والموقع الدقيق (Precise Location):</p>
                  {(mobileOs === 'ios' || mobileOs === 'other') && (
                    <div className="space-y-1">
                      <p className="font-black underline">في الآيفون (iPhone / Safari أو Chrome):</p>
                      <p>1. افتح إعدادات الهاتف ← الخصوصية والأمن ← خدمات الموقع (تشغيل).</p>
                      <p>2. اختر المتصفح (Safari أو Chrome) ← «أثناء استخدام التطبيق».</p>
                      <p>3. فعّل خيار «الموقع الدقيق / Precise Location».</p>
                      <p>4. أو من شريط العنوان في Safari اضغط (AA / أيقونة الإعدادات) ← إعدادات موقع الويب ← الموقع ← سماح.</p>
                    </div>
                  )}
                  {(mobileOs === 'android' || mobileOs === 'other') && (
                    <div className="space-y-1">
                      <p className="font-black underline">في الأندرويد (Android / Chrome):</p>
                      <p>1. اضغط أيقونة الإعدادات/القفل 🔒 بجانب رابط الموقع في الأعلى ← الأذونات ← الموقع ← السماح، وفعّل «استخدام الموقع الدقيق».</p>
                      <p>2. وتأكد من تشغيل الموقع في الهاتف: الإعدادات ← التطبيقات ← Chrome ← الأذونات ← الموقع ← السماح أثناء الاستخدام.</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {gpsStatus !== 'insecure' && gpsStatus !== 'unavailable' && (
              <button
                type="button"
                disabled={isRequestingFromModal || gpsStatus === 'requesting'}
                onClick={handleModalActivateClick}
                className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-black text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {isRequestingFromModal || gpsStatus === 'requesting' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>
                  {isRequestingFromModal || gpsStatus === 'requesting'
                    ? 'جاري تحديد الموقع...'
                    : gpsStatus === 'prompt'
                    ? 'تفعيل الموقع الآن'
                    : 'إعادة المحاولة / تفعيل الموقع'}
                </span>
              </button>
            )}
        </div>
      </div>
    );
  }

  return null;
};


