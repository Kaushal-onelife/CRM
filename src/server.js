require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/services", require("./routes/serviceRoutes"));
app.use("/api/bills", require("./routes/billRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start cron jobs (skip in mock mode - no Firebase)
const useMock = !process.env.SUPABASE_URL || process.env.USE_MOCK_DATA === "true";
if (useMock) {
  app.use("/api/dev", require("./routes/devRoutes"));
}

if (!useMock) {
  const { startDueDateCron } = require("./cron/dueDateReminder");
  startDueDateCron();
} else {
  console.log("Skipping cron jobs in mock mode.");
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
