const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/billController");

router.use(authenticate);

router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.patch("/:id/pay", controller.markPaid);

module.exports = router;
