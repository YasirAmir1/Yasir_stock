import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSales, getFixedDelegatePhone } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { logFirestoreErrorGracefully, isGlobalQuotaExceeded, cleanFirestoreData } from '../lib/firestoreUtils';
import { collection, query, where, updateDoc, doc, writeBatch, getDocs, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { safeOnSnapshot } from '../lib/firestoreUtils';
import { RouteItem, DebtItem, SalesEntry, DamagedProductItem, DamagedProductStatus, CustomerInfoNote, CUSTOMER_INFO_OPTIONS, ShopLocationRecord, NewCustomerDefinition, UnsuccessfulVisit, EndOfDayUnvisitedShop, DailyUnvisitedSnapshot } from '../types';
import { parseArabicDigits } from '../utils/numberUtils';
import { CheckCircle2, Circle, AlertCircle, AlertTriangle, ArrowUp, Upload, CheckSquare, Square, ShoppingBag, MapPin, Phone, User, CreditCard, Save, Search, X, FileSpreadsheet, Download, Calendar, Users, XCircle, ChevronDown, ChevronUp, Clock, Pause, Play, MessageCircle, FileText, Trash2, Send, PlusCircle, Lock, ShieldCheck, RotateCcw, Edit3, Navigation, Loader2, ExternalLink, Crosshair, Copy, Check, Store } from 'lucide-react';
import { getFormattedWeekday, formatEnglishDate, formatEnglishDateTime } from '../utils/dateUtils';
import { getEffectiveRouteDay, isRouteOverrideActive, shiftCustomerRouteTemporarily, revertCustomerRouteOverride } from '../utils/routeUtils';
import { SaladinFleetMap } from './SaladinFleetMap';
import { EndOfDayRouteReport } from './EndOfDayRouteReport';
import { NewCustomerDefinitionModal } from './NewCustomerDefinitionModal';
import { NewCustomerDefinitionsSection } from './NewCustomerDefinitionsSection';
import { CustomerVisitModal } from './CustomerVisitModal';
import { UnsuccessfulVisitModal } from './UnsuccessfulVisitModal';
import { UnsuccessfulVisitsSection } from './UnsuccessfulVisitsSection';
import {
  isFieldRepresentativeUser,
  parseCoordinate,
  parseShopLocationString,
  formatShopLocationString,
  saveCustomerCoordinates,
  deleteCustomerCoordinates,
  bulkUpdateRouteLocations,
  getRepTrackingId,
  GPS_STATUS_EVENT,
  GPS_RETRY_REQUEST_EVENT,
  GPS_POSITION_GRANTED_EVENT,
  GPS_OPEN_HELP_MODAL_EVENT,
  GpsTrackingStatus,
  getLastKnownGpsTrackingStatus,
  isGeolocationSecureContext,
  mapGeolocationErrorToStatus,
  requestGeolocationFromUserGesture,
  calculateHaversineDistanceMeters,
  cacheShopCoordinatesLocally,
  removeCachedShopCoordinates,
  getCachedShopCoordinates,
  resolveRouteCoordinatesWithCache,
  REP_COORDS_EVENT,
  RepLiveCoords,
  getLastKnownRepCoords,
  dispatchRepLiveCoords,
  REP_GPS_FORCE_SYNC_EVENT,
  OPEN_SHOP_ACTION_MODAL_EVENT,
  consumePendingShopActionRoute,
  isShortOrExternalMapsUrl,
  resolveShopLocationInput,
  resolveShopLocationInputsBatch,
} from '../lib/fleetTrackingService';


// Helper to format HH:MM into 12-hour English format (e.g. 11:30 PM)
const formatTo12HourArabic = (timeStr?: string): string => {
  if (!timeStr) return '';
  try {
    const [hStr, mRaw] = timeStr.split(':');
    let h = parseInt(hStr, 10);
    const m = (mRaw || '00').trim().split(' ')[0].padStart(2, '0');
    if (isNaN(h)) return timeStr;
    const isPM = timeStr.toUpperCase().includes('PM') || timeStr.includes('م');
    const isAM = timeStr.toUpperCase().includes('AM') || timeStr.includes('ص');
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
  } catch {
    return timeStr || '';
  }
};
const normalizeArabic = (text: any): string => {
  if (text === null || text === undefined) return '';
  return String(text)
    .trim()
    .toLowerCase()
    // Replace Arabic-Indic digits with standard digits (e.g. ١٢٣ -> 123)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    // Remove diacritics / tashkeel
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize Alefs
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize Ta Marbuta to Ha
    .replace(/ة/g, 'ه')
    // Normalize Ya and Alef Maqsura
    .replace(/[يى]/g, 'ي')
    // Remove tatweel (kashida)
    .replace(/ـ/g, '')
    // Collapse multiple whitespace
    .replace(/\s+/g, ' ');
};

// Helper to format debt amounts without decimal numbers: 1,000.4 -> 1,000
const formatDebtAmount = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '0';
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return '0';
  return Math.round(num).toLocaleString('en-US', {
    maximumFractionDigits: 0
  });
};

const isHiddenDelegateForFilter = (name: any): boolean => {
  if (!name) return false;
  const norm = normalizeArabic(name);
  if (!norm) return false;
  return (
    norm.includes('مندوب عام 1') ||
    norm.includes('مندوب عام 2') ||
    norm.includes('مندوب عام 1 و2') ||
    norm.includes('مندوب عام 1 و 2') ||
    norm.includes('مندوب عام 1و2') ||
    norm.includes('محمد الصلصات') ||
    norm.includes('محمد صلصات') ||
    (norm.includes('صلصات') && norm.includes('محمد')) ||
    norm.includes('رافت جمال') ||
    norm.includes('رأفت جمال')
  );
};

