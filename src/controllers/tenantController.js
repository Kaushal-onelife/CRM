const { supabaseAdmin } = require("../config/supabase");
const { sendDbError } = require("../utils/dbError");

// Fields the owner may edit on their own business profile. id/subscription/
// created_at are intentionally NOT writable from the client.
const TENANT_WRITE_FIELDS = [
  "business_name",
  "owner_name",
  "phone",
  "email",
  "address",
  "logo_url",
  "bill_terms",
  "amc_terms",
];

function pick(body, fields) {
  const out = {};
  for (const k of fields) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

// PUT /tenants/:id — update the caller's own business profile. The :id must
// match the caller's tenant (tenant isolation); ignore it otherwise.
async function update(req, res) {
  const { tenant_id } = req.user;
  if (req.params.id !== tenant_id) {
    return res.status(403).json({ error: "You can only edit your own business." });
  }

  const updates = pick(req.body, TENANT_WRITE_FIELDS);
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No editable fields provided." });
  }
  // business_name is NOT NULL — don't let it be blanked.
  if (updates.business_name !== undefined && !String(updates.business_name).trim()) {
    return res.status(400).json({ error: "Business name can't be empty." });
  }

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .update(updates)
    .eq("id", tenant_id)
    .select()
    .single();

  if (error) return sendDbError(res, error);
  res.json(data);
}

module.exports = { update };
