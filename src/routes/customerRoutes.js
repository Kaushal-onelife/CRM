const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/customerController");

router.use(authenticate);

router.get("/", controller.getAll);
// Bulk CSV export/import — declared before "/:id" so they aren't read as an id.
router.get("/export", controller.exportCsv);
router.post("/import", controller.importCsv);
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
