// Daily operational alerts — runs after the reminder digest each morning.
// Two sweeps across all tenants:
//   1. AMC expiry — flip active contracts past end_date to 'expired' and fire an
//      amc_expired notification (renewal opportunity). Mirrors amcController's
//      checkExpired but tenant-wide + notifies.
//   2. Unpaid bills aging — notify staff of bills unpaid past a threshold so
//      money doesn't slip. Deduped per bill per day.
const cron = require("node-cron");
const { supabaseAdmin } = require("../config/supabase");
const { createNotification } = require("../utils/notification");
const notify = require("../utils/notificationEvents");

const SCHEDULE = "15 9 * * *"; // 9:15 AM IST — just after the reminder digest
const TIMEZONE = "Asia/Kolkata";
const UNPAID_AGING_DAYS = 7; // nudge on bills unpaid this many days after creation

function isoToday() {
  return new Date().toISOString().split("T")[0];
}

// Flip expired AMCs across ALL tenants and notify each. Runs the same status
// transition as amcController.checkExpired, but not scoped to one tenant.
//
// De-dupe: the amcExpired notification also fires from amcController.checkExpired.
// Both only MATCH status='active' and atomically flip it to 'expired' in the same
// UPDATE — so a contract is caught by exactly ONE of them and can never be
// notified twice. The status flip IS the lock; keep the `.eq("status","active")`
// guard on any code path that notifies, or duplicates become possible.
async function sweepExpiredAmc() {
  const today = isoToday();
  const { data, error } = await supabaseAdmin
    .from("amc_contracts")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("end_date", today)
    .select("id, tenant_id, plan_name, customer_id, end_date, customers(name)");

  if (error) {
    console.error("[cron] AMC expiry sweep failed:", error.message);
    return 0;
  }
  for (const amc of data || []) {
    notify.amcExpired({
      tenant_id: amc.tenant_id,
      amc,
      customer_name: amc.customers?.name || "",
    });
  }
  return (data || []).length;
}

// Notify about bills still unpaid N+ days after creation. Deduped per bill/day
// via the notification type + service link isn't available here, so we skip
// re-sending by checking today's sent notifications of this type for the bill.
async function sweepUnpaidBills() {
  const cutoff = new Date(Date.now() - UNPAID_AGING_DAYS * 86400000)
    .toISOString()
    .split("T")[0];

  const { data: bills, error } = await supabaseAdmin
    .from("bills")
    .select("id, tenant_id, bill_number, total, customer_id, created_at, customers(name)")
    .eq("payment_status", "unpaid")
    .lt("created_at", `${cutoff}T23:59:59`);

  if (error) {
    console.error("[cron] unpaid bills sweep failed:", error.message);
    return 0;
  }
  if (!bills || bills.length === 0) return 0;

  // Skip bills we already nudged today (avoid daily-repeat spam per bill).
  const today = isoToday();
  const { data: sentToday } = await supabaseAdmin
    .from("notifications")
    .select("title")
    .eq("type", "bill_aging")
    .gte("sent_at", `${today}T00:00:00`);
  const alreadyNudged = new Set((sentToday || []).map((n) => n.title));

  let sent = 0;
  for (const bill of bills) {
    // Use bill_number embedded in the title as the per-bill dedupe key.
    const title = `Unpaid: ${bill.bill_number}`;
    if (alreadyNudged.has(title)) continue;

    const name = bill.customers?.name || "";
    await createNotification({
      tenant_id: bill.tenant_id,
      type: "bill_aging",
      category: "money",
      title,
      body: `₹${(Number(bill.total) || 0).toLocaleString("en-IN")} still unpaid${name ? ` from ${name}` : ""} — ${UNPAID_AGING_DAYS}+ days old.`,
      customer_id: bill.customer_id,
      deep_link: { screen: "Bills", params: { id: bill.id } },
    });
    sent++;
  }
  return sent;
}

async function runOpsAlerts() {
  console.log("[cron] daily ops alerts starting...");
  try {
    const expired = await sweepExpiredAmc();
    const aged = await sweepUnpaidBills();
    console.log(`[cron] ops alerts done — ${expired} AMC expired, ${aged} unpaid-bill nudges.`);
  } catch (e) {
    console.error("[cron] ops alerts failed:", e.message);
  }
}

function start() {
  cron.schedule(SCHEDULE, runOpsAlerts, { timezone: TIMEZONE });
  console.log(`[cron] daily ops alerts scheduled (${SCHEDULE} ${TIMEZONE}).`);
}

module.exports = { start, runOpsAlerts };
