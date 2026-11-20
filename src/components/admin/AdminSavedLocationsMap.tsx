import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { cleanFirestoreData } from '../../lib/firestoreUtils';
import { formatShopLocationString, isShortOrExternalMapsUrl, parseShopLocationString, resolveShopLocationInput, saveCustomerCoordinates } from '../../lib/fleetTrackingService';
import { RouteItem, ShopLocationRecord } from '../../types';
import { formatWithCommas } from '../../utils/numberUtils';
import { formatEnglishDateTime } from '../../utils/dateUtils';
import {
  MapPin,
  Search,
  Crosshair,
  ExternalLink,
  User,
  Navigation,
  Store,
  RefreshCw,
  Edit3,
  Save,
  X,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';

export interface CustomerSalesSummary {
  invoicesCount: number;
  totalWeightKg: number;
  totalQuantity: number;
  lastDate: string;
}

interface AdminSavedLocationsMapProps {
  locations: ShopLocationRecord[];
  salesStatsByCustomer: Map<string, CustomerSalesSummary>;
  isDarkMode?: boolean;
}

const DEFAULT_CENTER: [number, number] = [34.69, 43.90]; // Saladin Governorate
const DEFAULT_ZOOM = 8;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const createSavedLocationPinIcon = (loc: ShopLocationRecord, isSelected: boolean): L.DivIcon => {
  const isWholesale = loc.customerType === 'جملة';
  const pinColor = isSelected ? '#d97706' : isWholesale ? '#4f46e5' : '#0d9488';
  const ringColor = isSelected
    ? 'rgba(217,119,6,0.34)'
    : isWholesale
    ? 'rgba(79,70,229,0.28)'
    : 'rgba(13,148,136,0.28)';
  const labelBg = isSelected ? '#fffbeb' : isWholesale ? '#eef2ff' : '#f0fdfa';
  const labelText = isSelected ? '#92400e' : isWholesale ? '#312e81' : '#115e59';
  const safeName = escapeHtml(loc.customerName || 'محل بدون اسم');

  return L.divIcon({
    className: 'admin-saved-location-pin',
    html: `
      <div dir="rtl" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:pointer;">
        <div style="display:inline-flex;align-items:center;gap:3px;background:${labelBg};color:${labelText};padding:1px 5px;border-radius:6px;font-size:9px;font-weight:900;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.2);border:1.5px solid ${pinColor};margin-bottom:2px;font-family:'Cairo',sans-serif;">
          <span style="max-width:95px;overflow:hidden;text-overflow:ellipsis;">${safeName}</span>
        </div>
        <div style="position:relative;width:20px;height:20px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);background:${pinColor};border:2px solid #ffffff;box-shadow:0 0 0 2.5px ${ringColor}, 0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
          <div style="width:6px;height:6px;border-radius:9999px;background:#ffffff;transform:rotate(45deg);"></div>
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -30],
  });
};

export const AdminSavedLocationsMap: React.FC<AdminSavedLocationsMapProps> = ({
  locations,
  salesStatsByCustomer,
  isDarkMode = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markerByIdRef = useRef<Map<string, L.Marker>>(new Map());
  const hasAutoFittedRef = useRef<boolean>(false);

  const [selectedDelegateFilter, setSelectedDelegateFilter] = useState<string>('الكل');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [editingLoc, setEditingLoc] = useState<ShopLocationRecord | null>(null);
  const [editCoordInput, setEditCoordInput] = useState<string>('');
  const [editCoordError, setEditCoordError] = useState<string | null>(null);
  const [isSavingEditLoc, setIsSavingEditLoc] = useState<boolean>(false);
  const [resolvedEditPreview, setResolvedEditPreview] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isResolvingEditUrl, setIsResolvingEditUrl] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyCoords = (id: string, coordsText: string) => {
    if (!coordsText) return;
    navigator.clipboard?.writeText(coordsText).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  const openEditLocationModal = (loc: ShopLocationRecord) => {
    setEditingLoc(loc);
    setEditCoordInput(loc.shopLocation || formatShopLocationString(loc.latitude, loc.longitude));
    setEditCoordError(null);
    setResolvedEditPreview(null);
    setIsResolvingEditUrl(false);
  };

  useEffect(() => {
    if (!editingLoc) return;
    const syncParsed = parseShopLocationString(editCoordInput);
    if (syncParsed.latitude !== null && syncParsed.longitude !== null) {
      setResolvedEditPreview({ latitude: syncParsed.latitude, longitude: syncParsed.longitude });
      setIsResolvingEditUrl(false);
      return;
    }
    if (!isShortOrExternalMapsUrl(editCoordInput)) {
      setResolvedEditPreview(null);
      setIsResolvingEditUrl(false);
      return;
    }
    let cancelled = false;
    setIsResolvingEditUrl(true);
    const timer = window.setTimeout(async () => {
      const resolved = await resolveShopLocationInput(editCoordInput);
      if (cancelled) return;
      setIsResolvingEditUrl(false);
      if (resolved.latitude !== null && resolved.longitude !== null) {
        setResolvedEditPreview({ latitude: resolved.latitude, longitude: resolved.longitude });
        setEditCoordError(null);
      } else {
        setResolvedEditPreview(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editCoordInput, editingLoc]);

  const handleSaveEditedLocation = async () => {
    if (!editingLoc) return;
    setIsSavingEditLoc(true);
    setEditCoordError(null);

    let parsed = parseShopLocationString(editCoordInput);
    if (parsed.latitude === null || parsed.longitude === null) {
      if (resolvedEditPreview) {
        parsed = resolvedEditPreview;
      } else if (isShortOrExternalMapsUrl(editCoordInput)) {
        const resolved = await resolveShopLocationInput(editCoordInput);
        parsed = { latitude: resolved.latitude, longitude: resolved.longitude };
      }
    }

    if (parsed.latitude === null || parsed.longitude === null) {
      setIsSavingEditLoc(false);
      setEditCoordError('يرجى إدخال إحداثيات صالحة (مثال: 34.615800, 43.678600) أو لصق رابط خرائط كوكل.');
      return;
    }

    const finalLat = Number(parsed.latitude.toFixed(6));
    const finalLng = Number(parsed.longitude.toFixed(6));
    const shopLocation = formatShopLocationString(finalLat, finalLng);

    try {
      const nowIso = new Date().toISOString();
      await setDoc(
        doc(db, 'rep_shop_locations', editingLoc.id),
        cleanFirestoreData({
          latitude: finalLat,
          longitude: finalLng,
          shopLocation,
          updatedAt: nowIso,
          updatedBy: 'الأدمن',
        }),
        { merge: true }
      );

      const routePayload: RouteItem = {
        id: editingLoc.routeId || editingLoc.id,
        customerCode: editingLoc.customerCode || '',
        customerName: editingLoc.customerName,
        customerAddress: editingLoc.customerAddress || '',
        customerType: editingLoc.customerType || 'مفرد',
        path: editingLoc.path || '',
        delegateName: editingLoc.delegateName || '',
        delegateCode: editingLoc.delegateCode || '',
        latitude: finalLat,
        longitude: finalLng,
        repLocationSaved: true,
      };

      await saveCustomerCoordinates(routePayload, finalLat, finalLng, 'الأدمن', {
        repLocationSaved: true,
      });

      const map = mapInstanceRef.current;
      if (map) {
        map.setView([finalLat, finalLng], Math.max(map.getZoom(), 15), { animate: true });
      }
      setSelectedLocationId(editingLoc.id);
      setEditingLoc(null);
      setEditCoordInput('');
    } catch (err: any) {
      console.error('Error updating shop location from admin map:', err);
      setEditCoordError(err?.message || 'حدث خطأ أثناء حفظ تعديل الموقع.');
    } finally {
      setIsSavingEditLoc(false);
    }
  };

  const delegateOptions = useMemo(() => {
    const set = new Set<string>();
    locations.forEach((loc) => {
      const name = (loc.savedBy || loc.delegateName || '').trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [locations]);

  const validLocations = useMemo(() => {
    return locations.filter(
      (loc) =>
        typeof loc.latitude === 'number' &&
        typeof loc.longitude === 'number' &&
        !Number.isNaN(loc.latitude) &&
        !Number.isNaN(loc.longitude) &&
        loc.latitude !== 0 &&
        loc.longitude !== 0
    );
  }, [locations]);

  const filteredLocations = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return validLocations.filter((loc) => {
      const rep = (loc.savedBy || loc.delegateName || '').trim();
      if (selectedDelegateFilter !== 'الكل' && rep !== selectedDelegateFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (loc.customerName || '').toLowerCase().includes(q) ||
        (loc.customerCode || '').toLowerCase().includes(q) ||
        (loc.customerAddress || '').toLowerCase().includes(q) ||
        (loc.path || '').toLowerCase().includes(q) ||
        rep.toLowerCase().includes(q)
      );
    });
  }, [validLocations, selectedDelegateFilter, searchTerm]);

  const getSalesStats = (loc: ShopLocationRecord): CustomerSalesSummary | undefined => {
    const codeKey = (loc.customerCode || '').trim().toLowerCase();
    const nameKey = (loc.customerName || '').trim().toLowerCase();
    if (codeKey && salesStatsByCustomer.has(`code:${codeKey}`)) {
      return salesStatsByCustomer.get(`code:${codeKey}`);
    }
    if (nameKey && salesStatsByCustomer.has(`name:${nameKey}`)) {
      return salesStatsByCustomer.get(`name:${nameKey}`);
    }
    return undefined;
  };

  // Initialize Leaflet map instance
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapInstanceRef.current) return;

    const map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    markersLayerRef.current = markersLayer;

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 180);

    return () => {
      window.clearTimeout(resizeTimer);
      markersLayer.clearLayers();
      markerByIdRef.current.clear();
      map.remove();
      mapInstanceRef.current = null;
      markersLayerRef.current = null;
      hasAutoFittedRef.current = false;
    };
  }, []);

  const fitAllFilteredPins = () => {
    const map = mapInstanceRef.current;
    if (!map || filteredLocations.length === 0) return;

    if (filteredLocations.length === 1) {
      map.setView([filteredLocations[0].latitude, filteredLocations[0].longitude], 15, {
        animate: true,
      });
      return;
    }

    const bounds = L.latLngBounds(
      filteredLocations.map((loc) => [loc.latitude, loc.longitude] as [number, number])
    );
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15, animate: true });
    }
  };

  // Sync markers whenever filtered locations or selection changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    markerByIdRef.current.clear();

    filteredLocations.forEach((loc) => {
      const isSelected = selectedLocationId === loc.id;
      const marker = L.marker([loc.latitude, loc.longitude], {
        icon: createSavedLocationPinIcon(loc, isSelected),
        zIndexOffset: isSelected ? 600 : 100,
      });

      const stats = getSalesStats(loc);
      const repName = loc.savedBy || loc.delegateName || 'غير محدد';
      const coordsStr = loc.shopLocation || formatShopLocationString(loc.latitude, loc.longitude);
      const gmapsUrl = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
      const savedDateDisplay = formatEnglishDateTime(loc.savedAt, loc.dateString || '-', false);

      const popupNode = document.createElement('div');
      popupNode.dir = 'rtl';
      popupNode.style.cssText =
        "font-family:'Cairo',sans-serif;min-width:230px;max-width:290px;text-align:right;line-height:1.55;";
      popupNode.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e2e8f0;">
          <strong style="font-size:13px;color:#0f172a;font-weight:900;">${escapeHtml(loc.customerName || 'محل')}</strong>
          <span style="background:${loc.customerType === 'جملة' ? '#eef2ff' : '#f0fdfa'};color:${loc.customerType === 'جملة' ? '#3730a3' : '#0f766e'};border:1px solid ${loc.customerType === 'جملة' ? '#c7d2fe' : '#99f6e4'};border-radius:6px;padding:1px 6px;font-size:10px;font-weight:800;">
            ${escapeHtml(loc.customerType || 'مفرد')}
          </span>
        </div>
        <div style="font-size:11px;color:#334155;display:grid;gap:3px;">
          <div><strong>الكود:</strong> <span style="font-family:monospace;">${escapeHtml(loc.customerCode || '-')}</span></div>
          ${loc.path ? `<div><strong>المسار:</strong> ${escapeHtml(loc.path)}</div>` : ''}
          ${loc.customerAddress ? `<div><strong>العنوان:</strong> ${escapeHtml(loc.customerAddress)}</div>` : ''}
          <div><strong>حُفظ بواسطة المندوب:</strong> <span style="color:#0d9488;font-weight:800;">${escapeHtml(repName)}</span></div>
          <div><strong>تاريخ الحفظ:</strong> <span dir="ltr">${escapeHtml(savedDateDisplay)}</span></div>
          <div><strong>الإحداثيات:</strong> <span dir="ltr" style="font-family:monospace;font-weight:700;">${coordsStr}</span>${loc.accuracyMeters ? ` (±${loc.accuracyMeters}م)` : ''}</div>
        </div>
        ${
          stats
            ? `<div style="margin-top:7px;padding:6px 8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;color:#1e293b;">
                <div style="font-weight:800;color:#047857;margin-bottom:2px;">ملخص المبيعات المسجلة للمحل:</div>
                <div>عدد الفواتير: <strong>${stats.invoicesCount}</strong> | الوزن الكلي: <strong>${formatWithCommas(parseFloat(stats.totalWeightKg.toFixed(1)), true)} كجم</strong></div>
                ${stats.lastDate ? `<div>آخر عملية بيع: <span dir="ltr">${escapeHtml(stats.lastDate)}</span></div>` : ''}
              </div>`
            : `<div style="margin-top:7px;padding:5px 8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-size:10.5px;color:#64748b;">لا توجد فواتير مبيعات مطابقة مسجلة حالياً</div>`
        }
      `;

      const popupActions = document.createElement('div');
      popupActions.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:6px;';

      const mapsLink = document.createElement('a');
      mapsLink.href = gmapsUrl;
      mapsLink.target = '_blank';
      mapsLink.rel = 'noopener noreferrer';
      mapsLink.style.cssText =
        'flex:1;display:flex;align-items:center;justify-content:center;gap:4px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:11px;font-weight:800;padding:6px 8px;border-radius:8px;';
      mapsLink.textContent = 'خرائط كوكل ↗';
      popupActions.appendChild(mapsLink);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '✏️ تعديل الموقع';
      editBtn.style.cssText =
        'padding:6px 10px;border-radius:8px;border:none;background:#d97706;color:#ffffff;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;';
      editBtn.onclick = () => openEditLocationModal(loc);
      popupActions.appendChild(editBtn);

      popupNode.appendChild(popupActions);

      marker.bindPopup(popupNode, { maxWidth: 310 });
      marker.on('click', () => {
        setSelectedLocationId(loc.id);
      });

      marker.addTo(layer);
      markerByIdRef.current.set(loc.id, marker);
    });

    if (!hasAutoFittedRef.current && filteredLocations.length > 0) {
      hasAutoFittedRef.current = true;
      window.setTimeout(() => {
        fitAllFilteredPins();
      }, 150);
    }
  }, [filteredLocations, selectedLocationId, salesStatsByCustomer]);

  // Re-fit when delegate filter changes cleanly
  useEffect(() => {
    if (filteredLocations.length > 0) {
      fitAllFilteredPins();
    }
  }, [selectedDelegateFilter]);

  const handleFocusLocation = (loc: ShopLocationRecord) => {
    setSelectedLocationId(loc.id);
    const map = mapInstanceRef.current;
    if (map) {
      map.setView([loc.latitude, loc.longitude], 16, { animate: true });
      const marker = markerByIdRef.current.get(loc.id);
      if (marker) {
        marker.openPopup();
      }
    }
  };

  return (
    <div className="space-y-3 pt-2">
      {/* Filter & Map Controls Bar */}
      <div
        className={`p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-2.5 ${
          isDarkMode
            ? 'bg-slate-950/70 border-slate-800 text-slate-100'
            : 'bg-slate-50 border-slate-200 text-slate-800'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
          <div className="relative flex-1 min-w-[170px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث باسم المحل، الكود، المسار، أو المندوب..."
              className={`w-full pr-8 pl-3 py-2 rounded-xl border text-xs font-bold focus:outline-none focus:border-teal-500 ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white placeholder:text-slate-500'
                  : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
              }`}
            />
          </div>

          <select
            value={selectedDelegateFilter}
            onChange={(e) => setSelectedDelegateFilter(e.target.value)}
            className={`px-3 py-2 rounded-xl border text-xs font-bold focus:outline-none focus:border-teal-500 ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white'
                : 'bg-white border-slate-300 text-slate-900'
            }`}
          >
            <option value="الكل">كل المناديب ({validLocations.length})</option>
            {delegateOptions.map((del) => (
              <option key={del} value={del}>
                المندوب: {del}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1.5 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-700 dark:text-teal-300 text-[11px] font-black flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            <span>الدبابيس المعروضة: {filteredLocations.length}</span>
          </span>

          <button
            type="button"
            onClick={fitAllFilteredPins}
            disabled={filteredLocations.length === 0}
            className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-[11px] font-black flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>توسيط جميع الدبابيس</span>
          </button>

          <button
            type="button"
            onClick={() => mapInstanceRef.current?.invalidateSize()}
            title="تحديث أبعاد الخريطة"
            className={`p-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold px-1">
        <span className="inline-flex items-center gap-1.5 text-teal-700 dark:text-teal-300">
          <span className="w-2.5 h-2.5 rounded-full bg-teal-600 inline-block" />
          محل مفرد
        </span>
        <span className="inline-flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block" />
          محل جملة
        </span>
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" />
          الموقع المحدد حالياً
        </span>
      </div>

      {/* Map Container */}
      <div className="relative rounded-2xl overflow-hidden border-2 border-teal-500/30 dark:border-teal-700/60 shadow-lg bg-slate-100 dark:bg-slate-950">
        <div
          ref={mapContainerRef}
          className="w-full h-[500px] sm:h-[600px] lg:h-[650px] z-0"
          style={{ direction: 'ltr' }}
        />

        {filteredLocations.length === 0 && (
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4 pointer-events-none z-10">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4 text-center shadow-xl max-w-sm">
              <MapPin className="w-7 h-7 text-teal-500 mx-auto mb-2" />
              <div className="text-xs sm:text-sm font-black text-slate-900 dark:text-white">
                لا توجد مواقع محلات محفوظة مطابقة للفلتر الحالي
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
                ستظهر الدبابيس تلقائياً بمجرد قيام المناديب بحفظ مواقع المحلات من شاشة المسارات.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Saved Locations Quick-Focus List */}
      {filteredLocations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-black text-slate-700 dark:text-slate-200 px-1">
            <span className="flex items-center gap-1.5">
              <Store className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>قائمة مواقع المحلات المحفوظة (اضغط للانتقال للدبوس على الخريطة):</span>
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {filteredLocations.length} موقع
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[260px] overflow-y-auto pr-1">
            {filteredLocations.map((loc) => {
              const isSelected = selectedLocationId === loc.id;
              const stats = getSalesStats(loc);
              const coordsText = loc.shopLocation || formatShopLocationString(loc.latitude, loc.longitude);

              return (
                <div
                  key={loc.id}
                  onClick={() => handleFocusLocation(loc)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    isSelected
                      ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30 shadow-sm'
                      : isDarkMode
                      ? 'border-slate-800 bg-slate-950/60 hover:border-teal-600/60'
                      : 'border-slate-200 bg-white hover:border-teal-400'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-black text-xs text-slate-900 dark:text-white leading-snug">
                        {loc.customerName}
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black border ${
                          loc.customerType === 'جملة'
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                            : 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                        }`}
                      >
                        {loc.customerType || 'مفرد'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
                      <span className="font-mono">#{loc.customerCode || '-'}</span>
                      {loc.path && <span>• {loc.path}</span>}
                    </div>

                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1 font-bold">
                      <User className="w-3 h-3 text-teal-600 dark:text-teal-400 shrink-0" />
                      <span>المندوب: {loc.savedBy || loc.delegateName}</span>
                    </div>

                    {stats && (
                      <div className="text-[10.5px] text-emerald-700 dark:text-emerald-400 font-bold">
                        المبيعات: {stats.invoicesCount} فاتورة ({formatWithCommas(parseFloat(stats.totalWeightKg.toFixed(1)), true)} كجم)
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70 dark:border-slate-800 text-[10.5px]">
                    <span className="font-mono text-slate-600 dark:text-slate-300 flex items-center gap-1 truncate select-all" dir="ltr">
                      <Navigation className="w-3 h-3 text-teal-500 shrink-0" />
                      {coordsText}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyCoords(loc.id, coordsText);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-teal-700 dark:text-teal-300 border border-teal-500/30 font-black cursor-pointer"
                        title="نسخ الإحداثيات"
                      >
                        {copiedId === loc.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedId === loc.id ? 'تم النسخ' : 'نسخ'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditLocationModal(loc);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-black cursor-pointer"
                        title="تعديل إحداثيات موقع المحل"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>تعديل</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin Edit Saved Shop Location Modal */}
      {editingLoc && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
          dir="rtl"
          onClick={() => {
            if (!isSavingEditLoc) setEditingLoc(null);
          }}
        >
          <div
            className={`w-full max-w-md rounded-2xl p-5 shadow-2xl border space-y-4 text-right ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-sm text-slate-900 dark:text-white">
                    تعديل موقع المحل - {editingLoc.customerName}
                  </h4>
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    كود: {editingLoc.customerCode || '-'} {editingLoc.path ? `• ${editingLoc.path}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingEditLoc) setEditingLoc(null);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-700 dark:text-slate-300">
                الإحداثيات الجديدة (أو لصق رابط خرائط كوكل):
              </label>
              <input
                type="text"
                dir="ltr"
                value={editCoordInput}
                onChange={(e) => {
                  setEditCoordInput(e.target.value);
                  setEditCoordError(null);
                }}
                placeholder="34.615800, 43.678600 أو https://maps.app.goo.gl/..."
                className={`w-full px-3 py-2.5 rounded-xl border text-xs font-mono ${
                  isDarkMode ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
              {isResolvingEditUrl && (
                <div className="flex items-center gap-2 text-[11px] font-bold text-teal-700 dark:text-teal-300 px-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>جاري استخراج الإحداثيات من رابط خرائط كوكل...</span>
                </div>
              )}
              {(() => {
                const syncPreview = parseShopLocationString(editCoordInput);
                const preview =
                  syncPreview.latitude !== null && syncPreview.longitude !== null
                    ? syncPreview
                    : resolvedEditPreview;
                if (!preview || preview.latitude === null || preview.longitude === null) return null;
                return (
                  <div className="flex items-center justify-between text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
                    <span dir="ltr" className="font-mono">
                      {preview.latitude.toFixed(6)}, {preview.longitude.toFixed(6)}
                    </span>
                    <a
                      href={`https://www.google.com/maps?q=${preview.latitude},${preview.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline"
                    >
                      <span>معاينة</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                );
              })()}
              {editCoordError && (
                <p className="text-xs font-bold text-rose-600 dark:text-rose-400">⚠️ {editCoordError}</p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={isSavingEditLoc}
                onClick={() => setEditingLoc(null)}
                className={`px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSavingEditLoc}
                onClick={handleSaveEditedLocation}
                className="flex-1 py-2 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isSavingEditLoc ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>جاري الحفظ...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>حفظ تعديل الموقع</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
