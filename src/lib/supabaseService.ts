import {
  supabase,
  SUPABASE_STORAGE_BUCKET,
  BUCKET_SALES,
  BUCKET_INVOICE_IMAGES,
  BUCKET_PRODUCT_IMAGES,
  SUPABASE_URL,
} from './supabaseClient';
import * as XLSX from 'xlsx';
import { ProductItem, DelegateAccount, SalesEntry } from '../types';

// ====================================================================
// Type Definitions for Target Supabase Tables
// ====================================================================

export interface SupabaseRepresentative {
  id: string;
  name: string;
  phone?: string;
  target_kg?: number;
  created_at?: string;
}

export interface SupabaseProduct {
  id: string;
  name: string;
  price: number;
  category?: string;
  image_url?: string;
  created_at?: string;
}

export interface SupabaseSale {
  id: string;
  representative_id?: string;
  representative_name?: string;
  customer_name: string;
  customer_phone?: string;
  total_amount: number;
  invoice_image_url?: string;
  created_at?: string;
}

export interface SupabaseSalesRecord {
  id: string;
  representative_id?: string;
  representative_name?: string; // helper for UI display
  target_kg: number;
  sales_kg: number;
  target_customer: number;
  acceptable_customer: number;
  month_year: string;
  created_at?: string;
}

export interface SupabaseInvoice {
  id: string;
  customer_name: string;
  customer_phone?: string;
  total_amount: number;
  invoice_image_url?: string;
  created_at?: string;
}

export interface SupabaseUploadResult {
  success: boolean;
  publicUrl?: string;
  path?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  uploadedAt?: string;
  bucket?: string;
}

export interface SupabaseSchemaStatus {
  isConnected: boolean;
  tables: {
    products: { exists: boolean; count: number; error?: string };
    representatives: { exists: boolean; count: number; error?: string };
    sales: { exists: boolean; count: number; error?: string };
    sales_records: { exists: boolean; count: number; error?: string };
    invoices: { exists: boolean; count: number; error?: string };
  };
  buckets: {
    'sales-bucket': { exists: boolean; public: boolean; error?: string };
    'invoice-images': { exists: boolean; public: boolean; error?: string };
    'product-images': { exists: boolean; public: boolean; error?: string };
  };
  latencyMs: number;
  allTablesReady: boolean;
  allBucketsReady: boolean;
  message: string;
}

export interface ExcelSalesParseResult {
  success: boolean;
  fileUrl?: string;
  recordsCount: number;
  totalTargetKg: number;
  totalSalesKg: number;
  totalCustomers: number;
  records: Partial<SupabaseSalesRecord>[];
  representativesSynced: number;
  error?: string;
}

// Clean and normalize filenames
function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-\.]/g, '')
    .slice(0, 100);
}

// ====================================================================
// 1. Programmatic Storage Buckets Configuration
// ====================================================================

export const REQUIRED_BUCKETS = [
  { id: BUCKET_SALES, name: 'sales-bucket', description: 'Excel sheets and sales logs' },
  { id: BUCKET_INVOICE_IMAGES, name: 'invoice-images', description: 'Invoice snapshots and images' },
  { id: BUCKET_PRODUCT_IMAGES, name: 'product-images', description: 'Product catalog images' },
];

/**
 * Programmatically create and configure the required public Storage Buckets in Supabase.
 */
export async function configureSupabaseStorageBuckets(): Promise<{
  results: Record<string, { success: boolean; message: string }>;
  allReady: boolean;
}> {
  const results: Record<string, { success: boolean; message: string }> = {};
  let allReady = true;

  for (const b of REQUIRED_BUCKETS) {
    try {
      // 1. Check if bucket exists
      const { data: bucket, error: getErr } = await supabase.storage.getBucket(b.id);
      if (bucket && !getErr) {
        results[b.id] = { success: true, message: 'الحاوية موجودة وجاهزة 🟢' };
        continue;
      }

      // 2. Try to create bucket programmatically
      const { data, error: createErr } = await supabase.storage.createBucket(b.id, {
        public: true,
        fileSizeLimit: 52428800, // 50MB
      });

      if (!createErr || (createErr as any)?.message?.includes('already exists')) {
        results[b.id] = { success: true, message: 'تم إنشاء الحاوية العامة بنجاح 🟢' };
      } else {
        // If RLS blocked anon creation, note for SQL execution
        allReady = false;
        results[b.id] = {
          success: false,
          message: `بانتظار الإنشاء عبر SQL: ${createErr.message}`,
        };
      }
    } catch (err: any) {
      allReady = false;
      results[b.id] = {
        success: false,
        message: err.message || 'تعذر الوصول للحاوية',
      };
    }
  }

  return { results, allReady };
}

// ====================================================================
// 2. Health & Schema Status Check
// ====================================================================

