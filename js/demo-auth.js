/* Demo-mode helpers: fake "accounts" kept in localStorage so the app
   is fully usable before Firebase is connected. */

const USERS_KEY = "studentHubDemoUsers";
const SESSION_KEY = "studentHubDemoSession";

function read(pairs) {
  try {
    const raw = localStorage.getItem(pairs);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function demoGetUser(email) {
  return read(USERS_KEY)[email.toLowerCase()] || null;
}

export function demoRegister(email, password, name, profileData) {
  const users = read(USERS_KEY);
  if (users[email.toLowerCase()]) throw new Error("That email already has a demo account in this browser.");
  users[email.toLowerCase()] = {
    uid: "demo-" + Math.random().toString(36).slice(2, 10),
    email,
    password,
    name,
    profile: profileData || null
  };
  write(USERS_KEY, users);
  return demoGetUser(email);
}

export function demoSignIn(email, password) {
  const user = demoGetUser(email);
  if (!user) throw new Error("No demo account found for this email in this browser.");
  if (user.password !== password) throw new Error("Incorrect password.");
  return user;
}

export function demoUserFromSession() {
  const email = localStorage.getItem(SESSION_KEY);
  return email ? demoGetUser(email) : null;
}

export function demoStartSession(email) {
  localStorage.setItem(SESSION_KEY, email);
}

export function demoEndSession() {
  localStorage.removeItem(SESSION_KEY);
}
