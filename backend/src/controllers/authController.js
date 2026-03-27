const { supabaseAdmin } = require("../config/supabase");

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
    res.status(400).json({ error: error.message });
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

module.exports = { signup, login };
