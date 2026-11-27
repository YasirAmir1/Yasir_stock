import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Phone,
  Search,
  Store,
  Trash2,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { NewCustomerDefinition } from '../types';
import { formatEnglishDateTime } from '../utils/dateUtils';
import { generateNewCustomerPhotosPdf, generateSinglePhotoPdf } from '../utils/newCustomerPdf';

interface NewCustomerDefinitionsSectionProps {
  definitions: NewCustomerDefinition[];
  isAdminViewer: boolean;
  isStrictAdmin: boolean;
  currentDelegateName: string;
  currentDelegateCode?: string;
  currentUsername?: string;
  isDarkMode: boolean;
  onNotify?: (title: string, message: string, type?: 'success' | 'info') => void;
}

const normalizeStr = (val?: string | null): string =>
  String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/\s+/g, ' ');

export const NewCustomerDefinitionsSection: React.FC<NewCustomerDefinitionsSectionProps> = ({
  definitions,
  isAdminViewer,
  isStrictAdmin,
  currentDelegateName,
  currentDelegateCode,
  currentUsername,
  isDarkMode,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [delegateFilter, setDelegateFilter] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string; subtitle?: string } | null>(null);
  const [exportingPdfId, setExportingPdfId] = useState<string | null>(null);
  const [isExportingSinglePdf, setIsExportingSinglePdf] = useState<boolean>(false);

  // Representative only sees requests they submitted; Admin/DataEntry sees all requests from all delegates
  const roleScopedDefinitions = useMemo(() => {
    if (isAdminViewer) return definitions;

    const myNameNorm = normalizeStr(currentDelegateName);
    const myUserNorm = normalizeStr(currentUsername);
    const myCodeNorm = normalizeStr(currentDelegateCode);

    return definitions.filter((item) => {
      const itemDelNorm = normalizeStr(item.delegateName);
      const itemUserNorm = normalizeStr(item.submittedByUsername);
      const itemCodeNorm = normalizeStr(item.delegateCode);

      if (myUserNorm && itemUserNorm && (myUserNorm === itemUserNorm || itemUserNorm.includes(myUserNorm) || myUserNorm.includes(itemUserNorm))) return true;
      if (myCodeNorm && itemCodeNorm && (myCodeNorm === itemCodeNorm || itemCodeNorm.includes(myCodeNorm) || myCodeNorm.includes(itemCodeNorm))) return true;
      if (myNameNorm && itemDelNorm && (itemDelNorm === myNameNorm || itemDelNorm.includes(myNameNorm) || myNameNorm.includes(itemDelNorm))) return true;
      return false;
    });
  }, [definitions, isAdminViewer, currentDelegateName, currentDelegateCode, currentUsername]);

  const delegateFilterOptions = useMemo(() => {
    const set = new Set<string>();
    roleScopedDefinitions.forEach((d) => {
      if (d.delegateName) set.add(d.delegateName);
    });
    return Array.from(set).sort();
  }, [roleScopedDefinitions]);

  const visibleDefinitions = useMemo(() => {
    const q = normalizeStr(searchQuery);
    return roleScopedDefinitions.filter((d) => {
      if (isAdminViewer && delegateFilter && d.delegateName !== delegateFilter) {
        return false;
      }
      if (!q) return true;
      const hay = normalizeStr(
        `${d.shopSignName} ${d.buyerFullName} ${d.buyerAddress} ${d.phone1} ${d.phone2} ${d.delegateName} ${d.customerType}`
      );
      return hay.includes(q);
    });
  }, [roleScopedDefinitions, searchQuery, isAdminViewer, delegateFilter]);

  const handleCopyGps = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  const handleChangeDefinitionStatus = async (
    rec: NewCustomerDefinition,
    nextStatus: 'approved' | 'rejected' | 'pending',
    reason?: string
  ) => {
    if (!isStrictAdmin || !rec.id || updatingStatusId) return;
    setUpdatingStatusId(rec.id);

    const nowIso = new Date().toISOString();
    const reviewerName = currentDelegateName || 'الأدمن';
    const trimmedReason = (reason || '').trim();

    const updatePayload: Record<string, any> = {
      status: nextStatus,
      reviewedBy: reviewerName,
      reviewedAt: nowIso,
    };

    if (nextStatus === 'approved') {
      updatePayload.approvedBy = reviewerName;
      updatePayload.approvedAt = nowIso;
      updatePayload.rejectionReason = '';
    } else if (nextStatus === 'rejected') {
      updatePayload.rejectionReason = trimmedReason;
    } else {
      updatePayload.rejectionReason = '';
    }

    try {
      await updateDoc(doc(db, 'new_customer_definitions', rec.id), updatePayload);

      if (rejectingId === rec.id) {
        setRejectingId(null);
        setRejectionReasonInput('');
      }

      // Send targeted notification directly to the submitting representative's notification panel
      try {
        const notifId = `new_cust_status_${rec.id}_${Date.now()}`;
        const notifTitle =
          nextStatus === 'approved'
            ? 'تم قبول طلب تعريف محل جديد ✅'
            : nextStatus === 'rejected'
            ? 'تم رفض طلب تعريف محل جديد ❌'
            : 'تم تحديث حالة طلب تعريف محل جديد ⏳';

        const notifText =
          nextStatus === 'approved'
            ? `تم قبول طلب تعريف المحل (${rec.shopSignName}) للمشتري (${rec.buyerFullName}) من قبل الإدارة (${reviewerName}).`
            : nextStatus === 'rejected'
            ? `تم رفض طلب تعريف المحل (${rec.shopSignName}) للمشتري (${rec.buyerFullName}) من قبل الإدارة (${reviewerName}).${
                trimmedReason ? `\nسبب الرفض: ${trimmedReason}` : ''
              }`
            : `تمت إعادة طلب تعريف المحل (${rec.shopSignName}) للمشتري (${rec.buyerFullName}) إلى قيد المراجعة من قبل (${reviewerName}).`;

        await setDoc(doc(db, 'admin_notifications', notifId), {
          notificationType: 'new_customer_status',
          requestId: rec.id,
          customerName: rec.shopSignName,
          buyerFullName: rec.buyerFullName,
          status: nextStatus,
          rejectionReason: nextStatus === 'rejected' ? trimmedReason : '',
          reviewedBy: reviewerName,
          targetDelegateName: rec.delegateName || '',
          targetDelegateCode: rec.delegateCode || '',
          targetUsername: rec.submittedByUsername || '',
          title: notifTitle,
          text: notifText,
          timestamp: Date.now(),
        });
      } catch (notifErr) {
        console.error('Error sending delegate status notification:', notifErr);
      }

      if (nextStatus === 'approved') {
        onNotify?.(
          'تم القبول ✓',
          `تم قبول طلب (${rec.shopSignName}) وإرسال تنبيه للمندوب (${rec.delegateName}).`,
          'success'
        );
      } else if (nextStatus === 'rejected') {
        onNotify?.(
          'تم الرفض',
          `تم رفض طلب (${rec.shopSignName}) وإرسال تنبيه للمندوب (${rec.delegateName}).`,
          'info'
        );
      } else {
        onNotify?.(
          'تم تحديث الحالة',
          `تمت إعادة طلب (${rec.shopSignName}) إلى قيد المراجعة وإشعار المندوب.`,
          'info'
        );
      }
    } catch (err) {
      console.error('Error updating new customer definition status:', err);
      onNotify?.('خطأ', 'تعذر تحديث حالة طلب التعريف.', 'info');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleDeleteDefinition = async (rec: NewCustomerDefinition) => {
    if (!isStrictAdmin || !rec.id) return;
    try {
      await deleteDoc(doc(db, 'new_customer_definitions', rec.id));
      setConfirmDeleteId(null);
      onNotify?.('تم الحذف', `تم حذف طلب تعريف (${rec.shopSignName}).`, 'info');
    } catch {
      onNotify?.('خطأ', 'تعذر حذف طلب التعريف.', 'info');
    }
  };

  const handleExportExcel = async () => {
    if (visibleDefinitions.length === 0) return;
    try {
      const XLSX = await import('xlsx');
      const rows = visibleDefinitions.map((d, i) => ({
        'ت': i + 1,
        'اسم المشتري (بالقطعة الخارجية)': d.shopSignName,
        'الاسم الثلاثي للمشتري': d.buyerFullName,
        'عنوان المشتري': d.buyerAddress,
        'رقم هاتف الزبون 1': d.phone1,
        'رقم هاتف الزبون 2': d.phone2,
        'نوع المشتري': d.customerType,
        'موقع المشتري GPS': d.gpsLocation,
        'المندوب المرسل': d.delegateName,
        'الحالة':
          d.status === 'approved'
            ? 'تم القبول'
            : d.status === 'rejected'
            ? 'تم الرفض'
            : 'بانتظار المراجعة',
        'سبب الرفض / الملاحظة': d.rejectionReason || '',
        'تاريخ الإرسال': formatEnglishDateTime(d.createdAt || d.timestamp, d.dateString),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'طلبات تعريف محلات جديدة');
      XLSX.writeFile(wb, `تعريف_محلات_جديدة_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch {
      onNotify?.('خطأ', 'تعذر تصدير ملف الإكسل.', 'info');
    }
  };

  const handleExportPhotosPdf = async (rec: NewCustomerDefinition) => {
    if (exportingPdfId) return;
    setExportingPdfId(rec.id);
    try {
      await generateNewCustomerPhotosPdf(rec);
      onNotify?.('تم تصدير PDF ✓', `تم تحويل صور وبيانات (${rec.shopSignName}) إلى PDF بنجاح.`, 'success');
    } catch (err) {
      console.error('Error exporting new customer PDF:', err);
      onNotify?.('خطأ', 'تعذر إنشاء ملف PDF لصور الزبون.', 'info');
    } finally {
      setExportingPdfId(null);
    }
  };

  const handleExportSinglePreviewPdf = async () => {
    if (!previewImage || isExportingSinglePdf) return;
    setIsExportingSinglePdf(true);
    try {
      await generateSinglePhotoPdf(previewImage.src, previewImage.title, previewImage.subtitle);
    } catch (err) {
      console.error('Error exporting single photo PDF:', err);
      onNotify?.('خطأ', 'تعذر تحويل الصورة إلى PDF.', 'info');
    } finally {
      setIsExportingSinglePdf(false);
    }
  };

  return (
    <div
      className={`mt-6 p-4 sm:p-5 rounded-2xl border shadow-md space-y-4 ${
        isDarkMode
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-indigo-800/60'
          : 'bg-gradient-to-br from-indigo-50/80 via-white to-slate-50 border-indigo-200'
      }`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-indigo-100 dark:border-slate-700/80">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/30 shrink-0">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
              <span>طلبات تعريف محلات جديدة (تعريف جديد)</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-600 text-white shadow-xs">
                {isAdminViewer
                  ? `جميع طلبات المندوبين (${visibleDefinitions.length})`
                  : `طلباتي المرسلة فقط (${visibleDefinitions.length})`}
              </span>
              {isAdminViewer && visibleDefinitions.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-black bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-xs cursor-pointer transition-colors"
                >
                  <Download className="w-3 h-3" />
                  <span>تصدير Excel</span>
                </button>
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mt-0.5">
              {isAdminViewer
                ? 'جميع المحلات الجديدة المرسلة من المندوبين مع الصور وموقع GPS للمراجعة والتعريف.'
                : 'المحلات الجديدة التي قمت بإرسالها للإدارة فقط.'}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
          {isAdminViewer && (
            <select
              value={delegateFilter}
              onChange={(e) => setDelegateFilter(e.target.value)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
              }`}
            >
              <option value="">جميع المناديب</option>
              {delegateFilterOptions.map((del) => (
                <option key={del} value={del}>
                  {del}
                </option>
              ))}
            </select>
          )}

          <div className="w-full sm:w-64 relative">
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم المحل، المشتري، الهاتف..."
              className={`w-full pr-9 pl-3 py-1.5 rounded-xl border text-xs font-bold ${
                isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Cards Grid */}
      {visibleDefinitions.length === 0 ? (
        <div className="text-center py-8 text-slate-500 dark:text-slate-400 font-bold text-xs bg-white/40 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
          {isAdminViewer
            ? 'لا توجد طلبات تعريف محلات جديدة مرسلة من المندوبين حالياً.'
            : 'لم تقم بإرسال أي طلبات تعريف محلات جديدة بعد. يمكنك الإرسال عبر زر «تعريف جديد» أعلى الصفحة.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {visibleDefinitions.map((rec) => {
            const isApproved = rec.status === 'approved';
            const isRejected = rec.status === 'rejected';
            const isUpdating = updatingStatusId === rec.id;
            const isRejectingThis = rejectingId === rec.id;
            const isConfirmingDel = confirmDeleteId === rec.id;

            return (
              <div
                key={rec.id}
                className={`p-3.5 rounded-2xl border shadow-xs transition-all space-y-2.5 flex flex-col justify-between ${
                  isApproved
                    ? isDarkMode
                      ? 'bg-emerald-950/35 border-emerald-700/70'
                      : 'bg-emerald-50/70 border-emerald-300'
                    : isRejected
                    ? isDarkMode
                      ? 'bg-rose-950/35 border-rose-700/70'
                      : 'bg-rose-50/70 border-rose-300'
                    : isDarkMode
                    ? 'bg-slate-900/95 border-indigo-800/60 hover:border-indigo-500'
                    : 'bg-white border-indigo-200 hover:border-indigo-400'
                }`}
              >
                <div className="space-y-2">
                  {/* Top Row: Shop Sign Name + Type + Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-black text-xs sm:text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Store className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span>{rec.shopSignName}</span>
                      </h4>
                      <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mt-0.5 flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>الاسم الثلاثي: {rec.buyerFullName}</span>
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                          rec.customerType === 'جملة'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                            : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30'
                        }`}
                      >
                        {rec.customerType}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[9px] font-black border ${
                          isApproved
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                            : isRejected
                            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {isApproved ? 'تم القبول ✓' : isRejected ? 'تم الرفض ✕' : 'بانتظار المراجعة'}
                      </span>
                    </div>
                  </div>

                  {/* Rejection Reason Banner (if rejected with reason) */}
                  {isRejected && rec.rejectionReason && (
                    <div
                      className={`p-2 rounded-xl border text-[11px] font-bold ${
                        isDarkMode
                          ? 'bg-rose-900/40 border-rose-700/60 text-rose-200'
                          : 'bg-rose-100/70 border-rose-300 text-rose-800'
                      }`}
                    >
                      سبب الرفض: {rec.rejectionReason}
                    </div>
                  )}

                  {/* Address */}
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    📍 العنوان: {rec.buyerAddress}
                  </p>

                  {/* Phones */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono font-bold">
                    <a
                      href={`tel:${rec.phone1}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                    >
                      <Phone className="w-3 h-3" />
                      <span dir="ltr">{rec.phone1}</span>
                    </a>
                    <a
                      href={`tel:${rec.phone2}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                    >
                      <Phone className="w-3 h-3" />
                      <span dir="ltr">{rec.phone2}</span>
                    </a>
                  </div>

                  {/* Rep Name */}
                  <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    المندوب المرسل: <span className="text-slate-800 dark:text-slate-200 font-black">{rec.delegateName}</span>
                  </div>

                  {/* GPS Box */}
                  <div
                    className={`p-2 rounded-xl border flex items-center justify-between gap-2 ${
                      isDarkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-indigo-50/60 border-indigo-200/80'
                    }`}
                  >
                    <span dir="ltr" className="font-mono text-[11px] font-black text-indigo-700 dark:text-indigo-300 truncate select-all">
                      {rec.gpsLocation}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyGps(rec.id, rec.gpsLocation)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black cursor-pointer"
                      >
                        {copiedId === rec.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedId === rec.id ? 'نُسخ' : 'نسخ'}</span>
                      </button>
                      <a
                        href={`https://www.google.com/maps?q=${rec.latitude},${rec.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-black"
                        title="فتح الموقع في خرائط كوكل"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* Photos Grid */}
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewImage({
                          src: rec.exteriorSignImage,
                          title: `اللوحة الخارجية — ${rec.shopSignName}`,
                          subtitle: `المشتري: ${rec.buyerFullName} • المندوب: ${rec.delegateName}`,
                        })
                      }
                      className="group relative rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 aspect-square bg-slate-100 dark:bg-slate-800 cursor-pointer"
                    >
                      <img src={rec.exteriorSignImage} alt="اللوحة الخارجية" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[9px] font-black py-0.5 text-center">
                        اللوحة
                      </span>
                    </button>

                    {rec.customerType === 'جملة' && rec.idCardFrontImage && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewImage({
                            src: rec.idCardFrontImage!,
                            title: `وجه الهوية — ${rec.buyerFullName}`,
                            subtitle: `المحل: ${rec.shopSignName} • المندوب: ${rec.delegateName}`,
                          })
                        }
                        className="group relative rounded-xl overflow-hidden border border-amber-400/60 aspect-square bg-slate-100 dark:bg-slate-800 cursor-pointer"
                      >
                        <img src={rec.idCardFrontImage} alt="وجه الهوية" className="w-full h-full object-cover" />
                        <span className="absolute bottom-0 inset-x-0 bg-amber-900/80 text-white text-[9px] font-black py-0.5 text-center">
                          وجه الهوية
                        </span>
                      </button>
                    )}

                    {rec.customerType === 'جملة' && rec.idCardBackImage && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewImage({
                            src: rec.idCardBackImage!,
                            title: `ظهر الهوية — ${rec.buyerFullName}`,
                            subtitle: `المحل: ${rec.shopSignName} • المندوب: ${rec.delegateName}`,
                          })
                        }
                        className="group relative rounded-xl overflow-hidden border border-amber-400/60 aspect-square bg-slate-100 dark:bg-slate-800 cursor-pointer"
                      >
                        <img src={rec.idCardBackImage} alt="ظهر الهوية" className="w-full h-full object-cover" />
                        <span className="absolute bottom-0 inset-x-0 bg-amber-900/80 text-white text-[9px] font-black py-0.5 text-center">
                          ظهر الهوية
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Footer Timestamp, PDF Button & Admin Controls */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span dir="ltr" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-bold">
                      {formatEnglishDateTime(rec.createdAt || rec.timestamp, rec.dateString)}
                    </span>

                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        disabled={exportingPdfId === rec.id}
                        onClick={() => handleExportPhotosPdf(rec)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-[10px] font-black cursor-pointer shadow-xs transition-colors"
                        title="تحويل صور وبيانات الزبون إلى ملف PDF"
                      >
                        {exportingPdfId === rec.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <FileText className="w-3 h-3" />
                        )}
                        <span>{exportingPdfId === rec.id ? 'جاري...' : 'PDF صور الزبون'}</span>
                      </button>

                      {isStrictAdmin && (
                        <>
                          {!isApproved && (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => handleChangeDefinitionStatus(rec, 'approved')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-[10px] font-black cursor-pointer"
                            >
                              {isUpdating ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3" />
                              )}
                              <span>قبول</span>
                            </button>
                          )}

                          {!isRejected && (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => {
                                setRejectingId(isRejectingThis ? null : rec.id);
                                setRejectionReasonInput('');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-[10px] font-black cursor-pointer"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>رفض</span>
                            </button>
                          )}

                          {(isApproved || isRejected) && (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => handleChangeDefinitionStatus(rec, 'pending')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-[10px] font-black cursor-pointer"
                              title="إعادة الطلب إلى قيد المراجعة"
                            >
                              <Clock className="w-3 h-3" />
                              <span>مراجعة</span>
                            </button>
                          )}

                          {isConfirmingDel ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDeleteDefinition(rec)}
                                className="px-2 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black cursor-pointer"
                              >
                                تأكيد
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold cursor-pointer"
                              >
                                إلغاء
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(rec.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded-lg cursor-pointer"
                              title="حذف الطلب"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {isStrictAdmin && isRejectingThis && (
                    <div
                      className={`p-2 rounded-xl border space-y-1.5 ${
                        isDarkMode
                          ? 'bg-rose-950/50 border-rose-700/70'
                          : 'bg-rose-50 border-rose-200'
                      }`}
                    >
                      <input
                        type="text"
                        value={rejectionReasonInput}
                        onChange={(e) => setRejectionReasonInput(e.target.value)}
                        placeholder="سبب الرفض (اختياري)..."
                        className={`w-full px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                          isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-white'
                            : 'bg-white border-rose-300 text-slate-900'
                        }`}
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() =>
                            handleChangeDefinitionStatus(rec, 'rejected', rejectionReasonInput)
                          }
                          className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-[10px] font-black cursor-pointer"
                        >
                          {isUpdating ? 'جاري الإرسال...' : 'تأكيد الرفض وإشعار المندوب'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectionReasonInput('');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
          dir="rtl"
        >
          <div
            className="w-full max-w-2xl bg-slate-900 rounded-2xl p-3 border border-slate-700 space-y-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 text-white">
              <span className="text-xs sm:text-sm font-black flex items-center gap-1.5 truncate">
                <ImageIcon className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="truncate">{previewImage.title}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isExportingSinglePdf}
                  onClick={handleExportSinglePreviewPdf}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-[11px] font-black cursor-pointer"
                >
                  {isExportingSinglePdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  <span>{isExportingSinglePdf ? 'جاري التحويل...' : 'تحويل إلى PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <img
              src={previewImage.src}
              alt={previewImage.title}
              className="w-full max-h-[75vh] object-contain rounded-xl bg-black"
            />
          </div>
        </div>
      )}
    </div>
  );
};
