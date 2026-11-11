/* Firebase initializer.
   Exports { mode, auth, db } shared by auth.js and app.js.
   mode is "firebase" when configured, "demo" otherwise. */
// config is re-fetched on every load so your pasted keys always apply immediately
const { default: firebaseConfig, isFirebaseConfigured } = await import("./firebase-config.js?cb=" + Date.now());

let mode = "demo";
let auth = null;
let db = null;

if (isFirebaseConfigured) {
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    mode = "firebase";
  } catch (err) {
    console.error("Firebase failed to initialize, falling back to demo mode.", err);
    mode = "demo";
  }
} else {
  console.info("Firebase is not configured yet — running in demo mode (localStorage). See js/firebase-config.js");
}

export { mode, auth, db };
