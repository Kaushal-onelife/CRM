const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/billController");
const validate = require("../middleware/validate");
const { createBillSchema, markPaidSchema } = require("../validators/schemas");

router.use(authenticate);

router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", validate(createBillSchema), controller.create);
router.patch("/:id/pay", validate(markPaidSchema), controller.markPaid);

module.exports = router;
