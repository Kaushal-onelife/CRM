-- ============================================
-- Water Purifier CRM - Database Schema
-- Run this in Supabase SQL Editor
-- Safe to re-run (idempotent)
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TENANTS (each business/client)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  address TEXT,
  logo_url TEXT,
  subscription_status TEXT DEFAULT 'trial',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. USERS (app login - tied to tenant)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT DEFAULT 'owner',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- avatar_url for existing databases (idempotent backfill)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 3. CUSTOMERS (end customers of the business)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  purifier_brand TEXT,
  purifier_model TEXT,
  installation_date DATE,
  fcm_token TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. SERVICES
-- Status: 'scheduled' (default), 'pending', 'completed', 'rejected', 'followup'
-- UI auto-classifies 'scheduled' as Upcoming (future) or Due (past) based on scheduled_date
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  service_type TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled',
  scheduled_date DATE NOT NULL,
  completed_date DATE,
  next_due_date DATE,
  next_contact_date DATE,
  assigned_to UUID REFERENCES users(id),
  amount NUMERIC(10,2) DEFAULT 0,
  service_charge NUMERIC(10,2) DEFAULT 0,
  parts_replaced JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. BILLS / INVOICES
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  service_id UUID REFERENCES services(id),
  bill_number TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  tax NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  payment_status TEXT DEFAULT 'unpaid',
  payment_method TEXT,
  paid_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. BILL ITEMS (line items in a bill)
CREATE TABLE IF NOT EXISTS bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INT DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL
);

-- 7. NOTIFICATIONS LOG
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  service_id UUID REFERENCES services(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent'
);

-- 8. AMC CONTRACTS (Annual Maintenance Contracts)
-- Status: 'active' (default), 'expired', 'cancelled'
-- payment_status: 'unpaid' (default), 'paid', 'partial'
CREATE TABLE IF NOT EXISTS amc_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  plan_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_services INT NOT NULL DEFAULT 4,
  services_used INT NOT NULL DEFAULT 0,
  amount NUMERIC(10,2) DEFAULT 0,
  payment_status TEXT DEFAULT 'unpaid',
  status TEXT DEFAULT 'active',
  auto_schedule BOOLEAN DEFAULT TRUE,
  notes TEXT,
  -- Links a renewed contract to the one it replaced (contract history per customer).
  renewed_from UUID REFERENCES amc_contracts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- renewed_from for existing databases (idempotent backfill)
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS renewed_from UUID REFERENCES amc_contracts(id) ON DELETE SET NULL;

-- Link services to AMC contracts (nullable: services may exist outside any AMC)
ALTER TABLE services ADD COLUMN IF NOT EXISTS amc_id UUID REFERENCES amc_contracts(id) ON DELETE SET NULL;

