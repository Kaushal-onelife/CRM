const { supabaseAdmin } = require("../config/supabase");

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Invalid token" });
  }

  // Fetch user profile with tenant_id
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return res.status(403).json({ error: "User profile not found" });
  }

  req.user = { ...user, ...profile };
  req.accessToken = token;
  next();
}

module.exports = { authenticate };
