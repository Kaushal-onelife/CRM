const { supabaseAdmin } = require("../config/supabase");
const { sendDbError } = require("../utils/dbError");

const MAX_LIMIT = 100;

// Insert a bill, retrying on unique-violation against (tenant_id, bill_number).
// Postgres unique-violation surfaces as Supabase error code 23505.
async function insertBillWithUniqueNumber(tenant_id, baseInsert) {
  const datePrefix = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const { count } = await supabaseAdmin
    .from("bills")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenant_id);

  let seq = (count || 0) + 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const billNumber = `BILL-${datePrefix}-${String(seq).padStart(4, "0")}`;
    const { data, error } = await supabaseAdmin
      .from("bills")
      .insert({ ...baseInsert, tenant_id, bill_number: billNumber })
      .select()
      .single();

    if (!error) return { data, error: null };
    if (error.code === "23505") {
      seq += 1;
      continue;
    }
    return { data: null, error };
  }
  return {
    data: null,
    error: { message: "Could not generate a unique bill number, please retry." },
  };
}

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { payment_status, customer_id, page = 1 } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
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

  res.json({ bills: data, total: count, page: +page, limit });
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
  const { items, customer_id, service_id, tax: taxIn, payment_status, payment_method } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Bill must include at least one item" });
  }

  // Calculate totals
  const amount = items.reduce(
    (sum, item) =>
      sum + (parseFloat(item.unit_price) || 0) * (parseInt(item.quantity, 10) || 0),
    0
  );
  const tax = parseFloat(taxIn) || 0;
  const total = amount + tax;

  // Allow creating a bill as already paid (e.g. paid on the spot). Stamp the
  // paid_date + method only when marked paid; otherwise default to unpaid.
  const isPaid = payment_status === "paid";
  const today = new Date().toISOString().split("T")[0];

  const { data: bill, error: billError } = await insertBillWithUniqueNumber(
    tenant_id,
    {
      customer_id,
      service_id: service_id || null,
      amount,
      tax,
      total,
      payment_status: isPaid ? "paid" : "unpaid",
      payment_method: isPaid ? payment_method || null : null,
      paid_date: isPaid ? today : null,
    }
  );

  if (billError) return sendDbError(res, billError, { fk: "The selected customer no longer exists." });

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
    return sendDbError(res, itemsError, { fallback: "Couldn't save bill items. Please try again." });

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

  if (error) return sendDbError(res, error);

  res.json(data);
}

module.exports = { getAll, getById, create, markPaid };
