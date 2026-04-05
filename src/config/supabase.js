const useMock = !process.env.SUPABASE_URL || process.env.USE_MOCK_DATA === "true";

if (useMock) {
  module.exports = require("./mockSupabase");
} else {
  const { createClient } = require("@supabase/supabase-js");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Service role client - bypasses RLS (for backend use only)
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Creates a client scoped to the authenticated user (respects RLS)
  function getSupabaseClient(accessToken) {
    return createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
  }

  module.exports = { supabaseAdmin, getSupabaseClient };
}
