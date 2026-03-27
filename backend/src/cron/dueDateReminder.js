const cron = require("node-cron");
const { supabaseAdmin } = require("../config/supabase");
const { sendPushNotification, logNotification } = require("../utils/notification");

function startDueDateCron() {
  // Runs every day at 9 AM
  cron.schedule("0 9 * * *", async () => {
    console.log("Running due date reminder cron...");

    const tomorrow = new Date(Date.now() + 86400000)
      .toISOString()
      .split("T")[0];

    try {
      // Get services due tomorrow
      const { data: services } = await supabaseAdmin
        .from("services")
        .select("*, customers(name, phone, fcm_token), tenants(business_name)")
        .in("status", ["upcoming", "pending"])
        .eq("scheduled_date", tomorrow);

      if (!services || services.length === 0) return;

      for (const service of services) {
        const title = "Service Reminder";
        const body = `Hi ${service.customers.name}, your ${service.service_type} service from ${service.tenants.business_name} is scheduled for tomorrow.`;

        // Send push notification
        const result = await sendPushNotification(
          service.customers.fcm_token,
          title,
          body
        );

        // Log notification
        await logNotification({
          tenant_id: service.tenant_id,
          customer_id: service.customer_id,
          service_id: service.id,
          type: "due_reminder",
          title,
          body,
          status: result ? "sent" : "failed",
        });
      }

      console.log(`Sent ${services.length} reminders.`);
    } catch (error) {
      console.error("Cron error:", error.message);
    }
  });

  console.log("Due date reminder cron scheduled (daily at 9 AM).");
}

module.exports = { startDueDateCron };
