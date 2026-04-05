const { createClient } = require("@supabase/supabase-js");

const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const missingEnvVars = requiredEnvVars.filter(
  (key) => !process.env[key] || process.env[key].trim() === ""
);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required Supabase environment variables: ${missingEnvVars.join(
      ", "
    )}`
  );
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service role client - bypasses RLS (for backend use only)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Creates a client scoped to the authenticated user (respects RLS)
function getSupabaseClient(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

module.exports = { supabaseAdmin, getSupabaseClient };
