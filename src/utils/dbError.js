// Translates Postgres/Supabase DB errors into clear, user-facing messages so
// raw constraint strings (e.g. 'duplicate key value violates unique constraint
// "idx_customers_tenant_phone"') never reach the UI.
//
// Usage in a controller:
//   if (error) return res.status(dbStatus(error)).json({ error: dbMessage(error) });
// or the shortcut:
//   if (error) return sendDbError(res, error, { unique: "A customer with this phone already exists." });

// Map a known constraint name -> friendly message. Extend as new constraints
// are added. Falls back to a generic per-code message.
const UNIQUE_MESSAGES = {
  idx_customers_tenant_phone: "A customer with this phone number already exists.",
  inventory_parts_tenant_id_sku_key: "A part with this SKU already exists. Use a different SKU.",
  idx_bills_tenant_billnumber: "A bill with this number already exists. Please retry.",
  tenants_phone_key: "An account with this phone number already exists.",
};

function friendlyMessage(error, overrides = {}) {
  const code = error?.code;
  const detail = `${error?.message || ""} ${error?.details || ""}`;

  if (code === "23505") {
    // unique violation — match a known constraint name in the error text
    const hit = Object.keys(UNIQUE_MESSAGES).find((c) => detail.includes(c));
    return overrides.unique || (hit ? UNIQUE_MESSAGES[hit] : "This record already exists.");
  }
  if (code === "23503") {
    // foreign-key violation — referenced row missing or still referenced
    return overrides.fk || "This action references a record that doesn't exist or is still in use.";
  }
  if (code === "23502") {
    // not-null violation
    return overrides.notNull || "A required field is missing.";
  }
  // Unknown DB error — don't leak internals.
  return overrides.fallback || "Something went wrong. Please try again.";
}

function statusFor(error) {
  if (error?.code === "23505") return 409; // conflict
  if (error?.code === "23503") return 409;
  return 400;
}

// Convenience: send the mapped error in one call.
function sendDbError(res, error, overrides = {}) {
  return res.status(statusFor(error)).json({ error: friendlyMessage(error, overrides) });
}

module.exports = { friendlyMessage, statusFor, sendDbError };