export async function checkSupabaseSchemaStatus(): Promise<SupabaseSchemaStatus> {
  const start = performance.now();

  const tables = {
    products: { exists: false, count: 0, error: undefined as string | undefined },
    representatives: { exists: false, count: 0, error: undefined as string | undefined },
    sales: { exists: false, count: 0, error: undefined as string | undefined },
    sales_records: { exists: false, count: 0, error: undefined as string | undefined },
    invoices: { exists: false, count: 0, error: undefined as string | undefined },
  };

  const buckets = {
    'sales-bucket': { exists: false, public: true, error: undefined as string | undefined },
    'invoice-images': { exists: false, public: true, error: undefined as string | undefined },
    'product-images': { exists: false, public: true, error: undefined as string | undefined },
  };

  // 1. Test Tables in schema cache
  const [prodRes, repRes, salesMainRes, salesRecRes, invRes] = await Promise.allSettled([
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('representatives').select('id', { count: 'exact', head: true }),
    supabase.from('sales').select('id', { count: 'exact', head: true }),
    supabase.from('sales_records').select('id', { count: 'exact', head: true }),
    supabase.from('invoices').select('id', { count: 'exact', head: true }),
  ]);

  if (prodRes.status === 'fulfilled') {
    if (!prodRes.value.error) {
      tables.products.exists = true;
      tables.products.count = prodRes.value.count || 0;
    } else {
      tables.products.error = prodRes.value.error.message;
    }
  }

  if (repRes.status === 'fulfilled') {
    if (!repRes.value.error) {
      tables.representatives.exists = true;
      tables.representatives.count = repRes.value.count || 0;
    } else {
      tables.representatives.error = repRes.value.error.message;
    }
  }

  if (salesMainRes.status === 'fulfilled') {
    if (!salesMainRes.value.error) {
      tables.sales.exists = true;
      tables.sales.count = salesMainRes.value.count || 0;
    } else {
      tables.sales.error = salesMainRes.value.error.message;
    }
  }

  if (salesRecRes.status === 'fulfilled') {
    if (!salesRecRes.value.error) {
      tables.sales_records.exists = true;
      tables.sales_records.count = salesRecRes.value.count || 0;
    } else {
      tables.sales_records.error = salesRecRes.value.error.message;
    }
  }

  if (invRes.status === 'fulfilled') {
    if (!invRes.value.error) {
      tables.invoices.exists = true;
      tables.invoices.count = invRes.value.count || 0;
    } else {
      tables.invoices.error = invRes.value.error.message;
    }
  }

  // 2. Test Buckets
  try {
    const { data: bucketList, error: bListErr } = await supabase.storage.listBuckets();
    if (!bListErr && bucketList) {
      bucketList.forEach((b) => {
        if (b.id in buckets) {
          buckets[b.id as keyof typeof buckets].exists = true;
          buckets[b.id as keyof typeof buckets].public = b.public;
        }
      });
    }
  } catch (err: any) {
    for (const bId of ['sales-bucket', 'invoice-images', 'product-images'] as const) {
      try {
        const { error } = await supabase.storage.from(bId).list('', { limit: 1 });
        if (!error) {
          buckets[bId].exists = true;
        } else {
          buckets[bId].error = error.message;
        }
      } catch {}
    }
  }

  const latencyMs = Math.round(performance.now() - start);
  const primaryTablesReady = tables.products.exists && tables.representatives.exists && (tables.sales.exists || tables.sales_records.exists);
  const allTablesReady = tables.products.exists && tables.representatives.exists && tables.sales.exists && tables.sales_records.exists && tables.invoices.exists;

  const allBucketsReady =
    buckets['sales-bucket'].exists &&
    buckets['invoice-images'].exists &&
    buckets['product-images'].exists;

  const isConnected = primaryTablesReady || allBucketsReady || Object.values(tables).some(t => t.exists);

  let message = 'متصل بخدمة Supabase بنجاح.';
  if (!primaryTablesReady) {
    message = 'الجداول مفقودة في ذاكرة المخطط (Schema Cache). يرجى تنفيذ سكربت الترحيل SQL وتحديث الكاش.';
  } else if (primaryTablesReady && allBucketsReady) {
    message = 'جداول المبيعات والمنتجات والمندوبين وحاويات التخزين متصلة وجاهزة بالكامل 🟢';
  }

  return {
    isConnected,
    tables,
    buckets,
    latencyMs,
    allTablesReady: primaryTablesReady,
    allBucketsReady,
    message,
  };
}

/**
 * Refreshes the PostgREST schema cache and tests tables immediately
 */
export async function refreshPostgrestSchemaCache(): Promise<{
  success: boolean;
  message: string;
  tables: Record<string, boolean>;
}> {
  // 1. Try to invoke schema cache refresh via RPC
  try {
    await supabase.rpc('refresh_schema_cache');
  } catch {}

  // 2. Poll & check status
  const status = await checkSupabaseSchemaStatus();
  const tablesMap = {
    products: status.tables.products.exists,
    representatives: status.tables.representatives.exists,
    sales: status.tables.sales.exists,
    sales_records: status.tables.sales_records.exists,
    invoices: status.tables.invoices.exists,
  };

  const ready = status.tables.products.exists && status.tables.representatives.exists;

  return {
    success: ready,
    message: ready
      ? 'تم تحديث ذاكرة المخطط بنجاح! تم العثور على الجداول المطلوبة 🟢'
      : 'تم إرسال أمر تحديث ذاكرة المخطط (Schema Cache). إذا استمرت الجداول بعدم الظهور، تأكد من تنفيذ كود SQL في Supabase SQL Editor.',
    tables: tablesMap,
  };
}

