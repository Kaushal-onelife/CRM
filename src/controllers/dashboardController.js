const { supabaseAdmin } = require("../config/supabase");

// THE canonical "collected revenue" definition, shared by the dashboard card and
// the Revenue report so they can never disagree: paid bills whose paid_date falls
// in the given month ("YYYY-MM"). Returns the summed total for that month.
async function collectedInMonth(tenant_id, monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const start = `${monthKey}-01`;
  // First day of next month (exclusive upper bound).
  const end = new Date(Date.UTC(y, m, 1)).toISOString().split("T")[0];

  const { data } = await supabaseAdmin
    .from("bills")
    .select("total")
    .eq("tenant_id", tenant_id)
    .eq("payment_status", "paid")
    .gte("paid_date", start)
    .lt("paid_date", end);

  return (data || []).reduce((sum, b) => sum + parseFloat(b.total), 0);
}

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
      monthlyRevenue,
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

      // Upcoming services (scheduled + strictly future date, next 7 days).
      // Today's services are "due", not upcoming, so they're excluded here.
      supabaseAdmin
        .from("services")
        .select("*, customers(name, phone)")
        .eq("tenant_id", tenant_id)
        .eq("status", "scheduled")
        .gt("scheduled_date", today)
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

      // Due/Overdue services (scheduled + today or past date)
      supabaseAdmin
        .from("services")
        .select("*, customers(name, phone)", { count: "exact" })
        .eq("tenant_id", tenant_id)
        .eq("status", "scheduled")
        .lte("scheduled_date", today)
        .order("scheduled_date", { ascending: true })
        .limit(10),

      // Unpaid bills
      supabaseAdmin
        .from("bills")
        .select("total")
        .eq("tenant_id", tenant_id)
        .eq("payment_status", "unpaid"),

      // Revenue this month — uses the SAME "collected" definition as the Revenue
      // report (paid bills, bucketed by paid_date) so the two can't disagree.
      collectedInMonth(tenant_id, today.substring(0, 7)),

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

    res.json({
      stats: {
        total_customers: totalCustomers.count || 0,
        pending_services: pendingServices.count || 0,
        followup_services: followupServices.count || 0,
        completed_this_month: completedServices.count || 0,
        overdue_count: overdueServices.count || 0,
        monthly_revenue: monthlyRevenue,
        total_unpaid: totalUnpaid,
      },
      today_services: todayServices.data || [],
      upcoming_services: upcomingServices.data || [],
      overdue_services: overdueServices.data || [],
      due_services: overdueServices.data || [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Monthly revenue report over the last N months (default 6, max 24).
// Reports both bases so the UI can toggle:
//   collected = paid bills, bucketed by paid_date month   (cash basis)
//   billed    = all bills,  bucketed by created_at month  (accrual basis)
//   outstanding = billed - collected within that month
// Buckets are computed in JS (Supabase has no GROUP BY in the JS client) over a
// single windowed query, so it stays one round-trip regardless of month count.
async function getRevenue(req, res) {
  const { tenant_id } = req.user;
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);

  // The window ENDS at `end` (a "YYYY-MM", inclusive) and spans `months` back.
  // Defaults to the current month, but the client can anchor it to any past
  // month so the Revenue screen's month picker can look back arbitrarily far.
  const now = new Date();
  let endYear = now.getUTCFullYear();
  let endMonth = now.getUTCMonth(); // 0-indexed
  const endParam = req.query.end;
  if (typeof endParam === "string" && /^\d{4}-\d{2}$/.test(endParam)) {
    const [y, m] = endParam.split("-").map(Number);
    // Never let the window run past the current month (no future buckets).
    const requestedEnd = Date.UTC(y, m - 1, 1);
    const currentEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const clamped = new Date(Math.min(requestedEnd, currentEnd));
    endYear = clamped.getUTCFullYear();
    endMonth = clamped.getUTCMonth();
  }

  // First day of the window = end month minus (months - 1); day after the end
  // month = exclusive upper bound.
  const windowStart = new Date(Date.UTC(endYear, endMonth - (months - 1), 1));
  const windowEndExclusive = new Date(Date.UTC(endYear, endMonth + 1, 1));
  const windowStartStr = windowStart.toISOString().split("T")[0];
  const windowEndStr = windowEndExclusive.toISOString().split("T")[0];

  try {
    // Pull every bill created OR paid within the window in one go.
    const { data: bills, error } = await supabaseAdmin
      .from("bills")
      .select("total, payment_status, paid_date, created_at")
      .eq("tenant_id", tenant_id)
      .or(
        `and(created_at.gte.${windowStartStr},created_at.lt.${windowEndStr}),` +
          `and(paid_date.gte.${windowStartStr},paid_date.lt.${windowEndStr})`
      );

    if (error) return res.status(400).json({ error: error.message });

    // Seed an ordered map of every month in the window (so gaps show as zero).
    const buckets = new Map();
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(endYear, endMonth - (months - 1) + i, 1));
      const key = d.toISOString().slice(0, 7); // "YYYY-MM"
      buckets.set(key, { month: key, collected: 0, billed: 0, outstanding: 0, bill_count: 0 });
    }

    const monthKey = (dateStr) => (dateStr ? String(dateStr).slice(0, 7) : null);

    for (const b of bills || []) {
      const total = parseFloat(b.total) || 0;

      // Accrual: bucket by created_at.
      const billedKey = monthKey(b.created_at);
      if (billedKey && buckets.has(billedKey)) {
        const bucket = buckets.get(billedKey);
        bucket.billed += total;
        bucket.bill_count += 1;
      }

      // Cash: bucket paid bills by paid_date.
      if (b.payment_status === "paid") {
        const paidKey = monthKey(b.paid_date);
        if (paidKey && buckets.has(paidKey)) {
          buckets.get(paidKey).collected += total;
        }
      }
    }

    // outstanding = billed − collected, floored at 0 per month.
    const monthsArr = [];
    const totals = { collected: 0, billed: 0, outstanding: 0 };
    for (const bucket of buckets.values()) {
      bucket.outstanding = Math.max(bucket.billed - bucket.collected, 0);
      monthsArr.push(bucket);
      totals.collected += bucket.collected;
      totals.billed += bucket.billed;
      totals.outstanding += bucket.outstanding;
    }
    // Newest month first for the UI list.
    monthsArr.reverse();

    res.json({ months: monthsArr, totals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getDashboard, getRevenue };
