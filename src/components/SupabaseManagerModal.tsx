import React, { useState, useEffect } from 'react';
import {
  X,
  Database,
  HardDrive,
  Upload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileSpreadsheet,
  Image as ImageIcon,
  Copy,
  ExternalLink,
  Users,
  Package,
  Layers,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Server,
  CloudUpload,
  Code2,
  Sparkles,
  Search,
  PlusCircle,
  Radio,
  TrendingUp,
  Terminal,
  Zap,
} from 'lucide-react';
import {
  checkSupabaseSchemaStatus,
  refreshPostgrestSchemaCache,
  configureSupabaseStorageBuckets,
  fetchSupabaseRepresentatives,
  upsertSupabaseRepresentative,
  fetchSupabaseProducts,
  upsertSupabaseProduct,
  fetchSupabaseSales,
  upsertSupabaseSale,
  fetchSupabaseSalesRecords,
  upsertSupabaseSalesRecord,
  fetchSupabaseInvoices,
  upsertSupabaseInvoice,
  subscribeToSupabaseTable,
  parseAndUploadSalesExcelToSupabase,
  uploadInvoiceImageToStorage,
  uploadProductImageToStorage,
  uploadExcelToSupabaseStorage,
  seedSupabaseFromCurrentData,
  listSalesBucketFiles,
  SupabaseSchemaStatus,
  SupabaseRepresentative,
  SupabaseProduct,
  SupabaseSale,
  SupabaseSalesRecord,
  SupabaseInvoice,
  SupabaseUploadResult,
  ExcelSalesParseResult,
} from '../lib/supabaseService';
import {
  SUPABASE_URL,
  BUCKET_SALES,
  BUCKET_INVOICE_IMAGES,
  BUCKET_PRODUCT_IMAGES,
} from '../lib/supabaseClient';
import { SUPABASE_SQL_SCHEMA } from '../lib/supabaseSchemaCode';
import { useSales } from '../context/SalesContext';

interface SupabaseManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}

