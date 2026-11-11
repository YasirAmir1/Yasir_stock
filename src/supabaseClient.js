import { createClient } from '@supabase/supabase-js';

// Project credentials
export const SUPABASE_URL = 'https://liywmqqmwpwkhdvsxsqj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_FochZJS67WxqCExCpN9N0Q_XAmOmu7E';

// Buckets configured for the project
export const SUPABASE_STORAGE_BUCKET = 'sales-bucket';
export const BUCKET_SALES = 'sales-bucket';
export const BUCKET_INVOICE_IMAGES = 'invoice-images';
export const BUCKET_PRODUCT_IMAGES = 'product-images';

// Central Supabase Client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export default supabase;
