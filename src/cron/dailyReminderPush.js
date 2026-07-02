// Daily staff reminder push — every morning, notify each tenant's staff about
// what's due/overdue so they open the app and act. Reuses the SAME detection
// logic as the on-demand Reminder Center (getReminderData) — one source of truth.
const cron = require("node-cron");
const { supabaseAdmin } = require("../config/supabase");
const { getReminderData } = require("../controllers/reminderController");
const { createNotification } = require("../utils/notification");

// 9:00 AM India time. node-cron respects the tz option.
const SCHEDULE = "0 9 * * *";
const TIMEZONE = "Asia/Kolkata";

// Build the notification copy from today's counts. Returns null when there's
// nothing worth interrupting the user for (no push sent on a clear day).
function buildMessage(counts) {
  const { overdue = 0, due_soon = 0, amc_expiring = 0, total = 0 } = counts || {};
  if (total === 0) return null;

  const parts = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (due_soon > 0) parts.push(`${due_soon} due soon`);
  if (amc_expiring > 0) parts.push(`${amc_expiring} AMC expiring`);

  return {
    title: "Today's reminders",
    body: `You have ${parts.join(", ")}. Tap to review.`,
  };
}

// Runs the reminder sweep across all tenants. Exported so it can be invoked
// manually (e.g. a one-off script or test) without waiting for 9 AM.
async function runDailyReminders() {
  console.log("[cron] daily reminder push starting...");

  // Tenants that have at least one staff device registered. We only need the
  // distinct tenant IDs — createNotification() resolves each tenant's recipients
  // (and their push tokens + mute prefs) itself when we send the digest.
  const { data: users, error } = await supabaseAdmin
    .from("users")
    .select("tenant_id")
    .not("expo_push_token", "is", null);

  if (error) {
    console.error("[cron] failed to load users:", error.message);
    return;
  }
  if (!users || users.length === 0) {
    console.log("[cron] no users with push tokens; nothing to do.");
    return;
  }

  const tenantIds = new Set(users.map((u) => u.tenant_id).filter(Boolean));

  let tenantsNotified = 0;
  for (const tenant_id of tenantIds) {
    try {
      const data = await getReminderData(tenant_id);
      const message = buildMessage(data.counts);
      if (!message) continue; // clear day for this tenant

      // Route through the Notification Center: persists a per-user inbox row AND
      // pushes to every staff device, with a deep-link to the Reminders screen.
      await createNotification({
        tenant_id,
        type: "reminder_push_daily",
        category: "reminder",
        priority: "default",
        title: message.title,
        body: message.body,
        deep_link: { screen: "Reminders" },
      });

      tenantsNotified++;
    } catch (e) {
      // One tenant's failure must not abort the rest of the sweep.
      console.error(`[cron] tenant ${tenant_id} failed:`, e.message);
    }
  }

  console.log(`[cron] daily reminder push done — notified ${tenantsNotified} tenant(s).`);
}

function start() {
  cron.schedule(SCHEDULE, runDailyReminders, { timezone: TIMEZONE });
  console.log(`[cron] daily reminder push scheduled (${SCHEDULE} ${TIMEZONE}).`);
}

module.exports = { start, runDailyReminders };
