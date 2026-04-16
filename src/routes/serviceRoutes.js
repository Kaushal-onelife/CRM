const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/serviceController");
const validate = require("../middleware/validate");
const {
  createServiceSchema,
  updateServiceSchema,
  completeServiceSchema,
} = require("../validators/schemas");

router.use(authenticate);

router.get("/", controller.getAll);
// Must be before /:id to avoid route conflict
router.get("/customer/:customer_id/history", controller.getCustomerHistory);
router.post("/generate-bill", controller.generateBill);
router.get("/:id", controller.getById);
router.post("/", validate(createServiceSchema), controller.create);
router.put("/:id", validate(updateServiceSchema), controller.update);
router.patch("/:id/complete", validate(completeServiceSchema), controller.markCompleted);

module.exports = router;
