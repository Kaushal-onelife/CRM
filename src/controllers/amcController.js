const { supabaseAdmin } = require("../config/supabase");
const { sendDbError } = require("../utils/dbError");
const { insertBillWithUniqueNumber } = require("./billController");

const MAX_LIMIT = 100;

// Generate a bill for an AMC contract (on create or renew) — mirrors the
// service->bill flow: one line item for the AMC plan, total = contract amount,
// paid/unpaid per the owner's choice. Best-effort: a bill failure must NOT undo
// an already-created contract, so the caller logs but doesn't roll back.
async function generateAmcBill(tenant_id, contract, { payment_status, payment_method, renewal } = {}) {
  try {
    const amount = parseFloat(contract.amount) || 0;
    if (amount <= 0) {
      console.log("[AMC bill] skipped — amount <= 0 for contract", contract.id);
      return { bill: null, error: null }; // nothing to bill (e.g. free/internal AMC)
    }

    const isPaid = payment_status === "paid";
    const today = new Date().toISOString().split("T")[0];
    const label = `${renewal ? "AMC Renewal" : "AMC"}: ${contract.plan_name}`;

    const { data: bill, error } = await insertBillWithUniqueNumber(tenant_id, {
      customer_id: contract.customer_id,
      service_id: null,
      amount,
      tax: 0,
      total: amount,
      payment_status: isPaid ? "paid" : "unpaid",
      payment_method: isPaid ? payment_method || null : null,
      paid_date: isPaid ? today : null,
    });
    if (error || !bill) {
      console.error("[AMC bill] insert failed:", error?.message || error);
      return { bill: null, error };
    }

    const { error: itemErr } = await supabaseAdmin.from("bill_items").insert([
      { bill_id: bill.id, description: label, quantity: 1, unit_price: amount, total: amount },
    ]);
    if (itemErr) console.error("[AMC bill] bill_items insert failed:", itemErr.message);

    console.log("[AMC bill] created", bill.bill_number, "for contract", contract.id);
    return { bill, error: null };
  } catch (e) {
    // Best-effort: never let a billing failure break contract creation.
    console.error("[AMC bill] unexpected error:", e?.message || e);
    return { bill: null, error: e };
  }
}

// Schedule `count` visits evenly across [start, end] — at the START of each
// equal segment (real quarterly cadence), not clustered in the middle.
function evenlyDistributedDates(start, end, count) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (count <= 0 || endMs <= startMs) return [];
  const span = endMs - startMs;
  const step = span / count;
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startMs + step * i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

// Derive the truthful status: a contract past its end_date is expired regardless
// of the stored status (no cron needed). 'cancelled' is explicit and preserved.
function derivedStatus(contract, today) {
  if (contract.status === "cancelled") return "cancelled";
  if (contract.end_date && contract.end_date < today) return "expired";
  return "active";
}

// Schedule the visit rows for a contract. Shared by create + renew.
async function scheduleAmcVisits(contract, count) {
  const dates = evenlyDistributedDates(contract.start_date, contract.end_date, count);
  if (!dates.length) return null;
  const rows = dates.map((d) => ({
    tenant_id: contract.tenant_id,
    customer_id: contract.customer_id,
    amc_id: contract.id,
    service_type: "amc",
    status: "scheduled",
    scheduled_date: d,
  }));
  const { error } = await supabaseAdmin.from("services").insert(rows);
  return error;
}

