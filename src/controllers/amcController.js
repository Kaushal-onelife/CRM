const { supabaseAdmin } = require("../config/supabase");
const { sendDbError } = require("../utils/dbError");

const MAX_LIMIT = 100;

function evenlyDistributedDates(start, end, count) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (count <= 0 || endMs <= startMs) return [];
  const span = endMs - startMs;
  const step = span / (count + 1);
  const dates = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(startMs + step * i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { status, page = 1 } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("amc_contracts")
    .select("*, customers(name, phone)", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, count, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ contracts: data, total: count, page: +page, limit });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data: contract, error } = await supabaseAdmin
    .from("amc_contracts")
    .select("*, customers(name, phone, address, purifier_brand, purifier_model)")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "AMC contract not found" });

  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, service_type, status, scheduled_date, completed_date")
    .eq("amc_id", contract.id)
    .eq("tenant_id", tenant_id)
    .order("scheduled_date", { ascending: true });

  res.json({ ...contract, services: services || [] });
}

async function create(req, res) {
  const { tenant_id } = req.user;
  const {
    customer_id,
    plan_name,
    start_date,
    end_date,
    total_services,
    amount,
    auto_schedule,
    notes,
  } = req.body;

  if (!customer_id || !plan_name || !start_date || !end_date) {
    return res
      .status(400)
      .json({ error: "customer_id, plan_name, start_date, end_date required" });
  }

  const totalServicesInt = parseInt(total_services, 10) || 4;

  const { data: contract, error } = await supabaseAdmin
    .from("amc_contracts")
    .insert({
      tenant_id,
      customer_id,
      plan_name,
      start_date,
      end_date,
      total_services: totalServicesInt,
      amount: parseFloat(amount) || 0,
      auto_schedule: !!auto_schedule,
      notes: notes || null,
      status: "active",
    })
    .select()
    .single();

  if (error) return sendDbError(res, error, { fk: "The selected customer no longer exists." });

  if (auto_schedule && totalServicesInt > 0) {
    const dates = evenlyDistributedDates(start_date, end_date, totalServicesInt);
    if (dates.length) {
      const rows = dates.map((d) => ({
        tenant_id,
        customer_id,
        amc_id: contract.id,
        service_type: "amc_service",
        status: "scheduled",
        scheduled_date: d,
      }));
      const { error: svcError } = await supabaseAdmin.from("services").insert(rows);
      if (svcError) {
        await supabaseAdmin.from("amc_contracts").delete().eq("id", contract.id);
        return sendDbError(res, svcError, { fallback: "Couldn't schedule AMC services. Please try again." });
      }
    }
  }

  res.status(201).json(contract);
}

async function update(req, res) {
  const { tenant_id } = req.user;
  const allowed = [
    "plan_name",
    "start_date",
    "end_date",
    "total_services",
    "services_used",
    "amount",
    "payment_status",
    "status",
    "notes",
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const { data, error } = await supabaseAdmin
    .from("amc_contracts")
    .update(updates)
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return sendDbError(res, error);
  res.json(data);
}

async function checkExpired(req, res) {
  const { tenant_id } = req.user;
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabaseAdmin
    .from("amc_contracts")
    .update({ status: "expired" })
    .eq("tenant_id", tenant_id)
    .eq("status", "active")
    .lt("end_date", today)
    .select("id");

  if (error) return res.status(400).json({ error: error.message });
  res.json({ expired_count: data ? data.length : 0 });
}

module.exports = { getAll, getById, create, update, checkExpired };
