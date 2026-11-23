const { supabaseAdmin } = require("../config/supabase");
const { sendDbError } = require("../utils/dbError");

// Sign up a new tenant + owner user
async function signup(req, res) {
  const { email, password, phone, name, businessName } = req.body;

  try {
    // 1. Create auth user in Supabase
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) throw authError;

    // 2. Create tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .insert({
        business_name: businessName,
        owner_name: name,
        phone,
        email,
      })
      .select()
      .single();

    if (tenantError) throw tenantError;

    // 3. Create user profile linked to tenant
    const { error: userError } = await supabaseAdmin.from("users").insert({
      id: authData.user.id,
      tenant_id: tenant.id,
      name,
      phone,
      role: "owner",
    });

    if (userError) throw userError;

    res.status(201).json({
      message: "Account created successfully",
      tenant_id: tenant.id,
    });
  } catch (error) {
    // DB constraint errors (e.g. duplicate tenant phone) -> friendly message;
    // Supabase auth errors already carry readable messages, so pass those through.
    if (error?.code) return sendDbError(res, error);
    res.status(400).json({ error: error.message || "Could not create account." });
  }
}

// Login
async function login(req, res) {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("*, tenants(*)")
      .eq("id", data.user.id)
      .single();

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: profile,
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

// Step 1 of password reset — email the user a recovery OTP code.
// Always responds 200 with a generic message so we don't leak which emails
// have accounts (prevents user-enumeration).
async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  try {
    // Sends the "Reset Password" email. The email template must include the
    // {{ .Token }} variable so the user receives a 6-digit code (not just a link).
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(
      email.trim().toLowerCase()
    );

    // Log real errors server-side but never surface them to the caller.
    if (error) console.error("resetPasswordForEmail error:", error.message);
  } catch (error) {
    console.error("forgotPassword unexpected error:", error?.message || error);
  }

  // Generic response regardless of outcome.
  res.json({
    message: "If an account exists for that email, a reset code has been sent.",
  });
}

// Step 2 of password reset — verify the OTP, set the new password, and return
// a session so the user is logged straight in.
async function resetPassword(req, res) {
  const { email, token, password } = req.body;

  if (!email || !token || !password) {
    return res
      .status(400)
      .json({ error: "Email, code, and new password are required." });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }

  try {
    // Verify the recovery code. On success this returns a session for the user.
    const { data, error } = await supabaseAdmin.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: "recovery",
    });

    if (error) throw error;

    // Update the password using the recovered user id.
    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
        password,
      });

    if (updateError) throw updateError;

    // Fetch the profile so the frontend has the same shape login returns.
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("*, tenants(*)")
      .eq("id", data.user.id)
      .single();

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: profile,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message || "Invalid or expired code. Please try again.",
    });
  }
}

module.exports = { signup, login, forgotPassword, resetPassword };
