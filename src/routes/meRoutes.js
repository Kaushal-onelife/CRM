const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const controller = require("../controllers/meController");

router.use(authenticate);

router.post("/push-token", controller.savePushToken);
router.post("/push-token/test", controller.testPush);

// Notification Center inbox
router.get("/notifications", controller.listNotifications);
router.get("/notifications/unread-count", controller.unreadCount);
router.post("/notifications/read-all", controller.markAllRead);
router.post("/notifications/:id/read", controller.markRead);

// Per-category push preferences
router.get("/notify-prefs", controller.getNotifyPrefs);
router.patch("/notify-prefs", controller.updateNotifyPrefs);

module.exports = router;
