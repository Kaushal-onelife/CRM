const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
// Place your firebase-service-account.json in the backend root
const serviceAccount = require("../../firebase-service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
