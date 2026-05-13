const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/amcController");

router.use(authenticate);

router.get("/", controller.getAll);
router.post("/check-expired", controller.checkExpired);
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.put("/:id", controller.update);

module.exports = router;
