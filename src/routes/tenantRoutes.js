const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/tenantController");

router.use(authenticate);

router.put("/:id", controller.update);

module.exports = router;
