const { getFirebaseAdmin } = require("../config/firebase");
const { supabaseAdmin } = require("../config/supabase");

async function sendPushNotification(fcmToken, title, body) {
  if (!fcmToken) return null;

  try {
    const firebaseAdmin = getFirebaseAdmin();

    if (!firebaseAdmin) {
      console.warn(
        "Skipping push notification because Firebase Admin credentials are not configured."
      );
      return null;
    }

    const result = await firebaseAdmin.messaging().send({
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

module.exports = { sendPushNotification, logNotification };
