// Centralized notification copy + deep-link targets for each domain event.
// Controllers call these so the wording/links live in one place. Each returns
// the object shape createNotification() expects (minus tenant_id, added by the
// caller). Keeping this separate keeps controllers readable and the copy tunable.
const { createNotification } = require("./notification");

function money(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString("en-IN")}`;
}

// Fire-and-forget wrapper — a notification failure must NEVER break the business
// action that triggered it (completing a service, taking a payment, etc.).
async function emit(payload) {
  try {
    await createNotification(payload);
  } catch (e) {
    console.error(`[notify] event '${payload?.type}' failed:`, e?.message || e);
  }
}

// ── Money ────────────────────────────────────────────────────────────────────

// A bill was marked paid / created as paid.
function paymentReceived({ tenant_id, bill, customer_name, actor_id }) {
  return emit({
    tenant_id,
    type: "payment_received",
    category: "money",
    actor_id, // don't push the staff member who took the payment
    title: "Payment received",
    body: `${money(bill.total)} received${customer_name ? ` from ${customer_name}` : ""} (${bill.bill_number}).`,
    customer_id: bill.customer_id,
    deep_link: { screen: "Bills", params: { id: bill.id } },
  });
}

// An unpaid bill was created — someone owes money.
function billCreatedUnpaid({ tenant_id, bill, customer_name, actor_id }) {
  return emit({
    tenant_id,
    type: "bill_unpaid",
    category: "money",
    actor_id, // don't push the staff member who created the bill
    title: "New unpaid bill",
    body: `${money(bill.total)} due${customer_name ? ` from ${customer_name}` : ""} (${bill.bill_number}).`,
    customer_id: bill.customer_id,
    deep_link: { screen: "Bills", params: { id: bill.id } },
  });
}

// ── Service ──────────────────────────────────────────────────────────────────

// A service was assigned to a specific technician/user.
function serviceAssigned({ tenant_id, service, customer_name, assigned_to }) {
  return emit({
    tenant_id,
    type: "service_assigned",
    category: "service",
    target_user_id: assigned_to, // only the assignee gets this
    title: "New service assigned to you",
    body: `${service.service_type || "Service"}${customer_name ? ` for ${customer_name}` : ""} on ${service.scheduled_date}.`,
    customer_id: service.customer_id,
    service_id: service.id,
    deep_link: { screen: "Services", params: { id: service.id } },
  });
}

// A service was marked completed.
function serviceCompleted({ tenant_id, service, customer_name, actor_id }) {
  return emit({
    tenant_id,
    type: "service_completed",
    category: "service",
    actor_id, // don't push the staff member who marked it done
    priority: "low", // confirmation — quiet
    title: "Service completed",
    body: `${service.service_type || "Service"}${customer_name ? ` for ${customer_name}` : ""} marked done${service.amount ? ` — ${money(service.amount)}` : ""}.`,
    customer_id: service.customer_id,
    service_id: service.id,
    deep_link: { screen: "Services", params: { id: service.id } },
    // Guard against a double-submitted completion firing two identical pings.
    dedupeService: service.id,
  });
}

// ── AMC ──────────────────────────────────────────────────────────────────────

// An AMC contract was activated (created).
function amcActivated({ tenant_id, amc, customer_name, actor_id }) {
  return emit({
    tenant_id,
    type: "amc_activated",
    category: "amc",
    actor_id, // don't push the staff member who created the contract
    priority: "low",
    title: "AMC activated",
    body: `${amc.plan_name}${customer_name ? ` for ${customer_name}` : ""} — ${amc.total_services} visits through ${amc.end_date}.`,
    customer_id: amc.customer_id,
    deep_link: { screen: "AMC", params: { id: amc.id } },
  });
}

// An AMC contract expired (detected by checkExpired).
function amcExpired({ tenant_id, amc, customer_name }) {
  return emit({
    tenant_id,
    type: "amc_expired",
    category: "amc",
    title: "AMC expired — renewal needed",
    body: `${amc.plan_name}${customer_name ? ` for ${customer_name}` : ""} expired on ${amc.end_date}. Offer a renewal.`,
    customer_id: amc.customer_id,
    deep_link: { screen: "AMC", params: { id: amc.id } },
  });
}

// An AMC was renewed into a new contract.
function amcRenewed({ tenant_id, newAmc, customer_name, actor_id }) {
  return emit({
    tenant_id,
    type: "amc_renewed",
    category: "amc",
    actor_id, // don't push the staff member who renewed the contract
    priority: "low",
    title: "AMC renewed",
    body: `${newAmc.plan_name}${customer_name ? ` for ${customer_name}` : ""} renewed through ${newAmc.end_date}.`,
    customer_id: newAmc.customer_id,
    deep_link: { screen: "AMC", params: { id: newAmc.id } },
  });
}

module.exports = {
  paymentReceived,
  billCreatedUnpaid,
  serviceAssigned,
  serviceCompleted,
  amcActivated,
  amcExpired,
  amcRenewed,
};
