const { supabaseAdmin } = require("../config/supabase");
const { toCsv, parseCsv } = require("../utils/csv");

const MAX_LIMIT = 100;

// Columns used for both export and import. `header` is the CSV column name the
// user sees/edits; `key` is the DB column. Keep export and import in the same
// shape so a file exported from the app can be re-imported unchanged.
const CSV_COLUMNS = [
  { key: "name", header: "name" },
  { key: "phone", header: "phone" },
  { key: "email", header: "email" },
  { key: "address", header: "address" },
  { key: "city", header: "city" },
  { key: "purifier_brand", header: "purifier_brand" },
  { key: "purifier_model", header: "purifier_model" },
  { key: "installation_date", header: "installation_date" },
  { key: "notes", header: "notes" },
];

const PHONE_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Only these columns may be written from the client (drops stray fields / id /
// joined data so PostgREST never errors on an unknown column).
const CUSTOMER_WRITE_FIELDS = [
  "name",
  "phone",
  "email",
  "address",
  "city",
  "purifier_brand",
  "purifier_model",
  "installation_date",
  "fcm_token",
  "notes",
];

function pick(body, fields) {
  const out = {};
  for (const k of fields) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { search, city, page = 1 } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("customers")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (city) {
    query = query.eq("city", city);
  }

  const { data, count, error } = await query;

  if (error) return res.status(400).json({ error: error.message });

  res.json({ customers: data, total: count, page: +page, limit });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "Customer not found" });

  res.json(data);
}

async function create(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .insert({ ...pick(req.body, CUSTOMER_WRITE_FIELDS), tenant_id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .update(pick(req.body, CUSTOMER_WRITE_FIELDS))
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
}

async function remove(req, res) {
  const { tenant_id } = req.user;
  const customerId = req.params.id;

  // C3: customers are referenced by services/bills/amc_contracts (no cascade),
  // so a raw delete would FK-error with an opaque message. Check first and
  // return a clear, actionable message instead.
  const [services, bills, amc] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("customer_id", customerId),
    supabaseAdmin
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("customer_id", customerId),
    supabaseAdmin
      .from("amc_contracts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("customer_id", customerId),
  ]);

  const parts = [];
  if (services.count) parts.push(`${services.count} service${services.count > 1 ? "s" : ""}`);
  if (bills.count) parts.push(`${bills.count} bill${bills.count > 1 ? "s" : ""}`);
  if (amc.count) parts.push(`${amc.count} AMC contract${amc.count > 1 ? "s" : ""}`);

  if (parts.length > 0) {
    return res.status(409).json({
      error: `Can't delete this customer — they have ${parts.join(", ")}. Remove those first.`,
    });
  }

  const { error } = await supabaseAdmin
    .from("customers")
    .delete()
    .eq("id", customerId)
    .eq("tenant_id", tenant_id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Customer deleted" });
}

// GET /customers/export — return ALL customers for the tenant as CSV text.
async function exportCsv(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select(CSV_COLUMNS.map((c) => c.key).join(","))
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const csv = toCsv(data || [], CSV_COLUMNS);
  const stamp = new Date().toISOString().split("T")[0];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="customers-${stamp}.csv"`
  );
  // Prepend BOM so Excel opens UTF-8 (e.g. names with accents) correctly.
  res.send("﻿" + csv);
}

// Normalize + validate one parsed CSV row. Returns { value } or { error }.
function normalizeRow(row) {
  const name = (row.name || "").trim();
  const phoneRaw = (row.phone || "").trim();
  const phone = phoneRaw.replace(/\D/g, ""); // strip spaces, +91, dashes, letters
  const email = (row.email || "").trim();
  const installation_date = (row.installation_date || "").trim();

  if (!name) return { error: "Missing name" };
  if (!phone) return { error: "Missing phone" };
  if (!PHONE_RE.test(phone)) return { error: `Invalid phone "${phoneRaw}" (must be 10 digits)` };
  if (email && !EMAIL_RE.test(email)) return { error: `Invalid email "${email}"` };
  if (installation_date && !DATE_RE.test(installation_date))
    return { error: `Invalid installation_date "${installation_date}" (use YYYY-MM-DD)` };

  return {
    value: {
      name,
      phone,
      email: email || null,
      address: (row.address || "").trim() || null,
      city: (row.city || "").trim() || null,
      purifier_brand: (row.purifier_brand || "").trim() || null,
      purifier_model: (row.purifier_model || "").trim() || null,
      installation_date: installation_date || null,
      notes: (row.notes || "").trim() || null,
    },
  };
}

// POST /customers/import
// Body: { csv: "<raw csv text>", mode?: "update" | "skip" }  (default "update")
// Dedup rule: phone is the identity per tenant.
//   - Within the file, a later row for the same phone overrides earlier ones
//     (so "same customer, different entry -> take latest").
//   - Against the DB: existing phone -> UPDATE (mode "update") or SKIP (mode "skip");
//     new phone -> INSERT.
async function importCsv(req, res) {
  const { tenant_id } = req.user;
  const { csv, mode = "update" } = req.body || {};

  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "No CSV content provided." });
  }

  const { headers, rows } = parseCsv(csv);
  if (rows.length === 0) {
    return res.status(400).json({ error: "CSV has no data rows." });
  }
  if (!headers.includes("name") || !headers.includes("phone")) {
    return res.status(400).json({
      error: 'CSV must include at least "name" and "phone" columns.',
    });
  }

  const errors = []; // { row: <1-based data row #>, error }
  const byPhone = new Map(); // phone -> normalized value (last row wins)

  rows.forEach((raw, i) => {
    const result = normalizeRow(raw);
    if (result.error) {
      errors.push({ row: i + 1, error: result.error });
      return;
    }
    // Last occurrence of a phone in the file wins (take latest).
    byPhone.set(result.value.phone, result.value);
  });

  const candidates = [...byPhone.values()];
  if (candidates.length === 0) {
    return res.status(400).json({
      error: "No valid rows to import.",
      summary: { total: rows.length, inserted: 0, updated: 0, skipped: 0, failed: errors.length },
      errors,
    });
  }

  // Find which phones already exist for this tenant.
  const phones = candidates.map((c) => c.phone);
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id, phone")
    .eq("tenant_id", tenant_id)
    .in("phone", phones);

  if (lookupErr) return res.status(400).json({ error: lookupErr.message });

  const existingByPhone = new Map((existing || []).map((c) => [c.phone, c.id]));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const toInsert = [];
  for (const c of candidates) {
    const existingId = existingByPhone.get(c.phone);
    if (!existingId) {
      toInsert.push({ ...c, tenant_id });
    } else if (mode === "skip") {
      skipped++;
    } else {
      // mode "update": overwrite the existing customer with the latest data.
      const { error: updErr } = await supabaseAdmin
        .from("customers")
        .update(c)
        .eq("id", existingId)
        .eq("tenant_id", tenant_id);
      if (updErr) errors.push({ phone: c.phone, error: updErr.message });
      else updated++;
    }
  }

  if (toInsert.length > 0) {
    const { data: insData, error: insErr } = await supabaseAdmin
      .from("customers")
      .insert(toInsert)
      .select("id");
    if (insErr) {
      // Whole-batch failure (e.g. constraint). Report it rather than silently losing rows.
      errors.push({ error: `Insert failed: ${insErr.message}` });
    } else {
      inserted = insData.length;
    }
  }

  res.json({
    summary: {
      total: rows.length,
      validUnique: candidates.length,
      inserted,
      updated,
      skipped,
      failed: errors.length,
    },
    errors,
  });
}

module.exports = { getAll, getById, create, update, remove, exportCsv, importCsv };
