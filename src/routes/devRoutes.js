const express = require("express");
const router = express.Router();
const { resetMockData } = require("../controllers/devController");

router.post("/reset-mock-data", resetMockData);

module.exports = router;
