export const SUPABASE_SQL_SCHEMA = `-- ====================================================================
-- Auto-Create Missing Supabase Database Tables & Refresh Schema Cache
-- Target Project: https://liywmqqmwpwkhdvsxsqj.supabase.co
-- ====================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Representatives Table (id, name, phone, target_kg, created_at)
CREATE TABLE IF NOT EXISTS public.representatives (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name TEXT NOT NULL,
    phone TEXT,
    target_kg NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure target_kg column exists if table was previously created without it
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'representatives' AND column_name = 'target_kg'
    ) THEN
        ALTER TABLE public.representatives ADD COLUMN target_kg NUMERIC DEFAULT 0;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_representatives_name ON public.representatives(name);

-- 3. Products Table (id, name, price, category, image_url, created_at)
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name TEXT NOT NULL,
    price NUMERIC DEFAULT 0,
    category TEXT DEFAULT 'عام',
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products(name);

-- 4. Sales Table (id, representative_id, customer_name, customer_phone, total_amount, invoice_image_url, created_at)
CREATE TABLE IF NOT EXISTS public.sales (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    representative_id TEXT REFERENCES public.representatives(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    total_amount NUMERIC DEFAULT 0,
    invoice_image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_representative ON public.sales(representative_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_name);
CREATE INDEX IF NOT EXISTS idx_sales_created ON public.sales(created_at DESC);

-- 5. Sales Records Table (monthly target & metrics)
CREATE TABLE IF NOT EXISTS public.sales_records (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    representative_id TEXT REFERENCES public.representatives(id) ON DELETE CASCADE,
    target_kg NUMERIC DEFAULT 0,
    sales_kg NUMERIC DEFAULT 0,
    target_customer INTEGER DEFAULT 0,
    acceptable_customer INTEGER DEFAULT 0,
    month_year TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_records_rep ON public.sales_records(representative_id);
CREATE INDEX IF NOT EXISTS idx_sales_records_month ON public.sales_records(month_year);

-- 6. Invoices Table
CREATE TABLE IF NOT EXISTS public.invoices (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    total_amount NUMERIC DEFAULT 0,
    invoice_image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_name);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON public.invoices(created_at DESC);

-- ====================================================================
-- 7. Storage Buckets Configuration
-- ====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('sales-bucket', 'sales-bucket', true, 52428800, NULL),
    ('invoice-images', 'invoice-images', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('product-images', 'product-images', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true;

-- ====================================================================
-- 8. Row Level Security (RLS) & Public Access Policies
-- ====================================================================
ALTER TABLE public.representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Public full access representatives" ON public.representatives;
    CREATE POLICY "Public full access representatives" ON public.representatives FOR ALL USING (true) WITH CHECK (true);
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Public full access products" ON public.products;
    CREATE POLICY "Public full access products" ON public.products FOR ALL USING (true) WITH CHECK (true);
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Public full access sales" ON public.sales;
    CREATE POLICY "Public full access sales" ON public.sales FOR ALL USING (true) WITH CHECK (true);
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Public full access sales_records" ON public.sales_records;
    CREATE POLICY "Public full access sales_records" ON public.sales_records FOR ALL USING (true) WITH CHECK (true);
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Public full access invoices" ON public.invoices;
    CREATE POLICY "Public full access invoices" ON public.invoices FOR ALL USING (true) WITH CHECK (true);
END $$;

-- Storage RLS Policies
DO $$ BEGIN
    DROP POLICY IF EXISTS "Public Storage Upload Policy" ON storage.objects;
    CREATE POLICY "Public Storage Upload Policy" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN ('sales-bucket', 'invoice-images', 'product-images'));

    DROP POLICY IF EXISTS "Public Storage Select Policy" ON storage.objects;
    CREATE POLICY "Public Storage Select Policy" ON storage.objects FOR SELECT USING (bucket_id IN ('sales-bucket', 'invoice-images', 'product-images'));

    DROP POLICY IF EXISTS "Public Storage Update Policy" ON storage.objects;
    CREATE POLICY "Public Storage Update Policy" ON storage.objects FOR UPDATE USING (bucket_id IN ('sales-bucket', 'invoice-images', 'product-images'));
END $$;

-- ====================================================================
-- 9. RPC Functions & Instant PostgREST Schema Cache Refresh
-- ====================================================================
CREATE OR REPLACE FUNCTION public.refresh_schema_cache()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    NOTIFY pgrst, 'reload schema';
    RETURN jsonb_build_object('success', true, 'message', 'PostgREST schema cache reloaded successfully', 'timestamp', NOW());
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_schema_cache() TO anon, authenticated, service_role;

-- Execute raw SQL runner (for automated migrations if invoked from client)
CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    EXECUTE sql;
    NOTIFY pgrst, 'reload schema';
    RETURN 'SUCCESS';
END;
$$;

GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO anon, authenticated, service_role;

-- 10. Immediately trigger schema cache reload
NOTIFY pgrst, 'reload schema';
`;
