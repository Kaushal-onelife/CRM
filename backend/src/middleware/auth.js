const { supabaseAdmin } = require("../config/supabase");

const useMock = !process.env.SUPABASE_URL || process.env.USE_MOCK_DATA === "true";

async function authenticate(req, res, next) {
  // In mock mode, inject a fake user and skip token validation
  if (useMock) {
    const { TENANT_ID, USER_ID } = require("../config/mockData");
    req.user = {
      id: USER_ID,
      tenant_id: TENANT_ID,
      name: "Kaushal Patil",
      role: "owner",
      email: "kaushal@aquapure.com",
    };
    req.accessToken = "mock-token-12345";
    return next();
  }

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
