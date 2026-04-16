const { supabaseAdmin } = require("../config/supabase");

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { low_stock, search } = req.query;

  let query = supabaseAdmin
    .from("parts_inventory")
    .select("*")
    .eq("tenant_id", tenant_id)
    .order("name", { ascending: true });

  if (low_stock === "true") {
    // Raw filter: quantity <= min_stock
    query = query.filter("quantity", "lte", "min_stock");
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error } = await query;

  if (error) return res.status(400).json({ error: error.message });

  // Filter low stock in JS since Supabase can't compare two columns easily
  let parts = data;
  if (low_stock === "true") {
    parts = data.filter((p) => p.quantity <= p.min_stock);
  }

  const lowStockCount = data.filter((p) => p.quantity <= p.min_stock).length;

  res.json({ parts, low_stock_count: lowStockCount });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("parts_inventory")
    .select("*")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "Part not found" });

  // Get usage history
  const { data: usage } = await supabaseAdmin
    .from("parts_usage")
    .select("*, services(service_type, scheduled_date, customers(name))")
    .eq("part_id", req.params.id)
    .order("created_at", { ascending: false })
    .limit(20);

  res.json({ ...data, usage: usage || [] });
}

async function create(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("parts_inventory")
    .insert({ ...req.body, tenant_id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("parts_inventory")
    .update({ ...req.body, updated_at: new Date().toISOString() })
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
    .from("parts_inventory")
    .delete()
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Part deleted" });
}

module.exports = { getAll, getById, create, update, remove };
