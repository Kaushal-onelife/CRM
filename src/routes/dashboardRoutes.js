const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { getDashboard, getRevenue } = require("../controllers/dashboardController");

router.use(authenticate);

router.get("/", getDashboard);
router.get("/revenue", getRevenue);

module.exports = router;
