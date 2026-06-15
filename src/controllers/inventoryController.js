const { supabaseAdmin } = require("../config/supabase");

const MAX_LIMIT = 100;

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { page = 1, search } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("inventory_parts")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const lowStock = (data || []).filter((p) => p.quantity <= p.min_stock).length;

  res.json({
    parts: data,
    total: count,
    page: +page,
    limit,
    low_stock_count: lowStock,
  });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("inventory_parts")
    .select("*")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "Part not found" });
  res.json(data);
}

function sanitize(body) {
  return {
    name: body.name,
    sku: body.sku || null,
    quantity: parseInt(body.quantity, 10) || 0,
    min_stock: parseInt(body.min_stock, 10) || 5,
    unit_price: parseFloat(body.unit_price) || 0,
    cost_price: parseFloat(body.cost_price) || 0,
  };
}

// A duplicate SKU hits the UNIQUE (tenant_id, sku) constraint (Postgres 23505).
// Surface a clear message instead of the raw constraint error.
function skuConflict(error, res) {
  if (error.code === "23505") {
    return res
      .status(409)
      .json({ error: "A part with this SKU already exists. Use a different SKU." });
  }
  return res.status(400).json({ error: error.message });
}

async function create(req, res) {
  const { tenant_id } = req.user;
  if (!req.body.name) {
    return res.status(400).json({ error: "Part name is required" });
  }

  const { data, error } = await supabaseAdmin
    .from("inventory_parts")
    .insert({ ...sanitize(req.body), tenant_id })
    .select()
    .single();

  if (error) return skuConflict(error, res);
  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("inventory_parts")
    .update(sanitize(req.body))
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return skuConflict(error, res);
  res.json(data);
}

async function remove(req, res) {
  const { tenant_id } = req.user;

  const { error } = await supabaseAdmin
    .from("inventory_parts")
    .delete()
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Part deleted" });
}

module.exports = { getAll, getById, create, update, remove };
