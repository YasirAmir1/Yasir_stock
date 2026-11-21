import React, { useEffect, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  Camera,
  Crosshair,
  ExternalLink,
  ImagePlus,
  Loader2,
  MapPin,
  Phone,
  Save,
  Store,
  Trash2,
  User,
  Users,
  X,
  CreditCard,
  AlertTriangle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { cleanFirestoreData } from '../lib/firestoreUtils';
import { uploadNewCustomerMediaToStorage } from '../lib/supabaseService';
import {
  checkGeolocationPermissionState,
  dispatchRepLiveCoords,
  formatShopLocationString,
  GPS_POSITION_GRANTED_EVENT,
  isGeolocationSecureContext,
  isShortOrExternalMapsUrl,
  mapGeolocationErrorToStatus,
  parseShopLocationString,
  resolveShopLocationInput,
} from '../lib/fleetTrackingService';
import { NewCustomerDefinition, UserAccount } from '../types';
import { parseArabicDigits } from '../utils/numberUtils';

interface NewCustomerDefinitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserAccount | null;
  effectiveDelegateCode?: string;
  isDarkMode: boolean;
  onSuccess?: (record: NewCustomerDefinition) => void;
}

const compressImageFile = (
  file: File
): Promise<{ dataUrl: string; blob: Blob }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 760;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const fallbackUrl = ev.target?.result as string;
          resolve({ dataUrl: fallbackUrl, blob: file });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
        canvas.toBlob(
          (b) => {
            resolve({ dataUrl, blob: b || file });
          },
          'image/jpeg',
          0.68
        );
      };
      img.onerror = () => reject(new Error('تعذر تحميل الصورة'));
      img.src = ev.target?.result as string;
    };
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.readAsDataURL(file);
  });
};

