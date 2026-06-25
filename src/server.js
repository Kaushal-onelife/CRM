require("dotenv").config();
const express = require("express");

const app = express();

const NODE_ENV = process.env.NODE_ENV || "development";

// CORS — allowlist from env, "*" only allowed in development
const rawOrigins = (process.env.CORS_ORIGINS || "").trim();
const allowedOrigins = rawOrigins
  ? rawOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (NODE_ENV !== "production" && allowedOrigins.length === 0) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// 5mb accommodates bulk customer CSV imports (~30k rows) sent in the JSON body.
app.use(express.json({ limit: "5mb" }));

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/services", require("./routes/serviceRoutes"));
app.use("/api/bills", require("./routes/billRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/amc", require("./routes/amcRoutes"));
app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api/reminders", require("./routes/reminderRoutes"));
app.use("/api/tenants", require("./routes/tenantRoutes"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: NODE_ENV,
  });
});

// 404 for unmatched API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Structured error handler
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  const body = {
    error: status >= 500 ? "Internal server error" : err.message || "Request failed",
  };
  if (NODE_ENV !== "production" && err.stack) body.stack = err.stack;
  res.status(status).json(body);
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (env=${NODE_ENV})`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
