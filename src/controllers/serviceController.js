const { supabaseAdmin } = require("../config/supabase");
const { sendDbError } = require("../utils/dbError");
const notify = require("../utils/notificationEvents");

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

// Build the bill line items from a completed service's charge + parts.
function buildBillItems(service) {
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
  return items;
}

// Create exactly one bill for a completed service. IDEMPOTENT: if a bill already
// exists for this service_id we return that one instead of inserting a duplicate,
// so calling this from both markCompleted and the manual generate-bill path (or
// twice) can never inflate revenue. Returns { bill, items, alreadyExisted } or
// throws with a .status for the caller to surface.
async function createBillForService(tenant_id, service, { payment_status, payment_method } = {}) {
  // Guard: one bill per service.
  const { data: existing } = await supabaseAdmin
    .from("bills")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("service_id", service.id)
    .maybeSingle();
  if (existing) return { bill: existing, items: null, alreadyExisted: true };

  const items = buildBillItems(service);
  const amount = items.reduce((sum, item) => sum + item.total, 0);
  const total = amount; // no tax for now
  const isPaid = payment_status === "paid";
  const today = new Date().toISOString().split("T")[0];
  const datePrefix = today.replace(/-/g, "");

  const { count: existingCount } = await supabaseAdmin
    .from("bills")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenant_id);

  // Race-safe unique bill_number: retry on the unique-violation (23505).
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
        paid_date: isPaid ? today : null,
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
    const err = new Error(billError ? billError.message : "Could not generate bill number");
    err.status = 400;
    throw err;
  }

  if (items.length > 0) {
    const billItems = items.map((item) => ({ ...item, bill_id: bill.id }));
    await supabaseAdmin.from("bill_items").insert(billItems);
  }

  return { bill, items, alreadyExisted: false };
}

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { status, customer_id, from, to, search, page = 1 } = req.query;
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
    query = query.eq("status", "scheduled").gt("scheduled_date", today);
  } else if (status === "due") {
    query = query.eq("status", "scheduled").lte("scheduled_date", today);
  } else if (status && status !== "all") {
    query = query.eq("status", status);
  }

  // Search by service type OR customer name/phone in a single OR. Using the
  // embedded `customers.<col>` form keeps the customers join a LEFT join so a
  // service-type-only match isn't dropped when the customer doesn't match.
  if (search) {
    const s = search.replace(/[%,()]/g, ""); // strip PostgREST filter metachars
    query = query.or(
      `service_type.ilike.%${s}%,customers.name.ilike.%${s}%,customers.phone.ilike.%${s}%`
    );
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

  if (error) return sendDbError(res, error, { fk: "The selected customer no longer exists." });

  // Notify the assignee when a service is created already assigned to someone.
  if (data.assigned_to) {
    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("name")
      .eq("id", data.customer_id)
      .maybeSingle();
    notify.serviceAssigned({
      tenant_id,
      service: data,
      customer_name: cust?.name || "",
      assigned_to: data.assigned_to,
    });
  }

  res.status(201).json(data);
}

async function update(req, res) {
  const { tenant_id } = req.user;

  // Guard against editing a COMPLETED service. A completed service is an audit/
  // financial record — it may have a bill and may count toward an AMC contract,
  // so its fields must stay immutable. (Status buttons for not-yet-completed
  // services and markCompleted still work; this only locks completed ones.)
  const { data: current, error: loadErr } = await supabaseAdmin
    .from("services")
    .select("status")
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (loadErr || !current) return res.status(404).json({ error: "Service not found" });

  if (current.status === "completed") {
    return res.status(409).json({
      error: "This service is completed and can't be edited. Completed services are kept as a record.",
    });
  }

  const { data, error } = await supabaseAdmin
    .from("services")
    .update(pick(req.body, SERVICE_WRITE_FIELDS))
    .eq("id", req.params.id)
    .eq("tenant_id", tenant_id)
    .select()
    .single();

  if (error) return sendDbError(res, error);

  res.json(data);
}

