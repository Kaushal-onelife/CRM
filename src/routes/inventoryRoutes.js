const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/inventoryController");
const validate = require("../middleware/validate");
const { createPartSchema, updatePartSchema } = require("../validators/schemas");

router.use(authenticate);

router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", validate(createPartSchema), controller.create);
router.put("/:id", validate(updatePartSchema), controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
