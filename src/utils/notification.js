const { supabaseAdmin } = require("../config/supabase");

// Records an outreach/notification event in the `notifications` table.
// Used by the Reminder Center to log when the owner contacts a customer.
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

module.exports = { logNotification };