// Backward compatible connection test
export async function testSupabaseConnection() {
  const status = await checkSupabaseSchemaStatus();
  return {
    isConnected: status.isConnected,
    dbStatus: status.allTablesReady ? ('connected' as const) : ('error' as const),
    storageStatus: status.allBucketsReady ? ('connected' as const) : ('error' as const),
    latencyMs: status.latencyMs,
    message: status.message,
    bucketName: BUCKET_SALES,
    tablesFound: Object.keys(status.tables).filter(
      (k) => status.tables[k as keyof typeof status.tables].exists
    ),
  };
}

// ====================================================================
// 3. Dynamic Fetching, Pagination, Targeted Select & Local Storage Caching
// ====================================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes staleness check

function getCachedStorageData<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`sup_cache_${key}`);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (Date.now() - item.timestamp > CACHE_TTL_MS) {
      return null;
    }
    return item.data as T;
  } catch {
    return null;
  }
}

function setCachedStorageData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      `sup_cache_${key}`,
      JSON.stringify({ timestamp: Date.now(), data })
    );
  } catch {}
}

// --- 1. Representatives Table ---
export async function fetchSupabaseRepresentatives(
  page = 1,
  pageSize = 50,
  forceRefresh = false
): Promise<{
  data: SupabaseRepresentative[];
  error: string | null;
}> {
  const cacheKey = 'representatives';
  if (!forceRefresh) {
    const cached = getCachedStorageData<SupabaseRepresentative[]>(cacheKey);
    if (cached) return { data: cached, error: null };
  }

  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('representatives')
      .select('id, name, phone, target_kg, created_at')
      .order('name', { ascending: true })
      .range(from, to);

    if (error) return { data: [], error: error.message };
    const list = (data || []) as SupabaseRepresentative[];
    setCachedStorageData(cacheKey, list);
    return { data: list, error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'فشل جلب المندوبين من Supabase' };
  }
}

export async function upsertSupabaseRepresentative(
  rep: { id?: string; name: string; phone?: string; target_kg?: number }
): Promise<{ data: SupabaseRepresentative | null; error: string | null }> {
  try {
    const payload = {
      id: rep.id || `rep_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: rep.name,
      phone: rep.phone || '',
      target_kg: Number(rep.target_kg) || 0,
    };
    const { data, error } = await supabase
      .from('representatives')
      .upsert(payload, { onConflict: 'id' })
      .select('id, name, phone, target_kg, created_at')
      .single();

    if (error) return { data: null, error: error.message };
    localStorage.removeItem('sup_cache_representatives');
    return { data: data as SupabaseRepresentative, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'فشل حفظ المندوب في Supabase' };
  }
}

// --- 2. Products Table ---
export async function fetchSupabaseProducts(
  page = 1,
  pageSize = 50,
  forceRefresh = false
): Promise<{
  data: SupabaseProduct[];
  error: string | null;
}> {
  const cacheKey = 'products';
  if (!forceRefresh) {
    const cached = getCachedStorageData<SupabaseProduct[]>(cacheKey);
    if (cached) return { data: cached, error: null };
  }

  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, category, image_url, created_at')
      .order('name', { ascending: true })
      .range(from, to);

    if (error) return { data: [], error: error.message };
    const list = (data || []) as SupabaseProduct[];
    setCachedStorageData(cacheKey, list);
    return { data: list, error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'فشل جلب المنتجات من Supabase' };
  }
}

export async function upsertSupabaseProduct(
  prod: { id?: string; name: string; price: number; category?: string; image_url?: string }
): Promise<{ data: SupabaseProduct | null; error: string | null }> {
  try {
    const payload = {
      id: prod.id || `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: prod.name,
      price: Number(prod.price) || 0,
      category: prod.category || 'عام',
      image_url: prod.image_url || '',
    };
    const { data, error } = await supabase
      .from('products')
      .upsert(payload, { onConflict: 'id' })
      .select('id, name, price, category, image_url, created_at')
      .single();

    if (error) return { data: null, error: error.message };
    localStorage.removeItem('sup_cache_products');
    return { data: data as SupabaseProduct, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'فشل حفظ المنتج في Supabase' };
  }
}

