const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/customerController");

router.use(authenticate);

router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
