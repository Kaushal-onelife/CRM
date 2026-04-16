const { supabaseAdmin } = require("../config/supabase");

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { status, customer_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("amc_contracts")
    .select("*, customers(name, phone, purifier_model)", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("end_date", { ascending: true })
    .range(offset, offset + limit - 1);

  if (status && status !== "all") query = query.eq("status", status);
  if (customer_id) query = query.eq("customer_id", customer_id);

  const { data, count, error } = await query;

  if (error) return res.status(400).json({ error: error.message });

  res.json({ contracts: data, total: count, page: +page, limit: +limit });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("amc_contracts")
    .select("*, customers(name, phone, address, purifier_brand, purifier_model)")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "AMC contract not found" });

  // Get services linked to this AMC
  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, service_type, status, scheduled_date, completed_date, amount")
    .eq("amc_id", req.params.id)
    .order("scheduled_date", { ascending: true });

  res.json({ ...data, services: services || [] });
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
    notes,
    auto_schedule,
  } = req.body;

  // Create AMC contract
  const { data, error } = await supabaseAdmin
    .from("amc_contracts")
    .insert({
      tenant_id,
      customer_id,
      plan_name,
      start_date,
      end_date,
      total_services: total_services || 4,
      amount: amount || 0,
      notes,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Auto-schedule services if requested
  if (auto_schedule && total_services > 0) {
    const startMs = new Date(start_date).getTime();
    const endMs = new Date(end_date).getTime();
    const intervalMs = (endMs - startMs) / total_services;

    const servicesToInsert = [];
    for (let i = 0; i < total_services; i++) {
      const serviceDate = new Date(startMs + intervalMs * i + intervalMs / 2);
      servicesToInsert.push({
        tenant_id,
        customer_id,
        service_type: "amc",
        status: "scheduled",
        scheduled_date: serviceDate.toISOString().split("T")[0],
        amc_id: data.id,
      });
    }

    await supabaseAdmin.from("services").insert(servicesToInsert);
  }

  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("amc_contracts")
    .update(req.body)
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
}

// Called from cron or manually - marks expired AMCs
async function checkExpired(req, res) {
  const { tenant_id } = req.user;
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabaseAdmin
    .from("amc_contracts")
    .update({ status: "expired" })
    .eq("tenant_id", tenant_id)
    .eq("status", "active")
    .lt("end_date", today)
    .select();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ expired_count: data.length, contracts: data });
}

module.exports = { getAll, getById, create, update, checkExpired };
