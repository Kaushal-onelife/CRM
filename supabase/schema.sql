-- ============================================
-- Water Purifier CRM - Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TENANTS (each business/client)
CREATE TABLE tenants (
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
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. CUSTOMERS (end customers of the business)
CREATE TABLE customers (
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
CREATE TABLE services (
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
CREATE TABLE bills (
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
CREATE TABLE bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INT DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL
);

-- 7. NOTIFICATIONS LOG
CREATE TABLE notifications (
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

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_services_tenant_status ON services(tenant_id, status);
CREATE INDEX idx_services_tenant_scheduled ON services(tenant_id, scheduled_date);
CREATE INDEX idx_services_tenant_next_due ON services(tenant_id, next_due_date);
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_bills_tenant_payment ON bills(tenant_id, payment_status);

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

-- Tenant isolation policies
CREATE POLICY tenant_isolation ON customers
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON services
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON bills
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON notifications
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON bill_items
  FOR ALL USING (bill_id IN (SELECT id FROM bills));

CREATE POLICY user_can_read_own_profile ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY user_can_update_own_profile ON users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY user_can_read_own_tenant ON tenants
  FOR SELECT USING (id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