export const SupabaseManagerModal: React.FC<SupabaseManagerModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
}) => {
  const { productsList, delegateAccounts, salesEntries, allSalesEntries, setUserMessage } = useSales();

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'status' | 'tables' | 'excel_analytics' | 'storage' | 'schema'>('status');

  // Schema & Cache State
  const [schemaStatus, setSchemaStatus] = useState<SupabaseSchemaStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);
  const [isRefreshingCache, setIsRefreshingCache] = useState<boolean>(false);
  const [cacheRefreshFeedback, setCacheRefreshFeedback] = useState<string | null>(null);

  // Active Table Sub-tab
  const [activeTable, setActiveTable] = useState<'products' | 'representatives' | 'sales' | 'sales_records' | 'invoices'>('products');
  const [tableSearchQuery, setTableSearchQuery] = useState<string>('');

  // Table Data State
  const [products, setProducts] = useState<SupabaseProduct[]>([]);
  const [representatives, setRepresentatives] = useState<SupabaseRepresentative[]>([]);
  const [sales, setSales] = useState<SupabaseSale[]>([]);
  const [salesRecords, setSalesRecords] = useState<SupabaseSalesRecord[]>([]);
  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [isTableLoading, setIsTableLoading] = useState<boolean>(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableSuccess, setTableSuccess] = useState<string | null>(null);
  const [realtimeActive, setRealtimeActive] = useState<boolean>(true);

  // Add Record Modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newProdName, setNewProdName] = useState<string>('');
  const [newProdPrice, setNewProdPrice] = useState<number>(0);
  const [newProdCategory, setNewProdCategory] = useState<string>('عام');
  const [newRepName, setNewRepName] = useState<string>('');
  const [newRepPhone, setNewRepPhone] = useState<string>('');
  const [newRepTargetKg, setNewRepTargetKg] = useState<number>(0);
  const [newSaleCustomer, setNewSaleCustomer] = useState<string>('');
  const [newSalePhone, setNewSalePhone] = useState<string>('');
  const [newSaleAmount, setNewSaleAmount] = useState<number>(0);
  const [newSaleRepId, setNewSaleRepId] = useState<string>('');

  // Storage Tab State
  const [activeBucketTab, setActiveBucketTab] = useState<'sales-bucket' | 'invoice-images' | 'product-images'>('sales-bucket');
  const [bucketFiles, setBucketFiles] = useState<any[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [lastUploadResult, setLastUploadResult] = useState<SupabaseUploadResult | null>(null);

  // Excel Parsing
  const [isParsingExcel, setIsParsingExcel] = useState<boolean>(false);
  const [excelParseResult, setExcelParseResult] = useState<ExcelSalesParseResult | null>(null);

  // Seeding State
  const [isSeeding, setIsSeeding] = useState<boolean>(false);

  // Copy Feedback
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // On Open
  useEffect(() => {
    if (isOpen) {
      handleRefreshStatus();
      loadTableData(activeTable);
      loadBucketFiles(activeBucketTab);
    }
  }, [isOpen]);

  // Realtime subscription
  useEffect(() => {
    if (!isOpen || !realtimeActive) return;

    const unsubProd = subscribeToSupabaseTable('products', () => loadTableData('products'));
    const unsubRep = subscribeToSupabaseTable('representatives', () => loadTableData('representatives'));
    const unsubSale = subscribeToSupabaseTable('sales', () => loadTableData('sales'));
    const unsubSr = subscribeToSupabaseTable('sales_records', () => loadTableData('sales_records'));
    const unsubInv = subscribeToSupabaseTable('invoices', () => loadTableData('invoices'));

    return () => {
      unsubProd();
      unsubRep();
      unsubSale();
      unsubSr();
      unsubInv();
    };
  }, [isOpen, realtimeActive]);

  // Reload table data on table switch
  useEffect(() => {
    if (isOpen && activeTab === 'tables') {
      loadTableData(activeTable);
    }
  }, [activeTable, activeTab, isOpen]);

  // Reload bucket files on bucket switch
  useEffect(() => {
    if (isOpen && activeTab === 'storage') {
      loadBucketFiles(activeBucketTab);
    }
  }, [activeBucketTab, activeTab, isOpen]);

  const handleRefreshStatus = async () => {
    setIsCheckingStatus(true);
    try {
      const status = await checkSupabaseSchemaStatus();
      setSchemaStatus(status);

      // Auto-seed empty representatives / sales tables if schema exists
      if (
        status.tables.products.exists &&
        status.tables.representatives.exists &&
        (status.tables.representatives.count === 0 || status.tables.sales.count === 0)
      ) {
        const salesToSync = allSalesEntries && allSalesEntries.length > 0 ? allSalesEntries : salesEntries;
        if (delegateAccounts.length > 0 || salesToSync.length > 0) {
          const res = await seedSupabaseFromCurrentData(productsList, delegateAccounts, salesToSync);
          if (res.representativesCount > 0 || res.salesCount > 0) {
            const updatedStatus = await checkSupabaseSchemaStatus();
            setSchemaStatus(updatedStatus);
          }
        }
      }
    } catch (err: any) {
      console.error('Error checking schema status:', err);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleRefreshSchemaCache = async () => {
    setIsRefreshingCache(true);
    setCacheRefreshFeedback(null);
    try {
      const res = await refreshPostgrestSchemaCache();
      setCacheRefreshFeedback(res.message);
      await handleRefreshStatus();
      loadTableData(activeTable);
    } catch (err: any) {
      setCacheRefreshFeedback(`خطأ في تحديث ذاكرة المخطط: ${err.message}`);
    } finally {
      setIsRefreshingCache(false);
    }
  };

  const loadTableData = async (table: 'products' | 'representatives' | 'sales' | 'sales_records' | 'invoices') => {
    setIsTableLoading(true);
    setTableError(null);
    try {
      if (table === 'products') {
        const { data, error } = await fetchSupabaseProducts();
        if (error) setTableError(error);
        else setProducts(data);
      } else if (table === 'representatives') {
        const { data, error } = await fetchSupabaseRepresentatives();
        if (error) setTableError(error);
        else setRepresentatives(data);
      } else if (table === 'sales') {
        const { data, error } = await fetchSupabaseSales(100);
        if (error) setTableError(error);
        else setSales(data);
      } else if (table === 'sales_records') {
        const { data, error } = await fetchSupabaseSalesRecords();
        if (error) setTableError(error);
        else setSalesRecords(data);
      } else if (table === 'invoices') {
        const { data, error } = await fetchSupabaseInvoices(100);
        if (error) setTableError(error);
        else setInvoices(data);
      }
    } finally {
      setIsTableLoading(false);
    }
  };

  const loadBucketFiles = async (bucketId: string) => {
    setIsLoadingFiles(true);
    try {
      const { files, error } = await listSalesBucketFiles('', bucketId);
      if (!error) setBucketFiles(files);
      else setBucketFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2500);
  };

  const handleSeedAllData = async () => {
    setIsSeeding(true);
    setTableError(null);
    setTableSuccess(null);
    try {
      const salesToSync = allSalesEntries && allSalesEntries.length > 0 ? allSalesEntries : salesEntries;
      const result = await seedSupabaseFromCurrentData(productsList, delegateAccounts, salesToSync);
      const total =
        result.representativesCount +
        result.productsCount +
        result.salesCount +
        result.salesRecordsCount +
        result.invoicesCount;

      if (total > 0) {
        setTableSuccess(
          `تمت مزامنة وتغذية ${total} سجل في جداول Supabase (${result.productsCount} منتج، ${result.representativesCount} مندوب، ${result.salesCount} مبيعات)!`
        );
        setUserMessage('تمت مزامنة قاعدة بيانات Supabase بنجاح 🚀');
        await handleRefreshStatus();
        loadTableData(activeTable);
      } else if (result.errors.length > 0) {
        setTableError(`تنبيه: ${result.errors.join(' | ')}. يرجى التأكد من تشغيل كود SQL أولاً.`);
      }
    } catch (err: any) {
      setTableError(`فشل المزامنة: ${err.message}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTableLoading(true);
    setTableError(null);
    setTableSuccess(null);

    try {
      if (activeTable === 'products') {
        if (!newProdName.trim()) return;
        const { error } = await upsertSupabaseProduct({
          name: newProdName.trim(),
          price: Number(newProdPrice) || 0,
          category: newProdCategory.trim() || 'عام',
        });
        if (error) setTableError(error);
        else {
          setTableSuccess(`تمت إضافة المنتج "${newProdName}" بنجاح.`);
          setNewProdName('');
          setNewProdPrice(0);
          setShowAddModal(false);
          loadTableData('products');
        }
      } else if (activeTable === 'representatives') {
        if (!newRepName.trim()) return;
        const { error } = await upsertSupabaseRepresentative({
          name: newRepName.trim(),
          phone: newRepPhone.trim(),
        });
        if (error) setTableError(error);
        else {
          setTableSuccess(`تمت إضافة المندوب "${newRepName}" بنجاح.`);
          setNewRepName('');
          setNewRepPhone('');
          setNewRepTargetKg(0);
          setShowAddModal(false);
          loadTableData('representatives');
        }
      } else if (activeTable === 'sales') {
        if (!newSaleCustomer.trim()) return;
        const { error } = await upsertSupabaseSale({
          customer_name: newSaleCustomer.trim(),
          customer_phone: newSalePhone.trim(),
          total_amount: Number(newSaleAmount) || 0,
          representative_id: newSaleRepId || undefined,
        });
        if (error) setTableError(error);
        else {
          setTableSuccess(`تم تسجيل حركة البيع للعميل "${newSaleCustomer}" بنجاح.`);
          setNewSaleCustomer('');
          setNewSalePhone('');
          setNewSaleAmount(0);
          setShowAddModal(false);
          loadTableData('sales');
        }
      }
    } finally {
      setIsTableLoading(false);
    }
  };

  const handleExcelUploadAndParse = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingExcel(true);
    setExcelParseResult(null);
    setTableError(null);

    try {
      const result = await parseAndUploadSalesExcelToSupabase(file);
      setExcelParseResult(result);
      if (result.success) {
        setUserMessage(`تم تحليل الإكسل وتخزين ${result.recordsCount} سجل مبيعات في Supabase 📊`);
        handleRefreshStatus();
        loadBucketFiles('sales-bucket');
        if (activeTable === 'sales' || activeTable === 'sales_records') loadTableData(activeTable);
      } else {
        setTableError(result.error || 'فشل تحليل ملف الإكسل');
      }
    } catch (err: any) {
      setTableError(err.message || 'حدث خطأ أثناء معالجة الملف');
    } finally {
      setIsParsingExcel(false);
    }
  };

  const handleGenericFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    bucket: 'sales-bucket' | 'invoice-images' | 'product-images'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setLastUploadResult(null);

    try {
      let res: SupabaseUploadResult;
      if (bucket === 'sales-bucket') {
        res = await uploadExcelToSupabaseStorage(file, { uploadedBy: 'مدير النظام' });
      } else if (bucket === 'invoice-images') {
        res = await uploadInvoiceImageToStorage(file, `inv_${Date.now()}`);
      } else {
        res = await uploadProductImageToStorage(file, `prod_${Date.now()}`);
      }

      setLastUploadResult(res);
      if (res.success) {
        setUserMessage(`تم رفع الملف وتوليد الرابط العام في حاوية ${bucket} 📁`);
        loadBucketFiles(bucket);
      } else {
        setUserMessage(`فشل الرفع: ${res.error}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const isMissingSchemaCache =
    schemaStatus &&
    (!schemaStatus.tables.products.exists ||
      !schemaStatus.tables.representatives.exists ||
      !schemaStatus.tables.sales.exists);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-5xl max-h-[94vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden transition-all duration-300 ${
          isDarkMode
            ? 'bg-slate-900 border-emerald-500/30 text-white'
            : 'bg-white border-emerald-600/30 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between p-4 sm:p-5 border-b shrink-0 ${
            isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-emerald-50/70 border-emerald-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/30 shadow-xs">
              <Database className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight">
                  إدارة قاعدة بيانات Supabase وذاكرة المخطط (Schema Cache)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  PostgREST Engine
                </span>
                {realtimeActive && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30">
                    <Radio className="w-2.5 h-2.5 animate-ping text-sky-500" />
                    <span>Realtime Sync</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold truncate max-w-md">
                {SUPABASE_URL}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Schema Cache Alert Banner */}
        {isMissingSchemaCache && (
          <div className="px-4 py-3 bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 animate-bounce" />
              <div>
                <span className="font-black text-amber-800 dark:text-amber-300">
                  تنبيه: الجداول غير موجودة في ذاكرة المخطط (Could not find the table in the schema cache)
                </span>
                <p className="text-[11px] opacity-90 mt-0.5">
                  الاتصال بخادم Supabase نشط، ولكن جداول <code className="font-mono font-bold">products</code> و <code className="font-mono font-bold">representatives</code> و <code className="font-mono font-bold">sales</code> بحاجة إلى إنشاء في PostgreSQL ثم تحديث ذاكرة PostgREST.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => copyToClipboard(SUPABASE_SQL_SCHEMA)}
                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedText === SUPABASE_SQL_SCHEMA ? 'تم النسخ!' : 'نسخ كود SQL'}</span>
              </button>
              <a
                href="https://supabase.com/dashboard/project/liywmqqmwpwkhdvsxsqj/sql/new"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>فتح SQL Editor</span>
              </a>
              <button
                type="button"
                onClick={handleRefreshSchemaCache}
                disabled={isRefreshingCache}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCache ? 'animate-spin' : ''}`} />
                <span>تحديث الكاش فوراً</span>
              </button>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 pt-2.5 border-b text-xs font-bold overflow-x-auto ${
            isDarkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('status')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-t-xl border-b-2 font-black transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'status'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>حالة المخطط والكاش (Schema Cache)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tables')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-t-xl border-b-2 font-black transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'tables'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>الجداول والمزامنة (products, reps, sales)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('schema')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-t-xl border-b-2 font-black transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'schema'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>سكربت الترحيل SQL وتحديث الكاش</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('excel_analytics')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-t-xl border-b-2 font-black transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'excel_analytics'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>معالج الإكسل والمبيعات</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-t-xl border-b-2 font-black transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'storage'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>حاويات التخزين (3 Buckets)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-right">
          {/* ========================================================================= */}
          {/* TAB 1: Status & PostgREST Schema Cache Dashboard */}
          {/* ========================================================================= */}
          {activeTab === 'status' && (
            <div className="space-y-5">
              {/* Cache Refresh Action Card */}
              <div
                className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                  !isMissingSchemaCache
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black ${
                      !isMissingSchemaCache
                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                        : 'bg-amber-500 text-slate-950'
                    }`}
                  >
                    {isRefreshingCache || isCheckingStatus ? (
                      <RefreshCw className="w-6 h-6 animate-spin" />
                    ) : !isMissingSchemaCache ? (
                      <CheckCircle2 className="w-6 h-6" />
                    ) : (
                      <AlertCircle className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm sm:text-base font-black">
                      {!isMissingSchemaCache
                        ? 'ذاكرة المخطط (Schema Cache) محملة وجاهزة بنسبة 100% 🟢'
                        : 'جداول المخطط مفقودة أو بانتظار تحديث كاش PostgREST'}
                    </h4>
                    <p className="text-xs opacity-90 mt-0.5">
                      {cacheRefreshFeedback ||
                        schemaStatus?.message ||
                        'يقوم محرك PostgREST بمزامنة الكاش لإتاحة الجداول عبر الـ REST API.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={handleRefreshSchemaCache}
                    disabled={isRefreshingCache}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCache ? 'animate-spin' : ''}`} />
                    <span>تحديث ذاكرة المخطط (Reload Cache)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshStatus}
                    disabled={isCheckingStatus}
                    className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer"
                    title="إعادة الفحص"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Required Tables Status Cards */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h5 className="font-black text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-500" />
                    <span>جداول Supabase المطلوبة في المخطط (Required Tables):</span>
                  </h5>
                  <span className="text-[11px] text-slate-400">
                    زمن الاستجابة: {schemaStatus?.latencyMs ? `${schemaStatus.latencyMs} ms` : '—'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Table 1: products */}
                  <div
                    className={`p-4 rounded-2xl border flex flex-col justify-between ${
                      isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">
                          products
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            schemaStatus?.tables.products.exists
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {schemaStatus?.tables.products.exists
                            ? `${schemaStatus.tables.products.count} منتج 🟢`
                            : 'مفقود بالكاش ❌'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        (id, name, price, category, image_url, created_at)
                      </p>
                    </div>
                  </div>

                  {/* Table 2: representatives */}
                  <div
                    className={`p-4 rounded-2xl border flex flex-col justify-between ${
                      isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">
                          representatives
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            schemaStatus?.tables.representatives.exists
                              ? `${schemaStatus.tables.representatives.count} مندوب 🟢`
                              : 'مفقود بالكاش ❌'
                          }`}
                        >
                          {schemaStatus?.tables.representatives.exists
                            ? `${schemaStatus.tables.representatives.count} مندوب 🟢`
                            : 'مفقود بالكاش ❌'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        (id, name, phone, target_kg, created_at)
                      </p>
                    </div>
                  </div>

                  {/* Table 3: sales */}
                  <div
                    className={`p-4 rounded-2xl border flex flex-col justify-between ${
                      isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">
                          sales
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            schemaStatus?.tables.sales.exists
                              ? `${schemaStatus.tables.sales.count} حركة 🟢`
                              : 'مفقود بالكاش ❌'
                          }`}
                        >
                          {schemaStatus?.tables.sales.exists
                            ? `${schemaStatus.tables.sales.count} حركة 🟢`
                            : 'مفقود بالكاش ❌'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        (id, representative_id, customer_name, customer_phone, total_amount, invoice_image_url)
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Seed Button Callout */}
              <div
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 ${
                  isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                <div>
                  <h5 className="font-black text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-emerald-500" />
                    <span>مزامنة وتغذية الجداول الأولية تلقائياً (Zero-Intervention Data Seeding)</span>
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    تصدير ومزامنة المنتجات الحالية ({productsList.length}) والمندوبين وأهدافهم ({delegateAccounts.length}) والمبيعات ({salesEntries.length}) إلى Supabase.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSeedAllData}
                  disabled={isSeeding}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs flex items-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ArrowUpFromLine className={`w-4 h-4 ${isSeeding ? 'animate-bounce' : ''}`} />
                  <span>{isSeeding ? 'جاري التغذية...' : 'مزامنة كافة البيانات إلى Supabase'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: Dynamic Tables & Realtime Manager */}
          {/* ========================================================================= */}
          {activeTab === 'tables' && (
            <div className="space-y-4">
              {tableError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{tableError}</span>
                </div>
              )}
              {tableSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{tableSuccess}</span>
                </div>
              )}

              {/* Table Selector Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setActiveTable('products')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      activeTable === 'products'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    المنتجات products ({products.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTable('representatives')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      activeTable === 'representatives'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    المندوبين representatives ({representatives.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTable('sales')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      activeTable === 'sales'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    المبيعات sales ({sales.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTable('sales_records')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      activeTable === 'sales_records'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    أهداف المبيعات sales_records ({salesRecords.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTable('invoices')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      activeTable === 'invoices'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    الفواتير invoices ({invoices.length})
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>إضافة سجل جديد</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadTableData(activeTable)}
                    disabled={isTableLoading}
                    className="p-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-emerald-500 transition-colors cursor-pointer"
                    title="تحديث البيانات"
                  >
                    <RefreshCw className={`w-4 h-4 ${isTableLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder={`البحث في جدول ${activeTable}...`}
                  value={tableSearchQuery}
                  onChange={(e) => setTableSearchQuery(e.target.value)}
                  className="w-full pr-9 pl-4 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Render Table Content */}
              <div
                className={`rounded-2xl border overflow-hidden ${
                  isDarkMode ? 'border-slate-800 bg-slate-900/80' : 'border-slate-200 bg-white shadow-sm'
                }`}
              >
                {/* 1. Products View */}
                {activeTable === 'products' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead
                        className={`${
                          isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <tr>
                          <th className="p-3 font-black"># ID</th>
                          <th className="p-3 font-black">اسم المنتج (name)</th>
                          <th className="p-3 font-black">السعر (price)</th>
                          <th className="p-3 font-black">التصنيف (category)</th>
                          <th className="p-3 font-black">رابط الصورة (image_url)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {products
                          .filter(
                            (p) =>
                              !tableSearchQuery ||
                              p.name.toLowerCase().includes(tableSearchQuery.toLowerCase()) ||
                              p.category?.toLowerCase().includes(tableSearchQuery.toLowerCase())
                          )
                          .map((p, idx) => (
                            <tr
                              key={p.id || idx}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors font-mono"
                            >
                              <td className="p-3 text-slate-400">{p.id}</td>
                              <td className="p-3 font-bold font-sans text-slate-800 dark:text-slate-100">
                                {p.name}
                              </td>
                              <td className="p-3 font-bold text-emerald-600 dark:text-emerald-400">
                                {Number(p.price).toLocaleString()} د.ع
                              </td>
                              <td className="p-3 font-sans text-slate-600 dark:text-slate-300">
                                {p.category || 'عام'}
                              </td>
                              <td className="p-3">
                                {p.image_url ? (
                                  <a
                                    href={p.image_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sky-500 hover:underline flex items-center gap-1 text-[11px]"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>عرض الصورة</span>
                                  </a>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        {products.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-slate-400 font-sans">
                              {isTableLoading
                                ? 'جاري جلب المنتجات من Supabase...'
                                : 'لا توجد منتجات مسجلة في جدول products.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 2. Representatives View */}
                {activeTable === 'representatives' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead
                        className={`${
                          isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <tr>
                          <th className="p-3 font-black"># ID</th>
                          <th className="p-3 font-black">اسم المندوب (name)</th>
                          <th className="p-3 font-black">الهاتف (phone)</th>
                          <th className="p-3 font-black">الهدف الشهري (target_kg)</th>
                          <th className="p-3 font-black">تاريخ التسجيل (created_at)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {representatives
                          .filter(
                            (r) =>
                              !tableSearchQuery ||
                              r.name.toLowerCase().includes(tableSearchQuery.toLowerCase()) ||
                              r.phone?.includes(tableSearchQuery)
                          )
                          .map((r, idx) => (
                            <tr
                              key={r.id || idx}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors font-mono"
                            >
                              <td className="p-3 text-slate-400">{r.id}</td>
                              <td className="p-3 font-bold font-sans text-slate-800 dark:text-slate-100">
                                {r.name}
                              </td>
                              <td className="p-3 text-slate-600 dark:text-slate-300">{r.phone || '—'}</td>
                              <td className="p-3 font-bold text-emerald-600 dark:text-emerald-400">
                                {Number(r.target_kg || 0).toLocaleString()} كغم
                              </td>
                              <td className="p-3 text-slate-400 text-[11px]">
                                {r.created_at ? new Date(r.created_at).toLocaleDateString('ar-IQ') : '—'}
                              </td>
                            </tr>
                          ))}
                        {representatives.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-slate-400 font-sans">
                              {isTableLoading
                                ? 'جاري جلب المندوبين من Supabase...'
                                : 'لا يوجد مندوبين مسجلين في جدول representatives.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 3. Sales View */}
                {activeTable === 'sales' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead
                        className={`${
                          isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <tr>
                          <th className="p-3 font-black"># ID</th>
                          <th className="p-3 font-black">اسم الزبون (customer_name)</th>
                          <th className="p-3 font-black">الهاتف (customer_phone)</th>
                          <th className="p-3 font-black">المندوب (representative_id)</th>
                          <th className="p-3 font-black">المبلغ (total_amount)</th>
                          <th className="p-3 font-black">صورة الفاتورة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sales
                          .filter(
                            (s) =>
                              !tableSearchQuery ||
                              s.customer_name.toLowerCase().includes(tableSearchQuery.toLowerCase()) ||
                              s.representative_name?.toLowerCase().includes(tableSearchQuery.toLowerCase())
                          )
                          .map((s, idx) => (
                            <tr
                              key={s.id || idx}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors font-mono"
                            >
                              <td className="p-3 text-slate-400">{s.id}</td>
                              <td className="p-3 font-bold font-sans text-slate-800 dark:text-slate-100">
                                {s.customer_name}
                              </td>
                              <td className="p-3 text-slate-600 dark:text-slate-300">
                                {s.customer_phone || '—'}
                              </td>
                              <td className="p-3 font-sans text-emerald-600 dark:text-emerald-400 font-bold">
                                {s.representative_name || s.representative_id || 'عام'}
                              </td>
                              <td className="p-3 font-bold text-sky-600 dark:text-sky-400">
                                {Number(s.total_amount).toLocaleString()} د.ع
                              </td>
                              <td className="p-3">
                                {s.invoice_image_url ? (
                                  <a
                                    href={s.invoice_image_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sky-500 hover:underline flex items-center gap-1 text-[11px]"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>عرض</span>
                                  </a>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        {sales.length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400 font-sans">
                              {isTableLoading
                                ? 'جاري جلب حركات المبيعات من Supabase...'
                                : 'لا توجد حركات مسجلة في جدول sales.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 4. Sales Records View */}
                {activeTable === 'sales_records' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead
                        className={`${
                          isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <tr>
                          <th className="p-3 font-black">الشهر</th>
                          <th className="p-3 font-black">المندوب</th>
                          <th className="p-3 font-black">الهدف (كغم)</th>
                          <th className="p-3 font-black">المبيعات (كغم)</th>
                          <th className="p-3 font-black">نسبة الإنجاز</th>
                          <th className="p-3 font-black">الزبائن (مستهدف / مقبول)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {salesRecords.map((s, idx) => {
                          const pct = s.target_kg > 0 ? Math.round((s.sales_kg / s.target_kg) * 100) : 0;
                          return (
                            <tr key={s.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 font-mono">
                              <td className="p-3 font-bold">{s.month_year}</td>
                              <td className="p-3 font-sans font-bold text-emerald-600">{s.representative_name}</td>
                              <td className="p-3">{Number(s.target_kg).toLocaleString()}</td>
                              <td className="p-3 font-bold">{Number(s.sales_kg).toLocaleString()}</td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${pct >= 100 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                  {pct}%
                                </span>
                              </td>
                              <td className="p-3 font-sans">{s.acceptable_customer} من {s.target_customer}</td>
                            </tr>
                          );
                        })}
                        {salesRecords.length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400 font-sans">
                              لا توجد سجلات أهداف شهرية.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 5. Invoices View */}
                {activeTable === 'invoices' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead
                        className={`${
                          isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <tr>
                          <th className="p-3 font-black"># ID</th>
                          <th className="p-3 font-black">اسم العميل</th>
                          <th className="p-3 font-black">الهاتف</th>
                          <th className="p-3 font-black">المبلغ</th>
                          <th className="p-3 font-black">الصورة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {invoices.map((inv, idx) => (
                          <tr key={inv.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 font-mono">
                            <td className="p-3 text-slate-400">{inv.id}</td>
                            <td className="p-3 font-sans font-bold">{inv.customer_name}</td>
                            <td className="p-3">{inv.customer_phone || '—'}</td>
                            <td className="p-3 font-bold text-emerald-600">{Number(inv.total_amount).toLocaleString()} د.ع</td>
                            <td className="p-3">
                              {inv.invoice_image_url ? (
                                <a href={inv.invoice_image_url} target="_blank" rel="noreferrer" className="text-sky-500 hover:underline">
                                  معاينة
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                        {invoices.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-slate-400 font-sans">
                              لا توجد فواتير مسجلة في جدول invoices.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: SQL Migration & Schema Cache Refresh */}
          {/* ========================================================================= */}
          {activeTab === 'schema' && (
            <div className="space-y-4">
              <div
                className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                  isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-emerald-50/60 border-emerald-200'
                }`}
              >
                <div>
                  <h5 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>سكربت تهيئة الجداول وتحديث ذاكرة المخطط التلقائي (Schema Cache Refresh)</span>
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    يقوم هذا الكود بإنشاء الجداول المفقودة (<code className="font-mono">products, representatives, sales</code>) وتهيئة الحاويات وتشغيل أمر <code className="font-mono text-emerald-600">NOTIFY pgrst, 'reload schema';</code> فوراً.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(SUPABASE_SQL_SCHEMA)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                  >
                    {copiedText === SUPABASE_SQL_SCHEMA ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedText === SUPABASE_SQL_SCHEMA ? 'تم نسخ الكود!' : 'نسخ كود SQL بنقرة واحدة'}</span>
                  </button>

                  <a
                    href="https://supabase.com/dashboard/project/liywmqqmwpwkhdvsxsqj/sql/new"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-xl border border-emerald-600 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 font-bold text-xs flex items-center gap-1.5 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>محرر SQL</span>
                  </a>

                  <button
                    type="button"
                    onClick={handleRefreshSchemaCache}
                    disabled={isRefreshingCache}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCache ? 'animate-spin' : ''}`} />
                    <span>تحديث الكاش</span>
                  </button>
                </div>
              </div>

              {/* Instructions steps */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-black text-emerald-600">1. نسخ الكود:</span>
                  <p className="text-slate-600 dark:text-slate-400 text-[11px] mt-0.5">
                    اضغط زر "نسخ كود SQL" لنسخ أوامر DDL وتحديث الكاش.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-black text-emerald-600">2. التشغيل في Supabase:</span>
                  <p className="text-slate-600 dark:text-slate-400 text-[11px] mt-0.5">
                    الصق الكود في SQL Editor واضغط Run لإنشاء الجداول وإطلاق إشعار الكاش.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-black text-emerald-600">3. التحقق الفوري:</span>
                  <p className="text-slate-600 dark:text-slate-400 text-[11px] mt-0.5">
                    اضغط "تحديث الكاش" ليتم التعرف الفوري على الجداول ومزامنتها بنجاح.
                  </p>
                </div>
              </div>

              {/* Code Box */}
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 text-[11px] font-mono text-slate-400 bg-slate-900/80">
                  <span>supabase_schema_migration.sql</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(SUPABASE_SQL_SCHEMA)}
                    className="hover:text-emerald-400 flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>نسخ</span>
                  </button>
                </div>
                <pre className="p-4 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-72 dir-ltr">
                  <code>{SUPABASE_SQL_SCHEMA}</code>
                </pre>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: Excel Analytics */}
          {/* ========================================================================= */}
          {activeTab === 'excel_analytics' && (
            <div className="space-y-4">
              <div
                className={`p-4 sm:p-5 rounded-2xl border space-y-3 ${
                  isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 font-black text-sm text-emerald-600 dark:text-emerald-400">
                  <FileSpreadsheet className="w-5 h-5" />
                  <span>معالج شيتات الإكسل الآلي ومطابقة مقاييس المبيعات والأوزان</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ارفع أي ملف مبيعات إكسل؛ ليقوم النظام تلقائياً برفع الملف إلى <code className="font-mono">sales-bucket</code>، واستخراج المندوبين والمبيعات واحتساب الأوزان في جداول Supabase.
                </p>

                <label className="w-full py-6 px-4 rounded-2xl border-2 border-dashed border-emerald-500/50 hover:border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all text-center">
                  <CloudUpload className={`w-8 h-8 text-emerald-500 ${isParsingExcel ? 'animate-bounce' : ''}`} />
                  <span className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300">
                    {isParsingExcel
                      ? 'جاري التحليل والرفع والمزامنة...'
                      : 'اختر أو اسحب ملف مبيعات الإكسل (.xlsx, .xls) للتحليل الفوري'}
                  </span>
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    disabled={isParsingExcel}
                    onChange={handleExcelUploadAndParse}
                    className="hidden"
                  />
                </label>
              </div>

              {excelParseResult && (
                <div
                  className={`p-4 sm:p-5 rounded-2xl border space-y-4 ${
                    isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200 shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2 font-black text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>تم تحليل وحفظ بيانات ملف الإكسل في Supabase بنجاح!</span>
                    </div>
                    {excelParseResult.fileUrl && (
                      <a
                        href={excelParseResult.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-sky-500 hover:underline flex items-center gap-1 font-bold"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>رابط الملف في التخزين</span>
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <p className="text-[10px] text-slate-500">سجلات المندوبين</p>
                      <p className="text-base sm:text-lg font-black text-emerald-600">
                        {excelParseResult.recordsCount}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <p className="text-[10px] text-slate-500">إجمالي المبيعات المحققة</p>
                      <p className="text-base sm:text-lg font-black text-sky-600">
                        {Number(excelParseResult.totalSalesKg).toLocaleString()} كغم
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <p className="text-[10px] text-slate-500">إجمالي الهدف المطلوب</p>
                      <p className="text-base sm:text-lg font-black text-amber-600">
                        {Number(excelParseResult.totalTargetKg).toLocaleString()} كغم
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <p className="text-[10px] text-slate-500">الزبائن</p>
                      <p className="text-base sm:text-lg font-black text-teal-600">
                        {excelParseResult.totalCustomers}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 5: Storage Buckets */}
          {/* ========================================================================= */}
          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b pb-2">
                <button
                  type="button"
                  onClick={() => setActiveBucketTab('sales-bucket')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeBucketTab === 'sales-bucket'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>sales-bucket (ملفات الإكسل والتقارير)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveBucketTab('invoice-images')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeBucketTab === 'invoice-images'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>invoice-images (صور الفواتير)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveBucketTab('product-images')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeBucketTab === 'product-images'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>product-images (صور المنتجات)</span>
                </button>
              </div>

              <div
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 ${
                  isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <h5 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <CloudUpload className="w-4 h-4 text-sky-500" />
                    <span>رفع ملف إلى حاوية: <code className="font-mono text-sky-600 dark:text-sky-400">{activeBucketTab}</code></span>
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    حفظ الملفات مع روابط عامة قابلة للمشاركة والاستعراض المباشر.
                  </p>
                </div>

                <label className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs flex items-center gap-2 shadow-sm transition-all cursor-pointer whitespace-nowrap active:scale-95 shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isUploading ? 'جاري الرفع...' : 'رفع ملف الآن'}</span>
                  <input
                    type="file"
                    accept={
                      activeBucketTab === 'sales-bucket'
                        ? '.xlsx, .xls, .csv'
                        : 'image/jpeg, image/png, image/webp'
                    }
                    disabled={isUploading}
                    onChange={(e) => handleGenericFileUpload(e, activeBucketTab)}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Bucket File Explorer */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h6 className="font-black text-xs text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-sky-500" />
                    <span>الملفات المسترجعة من <code className="font-mono text-sky-600">{activeBucketTab}</code> ({bucketFiles.length})</span>
                  </h6>
                  <button
                    type="button"
                    onClick={() => loadBucketFiles(activeBucketTab)}
                    disabled={isLoadingFiles}
                    className="p-1 text-slate-400 hover:text-sky-500 transition-colors cursor-pointer"
                    title="تحديث القائمة"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {bucketFiles.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-400 font-bold">
                    {isLoadingFiles
                      ? 'جاري استعراض محتويات الحاوية...'
                      : 'لا توجد ملفات مرفوعة حالياً في هذه الحاوية.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto">
                    {bucketFiles.map((file, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-base">
                            {file.name?.endsWith('.xlsx') || file.name?.endsWith('.xls')
                              ? '📊'
                              : '🖼️'}
                          </span>
                          <span className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
                            {file.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {file.publicUrl && (
                            <>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(file.publicUrl)}
                                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              >
                                {copiedText === file.publicUrl ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>نسخ</span>
                              </button>
                              <a
                                href={file.publicUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className={`flex items-center justify-between p-3 sm:p-4 border-t shrink-0 ${
            isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Supabase JS SDK v2.x | PostgreSQL 15 | PostgREST Schema Cache</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>

      {/* Mini Modal for Adding a New Record */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className={`w-full max-w-md p-5 rounded-3xl border shadow-xl ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3 mb-4 border-slate-200 dark:border-slate-800">
              <h4 className="font-black text-sm">
                إضافة سجل جديد إلى جدول: <span className="font-mono text-emerald-500">{activeTable}</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRecord} className="space-y-3 text-right text-xs">
              {activeTable === 'products' && (
                <>
                  <div>
                    <label className="block font-bold mb-1">اسم المنتج:</label>
                    <input
                      type="text"
                      required
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      placeholder="مثال: شاي الوزة 400 غرام"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">السعر (د.ع):</label>
                    <input
                      type="number"
                      required
                      value={newProdPrice}
                      onChange={(e) => setNewProdPrice(Number(e.target.value))}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">التصنيف:</label>
                    <input
                      type="text"
                      value={newProdCategory}
                      onChange={(e) => setNewProdCategory(e.target.value)}
                      placeholder="عام"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </>
              )}

              {activeTable === 'representatives' && (
                <>
                  <div>
                    <label className="block font-bold mb-1">اسم المندوب:</label>
                    <input
                      type="text"
                      required
                      value={newRepName}
                      onChange={(e) => setNewRepName(e.target.value)}
                      placeholder="مثال: أحمد عبد الله"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">رقم الهاتف:</label>
                    <input
                      type="text"
                      value={newRepPhone}
                      onChange={(e) => setNewRepPhone(e.target.value)}
                      placeholder="0770..."
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">الهدف الشهري (كغم):</label>
                    <input
                      type="number"
                      value={newRepTargetKg}
                      onChange={(e) => setNewRepTargetKg(Number(e.target.value))}
                      placeholder="5000"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </>
              )}

              {activeTable === 'sales' && (
                <>
                  <div>
                    <label className="block font-bold mb-1">اسم الزبون / العميل:</label>
                    <input
                      type="text"
                      required
                      value={newSaleCustomer}
                      onChange={(e) => setNewSaleCustomer(e.target.value)}
                      placeholder="مثال: أسواق السلام"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">رقم هاتف الزبون:</label>
                    <input
                      type="text"
                      value={newSalePhone}
                      onChange={(e) => setNewSalePhone(e.target.value)}
                      placeholder="0770..."
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">إجمالي المبلغ (د.ع):</label>
                    <input
                      type="number"
                      required
                      value={newSaleAmount}
                      onChange={(e) => setNewSaleAmount(Number(e.target.value))}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isTableLoading}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  حفظ السجل في Supabase
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default SupabaseManagerModal;
