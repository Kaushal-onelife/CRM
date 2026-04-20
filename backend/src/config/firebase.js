const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const serviceAccountPath = path.join(
  __dirname,
  "..",
  "..",
  "firebase-service-account.json"
);

let initialized = false;

if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
  } catch (error) {
    console.warn(
      "Firebase Admin init failed — push notifications disabled:",
      error.message
    );
  }
} else {
  console.warn(
    "firebase-service-account.json not found — push notifications disabled."
  );
}

module.exports = admin;
module.exports.isInitialized = () => initialized;
