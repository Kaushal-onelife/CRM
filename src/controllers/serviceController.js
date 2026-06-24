const { supabaseAdmin } = require("../config/supabase");

const MAX_LIMIT = 100;

// Only these columns may be written from the client. Anything else (stray
// frontend-only fields, joined `customers`, `id`) is dropped so PostgREST never
// rejects the whole request with "column ... does not exist".
const SERVICE_WRITE_FIELDS = [
  "customer_id",
  "service_type",
  "status",
  "scheduled_date",
  "completed_date",
  "next_due_date",
  "next_contact_date",
  "assigned_to",
  "amount",
  "service_charge",
  "parts_replaced",
  "notes",
  "amc_id",
];

function pick(body, fields) {
  const out = {};
  for (const k of fields) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { status, customer_id, from, to, page = 1 } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
  const offset = (page - 1) * limit;
  const today = new Date().toISOString().split("T")[0];

  let query = supabaseAdmin
    .from("services")
    .select("*, customers(name, phone)", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("scheduled_date", { ascending: true })
    .range(offset, offset + limit - 1);

  // Date-based filtering for upcoming/due (auto-classification of 'scheduled' status)
  if (status === "upcoming") {
    query = query.eq("status", "scheduled").gte("scheduled_date", today);
  } else if (status === "due") {
    query = query.eq("status", "scheduled").lt("scheduled_date", today);
  } else if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (customer_id) query = query.eq("customer_id", customer_id);
  if (from) query = query.gte("scheduled_date", from);
  if (to) query = query.lte("scheduled_date", to);

  const { data, count, error } = await query;

  if (error) return res.status(400).json({ error: error.message });

  res.json({ services: data, total: count, page: +page, limit });
}

async function getById(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("services")
    .select("*, customers(name, phone, address, purifier_model, purifier_brand)")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .single();

  if (error) return res.status(404).json({ error: "Service not found" });

  res.json(data);
}

// Get service history for a customer (used in completion form modal)
async function getCustomerHistory(req, res) {
  const { tenant_id } = req.user;
  const { customer_id } = req.params;

  const { data, error } = await supabaseAdmin
    .from("services")
    .select("id, service_type, status, scheduled_date, completed_date, amount, service_charge, parts_replaced, notes")
    .eq("tenant_id", tenant_id)
    .eq("customer_id", customer_id)
    .eq("status", "completed")
    .order("completed_date", { ascending: false })
    .limit(10);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ services: data });
}

async function create(req, res) {
  const { tenant_id } = req.user;

  if (!req.body.scheduled_date) {
    return res.status(400).json({ error: "scheduled_date is required" });
  }

  const { data, error } = await supabaseAdmin
    .from("services")
    .insert({ ...pick(req.body, SERVICE_WRITE_FIELDS), tenant_id, status: "scheduled" })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  const { data, error } = await supabaseAdmin
    .from("services")
    .update(pick(req.body, SERVICE_WRITE_FIELDS))
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
}

