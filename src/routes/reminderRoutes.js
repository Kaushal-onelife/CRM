const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/reminderController");

router.use(authenticate);

router.get("/", controller.getReminders);
router.post("/contacted", controller.logContacted);

module.exports = router;
