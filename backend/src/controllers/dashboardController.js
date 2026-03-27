const { supabaseAdmin } = require("../config/supabase");

async function getDashboard(req, res) {
  const { tenant_id } = req.user;
  const today = new Date().toISOString().split("T")[0];
  const next7Days = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  try {
    const [
      totalCustomers,
      pendingServices,
      followupServices,
      upcomingServices,
      completedServices,
      overdueServices,
      unpaidBills,
      revenueData,
      todayServices,
    ] = await Promise.all([
      // Total customers
      supabaseAdmin
        .from("customers")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant_id),

      // Pending services (customer accepted, work not done)
      supabaseAdmin
        .from("services")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant_id)
        .eq("status", "pending"),

      // Follow-up services
      supabaseAdmin
        .from("services")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant_id)
        .eq("status", "followup"),

      // Upcoming services (scheduled + future date, next 7 days)
      supabaseAdmin
        .from("services")
        .select("*, customers(name, phone)")
        .eq("tenant_id", tenant_id)
        .eq("status", "scheduled")
        .gte("scheduled_date", today)
        .lte("scheduled_date", next7Days)
        .order("scheduled_date", { ascending: true })
        .limit(10),

      // Completed this month
      supabaseAdmin
        .from("services")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant_id)
        .eq("status", "completed")
        .gte("completed_date", `${today.substring(0, 7)}-01`),

      // Due/Overdue services (scheduled + past date)
      supabaseAdmin
        .from("services")
        .select("*, customers(name, phone)", { count: "exact" })
        .eq("tenant_id", tenant_id)
        .eq("status", "scheduled")
        .lt("scheduled_date", today)
        .order("scheduled_date", { ascending: true })
        .limit(10),

      // Unpaid bills
      supabaseAdmin
        .from("bills")
        .select("total")
        .eq("tenant_id", tenant_id)
        .eq("payment_status", "unpaid"),

      // Revenue this month (paid bills)
      supabaseAdmin
        .from("bills")
        .select("total")
        .eq("tenant_id", tenant_id)
        .eq("payment_status", "paid")
        .gte("paid_date", `${today.substring(0, 7)}-01`),

      // Today's services
      supabaseAdmin
        .from("services")
        .select("*, customers(name, phone, address)")
        .eq("tenant_id", tenant_id)
        .eq("scheduled_date", today)
        .order("status", { ascending: true }),
    ]);

    const totalUnpaid = (unpaidBills.data || []).reduce(
      (sum, b) => sum + parseFloat(b.total),
      0
    );
    const monthlyRevenue = (revenueData.data || []).reduce(
      (sum, b) => sum + parseFloat(b.total),
      0
    );

    res.json({
      stats: {
        total_customers: totalCustomers.count || 0,
        pending_services: pendingServices.count || 0,
        followup_services: followupServices.count || 0,
        completed_this_month: completedServices.count || 0,
        due_count: overdueServices.count || 0,
        monthly_revenue: monthlyRevenue,
        total_unpaid: totalUnpaid,
      },
      today_services: todayServices.data || [],
      upcoming_services: upcomingServices.data || [],
      due_services: overdueServices.data || [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getDashboard };
