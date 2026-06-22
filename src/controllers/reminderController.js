const { supabaseAdmin } = require("../config/supabase");
const { logNotification } = require("../utils/notification");

const DEFAULT_DUE_DAYS = 7; // service due within next N days
const DEFAULT_AMC_DAYS = 15; // AMC expiring within next N days

function isoDate(d) {
  return d.toISOString().split("T")[0];
}

// Normalize a row from any source into a single reminder shape the frontend
// renders uniformly and the message builder consumes.
function shape(row, { type, dateField, today }) {
  const date = row[dateField];
  const daysUntil = Math.ceil(
    (new Date(date).getTime() - new Date(today).getTime()) / 86400000
  );
  return {
    type, // 'service_due' | 'service_overdue' | 'amc_expiring'
    ref_id: row.id,
    service_id: type === "amc_expiring" ? null : row.id,
    customer_id: row.customer_id,
    customer_name: row.customers?.name || "Customer",
    customer_phone: row.customers?.phone || "",
    label: row.plan_name || row.service_type || "",
    date,
    days_until: daysUntil, // negative => overdue
  };
}

// Core detection — shared so a future cron and the on-demand endpoint use ONE
// source of truth. Returns { due_soon, overdue, amc_expiring, counts }.
async function getReminderData(tenant_id, { dueDays = DEFAULT_DUE_DAYS, amcDays = DEFAULT_AMC_DAYS } = {}) {
  const today = isoDate(new Date());
  const dueSoonEnd = isoDate(new Date(Date.now() + dueDays * 86400000));
  const amcEnd = isoDate(new Date(Date.now() + amcDays * 86400000));

  const [svcDue, svcOver, amc] = await Promise.all([
    // Service due soon
    supabaseAdmin
      .from("services")
      .select("id, service_type, scheduled_date, customer_id, customers(name, phone)")
      .eq("tenant_id", tenant_id)
      .eq("status", "scheduled")
      .gte("scheduled_date", today)
      .lte("scheduled_date", dueSoonEnd)
      .order("scheduled_date", { ascending: true }),

    // Service overdue (scheduled/pending but date already passed, not completed)
    supabaseAdmin
      .from("services")
      .select("id, service_type, scheduled_date, customer_id, customers(name, phone)")
      .eq("tenant_id", tenant_id)
      .in("status", ["scheduled", "pending"])
      .lt("scheduled_date", today)
      .order("scheduled_date", { ascending: true }),

    // AMC expiring soon (active, not yet expired, ending within window)
    supabaseAdmin
      .from("amc_contracts")
      .select("id, plan_name, end_date, customer_id, customers(name, phone)")
      .eq("tenant_id", tenant_id)
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", amcEnd)
      .order("end_date", { ascending: true }),
  ]);

  const err = svcDue.error || svcOver.error || amc.error;
  if (err) throw new Error(err.message);

  // Business name for message templates ("…from {business_name}").
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("business_name")
    .eq("id", tenant_id)
    .single();

  // Reminder logs from TODAY — used to mark which customers were already
  // contacted today (the mark auto-resets each day since we filter by date).
  const { data: todaysLogs } = await supabaseAdmin
    .from("notifications")
    .select("customer_id, service_id")
    .eq("tenant_id", tenant_id)
    .in("type", ["reminder_whatsapp", "reminder_manual"])
    .gte("sent_at", `${today}T00:00:00`);

  // Build lookup sets: service reminders keyed by service_id, AMC/customer
  // reminders keyed by customer_id.
  const remindedServiceIds = new Set();
  const remindedCustomerIds = new Set();
  for (const log of todaysLogs || []) {
    if (log.service_id) remindedServiceIds.add(log.service_id);
    if (log.customer_id) remindedCustomerIds.add(log.customer_id);
  }

  const withReminded = (item) => ({
    ...item,
    reminded_today: item.service_id
      ? remindedServiceIds.has(item.service_id)
      : remindedCustomerIds.has(item.customer_id),
  });

  const due_soon = (svcDue.data || [])
    .map((r) => shape(r, { type: "service_due", dateField: "scheduled_date", today }))
    .map(withReminded);
  const overdue = (svcOver.data || [])
    .map((r) => shape(r, { type: "service_overdue", dateField: "scheduled_date", today }))
    .map(withReminded);
  const amc_expiring = (amc.data || [])
    .map((r) => shape(r, { type: "amc_expiring", dateField: "end_date", today }))
    .map(withReminded);

  return {
    business_name: tenant?.business_name || "",
    due_soon,
    overdue,
    amc_expiring,
    counts: {
      due_soon: due_soon.length,
      overdue: overdue.length,
      amc_expiring: amc_expiring.length,
      total: due_soon.length + overdue.length + amc_expiring.length,
    },
  };
}

// GET /reminders?dueDays=&amcDays=
async function getReminders(req, res) {
  const { tenant_id } = req.user;
  const dueDays = parseInt(req.query.dueDays, 10) || DEFAULT_DUE_DAYS;
  const amcDays = parseInt(req.query.amcDays, 10) || DEFAULT_AMC_DAYS;

  try {
    const data = await getReminderData(tenant_id, { dueDays, amcDays });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// POST /reminders/contacted  { customer_id, service_id?, type, message? }
// Records that the owner reached out (reuses the notifications log).
async function logContacted(req, res) {
  const { tenant_id } = req.user;
  const { customer_id, service_id, type, message } = req.body || {};

  if (!customer_id || !type) {
    return res.status(400).json({ error: "customer_id and type are required" });
  }

  try {
    await logNotification({
      tenant_id,
      customer_id,
      service_id: service_id || null,
      type, // 'reminder_whatsapp' | 'reminder_manual'
      title: "Reminder sent",
      body: message || "Owner sent a reminder",
      status: "sent",
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

module.exports = { getReminderData, getReminders, logContacted };