async function getAll(req, res) {
  const { tenant_id } = req.user;
  const { status, page = 1 } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
  const offset = (page - 1) * limit;

  // Pull contracts + a count of their COMPLETED linked visits so used/remaining
  // is computed (self-healing), not a drifting stored counter.
  let query = supabaseAdmin
    .from("amc_contracts")
    .select("*, customers(name, phone), services!amc_id(status)", { count: "exact" })
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  // Which contracts have already been renewed (appear as another contract's
  // renewed_from)? Used to show a distinct "Renewed" badge in the list.
  const renewedIds = new Set();
  {
    const { data: renewals } = await supabaseAdmin
      .from("amc_contracts")
      .select("renewed_from")
      .eq("tenant_id", tenant_id)
      .not("renewed_from", "is", null);
    for (const r of renewals || []) renewedIds.add(r.renewed_from);
  }

  const today = new Date().toISOString().split("T")[0];
  let contracts = (data || []).map((c) => {
    const used = (c.services || []).filter((s) => s.status === "completed").length;
    const { services, ...rest } = c; // don't ship the raw visit list in the list view
    return {
      ...rest,
      status: derivedStatus(c, today),
      services_used: used,
      services_remaining: Math.max(0, (c.total_services || 0) - used),
      is_renewed: renewedIds.has(c.id),
    };
  });

  // Status filter applies to the DERIVED status (so 'expired' actually works).
  if (status && status !== "all") {
    contracts = contracts.filter((c) => c.status === status);
  }

  res.json({ contracts, total: count, page: +page, limit });
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

  const list = services || [];
  const today = new Date().toISOString().split("T")[0];
  const used = list.filter((s) => s.status === "completed").length;

  // Has this contract already been renewed? (i.e. does a newer contract point
  // back to it via renewed_from). If so the UI shows "Renewed" instead of
  // offering Renew again, preventing duplicate renewal chains.
  const { data: renewal } = await supabaseAdmin
    .from("amc_contracts")
    .select("id, start_date, end_date, plan_name")
    .eq("tenant_id", tenant_id)
    .eq("renewed_from", contract.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  res.json({
    ...contract,
    status: derivedStatus(contract, today),
    services_used: used,
    services_remaining: Math.max(0, (contract.total_services || 0) - used),
    services: list,
    renewed_to: renewal || null, // the contract that replaced this one (if any)
  });
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
    payment_status,
    payment_method,
    notes,
    renewed_from,
  } = req.body;

  if (!customer_id || !plan_name || !start_date || !end_date) {
    return res
      .status(400)
      .json({ error: "customer_id, plan_name, start_date, end_date required" });
  }
  // Server-side validation (don't trust the client).
  if (end_date <= start_date) {
    return res.status(400).json({ error: "End date must be after the start date." });
  }
  const totalServicesInt = parseInt(total_services, 10);
  if (!Number.isInteger(totalServicesInt) || totalServicesInt < 1 || totalServicesInt > 52) {
    return res.status(400).json({ error: "Total services must be between 1 and 52." });
  }

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
      payment_status: payment_status === "paid" ? "paid" : "unpaid",
      notes: notes || null,
      status: "active",
      renewed_from: renewed_from || null,
    })
    .select()
    .single();

  if (error) return sendDbError(res, error, { fk: "The selected customer no longer exists." });

  if (auto_schedule && totalServicesInt > 0) {
    const svcError = await scheduleAmcVisits(contract, totalServicesInt);
    if (svcError) {
      await supabaseAdmin.from("amc_contracts").delete().eq("id", contract.id);
      return sendDbError(res, svcError, { fallback: "Couldn't schedule AMC services. Please try again." });
    }
  }

  // Auto-generate the AMC bill (best-effort; contract already created).
  const { bill } = await generateAmcBill(tenant_id, contract, { payment_status, payment_method });

  res.status(201).json({ ...contract, bill: bill || null });
}

async function update(req, res) {
  const { tenant_id } = req.user;
  // Only SAFE fields are editable. start_date/end_date/total_services are
  // intentionally NOT here: the contract's visits were already scheduled from
  // those values, so changing them in place would desync the linked visits.
  // A real date/visit-count mistake is fixed by deleting & recreating (or, for
  // an expired contract, renewing). services_used is computed, never set.
  const allowed = ["plan_name", "amount", "payment_status", "status", "notes"];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.plan_name !== undefined && !String(updates.plan_name).trim()) {
    return res.status(400).json({ error: "Plan name can't be empty." });
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No editable fields provided." });
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

// DELETE /amc/:id — remove a contract created by mistake. Guarded:
//  - blocked if it has COMPLETED visits (part of the service history)
//  - blocked if it has already been RENEWED (would break the renewal chain)
// On success the contract's still-scheduled visits are removed too. Any bill
// that was generated is a separate financial record and is intentionally KEPT
// (delete it from Bills if needed) — surfaced to the user in the confirm dialog.
async function remove(req, res) {
  const { tenant_id } = req.user;
  const id = req.params.id;

  const { data: contract, error: loadErr } = await supabaseAdmin
    .from("amc_contracts")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (loadErr || !contract) return res.status(404).json({ error: "AMC contract not found" });

  const [{ count: completedCount }, { count: renewedCount }] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("amc_id", id)
      .eq("status", "completed"),
    supabaseAdmin
      .from("amc_contracts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("renewed_from", id),
  ]);

  if (completedCount > 0) {
    return res.status(409).json({
      error: `Can't delete — this AMC has ${completedCount} completed service${completedCount > 1 ? "s" : ""} on record. Cancel it instead.`,
    });
  }
  if (renewedCount > 0) {
    return res.status(409).json({
      error: "Can't delete — this AMC has already been renewed. Delete the newer contract first.",
    });
  }

  // Remove the contract's scheduled (not-completed) visits, then the contract.
  await supabaseAdmin
    .from("services")
    .delete()
    .eq("tenant_id", tenant_id)
    .eq("amc_id", id);

  const { error: delErr } = await supabaseAdmin
    .from("amc_contracts")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenant_id);

  if (delErr) return sendDbError(res, delErr);
  res.json({ message: "AMC contract deleted" });
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

