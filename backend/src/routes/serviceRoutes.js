const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/serviceController");

router.use(authenticate);

router.get("/", controller.getAll);
// Must be before /:id to avoid route conflict
router.get("/customer/:customer_id/history", controller.getCustomerHistory);
router.post("/generate-bill", controller.generateBill);
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.patch("/:id/complete", controller.markCompleted);

module.exports = router;
