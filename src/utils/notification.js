const { supabaseAdmin } = require("../config/supabase");
const { sendPush } = require("./push");

// Records an outreach/notification event in the `notifications` table.
// Kept for the Reminder Center's existing "mark contacted" logging.
async function logNotification({
  tenant_id,
  customer_id,
  service_id,
  type,
  title,
  body,
  status = "sent",
}) {
  await supabaseAdmin.from("notifications").insert({
    tenant_id,
    customer_id,
    service_id,
    type,
    title,
    body,
    status,
  });
}

// ── Notification Center backbone ──────────────────────────────────────────────
//
// createNotification() is the ONE entry point for every in-app + push
// notification. It:
//   1. Persists a row per target staff user (so it shows in the inbox), and
//   2. Pushes to those users' devices (best-effort; failure never throws).
//
// Callers pass a logical event; this decides who sees it and delivers it.

// Map a category → the Android channel / delivery priority the client honors.
const CATEGORY_PRIORITY = {
  money: "high",
  service: "default",
  amc: "default",
  inventory: "default",
  reminder: "default",
  system: "low",
};

// Resolve which staff users should receive a notification for a tenant.
//   - If target_user_id is given, just that user.
//   - Otherwise every staff user in the tenant (tenant-wide broadcast).
// Returns [{ id, expo_push_token }].
async function resolveRecipients(tenant_id, target_user_id) {
  let query = supabaseAdmin
    .from("users")
    .select("id, expo_push_token, notify_prefs")
    .eq("tenant_id", tenant_id);
  if (target_user_id) query = query.eq("id", target_user_id);

  const { data, error } = await query;
  if (error) {
    console.error("[notify] failed to resolve recipients:", error.message);
    return [];
  }
  return data || [];
}

// A user wants a push for a category unless they've explicitly muted it.
// Missing pref = enabled (opt-out model).
function pushEnabledFor(user, category) {
  const prefs = user?.notify_prefs || {};
  return prefs[category] !== false;
}

// Create + deliver a notification.
//   tenant_id   (required)
//   type        (required) machine key, e.g. 'payment_received'
//   title, body (required) human copy
//   category    'money'|'service'|'amc'|'inventory'|'reminder'|'system'
//   priority    override; defaults from category
//   target_user_id  deliver to one user; omit for tenant-wide
//   customer_id, service_id  optional links
//   deep_link   { screen, params } — where a tap navigates
//   push          set false to store in-inbox only (no device push)
//   dedupeService if set to a service_id, skips creation when a notification of
//                 the same (tenant_id, type, service_id) already exists TODAY —
//                 prevents a duplicate ping if the same service event re-fires
//                 (e.g. a double-submitted "mark completed").
async function createNotification({
  tenant_id,
  type,
  title,
  body,
  category = "system",
  priority,
  target_user_id = null,
  customer_id = null,
  service_id = null,
  deep_link = null,
  push = true,
  dedupeService = null, // when set, dedupe on (tenant_id, type, service_id) today
}) {
  if (!tenant_id || !type || !title || !body) {
    console.warn("[notify] missing required fields; skipping", { tenant_id, type });
    return { created: 0 };
  }

  const resolvedPriority = priority || CATEGORY_PRIORITY[category] || "default";

  // Same-day dedupe for event notifications keyed on a service (e.g. don't send
  // "service overdue" twice in one day). Reuses the sent_at >= today filter.
  if (dedupeService) {
    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("type", type)
      .eq("service_id", dedupeService)
      .gte("sent_at", `${today}T00:00:00`)
      .limit(1);
    if (existing && existing.length > 0) {
      return { created: 0, deduped: true };
    }
  }

  const recipients = await resolveRecipients(tenant_id, target_user_id);
  if (recipients.length === 0) return { created: 0 };

  // One inbox row per recipient so read-state is per-user.
  const rows = recipients.map((u) => ({
    tenant_id,
    user_id: u.id,
    customer_id,
    service_id,
    type,
    category,
    priority: resolvedPriority,
    title,
    body,
    deep_link,
    status: "sent",
  }));

  const { error } = await supabaseAdmin.from("notifications").insert(rows);
  if (error) {
    console.error("[notify] failed to persist notification:", error.message);
    // Continue to push anyway — delivery is still valuable.
  }

  if (push) {
    // Only push to users who haven't muted this category. The inbox row above
    // is still created for everyone, so muting only silences the device buzz.
    const tokens = recipients
      .filter((u) => pushEnabledFor(u, category))
      .map((u) => u.expo_push_token)
      .filter(Boolean);
    if (tokens.length > 0) {
      await sendPush(tokens, title, body, {
        ...(deep_link || {}),
        category,
        priority: resolvedPriority,
      });
    }
  }

  return { created: rows.length };
}

module.exports = { logNotification, createNotification, CATEGORY_PRIORITY };
