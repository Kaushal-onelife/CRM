const { supabaseAdmin } = require("../config/supabase");

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { payment_status, customer_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("bills")
    .select("*, customers(name, phone)", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (payment_status) query = query.eq("payment_status", payment_status);
  if (customer_id) query = query.eq("customer_id", customer_id);

  const { data, count, error } = await query;

  if (error) return res.status(400).json({ error: error.message });

  res.json({ bills: data, total: count, page: +page, limit: +limit });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("bills")
    .select("*, bill_items(*), customers(name, phone, address)")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "Bill not found" });

  res.json(data);
}

async function create(req, res) {
  const { tenant_id } = req.user;
  const { items, ...billData } = req.body;

  // Generate bill number: BILL-YYYYMMDD-XXXX
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const { count } = await supabaseAdmin
    .from("bills")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenant_id);

  const billNumber = `BILL-${date}-${String((count || 0) + 1).padStart(4, "0")}`;

  // Calculate totals
  const amount = items.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0
  );
  const tax = billData.tax || 0;
  const total = amount + tax;

  // Insert bill
  const { data: bill, error: billError } = await supabaseAdmin
    .from("bills")
    .insert({
      ...billData,
      tenant_id,
      bill_number: billNumber,
      amount,
      tax,
      total,
    })
    .select()
    .single();

  if (billError) return res.status(400).json({ error: billError.message });

  // Insert bill items
  const billItems = items.map((item) => ({
    bill_id: bill.id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total: item.unit_price * item.quantity,
  }));

  const { error: itemsError } = await supabaseAdmin
    .from("bill_items")
    .insert(billItems);

  if (itemsError)
    return res.status(400).json({ error: itemsError.message });

  res.status(201).json({ ...bill, items: billItems });
}

async function markPaid(req, res) {
  const { tenant_id } = req.user;
  const { payment_method } = req.body;

  const { data, error } = await supabaseAdmin
    .from("bills")
    .update({
      payment_status: "paid",
      payment_method,
      paid_date: new Date().toISOString().split("T")[0],
    })
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
}

module.exports = { getAll, getById, create, markPaid };
