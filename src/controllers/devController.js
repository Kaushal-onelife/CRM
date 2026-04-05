const { resetMockTables, getMockSummary } = require("../config/mockData");

function resetMockData(req, res) {
  const useMock = !process.env.SUPABASE_URL || process.env.USE_MOCK_DATA === "true";

  if (!useMock) {
    return res.status(403).json({ error: "Mock reset is only available in mock mode" });
  }

  resetMockTables();

  res.json({
    message: "Mock data reset successfully",
    summary: getMockSummary(),
  });
}

module.exports = { resetMockData };
