const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/customerController");
const validate = require("../middleware/validate");
const { createCustomerSchema, updateCustomerSchema } = require("../validators/schemas");

router.use(authenticate);

router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", validate(createCustomerSchema), controller.create);
router.put("/:id", validate(updateCustomerSchema), controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