// DELETE /services/:id — remove a service. Blocked once completed (it may have a
// bill / count toward an AMC / be part of the record). Allowed for scheduled,
// pending, followup or rejected services. Nulls any notification pointers first
// (notifications.service_id has no cascade) so we don't leave dangling refs.
async function remove(req, res) {
  const { tenant_id } = req.user;
  const id = req.params.id;

  const { data: svc, error: loadErr } = await supabaseAdmin
    .from("services")
    .select("status")
    .eq("id", id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (loadErr || !svc) return res.status(404).json({ error: "Service not found" });

  if (svc.status === "completed") {
    return res.status(409).json({
      error: "Can't delete a completed service — it's part of your records and may have a bill.",
    });
  }

  // Detach any reminder/notification logs pointing at this service (no FK cascade).
  await supabaseAdmin
    .from("notifications")
    .update({ service_id: null })
    .eq("tenant_id", tenant_id)
    .eq("service_id", id);

  const { error: delErr } = await supabaseAdmin
    .from("services")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenant_id);

  // A bill referencing this service would block the delete (FK restrict) — surface
  // a clear message instead of the raw constraint error.
  if (delErr) {
    return sendDbError(res, delErr, {
      fk: "Can't delete — a bill is linked to this service. Delete the bill first.",
    });
  }
  res.json({ message: "Service deleted" });
}

async function markCompleted(req, res) {
  try {
    const { tenant_id } = req.user;
    const {
      next_due_date,
      next_service_type,
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
    // The next visit is usually a DIFFERENT type than the one just completed
    // (e.g. after a repair, the next visit is routine maintenance). Use the
    // explicitly chosen next_service_type; otherwise default smartly: keep the
    // same type for AMC visits (contract cycle), else fall back to filter_change.
    //
    // For AMC visits we must NOT create a follow-up beyond the contract's
    // total_services — otherwise the contract ends up with more visits than it
    // includes. If all visits are used, completing the last one is a renewal cue,
    // not a reason to schedule another.
    if (next_due_date) {
      let allowFollowup = true;
      if (data.amc_id) {
        const [{ data: amc }, { count: completedCount }] = await Promise.all([
          supabaseAdmin
            .from("amc_contracts")
            .select("total_services")
            .eq("id", data.amc_id)
            .eq("tenant_id", tenant_id)
            .maybeSingle(),
          supabaseAdmin
            .from("services")
            .select("id", { count: "exact", head: true })
            .eq("amc_id", data.amc_id)
            .eq("tenant_id", tenant_id)
            .eq("status", "completed"),
        ]);
        // completedCount already includes the visit we just completed.
        if (amc && (completedCount || 0) >= (amc.total_services || 0)) {
          allowFollowup = false;
        }
      }

      if (allowFollowup) {
        const nextType =
          next_service_type ||
          (data.amc_id ? data.service_type : "filter_change");
        const { error: nextServiceError } = await supabaseAdmin
          .from("services")
          .insert({
            tenant_id,
            customer_id: data.customer_id,
            service_type: nextType,
            status: "scheduled",
            scheduled_date: next_due_date,
            amc_id: data.amc_id || null,
            assigned_to: data.assigned_to || null,
          });

        if (nextServiceError) {
          return res.status(400).json({ error: nextServiceError.message });
        }
      }
    }
    // Note: services_used is no longer incremented here — it's computed live from
    // completed AMC-linked visits in amcController (self-healing, no drift).

    // Auto-create the bill so every completed service is captured in revenue —
    // no skippable manual step. Idempotent (one bill per service). A billing
    // failure must NOT roll back the completion (the visit really happened), so
    // we log and continue; the manual generate-bill path remains as a backstop.
    let bill = null;
    try {
      const result = await createBillForService(tenant_id, data, {
        payment_status,
        payment_method,
      });
      bill = result.bill;
    } catch (billErr) {
      console.error("markCompleted: auto-bill failed:", billErr);
    }

    // Notify staff the visit is done (quiet confirmation).
    notify.serviceCompleted({
      tenant_id,
      service: data,
      customer_name: data.customers?.name || "",
    });

    res.json({
      service: data,
      bill, // the auto-created (or existing) bill, or null if billing failed
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

  // Idempotent: returns the existing bill if one was already auto-created on
  // completion, otherwise creates it. Either way the caller gets a single bill.
  let bill;
  try {
    const result = await createBillForService(tenant_id, service, {
      payment_status,
      payment_method,
    });
    bill = result.bill;
    // If it already existed, re-fetch its items so the response is complete.
    const items = result.items ?? (
      await supabaseAdmin.from("bill_items").select("*").eq("bill_id", bill.id)
    ).data ?? [];
    return res
      .status(result.alreadyExisted ? 200 : 201)
      .json({ ...bill, items, customer: service.customers });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { getAll, getById, getCustomerHistory, create, update, remove, markCompleted, generateBill };