async function markCompleted(req, res) {
  try {
    const { tenant_id } = req.user;
    const {
      next_due_date,
      service_charge,
      parts_replaced,
      notes,
      payment_status,
      payment_method,
    } = req.body;

    const normalizedParts = Array.isArray(parts_replaced) ? parts_replaced : [];

    // Calculate total amount from service charge + parts
    const partsTotal = normalizedParts.reduce(
      (sum, part) =>
        sum +
        (parseFloat(part.cost) || 0) * (parseInt(part.quantity, 10) || 1),
      0
    );
    const totalAmount = (parseFloat(service_charge) || 0) + partsTotal;

    // C1: only complete a service that ISN'T already completed. `.neq` makes the
    // update a no-op (0 rows) if it was already completed — preventing duplicate
    // follow-ups / double counting from a re-submit. We use maybeSingle() so
    // "0 rows" isn't an error; we detect it and return 409.
    const { data, error } = await supabaseAdmin
      .from("services")
      .update({
        status: "completed",
        completed_date: new Date().toISOString().split("T")[0],
        next_due_date: next_due_date || null,
        amount: totalAmount,
        service_charge: parseFloat(service_charge) || 0,
        parts_replaced: normalizedParts,
        notes,
      })
      .eq("id", req.params.id)
      .eq("tenant_id", tenant_id)
      .neq("status", "completed")
      .select("*, customers(name, phone, address)")
      .maybeSingle();

    if (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!data) {
      // No row updated => it was already completed (or doesn't exist).
      return res.status(409).json({ error: "This service is already completed." });
    }

    // If next_due_date provided, create the next service automatically.
    // W2: carry amc_id + assigned_to so an AMC's recurring visit stays linked.
    if (next_due_date) {
      const { error: nextServiceError } = await supabaseAdmin
        .from("services")
        .insert({
          tenant_id,
          customer_id: data.customer_id,
          service_type: data.service_type,
          status: "scheduled",
          scheduled_date: next_due_date,
          amc_id: data.amc_id || null,
          assigned_to: data.assigned_to || null,
        });

      if (nextServiceError) {
        return res.status(400).json({ error: nextServiceError.message });
      }
    }

    // C2: if this was an AMC service, increment the contract's services_used.
    if (data.amc_id) {
      const { data: amc } = await supabaseAdmin
        .from("amc_contracts")
        .select("services_used")
        .eq("id", data.amc_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      if (amc) {
        await supabaseAdmin
          .from("amc_contracts")
          .update({ services_used: (amc.services_used || 0) + 1 })
          .eq("id", data.amc_id)
          .eq("tenant_id", tenant_id);
      }
    }

    res.json({
      service: data,
      amount: totalAmount,
      service_charge: parseFloat(service_charge) || 0,
      parts_total: partsTotal,
      payment_status: payment_status || "unpaid",
      payment_method: payment_method || null,
    });
  } catch (error) {
    console.error("markCompleted error:", error);
    res.status(500).json({ error: error.message || "Failed to complete service" });
  }
}

// Auto-generate bill from completed service data
async function generateBill(req, res) {
  const { tenant_id } = req.user;
  const { service_id, payment_status, payment_method } = req.body;

  // Fetch the completed service
  const { data: service, error: serviceError } = await supabaseAdmin
    .from("services")
    .select("*, customers(name, phone, address)")
    .eq("id", service_id)
    .eq("tenant_id", tenant_id)
    .single();

  if (serviceError) return res.status(404).json({ error: "Service not found" });
  if (service.status !== "completed") {
    return res.status(400).json({ error: "Service must be completed first" });
  }

  // Build bill items from parts + service charge
  const items = [];
  if (service.service_charge > 0) {
    items.push({
      description: `Service Charge - ${service.service_type.replace(/_/g, " ")}`,
      quantity: 1,
      unit_price: parseFloat(service.service_charge),
      total: parseFloat(service.service_charge),
    });
  }
  if (service.parts_replaced && service.parts_replaced.length > 0) {
    for (const part of service.parts_replaced) {
      const qty = parseInt(part.quantity) || 1;
      const price = parseFloat(part.cost) || 0;
      items.push({
        description: part.name,
        quantity: qty,
        unit_price: price,
        total: qty * price,
      });
    }
  }

  const amount = items.reduce((sum, item) => sum + item.total, 0);
  const total = amount; // no tax for now

  // Create the bill (race-safe unique bill_number)
  const isPaid = payment_status === "paid";
  const datePrefix = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const { count: existingCount } = await supabaseAdmin
    .from("bills")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenant_id);

  let bill = null;
  let billError = null;
  let seq = (existingCount || 0) + 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const billNumber = `BILL-${datePrefix}-${String(seq).padStart(4, "0")}`;
    const insertResult = await supabaseAdmin
      .from("bills")
      .insert({
        tenant_id,
        customer_id: service.customer_id,
        service_id: service.id,
        bill_number: billNumber,
        amount,
        tax: 0,
        total,
        payment_status: payment_status || "unpaid",
        payment_method: isPaid ? payment_method : null,
        paid_date: isPaid ? new Date().toISOString().split("T")[0] : null,
      })
      .select()
      .single();

    if (!insertResult.error) {
      bill = insertResult.data;
      break;
    }
    if (insertResult.error.code === "23505") {
      seq += 1;
      continue;
    }
    billError = insertResult.error;
    break;
  }

  if (!bill) {
    return res
      .status(400)
      .json({ error: billError ? billError.message : "Could not generate bill number" });
  }

  // Insert bill items
  if (items.length > 0) {
    const billItems = items.map((item) => ({ ...item, bill_id: bill.id }));
    await supabaseAdmin.from("bill_items").insert(billItems);
  }

  res.status(201).json({ ...bill, items, customer: service.customers });
}

module.exports = { getAll, getById, getCustomerHistory, create, update, markCompleted, generateBill };
