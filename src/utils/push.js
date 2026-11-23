// Expo Push delivery — sends notifications to staff devices via Expo's free
// push service (no Firebase/APNs setup required on the backend). Tokens are
// Expo push tokens ("ExponentPushToken[...]") stored on users.expo_push_token.
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

// Send a notification to one or more Expo push tokens.
//   tokens  — string | string[] of Expo push tokens (invalid ones are skipped)
//   title   — notification title
//   body    — notification body
//   data    — optional JSON payload the app reads on tap (e.g. { screen: "Reminders" })
// Returns { sent, skipped } counts. Never throws for a single bad token — it
// filters and logs, so one stale device can't break a whole cron run.
async function sendPush(tokens, title, body, data = {}) {
  const list = (Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean);

  // Pick the Android channel from the notification's priority (set by
  // createNotification and passed in `data.priority`). Falls back to "default".
  // These IDs match the channels created on the client in frontend push.js.
  const channelId = ["high", "default", "low"].includes(data?.priority)
    ? data.priority
    : "default";
  // Low-priority confirmations shouldn't buzz; high/default play the sound.
  const sound = channelId === "low" ? null : "default";

  const messages = [];
  let skipped = 0;
  for (const token of list) {
    if (!Expo.isExpoPushToken(token)) {
      skipped++;
      console.warn(`[push] skipping invalid Expo token: ${token}`);
      continue;
    }
    messages.push({
      to: token,
      sound,
      title,
      body,
      data,
      priority: channelId === "high" ? "high" : "default",
      channelId,
    });
  }

  if (messages.length === 0) return { sent: 0, skipped };

  // Expo requires messages to be sent in chunks (~100 per request).
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...receipts);
    } catch (err) {
      // A failed chunk shouldn't abort the rest — log and continue.
      console.error("[push] chunk send failed:", err.message);
    }
  }

  return { sent: messages.length, skipped, tickets };
}

module.exports = { sendPush };
