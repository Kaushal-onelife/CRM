// One-off admin password reset — bypasses the email/OTP flow entirely.
// Usage (run from the CRM backend folder):
//   node src/scripts/resetPassword.js <email> <newPassword>
//
// Example:
//   node src/scripts/resetPassword.js owner@example.com MyNewPass123
//
// Uses the SUPABASE_SERVICE_ROLE_KEY from .env, so it works even while the
// Supabase email templates are broken. Safe to delete after use.

require("dotenv").config();
const { supabaseAdmin } = require("../config/supabase");

async function main() {
  const [, , emailArg, passwordArg] = process.argv;

  if (!emailArg || !passwordArg) {
    console.error("Usage: node src/scripts/resetPassword.js <email> <newPassword>");
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const password = passwordArg;

  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  // Find the user by email (page through the admin user list).
  let user = null;
  let page = 1;
  const perPage = 200;
  while (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Failed to list users:", error.message);
      process.exit(1);
    }
    user = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (data.users.length < perPage) break; // no more pages
    page += 1;
  }

  if (!user) {
    console.error(`No account found for ${email}`);
    process.exit(1);
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    user.id,
    { password }
  );

  if (updateError) {
    console.error("Failed to update password:", updateError.message);
    process.exit(1);
  }

  console.log(`✅ Password updated for ${email} (id: ${user.id})`);
  console.log("You can now log in with the new password.");
}

main();