export const RoutesScreen: React.FC = () => {
  const salesContext = useSales();
  const { currentUser, delegatesList = [], delegateAccounts = [], isDarkMode, setPrefilledEntryData, setShowQuickAdd, setActiveTab, setSelectedDelegate, salesEntries, allSalesEntries, addToast, geofenceRadiusMeters = 100 } = salesContext;
  const productsList = salesContext.productsList || [];

  // Data Entry account check
  const isDataEntry = Boolean(
    currentUser?.role === 'dataEntry' ||
    currentUser?.username?.toLowerCase() === 'rafatdata' ||
    currentUser?.roleName?.includes('مدخل') ||
    currentUser?.name?.includes('مدخل') ||
    currentUser?.name === 'رأفت جمال' ||
    currentUser?.delegateName === 'رأفت جمال'
  );
  const isRafatJamal = Boolean(currentUser?.name === 'رأفت جمال' || currentUser?.username?.toLowerCase() === 'rafatdata');

  // Monthly reports visible for Data Entry and Admin, strictly hidden from delegates
  const canViewMonthlyReports = Boolean(
    (currentUser?.isAdmin || isDataEntry) && currentUser?.role !== 'delegate'
  );
  const isAdminUser = Boolean(
    (currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.name === 'الأدمن') &&
      currentUser?.role !== 'delegate'
  );
  const isStrictAdmin = Boolean(isAdminUser && !isDataEntry);

  const effectiveDelegateCode = useMemo(() => {
    if (currentUser?.delegateCode) return String(currentUser.delegateCode).trim();
    const account = delegateAccounts.find(
      (a) =>
        (a.delegateName && currentUser?.name && normalizeArabic(a.delegateName) === normalizeArabic(currentUser?.name)) ||
        (a.username && currentUser?.username && a.username.toLowerCase() === currentUser?.username.toLowerCase())
    );
    return account?.delegateCode ? String(account.delegateCode).trim() : undefined;
  }, [currentUser, delegateAccounts]);

  const parseDateToMidnight = (dateStr?: string) => {
    if (!dateStr) return null;
    const parts = String(dateStr).trim().split(/[-/]/);
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return new Date(y, m, d, 0, 0, 0, 0);
      }
    }
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime())) return null;
    dt.setHours(0, 0, 0, 0);
    return dt;
  };

  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [routesLoaded, setRoutesLoaded] = useState<boolean>(false);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [debtsLoaded, setDebtsLoaded] = useState<boolean>(false);
  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [manualVisits, setManualVisits] = useState<Record<string, boolean>>({});
  const [unlockedCustomerCodes, setUnlockedCustomerCodes] = useState<Record<string, boolean>>({});

  // Customer info notes state & listeners
  const [customerNotes, setCustomerNotes] = useState<CustomerInfoNote[]>([]);
  const [availableOptions, setAvailableOptions] = useState<string[]>(CUSTOMER_INFO_OPTIONS);
  const [newOptionInput, setNewOptionInput] = useState<string>('');
  const [actionModalRoute, setActionModalRoute] = useState<RouteItem | null>(null);
  const [actionModalStep, setActionModalStep] = useState<'choice' | 'other_info' | 'shop_location' | null>(null);
  const [selectedOption, setSelectedOption] = useState<string>(CUSTOMER_INFO_OPTIONS[0]);
  const [otherInfoNotesInput, setOtherInfoNotesInput] = useState<string>('');
  const [isSubmittingNote, setIsSubmittingNote] = useState<boolean>(false);
  const [notesSearchQuery, setNotesSearchQuery] = useState<string>('');
  const [notesActionFilter, setNotesActionFilter] = useState<'all' | 'pending' | 'action_taken'>('all');
  const [notesVisibleLimit, setNotesVisibleLimit] = useState<number>(10);
  const [notesDelegateFilter, setNotesDelegateFilter] = useState<string>('');
  const [actionModalNote, setActionModalNote] = useState<CustomerInfoNote | null>(null);
  const [actionDetailsInput, setActionDetailsInput] = useState<string>('');
  const [isSubmittingAdminAction, setIsSubmittingAdminAction] = useState<boolean>(false);

  // Representative one-time Shop Location state & Firestore listener
  const [savedShopLocations, setSavedShopLocations] = useState<ShopLocationRecord[]>([]);
  const [shopLocationsSearchQuery, setShopLocationsSearchQuery] = useState<string>('');
  const [shopLocationsDelegateFilter, setShopLocationsDelegateFilter] = useState<string>('');
  const [capturedLatLng, setCapturedLatLng] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [isCapturingGps, setIsCapturingGps] = useState<boolean>(false);
  const [gpsCaptureError, setGpsCaptureError] = useState<string | null>(null);
  const [manualCoordInput, setManualCoordInput] = useState<string>('');
  const [isSavingShopLocationOnce, setIsSavingShopLocationOnce] = useState<boolean>(false);
  const [isResolvingMapsUrl, setIsResolvingMapsUrl] = useState<boolean>(false);
  const [confirmDeleteShopLocId, setConfirmDeleteShopLocId] = useState<string | null>(null);
  const [editingSavedLocationRecord, setEditingSavedLocationRecord] = useState<ShopLocationRecord | null>(null);
  const [copiedCoordKey, setCopiedCoordKey] = useState<string | null>(null);

  // New Customer Definition (تعريف جديد) modal & submissions state
  const [showNewCustomerDefModal, setShowNewCustomerDefModal] = useState<boolean>(false);
  const [newCustomerDefinitions, setNewCustomerDefinitions] = useState<NewCustomerDefinition[]>([]);

  // Unsuccessful Visits (زيارات غير ناجحة) state & modals
  const [unsuccessfulVisits, setUnsuccessfulVisits] = useState<UnsuccessfulVisit[]>([]);
  const [customerVisitModalRoute, setCustomerVisitModalRoute] = useState<RouteItem | null>(null);
  const [unsuccessfulVisitTargetRoute, setUnsuccessfulVisitTargetRoute] = useState<RouteItem | null>(null);

  // End-of-day Unvisited (Red) Shops snapshots (Admin-only section)
  const [dailyUnvisitedSnapshots, setDailyUnvisitedSnapshots] = useState<DailyUnvisitedSnapshot[]>([]);
  const lastSyncedUnvisitedSigRef = useRef<string>('');

  const handleCopyCoords = (key: string, coordsText: string) => {
    if (!coordsText) return;
    navigator.clipboard?.writeText(coordsText).catch(() => {});
    setCopiedCoordKey(key);
    window.setTimeout(() => setCopiedCoordKey((prev) => (prev === key ? null : prev)), 1800);
  };

  // Firestore real-time listener for preset customer info options
  useEffect(() => {
    const unsubOptions = safeOnSnapshot(
      doc(db, 'settings', 'customer_info_options'),
      (docSnap: any) => {
        if (docSnap.exists() && Array.isArray(docSnap.data()?.options) && docSnap.data().options.length > 0) {
          setAvailableOptions(docSnap.data().options);
        } else {
          setAvailableOptions(CUSTOMER_INFO_OPTIONS);
        }
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'customer_info_options setting in RoutesScreen');
      },
      'RoutesScreen-info-options'
    );
    return () => unsubOptions();
  }, []);

  useEffect(() => {
    const unsubNotes = safeOnSnapshot(
      collection(db, 'customer_info_notes'),
      (snap: any) => {
        const loaded: CustomerInfoNote[] = [];
        snap.forEach((d: any) => {
          loaded.push({ ...d.data(), id: d.id } as CustomerInfoNote);
        });
        loaded.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setCustomerNotes(loaded);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'customer_info_notes in RoutesScreen');
      },
      'RoutesScreen-customer-notes'
    );
    return () => unsubNotes();
  }, []);

  useEffect(() => {
    const unsubShopLocs = safeOnSnapshot(
      collection(db, 'rep_shop_locations'),
      (snap: any) => {
        const loaded: ShopLocationRecord[] = [];
        snap.forEach((d: any) => {
          const data = d.data();
          if (data && Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))) {
            loaded.push({ ...data, id: d.id } as ShopLocationRecord);
          }
        });
        loaded.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setSavedShopLocations(loaded);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'rep_shop_locations in RoutesScreen');
      },
      'RoutesScreen-rep-shop-locations'
    );
    return () => unsubShopLocs();
  }, []);

  useEffect(() => {
    const unsubNewDefs = safeOnSnapshot(
      collection(db, 'new_customer_definitions'),
      (snap: any) => {
        const loaded: NewCustomerDefinition[] = [];
        snap.forEach((d: any) => {
          const data = d.data();
          if (data) loaded.push({ ...data, id: d.id } as NewCustomerDefinition);
        });
        loaded.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setNewCustomerDefinitions(loaded);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'new_customer_definitions in RoutesScreen');
      },
      'RoutesScreen-new-customer-defs'
    );
    return () => unsubNewDefs();
  }, []);

  // Firestore real-time listener for unsuccessful visits
  useEffect(() => {
    const unsubVisits = safeOnSnapshot(
      collection(db, 'unsuccessful_visits'),
      (snap: any) => {
        const loaded: UnsuccessfulVisit[] = [];
        snap.forEach((d: any) => {
          const data = d.data();
          if (data) loaded.push({ ...data, id: d.id } as UnsuccessfulVisit);
        });
        loaded.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setUnsuccessfulVisits(loaded);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'unsuccessful_visits in RoutesScreen');
      },
      'RoutesScreen-unsuccessful-visits'
    );
    return () => unsubVisits();
  }, []);

  // Firestore real-time listener for End-of-Day Unvisited (Red) Shops snapshots (Admin only)
  useEffect(() => {
    if (!isStrictAdmin) {
      setDailyUnvisitedSnapshots([]);
      return;
    }
    const unsubUnvisited = safeOnSnapshot(
      collection(db, 'daily_unvisited_shops'),
      (snap: any) => {
        const loaded: DailyUnvisitedSnapshot[] = [];
        snap.forEach((d: any) => {
          const data = d.data();
          if (data) {
            loaded.push({
              ...data,
              id: d.id,
              dateString: data.dateString || d.id,
              shops: Array.isArray(data.shops) ? data.shops : [],
              dismissedShopIds: Array.isArray(data.dismissedShopIds) ? data.dismissedShopIds : [],
            } as DailyUnvisitedSnapshot);
          }
        });
        loaded.sort((a, b) => (b.dateString || '').localeCompare(a.dateString || ''));
        setDailyUnvisitedSnapshots(loaded);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'daily_unvisited_shops in RoutesScreen');
      },
      'RoutesScreen-daily-unvisited-shops'
    );
    return () => unsubUnvisited();
  }, [isStrictAdmin]);

  const handleDeleteUnsuccessfulVisit = async (visitId: string) => {
    if (!visitId) return;
    try {
      await deleteDoc(doc(db, 'unsuccessful_visits', visitId));
      setUnsuccessfulVisits((prev) => prev.filter((v) => v.id !== visitId));
      try {
        const localKey = 'unsuccessful_visits_backup';
        const cached = JSON.parse(localStorage.getItem(localKey) || '[]');
        const updated = cached.filter((c: any) => c.id !== visitId);
        localStorage.setItem(localKey, JSON.stringify(updated));
      } catch {}
      addToast?.({
        title: 'تم مسح السجل بنجاح',
        message: 'تم حذف تقرير الزيارة غير الناجحة بنجاح.',
        type: 'success',
      });
    } catch (err: any) {
      logFirestoreErrorGracefully(err, 'handleDeleteUnsuccessfulVisit');
      addToast?.({
        title: 'تعذر الحذف',
        message: 'حدث خطأ أثناء محاولة حذف السجل، يرجى المحاولة لاحقاً.',
        type: 'reminder',
      });
    }
  };

  const unsuccessfulVisitsTodayKeys = useMemo(() => {
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

    const todayBaghdadKey = getBaghdadDateKey(Date.now());

    unsuccessfulVisits.forEach((v) => {
      const isToday =
        (v.date && v.date === todayFormatted) ||
        (v.timestamp && getBaghdadDateKey(v.timestamp) === todayBaghdadKey) ||
        (v.createdAt && getBaghdadDateKey(new Date(v.createdAt).getTime()) === todayBaghdadKey);

      if (!isToday) return;

      const cCode = String(v.customerCode || '').trim();
      if (cCode) codeSet.add(cCode);
      if (v.customerName) {
        nameDelegateSet.add(`${normalizeArabic(v.customerName)}::${normalizeArabic(v.delegateName)}`);
      }
    });

    return { codeSet, nameDelegateSet };
  }, [unsuccessfulVisits]);

  const isRouteUnsuccessfulToday = (r: RouteItem): boolean => {
    const cCode = String(r.customerCode || '').trim();
    if (cCode && unsuccessfulVisitsTodayKeys.codeSet.has(cCode)) return true;
    const cNorm = normalizeArabic(r.customerName);
    const delNorm = normalizeArabic(r.delegateName);
    return Boolean(cNorm && unsuccessfulVisitsTodayKeys.nameDelegateSet.has(`${cNorm}::${delNorm}`));
  };

  useEffect(() => {
    const unsubUnlocked = safeOnSnapshot(
      collection(db, 'unlocked_debts'),
      (snap: any) => {
        const map: Record<string, boolean> = {};
        snap.forEach((docSnap: any) => {
          const data = docSnap.data();
          map[docSnap.id] = true;
          if (data?.customerCode) map[String(data.customerCode).trim()] = true;
          if (data?.customerName) map[normalizeArabic(data.customerName)] = true;
        });
        setUnlockedCustomerCodes(map);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'unlocked_debts in RoutesScreen');
      },
      'RoutesScreen-unlocked-debts'
    );
    return () => unsubUnlocked();
  }, []);

  // Overdue Debts Auto-Dismissing Alert Modal State
  const [showOverdueAlertModal, setShowOverdueAlertModal] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(3);
  const [isCountdownPaused, setIsCountdownPaused] = useState<boolean>(false);
  const hasTriggeredAlertOnEntryRef = useRef<boolean>(false);

  useEffect(() => {
    if (!currentUser) return;

    const activeCode = currentUser.delegateCode ? String(currentUser.delegateCode).trim() : effectiveDelegateCode;
    
    let debtsQ;
    if (currentUser.isAdmin) {
      debtsQ = query(collection(db, 'debts'));
    } else if (activeCode) {
      debtsQ = query(collection(db, 'debts'), where('delegateCode', '==', activeCode));
    } else {
      debtsQ = query(collection(db, 'debts'), where('delegateCode', '==', 'NONE_MATCH'));
    }
    
    const unsubDebts = safeOnSnapshot(debtsQ, (snap: any) => {
      const loaded: DebtItem[] = [];
      snap.forEach((d: any) => loaded.push({ id: d.id, ...d.data() } as DebtItem));
      setDebts(loaded);
      setDebtsLoaded(true);
    }, (err: any) => {
      logFirestoreErrorGracefully(err, 'debts in RoutesScreen');
      setDebtsLoaded(true);
    }, 'RoutesScreen-debts');
    return () => unsubDebts();
  }, [currentUser, effectiveDelegateCode]);

  const [selectedDelegateFilter, setSelectedDelegateFilter] = useState<string | null>(null);
  const [repGpsStatus, setRepGpsStatus] = useState<GpsTrackingStatus>(() => getLastKnownGpsTrackingStatus());
  const [repLiveCoords, setRepLiveCoords] = useState<RepLiveCoords | null>(() => getLastKnownRepCoords());

  const getShopLocationDocId = (route: RouteItem): string => {
    const cleanCode = String(route.customerCode || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (cleanCode) return `cust_${cleanCode}`;
    const cleanRouteId = String(route.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (cleanRouteId) return `route_${cleanRouteId}`;
    return `shop_${Date.now()}`;
  };

  const normalizeLocationCode = (val: unknown): string =>
    String(val ?? '').trim().replace(/\.0+$/, '').toLowerCase();

  const savedShopLocationsLookup = useMemo(() => {
    const byDocId = new Map<string, ShopLocationRecord>();
    const byCode = new Map<string, ShopLocationRecord>();
    const byRouteId = new Map<string, ShopLocationRecord>();
    savedShopLocations.forEach((rec) => {
      if (rec.id) byDocId.set(rec.id, rec);
      const code = normalizeLocationCode(rec.customerCode);
      if (code) byCode.set(code, rec);
      const rId = String(rec.routeId || '').trim();
      if (rId) byRouteId.set(rId, rec);
    });
    return { byDocId, byCode, byRouteId };
  }, [savedShopLocations]);

  const getSavedLocationForRoute = (route: RouteItem | null): ShopLocationRecord | undefined => {
    if (!route) return undefined;
    const docId = getShopLocationDocId(route);
    if (savedShopLocationsLookup.byDocId.has(docId)) return savedShopLocationsLookup.byDocId.get(docId);
    const code = normalizeLocationCode(route.customerCode);
    if (code && savedShopLocationsLookup.byCode.has(code)) return savedShopLocationsLookup.byCode.get(code);
    if (route.id && savedShopLocationsLookup.byRouteId.has(route.id)) return savedShopLocationsLookup.byRouteId.get(route.id);
    return undefined;
  };

  // Merge permanently saved rep_shop_locations into routes so map & geofence always rely on pinned shop coordinates
  const enrichedRoutes = useMemo(() => {
    if (savedShopLocations.length === 0) return routes;
    return routes.map((r) => {
      const savedLoc = getSavedLocationForRoute(r);
      if (!savedLoc) return r;
      const lat = parseCoordinate(r.latitude) ?? parseCoordinate(savedLoc.latitude);
      const lng = parseCoordinate(r.longitude) ?? parseCoordinate(savedLoc.longitude);
      return {
        ...r,
        latitude: lat,
        longitude: lng,
        shopLocation:
          r.shopLocation ||
          savedLoc.shopLocation ||
          (lat !== null && lng !== null ? formatShopLocationString(lat, lng) : undefined),
        repLocationSaved: true,
      };
    });
  }, [routes, savedShopLocationsLookup, savedShopLocations.length]);

  const cachedShopCoordsMap = useMemo(() => {
    cacheShopCoordinatesLocally(enrichedRoutes);
    return getCachedShopCoordinates();
  }, [enrichedRoutes]);

  const openShopActionModalForRoute = (r: RouteItem) => {
    setSelectedRowId(r.id);
    setEditingSavedLocationRecord(null);
    setActionModalRoute(r);
    setActionModalStep('choice');
    setSelectedOption(availableOptions[0] || CUSTOMER_INFO_OPTIONS[0]);
    setOtherInfoNotesInput('');
  };

  const openShopActionRef = useRef(openShopActionModalForRoute);
  openShopActionRef.current = openShopActionModalForRoute;

  useEffect(() => {
    const onGpsChange = (ev: Event) => {
      const next = (ev as CustomEvent<{ status: GpsTrackingStatus }>).detail?.status;
      if (next) setRepGpsStatus(next);
    };
    const onCoordsChange = (ev: Event) => {
      const next = (ev as CustomEvent<{ coords: RepLiveCoords | null }>).detail?.coords ?? null;
      setRepLiveCoords(next);
    };
    const onOpenShopAction = (ev: Event) => {
      const route = (ev as CustomEvent<{ route?: RouteItem }>).detail?.route || consumePendingShopActionRoute();
      if (route) {
        consumePendingShopActionRoute();
        openShopActionRef.current(route);
      }
    };

    const pending = consumePendingShopActionRoute();
    if (pending) {
      openShopActionRef.current(pending);
    }

    window.addEventListener(GPS_STATUS_EVENT, onGpsChange);
    window.addEventListener(REP_COORDS_EVENT, onCoordsChange);
    window.addEventListener(OPEN_SHOP_ACTION_MODAL_EVENT, onOpenShopAction);
    return () => {
      window.removeEventListener(GPS_STATUS_EVENT, onGpsChange);
      window.removeEventListener(REP_COORDS_EVENT, onCoordsChange);
      window.removeEventListener(OPEN_SHOP_ACTION_MODAL_EVENT, onOpenShopAction);
    };
  }, []);

  // Refresh local GPS position while the Shop Action Modal is open for a representative so entering <= 100m reveals Create Invoice immediately
  useEffect(() => {
    if (!actionModalRoute || actionModalStep !== 'choice') return;
    if (currentUser?.isAdmin || isDataEntry) return;
    if (repGpsStatus !== 'active') return;
    const { latitude: shopLat, longitude: shopLng } = resolveRouteCoordinatesWithCache(
      actionModalRoute,
      cachedShopCoordsMap
    );
    if (shopLat === null || shopLng === null) return;
    if (!isGeolocationSecureContext() || typeof navigator === 'undefined' || !navigator.geolocation) return;

    let cancelled = false;
    const requestFreshFix = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          dispatchRepLiveCoords({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        },
        () => {
          // Non-blocking: RepresentativeLiveTracker manages permission UI & watchPosition
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    };

    requestFreshFix();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(REP_GPS_FORCE_SYNC_EVENT));
    }
    const intervalId = window.setInterval(requestFreshFix, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [actionModalRoute, actionModalStep, currentUser?.isAdmin, isDataEntry, cachedShopCoordsMap, repGpsStatus]);

  // Compute overdue debts strictly belonging to the logged-in representative with Due Days > 1
  const representativeOverdueDebts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    const msPerDay = 1000 * 3600 * 24;

    const targetCode = String(currentUser?.delegateCode || effectiveDelegateCode || '').trim().toLowerCase();
    const targetName = normalizeArabic(currentUser?.name || currentUser?.delegateName || '');
    const targetUsername = String(currentUser?.username || '').trim().toLowerCase();

    return debts
      .filter((item) => {
        // If not admin, enforce strict role isolation to representative's assigned customers
        if (!currentUser?.isAdmin) {
          const itemCode = String(item.delegateCode || '').trim().toLowerCase();
          const itemName = normalizeArabic(item.delegateName || '');
          const matches =
            (targetCode && itemCode === targetCode) ||
            (targetUsername && itemCode === targetUsername) ||
            (targetName && itemName === targetName);
          if (!matches) return false;
        } else if (selectedDelegateFilter) {
          const filterNorm = normalizeArabic(selectedDelegateFilter);
          const targetAcc = delegateAccounts.find(
            (a) =>
              (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
              (a.delegateName && normalizeArabic(a.delegateName) === filterNorm) ||
              (a.username && a.username.toLowerCase() === selectedDelegateFilter.toLowerCase())
          );
          const matchCode = targetAcc?.delegateCode ? normalizeArabic(targetAcc.delegateCode) : filterNorm;
          const dCode = normalizeArabic(item.delegateCode);
          const dName = normalizeArabic(item.delegateName);
          if (dCode !== matchCode && dName !== filterNorm) return false;
        }
        return true;
      })
      .map((item) => {
        const payDateObj = parseDateToMidnight(item.paymentDueDate);
        let dueDays = 0;
        if (payDateObj) {
          const payDateTime = payDateObj.getTime();
          if (todayTime > payDateTime) {
            dueDays = Math.round((todayTime - payDateTime) / msPerDay);
          }
        }
        return {
          ...item,
          dueDays,
        };
      })
      .filter((item) => item.dueDays > 1)
      .sort((a, b) => b.dueDays - a.dueDays);
  }, [debts, currentUser, effectiveDelegateCode, selectedDelegateFilter, delegateAccounts]);

  // Trigger overdue debts modal alert upon entering Routes page for Representatives
  useEffect(() => {
    if (!debtsLoaded || hasTriggeredAlertOnEntryRef.current) return;

    const isRep = Boolean(
      !currentUser?.isAdmin &&
      !isDataEntry
    );

    if (isRep && representativeOverdueDebts.length > 0) {
      hasTriggeredAlertOnEntryRef.current = true;
      setShowOverdueAlertModal(true);
      setCountdownSeconds(3);
      setIsCountdownPaused(false);
    }
  }, [debtsLoaded, representativeOverdueDebts, currentUser, isDataEntry]);

  // Auto-dismiss countdown timer (3 seconds) & manual close / pause handling
  useEffect(() => {
    if (!showOverdueAlertModal) {
      setIsCountdownPaused(false);
      return;
    }

    if (isCountdownPaused) {
      return;
    }

    const intervalId = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          setShowOverdueAlertModal(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [showOverdueAlertModal, isCountdownPaused]);
  
  const [selectedDebt, setSelectedDebt] = useState<DebtItem | null>(null);
  const [paymentModalDebt, setPaymentModalDebt] = useState<DebtItem | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [debtSearch, setDebtSearch] = useState('');

  // WhatsApp Alert to Delegate Modal state
  const [whatsappModalDebt, setWhatsappModalDebt] = useState<DebtItem | null>(null);
  const [delegatePhoneInput, setDelegatePhoneInput] = useState<string>('');

  // Temporary Route Shift Modal state
  const [routeToShift, setRouteToShift] = useState<RouteItem | null>(null);
  const [showShiftModal, setShowShiftModal] = useState<boolean>(false);
  const [selectedShiftDay, setSelectedShiftDay] = useState<string>('الأحد');
  const [isShiftingRoute, setIsShiftingRoute] = useState<boolean>(false);

  // Live Fleet Map state
  const [showFleetMap, setShowFleetMap] = useState<boolean>(true);

  // Excel Manager section: shop location table, inline editing, and location-only Excel upload
  const [excelLocFilter, setExcelLocFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [excelDelegateFilter, setExcelDelegateFilter] = useState<string>('');
  const [excelSearch, setExcelSearch] = useState<string>('');
  const [excelDisplayLimit, setExcelDisplayLimit] = useState<number>(30);
  const [isUploadingLocationsExcel, setIsUploadingLocationsExcel] = useState<boolean>(false);
  const [editingLocationRouteId, setEditingLocationRouteId] = useState<string | null>(null);
  const [editingLocationInput, setEditingLocationInput] = useState<string>('');
  const [isSavingInlineLocation, setIsSavingInlineLocation] = useState<boolean>(false);
  const [confirmDeleteLocationRouteId, setConfirmDeleteLocationRouteId] = useState<string | null>(null);
  const [deletingLocationRouteId, setDeletingLocationRouteId] = useState<string | null>(null);

  const isFieldRep = useMemo(() => isFieldRepresentativeUser(currentUser), [currentUser]);

  const handleOpenShiftModal = (route: RouteItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isDataEntry) return;
    setRouteToShift(route);
    setSelectedShiftDay(route.tempAssignedDay || 'الأحد');
    setShowShiftModal(true);
  };

  const handleConfirmRouteShift = async () => {
    if (!routeToShift || !selectedShiftDay) return;
    setIsShiftingRoute(true);
    try {
      const result = await shiftCustomerRouteTemporarily(routeToShift, selectedShiftDay, currentUser?.name);
      if (result.success) {
        if (addToast) {
          addToast({
            title: 'تحويل المسار المؤقت',
            message: result.message,
            type: 'success',
          });
        }
        setShowShiftModal(false);
        setRouteToShift(null);
      } else {
        alert(result.message);
      }
    } catch (err: any) {
      console.error('Error in handleConfirmRouteShift:', err);
      alert('حدث خطأ أثناء تنفيذ تحويل المسار.');
    } finally {
      setIsShiftingRoute(false);
    }
  };

  const handleRevertRouteShift = async (route: RouteItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`هل أنت متأكد من إلغاء تحويل مسار الزبون (${route.customerName}) وإعادته لمساره الأصلي (${route.originalPath || route.path})؟`)) {
      return;
    }
    try {
      const result = await revertCustomerRouteOverride(route, currentUser?.name);
      if (result.success && addToast) {
        addToast({
          title: 'إلغاء تحويل المسار',
          message: result.message,
          type: 'info',
        });
      }
    } catch (err) {
      console.error('Error in handleRevertRouteShift:', err);
    }
  };

  const handleOpenWhatsAppModal = (debt: DebtItem) => {
    setWhatsappModalDebt(debt);
    const matchedAccount = delegateAccounts.find(
      (acc) =>
        (debt.delegateCode && acc.delegateCode && String(acc.delegateCode).trim() === String(debt.delegateCode).trim()) ||
        (debt.delegateName && acc.delegateName && normalizeArabic(acc.delegateName) === normalizeArabic(debt.delegateName))
    );
    const delKey = debt.delegateCode || debt.delegateName || '';
    const fixedPhone = getFixedDelegatePhone(debt.delegateName, debt.delegateCode, matchedAccount?.username);
    const existingPhone = fixedPhone || (matchedAccount as any)?.phone || localStorage.getItem(`del_phone_${delKey}`) || '';
    setDelegatePhoneInput(existingPhone);
  };

  const formatWhatsAppPhone = (phone: string): string => {
    if (!phone) return '';
    const normalized = parseArabicDigits(String(phone));
    let cleaned = normalized.replace(/\D/g, '');
    if (cleaned.startsWith('00964')) {
      cleaned = cleaned.substring(2);
    } else if (cleaned.startsWith('07')) {
      cleaned = '964' + cleaned.substring(1);
    } else if (cleaned.startsWith('0')) {
      cleaned = '964' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') && cleaned.length === 10) {
      cleaned = '964' + cleaned;
    } else if (!cleaned.startsWith('964') && cleaned.length >= 10) {
      cleaned = '964' + cleaned;
    }
    return cleaned;
  };

  const handleSendWhatsAppAlert = () => {
    if (!whatsappModalDebt) return;
    const debt = whatsappModalDebt;
    const matchedAccount = delegateAccounts.find(
      (acc) =>
        (debt.delegateCode && acc.delegateCode && String(acc.delegateCode).trim() === String(debt.delegateCode).trim()) ||
        (debt.delegateName && acc.delegateName && normalizeArabic(acc.delegateName) === normalizeArabic(debt.delegateName))
    );
    const delName = matchedAccount?.delegateName || debt.delegateName || debt.delegateCode || 'المندوب';
    const delKey = debt.delegateCode || debt.delegateName || '';
    const fixedPhone = getFixedDelegatePhone(debt.delegateName, debt.delegateCode, matchedAccount?.username);

    // Guaranteed fixed phone cannot be altered
    const cleanRawPhone = (fixedPhone || delegatePhoneInput).trim();
    if (cleanRawPhone) {
      try {
        localStorage.setItem(`del_phone_${delKey}`, cleanRawPhone);
        if (matchedAccount?.username) {
          setDoc(doc(db, 'delegate_accounts', matchedAccount.username.toLowerCase()), { phone: cleanRawPhone }, { merge: true }).catch(() => {});
        }
      } catch {}
    }

    const payDateObj = parseDateToMidnight(debt.paymentDueDate);
    let dueStatusText = 'غير محدد';
    if (payDateObj) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.round((today.getTime() - payDateObj.getTime()) / (1000 * 3600 * 24));
      if (today.getTime() >= payDateObj.getTime()) {
        dueStatusText = `مستحقة (تأخير ${diffDays} يوم)`;
      } else {
        dueStatusText = `غير مستحقة (NT) • متبقي ${Math.abs(diffDays)} يوم على موعد السداد`;
      }
    }

    const message = `⚠️ *تنبيه دين مستحق للمندوب* ⚠️

👤 *المندوب:* ${delName}
🏬 *اسم الزبون:* ${debt.customerName}
🔢 *كود الزبون:* ${debt.customerCode}
${debt.customerAddress ? `📍 *عنوان الزبون:* ${debt.customerAddress}\n` : ''}💰 *المبلغ المستحق:* ${formatDebtAmount(debt.amountDue)} د.ع
📅 *تاريخ الفاتورة:* ${debt.invoiceDate}
⏰ *تاريخ السداد:* ${debt.paymentDueDate}
📌 *حالة الاستحقاق:* ${dueStatusText}

يرجى متابعة واستحصال المبلغ المستحق من الزبون وإبلاغ الإدارة فور الاستلام.`;

    const formattedPhone = formatWhatsAppPhone(cleanRawPhone);
    const whatsappUrl = formattedPhone 
      ? `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
    setWhatsappModalDebt(null);
    if (addToast) {
      addToast({
        title: 'تم تجهيز الرسالة',
        message: `تم فتح واتساب لإرسال تنبيه الدين للمندوب (${delName})`,
        type: 'success'
      });
    }
  };





  // Configurable auto-lock closing time (default 21:00 / 9:00 PM) & real-time clock tick
  const [targetAutoLockTime, setTargetAutoLockTime] = useState<string>('21:00');
  const [delegateCustomTimes, setDelegateCustomTimes] = useState<Record<string, { customTime: string; durationMinutes?: number; expireAtTimestamp?: number; active: boolean }>>({});
  const [timeTick, setTimeTick] = useState<number>(Date.now());

  useEffect(() => {
    const unsub = safeOnSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (docSnap: any) => {
        if (docSnap.exists() && (docSnap.data()?.time || docSnap.data()?.targetTime)) {
          setTargetAutoLockTime(docSnap.data().time || docSnap.data().targetTime);
        }
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'auto_lock_time in RoutesScreen');
      },
      'RoutesScreen-auto-lock'
    );
    return () => unsub();
  }, []);

  // Real-time listener for per-delegate custom lock timers
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'delegate_custom_lock_times'), where('date', '==', today));
    const unsub = safeOnSnapshot(
      q,
      (snap: any) => {
        const customMap: Record<string, { customTime: string; durationMinutes?: number; expireAtTimestamp?: number; active: boolean }> = {};
        snap.forEach((d: any) => {
          const data = d.data();
          if (data && data.delegate && data.active !== false) {
            customMap[data.delegate] = {
              customTime: data.customTime || '',
              durationMinutes: Number(data.durationMinutes) || 0,
              expireAtTimestamp: Number(data.expireAtTimestamp) || 0,
              active: true,
            };
          }
        });
        setDelegateCustomTimes(customMap);
      },
      (err: any) => logFirestoreErrorGracefully(err, 'delegate_custom_lock_times_routes'),
      'RoutesScreen-custom-lock-times'
    );
    return () => unsub();
  }, []);

  // Live timer tick every 10 seconds to detect closing time trigger in real-time
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeTick(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Format targetAutoLockTime for English display (e.g. 15:00 -> 03:00 PM)
  const formattedTargetTime = useMemo(() => {
    try {
      const [hStr, mStr] = targetAutoLockTime.split(':');
      let h = parseInt(hStr || '15', 10);
      const m = mStr || '00';
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      h = h ? h : 12;
      return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
    } catch {
      return '03:00 PM';
    }
  }, [targetAutoLockTime]);

  // Current Baghdad date info & whether official closing time has been reached
  const baghdadStatus = useMemo(() => {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Baghdad',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const todayBaghdad = formatter.format(now); // "YYYY-MM-DD"

      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baghdad',
        hour12: false,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
      const parts = timeFormatter.formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);

      const currentSeconds = hour * 3600 + minute * 60 + second;

      const [hStr, mStr] = targetAutoLockTime.split(':');
      const targetHours = parseInt(hStr || '15', 10);
      const targetMinutes = parseInt(mStr || '00', 10);
      const targetSeconds = targetHours * 3600 + targetMinutes * 60;

      const isPastClosing = currentSeconds >= targetSeconds;

      return { todayBaghdad, isPastClosing };
    } catch {
      const todayBaghdad = new Date().toISOString().split('T')[0];
      return { todayBaghdad, isPastClosing: false };
    }
  }, [targetAutoLockTime, timeTick]);

  // Check if a representative has marked today's sales as completed
  const isDelegateCompletedToday = (delName?: string, delCode?: string) => {
    if (!delName && !delCode) return false;
    const nName = delName ? normalizeArabic(delName) : '';
    const nCode = delCode ? normalizeArabic(delCode) : '';

    for (const [key, val] of Object.entries(completedDelegates)) {
      if (!val) continue;
      const nKey = normalizeArabic(key);
      if (nName && (nKey === nName || nKey.includes(nName) || nName.includes(nKey))) return true;
      if (nCode && nKey === nCode) return true;
    }
    return false;
  };

  const handleSavePayment = async () => {
    if (!paymentModalDebt || !(currentUser?.isAdmin || isDataEntry)) return;
    const paidAmount = parseFloat(paymentAmountInput);
    if (isNaN(paidAmount) || paidAmount <= 0) {
      alert('يرجى إدخال مبلغ تسديد صحيح أكبر من الصفر');
      return;
    }

    setIsProcessingPayment(true);
    try {
      if (paidAmount >= paymentModalDebt.amountDue) {
        // Full settlement
        await deleteDoc(doc(db, 'debts', paymentModalDebt.id));
        addToast({
          message: `تم تسديد كامل دين الزبون (${paymentModalDebt.customerName}) بمبلغ ${paidAmount.toLocaleString()} د.ع بنجاح`,
          type: 'success',
          delegateName: currentUser?.name || '',
          title: 'تسديد الدين',
          percentage: 0
        });
      } else {
        // Partial settlement
        const remainingAmount = paymentModalDebt.amountDue - paidAmount;
        await setDoc(doc(db, 'debts', paymentModalDebt.id), {
          amountDue: remainingAmount
        }, { merge: true });
        addToast({
          message: `تم تسديد ${paidAmount.toLocaleString()} د.ع من دين الزبون (${paymentModalDebt.customerName})، المتبقي: ${remainingAmount.toLocaleString()} د.ع`,
          type: 'success',
          delegateName: currentUser?.name || '',
          title: 'تسديد جزئي',
          percentage: 0
        });
      }
      setPaymentModalDebt(null);
      setPaymentAmountInput('');
    } catch (error) {
      console.error('Error settling debt:', error);
      alert('حدث خطأ أثناء حفظ التسديد. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const totalDebts = useMemo(() => debts.reduce((sum, d) => sum + (Number(d.amountDue) || 0), 0), [debts]);
  const totalCustomers = useMemo(() => new Set(debts.map(d => d.customerCode)).size, [debts]);

  const getDelegateTotalDebt = useMemo(() => {
    return (delegate: { delegateCode?: string; username?: string; delegateName?: string }) => {
      const targetCode = (delegate.delegateCode || '').trim().toLowerCase();
      const targetUser = (delegate.username || '').trim().toLowerCase();
      const targetName = (delegate.delegateName || '').trim().toLowerCase();

      return debts.reduce((sum, item) => {
        const itemCode = (item.delegateCode || '').trim().toLowerCase();
        const itemName = (item.delegateName || '').trim().toLowerCase();

        const matchCode = targetCode !== '' && (itemCode === targetCode || itemName === targetCode);
        const matchUser = targetUser !== '' && (itemCode === targetUser || itemName === targetUser);
        const matchName = targetName !== '' && (itemName === targetName || itemCode === targetName);

        if (matchCode || matchUser || matchName) {
          return sum + (Number(item.amountDue) || 0);
        }
        return sum;
      }, 0);
    };
  }, [debts]);

  const filteredDebts = useMemo(() => {
      let result = debts;
      if (selectedDelegateFilter) {
          const filterNorm = normalizeArabic(selectedDelegateFilter);
          const targetAcc = delegateAccounts.find(
            a => (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
                 (a.username && normalizeArabic(a.username) === filterNorm) ||
                 (a.delegateName && normalizeArabic(a.delegateName) === filterNorm)
          );
          const matchCode = targetAcc?.delegateCode ? normalizeArabic(targetAcc.delegateCode) : filterNorm;
          const matchUser = targetAcc?.username ? normalizeArabic(targetAcc.username) : filterNorm;
          const matchName = targetAcc?.delegateName ? normalizeArabic(targetAcc.delegateName) : filterNorm;

          result = result.filter(d => {
            const dCode = normalizeArabic(d.delegateCode);
            const dName = normalizeArabic(d.delegateName);
            return dCode === matchCode || dCode === matchUser || dCode === filterNorm ||
                   dName === matchName || dName === matchUser || dName === filterNorm;
          });
      }

      const q = normalizeArabic(debtSearch);
      if (q) {
        result = result.filter(d => {
            const delegateName = delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || d.delegateCode || '';
            const searchable = [
              normalizeArabic(d.customerName),
              normalizeArabic(d.customerCode),
              normalizeArabic(delegateName),
              normalizeArabic(d.invoiceDate),
              normalizeArabic(d.paymentDueDate)
            ].join(' ');
            return searchable.includes(q);
        });
      }

      return [...result].sort((a, b) => {
        const payA = parseDateToMidnight(a.paymentDueDate)?.getTime() || 0;
        const payB = parseDateToMidnight(b.paymentDueDate)?.getTime() || 0;
        return payA - payB;
      });
  }, [debts, debtSearch, selectedDelegateFilter, delegateAccounts]);

  const visibleDebtsTotal = useMemo(
    () => filteredDebts.reduce((sum, d) => sum + (Number(d.amountDue) || 0), 0),
    [filteredDebts]
  );

  const exportDebtsToExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const msPerDay = 1000 * 3600 * 24;

      const worksheet = XLSX.utils.json_to_sheet(debts.map(d => {
          const payDateObj = parseDateToMidnight(d.paymentDueDate);
          let mustahaqaVal: string | number = 'NT';
          let baqiaVal = 0;
          if (payDateObj) {
            if (today.getTime() >= payDateObj.getTime()) {
              mustahaqaVal = Math.round((today.getTime() - payDateObj.getTime()) / msPerDay);
              baqiaVal = 0;
            } else {
              mustahaqaVal = 'NT';
              baqiaVal = Math.round((payDateObj.getTime() - today.getTime()) / msPerDay);
            }
          }
          return {
              'اسم الزبون': d.customerName,
              'كود الزبون': d.customerCode,
              'المبلغ': d.amountDue,
              'كود المندوب': d.delegateCode,
              'اسم المندوب': delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || '',
              'تاريخ الفاتورة': d.invoiceDate,
              'تاريخ السداد': d.paymentDueDate,
              'مستحقة': mustahaqaVal,
              'باقي': baqiaVal
          };
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'الديون');
      XLSX.writeFile(workbook, 'الديون.xlsx');
    } catch (err) {
      console.error('Error exporting debts to Excel:', err);
      alert('حدث خطأ أثناء تصدير ملف الإكسل');
    }
  };

  const renderDebtsTable = () => {
    return (
      <div className="space-y-4">
        {currentUser?.isAdmin && (
          <div className={`grid grid-cols-2 gap-4 p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="text-center">
                  <div className="text-[10px] font-bold text-slate-500 mb-1">إجمالي الديون المستحقة</div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">{formatDebtAmount(totalDebts)}</div>
              </div>
              <div className="text-center">
                  <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">عدد الزبائن</div>
                  <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">{totalCustomers}</div>
              </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
              <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 min-w-0">
                <h3 className="text-emerald-800 dark:text-emerald-200 font-black text-base sm:text-lg whitespace-nowrap">الديون المستحقة</h3>
                {representativeOverdueDebts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverdueAlertModal(true);
                      setCountdownSeconds(3);
                      setIsCountdownPaused(false);
                    }}
                    data-testid="open-overdue-debts-modal-btn"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 rounded-xl text-[11px] sm:text-xs font-black transition-all cursor-pointer shadow-xs active:scale-95 whitespace-nowrap shrink-0"
                    title="تنبيه الديون المتأخرة المستحقة (> 1 يوم)"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 animate-pulse shrink-0" />
                    <span>تنبيه الديون المتأخرة</span>
                    <span className="bg-rose-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black leading-none">
                      {representativeOverdueDebts.length}
                    </span>
                  </button>
                )}
              </div>
              {((currentUser?.isAdmin || isDataEntry) || (currentUser?.isAdmin && !isRafatJamal)) && (
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto shrink-0">
                  {(currentUser?.isAdmin || isDataEntry) && (
                      <button onClick={exportDebtsToExcel} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 bg-blue-600 text-white rounded-xl sm:rounded-lg text-xs font-black sm:font-bold hover:bg-blue-700 active:scale-95 transition-all whitespace-nowrap cursor-pointer">
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>تصدير Excel</span>
                      </button>
                  )}
                  {currentUser?.isAdmin && !isRafatJamal && (
                      <label className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 bg-emerald-600 text-white rounded-xl sm:rounded-lg cursor-pointer text-xs font-black sm:font-bold hover:bg-emerald-700 active:scale-95 transition-all whitespace-nowrap">
                      <Upload className="w-3.5 h-3.5 shrink-0" />
                      <span>استيراد</span>
                      <input type="file" className="hidden" onChange={handleImportDebts} accept=".xlsx, .xls" />
                      </label>
                  )}
                </div>
              )}
            </div>

            {currentUser?.isAdmin && (
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 pt-1 pb-1">
                    {/* All Button */}
                    <button 
                      key="filter-all-delegates" 
                      onClick={() => setSelectedDelegateFilter(null)} 
                      className={`col-span-2 sm:col-span-1 px-3 py-2 sm:py-1.5 rounded-xl text-center transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center sm:min-w-[75px] ${
                        !selectedDelegateFilter 
                           ? 'bg-emerald-600 text-white shadow-emerald-600/30' 
                          : isDarkMode 
                            ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700' 
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      <span className="text-xs font-black leading-tight">الكل</span>
                      <span className={`text-[10px] font-bold mt-0.5 leading-tight ${!selectedDelegateFilter ? 'text-emerald-100' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {formatDebtAmount(totalDebts)} <span className="text-[8px]">د.ع</span>
                      </span>
                    </button>

                    {/* Delegate Buttons */}
                    {delegateAccounts
                      .filter(d => getDelegateTotalDebt(d) > 0 && !isHiddenDelegateForFilter(d.delegateName) && !isHiddenDelegateForFilter(d.username))
                      .map((d, idx) => {
                        const filterKey = d.delegateCode || d.username;
                        const isSelected = selectedDelegateFilter === filterKey || (selectedDelegateFilter && (d.delegateName === selectedDelegateFilter || d.username === selectedDelegateFilter));
                        const delegateTotal = getDelegateTotalDebt(d);

                        return (
                          <button 
                            key={d.username || d.delegateCode || `debts-filter-${idx}`} 
                            onClick={() => setSelectedDelegateFilter(filterKey || null)} 
                            className={`px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl text-center transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center min-w-0 sm:min-w-[80px] ${
                              isSelected 
                                ? 'bg-emerald-600 text-white shadow-emerald-600/30 ring-2 ring-emerald-500/50' 
                                : isDarkMode 
                                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700' 
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                            }`}
                          >
                            <span className="text-xs font-black leading-tight truncate max-w-full sm:max-w-[130px]">
                              {d.delegateName || d.username}
                            </span>
                            <span className={`text-[10px] font-bold mt-0.5 leading-tight ${
                              isSelected 
                                ? 'text-emerald-100' 
                                : 'text-amber-600 dark:text-amber-400 font-black'
                            }`}>
                              {formatDebtAmount(delegateTotal)} <span className="text-[8px]">د.ع</span>
                            </span>
                          </button>
                        );
                    })}
                </div>
            )}
        </div>

        <input 
          type="text" 
          value={debtSearch} 
          onChange={e => setDebtSearch(e.target.value)} 
          placeholder="بحث (اسم، كود، مندوب، أو تاريخ)..." 
          className={`w-full p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-300'}`}
        />

        <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700 shadow-xs">
          <table className="w-full min-w-[460px] sm:min-w-[600px] text-[10px] sm:text-[11px] text-right">
            <thead className={`font-black text-[10px] sm:text-[11px] ${isDarkMode ? 'bg-slate-800 text-slate-100 border-b border-slate-700' : 'bg-slate-200/90 text-slate-900 border-b border-slate-300'}`}>
              <tr>
                {(currentUser?.isAdmin || isDataEntry) && <th className="px-2 py-2 whitespace-nowrap">المندوب</th>}
                <th className="px-2 py-2 min-w-[100px]">الزبون</th>
                <th className="px-1.5 py-2 whitespace-nowrap">الكود</th>
                <th className="px-2 py-2 whitespace-nowrap">المبلغ</th>
                <th className="px-1.5 py-2 whitespace-nowrap">الفاتورة</th>
                <th className="px-1.5 py-2 whitespace-nowrap">السداد</th>
                <th className="px-1.5 py-2 text-center whitespace-nowrap">مستحقة</th>
                <th className="px-1.5 py-2 text-center whitespace-nowrap">باقي</th>
                {(currentUser?.isAdmin || isDataEntry) && <th className="px-2 py-2 text-center whitespace-nowrap">إجراءات</th>}
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-slate-200 bg-white text-slate-900'}`}>
              {!debtsLoaded ? (
                // Skeleton Loader
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse">
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                    {(currentUser?.isAdmin || isDataEntry) && <td className="px-2.5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>}
                  </tr>
                ))
              ) : filteredDebts.map(d => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayTime = today.getTime();
                const msPerDay = 1000 * 3600 * 24;
                
                const payDateObj = parseDateToMidnight(d.paymentDueDate);
                const invDateObj = parseDateToMidnight(d.invoiceDate);
                
                let mustahaqaDisplay: string | number = 'NT';
                let isDue = false;
                let baqia = 0;
                
                if (payDateObj) {
                  const payDateTime = payDateObj.getTime();
                  if (todayTime >= payDateTime) {
                    // تاريخ السداد واصل / مستحق -> تجمع عدد الأيام بين تاريخ السداد وتاريخ اليوم
                    isDue = true;
                    mustahaqaDisplay = Math.round((todayTime - payDateTime) / msPerDay);
                    baqia = 0;
                  } else {
                    // تاريخ السداد غير واصل (غير مستحق) -> NT
                    mustahaqaDisplay = 'NT';
                    baqia = Math.round((payDateTime - todayTime) / msPerDay);
                  }
                } else {
                  mustahaqaDisplay = 'NT';
                  baqia = 0;
                }
                
                const daysOld = invDateObj ? Math.round((todayTime - invDateObj.getTime()) / msPerDay) : 0;
                const isOldDebt = daysOld > 11;

                const isRed = isDue || (mustahaqaDisplay === 'NT' && baqia <= 1);
                const isGreen = !isDue && baqia > 5;
                const rowBgClass = isRed 
                  ? (isDarkMode ? 'bg-rose-950/40 text-rose-100 hover:bg-rose-900/50' : 'bg-rose-50 text-rose-950 hover:bg-rose-100/90') 
                  : isGreen 
                  ? (isDarkMode ? 'bg-emerald-950/30 text-emerald-100 hover:bg-emerald-900/40' : 'bg-emerald-50/70 text-slate-900 hover:bg-emerald-100/80') 
                  : (isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100/70');
                
                const handlePay = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setPaymentModalDebt(d);
                    setPaymentAmountInput(d.amountDue.toString());
                };

                return (
                  <tr key={d.id} className={`${rowBgClass} transition-colors cursor-pointer font-bold`} onClick={() => setSelectedDebt(d)}>
                    {(currentUser?.isAdmin || isDataEntry) && (
                        <td className="px-2 py-1.5 font-extrabold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            <span>{delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || d.delegateName || d.delegateCode}</span>
                        </td>
                    )}
                    <td className="px-2 py-1.5 font-black text-slate-900 dark:text-white">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span>{d.customerName}</span>
                        {typeof mustahaqaDisplay === 'number' && mustahaqaDisplay > 1 && (
                          <span className="text-[8px] font-black bg-rose-500 text-white px-1.5 py-0.2 rounded-full shadow-xs shrink-0">
                            مستحق
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 py-1.5 font-mono text-[10px] text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      <span className="px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {d.customerCode}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-black text-emerald-700 dark:text-emerald-300 font-mono text-[11px] sm:text-xs whitespace-nowrap">
                      {formatDebtAmount(d.amountDue)} <span className="text-[9px] font-sans">د.ع</span>
                    </td>
                    <td className="px-1.5 py-1.5 font-mono text-slate-700 dark:text-slate-300 text-[10px] whitespace-nowrap">{d.invoiceDate}</td>
                    <td className="px-1.5 py-1.5 font-mono text-slate-700 dark:text-slate-300 text-[10px] whitespace-nowrap">{d.paymentDueDate}</td>
                    <td className="px-1.5 py-1.5 text-center font-mono whitespace-nowrap">
                      {mustahaqaDisplay === 'NT' ? (
                        <span className="px-1 py-0.2 rounded font-black text-[9px] bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                          NT
                        </span>
                      ) : (
                        <span className="px-1 py-0.2 rounded font-black text-[9px] bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                          {mustahaqaDisplay}
                        </span>
                      )}
                    </td>
                    <td className="px-1.5 py-1.5 text-center whitespace-nowrap">
                      {baqia > 0 ? (
                        <span className="px-1 py-0.2 rounded font-black text-[9px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono">
                          {baqia}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-[9px]">0</span>
                      )}
                    </td>
                    {(currentUser?.isAdmin || isDataEntry) && (
                      <td className="px-2 py-1.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {!isRafatJamal && (
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenWhatsAppModal(d);
                              }} 
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-lg text-[10px] font-black shadow-xs transition-all cursor-pointer flex items-center gap-1"
                              title="إرسال رسالة تنبيه بالدين إلى واتساب المندوب"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>واتساب</span>
                            </button>
                          )}
                          <button 
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const delName = delegateAccounts.find(acc => acc.delegateCode === d.delegateCode)?.delegateName || d.delegateName || d.delegateCode;
                              if (delName && setSelectedDelegate) {
                                setSelectedDelegate(delName);
                              }
                              if (delName && setRouteFilterDelegate) {
                                setRouteFilterDelegate(delName);
                              }

                              // Unlock customer debt restriction in Firestore for all delegates in real-time
                              try {
                                const unlockKey = String(d.customerCode || d.customerName || d.id).trim();
                                if (unlockKey) {
                                  await setDoc(doc(db, 'unlocked_debts', unlockKey), {
                                    customerCode: d.customerCode || '',
                                    customerName: d.customerName || '',
                                    delegateCode: d.delegateCode || '',
                                    delegateName: delName || '',
                                    unlockedBy: currentUser?.name || currentUser?.username || 'Admin',
                                    unlockedAt: Date.now()
                                  }, { merge: true });
                                }
                              } catch (err) {
                                console.error('Error persisting unlocked_debts:', err);
                              }

                              const todayStr = new Date().toISOString().split('T')[0];
                              const customerEntries = (allSalesEntries || salesEntries || []).filter(
                                (entry) => entry.customerCode === d.customerCode || entry.customerName === d.customerName
                              );
                              const lastInvoiceToday = customerEntries
                                .filter((entry) => entry.dateString === todayStr)
                                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];

                              if (setPrefilledEntryData) {
                                setPrefilledEntryData({
                                  customerCode: d.customerCode || '',
                                  customerName: d.customerName || '',
                                  customerAddress: d.customerAddress || '',
                                  customerType: 'مفرد',
                                  lastInvoiceToday
                                });
                              }
                              if (setShowQuickAdd) setShowQuickAdd(true);

                              if (addToast) {
                                addToast({
                                  title: 'تم تفعيل زر الطلب للزبون',
                                  message: `تم اختيار المندوب (${delName}) وفتح إمكانية الطلب للزبون (${d.customerName}) في صفحة المسارات بالرغم من وجود دين.`,
                                  type: 'success'
                                });
                              }
                            }} 
                            className="px-2 py-1 bg-amber-600 hover:bg-amber-500 active:scale-95 text-white rounded-lg text-[10px] font-black shadow-xs transition-all cursor-pointer flex items-center gap-1"
                            title="فتح الطلب وتفعيل زر الطلب للمندوب في صفحة المسارات بالرغم من الدين"
                          >
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>فتح</span>
                          </button>
                          <button 
                            type="button"
                            onClick={handlePay} 
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-lg text-[10px] font-black shadow-xs transition-all cursor-pointer"
                            title="تسديد دين الزبون"
                          >
                            تسديد
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {debtsLoaded && filteredDebts.length > 0 && (
              <tfoot
                className={`border-t-2 font-black ${
                  isDarkMode
                    ? 'bg-slate-800/95 border-slate-700 text-slate-100'
                    : 'bg-emerald-50/90 border-emerald-200 text-slate-900'
                }`}
              >
                <tr>
                  <td
                    colSpan={currentUser?.isAdmin || isDataEntry ? 3 : 2}
                    className="px-2 py-2.5 text-[10px] sm:text-xs font-black text-slate-700 dark:text-slate-200 whitespace-nowrap"
                  >
                    مجموع المبالغ ({filteredDebts.length})
                  </td>
                  <td className="px-2 py-2.5 font-black text-emerald-700 dark:text-emerald-300 font-mono text-[11px] sm:text-xs whitespace-nowrap">
                    {formatDebtAmount(visibleDebtsTotal)} <span className="text-[9px] font-sans">د.ع</span>
                  </td>
                  <td colSpan={currentUser?.isAdmin || isDataEntry ? 5 : 4} className="px-2 py-2.5" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  };

  const handleImportDebts = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 });

      const batch = writeBatch(db);
      const debtsSnap = await getDocs(collection(db, 'debts'));
      debtsSnap.forEach(d => batch.delete(d.ref));

      // New format: Name, Code, Amount, DelegateCode, InvoiceDate, PaymentDate
      jsonData.slice(1).forEach((row: any) => {
        if (!row[0]) return;
        
        // Helper to convert Excel serial date to YYYY-MM-DD string
        const excelDateToJSDate = (serial: any) => {
            if (typeof serial === 'number') {
                const utc_days = Math.floor(serial - 25569);
                const utc_value = utc_days * 86400;
                const date_info = new Date(utc_value * 1000);
                return date_info.toISOString().split('T')[0];
            }
            return serial; // Assume it's already a string
        };

        const newDebt = {
          customerName: row[0] || '',
          customerCode: row[1] || '',
          amountDue: Math.round(parseFloat(row[2] || 0) || 0),
          delegateCode: String(row[3] || '').trim(),
          invoiceDate: excelDateToJSDate(row[4]),
          paymentDueDate: excelDateToJSDate(row[5]),
          delegateName: '', // Name might be unknown at this point
        };
        
        const debtRef = doc(collection(db, 'debts'));
        batch.set(debtRef, newDebt);
      });
      
      await batch.commit();
      addToast({ message: 'تم استيراد الديون بنجاح ✅', type: 'success', delegateName: currentUser?.name || '', title: 'استيراد', percentage: 0 });
    } catch (e) {
      console.error('Error importing debts:', e);
      addToast({ message: 'فشل استيراد الديون.', type: 'info', delegateName: currentUser?.name || '', title: 'خطأ', percentage: 0 });
    }
  };

  /*
  useEffect(() => {
    if (!currentUser || currentUser.isAdmin) return;
    
    const today = new Date().toISOString().split('T')[0];
    const currentDayName = getFormattedWeekday();

    const delegateRoutes = routes.filter(r =>
        r.delegateName.trim() === currentUser.name.trim() &&
        r.path?.includes(currentDayName)
    );

    const unvisitedCount = delegateRoutes.filter(r => {
        const customerEntries = salesEntries.filter(e => e.customerCode === r.customerCode);
        return !customerEntries.some(e => e.dateString === today);
    }).length;

    if (unvisitedCount > 0) {
        addToast({ message: `تذكير: لديك ${unvisitedCount} زبون لم تتم زيارتهم بعد اليوم.`, type: 'info' });
    }
  }, [routes, salesEntries, currentUser]);
  */

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const baghdadToday = baghdadStatus.todayBaghdad;
    const queryDates = Array.from(new Set([today, baghdadToday]));
    const q = query(collection(db, 'daily_sales_completion'), where('date', 'in', queryDates));
    const unsub = safeOnSnapshot(
      q, 
      (snap: any) => {
        const completed: Record<string, boolean> = {};
        snap.forEach((d: any) => {
          completed[d.id] = true;
          const data = d.data();
          if (data.delegate) completed[data.delegate] = true;
          if (data.delegateName) completed[data.delegateName] = true;
          if (data.delegateCode) completed[data.delegateCode] = true;
        });
        setCompletedDelegates(completed);
      },
      (err: any) => {
        logFirestoreErrorGracefully(err, 'daily_sales_completion in RoutesScreen');
      },
      'RoutesScreen-completion'
    );
    
    // Load manual visits
    const delegateCode = String(effectiveDelegateCode || '').trim();
    if (delegateCode) {
        const visitsQ = query(collection(db, 'daily_visits'), where('date', '==', today), where('delegateCode', '==', delegateCode));
        const unsubVisits = safeOnSnapshot(
          visitsQ, 
          (snap: any) => {
            const v: Record<string, boolean> = {};
            snap.forEach((d: any) => {
              v[d.data().customerCode] = true;
            });
            setManualVisits(v);
          },
          (err: any) => {
            logFirestoreErrorGracefully(err, 'daily_visits in RoutesScreen');
          },
          'RoutesScreen-manual-visits'
        );
        return () => { unsub(); unsubVisits(); };
    }
    
    return () => unsub();
  }, [currentUser, effectiveDelegateCode, baghdadStatus.todayBaghdad]);

  const [routeFilterDelegate, setRouteFilterDelegate] = useState((currentUser?.isAdmin || isDataEntry) ? '' : currentUser?.delegateCode || '');
  const [routeFilterDay, setRouteFilterDay] = useState('');
  const [routeFilterType, setRouteFilterType] = useState<'' | 'مفرد' | 'جملة'>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(20);

  // Available delegates for the filter dropdown
  const allAvailableDelegates = useMemo(() => {
    const list: { key: string; value: string; label: string }[] = [];
    const seen = new Set<string>();

    // 1. From delegateAccounts
    delegateAccounts.forEach((acc, idx) => {
      const name = (acc.delegateName || acc.username || '').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        list.push({
          key: acc.username || acc.delegateCode || `del-acc-${idx}`,
          value: name,
          label: acc.delegateName ? `${acc.delegateName} (${acc.delegateCode || acc.username})` : acc.username
        });
      }
    });

    // 2. From delegatesList
    delegatesList.forEach((name, idx) => {
      const cleanName = (name || '').trim();
      if (cleanName && !seen.has(cleanName.toLowerCase())) {
        seen.add(cleanName.toLowerCase());
        list.push({
          key: `del-list-${idx}`,
          value: cleanName,
          label: cleanName
        });
      }
    });

    // 3. From routes themselves
    routes.forEach((r, idx) => {
      const cleanName = (r.delegateName || '').trim();
      if (cleanName && !seen.has(cleanName.toLowerCase())) {
        seen.add(cleanName.toLowerCase());
        list.push({
          key: `route-del-${idx}`,
          value: cleanName,
          label: cleanName
        });
      }
    });

    return list
      .filter((d) => !isHiddenDelegateForFilter(d.value) && !isHiddenDelegateForFilter(d.label))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [delegateAccounts, delegatesList, routes]);

  useEffect(() => {
    if (!currentUser) return;
    
    // Always load all routes; permissions are granted in rules and delegate filtering is handled securely in memory
    const routesQ = query(collection(db, 'routes'));

    const unsubRoutes = safeOnSnapshot(routesQ, (snap: any) => {
      const loaded: RouteItem[] = [];
      snap.forEach((d: any) => {
        const data = d.data();
        loaded.push({
          ...data,
          id: d.id,
          customerName: String(data.customerName ?? '').trim(),
          customerCode: String(data.customerCode ?? '').trim(),
          customerAddress: String(data.customerAddress ?? '').trim(),
          customerPhone: data.customerPhone ? String(data.customerPhone).trim() : '',
          delegateName: String(data.delegateName ?? '').trim(),
          delegateCode: String(data.delegateCode ?? '').trim(),
          path: String(data.path ?? '').trim(),
          customerType: data.customerType || 'مفرد',
          position: typeof data.position === 'number' ? data.position : 0,
          isTemporaryOverride: Boolean(data.isTemporaryOverride || data.is_temporary_override),
          tempAssignedDay: data.tempAssignedDay || data.assigned_day || '',
          overrideExpiresAt: Number(data.overrideExpiresAt || data.override_expires_at) || 0,
          originalPath: data.originalPath || data.path || '',
          latitude: parseCoordinate(data.latitude),
          longitude: parseCoordinate(data.longitude),
          shopLocation: data.shopLocation ? String(data.shopLocation).trim() : '',
          repLocationSaved: Boolean(data.repLocationSaved),
          locationClearedAt: Number(data.locationClearedAt) || 0,
          visitedToday: Boolean(data.visitedToday ?? data.visited_today),
        } as RouteItem);
      });
      setRoutes(loaded);
      setRoutesLoaded(true);
    }, (err: any) => {
      logFirestoreErrorGracefully(err, 'routes in RoutesScreen');
      setRoutesLoaded(true);
    }, 'RoutesScreen-routes');
    return () => unsubRoutes();
  }, [currentUser]);

  // Real-time Baghdad time & active route day calculation
  // At 6:00 PM (18:00) Baghdad time daily, the active route switches to tomorrow's route
  const [nowDate, setNowDate] = useState(() => new Date());

  useEffect(() => {
    // Tick every 30 seconds to catch the 6:00 PM (18:00) shift accurately
    const timer = setInterval(() => {
      setNowDate(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const routeDayInfo = useMemo(() => {
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

      // Check if current Baghdad time is 6:00 PM (18:00) or later
      const isPast6PM = hour > 18 || (hour === 18 && minute >= 0);

      // Today in Baghdad
      const todayDayName = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(nowDate);

      // Tomorrow in Baghdad
      const tomorrowDate = new Date(nowDate.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowDayName = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(tomorrowDate);

      const activeDay = isPast6PM ? tomorrowDayName : todayDayName;

      return {
        isPast6PM,
        todayDayName,
        tomorrowDayName,
        activeDay
      };
    } catch {
      const fallbackDay = new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(nowDate);
      return {
        isPast6PM: false,
        todayDayName: fallbackDay,
        tomorrowDayName: fallbackDay,
        activeDay: fallbackDay
      };
    }
  }, [nowDate]);

  const currentDay = routeDayInfo.activeDay;
  const isCompleted = Boolean(
    completedDelegates[currentUser?.name || ''] ||
    isDelegateCompletedToday(currentUser?.name, currentUser?.delegateCode)
  );

  // Set of customer codes that have debts for O(1) instant lookup
  const customerDebtsSet = useMemo(() => {
    const set = new Set<string>();
    debts.forEach(d => {
      const code = String(d.customerCode ?? '').trim();
      if (code) set.add(code);
    });
    return set;
  }, [debts]);

  // Pre-indexed summary of customer sales (visited today, weight today) scoped strictly by customerCode
  // (falling back to customerName + delegateName ONLY when an invoice has no customerCode)
  const customerSalesSummaryMap = useMemo(() => {
    const todayStr = baghdadStatus.todayBaghdad || new Date().toISOString().split('T')[0];
    const byCode = new Map<string, { visitedToday: boolean; totalWeightToday: number }>();
    const byNameDelegateNoCode = new Map<string, { visitedToday: boolean; totalWeightToday: number }>();

    allSalesEntries.forEach(e => {
      if (e.status === 'cancelled') return;
      if (e.dateString !== todayStr) return;

      const cCode = String(e.customerCode ?? '').trim();
      const weight = Number(e.totalWeightKg) || 0;

      if (cCode) {
        let item = byCode.get(cCode);
        if (!item) {
          item = { visitedToday: false, totalWeightToday: 0 };
          byCode.set(cCode, item);
        }
        item.visitedToday = true;
        item.totalWeightToday += weight;
      } else if (e.customerName) {
        const cNameNorm = normalizeArabic(e.customerName);
        const delNorm = normalizeArabic(e.delegateName);
        if (!cNameNorm) return;
        const key = `${cNameNorm}::${delNorm}`;
        let item = byNameDelegateNoCode.get(key);
        if (!item) {
          item = { visitedToday: false, totalWeightToday: 0 };
          byNameDelegateNoCode.set(key, item);
        }
        item.visitedToday = true;
        item.totalWeightToday += weight;
      }
    });

    return { byCode, byNameDelegateNoCode };
  }, [allSalesEntries, baghdadStatus.todayBaghdad]);

  const getCustomerSalesSummary = React.useCallback((r: RouteItem) => {
    const cCode = String(r.customerCode ?? '').trim();
    if (cCode) {
      return customerSalesSummaryMap.byCode.get(cCode);
    }
    const cNameNorm = normalizeArabic(r.customerName);
    const delNorm = normalizeArabic(r.delegateName);
    if (!cNameNorm) return undefined;
    return customerSalesSummaryMap.byNameDelegateNoCode.get(`${cNameNorm}::${delNorm}`);
  }, [customerSalesSummaryMap]);

  const isVisited = React.useCallback((r: RouteItem) => {
    const cCode = String(r.customerCode ?? '').trim();
    const summary = getCustomerSalesSummary(r);
    return Boolean(summary?.visitedToday || (cCode && manualVisits[cCode]));
  }, [getCustomerSalesSummary, manualVisits]);

  // Precompute distinct invoice counts per customer code (never cross-colliding common shop names)
  const customerInvoicesCountMap = useMemo(() => {
    const byCode = new Map<string, Set<string>>();
    const byNameDelegateNoCode = new Map<string, Set<string>>();
    allSalesEntries.forEach(e => {
      if (e.status === 'cancelled') return;
      const cCode = String(e.customerCode ?? '').trim().toLowerCase();
      const cNameNorm = normalizeArabic(e.customerName);
      const delNorm = normalizeArabic(e.delegateName);
      const invKey = e.invoiceId || `${e.dateString}_${delNorm}_${cCode || cNameNorm}`;
      if (cCode) {
        if (!byCode.has(cCode)) byCode.set(cCode, new Set());
        byCode.get(cCode)!.add(invKey);
      } else if (cNameNorm) {
        const key = `${cNameNorm}::${delNorm}`;
        if (!byNameDelegateNoCode.has(key)) byNameDelegateNoCode.set(key, new Set());
        byNameDelegateNoCode.get(key)!.add(invKey);
      }
    });
    return { byCode, byNameDelegateNoCode };
  }, [allSalesEntries]);

  const getRouteItemInvoicesCount = React.useCallback((r: RouteItem) => {
    const cCode = String(r.customerCode ?? '').trim().toLowerCase();
    if (cCode) {
      return customerInvoicesCountMap.byCode.get(cCode)?.size || 0;
    }
    const cNameNorm = normalizeArabic(r.customerName);
    const delNorm = normalizeArabic(r.delegateName);
    if (!cNameNorm) return 0;
    return customerInvoicesCountMap.byNameDelegateNoCode.get(`${cNameNorm}::${delNorm}`)?.size || 0;
  }, [customerInvoicesCountMap]);

  // Customer phone lookup across debts and sales entries for instant fallback
  const customerPhoneLookup = useMemo(() => {
    const map = new Map<string, string>();
    debts.forEach((d: any) => {
      const code = String(d.customerCode ?? '').trim();
      const phone = String(d.customerPhone || d.phone || '').trim();
      if (code && phone) map.set(code, phone);
    });
    allSalesEntries.forEach((e: any) => {
      const code = String(e.customerCode ?? '').trim();
      const phone = String(e.customerPhone || e.phone || '').trim();
      if (code && phone && !map.has(code)) map.set(code, phone);
    });
    return map;
  }, [debts, allSalesEntries]);

  const getCustomerPhone = React.useCallback((r: RouteItem): string => {
    if (r.customerPhone && r.customerPhone.trim()) return r.customerPhone.trim();
    const cCode = String(r.customerCode || '').trim();
    const fromMap = customerPhoneLookup.get(cCode);
    if (fromMap) return fromMap;
    const match = r.customerName?.match(/(07\d{9}|9647\d{9}|\+9647\d{9})/);
    if (match) return match[0];
    return '';
  }, [customerPhoneLookup]);

  // Helper: determine if a given delegate's workday has ended today
  // (either they clicked "لقد أكملت مبيعات اليوم" OR official closing time has passed without an active custom extension)
  const getDelegateDayEndStatus = React.useCallback(
    (delName?: string, delCode?: string): { ended: boolean; reason: 'closing_time_expired' | 'delegate_completed_sales' } => {
      const nameStr = (delName || '').trim();
      const normDel = normalizeArabic(nameStr);
      const customTimerInfo = delegateCustomTimes[nameStr] || delegateCustomTimes[normDel];

      let hasActiveCustomExtension = false;
      if (customTimerInfo && customTimerInfo.active) {
        if (customTimerInfo.expireAtTimestamp) {
          hasActiveCustomExtension = Date.now() < customTimerInfo.expireAtTimestamp;
        } else if (customTimerInfo.customTime) {
          try {
            const now = new Date();
            const parts = new Intl.DateTimeFormat('en-US', {
              timeZone: 'Asia/Baghdad',
              hour12: false,
              hour: 'numeric',
              minute: 'numeric',
              second: 'numeric',
            }).formatToParts(now);
            const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
            const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
            const s = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);
            const currentSec = h * 3600 + m * 60 + s;
            const [th, tm] = customTimerInfo.customTime.split(':');
            const targetSec = parseInt(th || '21', 10) * 3600 + parseInt(tm || '00', 10) * 60;
            hasActiveCustomExtension = currentSec < targetSec;
          } catch {
            hasActiveCustomExtension = false;
          }
        }
      }

      const delegateCompleted = Boolean(
        (nameStr && completedDelegates[nameStr]) ||
          (normDel && completedDelegates[normDel]) ||
          isDelegateCompletedToday(delName, delCode)
      );

      if (delegateCompleted && !hasActiveCustomExtension) {
        return { ended: true, reason: 'delegate_completed_sales' };
      }
      if (baghdadStatus.isPastClosing && !hasActiveCustomExtension) {
        return { ended: true, reason: 'closing_time_expired' };
      }
      return { ended: false, reason: 'closing_time_expired' };
    },
    [delegateCustomTimes, completedDelegates, baghdadStatus.isPastClosing, timeTick]
  );

  // Count how many distinct delegates have completed their sales today
  const completedDelegatesCountToday = useMemo(() => {
    const names = new Set<string>();
    Object.entries(completedDelegates).forEach(([k, v]) => {
      if (v) names.add(normalizeArabic(k));
    });
    return names.size;
  }, [completedDelegates]);

  // Compute ALL today's live RED shops (scheduled on today's Baghdad weekday,
  // NO non-cancelled invoice today (`!isVisited`), and NO unsuccessful visit today (`!isRouteUnsuccessfulToday`)).
  // Successful visits (GREEN) are NEVER included; unsuccessful visits (YELLOW) belong to Sub-section 1.
  const todayLiveRedShops = useMemo<EndOfDayUnvisitedShop[]>(() => {
    const todayStr = baghdadStatus.todayBaghdad || new Date().toISOString().split('T')[0];
    const normTodayDay = normalizeArabic(routeDayInfo.todayDayName);
    if (!normTodayDay || enrichedRoutes.length === 0) return [];

    const seenKeys = new Set<string>();
    const results: EndOfDayUnvisitedShop[] = [];
    const nowIso = new Date().toISOString();

    enrichedRoutes.forEach((r) => {
      const effDay = normalizeArabic(getEffectiveRouteDay(r));
      if (!effDay || (!effDay.includes(normTodayDay) && !normTodayDay.includes(effDay))) {
        return;
      }

      // Exclude GREEN shops (invoiced/visited today)
      if (isVisited(r)) return;

      // Exclude YELLOW shops (unsuccessful visit recorded today — shown in Sub-section 1)
      if (isRouteUnsuccessfulToday(r)) return;

      const cCode = String(r.customerCode ?? '').trim();
      const cNameNorm = normalizeArabic(r.customerName);
      const delNorm = normalizeArabic(r.delegateName);
      const dedupeKey = cCode ? `code::${cCode}` : `name::${cNameNorm}::${delNorm}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);

      const endStatus = getDelegateDayEndStatus(r.delegateName, r.delegateCode);
      const coords = resolveRouteCoordinatesWithCache(r, cachedShopCoordsMap);
      const hasMapLocation = coords.latitude !== null && coords.longitude !== null;
      const safeIdPart = (cCode || cNameNorm || r.id || 'shop').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
      const safeDelPart = (delNorm || 'rep').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');

      results.push({
        id: `${todayStr}_${safeIdPart}_${safeDelPart}`,
        routeId: r.id,
        customerCode: cCode,
        customerName: r.customerName,
        customerAddress: r.customerAddress || '',
        customerType: r.customerType || 'مفرد',
        phone: getCustomerPhone(r) || '',
        delegateName: r.delegateName || '',
        delegateCode: r.delegateCode || '',
        routeDay: getEffectiveRouteDay(r) || routeDayInfo.todayDayName,
        dateString: todayStr,
        latitude: hasMapLocation ? coords.latitude : null,
        longitude: hasMapLocation ? coords.longitude : null,
        hasMapLocation,
        closureReason: endStatus.ended ? endStatus.reason : 'in_progress_unvisited',
        recordedAt: nowIso,
      });
    });

    results.sort((a, b) => {
      const delCmp = (a.delegateName || '').localeCompare(b.delegateName || '', 'ar');
      if (delCmp !== 0) return delCmp;
      return (a.customerName || '').localeCompare(b.customerName || '', 'ar');
    });

    return results;
  }, [
    enrichedRoutes,
    baghdadStatus.todayBaghdad,
    routeDayInfo.todayDayName,
    getDelegateDayEndStatus,
    isVisited,
    unsuccessfulVisitsTodayKeys,
    cachedShopCoordsMap,
    getCustomerPhone,
  ]);

  // Subset of today's red shops whose delegate's day has ended (persisted to Firestore for subsequent days)
  const todayEndedUnvisitedShops = useMemo<EndOfDayUnvisitedShop[]>(
    () => todayLiveRedShops.filter((s) => s.closureReason !== 'in_progress_unvisited'),
    [todayLiveRedShops]
  );

  // Persist today's ended-day unvisited (red) shops snapshot to Firestore (1 compact doc per date)
  // so Admin always has a persistent record even on subsequent days.
  useEffect(() => {
    if (isGlobalQuotaExceeded() || enrichedRoutes.length === 0) return;
    const todayStr = baghdadStatus.todayBaghdad;
    if (!todayStr) return;

    if (isStrictAdmin) {
      const existingTodaySnap = dailyUnvisitedSnapshots.find((s) => s.dateString === todayStr);
      const dismissedSet = new Set<string>(existingTodaySnap?.dismissedShopIds || []);
      const effectiveShops = todayEndedUnvisitedShops.filter((s) => !dismissedSet.has(s.id));

      if (effectiveShops.length === 0 && !existingTodaySnap) return;

      const nextSig = `admin|${todayStr}|${effectiveShops.map((s) => s.id).join(',')}`;
      const savedSig = existingTodaySnap
        ? `admin|${todayStr}|${(existingTodaySnap.shops || []).map((s) => s.id).join(',')}`
        : '';

      if (nextSig === savedSig || nextSig === lastSyncedUnvisitedSigRef.current) return;
      lastSyncedUnvisitedSigRef.current = nextSig;

      const payload: DailyUnvisitedSnapshot = {
        id: todayStr,
        dateString: todayStr,
        routeDay: routeDayInfo.todayDayName,
        closingTime: formattedTargetTime,
        shops: effectiveShops,
        dismissedShopIds: existingTodaySnap?.dismissedShopIds || [],
        updatedAt: new Date().toISOString(),
        timestamp: Date.now(),
      };

      setDoc(doc(db, 'daily_unvisited_shops', todayStr), cleanFirestoreData(payload), { merge: true }).catch((err) => {
        logFirestoreErrorGracefully(err, 'sync daily_unvisited_shops (admin)');
      });
      return;
    }

    // Representative side: if this rep's own day has ended, merge ONLY their own unvisited red shops once
    // so Admin sees them even if Admin didn't open the app before midnight.
    if (isFieldRep && currentUser) {
      const myName = normalizeArabic(currentUser.name || currentUser.delegateName || '');
      const myCode = normalizeArabic(effectiveDelegateCode || currentUser.delegateCode || '');
      if (!myName && !myCode) return;

      const myOwnShops = todayEndedUnvisitedShops.filter((s) => {
        const sDel = normalizeArabic(s.delegateName);
        const sCode = normalizeArabic(s.delegateCode);
        return (
          (myName !== '' && (sDel === myName || sDel.includes(myName) || myName.includes(sDel))) ||
          (myCode !== '' && sCode === myCode)
        );
      });

      if (myOwnShops.length === 0) return;

      const repSig = `rep|${todayStr}|${myName || myCode}|${myOwnShops.map((s) => s.id).join(',')}`;
      if (repSig === lastSyncedUnvisitedSigRef.current) return;
      try {
        if (sessionStorage.getItem(`eod_unvisited_synced_${todayStr}`) === repSig) {
          lastSyncedUnvisitedSigRef.current = repSig;
          return;
        }
      } catch {}

      lastSyncedUnvisitedSigRef.current = repSig;
      const docRef = doc(db, 'daily_unvisited_shops', todayStr);

      getDoc(docRef)
        .then((snap) => {
          const existing = snap.exists() ? (snap.data() as Partial<DailyUnvisitedSnapshot>) : null;
          const dismissedSet = new Set<string>(Array.isArray(existing?.dismissedShopIds) ? existing!.dismissedShopIds! : []);
          const existingShops: EndOfDayUnvisitedShop[] = Array.isArray(existing?.shops) ? existing!.shops! : [];

          const otherDelegatesShops = existingShops.filter((s) => {
            const sDel = normalizeArabic(s.delegateName);
            const sCode = normalizeArabic(s.delegateCode);
            const isMine =
              (myName !== '' && (sDel === myName || sDel.includes(myName) || myName.includes(sDel))) ||
              (myCode !== '' && sCode === myCode);
            return !isMine;
          });

          const filteredMyShops = myOwnShops.filter((s) => !dismissedSet.has(s.id));
          const mergedShops = [...otherDelegatesShops, ...filteredMyShops];

          return setDoc(
            docRef,
            cleanFirestoreData({
              id: todayStr,
              dateString: todayStr,
              routeDay: existing?.routeDay || routeDayInfo.todayDayName,
              closingTime: formattedTargetTime,
              shops: mergedShops,
              dismissedShopIds: Array.from(dismissedSet),
              updatedAt: new Date().toISOString(),
              timestamp: Date.now(),
            }),
            { merge: true }
          );
        })
        .then(() => {
          try {
            sessionStorage.setItem(`eod_unvisited_synced_${todayStr}`, repSig);
          } catch {}
        })
        .catch((err) => {
          logFirestoreErrorGracefully(err, 'sync daily_unvisited_shops (rep)');
        });
    }
  }, [
    isStrictAdmin,
    isFieldRep,
    currentUser,
    effectiveDelegateCode,
    enrichedRoutes.length,
    baghdadStatus.todayBaghdad,
    routeDayInfo.todayDayName,
    formattedTargetTime,
    todayEndedUnvisitedShops,
    dailyUnvisitedSnapshots,
  ]);

  const handleDeleteUnvisitedShopRow = async (dateString: string, shopId: string) => {
    if (!isStrictAdmin || !dateString || !shopId) return;
    try {
      const existingSnap = dailyUnvisitedSnapshots.find((s) => s.dateString === dateString);
      const currentShops =
        dateString === baghdadStatus.todayBaghdad && (!existingSnap || existingSnap.shops.length === 0)
          ? todayEndedUnvisitedShops
          : existingSnap?.shops || [];
      const updatedShops = currentShops.filter((s) => s.id !== shopId);
      const updatedDismissed = Array.from(new Set([...(existingSnap?.dismissedShopIds || []), shopId]));

      await setDoc(
        doc(db, 'daily_unvisited_shops', dateString),
        cleanFirestoreData({
          id: dateString,
          dateString,
          routeDay: existingSnap?.routeDay || routeDayInfo.todayDayName,
          closingTime: existingSnap?.closingTime || formattedTargetTime,
          shops: updatedShops,
          dismissedShopIds: updatedDismissed,
          updatedAt: new Date().toISOString(),
          timestamp: Date.now(),
        }),
        { merge: true }
      );

      addToast?.({
        title: 'تم الحذف بنجاح',
        message: 'تمت إزالة المحل من سجل المحلات الحمراء غير المزارة.',
        type: 'success',
      });
    } catch (err) {
      logFirestoreErrorGracefully(err, 'handleDeleteUnvisitedShopRow');
      addToast?.({
        title: 'تعذر الحذف',
        message: 'حدث خطأ أثناء حذف السجل، يرجى المحاولة لاحقاً.',
        type: 'reminder',
      });
    }
  };

  const handleDeleteUnvisitedDaySnapshot = async (dateString: string) => {
    if (!isStrictAdmin || !dateString) return;
    try {
      if (dateString === baghdadStatus.todayBaghdad) {
        const existingSnap = dailyUnvisitedSnapshots.find((s) => s.dateString === dateString);
        const allTodayIds = Array.from(
          new Set([
            ...(existingSnap?.dismissedShopIds || []),
            ...(existingSnap?.shops || []).map((s) => s.id),
            ...todayLiveRedShops.map((s) => s.id),
          ])
        );
        await setDoc(
          doc(db, 'daily_unvisited_shops', dateString),
          cleanFirestoreData({
            id: dateString,
            dateString,
            routeDay: existingSnap?.routeDay || routeDayInfo.todayDayName,
            closingTime: formattedTargetTime,
            shops: [],
            dismissedShopIds: allTodayIds,
            updatedAt: new Date().toISOString(),
            timestamp: Date.now(),
          }),
          { merge: true }
        );
      } else {
        await deleteDoc(doc(db, 'daily_unvisited_shops', dateString));
      }

      addToast?.({
        title: 'تم مسح سجل اليوم',
        message: `تم مسح جدول المحلات غير المزارة لتاريخ ${dateString} بنجاح.`,
        type: 'success',
      });
    } catch (err) {
      logFirestoreErrorGracefully(err, 'handleDeleteUnvisitedDaySnapshot');
      addToast?.({
        title: 'تعذر المسح',
        message: 'حدث خطأ أثناء مسح سجل اليوم، يرجى المحاولة لاحقاً.',
        type: 'reminder',
      });
    }
  };

  // Base routes filtered by Customer Type and Search Query (for counting Days & Delegates)
  const routesFilteredByTypeAndSearch = useMemo(() => {
    const rawQuery = searchQuery.trim();
    const normalizedQuery = normalizeArabic(rawQuery);
    const searchTerms = normalizedQuery.split(' ').filter(Boolean);
    const isSearching = searchTerms.length > 0;

    return enrichedRoutes.filter(r => {
      // 1. Customer Type filter
      if (routeFilterType === 'جملة' && r.customerType !== 'جملة') return false;
      if (routeFilterType === 'مفرد' && r.customerType === 'جملة') return false;

      // 2. Search query filter
      if (isSearching) {
        const searchableText = [
          normalizeArabic(r.customerName),
          normalizeArabic(r.customerCode),
          normalizeArabic(r.customerAddress),
          normalizeArabic(r.customerPhone),
          normalizeArabic(r.path),
          normalizeArabic(r.delegateName),
          normalizeArabic(r.delegateCode),
          normalizeArabic(r.customerType)
        ].join(' ');

        const matchesAll = searchTerms.every(term => searchableText.includes(term));
        if (!matchesAll) return false;
      }

      return true;
    });
  }, [enrichedRoutes, routeFilterType, searchQuery]);

  // Dynamic Day shop counts
  const dayCounts = useMemo(() => {
    const delegateFiltered = routesFilteredByTypeAndSearch.filter(r => {
      if (!currentUser?.isAdmin && !isDataEntry) {
        const currentName = normalizeArabic(currentUser?.name);
        const currentCode = normalizeArabic(currentUser?.delegateCode);
        const currentUsername = normalizeArabic(currentUser?.username);
        const rDelName = normalizeArabic(r.delegateName);
        const rDelCode = normalizeArabic(r.delegateCode);

        return (currentName !== '' && (rDelName.includes(currentName) || currentName.includes(rDelName))) ||
               (currentCode !== '' && (rDelCode === currentCode || rDelName.includes(currentCode))) ||
               (currentUsername !== '' && (rDelName.includes(currentUsername) || rDelCode === currentUsername));
      }

      if (!routeFilterDelegate) return true;

      const filterNorm = normalizeArabic(routeFilterDelegate);
      const rDelName = normalizeArabic(r.delegateName);
      const rDelCode = normalizeArabic(r.delegateCode);

      const matchedAccount = delegateAccounts.find(
        a => (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
             (a.username && normalizeArabic(a.username) === filterNorm) ||
             (a.delegateName && normalizeArabic(a.delegateName) === filterNorm)
      );

      const matchCode = matchedAccount?.delegateCode ? normalizeArabic(matchedAccount.delegateCode) : '';
      const matchName = matchedAccount?.delegateName ? normalizeArabic(matchedAccount.delegateName) : '';
      const matchUser = matchedAccount?.username ? normalizeArabic(matchedAccount.username) : '';

      return (
        (rDelName !== '' && (
          rDelName === filterNorm ||
          rDelName.includes(filterNorm) ||
          filterNorm.includes(rDelName) ||
          (matchName !== '' && (rDelName === matchName || rDelName.includes(matchName))) ||
          (matchUser !== '' && (rDelName === matchUser || rDelName.includes(matchUser)))
        )) ||
        (rDelCode !== '' && (
          rDelCode === filterNorm ||
          rDelCode.includes(filterNorm) ||
          (matchCode !== '' && (rDelCode === matchCode || rDelCode.includes(matchCode))) ||
          (matchUser !== '' && (rDelCode === matchUser || rDelCode.includes(matchUser)))
        ))
      );
    });

    const counts: Record<string, number> = {
      '': delegateFiltered.length
    };

    const daysList = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس'];
    daysList.forEach(day => {
      const normDay = normalizeArabic(day);
      counts[day] = delegateFiltered.filter(r => normalizeArabic(getEffectiveRouteDay(r)).includes(normDay)).length;
    });

    return counts;
  }, [routesFilteredByTypeAndSearch, currentUser, isDataEntry, routeFilterDelegate, delegateAccounts]);

  // Dynamic Delegate shop counts
  const delegateCounts = useMemo(() => {
    const dayFiltered = routesFilteredByTypeAndSearch.filter(r => {
      if (currentUser?.isAdmin || isDataEntry) {
        if (routeFilterDay) {
          return normalizeArabic(getEffectiveRouteDay(r)).includes(normalizeArabic(routeFilterDay));
        }
        return true;
      } else {
        const normCurrentDay = normalizeArabic(currentDay);
        const normPath = normalizeArabic(getEffectiveRouteDay(r));
        return normPath.includes(normCurrentDay) || normCurrentDay.includes(normPath);
      }
    });

    const counts: Record<string, number> = {
      '': dayFiltered.length
    };

    allAvailableDelegates.forEach(d => {
      const filterNorm = normalizeArabic(d.value);
      const matchedAccount = delegateAccounts.find(
        a => (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
             (a.username && normalizeArabic(a.username) === filterNorm) ||
             (a.delegateName && normalizeArabic(a.delegateName) === filterNorm)
      );

      const matchCode = matchedAccount?.delegateCode ? normalizeArabic(matchedAccount.delegateCode) : '';
      const matchName = matchedAccount?.delegateName ? normalizeArabic(matchedAccount.delegateName) : '';
      const matchUser = matchedAccount?.username ? normalizeArabic(matchedAccount.username) : '';

      const count = dayFiltered.filter(r => {
        const rDelName = normalizeArabic(r.delegateName);
        const rDelCode = normalizeArabic(r.delegateCode);

        return (
          (rDelName !== '' && (
            rDelName === filterNorm ||
            rDelName.includes(filterNorm) ||
            filterNorm.includes(rDelName) ||
            (matchName !== '' && (rDelName === matchName || rDelName.includes(matchName))) ||
            (matchUser !== '' && (rDelName === matchUser || rDelName.includes(matchUser)))
          )) ||
          (rDelCode !== '' && (
            rDelCode === filterNorm ||
            rDelCode.includes(filterNorm) ||
            (matchCode !== '' && (rDelCode === matchCode || rDelCode.includes(matchCode))) ||
            (matchUser !== '' && (rDelCode === matchUser || rDelCode.includes(matchUser)))
          ))
        );
      }).length;

      counts[d.value] = count;
      counts[d.key] = count;
    });

    return counts;
  }, [routesFilteredByTypeAndSearch, currentUser, isDataEntry, routeFilterDay, currentDay, allAvailableDelegates, delegateAccounts]);

  const routesBeforeTypeFilter = useMemo(() => {
    const rawQuery = searchQuery.trim();
    const normalizedQuery = normalizeArabic(rawQuery);
    const searchTerms = normalizedQuery.split(' ').filter(Boolean);
    const isSearching = searchTerms.length > 0;

    return routes.filter(r => {
      // 1. Delegate matching
      let delegateMatch = true;
      if (currentUser?.isAdmin || isDataEntry) {
        if (routeFilterDelegate) {
          const filterNorm = normalizeArabic(routeFilterDelegate);
          const rDelName = normalizeArabic(r.delegateName);
          const rDelCode = normalizeArabic(r.delegateCode);

          const matchedAccount = delegateAccounts.find(
            a => (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm) ||
                 (a.username && normalizeArabic(a.username) === filterNorm) ||
                 (a.delegateName && normalizeArabic(a.delegateName) === filterNorm)
          );

          const matchCode = matchedAccount?.delegateCode ? normalizeArabic(matchedAccount.delegateCode) : '';
          const matchName = matchedAccount?.delegateName ? normalizeArabic(matchedAccount.delegateName) : '';
          const matchUser = matchedAccount?.username ? normalizeArabic(matchedAccount.username) : '';

          delegateMatch = 
            (rDelName !== '' && (
              rDelName === filterNorm ||
              rDelName.includes(filterNorm) ||
              filterNorm.includes(rDelName) ||
              (matchName !== '' && (rDelName === matchName || rDelName.includes(matchName))) ||
              (matchUser !== '' && (rDelName === matchUser || rDelName.includes(matchUser)))
            )) ||
            (rDelCode !== '' && (
              rDelCode === filterNorm ||
              rDelCode.includes(filterNorm) ||
              (matchCode !== '' && (rDelCode === matchCode || rDelCode.includes(matchCode))) ||
              (matchUser !== '' && (rDelCode === matchUser || rDelCode.includes(matchUser)))
            ));
        }
      } else {
        // Non-admin delegate: match only their own routes
        const currentName = normalizeArabic(currentUser?.name);
        const currentCode = normalizeArabic(currentUser?.delegateCode);
        const currentUsername = normalizeArabic(currentUser?.username);
        const rDelName = normalizeArabic(r.delegateName);
        const rDelCode = normalizeArabic(r.delegateCode);

        delegateMatch = (currentName !== '' && (rDelName.includes(currentName) || currentName.includes(rDelName))) ||
                        (currentCode !== '' && (rDelCode === currentCode || rDelName.includes(currentCode))) ||
                        (currentUsername !== '' && (rDelName.includes(currentUsername) || rDelCode === currentUsername));
      }

      if (!delegateMatch) return false;

      // 2. Day / Active Route matching (Strictly restricted to currently active/selected route)
      let dayMatch = true;
      if (currentUser?.isAdmin || isDataEntry) {
        if (routeFilterDay) {
          dayMatch = normalizeArabic(getEffectiveRouteDay(r)).includes(normalizeArabic(routeFilterDay));
        }
      } else {
        // For delegate / representative: restricted strictly to today's active route
        const normCurrentDay = normalizeArabic(currentDay);
        const normPath = normalizeArabic(getEffectiveRouteDay(r));
        dayMatch = normPath.includes(normCurrentDay) || normCurrentDay.includes(normPath);
      }

      if (!dayMatch) return false;

      // 3. Search matching across customer fields
      if (isSearching) {
        const searchableText = [
          normalizeArabic(r.customerName),
          normalizeArabic(r.customerCode),
          normalizeArabic(r.customerAddress),
          normalizeArabic(r.customerPhone),
          normalizeArabic(getEffectiveRouteDay(r)),
          normalizeArabic(r.delegateName),
          normalizeArabic(r.delegateCode),
          normalizeArabic(r.customerType)
        ].join(' ');

        const matchesAll = searchTerms.every(term => searchableText.includes(term));
        if (!matchesAll) return false;
      }

      return true;
    });
  }, [routes, currentUser, routeFilterDelegate, delegateAccounts, routeFilterDay, currentDay, searchQuery, isDataEntry]);

  const customerTypeCounts = useMemo(() => {
    let mifrad = 0;
    let jumla = 0;
    routesBeforeTypeFilter.forEach(r => {
      if (r.customerType === 'جملة') {
        jumla++;
      } else {
        mifrad++;
      }
    });
    return {
      all: routesBeforeTypeFilter.length,
      mifrad,
      jumla
    };
  }, [routesBeforeTypeFilter]);

  const filteredRoutes = useMemo(() => {
    return routesBeforeTypeFilter.filter(r => {
      if (!routeFilterType) return true;
      if (routeFilterType === 'جملة') return r.customerType === 'جملة';
      if (routeFilterType === 'مفرد') return r.customerType !== 'جملة';
      return true;
    }).sort((a, b) => {
      const aVisited = isVisited(a);
      const bVisited = isVisited(b);
      const aSummary = getCustomerSalesSummary(a);
      const bSummary = getCustomerSalesSummary(b);
      const aWeight = aSummary?.totalWeightToday || 0;
      const bWeight = bSummary?.totalWeightToday || 0;

      const aUnvisitedZero = !aVisited && aWeight === 0;
      const bUnvisitedZero = !bVisited && bWeight === 0;

      // 1. First in table: unvisited shops with zero weight
      if (aUnvisitedZero && !bUnvisitedZero) return -1;
      if (!aUnvisitedZero && bUnvisitedZero) return 1;

      // 2. Sort shops by sales weight ascending (lowest weight first, more weight at bottom / من الأسفل إلى الأعلى)
      if (aWeight !== bWeight) {
        return aWeight - bWeight;
      }

      // 3. Secondary: unvisited before visited among weighted shops
      if (aVisited !== bVisited) {
        return aVisited ? 1 : -1;
      }

      // 4. Tertiary: Position
      const aPos = a.position || 0;
      const bPos = b.position || 0;
      if (aPos !== bPos) return bPos - aPos;

      return 0;
    });
  }, [routesBeforeTypeFilter, routeFilterType, getCustomerSalesSummary, isVisited]);

  const finalRoutes = filteredRoutes;

  const delegateTodayBreakdown = useMemo(() => {
    const todayStr = baghdadStatus.todayBaghdad || new Date().toISOString().split('T')[0];
    const normCurrentDay = normalizeArabic(currentDay);

    return allAvailableDelegates.map(del => {
      const delNameNorm = normalizeArabic(del.value);

      const delRoutes = routes.filter(r => {
        const rDelName = normalizeArabic(r.delegateName);
        const rDelCode = normalizeArabic(r.delegateCode);
        const rDay = normalizeArabic(getEffectiveRouteDay(r));
        const matchDel = rDelName === delNameNorm || rDelName.includes(delNameNorm) || delNameNorm.includes(rDelName) || rDelCode === delNameNorm;
        const matchDay = !normCurrentDay || rDay.includes(normCurrentDay) || normCurrentDay.includes(rDay);
        return matchDel && matchDay;
      });

      const scheduledToday = delRoutes.length;

      const delSalesToday = allSalesEntries.filter(e => {
        const eDelName = normalizeArabic(e.delegateName);
        const matchDel = eDelName === delNameNorm || eDelName.includes(delNameNorm) || delNameNorm.includes(eDelName);
        return e.dateString === todayStr && matchDel;
      });
      const invoicesToday = new Set(delSalesToday.map(e => e.customerCode || e.customerName)).size;

      const remainingToday = delRoutes.filter(r => {
        const cCode = String(r.customerCode ?? '').trim();
        const summary = getCustomerSalesSummary(r);
        return !summary?.visitedToday && !(cCode && manualVisits[cCode]);
      }).length;

      return {
        name: del.value,
        label: del.label,
        scheduledToday,
        invoicesToday,
        remainingToday,
      };
    }).filter(d => d.scheduledToday > 0 || d.invoicesToday > 0);
  }, [allAvailableDelegates, routes, allSalesEntries, currentDay, baghdadStatus.todayBaghdad, getCustomerSalesSummary, manualVisits]);

  // Group routes by path/day in a single pass without re-sorting inline in JSX
  const groupedRoutesByDay = useMemo(() => {
    const listToDisplay = searchQuery.trim() ? finalRoutes : finalRoutes.slice(0, displayLimit);
    const groups: Record<string, RouteItem[]> = {};
    for (const r of listToDisplay) {
      const day = getEffectiveRouteDay(r) || 'غير مصنف';
      if (!groups[day]) groups[day] = [];
      groups[day].push(r);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }, [finalRoutes, searchQuery, displayLimit]);

  // Optionally keep a check, but inform instead of block, or just rely on the effective code
  if (!currentUser?.isAdmin && !isDataEntry && !effectiveDelegateCode) {
      return (
          <div className="text-center py-10">
            <AlertCircle className="w-12 h-12 mx-auto text-amber-500 mb-2" />
            <p className="text-slate-600 dark:text-slate-400 font-bold">لا يتوفر كود مندوب لهذا المستخدم.</p>
          </div>
      );
  }

  const handleRowClick = (r: RouteItem) => {
    setSelectedRowId(r.id);
  };

  const moveToTop = async (r: RouteItem) => {
    try {
      await updateDoc(doc(db, 'routes', r.id), { position: Date.now() });
      addToast({ message: 'تم تصعيد المحل للأعلى بنجاح', type: 'success', delegateName: currentUser?.name || '', title: 'تصعيد', percentage: 0 });
    } catch (e) {
      addToast({ message: 'حدث خطأ أثناء التصعيد', type: 'info', delegateName: currentUser?.name || '', title: 'خطأ', percentage: 0 });
    }
  };

  const noteMatchesDelegate = React.useCallback((note: CustomerInfoNote, filterDel: string): boolean => {
    if (!filterDel) return true;
    const filterNorm = normalizeArabic(filterDel);
    const nDelName = normalizeArabic(note.delegateName);
    const nDelCode = String(note.delegateCode || '').trim().toLowerCase();

    const matchedAcc = delegateAccounts.find(
      a =>
        (a.delegateName && normalizeArabic(a.delegateName) === filterNorm) ||
        (a.username && normalizeArabic(a.username) === filterNorm) ||
        (a.delegateCode && normalizeArabic(a.delegateCode) === filterNorm)
    );
    const matchCode = matchedAcc?.delegateCode ? String(matchedAcc.delegateCode).trim().toLowerCase() : '';
    const matchName = matchedAcc?.delegateName ? normalizeArabic(matchedAcc.delegateName) : '';

    return Boolean(
      (nDelName && (nDelName === filterNorm || (matchName && nDelName === matchName))) ||
      (nDelCode && ((matchCode && nDelCode === matchCode) || nDelCode === filterNorm))
    );
  }, [delegateAccounts]);

  // Delegate filter buttons list & counts for Customer Notes
  const notesDelegateOptions = useMemo(() => {
    const namesMap = new Map<string, { name: string; count: number }>();

    allAvailableDelegates.forEach((d) => {
      const clean = (d.value || '').trim();
      const norm = normalizeArabic(clean);
      if (clean && norm && !isHiddenDelegateForFilter(clean) && norm !== normalizeArabic('الأدمن')) {
        if (!namesMap.has(norm)) {
          namesMap.set(norm, { name: clean, count: 0 });
        }
      }
    });

    customerNotes.forEach((note) => {
      const clean = (note.delegateName || '').trim();
      const norm = normalizeArabic(clean);
      if (!clean || !norm || isHiddenDelegateForFilter(clean)) return;
      if (!namesMap.has(norm)) {
        namesMap.set(norm, { name: clean, count: 0 });
      }
    });

    const list = Array.from(namesMap.values()).map((item) => ({
      name: item.name,
      count: customerNotes.filter((n) => noteMatchesDelegate(n, item.name)).length,
    }));

    return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar'));
  }, [allAvailableDelegates, customerNotes, noteMatchesDelegate]);

  // User role filtering for customer notes (delegates see their own notes, admins see all)
  const visibleCustomerNotes = useMemo(() => {
    const isPrivileged = Boolean(currentUser?.isAdmin || isDataEntry);
    const currentDelName = normalizeArabic(currentUser?.name || currentUser?.delegateName || '');
    const currentDelCode = String(currentUser?.delegateCode || effectiveDelegateCode || '').trim().toLowerCase();

    let list = customerNotes;
    if (!isPrivileged) {
      list = list.filter(note => {
        const nDelName = normalizeArabic(note.delegateName);
        const nDelCode = String(note.delegateCode || '').trim().toLowerCase();
        return (currentDelName && (nDelName === currentDelName || nDelName.includes(currentDelName))) ||
               (currentDelCode && nDelCode === currentDelCode);
      });
    } else if (notesDelegateFilter) {
      list = list.filter(note => noteMatchesDelegate(note, notesDelegateFilter));
    }

    // Filter by action status
    if (notesActionFilter === 'pending') {
      list = list.filter(note => !note.adminActionTaken);
    } else if (notesActionFilter === 'action_taken') {
      list = list.filter(note => Boolean(note.adminActionTaken));
    }

    const q = normalizeArabic(notesSearchQuery);
    if (q) {
      list = list.filter(note => {
        const searchStr = [
          normalizeArabic(note.customerName),
          normalizeArabic(note.customerCode),
          normalizeArabic(note.customerAddress),
          normalizeArabic(note.delegateName),
          normalizeArabic(note.selectedOption),
          normalizeArabic(note.notes),
          normalizeArabic(note.adminActionDetails),
          normalizeArabic(note.adminActionBy)
        ].join(' ');
        return searchStr.includes(q);
      });
    }

    return [...list].sort((a, b) => {
      const aDone = a.adminActionTaken ? 1 : 0;
      const bDone = b.adminActionTaken ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const aTs = Number(a.timestamp) || (a.createdAt ? new Date(a.createdAt).getTime() : 0) || 0;
      const bTs = Number(b.timestamp) || (b.createdAt ? new Date(b.createdAt).getTime() : 0) || 0;
      return bTs - aTs;
    });
  }, [customerNotes, currentUser, isDataEntry, effectiveDelegateCode, notesActionFilter, notesSearchQuery, notesDelegateFilter, noteMatchesDelegate]);

  // Reset notes table pagination back to first 10 whenever filters or search change
  useEffect(() => {
    setNotesVisibleLimit(10);
  }, [notesActionFilter, notesSearchQuery, notesDelegateFilter]);

  const isPrivilegedShopLocsViewer = Boolean(
    (currentUser?.isAdmin ||
      currentUser?.role === 'admin' ||
      currentUser?.name === 'الأدمن' ||
      isDataEntry) &&
      currentUser?.role !== 'delegate'
  );

  const shopLocationsDelegateOptions = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    savedShopLocations.forEach((rec) => {
      const rawName = (rec.delegateName || rec.savedBy || '').trim();
      if (!rawName) return;
      const key = normalizeArabic(rawName);
      if (!key) return;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { name: rawName, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [savedShopLocations]);

  const visibleShopLocations = useMemo(() => {
    let list = savedShopLocations;
    if (!isPrivilegedShopLocsViewer) {
      // Build exact identity sets for the logged-in representative (no loose cross-rep substring matches)
      const myNames = new Set<string>();
      const myCodes = new Set<string>();

      const addName = (val?: string) => {
        const n = normalizeArabic(val || '');
        if (n) myNames.add(n);
      };
      const addCode = (val?: string) => {
        const c = String(val || '').trim().toLowerCase();
        if (c) myCodes.add(c);
      };

      addName(currentUser?.name);
      addName(currentUser?.delegateName);
      addCode(currentUser?.delegateCode);
      addCode(effectiveDelegateCode);
      addCode(currentUser?.username);

      const matchedAcc = delegateAccounts.find(
        (a) =>
          (currentUser?.username && a.username?.toLowerCase() === currentUser.username.toLowerCase()) ||
          (currentUser?.delegateCode && a.delegateCode && a.delegateCode.trim().toLowerCase() === currentUser.delegateCode.trim().toLowerCase()) ||
          (currentUser?.name && a.delegateName && normalizeArabic(a.delegateName) === normalizeArabic(currentUser.name))
      );
      if (matchedAcc) {
        addName(matchedAcc.delegateName);
        addCode(matchedAcc.delegateCode);
        addCode(matchedAcc.username);
      }

      const matchesRepIdentity = (dName?: string, dCode?: string): boolean => {
        const nName = normalizeArabic(dName || '');
        const nCode = String(dCode || '').trim().toLowerCase();
        return (nCode !== '' && myCodes.has(nCode)) || (nName !== '' && myNames.has(nName));
      };

      // Lookup routes by ID and customerCode to verify current shop ownership
      const routeById = new Map<string, RouteItem>();
      const routeByCode = new Map<string, RouteItem>();
      routes.forEach((rt) => {
        if (rt.id) routeById.set(String(rt.id).trim(), rt);
        const c = String(rt.customerCode || '').trim().toLowerCase();
        if (c) routeByCode.set(c, rt);
      });

      list = list.filter((rec) => {
        const rId = String(rec.routeId || '').trim();
        const rCustCode = String(rec.customerCode || '').trim().toLowerCase();
        const matchedRoute = (rId && routeById.get(rId)) || (rCustCode && routeByCode.get(rCustCode)) || undefined;

        if (matchedRoute) {
          return matchesRepIdentity(matchedRoute.delegateName, matchedRoute.delegateCode);
        }

        return (
          matchesRepIdentity(rec.delegateName, rec.delegateCode) ||
          matchesRepIdentity(rec.savedBy, rec.savedByCode)
        );
      });
    } else if (shopLocationsDelegateFilter) {
      const targetNorm = normalizeArabic(shopLocationsDelegateFilter);
      list = list.filter((rec) => {
        const d1 = normalizeArabic(rec.delegateName || '');
        const d2 = normalizeArabic(rec.savedBy || '');
        return d1 === targetNorm || d2 === targetNorm;
      });
    }

    const q = normalizeArabic(shopLocationsSearchQuery);
    if (q) {
      list = list.filter((rec) => {
        const hay = [
          normalizeArabic(rec.customerName),
          normalizeArabic(rec.customerCode),
          normalizeArabic(rec.customerAddress),
          normalizeArabic(rec.delegateName),
          normalizeArabic(rec.savedBy),
          normalizeArabic(rec.path),
        ].join(' ');
        return hay.includes(q);
      });
    }
    return list;
  }, [
    savedShopLocations,
    isPrivilegedShopLocsViewer,
    currentUser,
    effectiveDelegateCode,
    delegateAccounts,
    routes,
    shopLocationsDelegateFilter,
    shopLocationsSearchQuery,
  ]);

  // Overall counts for tabs (total, pending, action_taken) based on user's visibility
  const notesCounts = useMemo(() => {
    const isPrivileged = Boolean(currentUser?.isAdmin || isDataEntry);
    const currentDelName = normalizeArabic(currentUser?.name || currentUser?.delegateName || '');
    const currentDelCode = String(currentUser?.delegateCode || effectiveDelegateCode || '').trim().toLowerCase();

    let baseList = customerNotes;
    if (!isPrivileged) {
      baseList = baseList.filter(note => {
        const nDelName = normalizeArabic(note.delegateName);
        const nDelCode = String(note.delegateCode || '').trim().toLowerCase();
        return (currentDelName && (nDelName === currentDelName || nDelName.includes(currentDelName))) ||
               (currentDelCode && nDelCode === currentDelCode);
      });
    } else if (notesDelegateFilter) {
      baseList = baseList.filter(note => noteMatchesDelegate(note, notesDelegateFilter));
    }

    const total = baseList.length;
    const actionTaken = baseList.filter(n => Boolean(n.adminActionTaken)).length;
    const pending = total - actionTaken;
    return { total, actionTaken, pending };
  }, [customerNotes, currentUser, isDataEntry, effectiveDelegateCode, notesDelegateFilter, noteMatchesDelegate]);

  // Customer code -> Notes count map for route table badges (excluding action taken / completed notes)
  const customerNotesCountMap = useMemo(() => {
    const map = new Map<string, number>();
    customerNotes.forEach(note => {
      if (note.adminActionTaken) return;
      const code = String(note.customerCode || '').trim();
      if (code) {
        map.set(code, (map.get(code) || 0) + 1);
      }
    });
    return map;
  }, [customerNotes]);

  const handleExportNotesCSV = () => {
    if (visibleCustomerNotes.length === 0) {
      addToast({ title: 'تنبيه', message: 'لا توجد ملاحظات لتحميلها', type: 'info' });
      return;
    }

    const headers = [
      'التاريخ',
      'المندوب',
      'اسم الزبون',
      'كود الزبون',
      'ملاحظة المندوب',
      'تفاصيل الملاحظة',
      'العنوان',
      'حالة الإجراء',
      'تفاصيل إجراء الإدارة',
      'تم الإجراء بواسطة',
      'تاريخ الإجراء'
    ];

    const rows = visibleCustomerNotes.map(note => [
      formatEnglishDateTime(note.timestamp, '-'),
      note.delegateName || '',
      note.customerName || '',
      note.customerCode || '',
      note.selectedOption || '',
      note.notes || '',
      note.customerAddress || '',
      note.adminActionTaken ? 'تم اتخاذ إجراء' : 'قيد الانتظار',
      note.adminActionDetails || '',
      note.adminActionBy || '',
      note.adminActionAt ? formatEnglishDateTime(note.adminActionAt, '') : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ملاحظات_المندوبين_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast({ title: 'نجاح', message: 'تم تحميل ملف الملاحظات بنجاح', type: 'success' });
  };

  const handleOpenAdminActionModal = (note: CustomerInfoNote) => {
    if (!isStrictAdmin) return;
    setActionModalNote(note);
    setActionDetailsInput(note.adminActionDetails || '');
  };

  const handleSaveAdminAction = async () => {
    if (!isStrictAdmin) return;
    if (!actionModalNote?.id) {
      addToast({ title: 'خطأ', message: 'لم يتم العثور على معرف الملاحظة', type: 'info' });
      return;
    }
    if (!actionDetailsInput.trim()) {
      alert('يرجى كتابة الإجراء المتخذ بخصوص هذا الزبون ليظهر للمندوب في أعلى البطاقة');
      return;
    }

    setIsSubmittingAdminAction(true);
    try {
      const noteRef = doc(db, 'customer_info_notes', actionModalNote.id);
      const actionBy = currentUser?.name || currentUser?.delegateName || 'الادمن';
      const nowIso = new Date().toISOString();

      await updateDoc(noteRef, {
        adminActionTaken: true,
        adminActionDetails: actionDetailsInput.trim(),
        adminActionBy: actionBy,
        adminActionAt: nowIso,
        status: 'action_taken'
      });

      addToast({
        title: 'تم اعتماد الإجراء',
        message: `تم اتخاذ الإجراء وحفظه بنجاح لزبون: ${actionModalNote.customerName}`,
        type: 'success'
      });

      setActionModalNote(null);
      setActionDetailsInput('');
    } catch (err) {
      console.error('Error saving admin action:', err);
      alert('حدث خطأ أثناء حفظ الإجراء، يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmittingAdminAction(false);
    }
  };

  const handleRevertAdminAction = async (note: CustomerInfoNote) => {
    if (!isStrictAdmin || !note.id) return;
    if (!confirm(`هل أنت متأكد من إلغاء الإجراء المتخذ وإعادة بطاقة الزبون (${note.customerName}) إلى قيد الانتظار؟`)) {
      return;
    }

    try {
      const noteRef = doc(db, 'customer_info_notes', note.id);
      await updateDoc(noteRef, {
        adminActionTaken: false,
        adminActionDetails: '',
        adminActionBy: '',
        adminActionAt: '',
        status: 'pending'
      });

      addToast({
        title: 'تم التراجع',
        message: `تمت إعادة حالة الزبون (${note.customerName}) إلى قيد الانتظار`,
        type: 'info'
      });
    } catch (err) {
      console.error('Error reverting admin action:', err);
      alert('حدث خطأ أثناء التراجع عن الإجراء.');
    }
  };

  const handleOrderClick = (r: RouteItem) => {
    setSelectedRowId(r.id);
    setEditingSavedLocationRecord(null);
    setActionModalRoute(r);
    setActionModalStep('choice');
    setSelectedOption(availableOptions[0] || CUSTOMER_INFO_OPTIONS[0]);
    setOtherInfoNotesInput('');
  };

  const handleAddCustomOption = async () => {
    const trimmed = newOptionInput.trim();
    if (!trimmed) return;

    if (availableOptions.includes(trimmed)) {
      alert('هذا الخيار موجود بالفعل في القائمة');
      return;
    }

    const updated = [...availableOptions, trimmed];
    try {
      await setDoc(doc(db, 'settings', 'customer_info_options'), { options: updated }, { merge: true });
      setSelectedOption(trimmed);
      setNewOptionInput('');
      if (addToast) {
        addToast({
          title: 'تمت الإضافة',
          message: `تم إضافة الخيار الجديد "${trimmed}" إلى القائمة`,
          type: 'success'
        });
      }
    } catch (err) {
      console.error('Error adding custom option:', err);
      alert('حدث خطأ أثناء إضافة الخيار.');
    }
  };

  const handleDeleteCustomOption = async (optionToDelete: string) => {
    if (availableOptions.length <= 1) {
      alert('يجب أن تحتوي القائمة على خيار واحد على الأقل');
      return;
    }

    if (!confirm(`هل أنت تأكد من حذف الخيار "${optionToDelete}" من القائمة؟`)) return;

    const updated = availableOptions.filter(opt => opt !== optionToDelete);
    try {
      await setDoc(doc(db, 'settings', 'customer_info_options'), { options: updated }, { merge: true });
      if (selectedOption === optionToDelete) {
        setSelectedOption(updated[0] || '');
      }
      if (addToast) {
        addToast({
          title: 'تم الحذف',
          message: `تم حذف الخيار "${optionToDelete}" من القائمة`,
          type: 'success'
        });
      }
    } catch (err) {
      console.error('Error deleting custom option:', err);
      alert('حدث خطأ أثناء حذف الخيار.');
    }
  };

  const handleProceedToNewOrder = (r: RouteItem) => {
    const isPrivilegedUser = Boolean(currentUser?.isAdmin || isDataEntry);
    if (!isPrivilegedUser && isFieldRep && !isCompleted && (repGpsStatus !== 'active' || !repLiveCoords)) {
      addToast?.({
        title: 'مطلوب تفعيل الموقع (GPS)',
        message: 'يجب تفعيل صلاحية الموقع (GPS) أولاً عند طلب فاتورة للزبون.',
        type: 'reminder',
      });
      requestGeolocationFromUserGesture({ openHelpOnError: true });
      return;
    }

    setActionModalRoute(null);
    setActionModalStep(null);
    
    const todayStr = new Date().toISOString().split('T')[0];
    const customerEntries = allSalesEntries.filter(e => e.customerCode === r.customerCode);
    const lastInvoiceToday = customerEntries
        .filter(e => e.dateString === todayStr)
        .sort((a,b) => b.timestamp - a.timestamp)[0];

    setPrefilledEntryData({
      customerCode: r.customerCode,
      customerName: r.customerName,
      customerAddress: r.customerAddress,
      customerType: r.customerType,
      lastInvoiceToday: lastInvoiceToday
    });
    setShowQuickAdd(true);
    setActiveTab('products');
  };

  const canCreateInvoiceOnMap = (r: RouteItem): boolean => {
    const cCode = String(r.customerCode ?? '').trim();
    const hasDebt = customerDebtsSet.has(cCode);
    const isUnlockedForOrder = Boolean(
      unlockedCustomerCodes[cCode] ||
      unlockedCustomerCodes[normalizeArabic(r.customerName)] ||
      unlockedCustomerCodes[r.customerName]
    );
    if (hasDebt && !isUnlockedForOrder) return false;

    const isPrivilegedUser = Boolean(currentUser?.isAdmin || isDataEntry);
    if (isPrivilegedUser) return true;

    // Check configured geofence radius if shop has coordinates
    const { latitude: shopLat, longitude: shopLng } = resolveRouteCoordinatesWithCache(r, cachedShopCoordsMap);
    const savedLoc = getSavedLocationForRoute(r);
    const effLat = shopLat ?? (savedLoc ? savedLoc.latitude : null);
    const effLng = shopLng ?? (savedLoc ? savedLoc.longitude : null);

    if (effLat !== null && effLng !== null && repLiveCoords) {
      const dist = calculateHaversineDistanceMeters(repLiveCoords.latitude, repLiveCoords.longitude, effLat, effLng);
      if (dist > geofenceRadiusMeters) return false;
    }

    const delName = r.delegateName || currentUser?.name || currentUser?.delegateName || '';
    const normDel = normalizeArabic(delName);
    const customTimerInfo = delegateCustomTimes[delName] || delegateCustomTimes[normDel];

    let isSalesClosedByTime = Boolean(baghdadStatus?.isPastClosing);
    let isSalesCompleted = Boolean(
      completedDelegates[delName] ||
      completedDelegates[normDel] ||
      isDelegateCompletedToday(r.delegateName, r.delegateCode)
    );

    if (customTimerInfo && customTimerInfo.active) {
      if (customTimerInfo.expireAtTimestamp) {
        if (Date.now() < customTimerInfo.expireAtTimestamp) {
          isSalesClosedByTime = false;
          isSalesCompleted = false;
        } else {
          isSalesClosedByTime = true;
        }
      } else if (customTimerInfo.customTime) {
        const now = new Date();
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Baghdad',
          hour12: false,
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        });
        const parts = timeFormatter.formatToParts(now);
        const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
        const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);
        const currentSeconds = hour * 3600 + minute * 60 + second;

        const [hStr, mStr] = customTimerInfo.customTime.split(':');
        const targetHours = parseInt(hStr || '21', 10);
        const targetMinutes = parseInt(mStr || '00', 10);
        const targetSeconds = targetHours * 3600 + targetMinutes * 60;

        if (currentSeconds < targetSeconds) {
          isSalesClosedByTime = false;
          isSalesCompleted = false;
        } else {
          isSalesClosedByTime = true;
        }
      }
    }

    return !isSalesClosedByTime && !isSalesCompleted;
  };

  const handleDirectCreateInvoiceFromMap = (r: RouteItem) => {
    const isPrivilegedUser = Boolean(currentUser?.isAdmin || isDataEntry);
    if (isPrivilegedUser) {
      handleProceedToNewOrder(r);
      return;
    }

    const cCode = String(r.customerCode ?? '').trim();
    const delName = r.delegateName || currentUser?.name || currentUser?.delegateName || '';
    const normDel = normalizeArabic(delName);
    const customTimerInfo = delegateCustomTimes[delName] || delegateCustomTimes[normDel];

    const hasDebt = customerDebtsSet.has(cCode);
    const isUnlockedForOrder = Boolean(
      unlockedCustomerCodes[cCode] ||
      unlockedCustomerCodes[normalizeArabic(r.customerName)] ||
      unlockedCustomerCodes[r.customerName]
    );

    let isSalesClosedByTime = Boolean(baghdadStatus?.isPastClosing);
    let isSalesCompleted = Boolean(
      completedDelegates[delName] ||
      completedDelegates[normDel] ||
      isDelegateCompletedToday(r.delegateName, r.delegateCode)
    );

    if (customTimerInfo && customTimerInfo.active) {
      if (customTimerInfo.expireAtTimestamp) {
        if (Date.now() < customTimerInfo.expireAtTimestamp) {
          isSalesClosedByTime = false;
          isSalesCompleted = false;
        } else {
          isSalesClosedByTime = true;
        }
      } else if (customTimerInfo.customTime) {
        const now = new Date();
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Baghdad',
          hour12: false,
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        });
        const parts = timeFormatter.formatToParts(now);
        const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
        const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);
        const currentSeconds = hour * 3600 + minute * 60 + second;

        const [hStr, mStr] = customTimerInfo.customTime.split(':');
        const targetHours = parseInt(hStr || '21', 10);
        const targetMinutes = parseInt(mStr || '00', 10);
        const targetSeconds = targetHours * 3600 + targetMinutes * 60;

        if (currentSeconds < targetSeconds) {
          isSalesClosedByTime = false;
          isSalesCompleted = false;
        } else {
          isSalesClosedByTime = true;
        }
      }
    }

    if (hasDebt && !isUnlockedForOrder) {
      addToast?.({
        title: 'مغلق لوجود دين مستحق',
        message: `لا يمكن إنشاء فاتورة لمحل (${r.customerName}) لوجود دين مستحق عليه.`,
        type: 'reminder',
      });
      return;
    }

    if (isSalesCompleted) {
      addToast?.({
        title: 'تم إكمال المبيعات',
        message: 'تم إكمال مبيعات اليوم لهذا المندوب.',
        type: 'reminder',
      });
      return;
    }

    if (isSalesClosedByTime) {
      addToast?.({
        title: 'انتهى وقت المبيعات',
        message: 'انتهى وقت المبيعات المتاحة لهذا اليوم.',
        type: 'reminder',
      });
      return;
    }

    if (isFieldRep && !isCompleted && (repGpsStatus !== 'active' || !repLiveCoords)) {
      addToast?.({
        title: 'مطلوب تفعيل الموقع (GPS)',
        message: 'يجب تفعيل صلاحية الموقع (GPS) أولاً عند طلب فاتورة للزبون.',
        type: 'reminder',
      });
      requestGeolocationFromUserGesture({ openHelpOnError: true });
      return;
    }

    const { latitude: shopLat, longitude: shopLng } = resolveRouteCoordinatesWithCache(
      r,
      cachedShopCoordsMap
    );
    const savedLoc = getSavedLocationForRoute(r);
    const effectiveLat = shopLat ?? (savedLoc ? savedLoc.latitude : null);
    const effectiveLng = shopLng ?? (savedLoc ? savedLoc.longitude : null);

    if (effectiveLat !== null && effectiveLng !== null) {
      if (!repLiveCoords) {
        if (repGpsStatus !== 'denied' && repGpsStatus !== 'gps_off' && repGpsStatus !== 'insecure') {
          addToast?.({
            title: 'تحديد الموقع (GPS)',
            message: 'جاري تحديد موقعك الحالي (GPS) للتحقق من القرب من المحل...',
            type: 'reminder',
          });
        }
        requestGeolocationFromUserGesture({ openHelpOnError: true });
        return;
      }

      const distanceMeters = Math.round(
        calculateHaversineDistanceMeters(
          repLiveCoords.latitude,
          repLiveCoords.longitude,
          effectiveLat,
          effectiveLng
        )
      );
      if (distanceMeters > geofenceRadiusMeters) {
        addToast?.({
          title: 'تأكيد موقع الزيارة',
          message: `يرجى التواجد عند موقع المحل (${r.customerName}) لتسجيل الفاتورة.`,
          type: 'reminder',
        });
        return;
      }
    }

    handleProceedToNewOrder(r);
  };

  const handleOpenVisitModalFromMap = (r: RouteItem) => {
    const isPrivilegedUser = Boolean(currentUser?.isAdmin || isDataEntry);
    if (!isPrivilegedUser) {
      const { latitude: shopLat, longitude: shopLng } = resolveRouteCoordinatesWithCache(
        r,
        cachedShopCoordsMap
      );
      const savedLoc = getSavedLocationForRoute(r);
      const effectiveLat = shopLat ?? (savedLoc ? savedLoc.latitude : null);
      const effectiveLng = shopLng ?? (savedLoc ? savedLoc.longitude : null);

      if (effectiveLat !== null && effectiveLng !== null) {
        if (!repLiveCoords) {
          addToast?.({
            title: 'تأكيد موقع الزيارة',
            message: `يرجى تفعيل الموقع (GPS) والتواجد عند المحل (${r.customerName}) لتسجيل الزيارة.`,
            type: 'reminder',
          });
          requestGeolocationFromUserGesture({ openHelpOnError: true });
          return;
        }
        const distanceMeters = calculateHaversineDistanceMeters(
          repLiveCoords.latitude,
          repLiveCoords.longitude,
          effectiveLat,
          effectiveLng
        );
        if (distanceMeters > geofenceRadiusMeters) {
          addToast?.({
            title: 'تأكيد موقع الزيارة',
            message: `يرجى التواجد عند موقع المحل (${r.customerName}) لتسجيل الزيارة.`,
            type: 'reminder',
          });
          return;
        }
      }
    }

    setCustomerVisitModalRoute(r);
  };

  const handleProceedToOtherInfo = () => {
    setActionModalStep('other_info');
  };

  const captureShopLocationGps = () => {
    setGpsCaptureError(null);
    if (repLiveCoords && Date.now() - repLiveCoords.updatedAt < 20000) {
      setCapturedLatLng({
        lat: Number(repLiveCoords.latitude.toFixed(6)),
        lng: Number(repLiveCoords.longitude.toFixed(6)),
      });
    }

    if (!isGeolocationSecureContext()) {
      setGpsCaptureError('يتطلب التقاط الموقع (GPS) فتح التطبيق عبر اتصال آمن (HTTPS). يمكنك لصق الإحداثيات أو رابط خرائط كوكل.');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (!repLiveCoords) {
        setGpsCaptureError('المتصفح لا يدعم تحديد الموقع التلقائي (GPS). يرجى التأكد من تفعيل خدمة الموقع.');
      }
      return;
    }

    setIsCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const acc = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : undefined;
        setCapturedLatLng({ lat, lng, accuracy: acc });
        setManualCoordInput(`${lat}, ${lng}`);
        setIsCapturingGps(false);
        setGpsCaptureError(null);
        dispatchRepLiveCoords({ latitude: lat, longitude: lng });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(GPS_POSITION_GRANTED_EVENT, { detail: { position: pos } }));
        }
      },
      (err) => {
        setIsCapturingGps(false);
        const mapped = mapGeolocationErrorToStatus(err);
        let msg = 'تعذر تحديد الموقع تلقائياً (GPS). تأكد من تفعيل خدمة الموقع وإعطاء الصلاحية للمتصفح.';
        if (mapped === 'denied') {
          msg = 'تم رفض صلاحية الموقع (GPS). يرجى السماح للمتصفح وتفعيل «الموقع الدقيق» من إعدادات Safari أو Chrome ثم الضغط على «تحديث GPS».';
        } else if (mapped === 'gps_off') {
          msg = 'خدمة الموقع (GPS) متوقفة في الهاتف أو الإشارة غير متوفرة. شغّل GPS في الهاتف ثم اضغط «تحديث GPS».';
        } else if (mapped === 'timeout') {
          msg = 'انتهت مهلة التقاط إشارة GPS. حاول مجدداً في مكان مكشوف عبر «تحديث GPS».';
        }
        setGpsCaptureError(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleProceedToShopLocation = (routeOverride?: RouteItem, savedRecordOverride?: ShopLocationRecord) => {
    const targetRoute = routeOverride || actionModalRoute;
    if (routeOverride) {
      setActionModalRoute(routeOverride);
    }
    const existingRecord = savedRecordOverride || (targetRoute ? getSavedLocationForRoute(targetRoute) : undefined);
    setEditingSavedLocationRecord(savedRecordOverride || existingRecord || null);
    setActionModalStep('shop_location');
    setGpsCaptureError(null);

    const resolvedCoords = targetRoute
      ? resolveRouteCoordinatesWithCache(targetRoute, cachedShopCoordsMap)
      : { latitude: null, longitude: null };
    const prefillLat = existingRecord?.latitude ?? resolvedCoords.latitude;
    const prefillLng = existingRecord?.longitude ?? resolvedCoords.longitude;

    if (
      isAdminUser &&
      prefillLat !== null &&
      prefillLng !== null &&
      Number.isFinite(Number(prefillLat)) &&
      Number.isFinite(Number(prefillLng))
    ) {
      const latNum = Number(Number(prefillLat).toFixed(6));
      const lngNum = Number(Number(prefillLng).toFixed(6));
      setCapturedLatLng({ lat: latNum, lng: lngNum, accuracy: existingRecord?.accuracyMeters });
      setManualCoordInput(formatShopLocationString(latNum, lngNum));
      setIsCapturingGps(false);
    } else {
      setCapturedLatLng(null);
      setManualCoordInput('');
      captureShopLocationGps();
    }
  };

  // Auto-resolve short Google Maps URLs (e.g. https://maps.app.goo.gl/...) when entered in shop_location modal
  useEffect(() => {
    if (actionModalStep !== 'shop_location') {
      setIsResolvingMapsUrl(false);
      return;
    }
    const raw = manualCoordInput.trim();
    if (!raw) {
      setIsResolvingMapsUrl(false);
      return;
    }
    const syncParsed = parseShopLocationString(raw);
    if (syncParsed.latitude !== null && syncParsed.longitude !== null) {
      setCapturedLatLng({ lat: syncParsed.latitude, lng: syncParsed.longitude });
      setGpsCaptureError(null);
      setIsResolvingMapsUrl(false);
      return;
    }
    if (!isShortOrExternalMapsUrl(raw)) {
      setIsResolvingMapsUrl(false);
      return;
    }

    let cancelled = false;
    setIsResolvingMapsUrl(true);
    setGpsCaptureError(null);
    const timer = window.setTimeout(async () => {
      const resolved = await resolveShopLocationInput(raw);
      if (cancelled) return;
      setIsResolvingMapsUrl(false);
      if (resolved.latitude !== null && resolved.longitude !== null) {
        setCapturedLatLng({ lat: resolved.latitude, lng: resolved.longitude });
        setGpsCaptureError(null);
      } else {
        setGpsCaptureError('تعذر استخراج الإحداثيات من رابط الخرائط. تأكد من صحة الرابط أو التقط الموقع عبر GPS.');
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [manualCoordInput, actionModalStep]);

  const handleSaveShopLocationOnce = async () => {
    if (!actionModalRoute) return;

    const existingLocal = editingSavedLocationRecord || getSavedLocationForRoute(actionModalRoute);
    const hasPinnedRoute = Boolean(
      existingLocal ||
      actionModalRoute.repLocationSaved ||
      (parseCoordinate(actionModalRoute.latitude) !== null && parseCoordinate(actionModalRoute.longitude) !== null)
    );
    if (!isStrictAdmin && hasPinnedRoute) {
      addToast?.({
        title: 'تم تثبيت الموقع مسبقاً',
        message: `موقع المحل (${actionModalRoute.customerName}) مثبت ومحفوظ مسبقاً على الخريطة.`,
        type: 'info',
      });
      setActionModalRoute(null);
      setActionModalStep(null);
      setEditingSavedLocationRecord(null);
      return;
    }

    setIsSavingShopLocationOnce(true);
    try {
      let parsedManual = manualCoordInput.trim()
        ? parseShopLocationString(manualCoordInput)
        : { latitude: null, longitude: null };

      if (
        (parsedManual.latitude === null || parsedManual.longitude === null) &&
        manualCoordInput.trim() &&
        isShortOrExternalMapsUrl(manualCoordInput)
      ) {
        const resolvedFromLink = await resolveShopLocationInput(manualCoordInput);
        parsedManual = {
          latitude: resolvedFromLink.latitude,
          longitude: resolvedFromLink.longitude,
        };
      }

      const finalLat = parsedManual.latitude ?? capturedLatLng?.lat ?? null;
      const finalLng = parsedManual.longitude ?? capturedLatLng?.lng ?? null;

      if (finalLat === null || finalLng === null) {
        setGpsCaptureError('يرجى التقاط الموقع عبر زر «تحديث GPS» أولاً.');
        setIsSavingShopLocationOnce(false);
        return;
      }

      const docId = existingLocal?.id || getShopLocationDocId(actionModalRoute);
      const locDocRef = doc(db, 'rep_shop_locations', docId);

      // Strict once-only server check for non-admin users (reps/data entry); strict Admin can edit any saved location
      if (!isStrictAdmin) {
        try {
          const existingSnap = await getDoc(locDocRef);
          if (existingSnap.exists()) {
            addToast?.({
              title: 'تم الحفظ مسبقاً',
              message: `تم تسجيل موقع هذا المحل مسبقاً في النظام.`,
              type: 'info',
            });
            setActionModalRoute(null);
            setActionModalStep(null);
            setEditingSavedLocationRecord(null);
            return;
          }
        } catch {
          // Proceed with write if offline check cannot complete
        }
      }

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const actorName = currentUser?.name || currentUser?.delegateName || actionModalRoute.delegateName || 'الأدمن';
      const actorCode = currentUser?.delegateCode || effectiveDelegateCode || actionModalRoute.delegateCode || '';

      const record: ShopLocationRecord = {
        id: docId,
        routeId: existingLocal?.routeId || actionModalRoute.id || docId,
        customerCode: existingLocal?.customerCode || actionModalRoute.customerCode || '',
        customerName: existingLocal?.customerName || actionModalRoute.customerName,
        customerAddress: existingLocal?.customerAddress || actionModalRoute.customerAddress || '',
        customerType: existingLocal?.customerType || actionModalRoute.customerType || 'مفرد',
        path: existingLocal?.path || getEffectiveRouteDay(actionModalRoute) || actionModalRoute.path || '',
        delegateName: existingLocal?.delegateName || actionModalRoute.delegateName || actorName,
        delegateCode: existingLocal?.delegateCode || actionModalRoute.delegateCode || actorCode,
        latitude: Number(finalLat.toFixed(6)),
        longitude: Number(finalLng.toFixed(6)),
        shopLocation: formatShopLocationString(finalLat, finalLng),
        accuracyMeters: capturedLatLng?.accuracy ?? existingLocal?.accuracyMeters,
        savedBy: existingLocal?.savedBy || actorName,
        savedByCode: existingLocal?.savedByCode || actorCode,
        savedAt: existingLocal?.savedAt || now.toISOString(),
        timestamp: existingLocal?.timestamp || now.getTime(),
        dateString: existingLocal?.dateString || todayStr,
        ...(existingLocal ? { updatedAt: now.toISOString(), updatedBy: actorName } : {}),
      };

      await setDoc(locDocRef, cleanFirestoreData(record), { merge: true });

      // Sync coordinates into `routes` & Supabase `customers` & any duplicate `rep_shop_locations` and mark `repLocationSaved: true`
      await saveCustomerCoordinates(
        actionModalRoute,
        record.latitude,
        record.longitude,
        actorName,
        { repLocationSaved: true }
      );
      if (!isStrictAdmin && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(REP_GPS_FORCE_SYNC_EVENT));
      }

      // Optimistically update savedShopLocations & routes & cache immediately so map pins and button hides instantaneously
      setSavedShopLocations((prev) => [record, ...prev.filter((item) => item.id !== record.id)]);
      const targetCode = String(actionModalRoute.customerCode || '').trim();
      setRoutes((prev) =>
        prev.map((item) => {
          const matchesId = item.id && actionModalRoute.id && item.id === actionModalRoute.id;
          const matchesCode = targetCode !== '' && String(item.customerCode || '').trim() === targetCode;
          if (!matchesId && !matchesCode) return item;
          return {
            ...item,
            latitude: record.latitude,
            longitude: record.longitude,
            shopLocation: record.shopLocation,
            repLocationSaved: true,
            locationClearedAt: 0,
          };
        })
      );
      cacheShopCoordinatesLocally([
        {
          ...actionModalRoute,
          latitude: record.latitude,
          longitude: record.longitude,
          shopLocation: record.shopLocation,
          repLocationSaved: true,
          locationClearedAt: 0,
        },
      ]);

      addToast?.({
        title: existingLocal ? 'تم تعديل موقع المحل بنجاح 📍✅' : 'تم تثبيت وحفظ موقع المحل بنجاح 📍✅',
        message: existingLocal
          ? `تم تحديث موقع (${actionModalRoute.customerName}) في الخريطة وسجل المواقع.`
          : `تم تثبيت موقع (${actionModalRoute.customerName}) على الخريطة والاعتماد عليه بشكل دائم.`,
        type: 'success',
        delegateName: actorName,
      });

      setActionModalRoute(null);
      setActionModalStep(null);
      setEditingSavedLocationRecord(null);
      setCapturedLatLng(null);
      setManualCoordInput('');
    } catch (err) {
      console.error('Error saving shop location:', err);
      setGpsCaptureError('حدث خطأ أثناء حفظ موقع المحل. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSavingShopLocationOnce(false);
    }
  };

  const handleDeleteSavedShopLocation = async (rec: ShopLocationRecord) => {
    if (!isAdminUser || !rec.id) return;
    try {
      await deleteDoc(doc(db, 'rep_shop_locations', rec.id));
      const matchedRoute = routes.find(
        (r) =>
          r.id === rec.routeId ||
          (rec.customerCode && String(r.customerCode || '').trim() === String(rec.customerCode).trim())
      );
      const fallbackRoute: RouteItem = matchedRoute || {
        id: rec.routeId || rec.id,
        customerCode: rec.customerCode || '',
        customerName: rec.customerName || '',
        customerAddress: rec.customerAddress || '',
        customerType: rec.customerType || 'مفرد',
        delegateName: rec.delegateName || '',
        path: rec.path || '',
      };
      const res = await deleteCustomerCoordinates(fallbackRoute, currentUser?.name || 'الأدمن');
      const clearedAt = res.clearedAt || Date.now();
      const targetCode = String(rec.customerCode || '').trim();
      setSavedShopLocations((prev) =>
        prev.filter((item) => {
          if (item.id === rec.id) return false;
          if (rec.routeId && item.routeId === rec.routeId) return false;
          if (targetCode && String(item.customerCode || '').trim() === targetCode) return false;
          return true;
        })
      );
      setRoutes((prev) =>
        prev.map((r) => {
          const matchesId = (rec.routeId && r.id === rec.routeId) || (matchedRoute && r.id === matchedRoute.id);
          const matchesCode = targetCode !== '' && String(r.customerCode || '').trim() === targetCode;
          if (!matchesId && !matchesCode) return r;
          return {
            ...r,
            latitude: null,
            longitude: null,
            shopLocation: '',
            repLocationSaved: false,
            locationClearedAt: clearedAt,
          };
        })
      );
      setConfirmDeleteShopLocId(null);
      addToast?.({
        title: 'تم حذف الموقع',
        message: `تم حذف الموقع المسجل للمحل (${rec.customerName}) ويمكن للمندوب إضافته من جديد.`,
        type: 'info',
      });
    } catch (err) {
      console.error('Error deleting saved shop location:', err);
      addToast?.({ title: 'خطأ', message: 'تعذر حذف سجل موقع المحل.', type: 'info' });
    }
  };

  const handleExportShopLocationsExcel = async () => {
    if (visibleShopLocations.length === 0) return;
    try {
      const XLSX = await import('xlsx');
      const rows = visibleShopLocations.map((rec, idx) => ({
        'ت': idx + 1,
        'كود الزبون': rec.customerCode || '',
        'اسم المحل / الزبون': rec.customerName || '',
        'النوع': rec.customerType || '',
        'المسار': rec.path || '',
        'العنوان': rec.customerAddress || '',
        'المندوب': rec.delegateName || rec.savedBy || '',
        'موقع المحل': rec.shopLocation || formatShopLocationString(rec.latitude, rec.longitude),
        'خط العرض': rec.latitude,
        'خط الطول': rec.longitude,
        'دقة GPS (متر)': rec.accuracyMeters ?? '',
        'تاريخ الحفظ': formatEnglishDateTime(rec.savedAt, rec.dateString),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!views'] = [{ rightToLeft: true }];
      ws['!cols'] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 26 },
        { wch: 10 },
        { wch: 14 },
        { wch: 26 },
        { wch: 18 },
        { wch: 24 },
        { wch: 13 },
        { wch: 13 },
        { wch: 14 },
        { wch: 22 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'مواقع_المحلات');
      XLSX.writeFile(wb, `مواقع_المحلات_المسجلة_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error('Error exporting shop locations:', err);
    }
  };

  const handleSubmitOtherInfo = async () => {
    if (!actionModalRoute) return;
    if (!selectedOption) {
      alert('يرجى اختيار أحد الخيارات من القائمة');
      return;
    }

    setIsSubmittingNote(true);
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const delName = currentUser?.name || currentUser?.delegateName || actionModalRoute.delegateName || '';
      const delCode = currentUser?.delegateCode || effectiveDelegateCode || actionModalRoute.delegateCode || '';

      const newNote: Omit<CustomerInfoNote, 'id'> = {
        customerCode: actionModalRoute.customerCode,
        customerName: actionModalRoute.customerName,
        customerAddress: actionModalRoute.customerAddress || '',
        delegateName: delName,
        delegateCode: delCode,
        selectedOption: selectedOption,
        notes: otherInfoNotesInput.trim(),
        timestamp: Date.now(),
        dateString: todayStr,
        createdAt: new Date().toISOString(),
        adminActionTaken: false,
        adminActionDetails: '',
        adminActionBy: '',
        adminActionAt: '',
        status: 'pending'
      };

      const docRef = doc(collection(db, 'customer_info_notes'));
      await setDoc(docRef, newNote);

      if (addToast) {
        addToast({
          title: 'تم تسجيل المعلومات بنجاح',
          message: `تمت إضافة ملاحظة للزبون (${actionModalRoute.customerName})`,
          type: 'success',
          delegateName: delName
        });
      }

      setActionModalRoute(null);
      setActionModalStep(null);
      setOtherInfoNotesInput('');
    } catch (err) {
      console.error('Error adding customer note:', err);
      alert('حدث خطأ أثناء إرسال المعلومات. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const handleDeleteCustomerNote = async (noteId: string, custName: string) => {
    if (isDataEntry) return;
    if (!noteId) {
      addToast({ title: 'خطأ', message: 'لم يتم العثور على معرف الملاحظة', type: 'info' });
      return;
    }

    if (!confirm(`هل أنت تأكد من حذف الملاحظة المسجلة للزبون (${custName})؟`)) return;

    try {
      const noteRef = doc(db, 'customer_info_notes', noteId);
      await deleteDoc(noteRef);
      
      addToast({
        title: 'تم الحذف',
        message: `تم حذف الملاحظة بنجاح`,
        type: 'success'
      });
    } catch (err) {
      console.error('Error deleting note:', err);
      addToast({
        title: 'فشل الحذف',
        message: 'حدث خطأ أثناء محاولة حذف الملاحظة',
        type: 'info'
      });
    }
  };

  const handleUploadRoutes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (salesContext.importRoutesFromExcel) {
        await salesContext.importRoutesFromExcel(file);
      }
      addToast({ message: 'تم استيراد ومعالجة المسارات بنجاح ✅', type: 'success', delegateName: currentUser?.name || '', title: 'استيراد', percentage: 0 });
    } catch (e) {
      console.error('Error importing routes:', e);
      addToast({ message: 'فشل استيراد المسارات. تأكد من صحة الملف.', type: 'info', delegateName: currentUser?.name || '', title: 'خطأ', percentage: 0 });
    } finally {
      e.target.value = '';
    }
  };

  const handleUploadShopLocationsExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isUploadingLocationsExcel) return;

    setIsUploadingLocationsExcel(true);
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      if (!jsonData || jsonData.length === 0) {
        addToast({ title: 'تنبيه', message: 'ملف الإكسل فارغ أو لا يحتوي على بيانات.', type: 'info' });
        return;
      }

      const routeByCode = new Map<string, RouteItem>();
      routes.forEach((r) => {
        const code = normalizeLocationCode(r.customerCode);
        if (code && !routeByCode.has(code)) routeByCode.set(code, r);
      });

      const updates: Array<{ route: RouteItem; latitude: number; longitude: number }> = [];

      const locationMatchers = [
        'موقع المحل',
        'الموقع الجغرافي',
        'احداثيات المحل',
        'إحداثيات المحل',
        'الاحداثيات',
        'الإحداثيات',
        'رابط الموقع',
        'موقع gps',
        'gps',
        'coordinates',
        'location',
        'google maps',
      ];

      const getLocCell = (row: Record<string, unknown>): string => {
        const keys = Object.keys(row);
        for (const m of locationMatchers) {
          if (row[m] !== undefined && row[m] !== null && String(row[m]).trim() !== '') {
            return String(row[m]).trim();
          }
        }
        for (const k of keys) {
          const cleanK = k.trim().toLowerCase();
          for (const m of locationMatchers) {
            if (
              (cleanK === m.toLowerCase() || cleanK.includes(m.toLowerCase())) &&
              row[k] !== undefined &&
              row[k] !== null &&
              String(row[k]).trim() !== ''
            ) {
              return String(row[k]).trim();
            }
          }
        }
        return '';
      };

      const rawLocCells = jsonData.map((row) => getLocCell(row)).filter(Boolean);
      const resolvedBatchMap = await resolveShopLocationInputsBatch(rawLocCells);

      jsonData.forEach((row) => {
        const keys = Object.keys(row);
        const findColVal = (matchers: string[]): string => {
          for (const m of matchers) {
            if (row[m] !== undefined && row[m] !== null && String(row[m]).trim() !== '') {
              return String(row[m]).trim();
            }
          }
          for (const k of keys) {
            const cleanK = k.trim().toLowerCase();
            for (const m of matchers) {
              if (cleanK === m.toLowerCase() || cleanK.includes(m.toLowerCase())) {
                if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
                  return String(row[k]).trim();
                }
              }
            }
          }
          return '';
        };

        const rawCode = findColVal(['كود الزبون', 'رمز الزبون', 'كود العميل', 'الكود', 'Customer Code', 'Code']);
        const code = normalizeLocationCode(rawCode);
        const locCell = getLocCell(row);
        const parsed = (locCell && resolvedBatchMap[locCell]) || parseShopLocationString(locCell);
        const lat = parsed.latitude ?? parseCoordinate(findColVal(['خط العرض', 'latitude', 'lat']));
        const lng = parsed.longitude ?? parseCoordinate(findColVal(['خط الطول', 'longitude', 'lng', 'lon']));

        if (lat === null || lng === null || !code) return;

        // Match strictly by shop customerCode (never by customerName)
        const matchedRoute = routeByCode.get(code);

        if (matchedRoute) {
          updates.push({ route: matchedRoute, latitude: lat, longitude: lng });
        }
      });

      if (updates.length === 0) {
        addToast({
          title: 'لم يتم العثور على مواقع مطابقة',
          message: 'تأكد من وجود عمود "كود الزبون" مطابق وعمود "موقع المحل" بإحداثيات (34.615800, 43.678600) أو رابط خرائط كوكل.',
          type: 'info',
        });
        return;
      }

      const updatedCount = await bulkUpdateRouteLocations(updates, currentUser?.name || 'الأدمن');
      addToast({
        title: 'تم تحديث مواقع المحلات 📍✅',
        message: `تم تحديث موقع (${updatedCount}) محل بنجاح من ملف الإكسل دون حذف المسارات.`,
        type: 'success',
        delegateName: currentUser?.name || '',
      });
    } catch (err) {
      console.error('Error uploading shop locations Excel:', err);
      addToast({ title: 'خطأ', message: 'حدث خطأ أثناء قراءة ملف مواقع المحلات.', type: 'info' });
    } finally {
      setIsUploadingLocationsExcel(false);
      e.target.value = '';
    }
  };

  const handleSaveInlineLocation = async (route: RouteItem) => {
    setIsSavingInlineLocation(true);
    const parsed = await resolveShopLocationInput(editingLocationInput);
    if (parsed.latitude === null || parsed.longitude === null) {
      setIsSavingInlineLocation(false);
      addToast({
        title: 'تنبيه',
        message: 'يرجى إدخال الإحداثيات بصيغة صحيحة (مثال: 34.6158, 43.6786) أو رابط خرائط كوكل (مثل maps.app.goo.gl).',
        type: 'info',
      });
      return;
    }
    const res = await saveCustomerCoordinates(route, parsed.latitude, parsed.longitude, currentUser?.name || 'الأدمن');
    setIsSavingInlineLocation(false);
    addToast({
      title: res.success ? 'تم حفظ الموقع 📍' : 'خطأ',
      message: res.message,
      type: res.success ? 'success' : 'info',
    });
    if (res.success && parsed.latitude !== null && parsed.longitude !== null) {
      const targetCode = String(route.customerCode || '').trim();
      const locText = formatShopLocationString(parsed.latitude, parsed.longitude);
      setRoutes((prev) =>
        prev.map((item) => {
          const matchesId = item.id && route.id && item.id === route.id;
          const matchesCode = targetCode !== '' && String(item.customerCode || '').trim() === targetCode;
          if (!matchesId && !matchesCode) return item;
          return {
            ...item,
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            shopLocation: locText,
            locationClearedAt: 0,
          };
        })
      );
      setEditingLocationRouteId(null);
      setEditingLocationInput('');
    }
  };

  const handleDeleteInlineLocation = async (route: RouteItem) => {
    if (!isStrictAdmin) return;
    setDeletingLocationRouteId(route.id);
    const res = await deleteCustomerCoordinates(route, currentUser?.name || 'الأدمن');
    setDeletingLocationRouteId(null);
    setConfirmDeleteLocationRouteId(null);

    if (res.success) {
      const targetCode = String(route.customerCode || '').trim();
      setSavedShopLocations((prev) =>
        prev.filter((rec) => {
          if (route.id && rec.routeId === route.id) return false;
          if (targetCode !== '' && String(rec.customerCode || '').trim() === targetCode) return false;
          return true;
        })
      );
      setRoutes((prev) =>
        prev.map((item) => {
          const matchesId = item.id && route.id && item.id === route.id;
          const matchesCode = targetCode !== '' && String(item.customerCode || '').trim() === targetCode;
          if (!matchesId && !matchesCode) return item;
          return {
            ...item,
            latitude: null,
            longitude: null,
            shopLocation: '',
            repLocationSaved: false,
            locationClearedAt: res.clearedAt,
          };
        })
      );
      removeCachedShopCoordinates(route);
      if (editingLocationRouteId === route.id) {
        setEditingLocationRouteId(null);
        setEditingLocationInput('');
      }
    }

    addToast({
      title: res.success ? 'تم حذف موقع المحل 🗑️' : 'خطأ',
      message: res.message,
      type: res.success ? 'success' : 'info',
    });
  };

  const handleDownloadFilteredRoutes = async () => {
    try {
      const XLSX = await import('xlsx');
      
      const exportList = filteredRoutes;
      if (exportList.length === 0) {
        addToast({
          message: 'لا توجد مسارات مطابقة للتنزيل بناءً على التصفية الحالية.',
          type: 'info',
          title: 'تنبيه',
          delegateName: currentUser?.name || '',
          percentage: 0
        });
        return;
      }

      const rows = exportList.map((r, idx) => {
        const phone = getCustomerPhone(r);
        return {
          'ت': idx + 1,
          'كود الزبون': r.customerCode || '',
          'اسم الزبون': r.customerName || '',
          'رقم الزبون': phone || '',
          'العنوان': r.customerAddress || '',
          'موقع المحل': r.shopLocation || formatShopLocationString(r.latitude, r.longitude),
          'المسار': r.path || '',
          'نوع الزبون': r.customerType || 'مفرد',
          'اسم المندوب': r.delegateName || '',
          'كود المندوب': r.delegateCode || '',
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 6 },  // ت
        { wch: 14 }, // كود الزبون
        { wch: 28 }, // اسم الزبون
        { wch: 18 }, // رقم الزبون
        { wch: 28 }, // العنوان
        { wch: 26 }, // موقع المحل
        { wch: 16 }, // المسار
        { wch: 12 }, // نوع الزبون
        { wch: 20 }, // اسم المندوب
        { wch: 14 }, // كود المندوب
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "مسارات");

      const delegatePart = routeFilterDelegate ? routeFilterDelegate.replace(/\s+/g, '_') : 'كل_المندوبين';
      const dayPart = routeFilterDay ? routeFilterDay.replace(/\s+/g, '_') : 'كل_الايام';
      const todayStr = new Date().toISOString().split('T')[0];
      const filename = `مسارات_${delegatePart}_${dayPart}_${todayStr}.xlsx`;

      XLSX.writeFile(workbook, filename);

      addToast({
        message: `تم تحميل ملف المسارات (${exportList.length} زبون) مع عمود موقع المحل بنجاح 📥✅`,
        type: 'success',
        title: 'تحميل المسارات',
        delegateName: currentUser?.name || '',
        percentage: 0
      });
    } catch (err) {
      console.error('Error downloading routes excel:', err);
      addToast({
        message: 'حدث خطأ أثناء تحميل ملف المسارات.',
        type: 'info',
        title: 'خطأ',
        delegateName: currentUser?.name || '',
        percentage: 0
      });
    }
  };

  const handleDownloadRoutesTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const sampleRows = [
        {
          'كود الزبون': '30071831',
          'اسم الزبون': 'اسواق ابو بلال',
          'رقم الزبون': '07719836783',
          'العنوان': 'العلم مدخل الخزامية',
          'موقع المحل': '34.615800, 43.678600',
          'المسار': 'السبت',
          'نوع الزبون': 'مفرد',
          'اسم المندوب': 'محمد جاسم',
          'كود المندوب': '60037329',
        },
        {
          'كود الزبون': '30071832',
          'اسم الزبون': 'اسواق السلام',
          'رقم الزبون': '07701234567',
          'العنوان': 'تكريت حي الزهور',
          'موقع المحل': '34.608500, 43.675200',
          'المسار': 'الاحد',
          'نوع الزبون': 'جملة',
          'اسم المندوب': 'فيصل فؤاد',
          'كود المندوب': '60042245',
        }
      ];

      const worksheet = XLSX.utils.json_to_sheet(sampleRows);
      worksheet['!cols'] = [
        { wch: 14 },
        { wch: 28 },
        { wch: 18 },
        { wch: 28 },
        { wch: 26 }, // موقع المحل
        { wch: 16 },
        { wch: 12 },
        { wch: 20 },
        { wch: 14 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "نموذج_مسارات");
      XLSX.writeFile(workbook, "نموذج_مسارات_ومواقع_المحلات.xlsx");

      addToast({
        message: 'تم تحميل نموذج المسارات (شامل عمود موقع المحل) بنجاح 📋✅',
        type: 'success',
        title: 'نموذج المسارات',
        delegateName: currentUser?.name || '',
        percentage: 0
      });
    } catch (err) {
      console.error('Error downloading template:', err);
    }
  };



  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h2 className="text-emerald-800 dark:text-emerald-200 font-black text-xl">المسارات</h2>
        
        <div className="flex items-center gap-2 flex-wrap">
          {(currentUser?.isAdmin || isDataEntry || isFieldRep) && (
            <button
              type="button"
              onClick={() => setShowFleetMap((v) => !v)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all cursor-pointer ${
                showFleetMap
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700'
              }`}
              title={currentUser?.isAdmin ? "خريطة مسارات المندوبين لمحافظة صلاح الدين" : "خريطة مسار ومحلات محافظة صلاح الدين"}
            >
              <Navigation className="w-4 h-4" />
              <span>{showFleetMap ? 'إخفاء خريطة صلاح الدين' : (currentUser?.isAdmin ? 'خريطة المندوبين' : 'خريطة مسار اليوم')}</span>
            </button>
          )}

          {/* Damaged Products (منتجات تالفة) Button - navigates to QC tab */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('qc');
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs sm:text-sm shadow-md shadow-rose-600/20 active:scale-95 transition-all cursor-pointer"
            title="الانتقال إلى صفحة منتجات تالفة (QC)"
          >
            <AlertTriangle className="w-4 h-4" />
            <span>منتجات تالفة (QC)</span>
          </button>

          {/* New Customer Definition (تعريف جديد) Button */}
          <button
            type="button"
            onClick={() => setShowNewCustomerDefModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs sm:text-sm shadow-md shadow-indigo-600/20 active:scale-95 transition-all cursor-pointer"
            title="إرسال طلب تعريف محل جديد إلى الأدمن"
          >
            <Store className="w-4 h-4" />
            <span>تعريف جديد</span>
          </button>
        </div>
      </div>

      {/* Live Tracking Status Badge (Completion is controlled from Reports page) */}
      {isFieldRep && (
        <div
          className={`p-3 rounded-2xl border shadow-sm flex flex-wrap items-center justify-between gap-3 ${
            isCompleted
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-200'
              : repGpsStatus === 'denied' || repGpsStatus === 'gps_off' || repGpsStatus === 'timeout' || repGpsStatus === 'insecure' || repGpsStatus === 'unavailable'
              ? 'bg-amber-500/15 border-amber-500/50 text-amber-950 dark:text-amber-100'
              : 'bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-rose-500/10 border-rose-500/30 text-slate-900 dark:text-white'
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs sm:text-sm font-black">
            {isCompleted ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>اكتملت مبيعات اليوم بنجاح — شكراً لجهودكم وتمنياتنا لكم بالتوفيق ✅</span>
              </>
            ) : repGpsStatus === 'insecure' ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>لا يتوفر GPS عبر اتصال غير آمن (HTTP) — يتطلب فتح التطبيق عبر رابط HTTPS آمن</span>
              </>
            ) : repGpsStatus === 'unavailable' ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>المتصفح الحالي لا يدعم خدمة تحديد الموقع (GPS)</span>
              </>
            ) : repGpsStatus === 'denied' ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>تم رفض إذن الموقع (GPS) — يرجى السماح بالوصول للموقع من إعدادات المتصفح والهاتف لتأكيد الوصول للمحلات</span>
              </>
            ) : repGpsStatus === 'gps_off' ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>خدمة الموقع (GPS) متوقفة في الهاتف — يرجى تشغيل GPS في الجهاز ثم الضغط على «إعادة المحاولة»</span>
              </>
            ) : repGpsStatus === 'timeout' ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>انتهت مهلة التقاط إشارة GPS — تأكد من التواجد في مكان مكشوف وتفعيل «الموقع الدقيق» ثم أعد المحاولة</span>
              </>
            ) : repGpsStatus === 'requesting' ? (
              <>
                <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
                <span>جاري التقاط موقعك الحالي (GPS)...</span>
              </>
            ) : repGpsStatus === 'prompt' || repGpsStatus === 'idle' ? (
              <>
                <Navigation className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>يرجى الضغط على «تفعيل الموقع» للسماح بتحديد موقعك (GPS) لتأكيد زيارة المحلات وتحديث المسار</span>
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0"></span>
                <span>تحديد الموقع نشط لتأكيد زيارة المحلات وتحديث المسار اليومي</span>
              </>
            )}
          </div>
          {!isCompleted && repGpsStatus !== 'active' && repGpsStatus !== 'unavailable' && (
            <button
              type="button"
              disabled={repGpsStatus === 'requesting'}
              onClick={() => {
                if (repGpsStatus === 'insecure') {
                  window.dispatchEvent(new CustomEvent(GPS_OPEN_HELP_MODAL_EVENT, { detail: { status: 'insecure' } }));
                } else {
                  requestGeolocationFromUserGesture({ openHelpOnError: true });
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-black text-xs shadow-sm cursor-pointer transition-colors"
            >
              {repGpsStatus === 'insecure'
                ? 'عرض التفاصيل'
                : repGpsStatus === 'requesting'
                ? 'جاري التفعيل...'
                : repGpsStatus === 'denied' || repGpsStatus === 'gps_off' || repGpsStatus === 'timeout'
                ? 'إعادة المحاولة / تفعيل الموقع'
                : 'تفعيل الموقع'}
            </button>
          )}
        </div>
      )}

      {/* Admin Live Fleet Tracking & Saladin Governorate Map */}
      {(currentUser?.isAdmin || isDataEntry) && showFleetMap && (
        <SaladinFleetMap
          routes={enrichedRoutes}
          salesEntries={allSalesEntries}
          unsuccessfulVisits={unsuccessfulVisits}
          isDarkMode={isDarkMode}
          canEditCoordinates={isStrictAdmin}
          canManageGeofence={isStrictAdmin}
          selectedDayFilter={routeFilterDay}
          selectedDelegateFilter={routeFilterDelegate}
          onSelectCustomerAction={(route) => setCustomerVisitModalRoute(route)}
          canCreateInvoiceForRoute={(route) => canCreateInvoiceOnMap(route)}
          onNotify={(msg) =>
            addToast?.({
              title: 'خريطة صلاح الدين',
              message: msg,
              type: 'success',
            })
          }
        />
      )}

      {/* Representative Live Route & Saladin Governorate Map (Positioned at top of Routes page) */}
      {isFieldRep && !currentUser?.isAdmin && !isDataEntry && showFleetMap && (
        <SaladinFleetMap
          routes={enrichedRoutes}
          salesEntries={allSalesEntries}
          unsuccessfulVisits={unsuccessfulVisits}
          isDarkMode={isDarkMode}
          canEditCoordinates={false}
          repViewOnly={true}
          restrictRepId={getRepTrackingId(currentUser)}
          restrictRepName={currentUser?.name || currentUser?.delegateName || ''}
          restrictDelegateCode={currentUser?.delegateCode || effectiveDelegateCode || ''}
          restrictUsername={currentUser?.username || ''}
          restrictDay={currentDay}
          onSelectCustomerAction={(route) => handleOpenVisitModalFromMap(route)}
          canCreateInvoiceForRoute={(route) => canCreateInvoiceOnMap(route)}
          onNotify={(msg) =>
            addToast?.({
              title: 'خريطة صلاح الدين',
              message: msg,
              type: 'success',
            })
          }
        />
      )}
      
      {/* Active Route Day Notice / Indicator */}
      {(!currentUser?.isAdmin && !isDataEntry) && (
        <div className={`p-2.5 sm:p-3 rounded-xl border flex items-center justify-between gap-2 shadow-xs ${
          routeDayInfo.isPast6PM 
            ? 'bg-gradient-to-r from-amber-500/15 via-emerald-500/10 to-teal-500/15 border-amber-500/30 text-amber-900 dark:text-amber-200' 
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-900 dark:text-emerald-200'
        }`}>
          <div className="flex items-center gap-2 text-xs sm:text-sm font-black">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              مسار اليوم المعروض: <span className="underline decoration-2 decoration-emerald-500 text-emerald-700 dark:text-emerald-300 font-extrabold">{currentDay}</span>
            </span>
          </div>
          {routeDayInfo.isPast6PM ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black bg-amber-500 text-slate-950 shadow-xs">
              مسار الغد (تحديث 6:00 م) 🌙
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold bg-emerald-600 text-white shadow-xs">
              مسار اليوم ☀️
            </span>
          )}
        </div>
      )}

      {/* Dashboard Widget */}
      {(() => {
        const todayStr = baghdadStatus.todayBaghdad || new Date().toISOString().split('T')[0];
        const scheduledToday = filteredRoutes.length;
        const invoicesToday = new Set(salesEntries.filter(e => e.dateString === todayStr).map(e => e.customerCode)).size;
        const remainingToday = filteredRoutes.filter(r => !getCustomerSalesSummary(r)?.visitedToday).length;

        return (
            <div className={`grid grid-cols-3 gap-2 sm:gap-4 p-3 sm:p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="text-center">
                    <div className="text-[10px] font-bold text-slate-500 mb-1">
                      {routeDayInfo.isPast6PM && !currentUser?.isAdmin && !isDataEntry ? `زبائن مسار ${currentDay}` : 'زبائن اليوم'}
                    </div>
                    <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white">{scheduledToday}</div>
                </div>
                <div className="text-center border-x border-slate-200 dark:border-slate-700 px-1">
                    <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">فواتير اليوم</div>
                    <div className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400">{invoicesToday}</div>
                </div>
                <div className="text-center">
                    <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mb-1">المتبقي اليوم</div>
                    <div className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400">{remainingToday}</div>
                </div>
            </div>
        );
      })()}

      {/* Per-Delegate Today Breakdown (Admin / Data Entry View) */}
      {(currentUser?.isAdmin || isDataEntry) && delegateTodayBreakdown.length > 0 && (
        <div className={`p-4 rounded-2xl border shadow-sm space-y-3 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          <h4 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-200 flex items-center justify-between">
            <span>إحصائيات المناديب اليوم ({currentDay})</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
              {delegateTodayBreakdown.length} مندوب نشط
            </span>
          </h4>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-right text-[11px] sm:text-xs whitespace-nowrap">
              <thead className={`font-black ${isDarkMode ? 'bg-slate-900 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                <tr>
                  <th className="px-3 py-2 border-b dark:border-slate-700">اسم المندوب</th>
                  <th className="px-3 py-2 border-b dark:border-slate-700 text-center">زبائن اليوم</th>
                  <th className="px-3 py-2 border-b dark:border-slate-700 text-center">فواتير اليوم</th>
                  <th className="px-3 py-2 border-b dark:border-slate-700 text-center">المتبقي اليوم</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-800/60 text-slate-200' : 'divide-slate-200 bg-white text-slate-800'}`}>
                {delegateTodayBreakdown.map((d, idx) => (
                  <tr key={`del-breakdown-${idx}`} className={`hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'} transition-colors`}>
                    <td className="px-3 py-2 font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span>{d.name}</span>
                    </td>
                    <td className="px-3 py-2 font-black text-center font-mono">{d.scheduledToday}</td>
                    <td className="px-3 py-2 font-black text-center font-mono text-emerald-600 dark:text-emerald-400">{d.invoicesToday}</td>
                    <td className="px-3 py-2 font-black text-center font-mono text-amber-600 dark:text-amber-400">{d.remainingToday}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className={`font-black border-t-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/90 text-slate-100' : 'border-slate-200 bg-slate-50 text-slate-900'}`}>
                <tr>
                  <td className="px-3 py-2.5 font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                    <span>المجموع ({delegateTodayBreakdown.length} مندوب)</span>
                  </td>
                  <td className="px-3 py-2.5 font-black text-center font-mono text-xs sm:text-sm text-slate-900 dark:text-white">
                    {delegateTodayBreakdown.reduce((sum, d) => sum + (d.scheduledToday || 0), 0)}
                  </td>
                  <td className="px-3 py-2.5 font-black text-center font-mono text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">
                    {delegateTodayBreakdown.reduce((sum, d) => sum + (d.invoicesToday || 0), 0)}
                  </td>
                  <td className="px-3 py-2.5 font-black text-center font-mono text-xs sm:text-sm text-amber-600 dark:text-amber-400">
                    {delegateTodayBreakdown.reduce((sum, d) => sum + (d.remainingToday || 0), 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      
      {/* Search and Option Pill Filters */}
      <div className={`p-3 sm:p-4 rounded-2xl border space-y-3 shadow-xs ${isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-white border-slate-200'}`}>
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
          <input 
            type="text" 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)} 
            placeholder="بحث عن زبون (الاسم، الكود، العنوان، الهاتف، المسار)..." 
            className={`w-full pr-9 pl-8 p-2 rounded-xl border text-xs font-bold transition-all ${isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'}`}
          />
          {searchQuery && (
            <button 
              type="button" 
              onClick={() => setSearchQuery('')} 
              className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold p-0.5 cursor-pointer"
              title="مسح البحث"
            >
              ✕
            </button>
          )}
        </div>

        {/* Customer Type Filter Options (نوع الزبون) */}
        <div className="space-y-1">
          <div className="text-[11px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>نوع الزبون:</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {/* All Option */}
            <button
              type="button"
              onClick={() => setRouteFilterType('')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                !routeFilterType
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : isDarkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <span>الكل</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                !routeFilterType ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}>
                {customerTypeCounts.all}
              </span>
            </button>

            {/* Mifrad (مفرد) Option */}
            <button
              type="button"
              onClick={() => setRouteFilterType('مفرد')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                routeFilterType === 'مفرد'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : isDarkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <span>مفرد</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                routeFilterType === 'مفرد' ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}>
                {customerTypeCounts.mifrad}
              </span>
            </button>

            {/* Jumla (جملة) Option */}
            <button
              type="button"
              onClick={() => setRouteFilterType('جملة')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                routeFilterType === 'جملة'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : isDarkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <span>جملة</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                routeFilterType === 'جملة' ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}>
                {customerTypeCounts.jumla}
              </span>
            </button>
          </div>
        </div>

        {/* Days Option Pills (الأيام) for Admin/DataEntry */}
        {(currentUser?.isAdmin || isDataEntry) && (
          <div className="space-y-1 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
            <div className="text-[11px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>اليوم / المسار:</span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {['', 'السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس'].map((day) => {
                const isSelected = routeFilterDay === day;
                const label = day || 'كل الأيام';
                const count = dayCounts[day] || 0;
                return (
                  <button
                    key={day || 'all-days-pill'}
                    type="button"
                    onClick={() => setRouteFilterDay(day)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-teal-600 text-white font-black shadow-md shadow-teal-600/20'
                        : isDarkMode
                        ? 'bg-slate-900 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                    }`}
                  >
                    <span>{label}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                      isSelected ? 'bg-teal-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Delegate Option Pills (المندوبين) for Admin/DataEntry */}
        {(currentUser?.isAdmin || isDataEntry) && (
          <div className="space-y-1 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
            <div className="text-[11px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>المندوب:</span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => setRouteFilterDelegate('')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  !routeFilterDelegate
                    ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-600/20'
                    : isDarkMode
                    ? 'bg-slate-900 text-slate-300 hover:bg-slate-700 border border-slate-700'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <span>كل المندوبين</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                  !routeFilterDelegate ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}>
                  {delegateCounts[''] || 0}
                </span>
              </button>

              {allAvailableDelegates.map((d) => {
                const isSelected = routeFilterDelegate === d.value || routeFilterDelegate === d.key;
                const count = delegateCounts[d.value] ?? delegateCounts[d.key] ?? 0;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setRouteFilterDelegate(d.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-600/20'
                        : isDarkMode
                        ? 'bg-slate-900 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                    }`}
                  >
                    <span>{d.value}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                      isSelected ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {searchQuery.trim() && (
          <div className="flex items-center justify-between text-[11px] font-bold text-emerald-600 dark:text-emerald-400 px-1 pt-1">
            <span>نتائج البحث: تم العثور على {finalRoutes.length} زبون</span>
            <button 
              type="button" 
              onClick={() => setSearchQuery('')}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline cursor-pointer"
            >
              إلغاء البحث
            </button>
          </div>
        )}
      </div>
      
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[10px] sm:text-xs text-right">
          <thead className={`font-bold text-[10px] sm:text-xs ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
            <tr>
              <th className="px-2 py-2 border-b dark:border-slate-700 whitespace-nowrap">كود الزبون</th>
              <th className="px-2 py-2 border-b dark:border-slate-700 min-w-[130px]">اسم ورقم الزبون</th>
              <th className="px-2 py-2 border-b dark:border-slate-700 min-w-[90px] max-w-[130px]">العنوان</th>
              <th className="px-1.5 py-2 border-b dark:border-slate-700 whitespace-nowrap">المسار</th>
              <th className="px-1.5 py-2 border-b dark:border-slate-700 whitespace-nowrap">نوع الزبون</th>
              <th className="px-2 py-2 border-b dark:border-slate-700 whitespace-nowrap">المندوب</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700 bg-slate-900 text-slate-300' : 'divide-slate-200 bg-white text-slate-700'}`}>
            {!routesLoaded ? (
              // Skeleton Loader
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`route-skeleton-${i}`} className="animate-pulse">
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                  <td className="px-3 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div></td>
                </tr>
              ))
            ) : finalRoutes.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-500 font-bold">
                  {searchQuery.trim() ? (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Search className="w-8 h-8 text-slate-400" />
                      <span>لا توجد نتائج مطابقة لبحثك عن "{searchQuery}"</span>
                      <button 
                        type="button" 
                        onClick={() => setSearchQuery('')}
                        className="text-emerald-600 hover:underline text-xs"
                      >
                        مسح البحث وعرض الكل
                      </button>
                    </div>
                  ) : (
                    'لا توجد محلات مجدولة لهذا اليوم.'
                  )}
                </td>
              </tr>
            ) : (
              groupedRoutesByDay.map(([day, dayRoutes]) => (
                <React.Fragment key={day}>
                  <tr>
                    <td colSpan={6} className={`px-3 py-2 font-bold ${isDarkMode ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-emerald-700'}`}>
                      {day}
                    </td>
                  </tr>
                  {dayRoutes.map(r => {
                    const cCode = String(r.customerCode ?? '').trim();
                    const summary = getCustomerSalesSummary(r);
                    const visitedBySale = Boolean(summary?.visitedToday);
                    const unsuccessfulToday = !visitedBySale && isRouteUnsuccessfulToday(r);
                    const totalWeightToday = summary?.totalWeightToday || 0;
                    
                    const isPrivilegedUser = Boolean(currentUser?.isAdmin || isDataEntry);

                    const hasDebt = customerDebtsSet.has(cCode);
                    const isUnlockedForOrder = Boolean(
                      unlockedCustomerCodes[cCode] ||
                      unlockedCustomerCodes[normalizeArabic(r.customerName)] ||
                      unlockedCustomerCodes[r.customerName]
                    );

                    const canOrder = isPrivilegedUser || ((!hasDebt || isUnlockedForOrder) && !completedDelegates[r.delegateName || '']);

                    return (
                      <tr 
                        key={r.id} 
                        onClick={() => handleRowClick(r)}
                        className={`cursor-pointer transition-all ${
                          visitedBySale
                            ? (isDarkMode ? 'bg-emerald-950/50' : 'bg-emerald-50/90')
                            : unsuccessfulToday
                            ? (isDarkMode ? 'bg-amber-950/40' : 'bg-amber-50/90')
                            : selectedRowId === r.id
                            ? 'bg-red-100 font-black'
                            : `hover:${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`
                        }`}
                      >
                        <td className={`px-2 py-1.5 ${selectedRowId === r.id ? 'text-red-700 font-black' : ''}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 font-mono text-xs">
                              {r.customerCode}
                            </div>
                            <div className="flex items-center gap-1">
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleOrderClick(r); }}
                                className={`p-1 px-1.5 rounded-lg flex items-center gap-1 font-extrabold transition-all active:scale-95 cursor-pointer ${
                                  hasDebt && isUnlockedForOrder
                                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-xs'
                                    : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-600'
                                }`}
                                title={hasDebt && isUnlockedForOrder ? "إنشاء فاتورة (تم فتح الطلب استثناءً رغم وجود الدين)" : "إنشاء فاتورة / تسجيل ملاحظة"}
                              >
                                <ShoppingBag className="w-4 h-4" />
                                {hasDebt && isUnlockedForOrder && (
                                  <span className="text-[9px] font-black">طلب (مفتوح)</span>
                                )}
                              </button>
                              
                              {hasDebt && !isUnlockedForOrder && !currentUser?.isAdmin && !isDataEntry && (
                                <span 
                                  className="text-[9px] font-black bg-rose-500/20 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded border border-rose-500/30 shrink-0"
                                  title="مغلق لوجود دين - يمكنك النقر على الزر وتسجيل ملاحظات"
                                >
                                  دين مستحق
                                </span>
                              )}

                              {totalWeightToday > 0 && (
                                  <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-[9px] font-black">
                                      {totalWeightToday.toFixed(0)} كجم
                                  </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 font-bold">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-slate-900 dark:text-white font-black">{r.customerName}</span>
                            {visitedBySale ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white shadow-2xs shrink-0"
                                title="تمت الزيارة وتسجيل فاتورة بيع لهذا المحل"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>تمت</span>
                              </span>
                            ) : unsuccessfulToday ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950 border border-amber-500 shadow-2xs shrink-0"
                                title="تم توثيق زيارة غير ناجحة لهذا المحل اليوم"
                              >
                                <AlertTriangle className="w-3 h-3" />
                                <span>زيارة غير ناجحة</span>
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 shrink-0"
                                title="لم تتم زيارة هذا المحل بفاتورة بيع حتى الآن"
                              >
                                <Circle className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
                                <span>لم تتم</span>
                              </span>
                            )}
                            {customerNotesCountMap.has(cCode) && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 shrink-0"
                                title={`ملاحظات مسجلة لهذا المحل: (${customerNotesCountMap.get(cCode)})`}
                              >
                                <FileText className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                <span>ملاحظة</span>
                              </span>
                            )}
                            {(() => {
                              const phone = getCustomerPhone(r);
                              if (!phone) return null;
                              return (
                                <a 
                                  href={`tel:${phone}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 font-mono text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 px-1.5 py-0.5 rounded-md border border-emerald-300 dark:border-emerald-700/60 shrink-0 transition-all shadow-2xs"
                                  title="رقم الزبون - اضغط للاتصال المباشر"
                                  dir="ltr"
                                >
                                  <Phone className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span className="font-mono">{phone}</span>
                                </a>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 max-w-[130px] sm:max-w-[180px] truncate" title={r.customerAddress}>{r.customerAddress}</td>
                        <td className="px-1.5 py-1.5 whitespace-nowrap">
                          {isRouteOverrideActive(r) ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <span
                                className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/40 flex items-center gap-1 shadow-2xs"
                                title={`مسار مؤقت حتى الساعة 9:00 مساءً (اليوم الأصلي: ${r.originalPath || r.path})`}
                              >
                                <Clock className="w-3 h-3 text-amber-500 animate-spin shrink-0" />
                                <span>مسار مؤقت: {r.tempAssignedDay}</span>
                              </span>
                              <div className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold pr-0.5">
                                <span>الأصلي: {r.originalPath || r.path}</span>
                                {(currentUser?.isAdmin || currentUser?.name === 'الأدمن') && !isDataEntry && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleRevertRouteShift(r, e)}
                                    className="text-rose-600 dark:text-rose-400 hover:underline font-black cursor-pointer"
                                    title="إلغاء التحويل المؤقت وإعادة المسار الأصلي فوراً"
                                  >
                                    إلغاء
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-1.5">
                              <span>{r.path}</span>
                              {(currentUser?.isAdmin || currentUser?.name === 'الأدمن') && !isDataEntry && (
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenShiftModal(r, e)}
                                  className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-950/60 text-amber-600 dark:text-amber-400 transition-all cursor-pointer"
                                  title="تحويل مسار هذا المحل مؤقتاً ليوم آخر حتى 9:00 مساءً"
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-1.5 whitespace-nowrap">{r.customerType}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r.delegateName}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!searchQuery.trim() && displayLimit < finalRoutes.length && (
        <button
          onClick={() => setDisplayLimit(l => l + 20)}
          className="w-full p-3 text-center bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 font-black text-xs rounded-xl"
        >
          عرض المزيد
        </button>
      )}



      {/* End-of-Day Route Visit Summary & Hourly Chart Report */}
      <EndOfDayRouteReport
        routes={routes}
        salesEntries={allSalesEntries}
        customerNotes={customerNotes}
        manualVisits={manualVisits}
        currentDay={currentDay}
        delegateName={currentUser?.name || currentUser?.delegateName}
        delegateCode={currentUser?.delegateCode || effectiveDelegateCode}
        username={currentUser?.username}
        isPrivilegedUser={Boolean(currentUser?.isAdmin || isDataEntry)}
        selectedDelegateFilter={routeFilterDelegate}
        selectedDayFilter={routeFilterDay}
        isCompletedToday={isCompleted}
        isDarkMode={isDarkMode}
      />

      {/* Debts Table rendered first */}
      <div className="mt-8">
        {renderDebtsTable()}
      </div>



      {/* Debt Details Modal */}
      {selectedDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={() => setSelectedDebt(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-amber-600 dark:text-amber-400 text-center">تنبيه دين مستحق</h3>
            <div className="space-y-3 text-sm">
                <p><span className="font-bold text-slate-500">اسم الزبون:</span> {selectedDebt.customerName}</p>
                <p><span className="font-bold text-slate-500">كود الزبون:</span> {selectedDebt.customerCode}</p>
                <p><span className="font-bold text-slate-500">تاريخ الفاتورة:</span> {selectedDebt.invoiceDate}</p>
                <p><span className="font-bold text-slate-500">تاريخ السداد:</span> {selectedDebt.paymentDueDate}</p>
                <p><span className="font-bold text-slate-500">المبلغ المستحق:</span> {formatDebtAmount(selectedDebt.amountDue)} د.ع</p>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs border border-slate-200 dark:border-slate-700">
                  <span className="font-bold text-slate-600 dark:text-slate-400">حالة الاستحقاق (مستحقة):</span>
                  {(() => {
                    const payDateObj = parseDateToMidnight(selectedDebt.paymentDueDate);
                    if (!payDateObj) return <span className="font-mono font-bold text-slate-500">NT</span>;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const diff = Math.round((today.getTime() - payDateObj.getTime()) / (1000 * 3600 * 24));
                    if (today.getTime() >= payDateObj.getTime()) {
                      return <span className="font-black text-rose-600 dark:text-rose-400 font-mono">مستحقة ({diff} يوم)</span>;
                    }
                    const remaining = Math.round((payDateObj.getTime() - today.getTime()) / (1000 * 3600 * 24));
                    return <span className="font-bold text-slate-500 font-mono">غير مستحقة (NT) • باقي {remaining} يوم</span>;
                  })()}
                </div>
            </div>
            <div className="flex gap-2 pt-2">
                <button 
                    onClick={() => setSelectedDebt(null)}
                    className="flex-1 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition-colors cursor-pointer"
                >
                    إغلاق
                </button>
                {currentUser?.isAdmin && (
                  <>
                    <button 
                        onClick={() => {
                            const target = selectedDebt;
                            setSelectedDebt(null);
                            handleOpenWhatsAppModal(target);
                        }}
                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                        <MessageCircle className="w-4 h-4" />
                        <span>واتساب</span>
                    </button>
                    <button 
                        onClick={() => {
                            const target = selectedDebt;
                            setSelectedDebt(null);
                            setPaymentModalDebt(target);
                            setPaymentAmountInput(target.amountDue.toString());
                        }}
                        className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                        <CreditCard className="w-4 h-4" />
                        <span>تسديد الدين</span>
                    </button>
                  </>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Debt Settlement Modal (Centered with Blurred Backdrop) - Admin Only */}
      {paymentModalDebt && currentUser?.isAdmin && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => !isProcessingPayment && setPaymentModalDebt(null)}
          dir="rtl"
        >
          <div 
            className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl border text-center space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-emerald-500/40 text-white shadow-emerald-950/20' : 'bg-white border-emerald-200 text-slate-900 shadow-slate-300/50'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header Icon */}
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shadow-inner border border-emerald-500/30">
              <CreditCard className="w-7 h-7" />
            </div>

            {/* Title & Customer Info */}
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                تسديد دين الزبون
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {paymentModalDebt.customerName} ({paymentModalDebt.customerCode})
              </p>
            </div>

            {/* Input field */}
            <div className="space-y-1.5 text-right">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                أدخل المبلغ المطلوب تسديده:
              </label>
              <div className="relative">
                <input
                  type="number"
                  dir="ltr"
                  autoFocus
                  value={paymentAmountInput}
                  onChange={(e) => setPaymentAmountInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSavePayment();
                    }
                  }}
                  className="w-full text-center text-xl font-black py-2.5 px-3 rounded-xl border border-emerald-500/50 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all shadow-inner"
                  placeholder="المبلغ المسدد..."
                />
              </div>

              {/* Sub-text: required amount and status */}
              <div className="text-center pt-1 space-y-0.5">
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  المبلغ المطلوب: <span className="font-black text-emerald-600 dark:text-emerald-400">{formatDebtAmount(paymentModalDebt.amountDue)} د.ع</span>
                </p>
                {(() => {
                  const val = parseFloat(paymentAmountInput) || 0;
                  if (val > 0 && val < paymentModalDebt.amountDue) {
                    return (
                      <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        المتبقي في ذمة الزبون بعد التسديد: {formatDebtAmount(paymentModalDebt.amountDue - val)} د.ع
                      </p>
                    );
                  }
                  if (val >= paymentModalDebt.amountDue && val > 0) {
                    return (
                      <p className="text-[10px] font-bold text-emerald-500">
                        ✓ سيتم تسديد وإغلاق الدين بالكامل
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={isProcessingPayment}
                onClick={() => setPaymentModalDebt(null)}
                className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border transition-all active:scale-95 cursor-pointer ${
                  isDarkMode 
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={isProcessingPayment}
                onClick={handleSavePayment}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white rounded-xl font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                {isProcessingPayment ? (
                  <span>جاري الحفظ...</span>
                ) : (
                  <>
                    <Save className="w-4 h-4 shrink-0" />
                    <span>حفظ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Debt Alert to Delegate Modal - Admin Only */}
      {whatsappModalDebt && currentUser?.isAdmin && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setWhatsappModalDebt(null)}
          dir="rtl"
        >
          <div 
            className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border text-center space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-emerald-500/40 text-white shadow-emerald-950/20' : 'bg-white border-emerald-200 text-slate-900 shadow-slate-300/50'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header Icon */}
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shadow-inner border border-emerald-500/30">
              <MessageCircle className="w-7 h-7" />
            </div>

            {/* Title & Info */}
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                إرسال تنبيه دين للمندوب عبر واتساب
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                سيتم إرسال رسالة تنبيه مفصلة بالدين لمندوب الزبون للمتابعة والاستحصال
              </p>
            </div>

            {/* Summary Box */}
            <div className="text-right p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">المندوب المسؤول:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {(() => {
                    const acc = delegateAccounts.find(
                      a => (whatsappModalDebt.delegateCode && a.delegateCode && String(a.delegateCode).trim() === String(whatsappModalDebt.delegateCode).trim()) ||
                           (whatsappModalDebt.delegateName && a.delegateName && normalizeArabic(a.delegateName) === normalizeArabic(whatsappModalDebt.delegateName))
                    );
                    return acc?.delegateName || whatsappModalDebt.delegateName || whatsappModalDebt.delegateCode || 'غير محدد';
                  })()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">الزبون:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {whatsappModalDebt.customerName} ({whatsappModalDebt.customerCode})
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">المبلغ المستحق:</span>
                <span className="font-black text-rose-600 dark:text-rose-400">
                  {formatDebtAmount(whatsappModalDebt.amountDue)} د.ع
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">تاريخ السداد:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                  {whatsappModalDebt.paymentDueDate}
                </span>
              </div>
            </div>

            {/* Phone Input field */}
            {(() => {
              const matchedAccount = delegateAccounts.find(
                (acc) =>
                  (whatsappModalDebt.delegateCode && acc.delegateCode && String(acc.delegateCode).trim() === String(whatsappModalDebt.delegateCode).trim()) ||
                  (whatsappModalDebt.delegateName && acc.delegateName && normalizeArabic(acc.delegateName) === normalizeArabic(whatsappModalDebt.delegateName))
              );
              const isFixed = Boolean(getFixedDelegatePhone(whatsappModalDebt.delegateName, whatsappModalDebt.delegateCode, matchedAccount?.username));

              return (
                <div className="space-y-1.5 text-right">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      رقم هاتف المندوب على واتساب:
                    </label>
                    {isFixed && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/60 px-2 py-0.5 rounded-full">
                        <span>🔒 رقم ثابت ومحفوظ</span>
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="tel"
                      dir="ltr"
                      autoFocus={!isFixed}
                      readOnly={isFixed}
                      value={delegatePhoneInput}
                      onChange={(e) => !isFixed && setDelegatePhoneInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSendWhatsAppAlert();
                        }
                      }}
                      className={`w-full text-center text-base font-bold py-2 px-3 rounded-xl border ${
                        isFixed
                          ? 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 select-all cursor-default'
                          : 'border-emerald-500/50 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500'
                      } transition-all shadow-inner`}
                      placeholder="مثال: 07701234567 أو 9647701234567"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center">
                    {isFixed
                      ? 'تم تثبيت وحفظ هذا الرقم للمندوب بصورة دائمة ومحمية من التغيير.'
                      : 'يمكن إدخال الرقم للإرسال المباشر، أو تركه فارغاً لاختيار المحادثة من واتساب مباشرة.'}
                  </p>
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setWhatsappModalDebt(null)}
                className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm border transition-all active:scale-95 cursor-pointer ${
                  isDarkMode 
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={handleSendWhatsAppAlert}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 shrink-0" />
                <span>إرسال واتساب</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Dismissing Overdue Debts Modal Alert */}
      {showOverdueAlertModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="overdue-debts-modal-title"
          data-testid="overdue-debts-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowOverdueAlertModal(false);
            }
          }}
          dir="rtl"
        >
          <div
            className={`relative w-full max-w-[90%] sm:max-w-md max-h-[80vh] flex flex-col rounded-xl shadow-xl overflow-hidden border border-rose-300 dark:border-rose-900/60 ${
              isDarkMode ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 3-Second Auto-Dismiss Countdown Progress Bar */}
            <div className="w-full bg-rose-100 dark:bg-rose-950/60 h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${isCountdownPaused ? 'bg-amber-500' : 'bg-rose-600'}`}
                style={{ width: isCountdownPaused ? '100%' : `${Math.max(0, (countdownSeconds / 3) * 100)}%` }}
              />
            </div>

            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-rose-100 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/30">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500 text-white shadow-md shadow-rose-500/30 shrink-0">
                  <AlertTriangle className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 id="overdue-debts-modal-title" className="text-base sm:text-lg font-black text-rose-700 dark:text-rose-300">
                      تنبيه: ديون مستحقة متأخرة
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-xs">
                      {representativeOverdueDebts.length} زبائن
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-0.5">
                    ديون تجاوزت مدة استحقاقها يوماً واحداً (&gt; 1 يوم) لزبائنك المسندين إليك
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Countdown / Paused badge */}
                <span className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border ${
                  isCountdownPaused
                    ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800'
                    : 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/50 border-rose-200 dark:border-rose-800'
                }`}>
                  {isCountdownPaused ? <Pause className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  <span>{isCountdownPaused ? 'العداد متوقف' : `يغلق خلال ${countdownSeconds} ثوانٍ`}</span>
                </span>

                {/* Manual close button (X) */}
                <button
                  type="button"
                  onClick={() => setShowOverdueAlertModal(false)}
                  data-testid="close-overdue-modal-x"
                  aria-label="Close"
                  title="إغلاق"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-100/60 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Content Table */}
            <div className="p-4 overflow-y-auto max-h-[55vh]">
              <div className="overflow-x-auto rounded-xl border border-rose-200 dark:border-rose-900/60 shadow-xs">
                <table data-testid="overdue-debts-table" className="w-full text-right text-xs">
                  <thead className={`font-black ${isDarkMode ? 'bg-slate-800 text-rose-200 border-b border-rose-900/50' : 'bg-rose-50 text-rose-900 border-b border-rose-200'}`}>
                    <tr>
                      <th className="px-2 sm:px-3 py-2 text-center">#</th>
                      <th className="px-2 sm:px-3 py-2">اسم الزبون</th>
                      <th className="px-2 sm:px-3 py-2 text-left">المبلغ المطلوب</th>
                      <th className="px-2 sm:px-3 py-2 text-center">المدة</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y font-bold ${isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-100' : 'divide-rose-100 bg-white text-slate-900'}`}>
                    {representativeOverdueDebts.map((debt, idx) => (
                      <tr key={debt.id || `overdue-debt-${idx}`} className={`hover:bg-rose-500/10 transition-colors ${isDarkMode ? 'odd:bg-slate-900 even:bg-slate-800/40' : 'odd:bg-white even:bg-rose-50/30'}`}>
                        <td className="px-2 sm:px-3 py-2 text-center font-mono text-[11px] text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="px-2 sm:px-3 py-2 font-black text-slate-900 dark:text-white">
                          <div className="flex flex-col">
                            <span className="font-black text-xs sm:text-sm">{debt.customerName}</span>
                            {debt.customerCode && (
                              <span className="text-[10px] text-slate-400 font-mono">كود: {debt.customerCode}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 sm:px-3 py-2 text-left font-mono font-black text-rose-600 dark:text-rose-400 text-xs sm:text-sm whitespace-nowrap">
                          {formatDebtAmount(debt.amountDue)} <span className="text-[10px] font-sans">د.ع</span>
                        </td>
                        <td className="px-2 sm:px-3 py-2 text-center whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black bg-rose-500 text-white shadow-xs">
                            <Clock className="w-3 h-3" />
                            <span>{debt.dueDays} يوم</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className={`font-black text-xs border-t ${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-50 text-slate-800 border-slate-200'}`}>
                    <tr>
                      <td colSpan={2} className="px-2 sm:px-3 py-2">
                        إجمالي الديون المتأخرة ({representativeOverdueDebts.length} زبائن)
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-left font-mono font-black text-rose-600 dark:text-rose-400 text-xs sm:text-sm whitespace-nowrap">
                        {formatDebtAmount(representativeOverdueDebts.reduce((sum, it) => sum + (Number(it.amountDue) || 0), 0))} <span className="text-[10px] font-sans">د.ع</span>
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-center text-[10px] text-slate-400 font-bold">&gt; 1 يوم</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Modal Footer with Pause Counter Button & Manual Close ("Close" / "إغلاق") Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
              <div className="text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5">
                {isCountdownPaused ? (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-black">
                    <Pause className="w-4 h-4 shrink-0" />
                    <span>تم إيقاف العداد (يمكنك قراءة الديون بدون إغلاق تلقائي)</span>
                  </span>
                ) : (
                  <>
                    <Clock className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>يغلق تلقائياً بعد {countdownSeconds} ثوانٍ</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 justify-end">
                {/* Pause / Resume Button adjacent to the Close button */}
                <button
                  type="button"
                  onClick={() => setIsCountdownPaused((prev) => !prev)}
                  data-testid="pause-overdue-modal-countdown-btn"
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs ${
                    isCountdownPaused
                      ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                      : 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700'
                  }`}
                  title={isCountdownPaused ? 'استئناف العداد التلقائي' : 'إيقاف العداد لقراءة الديون'}
                >
                  {isCountdownPaused ? (
                    <>
                      <Play className="w-4 h-4 shrink-0 fill-current" />
                      <span>استئناف العداد</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4 shrink-0 fill-current" />
                      <span>إيقاف العداد</span>
                    </>
                  )}
                </button>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setShowOverdueAlertModal(false)}
                  data-testid="close-overdue-modal-btn"
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs"
                >
                  <X className="w-4 h-4" />
                  <span>إغلاق (Close)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      






      {/* Customer Notes / Delegate Information Section at the bottom of Routes page */}
      <div className={`mt-8 p-4 sm:p-5 rounded-2xl border shadow-md space-y-4 ${
        isDarkMode 
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-blue-900/60' 
          : 'bg-gradient-to-br from-blue-50/70 via-white to-slate-50 border-blue-200'
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-blue-100 dark:border-slate-700/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/30 shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                <span>ملاحظات ومعلومات المحلات من المندوبين</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-600 text-white shadow-xs">
                  {isStrictAdmin
                    ? 'جميع الملاحظات (أدمن)'
                    : isDataEntry
                    ? 'جميع الملاحظات'
                    : 'ملاحظاتي فقط (مندوب)'}
                </span>
                {(isStrictAdmin || isDataEntry) && (
                  <button
                    onClick={handleExportNotesCSV}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-black bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-xs cursor-pointer transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    <span>تحميل البيانات (CSV)</span>
                  </button>
                )}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                {isStrictAdmin
                  ? 'متابعة ملاحظات المحلات، واتخاذ الإجراءات والموافقات عليها ليراها المندوب مباشرة.'
                  : isDataEntry
                  ? 'عرض ومتابعة ملاحظات ومعلومات المحلات من جميع المندوبين.'
                  : 'ملاحظاتك المسجلة للمحلات مع بيان الإجراءات والموافقات المتخذة من الإدارة.'}
              </p>
            </div>
          </div>

          {/* Search Box */}
          <div className="w-full sm:w-64 relative">
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={notesSearchQuery}
              onChange={(e) => setNotesSearchQuery(e.target.value)}
              placeholder="بحث بالزبون، المندوب، الإجراء..."
              className={`w-full pr-9 pl-3 py-1.5 rounded-xl border text-xs font-bold ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
              }`}
            />
          </div>
        </div>

        {/* Action Status Filter Tabs */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button
            type="button"
            onClick={() => setNotesActionFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-xs ${
              notesActionFilter === 'all'
                ? 'bg-blue-600 text-white shadow-blue-600/30'
                : isDarkMode
                ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <span>الكل</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              notesActionFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}>
              {notesCounts.total}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNotesActionFilter('pending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-xs ${
              notesActionFilter === 'pending'
                ? 'bg-amber-600 text-white shadow-amber-600/30'
                : isDarkMode
                ? 'bg-slate-800 text-amber-300 hover:bg-slate-700'
                : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>بانتظار إجراء</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              notesActionFilter === 'pending' ? 'bg-white/20 text-white' : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
            }`}>
              {notesCounts.pending}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNotesActionFilter('action_taken')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-xs ${
              notesActionFilter === 'action_taken'
                ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                : isDarkMode
                ? 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
                : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>تم اتخاذ إجراء</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              notesActionFilter === 'action_taken' ? 'bg-white/20 text-white' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
            }`}>
              {notesCounts.actionTaken}
            </span>
          </button>
        </div>

        {/* Delegate Name Filter Buttons (Admin & Data Entry) */}
        {(currentUser?.isAdmin || isDataEntry) && notesDelegateOptions.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>فلترة حسب المندوب:</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setNotesDelegateFilter('')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-xs ${
                  !notesDelegateFilter
                    ? 'bg-blue-600 text-white shadow-blue-600/25'
                    : isDarkMode
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <span>كل المندوبين</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                  !notesDelegateFilter ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}>
                  {customerNotes.length}
                </span>
              </button>

              {notesDelegateOptions.map((del) => {
                const isSelected = normalizeArabic(notesDelegateFilter) === normalizeArabic(del.name);
                return (
                  <button
                    key={del.name}
                    type="button"
                    onClick={() => setNotesDelegateFilter(isSelected ? '' : del.name)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-xs ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-blue-600/25'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        : 'bg-white text-slate-700 hover:bg-blue-50 border border-slate-200'
                    }`}
                  >
                    <span>{del.name}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}>
                      {del.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Notes Table */}
        {visibleCustomerNotes.length === 0 ? (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400 font-bold text-xs bg-white/40 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
            لا توجد ملاحظات مطابقة للتصفية الحالية.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs">
            <table className="w-full text-[11px] sm:text-xs text-right">
              <thead className={`font-black text-[10px] sm:text-[11px] border-b ${isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                <tr>
                  <th className="px-2.5 py-2 whitespace-nowrap">الزبون</th>
                  <th className="px-2 py-2 whitespace-nowrap">النوع</th>
                  <th className="px-2.5 py-2 min-w-[140px]">الملاحظة</th>
                  <th className="px-2 py-2 whitespace-nowrap">المندوب / التاريخ</th>
                  <th className="px-2.5 py-2 min-w-[170px]">حالة وإجراء الإدارة</th>
                  {!isDataEntry && <th className="px-2 py-2 whitespace-nowrap text-center">إجراءات</th>}
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800 text-slate-200' : 'divide-slate-200 text-slate-800'}`}>
                {visibleCustomerNotes.slice(0, notesVisibleLimit).map((note) => {
                  const canDelete = Boolean(
                    !isDataEntry && (
                      isStrictAdmin ||
                      normalizeArabic(note.delegateName) === normalizeArabic(currentUser?.name || currentUser?.delegateName)
                    )
                  );

                  return (
                    <tr
                      key={note.id || `note-${note.timestamp}`}
                      className={`transition-colors align-top ${
                        note.adminActionTaken
                          ? isDarkMode
                            ? 'bg-emerald-900/45 hover:bg-emerald-900/65 text-emerald-50'
                            : 'bg-emerald-100 hover:bg-emerald-200/75 text-emerald-950'
                          : isDarkMode
                          ? 'bg-amber-950/15 hover:bg-slate-800/70'
                          : 'bg-amber-50/35 hover:bg-amber-50/70'
                      }`}
                    >
                      {/* Customer Name, Code, Address */}
                      <td className="px-2.5 py-2 min-w-[140px] max-w-[210px]">
                        <div className="font-black text-slate-900 dark:text-white leading-tight">
                          {note.customerName}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 leading-snug">
                          {note.customerCode ? `${note.customerCode}` : ''}
                          {note.customerCode && note.customerAddress ? ' • ' : ''}
                          {note.customerAddress ? (
                            <span className="font-sans">{note.customerAddress}</span>
                          ) : null}
                        </div>
                      </td>

                      {/* Selected Option */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                          {note.selectedOption}
                        </span>
                      </td>

                      {/* Note Text */}
                      <td className="px-2.5 py-2 max-w-[220px]">
                        {note.notes ? (
                          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-100 leading-snug whitespace-pre-wrap break-words">
                            {note.notes}
                          </p>
                        ) : (
                          <span className="text-[10px] text-slate-400">-</span>
                        )}
                      </td>

                      {/* Delegate & Date */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <div className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1 text-[11px]">
                          <User className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{note.delegateName || 'مندوب'}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 dark:text-slate-400 font-mono mt-0.5" dir="ltr">
                          {formatEnglishDateTime(note.createdAt || note.timestamp, note.dateString || '')}
                        </div>
                      </td>

                      {/* Admin Status & Action Details */}
                      <td className="px-2.5 py-2 min-w-[170px] max-w-[250px]">
                        {note.adminActionTaken ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black bg-emerald-600 text-white">
                                <ShieldCheck className="w-3 h-3 shrink-0" />
                                <span>معتمد ومكتمل ✅</span>
                              </span>
                              <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400">
                                {note.adminActionBy || 'الادمن'}
                              </span>
                            </div>
                            {note.adminActionDetails && (
                              <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100 bg-white/90 dark:bg-slate-800/80 px-2 py-1 rounded-md border border-emerald-200 dark:border-emerald-800/60 leading-snug whitespace-pre-wrap">
                                {note.adminActionDetails}
                              </div>
                            )}
                            {note.adminActionAt && (
                              <div className="text-[9px] font-mono text-emerald-700/80 dark:text-emerald-400/80" dir="ltr">
                                {formatEnglishDateTime(note.adminActionAt)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                            <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span>قيد الانتظار ⏳</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      {!isDataEntry && (
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            {isStrictAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleOpenAdminActionModal(note)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer active:scale-95 ${
                                    note.adminActionTaken
                                      ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs'
                                  }`}
                                  title={note.adminActionTaken ? 'تعديل الإجراء المتخذ' : 'اتخاذ إجراء وموافقة'}
                                >
                                  <ShieldCheck className="w-3 h-3 shrink-0" />
                                  <span>{note.adminActionTaken ? 'تعديل' : 'إجراء'}</span>
                                </button>

                                {note.adminActionTaken && (
                                  <button
                                    type="button"
                                    onClick={() => handleRevertAdminAction(note)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                    title="تراجع عن الإجراء وإعادته لقيد الانتظار"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                              </>
                            )}

                            {canDelete && note.id && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomerNote(note.id!, note.customerName)}
                                className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                                title="حذف الملاحظة"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {visibleCustomerNotes.length > 10 && (
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-center gap-2 flex-wrap bg-slate-50/70 dark:bg-slate-900/80">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  يتم عرض {Math.min(notesVisibleLimit, visibleCustomerNotes.length)} من أصل {visibleCustomerNotes.length} ملاحظة
                </span>
                {notesVisibleLimit < visibleCustomerNotes.length ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setNotesVisibleLimit((prev) => prev + 10)}
                      className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-xs transition-colors cursor-pointer"
                    >
                      عرض المزيد (+{Math.min(10, visibleCustomerNotes.length - notesVisibleLimit)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotesVisibleLimit(visibleCustomerNotes.length)}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
                    >
                      عرض الكل ({visibleCustomerNotes.length})
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNotesVisibleLimit(10)}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
                  >
                    تقليص إلى أول 10 ملاحظات
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin Only: Download & Upload Routes Section with Shop Details & Locations */}
      {isStrictAdmin && (() => {
        const excelDelegateMap = new Map<string, { name: string; count: number }>();
        filteredRoutes.forEach((r) => {
          const rawName = String(r.delegateName || '').trim();
          const normName = normalizeArabic(rawName);
          if (!rawName || !normName || isHiddenDelegateForFilter(rawName)) return;
          const existing = excelDelegateMap.get(normName);
          if (existing) {
            existing.count += 1;
          } else {
            excelDelegateMap.set(normName, { name: rawName, count: 1 });
          }
        });
        const excelDelegateOptions = Array.from(excelDelegateMap.values()).sort(
          (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar')
        );

        const selectedExcelDelNorm = normalizeArabic(excelDelegateFilter);
        const excelDelegateFilteredRoutes = selectedExcelDelNorm
          ? filteredRoutes.filter((r) => {
              const rDelNorm = normalizeArabic(r.delegateName);
              return (
                rDelNorm === selectedExcelDelNorm ||
                rDelNorm.includes(selectedExcelDelNorm) ||
                selectedExcelDelNorm.includes(rDelNorm)
              );
            })
          : filteredRoutes;

        const mappedShopsCount = excelDelegateFilteredRoutes.filter(
          (r) => parseCoordinate(r.latitude) !== null && parseCoordinate(r.longitude) !== null
        ).length;
        const unmappedShopsCount = excelDelegateFilteredRoutes.length - mappedShopsCount;

        const excelTableRoutes = excelDelegateFilteredRoutes.filter((r) => {
          const hasLoc = parseCoordinate(r.latitude) !== null && parseCoordinate(r.longitude) !== null;
          if (excelLocFilter === 'mapped' && !hasLoc) return false;
          if (excelLocFilter === 'unmapped' && hasLoc) return false;

          if (excelSearch.trim()) {
            const q = normalizeArabic(excelSearch);
            const hay = [
              normalizeArabic(r.customerCode),
              normalizeArabic(r.customerName),
              normalizeArabic(r.customerAddress),
              normalizeArabic(r.delegateName),
              normalizeArabic(getEffectiveRouteDay(r)),
            ].join(' ');
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const visibleExcelRoutes = excelTableRoutes.slice(0, excelDisplayLimit);

        return (
          <div
            className={`mt-6 p-3.5 sm:p-5 rounded-2xl border shadow-sm space-y-4 overflow-hidden ${
              isDarkMode
                ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-emerald-800/60 text-white'
                : 'bg-gradient-to-br from-emerald-50/80 via-white to-slate-50 border-emerald-200 text-slate-900'
            }`}
          >
            {/* Header & Excel Buttons */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                <div className="p-2.5 rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/30 shrink-0">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm sm:text-base font-black flex items-center gap-2 flex-wrap leading-snug">
                    <span>إدارة ملفات المسارات (Excel) ومواقع المحلات</span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-600 text-white shadow-xs shrink-0">
                      للأدمن فقط
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold leading-relaxed break-words mt-0.5">
                    المسارات المفلترة: {excelDelegateFilter || routeFilterDelegate || 'كل المندوبين'} • {routeFilterDay || 'كل الأيام'} ({excelDelegateFilteredRoutes.length} محل | محدد الموقع: {mappedShopsCount} • بدون موقع: {unmappedShopsCount})
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto min-w-0">
                <button
                  type="button"
                  onClick={handleDownloadFilteredRoutes}
                  className="px-2.5 sm:px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-black text-center leading-tight min-w-0"
                  title={`تحميل المسارات مع عمود موقع المحل (${filteredRoutes.length} زبون)`}
                >
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>تصدير Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadRoutesTemplate}
                  className="px-2.5 sm:px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-emerald-700 dark:text-emerald-300 border border-slate-300 dark:border-slate-600 rounded-xl shadow-xs transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-black text-center leading-tight min-w-0"
                  title="تحميل نموذج إكسل شامل عمود موقع المحل"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>نموذج Excel</span>
                </button>

                <label
                  className={`px-2.5 sm:px-3 py-2 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white rounded-xl shadow-md shadow-sky-600/20 transition-all cursor-pointer flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-black text-center leading-tight min-w-0 ${
                    isUploadingLocationsExcel ? 'opacity-60 pointer-events-none' : ''
                  }`}
                  title="رفع ملف إكسل لتحديث عمود (موقع المحل) للزبائن الحاليين فقط دون استبدال المسارات"
                >
                  <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>{isUploadingLocationsExcel ? 'جاري التحديث...' : 'رفع مواقع المحلات فقط'}</span>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleUploadShopLocationsExcel}
                    className="hidden"
                  />
                </label>

                <label
                  className="px-2.5 sm:px-3 py-2 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 rounded-xl shadow-md shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-black text-center leading-tight min-w-0"
                  title="رفع واستبدال المسارات كاملة من ملف إكسل (يدعم عمود موقع المحل)"
                >
                  <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>رفع مسارات كاملة</span>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleUploadRoutes}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Guide Note for 'موقع المحل' Excel Column */}
            <div
              className={`p-2.5 rounded-xl border text-[11px] font-bold flex items-start sm:items-center gap-2 min-w-0 ${
                isDarkMode
                  ? 'bg-slate-800/70 border-slate-700 text-slate-300'
                  : 'bg-white border-emerald-200 text-slate-700'
              }`}
            >
              <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
              <span className="min-w-0 break-words leading-relaxed">
                يحتوي ملف التصدير والنموذج على عمود <strong className="text-emerald-700 dark:text-emerald-300 font-black">«موقع المحل»</strong> (يدعم الإحداثيات مثل <span className="font-mono" dir="ltr">34.615800, 43.678600</span> أو أي رابط خرائط كوكل مثل <span className="font-mono break-all" dir="ltr">https://maps.app.goo.gl/...</span> أو عمودي <span className="font-black">خط العرض / خط الطول</span>).
              </span>
            </div>

            {/* Filter & Search inside Excel Manager */}
            <div className="space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { id: 'all' as const, label: `الكل (${excelDelegateFilteredRoutes.length})` },
                    { id: 'mapped' as const, label: `محدد الموقع 📍 (${mappedShopsCount})` },
                    { id: 'unmapped' as const, label: `بدون موقع (${unmappedShopsCount})` },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setExcelLocFilter(opt.id);
                        setExcelDisplayLimit(30);
                      }}
                      className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] font-black border transition-all cursor-pointer ${
                        excelLocFilter === opt.id
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : isDarkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px] sm:max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={excelSearch}
                    onChange={(e) => {
                      setExcelSearch(e.target.value);
                      setExcelDisplayLimit(30);
                    }}
                    placeholder="بحث سريع داخل جدول المواقع..."
                    className={`w-full pr-8 pl-3 py-1.5 rounded-xl border text-xs font-bold ${
                      isDarkMode
                        ? 'bg-slate-900 border-slate-700 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              {/* Delegate Filter inside Excel Manager (تحت فلتر الكل ومحدد الموقع) */}
              {excelDelegateOptions.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-emerald-200/70 dark:border-slate-700/70">
                  <span className="inline-flex items-center gap-1 text-[11px] font-black text-slate-600 dark:text-slate-300 ml-1 shrink-0">
                    <User className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>المندوب:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setExcelDelegateFilter('');
                      setExcelDisplayLimit(30);
                    }}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition-all cursor-pointer whitespace-nowrap ${
                      !excelDelegateFilter
                        ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    كل المندوبين ({filteredRoutes.length})
                  </button>
                  {excelDelegateOptions.map((del) => {
                    const isSelected = normalizeArabic(excelDelegateFilter) === normalizeArabic(del.name);
                    return (
                      <button
                        key={del.name}
                        type="button"
                        onClick={() => {
                          setExcelDelegateFilter(isSelected ? '' : del.name);
                          setExcelDisplayLimit(30);
                        }}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition-all cursor-pointer whitespace-nowrap ${
                          isSelected
                            ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                            : isDarkMode
                            ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {del.name} ({del.count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Shop Information & Location Table (أمام كل محل) */}
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-[11px] sm:text-xs text-right">
                <thead
                  className={`sticky top-0 z-10 font-black ${
                    isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <tr>
                    <th className="px-2.5 py-2.5 border-b dark:border-slate-700 whitespace-nowrap">#</th>
                    <th className="px-2.5 py-2.5 border-b dark:border-slate-700 whitespace-nowrap">كود الزبون</th>
                    <th className="px-2.5 py-2.5 border-b dark:border-slate-700 min-w-[140px]">اسم المحل والهاتف</th>
                    <th className="px-2.5 py-2.5 border-b dark:border-slate-700 min-w-[120px]">العنوان</th>
                    <th className="px-2.5 py-2.5 border-b dark:border-slate-700 whitespace-nowrap">المسار / النوع</th>
                    <th className="px-2.5 py-2.5 border-b dark:border-slate-700 whitespace-nowrap">المندوب</th>
                    <th className="px-2.5 py-2.5 border-b dark:border-slate-700 min-w-[210px]">موقع المحل (GPS)</th>
                  </tr>
                </thead>
                <tbody
                  className={`divide-y ${
                    isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-200' : 'divide-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {visibleExcelRoutes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500 font-bold">
                        لا توجد محلات مطابقة للعرض الحالي.
                      </td>
                    </tr>
                  ) : (
                    visibleExcelRoutes.map((r, idx) => {
                      const phone = getCustomerPhone(r);
                      const locString = r.shopLocation || formatShopLocationString(r.latitude, r.longitude);
                      const isEditing = editingLocationRouteId === r.id;

                      return (
                        <tr
                          key={r.id || `${r.customerCode}_${idx}`}
                          className={`transition-colors ${
                            isDarkMode ? 'hover:bg-slate-800/70' : 'hover:bg-emerald-50/40'
                          }`}
                        >
                          <td className="px-2.5 py-2 font-mono text-[10px] text-slate-500">{idx + 1}</td>
                          <td className="px-2.5 py-2 font-mono font-bold whitespace-nowrap">{r.customerCode}</td>
                          <td className="px-2.5 py-2">
                            <div className="font-black text-slate-900 dark:text-white">{r.customerName}</div>
                            {phone && (
                              <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400" dir="ltr">
                                {phone}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-2 text-slate-600 dark:text-slate-300 max-w-[160px] truncate" title={r.customerAddress}>
                            {r.customerAddress || '-'}
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap">
                            <span className="font-bold">{getEffectiveRouteDay(r)}</span>
                            <span className="mx-1 text-slate-400">•</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold">
                              {r.customerType}
                            </span>
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap font-bold">{r.delegateName || '-'}</td>
                          <td className="px-2.5 py-2">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  dir="ltr"
                                  value={editingLocationInput}
                                  onChange={(e) => setEditingLocationInput(e.target.value)}
                                  placeholder="إحداثيات أو رابط خرائط"
                                  className={`w-36 px-2 py-1 rounded-lg border text-[11px] font-mono ${
                                    isDarkMode
                                      ? 'bg-slate-800 border-emerald-500 text-white'
                                      : 'bg-white border-emerald-500 text-slate-900'
                                  }`}
                                />
                                <button
                                  type="button"
                                  disabled={isSavingInlineLocation}
                                  onClick={() => handleSaveInlineLocation(r)}
                                  className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50"
                                  title="حفظ الموقع"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingLocationRouteId(null);
                                    setEditingLocationInput('');
                                  }}
                                  className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                                  title="إلغاء"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : confirmDeleteLocationRouteId === r.id ? (
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <span className="text-[10px] font-black text-rose-600 dark:text-rose-400 whitespace-nowrap">
                                  حذف الموقع؟
                                </span>
                                <button
                                  type="button"
                                  disabled={deletingLocationRouteId === r.id}
                                  onClick={() => handleDeleteInlineLocation(r)}
                                  className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[10px] font-black cursor-pointer inline-flex items-center gap-1"
                                  title="تأكيد حذف موقع المحل"
                                >
                                  {deletingLocationRouteId === r.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3 h-3" />
                                  )}
                                  <span>تأكيد</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={deletingLocationRouteId === r.id}
                                  onClick={() => setConfirmDeleteLocationRouteId(null)}
                                  className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-[10px] font-bold cursor-pointer"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-1.5">
                                {locString ? (
                                  <div className="inline-flex items-center gap-1 min-w-0">
                                    <span
                                      dir="ltr"
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono text-[10px] font-black select-all"
                                      title="إحداثيات موقع المحل"
                                    >
                                      <MapPin className="w-3 h-3 shrink-0" />
                                      <span>{locString}</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyCoords(`route_${r.id}`, locString)}
                                      className="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer shrink-0"
                                      title="نسخ الإحداثيات"
                                    >
                                      {copiedCoordKey === `route_${r.id}` ? (
                                        <Check className="w-3 h-3 text-emerald-600" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-bold">
                                    غير محدد
                                  </span>
                                )}

                                <div className="flex items-center gap-0.5 shrink-0">
                                  {(locString || r.repLocationSaved) && isStrictAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteLocationRouteId(r.id)}
                                      className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-500 hover:text-rose-700 dark:text-rose-400 cursor-pointer shrink-0 transition-colors"
                                      title="حذف موقع المحل وإتاحة إضافته للمندوب من جديد"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDeleteLocationRouteId(null);
                                      setEditingLocationRouteId(r.id);
                                      setEditingLocationInput(locString);
                                    }}
                                    className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 cursor-pointer shrink-0"
                                    title="إضافة أو تعديل موقع المحل يدوياً"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {excelTableRoutes.length > excelDisplayLimit && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExcelDisplayLimit((prev) => prev + 40)}
                  className="flex-1 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 font-black text-xs transition-colors cursor-pointer"
                >
                  عرض المزيد ({excelTableRoutes.length - excelDisplayLimit} محل متبقي)
                </button>
                <button
                  type="button"
                  onClick={() => setExcelDisplayLimit(excelTableRoutes.length)}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-black text-xs transition-colors cursor-pointer whitespace-nowrap"
                >
                  عرض الكل ({excelTableRoutes.length})
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* New Section at the Bottom of Routes Page: Representative Saved Shop Locations (موقع المحل) */}
      <div
        className={`mt-6 p-4 sm:p-5 rounded-2xl border shadow-md space-y-4 ${
          isDarkMode
            ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-teal-800/60'
            : 'bg-gradient-to-br from-teal-50/80 via-white to-slate-50 border-teal-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-teal-100 dark:border-slate-700/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-teal-600 text-white shadow-md shadow-teal-600/30 shrink-0">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                <span>مواقع المحلات المحفوظة (موقع المحل)</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-teal-600 text-white shadow-xs">
                  {isPrivilegedShopLocsViewer
                    ? `جميع المواقع (${visibleShopLocations.length})`
                    : `محلاتي فقط (${visibleShopLocations.length})`}
                </span>
                {isPrivilegedShopLocsViewer && visibleShopLocations.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportShopLocationsExcel}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-black bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-xs cursor-pointer transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    <span>تصدير Excel</span>
                  </button>
                )}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                {isPrivilegedShopLocsViewer
                  ? 'جميع مواقع المحلات التي حددها المندوبون عبر نافذة «إجراء على المحل».'
                  : 'مواقع محلاتك المحفوظة فقط عبر نافذة «إجراء على المحل».'}
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
            {isPrivilegedShopLocsViewer && (
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-initial min-w-[185px]">
                  <Users className="absolute right-2.5 top-2 w-4 h-4 text-teal-600 dark:text-teal-400 pointer-events-none" />
                  <select
                    value={shopLocationsDelegateFilter}
                    onChange={(e) => setShopLocationsDelegateFilter(e.target.value)}
                    aria-label="فلتر باسم المندوب"
                    className={`w-full pr-8 pl-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                      shopLocationsDelegateFilter
                        ? 'border-teal-500 ring-1 ring-teal-500/30 '
                        : ''
                    }${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  >
                    <option value="">فلتر المندوب: جميع المناديب ({savedShopLocations.length})</option>
                    {shopLocationsDelegateOptions.map((del) => (
                      <option key={del.name} value={del.name}>
                        {del.name} ({del.count})
                      </option>
                    ))}
                  </select>
                </div>
                {shopLocationsDelegateFilter && (
                  <button
                    type="button"
                    onClick={() => setShopLocationsDelegateFilter('')}
                    className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 cursor-pointer shrink-0"
                    title="إلغاء فلتر المندوب"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <div className="w-full sm:w-64 relative">
              <Search className="absolute right-3 top-2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={shopLocationsSearchQuery}
                onChange={(e) => setShopLocationsSearchQuery(e.target.value)}
                placeholder="بحث باسم المحل، الكود، المندوب..."
                className={`w-full pr-9 pl-3 py-1.5 rounded-xl border text-xs font-bold ${
                  isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Delegate Name Filter Bar */}
        {isPrivilegedShopLocsViewer && shopLocationsDelegateOptions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1 ml-1">
              <User className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>تصفية حسب المندوب:</span>
            </span>
            <button
              type="button"
              onClick={() => setShopLocationsDelegateFilter('')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-colors cursor-pointer ${
                shopLocationsDelegateFilter === ''
                  ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                  : isDarkMode
                  ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              جميع المناديب ({savedShopLocations.length})
            </button>
            {shopLocationsDelegateOptions.map((del) => {
              const isSelected = normalizeArabic(shopLocationsDelegateFilter) === normalizeArabic(del.name);
              return (
                <button
                  key={del.name}
                  type="button"
                  onClick={() => setShopLocationsDelegateFilter(isSelected ? '' : del.name)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                      : isDarkMode
                      ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {del.name} ({del.count})
                </button>
              );
            })}
          </div>
        )}

        {visibleShopLocations.length === 0 ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400 font-bold text-xs bg-white/40 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
            لا توجد مواقع محلات محفوظة مطابقة للعرض الحالي.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto rounded-xl border border-teal-200/80 dark:border-slate-700 shadow-xs">
            <table className="w-full table-auto text-[11px] sm:text-xs text-right">
              <thead
                className={`sticky top-0 z-10 font-black ${
                  isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-teal-50 text-slate-800'
                }`}
              >
                <tr>
                  <th className="px-2 py-2 border-b border-teal-200/70 dark:border-slate-700">المحل والكود</th>
                  <th className="px-2 py-2 border-b border-teal-200/70 dark:border-slate-700">المندوب والمسار</th>
                  <th className="px-2 py-2 border-b border-teal-200/70 dark:border-slate-700">موقع المحل (GPS)</th>
                  <th className="px-2 py-2 border-b border-teal-200/70 dark:border-slate-700 hidden sm:table-cell">تاريخ الحفظ</th>
                  {isAdminUser && (
                    <th className="px-2 py-2 border-b border-teal-200/70 dark:border-slate-700 text-center w-[88px]">إجراء</th>
                  )}
                </tr>
              </thead>
              <tbody
                className={`divide-y ${
                  isDarkMode ? 'divide-slate-800 bg-slate-900 text-slate-200' : 'divide-slate-200 bg-white text-slate-800'
                }`}
              >
                {visibleShopLocations.map((rec, idx) => {
                  const coordsText = rec.shopLocation || formatShopLocationString(rec.latitude, rec.longitude);
                  const isConfirmingDelete = confirmDeleteShopLocId === rec.id;

                  return (
                    <tr
                      key={rec.id}
                      className={`transition-colors align-top ${
                        isDarkMode ? 'hover:bg-slate-800/70' : 'hover:bg-teal-50/40'
                      }`}
                    >
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-mono text-[10px] text-slate-400">{idx + 1}.</span>
                          <MapPin className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                          <span className="font-black text-slate-900 dark:text-white leading-tight">{rec.customerName}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30">
                            محفوظ ✓
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[10px] text-slate-500 dark:text-slate-400">
                          <span className="font-mono font-bold">كود: {rec.customerCode || '-'}</span>
                          {rec.customerAddress && (
                            <span className="truncate max-w-[200px]" title={rec.customerAddress}>
                              • {rec.customerAddress}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          <User className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-bold text-slate-800 dark:text-slate-200">{rec.savedBy || rec.delegateName || '-'}</span>
                          {typeof rec.accuracyMeters === 'number' && (
                            <span className="text-[9.5px] font-mono px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              ±{rec.accuracyMeters}م
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 flex-wrap text-[10px] text-slate-600 dark:text-slate-400">
                          <span className="font-bold">{rec.path || '-'}</span>
                          {rec.customerType && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold text-slate-600 dark:text-slate-300">
                              {rec.customerType}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span
                            dir="ltr"
                            className="inline-flex items-center px-1.5 py-0.5 rounded-lg bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/30 font-mono text-[10px] font-black select-all"
                          >
                            {coordsText}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyCoords(`saved_${rec.id}`, coordsText)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-black shrink-0 transition-colors cursor-pointer"
                            title="نسخ إحداثيات موقع المحل"
                          >
                            {copiedCoordKey === `saved_${rec.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedCoordKey === `saved_${rec.id}` ? 'تم' : 'نسخ'}</span>
                          </button>
                        </div>
                        <div className="sm:hidden mt-1 text-[9.5px] text-slate-400 font-mono" dir="ltr">
                          {formatEnglishDateTime(rec.savedAt || rec.timestamp, rec.dateString)}
                        </div>
                      </td>

                      <td className="px-2 py-2 hidden sm:table-cell">
                        <div className="flex flex-col">
                          <span dir="ltr" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono text-right">
                            {formatEnglishDateTime(rec.savedAt || rec.timestamp, rec.dateString)}
                          </span>
                          {rec.updatedAt && (
                            <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">
                              عُدّل: <span dir="ltr" className="font-mono">{formatEnglishDateTime(rec.updatedAt)}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {isAdminUser && (
                        <td className="px-2 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const matchedRoute =
                                  routes.find(
                                    (mr) =>
                                      mr.id === rec.routeId ||
                                      (rec.customerCode &&
                                        normalizeLocationCode(mr.customerCode) === normalizeLocationCode(rec.customerCode))
                                  ) ||
                                  ({
                                    id: rec.routeId || rec.id,
                                    customerCode: rec.customerCode || '',
                                    customerName: rec.customerName,
                                    customerAddress: rec.customerAddress || '',
                                    customerType: rec.customerType || 'مفرد',
                                    path: rec.path || '',
                                    delegateName: rec.delegateName || '',
                                    delegateCode: rec.delegateCode || '',
                                    latitude: rec.latitude,
                                    longitude: rec.longitude,
                                    repLocationSaved: true,
                                  } as RouteItem);
                                handleProceedToShopLocation(matchedRoute, rec);
                              }}
                              className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-black transition-colors cursor-pointer"
                              title="تعديل إحداثيات موقع المحل"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>تعديل</span>
                            </button>

                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSavedShopLocation(rec)}
                                  className="px-1.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black cursor-pointer"
                                >
                                  تأكيد
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteShopLocId(null)}
                                  className="px-1.5 py-1 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold cursor-pointer"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteShopLocId(rec.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded-lg cursor-pointer"
                                title="حذف الموقع لإتاحة إعادة التحديد للمندوب"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Section at End of Routes Page: New Customer Definition Requests (تعريف جديد) */}
      <NewCustomerDefinitionsSection
        definitions={newCustomerDefinitions}
        isAdminViewer={Boolean((currentUser?.isAdmin || isDataEntry) && currentUser?.role !== 'delegate')}
        isStrictAdmin={isStrictAdmin}
        currentDelegateName={currentUser?.name || currentUser?.delegateName || ''}
        currentDelegateCode={effectiveDelegateCode}
        currentUsername={currentUser?.username}
        isDarkMode={isDarkMode}
        onNotify={(title, message, type) => addToast?.({ title, message, type: type || 'info' })}
      />

      {/* New Customer Definition Modal (تعريف جديد) */}
      <NewCustomerDefinitionModal
        isOpen={showNewCustomerDefModal}
        onClose={() => setShowNewCustomerDefModal(false)}
        currentUser={currentUser}
        effectiveDelegateCode={effectiveDelegateCode}
        isDarkMode={isDarkMode}
        onSuccess={(rec) => {
          addToast?.({
            title: 'تم إرسال تعريف المحل الجديد ✅',
            message: `تم إرسال بيانات (${rec.shopSignName}) بنجاح إلى الأدمن.`,
            type: 'success',
            delegateName: rec.delegateName,
          });
        }}
      />

      {/* Unsuccessful Visits & Red Unvisited Shops Section at End of Routes Page (خاص بالأدمن فقط - يضم الفقرتين معاً) */}
      {isStrictAdmin && (
        <UnsuccessfulVisitsSection
          visits={unsuccessfulVisits}
          onDeleteVisit={handleDeleteUnsuccessfulVisit}
          todayDateString={baghdadStatus.todayBaghdad || new Date().toISOString().split('T')[0]}
          todayRouteDayName={routeDayInfo.todayDayName}
          formattedClosingTime={formattedTargetTime}
          isPastClosing={Boolean(baghdadStatus.isPastClosing)}
          completedDelegatesCount={completedDelegatesCountToday}
          todayLiveRedShops={todayLiveRedShops}
          savedRedSnapshots={dailyUnvisitedSnapshots}
          onDeleteRedShopRow={handleDeleteUnvisitedShopRow}
          onDeleteRedDaySnapshot={handleDeleteUnvisitedDaySnapshot}
          isDarkMode={isDarkMode}
          onNotify={(title, message, type) => addToast?.({ title, message, type: type || 'info' })}
        />
      )}

      {/* Customer Visit Modal (عند النقر على زيارة في الخريطة) */}
      <CustomerVisitModal
        isOpen={Boolean(customerVisitModalRoute)}
        onClose={() => setCustomerVisitModalRoute(null)}
        route={customerVisitModalRoute}
        onSelectCreateInvoice={(route) => {
          handleDirectCreateInvoiceFromMap(route);
        }}
        onSelectUnsuccessfulVisit={(route) => {
          setUnsuccessfulVisitTargetRoute(route);
        }}
        isDarkMode={isDarkMode}
      />

      {/* Unsuccessful Visit Modal (التقاط صورة للبراد وذكر السبب) */}
      <UnsuccessfulVisitModal
        isOpen={Boolean(unsuccessfulVisitTargetRoute)}
        onClose={() => setUnsuccessfulVisitTargetRoute(null)}
        route={unsuccessfulVisitTargetRoute}
        currentUser={currentUser}
        effectiveDelegateCode={effectiveDelegateCode}
        isDarkMode={isDarkMode}
        onSuccess={(rec) => {
          setUnsuccessfulVisits((prev) => [rec, ...prev.filter((v) => v.id !== rec.id)]);
        }}
        onNotify={(title, message, type) => addToast?.({ title, message, type: type || 'info' })}
      />

      {/* Choice Modal (Step 1) */}
      {actionModalRoute && actionModalStep === 'choice' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => { setActionModalRoute(null); setActionModalStep(null); }}
          dir="rtl"
        >
          <div
            className={`w-full max-w-sm rounded-2xl p-5 sm:p-6 shadow-2xl border text-right space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">إجراء على المحل</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">{actionModalRoute.customerName} ({actionModalRoute.customerCode})</p>
                </div>
              </div>
              <button
                onClick={() => { setActionModalRoute(null); setActionModalStep(null); }}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const cCode = String(actionModalRoute.customerCode ?? '').trim();
              const delName = actionModalRoute.delegateName || currentUser?.name || currentUser?.delegateName || '';
              const normDel = normalizeArabic(delName);
              const customTimerInfo = delegateCustomTimes[delName] || delegateCustomTimes[normDel];

              const hasDebt = customerDebtsSet.has(cCode);
              const isUnlockedForOrder = Boolean(
                unlockedCustomerCodes[cCode] ||
                unlockedCustomerCodes[normalizeArabic(actionModalRoute.customerName)] ||
                unlockedCustomerCodes[actionModalRoute.customerName]
              );
              const isPrivilegedUser = Boolean(currentUser?.isAdmin || isDataEntry);

              let isSalesClosedByTime = Boolean(baghdadStatus?.isPastClosing);
              let isSalesCompleted = Boolean(
                completedDelegates[delName] ||
                completedDelegates[normDel] ||
                isDelegateCompletedToday(actionModalRoute.delegateName, actionModalRoute.delegateCode)
              );

              let hasActiveCustomExtension = false;
              let customLockTimeFormatted = '';

              if (customTimerInfo && customTimerInfo.active) {
                if (customTimerInfo.expireAtTimestamp) {
                  const nowMs = Date.now();
                  if (nowMs < customTimerInfo.expireAtTimestamp) {
                    isSalesClosedByTime = false;
                    isSalesCompleted = false;
                    hasActiveCustomExtension = true;
                    const remainingMs = customTimerInfo.expireAtTimestamp - nowMs;
                    const remainingMins = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));
                    customLockTimeFormatted = `${remainingMins} دقيقة (${formatTo12HourArabic(customTimerInfo.customTime)})`;
                  } else {
                    isSalesClosedByTime = true;
                  }
                } else if (customTimerInfo.customTime) {
                  const now = new Date();
                  const timeFormatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Baghdad',
                    hour12: false,
                    hour: 'numeric',
                    minute: 'numeric',
                    second: 'numeric',
                  });
                  const parts = timeFormatter.formatToParts(now);
                  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
                  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
                  const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);
                  const currentSeconds = hour * 3600 + minute * 60 + second;

                  const [hStr, mStr] = customTimerInfo.customTime.split(':');
                  const targetHours = parseInt(hStr || '21', 10);
                  const targetMinutes = parseInt(mStr || '00', 10);
                  const targetSeconds = targetHours * 3600 + targetMinutes * 60;

                  if (currentSeconds < targetSeconds) {
                    isSalesClosedByTime = false;
                    isSalesCompleted = false;
                    hasActiveCustomExtension = true;
                    customLockTimeFormatted = formatTo12HourArabic(customTimerInfo.customTime);
                  } else {
                    isSalesClosedByTime = true;
                  }
                }
              }

              const isDebtLocked = hasDebt && !isUnlockedForOrder;

              let disabledReason = '';
              if (isDebtLocked) {
                disabledReason = 'مغلق لوجود دين مستحق على المحل';
              } else if (isSalesCompleted) {
                disabledReason = 'تم إكمال مبيعات اليوم لهذا المندوب';
              } else if (isSalesClosedByTime) {
                disabledReason = 'انتهى وقت المبيعات المتاحة لهذا اليوم';
              }

              const isNewOrderDisabled = !isPrivilegedUser && Boolean(disabledReason);

              // Check whether shop already has saved map coordinates (hydrating from routes + savedShopLocations)
              const savedLocForModal = getSavedLocationForRoute(actionModalRoute);
              const matchedEnrichedRoute = enrichedRoutes.find(
                (er) =>
                  er.id === actionModalRoute.id ||
                  (actionModalRoute.customerCode &&
                    String(er.customerCode || '').trim() === String(actionModalRoute.customerCode).trim())
              );
              const resolvedModalRoute = matchedEnrichedRoute || actionModalRoute;
              const { latitude: shopLat, longitude: shopLng } = resolveRouteCoordinatesWithCache(
                resolvedModalRoute,
                cachedShopCoordsMap
              );
              const effectiveShopLat = shopLat ?? (savedLocForModal ? savedLocForModal.latitude : null);
              const effectiveShopLng = shopLng ?? (savedLocForModal ? savedLocForModal.longitude : null);
              const hasShopCoordinates = effectiveShopLat !== null && effectiveShopLng !== null;
              const isShopLocationSavedPermanently = Boolean(
                savedLocForModal || resolvedModalRoute.repLocationSaved || hasShopCoordinates
              );

              const currentDistanceMeters =
                hasShopCoordinates && repLiveCoords && effectiveShopLat !== null && effectiveShopLng !== null
                  ? Math.round(
                      calculateHaversineDistanceMeters(
                        repLiveCoords.latitude,
                        repLiveCoords.longitude,
                        effectiveShopLat,
                        effectiveShopLng
                      )
                    )
                  : null;
              const isWithinGeofence =
                hasShopCoordinates &&
                currentDistanceMeters !== null &&
                currentDistanceMeters <= geofenceRadiusMeters;
              const isWithinGeofenceOrNoCoords =
                isPrivilegedUser || !hasShopCoordinates || isWithinGeofence;
              const isGeofenceBlocked = !isWithinGeofenceOrNoCoords;

              // For Admin: ALWAYS keep all options ("1- طلب جديد", "2- معلومات اخرى", "3- موقع المحل") visible in Shop Action Modal
              // For Reps: hide "1- طلب جديد" & "3- موقع المحل" when shop already has saved/pinned map coordinates
              const shouldShowNewOrderSectionInModal = isAdminUser || !hasShopCoordinates;
              const shouldShowCreateInvoiceButton =
                shouldShowNewOrderSectionInModal &&
                !isDebtLocked &&
                (isPrivilegedUser || (!isSalesCompleted && !isSalesClosedByTime && !isGeofenceBlocked && !isNewOrderDisabled));

              return (
                <div className="space-y-3 pt-1">
                  {/* Custom Extension Info Badge inside Shop Action Modal */}
                  {shouldShowNewOrderSectionInModal && hasActiveCustomExtension && !isSalesClosedByTime && (
                    <div className="w-full p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700/80 text-amber-900 dark:text-amber-300 text-xs font-black flex items-center justify-between gap-2 shadow-xs">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>مفتوح وإنشاء الفواتير متاح حتى:</span>
                      </div>
                      <span className="font-mono text-xs bg-amber-200/80 dark:bg-amber-900 px-2 py-0.5 rounded-md border border-amber-400/50 text-amber-950 dark:text-amber-200 font-black">
                        {customLockTimeFormatted}
                      </span>
                    </div>
                  )}

                  {shouldShowNewOrderSectionInModal && !isPrivilegedUser && !isSalesCompleted && !isSalesClosedByTime && (
                    <div className="w-full px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-bold flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>لا توجد إحداثيات موقع مسجلة لهذا المحل — إنشاء الفاتورة متاح</span>
                    </div>
                  )}

                  {/* Create Invoice Button - Shown always for Admin, and for Reps when shop has no location on the map */}
                  {shouldShowCreateInvoiceButton && (
                    <button
                      type="button"
                      onClick={() => handleProceedToNewOrder(actionModalRoute)}
                      className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white rounded-xl font-black text-sm shadow-md shadow-emerald-600/20 flex items-center justify-between transition-all cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <ShoppingBag className="w-5 h-5" />
                        <span>إنشاء فاتورة</span>
                      </span>
                      <span className="text-[11px] bg-emerald-700/60 px-2.5 py-1 rounded-lg font-bold">طلب فاتورة</span>
                    </button>
                  )}

                  {shouldShowNewOrderSectionInModal && isNewOrderDisabled && (!isSalesCompleted && !isSalesClosedByTime) && (
                    <div className="w-full p-4 bg-slate-100 dark:bg-slate-800/80 text-slate-400 rounded-xl font-bold text-xs flex flex-col gap-2 border border-slate-200 dark:border-slate-700/80">
                      <div className="flex items-center justify-between w-full">
                        <span className="flex items-center gap-2 font-black text-slate-500 dark:text-slate-400 text-sm">
                          <ShoppingBag className="w-5 h-5 text-slate-400" />
                          <span>إنشاء فاتورة</span>
                        </span>
                        <span className="text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-400 px-2 py-0.5 rounded-md font-black border border-rose-500/30">
                          غير متاح
                        </span>
                      </div>
                      <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/40 p-2 rounded-lg border border-rose-200 dark:border-rose-900/50">
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                        <span>{disabledReason}</span>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleProceedToOtherInfo}
                    className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white rounded-xl font-black text-sm shadow-md shadow-blue-600/20 flex items-center justify-between transition-all cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      <span>ملاحظات</span>
                    </span>
                    <span className="text-[11px] bg-blue-700/60 px-2.5 py-1 rounded-lg font-bold">تسجيل ملاحظة</span>
                  </button>

                  {(() => {
                    if (!isStrictAdmin && isShopLocationSavedPermanently) return null;
                    const isEditingExistingLoc = Boolean(isShopLocationSavedPermanently);
                    return (
                      <button
                        type="button"
                        onClick={() => handleProceedToShopLocation(resolvedModalRoute, savedLocForModal)}
                        className="w-full py-3.5 px-4 bg-teal-600 hover:bg-teal-500 active:scale-98 text-white rounded-xl font-black text-sm shadow-md shadow-teal-600/20 flex items-center justify-between transition-all cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <MapPin className="w-5 h-5" />
                          <span>3- موقع المحل</span>
                        </span>
                        <span className="text-[11px] bg-teal-700/60 px-2.5 py-1 rounded-lg font-bold">
                          {isEditingExistingLoc ? 'تعديل وحفظ الموقع' : 'تحديد وحفظ الموقع'}
                        </span>
                      </button>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Other Info Modal (Step 2) */}
      {actionModalRoute && actionModalStep === 'other_info' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => { setActionModalRoute(null); setActionModalStep(null); }}
          dir="rtl"
        >
          <div
            className={`w-full max-w-xl rounded-2xl p-5 sm:p-6 shadow-2xl border text-right space-y-4 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">ملاحظات - {actionModalRoute.customerName}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">كود: {actionModalRoute.customerCode} {actionModalRoute.customerAddress ? `| ${actionModalRoute.customerAddress}` : ''}</p>
                </div>
              </div>
              <button
                onClick={() => { setActionModalRoute(null); setActionModalStep(null); }}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Grid layout for Preset Options & Notes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Preset Options List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-slate-700 dark:text-slate-300">
                    اختر من القائمة التالية:
                  </label>
                  {(currentUser?.isAdmin || isDataEntry) && (
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                      تحكم الأدمن
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 max-h-[220px] overflow-y-auto p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  {availableOptions.map((opt) => {
                    const isSelected = selectedOption === opt;
                    const isPrivileged = Boolean(currentUser?.isAdmin || isDataEntry);

                    return (
                      <div key={opt} className="flex items-center gap-1 group">
                        <button
                          type="button"
                          onClick={() => setSelectedOption(opt)}
                          className={`flex-1 text-right p-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 text-white shadow-xs font-black ring-2 ring-blue-400/50'
                              : isDarkMode
                              ? 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                              : 'bg-white text-slate-800 hover:bg-slate-100 border border-slate-200'
                          }`}
                        >
                          <span>{opt}</span>
                          {isSelected && <CheckCircle2 className="w-4 h-4 shrink-0 text-white" />}
                        </button>

                        {isPrivileged && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomOption(opt);
                            }}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer shrink-0"
                            title={`حذف الخيار "${opt}" من القائمة`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Admin Add New Option Form */}
                {(currentUser?.isAdmin || isDataEntry) && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={newOptionInput}
                      onChange={(e) => setNewOptionInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomOption();
                        }
                      }}
                      placeholder="إضافة خيار جديد للقائمة..."
                      className={`flex-1 p-2 rounded-xl border text-xs font-bold ${
                        isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomOption}
                      className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-black shrink-0 transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                      title="إضافة الخيار الجديد إلى القائمة"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>إضافة</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Freeform Notes Section */}
              <div className="space-y-2 flex flex-col justify-between">
                <div>
                  <label className="block text-xs font-black text-slate-700 dark:text-slate-300 mb-1">
                    فقرة ملاحظات:
                  </label>
                  <textarea
                    rows={7}
                    value={otherInfoNotesInput}
                    onChange={(e) => setOtherInfoNotesInput(e.target.value)}
                    placeholder="اكتب تفاصيل أو ملاحظات المندوب حول هذا المحل..."
                    className={`w-full p-3 rounded-xl border text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                  تظهر هذه الملاحظات في أسفل صفحة المسارات للمندوب وللأدمن.
                </p>
              </div>
            </div>

            {/* Modal Buttons */}
            <div className="flex items-center gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={isSubmittingNote}
                onClick={() => setActionModalStep('choice')}
                className={`px-4 py-2.5 rounded-xl font-bold text-xs border transition-all active:scale-95 cursor-pointer ${
                  isDarkMode ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                رجوع
              </button>

              <button
                type="button"
                disabled={isSubmittingNote}
                onClick={handleSubmitOtherInfo}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-50 text-white rounded-xl font-black text-xs sm:text-sm shadow-md shadow-blue-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                {isSubmittingNote ? (
                  <span>جاري الإرسال...</span>
                ) : (
                  <>
                    <Send className="w-4 h-4 shrink-0" />
                    <span>إرسال</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shop Location One-Time Capture Modal (Step 3) */}
      {actionModalRoute && actionModalStep === 'shop_location' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => {
            if (!isSavingShopLocationOnce) {
              setActionModalRoute(null);
              setActionModalStep(null);
            }
          }}
          dir="rtl"
        >
          <div
            className={`w-full max-w-md rounded-2xl p-5 sm:p-6 shadow-2xl border text-right space-y-4 animate-in zoom-in-95 duration-200 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">
                    موقع المحل - {actionModalRoute.customerName}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                    كود: {actionModalRoute.customerCode} {actionModalRoute.customerAddress ? `| ${actionModalRoute.customerAddress}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingShopLocationOnce) {
                    setActionModalRoute(null);
                    setActionModalStep(null);
                  }
                }}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* GPS Detection Card */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-teal-50/70 border-teal-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-teal-700 dark:text-teal-300 flex items-center gap-1.5">
                  <Crosshair className={`w-4 h-4 ${isCapturingGps ? 'animate-spin' : ''}`} />
                  <span>إحداثيات الموقع الحالي (GPS):</span>
                </span>

                <button
                  type="button"
                  disabled={isCapturingGps || isSavingShopLocationOnce}
                  onClick={captureShopLocationGps}
                  className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-[11px] font-black cursor-pointer flex items-center gap-1"
                >
                  {isCapturingGps ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>جاري التحديد...</span>
                    </>
                  ) : (
                    <>
                      <Navigation className="w-3.5 h-3.5" />
                      <span>تحديث GPS</span>
                    </>
                  )}
                </button>
              </div>

              {capturedLatLng ? (
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-700 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span dir="ltr" className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-400">
                      {capturedLatLng.lat.toFixed(6)}, {capturedLatLng.lng.toFixed(6)}
                    </span>
                    <a
                      href={`https://www.google.com/maps?q=${capturedLatLng.lat},${capturedLatLng.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>معاينة</span>
                    </a>
                  </div>
                  {typeof capturedLatLng.accuracy === 'number' && (
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      دقة تحديد الموقع: <span className="font-mono text-teal-600 dark:text-teal-400">±{capturedLatLng.accuracy} متر</span>
                    </p>
                  )}
                </div>
              ) : isCapturingGps ? (
                <div className="py-4 text-center text-xs font-bold text-teal-700 dark:text-teal-300 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري التقاط إحداثيات موقع المحل عبر GPS...</span>
                </div>
              ) : (
                <div className="py-3 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                  اضغط «تحديث GPS» لالتقاط موقعك الحالي داخل المحل. (شرط داخل المحل لتحديد الموقع بشكل دقيق)
                </div>
              )}

              {gpsCaptureError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[11px] font-bold leading-relaxed">
                  ⚠️ {gpsCaptureError}
                </div>
              )}
            </div>

            {/* Notice */}
            {isStrictAdmin ? (
              <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-800 dark:text-teal-300 text-[11px] font-bold flex items-start gap-2 leading-relaxed">
                <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-teal-600 dark:text-teal-400" />
                <span>
                  صلاحية الأدمن: يمكنك تعديل وحفظ إحداثيات موقع المحل في أي وقت عبر GPS، وسيتم التحديث فوراً على الخريطة وسجل المواقع.
                </span>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] font-bold flex items-start gap-2 leading-relaxed">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <span>
                  ملاحظة: بعد حفظ وتثبيت موقع المحل سيتم تثبيته على الخريطة والاعتماد عليه بشكل دائم، وستختفي فقرة «3- موقع المحل» تماماً.
                </span>
              </div>
            )}

            {/* Modal Buttons */}
            <div className="flex items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={isSavingShopLocationOnce}
                onClick={() => {
                  setEditingSavedLocationRecord(null);
                  setActionModalStep('choice');
                }}
                className={`px-4 py-2.5 rounded-xl font-bold text-xs border transition-all active:scale-95 cursor-pointer ${
                  isDarkMode ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                رجوع
              </button>

              <button
                type="button"
                disabled={isSavingShopLocationOnce || isResolvingMapsUrl || !capturedLatLng}
                onClick={handleSaveShopLocationOnce}
                className="flex-1 py-2.5 px-4 bg-teal-600 hover:bg-teal-500 active:scale-95 disabled:opacity-50 text-white rounded-xl font-black text-xs sm:text-sm shadow-md shadow-teal-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                {isSavingShopLocationOnce ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري الحفظ...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 shrink-0" />
                    <span>
                      {isStrictAdmin
                        ? editingSavedLocationRecord ||
                          actionModalRoute.repLocationSaved ||
                          (actionModalRoute.latitude && actionModalRoute.longitude)
                          ? 'حفظ تعديل الموقع'
                          : 'حفظ موقع المحل'
                        : 'حفظ موقع المحل نهائياً'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Action & Approval Modal */}
      {isStrictAdmin && actionModalNote && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className={`w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl p-4 sm:p-5 space-y-4 my-auto ${
            actionModalNote.adminActionTaken
              ? isDarkMode
                ? 'bg-emerald-950 border-emerald-700 text-emerald-50'
                : 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : isDarkMode
              ? 'bg-slate-900 border-slate-700 text-white'
              : 'bg-white border-slate-200 text-slate-900'
          }`}>
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/30">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black">
                    اتخاذ إجراء وموافقة على ملاحظة الزبون
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                    الزبون: {actionModalNote.customerName} (كود: {actionModalNote.customerCode})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingAdminAction) {
                    setActionModalNote(null);
                    setActionDetailsInput('');
                  }
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Note Summary Card */}
            <div className={`p-3 rounded-xl border text-xs space-y-1.5 ${
              isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between font-bold text-slate-600 dark:text-slate-300">
                <span>المندوب: {actionModalNote.delegateName}</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-black">
                  {actionModalNote.selectedOption}
                </span>
              </div>
              {actionModalNote.notes && (
                <p className="text-slate-700 dark:text-slate-200 font-bold bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800 leading-relaxed whitespace-pre-wrap">
                  ملاحظة المندوب: {actionModalNote.notes}
                </p>
              )}
            </div>

            {/* Quick Action Presets */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-slate-700 dark:text-slate-300">
                نماذج سريعة للإجراءات (اضغط للاختيار السريع):
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'تم التواصل مع الزبون والاتفاق معه وحل المشكلة',
                  'تمت الموافقة وتجهيز اللوحة الخارجية المطلوبة للمحل',
                  'تم تعديل جدول الزيارات للمحل والتنسيق مع المندوب',
                  'تمت تسوية الحساب والاتفاق على موعد التسديد',
                  'تم فحص الموقع وتحديث بيانات المحل رسمياً'
                ].map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActionDetailsInput(preset)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer text-right ${
                      actionDetailsInput === preset
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : isDarkMode
                        ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                        : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-800'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Details Input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-slate-700 dark:text-slate-300">
                تفاصيل الإجراء المتخذ من الإدارة: <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={4}
                value={actionDetailsInput}
                onChange={(e) => setActionDetailsInput(e.target.value)}
                placeholder="اكتب هنا الإجراء الذي تم اتخاذه بخصوص هذا الزبون (سيظهر للمندوب في أعلى بطاقة الزبون)..."
                className={`w-full p-3 rounded-xl border text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none ${
                  isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                هذه الفقرة تظهر للمندوب في أعلى بطاقة الزبون لتأكيد اتخاذ الإجراء وموافقة الأدمن.
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={isSubmittingAdminAction}
                onClick={() => {
                  setActionModalNote(null);
                  setActionDetailsInput('');
                }}
                className={`px-4 py-2 rounded-xl font-bold text-xs border transition-all cursor-pointer ${
                  isDarkMode ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={isSubmittingAdminAction || !actionDetailsInput.trim()}
                onClick={handleSaveAdminAction}
                className="flex-1 py-2 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white rounded-xl font-black text-xs sm:text-sm shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                {isSubmittingAdminAction ? (
                  <span>جاري حفظ الإجراء...</span>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>اعتماد وحفظ الإجراء المتخذ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Temporary Customer Route Override Modal */}
      {showShiftModal && routeToShift && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => {
            if (!isShiftingRoute) {
              setShowShiftModal(false);
              setRouteToShift(null);
            }
          }}
        >
          <div
            className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden transition-all duration-300 my-auto ${
              isDarkMode
                ? 'bg-slate-900 border-amber-500/30 text-white'
                : 'bg-white border-amber-600/30 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`flex items-center justify-between p-4 sm:p-5 border-b ${
              isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-amber-50/80 border-amber-200'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-xs">
                  <Calendar className="w-5 h-5 animate-bounce" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black tracking-tight">
                    تحويل مسار المحل مؤقتاً (Temporary Route Shift)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                    إعادة توجيه الزبون لمسار آخر لغاية الساعة 9:00 مساءً اليوم
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isShiftingRoute) {
                    setShowShiftModal(false);
                    setRouteToShift(null);
                  }
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-6 space-y-4 text-right">
              {/* Customer Box */}
              <div className={`p-3.5 rounded-2xl border ${
                isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-center justify-between font-black text-sm text-slate-900 dark:text-white">
                  <span>{routeToShift.customerName}</span>
                  <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    {routeToShift.customerCode}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                  📍 {routeToShift.customerAddress} | 👤 المندوب: {routeToShift.delegateName}
                </p>
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-500">المسار الأصلي الحالي:</span>
                  <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                    {routeToShift.originalPath || routeToShift.path}
                  </span>
                </div>
              </div>

              {/* Day Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span>اختر اليوم الجديد لتحويل المسار إليه مؤقتاً:</span>
                </label>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس'].map((day) => {
                    const isSelected = selectedShiftDay === day;
                    const isOriginal = (routeToShift.originalPath || routeToShift.path) === day;

                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedShiftDay(day)}
                        className={`p-3 rounded-2xl border text-xs font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-1 relative ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-md shadow-amber-500/20 ring-2 ring-amber-400/50'
                            : isDarkMode
                            ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                            : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50 shadow-2xs'
                        }`}
                      >
                        <span className="text-sm font-extrabold">{day}</span>
                        {isOriginal && (
                          <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                            isSelected ? 'bg-slate-900/30 text-slate-950' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                          }`}>
                            المسار الأصلي
                          </span>
                        )}
                        {isSelected && (
                          <CheckCircle2 className="w-4 h-4 text-slate-950 absolute top-1.5 left-1.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Expiration Banner */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs font-bold leading-relaxed flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span>تحديث المسار المؤقت:</span>
                  <p className="text-[11px] font-normal opacity-90 mt-0.5">
                    سيظهر الزبون فوراً على شاشة المندوب في يوم (<strong className="font-bold">{selectedShiftDay}</strong>). وينتهي هذا التعيين تلقائياً عند الساعة <strong className="font-bold">9:00 مساءً اليوم</strong> ليعود الزبون لمساره الأصلي دون التأثير على الفواتير المسبقة.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleConfirmRouteShift}
                  disabled={isShiftingRoute}
                  className="flex-1 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {isShiftingRoute ? (
                    <span>جاري حفظ تحويل المسار...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>تأكيد تحويل المسار إلى ({selectedShiftDay})</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowShiftModal(false);
                    setRouteToShift(null);
                  }}
                  disabled={isShiftingRoute}
                  className="px-4 py-3 rounded-2xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition-all cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
