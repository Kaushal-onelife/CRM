-- ============================================
-- Migration: AMC Contracts + Parts Inventory
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. AMC CONTRACTS
CREATE TABLE amc_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  plan_name TEXT NOT NULL,              -- e.g. "Annual Basic", "Premium 2-Year"
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_services INT NOT NULL DEFAULT 4, -- how many services included
  services_used INT NOT NULL DEFAULT 0,  -- how many completed
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status TEXT DEFAULT 'unpaid',  -- unpaid, partial, paid
  status TEXT DEFAULT 'active',          -- active, expired, cancelled
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. PARTS INVENTORY
CREATE TABLE parts_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,                    -- e.g. "RO Membrane", "Sediment Filter"
  sku TEXT,                              -- optional part code
  quantity INT NOT NULL DEFAULT 0,       -- current stock
  min_stock INT NOT NULL DEFAULT 5,      -- alert threshold
  unit_price NUMERIC(10,2) DEFAULT 0,   -- selling price
  cost_price NUMERIC(10,2) DEFAULT 0,   -- purchase price
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. PARTS USAGE LOG (links services to inventory)
CREATE TABLE parts_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  service_id UUID NOT NULL REFERENCES services(id),
  part_id UUID NOT NULL REFERENCES parts_inventory(id),
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,     -- price at time of use
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add AMC reference to services table
ALTER TABLE services ADD COLUMN amc_id UUID REFERENCES amc_contracts(id);

-- Add photos support to services
ALTER TABLE services ADD COLUMN photos JSONB DEFAULT '[]';

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_amc_tenant ON amc_contracts(tenant_id);
CREATE INDEX idx_amc_customer ON amc_contracts(customer_id);
CREATE INDEX idx_amc_status ON amc_contracts(tenant_id, status);
CREATE INDEX idx_amc_end_date ON amc_contracts(tenant_id, end_date);
CREATE INDEX idx_inventory_tenant ON parts_inventory(tenant_id);
CREATE INDEX idx_parts_usage_service ON parts_usage(service_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE amc_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON amc_contracts
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON parts_inventory
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON parts_usage
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