// --- 3. Sales Table (public.sales) ---
export async function fetchSupabaseSales(
  page = 1,
  pageSize = 50
): Promise<{
  data: SupabaseSale[];
  error: string | null;
}> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('sales')
      .select('id, representative_id, customer_name, customer_phone, total_amount, invoice_image_url, created_at, representatives(name)')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return { data: [], error: error.message };

    const mapped = (data || []).map((s: any) => ({
      id: s.id,
      representative_id: s.representative_id,
      representative_name: s.representatives?.name || 'غير معروف',
      customer_name: s.customer_name,
      customer_phone: s.customer_phone || '',
      total_amount: Number(s.total_amount) || 0,
      invoice_image_url: s.invoice_image_url || '',
      created_at: s.created_at,
    }));

    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'فشل جلب حركات المبيعات من Supabase' };
  }
}

export async function upsertSupabaseSale(
  sale: Partial<SupabaseSale>
): Promise<{ data: SupabaseSale | null; error: string | null }> {
  try {
    const payload = {
      id: sale.id || `sale_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      representative_id: sale.representative_id || null,
      customer_name: sale.customer_name || 'عميل',
      customer_phone: sale.customer_phone || '',
      total_amount: Number(sale.total_amount) || 0,
      invoice_image_url: sale.invoice_image_url || '',
    };

    const { data, error } = await supabase
      .from('sales')
      .upsert(payload, { onConflict: 'id' })
      .select('id, representative_id, customer_name, customer_phone, total_amount, invoice_image_url, created_at')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as SupabaseSale, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'فشل حفظ حركة المبيعات' };
  }
}

// --- 4. Sales Records Table (monthly target & metrics) ---
export async function fetchSupabaseSalesRecords(
  monthYear?: string,
  page = 1,
  pageSize = 50
): Promise<{
  data: SupabaseSalesRecord[];
  error: string | null;
}> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = supabase
      .from('sales_records')
      .select('id, representative_id, target_kg, sales_kg, target_customer, acceptable_customer, month_year, created_at, representatives(name)')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (monthYear) {
      q = q.eq('month_year', monthYear);
    }

    const { data, error } = await q;

    if (error) return { data: [], error: error.message };

    const mapped = (data || []).map((r: any) => ({
      id: r.id,
      representative_id: r.representative_id,
      representative_name: r.representatives?.name || 'غير معروف',
      target_kg: Number(r.target_kg) || 0,
      sales_kg: Number(r.sales_kg) || 0,
      target_customer: Number(r.target_customer) || 0,
      acceptable_customer: Number(r.acceptable_customer) || 0,
      month_year: r.month_year,
      created_at: r.created_at,
    }));

    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'فشل جلب سجلات المبيعات من Supabase' };
  }
}

export async function upsertSupabaseSalesRecord(
  record: Partial<SupabaseSalesRecord>
): Promise<{ data: SupabaseSalesRecord | null; error: string | null }> {
  try {
    const payload = {
      id: record.id || `sr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      representative_id: record.representative_id,
      target_kg: Number(record.target_kg) || 0,
      sales_kg: Number(record.sales_kg) || 0,
      target_customer: Number(record.target_customer) || 0,
      acceptable_customer: Number(record.acceptable_customer) || 0,
      month_year: record.month_year || new Date().toISOString().slice(0, 7),
    };

    const { data, error } = await supabase
      .from('sales_records')
      .upsert(payload, { onConflict: 'id' })
      .select('id, representative_id, target_kg, sales_kg, target_customer, acceptable_customer, month_year, created_at')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as SupabaseSalesRecord, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'فشل حفظ سجل المبيعات في Supabase' };
  }
}

// --- 5. Invoices Table ---
export async function fetchSupabaseInvoices(
  page = 1,
  pageSize = 50
): Promise<{
  data: SupabaseInvoice[];
  error: string | null;
}> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('invoices')
      .select('id, customer_name, customer_phone, total_amount, invoice_image_url, created_at')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as SupabaseInvoice[], error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'فشل جلب الفواتير من Supabase' };
  }
}

