/* =====================================================
   FIREBASE CONFIGURATION
   -----------------------------------------------------
   1. Go to https://console.firebase.google.com and create
      a project (e.g. "student-hub").
   2. Build → Authentication → Get started → Email/Password → Enable.
   3. Build → Firestore Database → Create database (start in
      production mode, pick the region closest to you).
   4. Project settings (gear icon) → Your apps → Web (</>)
      → register an app and copy the config values below.
   5. Replace the "PASTE_..." values in this file.
   6. Add the security rules from the README (Firestore tab).

   Until you paste real values, the app runs in DEMO MODE:
   login/registration works and all data is kept in the
   browser's localStorage instead of Firestore.
   ===================================================== */
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBqEMA5Xv8OmlADqx7Za2DSGnIjpTE_Abk",
  authDomain: "student-dashboard-4a370.firebaseapp.com",
  projectId: "student-dashboard-4a370",
  storageBucket: "student-dashboard-4a370.firebasestorage.app",
  messagingSenderId: "265113442809",
  appId: "1:265113442809:web:dc2709d9db4e57785d8528",
  measurementId: "G-2TJ2HSCTXP"
};

// true once you filled in real values above
export const isFirebaseConfigured = !String(firebaseConfig.apiKey).startsWith("PASTE_");

export default firebaseConfig;
