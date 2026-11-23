const { supabaseAdmin } = require("../config/supabase");
const { sendPush } = require("../utils/push");

const MAX_LIMIT = 50;

// Notifications targeted at the current user OR tenant-wide (user_id IS NULL).
function myNotificationsQuery(req, select) {
  return supabaseAdmin
    .from("notifications")
    .select(select)
    .eq("tenant_id", req.user.tenant_id)
    .or(`user_id.eq.${req.user.id},user_id.is.null`);
}

// GET /me/notifications?page=&unreadOnly=
// The in-app Notification Center inbox — newest first, paginated.
async function listNotifications(req, res) {
  const { page = 1, unreadOnly } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
  const offset = (page - 1) * limit;

  let query = myNotificationsQuery(req, "*")
    .order("sent_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (unreadOnly === "true") query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ notifications: data, page: +page, limit });
}

// GET /me/notifications/unread-count — drives the header bell badge.
async function unreadCount(req, res) {
  const { count, error } = await supabaseAdmin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", req.user.tenant_id)
    .or(`user_id.eq.${req.user.id},user_id.is.null`)
    .is("read_at", null);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ count: count || 0 });
}

// POST /me/notifications/:id/read — mark one as read.
async function markRead(req, res) {
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("tenant_id", req.user.tenant_id)
    .is("read_at", null);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
}

// POST /me/notifications/read-all — mark every unread notification read.
async function markAllRead(req, res) {
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", req.user.tenant_id)
    .or(`user_id.eq.${req.user.id},user_id.is.null`)
    .is("read_at", null);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
}

// POST /me/push-token  { token }
// Saves (or clears, if token is null) the current user's Expo push token so the
// daily reminder cron can notify this device.
async function savePushToken(req, res) {
  const { token } = req.body || {};

  // Allow null to unregister (e.g. on logout / permission revoked).
  if (token !== null && (typeof token !== "string" || token.length === 0)) {
    return res.status(400).json({ error: "token must be a non-empty string or null" });
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update({ expo_push_token: token })
    .eq("id", req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
}

// POST /me/push-token/test  — sends a test notification to THIS user's device.
// Handy for verifying the pipeline end-to-end before relying on the daily cron.
async function testPush(req, res) {
  const token = req.user.expo_push_token;
  if (!token) {
    return res.status(400).json({ error: "No push token registered for this user" });
  }

  const result = await sendPush(
    token,
    "Test notification",
    "Push notifications are working 🎉",
    { screen: "Reminders" }
  );
  res.json({ ok: true, ...result });
}

// Categories the UI exposes as toggles. Kept here so the API validates input.
const NOTIFY_CATEGORIES = ["money", "service", "amc", "reminder", "inventory"];

// GET /me/notify-prefs — current per-category push preferences (default: all on).
async function getNotifyPrefs(req, res) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("notify_prefs")
    .eq("id", req.user.id)
    .single();
  if (error) return res.status(400).json({ error: error.message });

  // Normalize: fill any missing category as enabled (opt-out model).
  const stored = data?.notify_prefs || {};
  const prefs = {};
  for (const c of NOTIFY_CATEGORIES) prefs[c] = stored[c] !== false;
  res.json({ prefs });
}

// PATCH /me/notify-prefs  { category, enabled }
// Toggle one category on/off. Merges into the existing JSONB prefs.
async function updateNotifyPrefs(req, res) {
  const { category, enabled } = req.body || {};
  if (!NOTIFY_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Unknown notification category" });
  }

  const { data: current } = await supabaseAdmin
    .from("users")
    .select("notify_prefs")
    .eq("id", req.user.id)
    .single();

  const prefs = { ...(current?.notify_prefs || {}), [category]: !!enabled };

  const { error } = await supabaseAdmin
    .from("users")
    .update({ notify_prefs: prefs })
    .eq("id", req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, prefs });
}

module.exports = {
  savePushToken,
  testPush,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  getNotifyPrefs,
  updateNotifyPrefs,
};