export const NewCustomerDefinitionModal: React.FC<NewCustomerDefinitionModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  effectiveDelegateCode,
  isDarkMode,
  onSuccess,
}) => {
  const [shopSignName, setShopSignName] = useState('');
  const [buyerFullName, setBuyerFullName] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [customerType, setCustomerType] = useState<'مفرد' | 'جملة'>('مفرد');

  const [gpsInput, setGpsInput] = useState('');
  const [capturedLatLng, setCapturedLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [isCapturingGps, setIsCapturingGps] = useState(false);
  const [isResolvingMapsUrl, setIsResolvingMapsUrl] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [exteriorSignImage, setExteriorSignImage] = useState<string>('');
  const [idCardFrontImage, setIdCardFrontImage] = useState<string>('');
  const [idCardBackImage, setIdCardBackImage] = useState<string>('');
  const [uploadingSlot, setUploadingSlot] = useState<'exterior' | 'id_front' | 'id_back' | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const extFileRef = useRef<HTMLInputElement>(null);
  const extCamRef = useRef<HTMLInputElement>(null);
  const frontFileRef = useRef<HTMLInputElement>(null);
  const frontCamRef = useRef<HTMLInputElement>(null);
  const backFileRef = useRef<HTMLInputElement>(null);
  const backCamRef = useRef<HTMLInputElement>(null);

  const captureGps = () => {
    setGpsError(null);
    if (!isGeolocationSecureContext()) {
      setGpsError('يتطلب التقاط الموقع (GPS) فتح التطبيق عبر اتصال آمن (HTTPS). يمكنك لصق الإحداثيات أو رابط خرائط كوكل.');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('المتصفح لا يدعم التقاط GPS. يمكنك لصق الإحداثيات أو رابط خرائط كوكل.');
      return;
    }
    setIsCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setCapturedLatLng({ lat, lng });
        setGpsInput(formatShopLocationString(lat, lng));
        setIsCapturingGps(false);
        setGpsError(null);
        dispatchRepLiveCoords({ latitude: lat, longitude: lng });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(GPS_POSITION_GRANTED_EVENT, { detail: { position: pos } }));
        }
      },
      (err) => {
        setIsCapturingGps(false);
        const mapped = mapGeolocationErrorToStatus(err);
        if (mapped === 'denied') {
          setGpsError('تم رفض صلاحية الموقع (GPS). فعّل الإذن والموقع الدقيق من إعدادات Safari / Chrome أو الصق رابط خرائط كوكل.');
        } else if (mapped === 'gps_off') {
          setGpsError('خدمة GPS متوقفة في الهاتف أو الموقع غير متاح حالياً. شغّل GPS في الجهاز ثم أعد المحاولة.');
        } else if (mapped === 'timeout') {
          setGpsError('انتهت مهلة التقاط إشارة GPS. حاول مجدداً في مكان مكشوف أو الصق رابط خرائط كوكل.');
        } else {
          setGpsError('تعذر التقاط GPS حالياً. أعد المحاولة أو الصق الإحداثيات / رابط خرائط كوكل.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Reset form when opened; only auto-capture GPS if permission is already granted
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setShopSignName('');
    setBuyerFullName('');
    setBuyerAddress('');
    setPhone1('');
    setPhone2('');
    setCustomerType('مفرد');
    setGpsInput('');
    setCapturedLatLng(null);
    setGpsError(null);
    setExteriorSignImage('');
    setIdCardFrontImage('');
    setIdCardBackImage('');
    setFormError(null);

    void checkGeolocationPermissionState().then((state) => {
      if (cancelled) return;
      if (state === 'granted') {
        captureGps();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Auto-resolve short Google Maps URLs pasted into GPS input
  useEffect(() => {
    if (!isOpen) return;
    const raw = gpsInput.trim();
    if (!raw) {
      setIsResolvingMapsUrl(false);
      return;
    }
    const syncParsed = parseShopLocationString(raw);
    if (syncParsed.latitude !== null && syncParsed.longitude !== null) {
      setCapturedLatLng({ lat: syncParsed.latitude, lng: syncParsed.longitude });
      setGpsError(null);
      setIsResolvingMapsUrl(false);
      return;
    }
    if (!isShortOrExternalMapsUrl(raw)) {
      setIsResolvingMapsUrl(false);
      return;
    }

    let cancelled = false;
    setIsResolvingMapsUrl(true);
    setGpsError(null);
    const timer = window.setTimeout(async () => {
      const resolved = await resolveShopLocationInput(raw);
      if (cancelled) return;
      setIsResolvingMapsUrl(false);
      if (resolved.latitude !== null && resolved.longitude !== null) {
        setCapturedLatLng({ lat: resolved.latitude, lng: resolved.longitude });
        setGpsError(null);
      } else {
        setGpsError('تعذر استخراج الإحداثيات من رابط خرائط كوكل. تأكد من الرابط أو التقط عبر GPS.');
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [gpsInput, isOpen]);

  const handleImagePick = async (
    fileList: FileList | null,
    slot: 'exterior' | 'id_front' | 'id_back'
  ) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    if (!file.type.startsWith('image/')) {
      setFormError('يرجى اختيار ملف صورة صالح.');
      return;
    }
    setUploadingSlot(slot);
    setFormError(null);
    try {
      const { dataUrl, blob } = await compressImageFile(file);
      let finalUrl = dataUrl;
      try {
        const upRes = await uploadNewCustomerMediaToStorage(blob, slot);
        if (upRes.success && upRes.publicUrl) {
          finalUrl = upRes.publicUrl;
        }
      } catch {
        // Fallback to compressed JPEG data URL
      }

      if (slot === 'exterior') setExteriorSignImage(finalUrl);
      else if (slot === 'id_front') setIdCardFrontImage(finalUrl);
      else setIdCardBackImage(finalUrl);
    } catch {
      setFormError('حدث خطأ أثناء معالجة الصورة، يرجى المحاولة مرة أخرى.');
    } finally {
      setUploadingSlot(null);
      if (extFileRef.current) extFileRef.current.value = '';
      if (extCamRef.current) extCamRef.current.value = '';
      if (frontFileRef.current) frontFileRef.current.value = '';
      if (frontCamRef.current) frontCamRef.current.value = '';
      if (backFileRef.current) backFileRef.current.value = '';
      if (backCamRef.current) backCamRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!shopSignName.trim()) {
      setFormError('يرجى إدخال اسم المشتري (بالقطعة الخارجية).');
      return;
    }
    if (!buyerFullName.trim()) {
      setFormError('يرجى إدخال الاسم الثلاثي للمشتري.');
      return;
    }
    if (!buyerAddress.trim()) {
      setFormError('يرجى إدخال عنوان المشتري.');
      return;
    }
    const cleanPhone1 = parseArabicDigits(phone1).trim();
    const cleanPhone2 = parseArabicDigits(phone2).trim();
    if (!cleanPhone1) {
      setFormError('يرجى إدخال رقم هاتف الزبون 1.');
      return;
    }
    if (!cleanPhone2) {
      setFormError('يرجى إدخال رقم هاتف الزبون 2.');
      return;
    }

    let finalLat = capturedLatLng?.lat ?? null;
    let finalLng = capturedLatLng?.lng ?? null;
    if ((finalLat === null || finalLng === null) && gpsInput.trim()) {
      const resolved = await resolveShopLocationInput(gpsInput);
      finalLat = resolved.latitude;
      finalLng = resolved.longitude;
    }
    if (finalLat === null || finalLng === null) {
      setFormError('يرجى تحديد موقع المشتري GPS (عبر زر الالتقاط أو لصق الإحداثيات / رابط خرائط كوكل).');
      return;
    }

    if (!exteriorSignImage) {
      setFormError('يرجى إرفاق صورة اللوحة الخارجية للمحل.');
      return;
    }

    if (customerType === 'جملة') {
      if (!idCardFrontImage) {
        setFormError('بما أن نوع المشتري جملة، يجب إرفاق صورة هوية الزبون (الوجه الأمامي).');
        return;
      }
      if (!idCardBackImage) {
        setFormError('بما أن نوع المشتري جملة، يجب إرفاق صورة هوية الزبون (الظهر الخلفي).');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const now = new Date();
      const id = `newdef_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;
      const latRounded = Number(finalLat.toFixed(6));
      const lngRounded = Number(finalLng.toFixed(6));

      const record: NewCustomerDefinition = {
        id,
        shopSignName: shopSignName.trim(),
        buyerFullName: buyerFullName.trim(),
        buyerAddress: buyerAddress.trim(),
        phone1: cleanPhone1,
        phone2: cleanPhone2,
        customerType,
        latitude: latRounded,
        longitude: lngRounded,
        gpsLocation: formatShopLocationString(latRounded, lngRounded),
        exteriorSignImage,
        ...(customerType === 'جملة'
          ? {
              idCardFrontImage,
              idCardBackImage,
            }
          : {}),
        delegateName: currentUser?.name || currentUser?.delegateName || currentUser?.username || 'مندوب',
        delegateCode: currentUser?.delegateCode || effectiveDelegateCode || '',
        submittedByUsername: currentUser?.username || '',
        status: 'pending',
        timestamp: now.getTime(),
        createdAt: now.toISOString(),
        dateString: now.toISOString().split('T')[0],
      };

      await setDoc(doc(db, 'new_customer_definitions', id), cleanFirestoreData(record));
      onSuccess?.(record);
      onClose();
    } catch (err) {
      console.error('Error submitting new customer definition:', err);
      setFormError('حدث خطأ أثناء إرسال طلب تعريف المحل الجديد. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const renderImageUploadSlot = (
    title: string,
    slot: 'exterior' | 'id_front' | 'id_back',
    value: string,
    onClear: () => void,
    fileRef: React.RefObject<HTMLInputElement>,
    camRef: React.RefObject<HTMLInputElement>
  ) => {
    const isUploadingThis = uploadingSlot === slot;
    return (
      <div
        className={`p-3 rounded-2xl border space-y-2.5 ${
          isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-black flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>{title} *</span>
          </span>
          {value && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 text-[10px] font-black cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>حذف</span>
            </button>
          )}
        </div>

        {value ? (
          <div className="relative rounded-xl overflow-hidden border border-emerald-500/40 bg-black/5 dark:bg-black/30">
            <img src={value} alt={title} className="w-full max-h-44 object-contain mx-auto" />
            <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black shadow">
              تم إرفاق الصورة ✓
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={Boolean(uploadingSlot)}
              onClick={() => camRef.current?.click()}
              className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              {isUploadingThis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              <span>التقاط بالكاميرا</span>
            </button>
            <button
              type="button"
              disabled={Boolean(uploadingSlot)}
              onClick={() => fileRef.current?.click()}
              className={`py-2.5 px-3 rounded-xl border font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                  : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
              }`}
            >
              {isUploadingThis ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              <span>اختيار من المعرض</span>
            </button>
          </div>
        )}

        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleImagePick(e.target.files, slot)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleImagePick(e.target.files, slot)}
        />
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
      dir="rtl"
    >
      <div
        className={`w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl p-4 sm:p-6 shadow-2xl border text-right space-y-4 animate-in zoom-in-95 duration-200 ${
          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/30 shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                تعريف محل جديد وإرساله للإدارة
              </h3>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                المندوب: {currentUser?.name || currentUser?.delegateName || '-'} • جميع الحقول مطلوبة
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {formError && (
          <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300 text-xs font-black flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* 1. Shop Exterior Sign Name */}
          <div className="space-y-1">
            <label className="text-xs font-black flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>اسم المشتري (بالقطعة الخارجية) *</span>
            </label>
            <input
              type="text"
              required
              value={shopSignName}
              onChange={(e) => setShopSignName(e.target.value)}
              placeholder="مثال: أسواق البركة للمواد الغذائية"
              className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            />
          </div>

          {/* 2. Buyer Full Triple Name */}
          <div className="space-y-1">
            <label className="text-xs font-black flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>الاسم الثلاثي للمشتري *</span>
            </label>
            <input
              type="text"
              required
              value={buyerFullName}
              onChange={(e) => setBuyerFullName(e.target.value)}
              placeholder="مثال: أحمد علي محمد"
              className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            />
          </div>

          {/* 3. Buyer Address */}
          <div className="space-y-1">
            <label className="text-xs font-black flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>عنوان المشتري *</span>
            </label>
            <input
              type="text"
              required
              value={buyerAddress}
              onChange={(e) => setBuyerAddress(e.target.value)}
              placeholder="مثال: تكريت - القادسية - قرب شارع الأربعين"
              className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            />
          </div>

          {/* 4 & 5. Phone Numbers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-black flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>رقم هاتف الزبون 1 *</span>
              </label>
              <input
                type="tel"
                dir="ltr"
                required
                value={phone1}
                onChange={(e) => setPhone1(e.target.value)}
                placeholder="077XXXXXXXX"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-mono font-bold text-right outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>رقم هاتف الزبون 2 *</span>
              </label>
              <input
                type="tel"
                dir="ltr"
                required
                value={phone2}
                onChange={(e) => setPhone2(e.target.value)}
                placeholder="078XXXXXXXX"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-mono font-bold text-right outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
            </div>
          </div>

          {/* 6. Buyer Type (مفرد / جملة) */}
          <div className="space-y-1.5">
            <label className="text-xs font-black flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>نوع المشتري (مفرد / جملة) *</span>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {(['مفرد', 'جملة'] as const).map((typeOpt) => {
                const active = customerType === typeOpt;
                return (
                  <button
                    key={typeOpt}
                    type="button"
                    onClick={() => setCustomerType(typeOpt)}
                    className={`py-2.5 px-4 rounded-xl border font-black text-xs sm:text-sm transition-all cursor-pointer ${
                      active
                        ? typeOpt === 'جملة'
                          ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-md'
                          : 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                        : isDarkMode
                        ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {typeOpt === 'جملة' ? 'جملة (يتطلب صورة الهوية)' : 'مفرد'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 7. Buyer GPS Location */}
          <div
            className={`p-3.5 rounded-2xl border space-y-2.5 ${
              isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-teal-50/70 border-teal-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-teal-800 dark:text-teal-300 flex items-center gap-1.5">
                <Crosshair className="w-4 h-4" />
                <span>موقع المشتري GPS *</span>
              </span>
              <button
                type="button"
                disabled={isCapturingGps}
                onClick={captureGps}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-[11px] font-black cursor-pointer transition-colors"
              >
                {isCapturingGps ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
                <span>{isCapturingGps ? 'جاري الالتقاط...' : 'التقاط / تحديث GPS'}</span>
              </button>
            </div>

            {capturedLatLng && (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-500/40">
                <span dir="ltr" className="font-mono text-xs font-black text-emerald-600 dark:text-emerald-400">
                  {capturedLatLng.lat.toFixed(6)}, {capturedLatLng.lng.toFixed(6)}
                </span>
                <a
                  href={`https://www.google.com/maps?q=${capturedLatLng.lat},${capturedLatLng.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>معاينة الخريطة</span>
                </a>
              </div>
            )}

            <input
              type="text"
              dir="ltr"
              value={gpsInput}
              onChange={(e) => setGpsInput(e.target.value)}
              placeholder="34.615800, 43.678600 أو رابط https://maps.app.goo.gl/..."
              className={`w-full px-3 py-2 rounded-xl border text-xs font-mono ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
              }`}
            />

            {isResolvingMapsUrl && (
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-teal-600 dark:text-teal-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>جاري استخراج الإحداثيات من رابط الخرائط...</span>
              </div>
            )}
            {gpsError && (
              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">⚠️ {gpsError}</p>
            )}
          </div>

          {/* 8. Exterior Sign Image */}
          {renderImageUploadSlot(
            'صورة اللوحة الخارجية',
            'exterior',
            exteriorSignImage,
            () => setExteriorSignImage(''),
            extFileRef,
            extCamRef
          )}

          {/* 9. Conditional Wholesale Customer ID Card (Front + Back) */}
          {customerType === 'جملة' && (
            <div
              className={`p-3.5 rounded-2xl border-2 space-y-3 ${
                isDarkMode
                  ? 'bg-amber-950/30 border-amber-600/60'
                  : 'bg-amber-50/70 border-amber-400'
              }`}
            >
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-black text-xs">
                <CreditCard className="w-4 h-4 shrink-0" />
                <span>إلزامي لزبائن الجملة: صورة هوية الزبون (وجه + ظهر)</span>
              </div>

              {renderImageUploadSlot(
                'صورة هوية الزبون — الوجه الأمامي',
                'id_front',
                idCardFrontImage,
                () => setIdCardFrontImage(''),
                frontFileRef,
                frontCamRef
              )}

              {renderImageUploadSlot(
                'صورة هوية الزبون — الظهر الخلفي',
                'id_back',
                idCardBackImage,
                () => setIdCardBackImage(''),
                backFileRef,
                backCamRef
              )}
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className={`px-4 py-2.5 rounded-xl font-bold text-xs border cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                  : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
              }`}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(uploadingSlot) || isResolvingMapsUrl}
              className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-xs sm:text-sm shadow-md shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري الإرسال للأدمن...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>إرسال تعريف المحل الجديد للأدمن</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
