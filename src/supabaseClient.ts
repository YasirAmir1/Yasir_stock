import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Project credentials provided in integration specification
export const SUPABASE_URL: string =
  (import.meta.env.VITE_SUPABASE_URL as string) || 'https://liywmqqmwpwkhdvsxsqj.supabase.co';

export const SUPABASE_ANON_KEY: string =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'sb_publishable_FochZJS67WxqCExCpN9N0Q_XAmOmu7E';

export const SUPABASE_STORAGE_BUCKET = 'sales-bucket';
export const BUCKET_SALES = 'sales-bucket';
export const BUCKET_INVOICE_IMAGES = 'invoice-images';
export const BUCKET_PRODUCT_IMAGES = 'product-images';

// Central typed Supabase Client
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
