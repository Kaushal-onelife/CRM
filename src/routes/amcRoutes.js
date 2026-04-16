const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/amcController");
const validate = require("../middleware/validate");
const { createAmcSchema, updateAmcSchema } = require("../validators/schemas");

router.use(authenticate);

router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", validate(createAmcSchema), controller.create);
router.put("/:id", validate(updateAmcSchema), controller.update);
router.post("/check-expired", controller.checkExpired);

module.exports = router;
