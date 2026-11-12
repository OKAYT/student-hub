/* Login / Registration page logic (login.html) */
import { mode, auth, db } from "./firebase-init.js?v=10";
import { demoRegister, demoSignIn, demoStartSession, demoUserFromSession, demoEndSession } from "./demo-auth.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const modeBadge = document.getElementById("modeBadge");
const formLogin = document.getElementById("formLogin");
const formRegister = document.getElementById("formRegister");
const tabs = document.querySelectorAll(".auth-tab");
const errorBox = document.getElementById("authError");
const submitButtons = [...document.querySelectorAll("#formLogin button[type=submit], #formRegister button[type=submit]")];

modeBadge.textContent = mode === "firebase" ? "Firebase connected" : "Demo mode · localStorage";
modeBadge.classList.add(mode === "firebase" ? "badge-ok" : "badge-demo");

function switchTab(which) {
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === which));
  formLogin.classList.toggle("hidden", which !== "login");
  formRegister.classList.toggle("hidden", which !== "register");
  hideError();
}

tabs.forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));

function hideError() {
  errorBox.classList.remove("show");
  errorBox.textContent = "";
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add("show");
}

function setLoading(on) {
  submitButtons.forEach(b => {
    b.disabled = on;
    b.classList.toggle("loading", on);
  });
}

function friendlyError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look valid.",
    "auth/user-not-found": "No account found with that email. Register first.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "That email is already registered. Try logging in.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/network-request-failed": "Network problem — check your internet connection."
  };
  return map[code] || (err && err.message) || "Something went wrong. Please try again.";
}

formLogin.addEventListener("submit", async event => {
  event.preventDefault();
  hideError();
  setLoading(true);
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    if (mode === "firebase") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const user = demoSignIn(email, password);
      demoStartSession(user.email);
    }
    window.location.href = "index.html";
  } catch (err) {
    showError(friendlyError(err));
    setLoading(false);
  }
});

formRegister.addEventListener("submit", async event => {
  event.preventDefault();
  hideError();
  setLoading(true);
  const name = document.getElementById("regName").value.trim();
  const program = document.getElementById("regProgram").value.trim().toUpperCase() || "—";
  const year = document.getElementById("regYear").value;
  const studentId = document.getElementById("regStudentId").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;

  if (password.length < 6) {
    showError("Password must be at least 6 characters.");
    setLoading(false);
    return;
  }

  try {
    if (mode === "firebase") {
      const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        program,
        year,
        studentId,
        email,
        photoURL: "",
        createdAt: Date.now()
      });
    } else {
      demoRegister(email, password, name, { name, program, year, studentId, email });
      demoStartSession(email);
    }
    window.location.href = "index.html";
  } catch (err) {
    showError(friendlyError(err));
    setLoading(false);
  }
});

// Already signed in? Offer to continue, or switch to another account.
initSessionBar();

async function initSessionBar() {
  const bar = document.getElementById("sessionBar");
  let current = null;

  if (mode === "firebase") {
    current = await new Promise(resolve => {
      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); });
    });
  } else {
    current = demoUserFromSession();
  }

  if (!current) return; // nobody logged in — plain login page

  document.getElementById("sessionWho").textContent =
    current.email || current.displayName || "student";
  bar.classList.remove("hidden");

  document.getElementById("goDashboard").addEventListener("click", () => {
    window.location.href = "index.html";
  });

  // "Previous user is moved out": clears the session so the new user can log in
  document.getElementById("switchUser").addEventListener("click", async () => {
    if (mode === "firebase") {
      await signOut(auth);
    } else {
      demoEndSession();
    }
    bar.classList.add("hidden");
    hideError();
  });
}
