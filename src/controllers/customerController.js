const { supabaseAdmin } = require("../config/supabase");

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { search, city, page = 1, limit = 20 } = req.query;
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

  res.json({ customers: data, total: count, page: +page, limit: +limit });
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
    .insert({ ...req.body, tenant_id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .update(req.body)
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
}

async function remove(req, res) {
  const { tenant_id } = req.user;

  const { error } = await supabaseAdmin
    .from("customers")
    .delete()
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Customer deleted" });
}

module.exports = { getAll, getById, create, update, remove };
