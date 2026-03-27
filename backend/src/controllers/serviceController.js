const { supabaseAdmin } = require("../config/supabase");

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { status, customer_id, from, to, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("services")
    .select("*, customers(name, phone)", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("scheduled_date", { ascending: true })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (customer_id) query = query.eq("customer_id", customer_id);
  if (from) query = query.gte("scheduled_date", from);
  if (to) query = query.lte("scheduled_date", to);

  const { data, count, error } = await query;

  if (error) return res.status(400).json({ error: error.message });

  res.json({ services: data, total: count, page: +page, limit: +limit });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("services")
    .select("*, customers(name, phone, address)")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "Service not found" });

  res.json(data);
}

async function create(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("services")
    .insert({ ...req.body, tenant_id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("services")
    .update(req.body)
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
}

async function markCompleted(req, res) {
  const { tenant_id } = req.user;
  const { next_due_date, amount, notes } = req.body;

  const { data, error } = await supabaseAdmin
    .from("services")
    .update({
      status: "completed",
      completed_date: new Date().toISOString().split("T")[0],
      next_due_date,
      amount,
      notes,
    })
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // If next_due_date provided, create the next service automatically
  if (next_due_date) {
    await supabaseAdmin.from("services").insert({
      tenant_id,
      customer_id: data.customer_id,
      service_type: data.service_type,
      status: "upcoming",
      scheduled_date: next_due_date,
    });
  }

  res.json(data);
}

module.exports = { getAll, getById, create, update, markCompleted };