export async function upsertSupabaseInvoice(
  inv: { id?: string; customer_name: string; customer_phone?: string; total_amount: number; invoice_image_url?: string }
): Promise<{ data: SupabaseInvoice | null; error: string | null }> {
  try {
    const payload = {
      id: inv.id || `inv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      customer_name: inv.customer_name,
      customer_phone: inv.customer_phone || '',
      total_amount: Number(inv.total_amount) || 0,
      invoice_image_url: inv.invoice_image_url || '',
    };

    const { data, error } = await supabase
      .from('invoices')
      .upsert(payload, { onConflict: 'id' })
      .select('id, customer_name, customer_phone, total_amount, invoice_image_url, created_at')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as SupabaseInvoice, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'فشل حفظ الفاتورة في Supabase' };
  }
}

// ====================================================================
// 4. Real-time Subscription Listener
// ====================================================================

export function subscribeToSupabaseTable(
  tableName: 'representatives' | 'products' | 'sales' | 'sales_records' | 'invoices',
  callback: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: any; old: any }) => void
) {
  const channel = supabase
    .channel(`public:${tableName}_changes`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tableName },
      (payload) => {
        callback({
          eventType: payload.eventType as any,
          new: payload.new,
          old: payload.old,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ====================================================================
// 5. Automated Excel File Upload & Data Parsing linked to sales_records
// ====================================================================

/**
 * Uploads an Excel sales file to 'sales-bucket', parses sales records,
 * and automatically upserts representatives and sales metrics to Supabase!
 */
export async function parseAndUploadSalesExcelToSupabase(
  file: File,
  activeMonthYear?: string
): Promise<ExcelSalesParseResult> {
  const monthYear = activeMonthYear || new Date().toISOString().slice(0, 7);

  try {
    // 1. Upload Excel file to 'sales-bucket'
    const uploadRes = await uploadExcelToSupabaseStorage(file, {
      uploadedBy: 'النظام الآلي',
      targetType: 'sales-bucket',
      description: `شيت مبيعات شهر ${monthYear}`,
    });

    const fileUrl = uploadRes.publicUrl;

    // 2. Read and parse Excel file
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('ملف الإكسل فارغ ولا يحتوي على صفحات بيانات.');
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<any>(firstSheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      throw new Error('لا توجد صفوف بيانات صالحة في ملف الإكسل.');
    }

    const parsedRecords: Partial<SupabaseSalesRecord>[] = [];
    const representativeNames = new Set<string>();

    let totalTarget = 0;
    let totalSales = 0;
    let totalCustomers = 0;

    // Helper to find column keys flexibly
    const normalize = (s: string) => String(s || '').trim().toLowerCase().replace(/[\s_-]/g, '');

    for (const row of rawRows) {
      const keys = Object.keys(row);
      const getVal = (candidates: string[]) => {
        for (const k of keys) {
          const normK = normalize(k);
          if (candidates.some((c) => normK.includes(normalize(c)))) {
            return row[k];
          }
        }
        return null;
      };

      const repName = String(getVal(['مندوب', 'اسم المندوب', 'representative', 'name']) || '').trim();
      const targetKg = Number(getVal(['تاركت', 'الهدف', 'target', 'target_kg']) || 0);
      const salesKg = Number(getVal(['مبيعات', 'الوزن', 'sales', 'sales_kg']) || 0);
      const targetCustomer = Number(getVal(['هدف زبائن', 'محلات', 'target_customer', 'shops']) || 0);
      const acceptableCustomer = Number(getVal(['زبائن مقبولة', 'تغطية', 'acceptable_customer', 'covered']) || 0);

      if (repName && (targetKg > 0 || salesKg > 0 || targetCustomer > 0)) {
        representativeNames.add(repName);
        totalTarget += targetKg;
        totalSales += salesKg;
        totalCustomers += targetCustomer;

        parsedRecords.push({
          id: `sr_${sanitizeFileName(repName)}_${monthYear}`.toLowerCase(),
          representative_name: repName,
          target_kg: targetKg,
          sales_kg: salesKg,
          target_customer: targetCustomer,
          acceptable_customer: acceptableCustomer,
          month_year: monthYear,
        });
      }
    }

    // 3. Upsert Representatives first
    const repsToUpsert = Array.from(representativeNames).map((name) => ({
      id: `rep_${sanitizeFileName(name)}`.toLowerCase(),
      name,
    }));

    if (repsToUpsert.length > 0) {
      try {
        await supabase.from('representatives').upsert(repsToUpsert, { onConflict: 'id' });
      } catch (rErr) {
        console.warn('Representatives upsert notice:', rErr);
      }
    }

    // 4. Upsert Sales Records with linked representative_id
    const finalRecords = parsedRecords.map((r) => ({
      id: r.id,
      representative_id: `rep_${sanitizeFileName(r.representative_name || '')}`.toLowerCase(),
      target_kg: r.target_kg || 0,
      sales_kg: r.sales_kg || 0,
      target_customer: r.target_customer || 0,
      acceptable_customer: r.acceptable_customer || 0,
      month_year: r.month_year,
    }));

    if (finalRecords.length > 0) {
      try {
        await supabase.from('sales_records').upsert(finalRecords, { onConflict: 'id' });
      } catch (sErr) {
        console.warn('Sales records upsert notice:', sErr);
      }
    }

    return {
      success: true,
      fileUrl,
      recordsCount: finalRecords.length,
      totalTargetKg: Math.round(totalTarget),
      totalSalesKg: Math.round(totalSales),
      totalCustomers,
      records: parsedRecords,
      representativesSynced: repsToUpsert.length,
    };
  } catch (err: any) {
    console.error('parseAndUploadSalesExcelToSupabase error:', err);
    return {
      success: false,
      recordsCount: 0,
      totalTargetKg: 0,
      totalSalesKg: 0,
      totalCustomers: 0,
      records: [],
      representativesSynced: 0,
      error: err.message || 'حدث خطأ أثناء قراءة ورفع ملف مبيعات الإكسل',
    };
  }
}

// ====================================================================
// 6. Instant Image Capture & Upload to Storage Handlers
// ====================================================================

/**
 * Upload Invoice Image to 'invoice-images' Storage Bucket
 */
export async function uploadInvoiceImageToStorage(
  fileOrBlob: File | Blob,
  metadataOrId?: { invoiceId?: string; customerName?: string } | string,
  extraCustomerName?: string
): Promise<SupabaseUploadResult> {
  try {
    const timestamp = Date.now();
    let invId = `inv_${timestamp}`;
    let custName = extraCustomerName;

    if (typeof metadataOrId === 'string') {
      invId = metadataOrId || invId;
    } else if (metadataOrId && typeof metadataOrId === 'object') {
      if (metadataOrId.invoiceId) invId = metadataOrId.invoiceId;
      if (metadataOrId.customerName) custName = metadataOrId.customerName;
    }

    const cleanId = sanitizeFileName(invId);
    const filePath = `${cleanId}_${timestamp}.jpg`;

    // Try target bucket 'invoice-images', fallback to 'sales-bucket'
    let bucketName = BUCKET_INVOICE_IMAGES;
    let { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, fileOrBlob, {
        cacheControl: '86400',
        upsert: true,
        contentType: fileOrBlob.type || 'image/jpeg',
      });

    if (error) {
      bucketName = BUCKET_SALES;
      const fallback = await supabase.storage
        .from(bucketName)
        .upload(`invoice-images/${filePath}`, fileOrBlob, {
          cacheControl: '86400',
          upsert: true,
          contentType: fileOrBlob.type || 'image/jpeg',
        });
      data = fallback.data;
      error = fallback.error;
    }

    if (error || !data) {
      return { success: false, error: error?.message || 'فشل رفع صورة الفاتورة' };
    }

    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(data.path);
    const publicUrl = urlData.publicUrl;

    // Automatically update or insert into invoices table if customerName or invId provided
    if (custName) {
      try {
        await upsertSupabaseInvoice({
          id: invId,
          customer_name: custName,
          total_amount: 0,
          invoice_image_url: publicUrl,
        });
      } catch {}
    }

    return {
      success: true,
      publicUrl,
      path: data.path,
      bucket: bucketName,
      fileSize: fileOrBlob.size,
      uploadedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'خطأ أثناء رفع صورة الفاتورة' };
  }
}

/**
 * Delete Old Product Image from Supabase Storage buckets
 */
export async function deleteProductImageFromStorage(
  productId: string,
  oldImageUrl?: string
): Promise<{ success: boolean; removedCount: number }> {
  let removedCount = 0;
  try {
    const cleanId = sanitizeFileName(productId);

    // 1. If oldImageUrl contains a Supabase path, extract and remove it directly
    if (oldImageUrl && oldImageUrl.includes('/storage/v1/object/public/')) {
      try {
        const parts = oldImageUrl.split('/storage/v1/object/public/');
        if (parts.length > 1) {
          const rawPathWithParams = parts[1];
          const fullPath = rawPathWithParams.split('?')[0];
          const slashIdx = fullPath.indexOf('/');
          if (slashIdx > -1) {
            const bucketName = fullPath.substring(0, slashIdx);
            const filePath = fullPath.substring(slashIdx + 1);
            const { data, error } = await supabase.storage.from(bucketName).remove([filePath]);
            if (!error && data && data.length > 0) {
              removedCount += data.length;
            }
          }
        }
      } catch (e) {
        console.warn('Notice deleting old image by URL:', e);
      }
    }

    // 2. Search and remove any existing image file starting with cleanId in product-images bucket
    try {
      const { data: listFiles } = await supabase.storage
        .from(BUCKET_PRODUCT_IMAGES)
        .list('', { search: cleanId });

      if (listFiles && listFiles.length > 0) {
        const filesToRemove = listFiles.map((f) => f.name);
        const { data: rmData } = await supabase.storage
          .from(BUCKET_PRODUCT_IMAGES)
          .remove(filesToRemove);
        if (rmData) removedCount += rmData.length;
      }
    } catch {}

    // 3. Search and remove any existing image file starting with cleanId in sales-bucket/product-images/
    try {
      const { data: listSalesFiles } = await supabase.storage
        .from(BUCKET_SALES)
        .list('product-images', { search: cleanId });

      if (listSalesFiles && listSalesFiles.length > 0) {
        const filesToRemove = listSalesFiles.map((f) => `product-images/${f.name}`);
        const { data: rmData } = await supabase.storage
          .from(BUCKET_SALES)
          .remove(filesToRemove);
        if (rmData) removedCount += rmData.length;
      }
    } catch {}

    return { success: true, removedCount };
  } catch (err) {
    console.warn('deleteProductImageFromStorage notice:', err);
    return { success: false, removedCount };
  }
}

/**
 * Upload Product Catalog Image to 'product-images' Storage Bucket
 */
export async function uploadProductImageToStorage(
  fileOrBlob: File | Blob,
  productId: string,
  productName?: string,
  oldImageUrl?: string
): Promise<SupabaseUploadResult> {
  try {
    // Delete existing old image first to prevent accumulation of unused files
    await deleteProductImageFromStorage(productId, oldImageUrl);

    const timestamp = Date.now();
    const cleanId = sanitizeFileName(productId) || `prod_${timestamp}`;
    const filePath = `${cleanId}_${timestamp}.jpg`;

    let bucketName = BUCKET_PRODUCT_IMAGES;
    let { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, fileOrBlob, {
        cacheControl: '0',
        upsert: true,
        contentType: fileOrBlob.type || 'image/jpeg',
      });

    if (error) {
      bucketName = BUCKET_SALES;
      const fallback = await supabase.storage
        .from(bucketName)
        .upload(`product-images/${filePath}`, fileOrBlob, {
          cacheControl: '0',
          upsert: true,
          contentType: fileOrBlob.type || 'image/jpeg',
        });
      data = fallback.data;
      error = fallback.error;
    }

    if (error || !data) {
      return { success: false, error: error?.message || 'فشل رفع صورة المنتج' };
    }

    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(data.path);
    const publicUrl = `${urlData.publicUrl}?t=${timestamp}`;

    return {
      success: true,
      publicUrl,
      path: data.path,
      bucket: bucketName,
      fileSize: fileOrBlob.size,
      uploadedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'خطأ أثناء رفع صورة المنتج' };
  }
}

/**
 * Upload General Excel to 'sales-bucket'
 */
export async function uploadExcelToSupabaseStorage(
  file: File,
  metadata?: {
    uploadedBy?: string;
    description?: string;
    targetType?: string;
  }
): Promise<SupabaseUploadResult> {
  try {
    const timestamp = Date.now();
    const safeName = sanitizeFileName(file.name) || `sales_${timestamp}.xlsx`;
    const folder = metadata?.targetType || 'excel-sales';
    const filePath = `${folder}/${timestamp}_${safeName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET_SALES)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    if (error) {
      return { success: false, error: error.message };
    }

    const { data: urlData } = supabase.storage.from(BUCKET_SALES).getPublicUrl(data.path);

    return {
      success: true,
      publicUrl: urlData.publicUrl,
      path: data.path,
      fileName: file.name,
      fileSize: file.size,
      bucket: BUCKET_SALES,
      uploadedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'حدث خطأ أثناء رفع ملف الإكسل' };
  }
}

// Aliases for compatibility
export const uploadInvoiceImageToSupabaseStorage = uploadInvoiceImageToStorage;
export const uploadProductImageToSupabaseStorage = uploadProductImageToStorage;

/**
 * List files from a specific Supabase Storage bucket
 */
export async function listSalesBucketFiles(
  folder: string = '',
  bucketName: string = BUCKET_SALES
): Promise<{ files: any[]; error: string | null }> {
  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .list(folder, { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });

    if (error) return { files: [], error: error.message };

    const withUrls = (data || []).map((file) => {
      const fullPath = folder ? `${folder}/${file.name}` : file.name;
      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fullPath);
      return {
        ...file,
        bucket: bucketName,
        fullPath,
        publicUrl: urlData.publicUrl,
      };
    });

    return { files: withUrls, error: null };
  } catch (err: any) {
    return { files: [], error: err.message || 'فشل جلب ملفات التخزين' };
  }
}

