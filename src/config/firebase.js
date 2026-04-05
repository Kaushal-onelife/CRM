const admin = require("firebase-admin");

let firebaseAdmin = null;

function getFirebaseAdmin() {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  firebaseAdmin = admin;
  return firebaseAdmin;
}

module.exports = { getFirebaseAdmin };