-- 9. INVENTORY PARTS (water purifier spare parts in stock)
CREATE TABLE IF NOT EXISTS inventory_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  sku TEXT,
  quantity INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 5,
  unit_price NUMERIC(10,2) DEFAULT 0,
  cost_price NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_services_tenant_status ON services(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_services_tenant_scheduled ON services(tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_services_tenant_next_due ON services(tenant_id, next_due_date);
CREATE INDEX IF NOT EXISTS idx_services_amc ON services(amc_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bills_tenant_payment ON bills(tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_amc_tenant_status ON amc_contracts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_amc_tenant_end ON amc_contracts(tenant_id, end_date);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory_parts(tenant_id);

-- Per-tenant unique bill numbers (prevents duplicates from concurrent inserts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_tenant_billnumber
  ON bills(tenant_id, bill_number);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE amc_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_parts ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies (drop-then-create makes this idempotent)
DROP POLICY IF EXISTS tenant_isolation ON customers;
CREATE POLICY tenant_isolation ON customers
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS tenant_isolation ON services;
CREATE POLICY tenant_isolation ON services
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS tenant_isolation ON bills;
CREATE POLICY tenant_isolation ON bills
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS tenant_isolation ON bill_items;
CREATE POLICY tenant_isolation ON bill_items
  FOR ALL USING (bill_id IN (SELECT id FROM bills));

DROP POLICY IF EXISTS user_can_read_own_profile ON users;
CREATE POLICY user_can_read_own_profile ON users
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS user_can_update_own_profile ON users;
CREATE POLICY user_can_update_own_profile ON users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Signup needs to insert a row keyed to the new auth user
DROP POLICY IF EXISTS user_self_signup ON users;
CREATE POLICY user_self_signup ON users
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS user_can_read_own_tenant ON tenants;
CREATE POLICY user_can_read_own_tenant ON tenants
  FOR SELECT USING (id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Signup creates the tenant before the user row exists, so this is open to any authed user
DROP POLICY IF EXISTS tenant_self_signup ON tenants;
CREATE POLICY tenant_self_signup ON tenants
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tenant_isolation ON amc_contracts;
CREATE POLICY tenant_isolation ON amc_contracts
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS tenant_isolation ON inventory_parts;
CREATE POLICY tenant_isolation ON inventory_parts
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- CUSTOMER PHONE UNIQUENESS  (must be LAST — see note)
-- ============================================
-- The identity key for CSV import dedup: a phone is unique within a business
-- (same phone may exist under different tenants). This is the DB-level guarantee
-- behind the "no duplicate customer" rule.
--
-- This block is intentionally the LAST thing in the file: creating a unique index
-- fails if duplicate (tenant_id, phone) rows already exist, so we de-duplicate
-- first (keeping the NEWEST row per phone), then create the index. Placing it
-- last means that even if anything here errored, all the tables, columns, and
-- RLS policies above are already applied.
--
-- IMPORTANT: a duplicate customer may have services/bills/AMCs/notifications
-- attached. We must MOVE those child rows to the surviving (newest) customer
-- BEFORE deleting the duplicate — otherwise the delete violates the FK
-- (services_customer_id_fkey) and no history is lost.
DO $$
DECLARE
  dup RECORD;
  keeper UUID;
BEGIN
  -- For every (tenant_id, phone) group that has more than one customer:
  FOR dup IN
    SELECT tenant_id, phone
    FROM customers
    GROUP BY tenant_id, phone
    HAVING COUNT(*) > 1
  LOOP
    -- The keeper = newest customer in this group.
    SELECT id INTO keeper
    FROM customers
    WHERE tenant_id = dup.tenant_id AND phone = dup.phone
    ORDER BY created_at DESC
    LIMIT 1;

    -- Re-point all child records from the older duplicates to the keeper.
    UPDATE services      SET customer_id = keeper
      WHERE tenant_id = dup.tenant_id AND customer_id IN (
        SELECT id FROM customers WHERE tenant_id = dup.tenant_id AND phone = dup.phone AND id <> keeper);
    UPDATE bills         SET customer_id = keeper
      WHERE tenant_id = dup.tenant_id AND customer_id IN (
        SELECT id FROM customers WHERE tenant_id = dup.tenant_id AND phone = dup.phone AND id <> keeper);
    UPDATE amc_contracts SET customer_id = keeper
      WHERE tenant_id = dup.tenant_id AND customer_id IN (
        SELECT id FROM customers WHERE tenant_id = dup.tenant_id AND phone = dup.phone AND id <> keeper);
    UPDATE notifications SET customer_id = keeper
      WHERE tenant_id = dup.tenant_id AND customer_id IN (
        SELECT id FROM customers WHERE tenant_id = dup.tenant_id AND phone = dup.phone AND id <> keeper);

    -- Now the older duplicates have no children — safe to delete.
    DELETE FROM customers
    WHERE tenant_id = dup.tenant_id AND phone = dup.phone AND id <> keeper;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_phone
  ON customers(tenant_id, phone);

-- ============================================
-- STORAGE: avatars bucket (user profile pictures)
-- ============================================
-- Public bucket so avatar URLs are directly viewable/cacheable. Files are stored
-- as "<userId>/avatar.<ext>" so a new upload OVERWRITES the old one (no buildup).
-- Idempotent: safe to re-run.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Anyone can READ avatars (public bucket).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- A user can write/update/delete ONLY their own folder ("<their uid>/...").
DROP POLICY IF EXISTS "avatars_user_write" ON storage.objects;
CREATE POLICY "avatars_user_write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_user_update" ON storage.objects;
CREATE POLICY "avatars_user_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_user_delete" ON storage.objects;
CREATE POLICY "avatars_user_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================
-- VERIFICATION (read-only — run manually to confirm the DB matches this schema)
-- ============================================
-- Uncomment and run any of these in the SQL Editor after applying.
--
-- 1) Confirm the previously-missing pieces exist:
-- SELECT
--   to_regclass('public.amc_contracts')   AS amc_table,
--   to_regclass('public.inventory_parts') AS inventory_table;
--   -- both should be non-NULL.
--
-- 2) Confirm amc_contracts has auto_schedule (and list all its columns):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'amc_contracts'
-- ORDER BY ordinal_position;
--   -- 'auto_schedule' must appear in the list.
--
-- 3) Confirm services has amc_id:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='services' AND column_name='amc_id';
--   -- should return one row.
--
-- 4) See every table + column at once (compare against this file):
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
-- ORDER BY table_name, ordinal_position;