// POST /amc/:id/renew
// Creates a NEW contract linked to the old one (renewed_from), schedules fresh
// visits, then closes out the old contract: marks it expired and cancels its
// unused (still-scheduled) visits so they stop firing reminders. Completed
// visits on the old contract are kept as history.
// Body (all optional — defaults derived from the old contract):
//   { start_date, end_date, total_services, amount, payment_status, plan_name, notes }
async function renew(req, res) {
  const { tenant_id } = req.user;
  const oldId = req.params.id;

  // 1. Load the contract being renewed (tenant-scoped).
  const { data: old, error: loadErr } = await supabaseAdmin
    .from("amc_contracts")
    .select("*")
    .eq("id", oldId)
    .eq("tenant_id", tenant_id)
    .single();
  if (loadErr || !old) return res.status(404).json({ error: "AMC contract not found" });

  // 2. Build the new term — default to continuous coverage (old end + 1 day) for
    //    the same duration, but let the owner override any field.
  const b = req.body || {};
  const dayAfter = (d) => {
    const x = new Date(d);
    x.setDate(x.getDate() + 1);
    return x.toISOString().split("T")[0];
  };
  const start_date = b.start_date || dayAfter(old.end_date);
  let end_date = b.end_date;
  if (!end_date) {
    // Same duration as the old term.
    const durationMs = new Date(old.end_date).getTime() - new Date(old.start_date).getTime();
    end_date = new Date(new Date(start_date).getTime() + durationMs).toISOString().split("T")[0];
  }
  if (end_date <= start_date) {
    return res.status(400).json({ error: "End date must be after the start date." });
  }
  const total_services = parseInt(b.total_services ?? old.total_services, 10) || old.total_services;

  // 3. Create the new contract, linked to the old.
  const { data: contract, error: createErr } = await supabaseAdmin
    .from("amc_contracts")
    .insert({
      tenant_id,
      customer_id: old.customer_id,
      plan_name: b.plan_name || old.plan_name,
      start_date,
      end_date,
      total_services,
      amount: b.amount !== undefined ? parseFloat(b.amount) || 0 : old.amount,
      auto_schedule: true,
      payment_status: b.payment_status === "paid" ? "paid" : "unpaid",
      notes: b.notes ?? old.notes,
      status: "active",
      renewed_from: oldId,
    })
    .select()
    .single();
  if (createErr) return sendDbError(res, createErr);

  // 4. Schedule fresh visits for the new contract.
  const svcError = await scheduleAmcVisits(contract, total_services);
  if (svcError) {
    await supabaseAdmin.from("amc_contracts").delete().eq("id", contract.id);
    return sendDbError(res, svcError, { fallback: "Couldn't schedule the renewed AMC's services." });
  }

  // 5. Close out the old contract: mark expired + cancel its unused future visits
  //    (keep completed ones as history). Best-effort — renewal already succeeded.
  await supabaseAdmin
    .from("amc_contracts")
    .update({ status: "expired" })
    .eq("id", oldId)
    .eq("tenant_id", tenant_id);
  await supabaseAdmin
    .from("services")
    .update({ status: "rejected" }) // 'rejected' = closed/void; stops due/overdue reminders
    .eq("amc_id", oldId)
    .eq("tenant_id", tenant_id)
    .in("status", ["scheduled", "pending"]);

  // 6. Auto-generate the renewal bill (best-effort).
  const { bill } = await generateAmcBill(tenant_id, contract, {
    payment_status: b.payment_status,
    payment_method: b.payment_method,
    renewal: true,
  });

  res.status(201).json({ ...contract, bill: bill || null });
}

module.exports = { getAll, getById, create, update, checkExpired, renew, remove };
