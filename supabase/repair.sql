-- ============================================
-- REPAIR MIGRATION — sync existing tables to the current schema
-- ============================================
-- WHY: a previous schema.sql run aborted partway (the customer-phone unique
-- index failed on duplicate phones and stopped the script), leaving some tables
-- created but MISSING columns — e.g. the live error:
--   "Could not find the 'auto_schedule' column of 'amc_contracts'"
--
-- Because schema.sql uses CREATE TABLE IF NOT EXISTS, re-running it SKIPS tables
-- that already exist and therefore does NOT add the missing columns. This file
-- adds every column with ADD COLUMN IF NOT EXISTS, so it's:
--   • non-destructive — existing data is untouched
--   • idempotent — safe to run multiple times; existing columns are skipped
--
-- HOW TO USE: paste this whole file into the Supabase SQL Editor and run it.
-- Then run schema.sql (for indexes/RLS). Both are safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- These CREATE TABLE IF NOT EXISTS lines create any table that's fully missing.
-- For tables that already exist (even partially), they're skipped — the ALTERs
-- below then backfill any missing columns.

-- 1. TENANTS
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'owner';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_prefs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 3. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS purifier_brand TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS purifier_model TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS installation_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fcm_token TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 4. SERVICES
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE services ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';
ALTER TABLE services ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS completed_date DATE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS next_due_date DATE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS next_contact_date DATE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS service_charge NUMERIC(10,2) DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS parts_replaced JSONB DEFAULT '[]';
ALTER TABLE services ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS amc_id UUID;
ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 5. BILLS
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS tax NUMERIC(10,2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS total NUMERIC(10,2);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_date DATE;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 6. BILL ITEMS
CREATE TABLE IF NOT EXISTS bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS bill_id UUID REFERENCES bills(id) ON DELETE CASCADE;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1;
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2);
ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS total NUMERIC(10,2);

-- 7. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
-- Notification Center backbone columns.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'system';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'default';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deep_link JSONB;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
-- System notifications (digest, low stock) aren't tied to a customer.
ALTER TABLE notifications ALTER COLUMN customer_id DROP NOT NULL;

-- 8. AMC CONTRACTS  (the table that was missing auto_schedule)
CREATE TABLE IF NOT EXISTS amc_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS total_services INT DEFAULT 4;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS services_used INT DEFAULT 0;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS auto_schedule BOOLEAN DEFAULT TRUE;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE amc_contracts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Now that amc_contracts is guaranteed to exist, wire the services.amc_id FK.
-- (ADD CONSTRAINT has no IF NOT EXISTS, so guard it in a DO block.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'services_amc_id_fkey' AND table_name = 'services'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_amc_id_fkey
      FOREIGN KEY (amc_id) REFERENCES amc_contracts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 9. INVENTORY PARTS
CREATE TABLE IF NOT EXISTS inventory_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 0;
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS min_stock INT DEFAULT 5;
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- inventory_parts UNIQUE (tenant_id, sku) — add if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_parts_tenant_id_sku_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'inventory_parts_tenant_id_sku_key'
  ) THEN
    BEGIN
      ALTER TABLE inventory_parts ADD CONSTRAINT inventory_parts_tenant_id_sku_key UNIQUE (tenant_id, sku);
    EXCEPTION WHEN duplicate_table THEN
      -- already exists under a different name; ignore
      NULL;
    END;
  END IF;
END $$;

-- ============================================
-- DONE. Next: run schema.sql to (re)apply indexes + RLS policies.
-- Then run the verification queries at the bottom of schema.sql.
-- ============================================
