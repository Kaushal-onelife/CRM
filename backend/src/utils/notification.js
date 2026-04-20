const admin = require("../config/firebase");
const { supabaseAdmin } = require("../config/supabase");

async function sendPushNotification(fcmToken, title, body) {
  if (!fcmToken) return null;
  if (!admin.isInitialized || !admin.isInitialized()) return null;

  try {
    const result = await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
    });
    return result;
  } catch (error) {
    console.error("FCM send error:", error.message);
    return null;
  }
}

async function logNotification({
  tenant_id,
  customer_id,
  service_id,
  type,
  title,
  body,
  status = "sent",
}) {
  try {
    const { error } = await supabaseAdmin.from("notifications").insert({
      tenant_id,
      customer_id,
      service_id,
      type,
      title,
      body,
      status,
    });
    if (error) throw error;
  } catch (err) {
    console.error("logNotification failed:", err.message);
  }
}

module.exports = { sendPushNotification, logNotification };