// ====================================================================
// 7. Seed & Sync Current App Data to Supabase
// ====================================================================

export async function seedSupabaseFromCurrentData(
  products: ProductItem[],
  delegates: DelegateAccount[],
  sales: SalesEntry[]
): Promise<{
  representativesCount: number;
  productsCount: number;
  salesCount: number;
  salesRecordsCount: number;
  invoicesCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let representativesCount = 0;
  let productsCount = 0;
  let salesCount = 0;
  let salesRecordsCount = 0;
  let invoicesCount = 0;

  // 1. Sync Representatives (id, name, phone, target_kg, created_at)
  if (delegates.length > 0) {
    try {
      const repPayload = delegates.map((d) => ({
        id: `rep_${sanitizeFileName(d.delegateName || d.username)}`.toLowerCase(),
        name: d.delegateName || d.username,
        phone: d.phone || '',
        target_kg: Number(d.monthlyTargetKg) || 0,
      }));
      const { error } = await supabase
        .from('representatives')
        .upsert(repPayload, { onConflict: 'id' });

      if (!error) representativesCount = repPayload.length;
      else errors.push(`المندوبين: ${error.message}`);
    } catch (e: any) {
      errors.push(`المندوبين: ${e.message}`);
    }
  }

  // 2. Sync Products (id, name, price, category, image_url, created_at)
  if (products.length > 0) {
    try {
      const prodPayload = products.map((p) => ({
        id: p.id,
        name: p.productName,
        price: Number(p.retailPrice) || 0,
        category: p.categoryName || 'عام',
        image_url: p.imageUrl || '',
      }));
      const { error } = await supabase
        .from('products')
        .upsert(prodPayload, { onConflict: 'id' });

      if (!error) productsCount = prodPayload.length;
      else errors.push(`المنتجات: ${error.message}`);
    } catch (e: any) {
      errors.push(`المنتجات: ${e.message}`);
    }
  }

  // 3. Sync Sales (id, representative_id, customer_name, customer_phone, total_amount, invoice_image_url, created_at)
  if (sales.length > 0) {
    try {
      const salesPayload = sales.slice(0, 1000).map((s, idx) => {
        const cleanRepId = s.delegateName ? `rep_${sanitizeFileName(s.delegateName)}`.toLowerCase() : null;
        const stableId = s.id ? `sale_${sanitizeFileName(s.id)}`.toLowerCase() : `sale_${idx}`;
        return {
          id: stableId.slice(0, 50),
          representative_id: cleanRepId,
          customer_name: s.customerName || 'عميل',
          customer_phone: s.customerPhone || '',
          total_amount: (Number(s.enteredQuantity) || Number(s.quantity) || 1) * 2500,
          invoice_image_url: '',
        };
      });

      const { error } = await supabase
        .from('sales')
        .upsert(salesPayload, { onConflict: 'id' });

      if (!error) salesCount = salesPayload.length;
      else errors.push(`المبيعات: ${error.message}`);
    } catch (e: any) {
      errors.push(`المبيعات: ${e.message}`);
    }
  }

  // 4. Sync Sales Records (aggregated per delegate per month)
  if (sales.length > 0) {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const delMap: Record<string, { target: number; sales: number; customers: Set<string> }> = {};

      sales.forEach((s) => {
        const d = s.delegateName || 'عام';
        if (!delMap[d]) delMap[d] = { target: 0, sales: 0, customers: new Set() };
        delMap[d].sales += Number(s.totalWeightKg) || 0;
        if (s.customerName) delMap[d].customers.add(s.customerName);
      });

      const srPayload = Object.entries(delMap).map(([name, stats]) => ({
        id: `sr_${sanitizeFileName(name)}_${currentMonth}`.toLowerCase(),
        representative_id: `rep_${sanitizeFileName(name)}`.toLowerCase(),
        target_kg: Math.round(stats.sales * 1.15),
        sales_kg: Math.round(stats.sales),
        target_customer: Math.max(10, stats.customers.size),
        acceptable_customer: stats.customers.size,
        month_year: currentMonth,
      }));

      const { error } = await supabase
        .from('sales_records')
        .upsert(srPayload, { onConflict: 'id' });

      if (!error) salesRecordsCount = srPayload.length;
      else errors.push(`سجلات المبيعات: ${error.message}`);
    } catch (e: any) {
      errors.push(`سجلات المبيعات: ${e.message}`);
    }
  }

  // 5. Sync Invoices
  if (sales.length > 0) {
    try {
      const invoiceGroups: Record<string, { name: string; phone: string; amount: number }> = {};
      sales.slice(0, 50).forEach((s) => {
        const invId = s.invoiceId || s.id;
        if (!invoiceGroups[invId]) {
          invoiceGroups[invId] = {
            name: s.customerName || 'زبون',
            phone: s.customerPhone || '',
            amount: 0,
          };
        }
        invoiceGroups[invId].amount += (Number(s.enteredQuantity) || Number(s.quantity) || 1) * 2500;
      });

      const invPayload = Object.entries(invoiceGroups).map(([id, inv]) => ({
        id: `inv_${id}`,
        customer_name: inv.name,
        customer_phone: inv.phone,
        total_amount: inv.amount,
        invoice_image_url: '',
      }));

      const { error } = await supabase
        .from('invoices')
        .upsert(invPayload, { onConflict: 'id' });

      if (!error) invoicesCount = invPayload.length;
      else errors.push(`الفواتير: ${error.message}`);
    } catch (e: any) {
      errors.push(`الفواتير: ${e.message}`);
    }
  }

  return {
    representativesCount,
    productsCount,
    salesCount,
    salesRecordsCount,
    invoicesCount,
    errors,
  };
}

// Backward compatibility exports
export async function syncProductsToSupabase(products: ProductItem[]) {
  const res = await seedSupabaseFromCurrentData(products, [], []);
  return { count: res.productsCount, error: res.errors[0] || null };
}

export async function syncRepresentativesToSupabase(reps: DelegateAccount[]) {
  const res = await seedSupabaseFromCurrentData([], reps, []);
  return { count: res.representativesCount, error: res.errors[0] || null };
}

export async function syncSalesToSupabase(sales: SalesEntry[]) {
  const res = await seedSupabaseFromCurrentData([], [], sales);
  return { count: res.salesRecordsCount, error: res.errors[0] || null };
}

export const fetchProductsFromSupabase = fetchSupabaseProducts;
export const fetchRepresentativesFromSupabase = fetchSupabaseRepresentatives;
export const fetchSalesFromSupabase = async (options?: { limit?: number }) => {
  const res = await fetchSupabaseSalesRecords();
  return {
    data: options?.limit ? res.data.slice(0, options.limit) : res.data,
    error: res.error,
  };
};

