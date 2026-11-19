/* StudentHub dashboard logic (index.html)
   Organised in sections:
     1 constants · 2 state · 3 helpers · 4 data layer · 5 Firestore sync
     6 routing · 7 rendering · 8 persistence · 9 COR importer · 10 quick-add
     11 focus timer · 12 notifications & reminders · 13 export · 14 search
     15 onboarding & tour · 16 modals · 17 event wiring · 18 boot */

import { mode, auth, db } from "./firebase-init.js?v=12";
import { demoUserFromSession, demoEndSession } from "./demo-auth.js?v=12";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc, getDoc, setDoc, collection, onSnapshot,
  addDoc, deleteDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   1. Constants
   ============================================================ */

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday"
};

// day codes as they appear on a COR / in OCR output
const DAY_MAP = {
  M: ["Mon"], T: ["Tue"], W: ["Wed"], H: ["Thu"], TH: ["Thu"], F: ["Fri"],
  S: ["Sat"], U: ["Sun"], SU: ["Sun"], SAT: ["Sat"], SUN: ["Sun"],
  MWF: ["Mon", "Wed", "Fri"], TTH: ["Tue", "Thu"], MW: ["Mon", "Wed"],
  MF: ["Mon", "Fri"], WF: ["Wed", "Fri"], MTH: ["Mon", "Thu"],
  TTHF: ["Tue", "Thu", "Fri"], MTWTH: ["Mon", "Tue", "Wed", "Thu"],
  MTWTF: ["Mon", "Tue", "Wed", "Thu", "Fri"], MTWHF: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  MTWHFS: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
};

const TINTS = ["violet", "cyan", "amber", "rose", "green", "teal", "coral", "slate"];

const SCREENS = {
  overview: "Overview",
  schedule: "Schedule",
  tasks: "Tasks & Deadlines",
  reminders: "Reminders",
  announcements: "Announcements",
  profile: "My Profile"
};

const FOCUS_PRESETS = [25, 50, 90];
const RING_C = 2 * Math.PI * 52;

const DEFAULT_PROFILE = {
  name: "Dela Cruz, Juan",
  studentId: "2025-0001",
  program: "BSCS",
  year: "1",
  photoURL: "img/avatar.svg",
  semester: "1st Semester · 2026"
};

const DEFAULT_CLASSES = [
  { title: "ESC 311", units: 3.0, days: ["Mon", "Wed", "Fri"], start: "17:00", end: "18:00", room: "MB-306" },
  { title: "ESC 312", units: 1.0, days: ["Mon", "Wed", "Fri"], start: "13:00", end: "14:00", room: "MB-207" },
  { title: "ESC 312", units: 2.0, days: ["Tue", "Thu"],        start: "13:00", end: "14:00", room: "MB-212" },
  { title: "ESC 312", units: 1.0, days: ["Sun"],               start: "12:00", end: "15:00", room: "MB-205" },
  { title: "ESC 313", units: 1.0, days: ["Sat"],               start: "10:00", end: "12:00", room: "MB-212" },
  { title: "ESC 313", units: 2.0, days: ["Mon", "Wed"],        start: "10:00", end: "11:00", room: "MB-212" },
  { title: "ESC 314", units: 2.0, days: ["Tue", "Thu"],        start: "11:30", end: "13:00", room: "MB-205" },
  { title: "ESC 314", units: 1.0, days: ["Tue", "Thu"],        start: "17:30", end: "19:00", room: "MB-208" },
  { title: "GE JRIZ", units: 3.0, days: ["Mon", "Wed", "Fri"], start: "09:00", end: "10:00", room: "MB-205" },
  { title: "PSC 311", units: 1.0, days: ["Tue", "Thu"],        start: "09:00", end: "10:00", room: "MB-212" },
  { title: "PSC 311", units: 2.0, days: ["Tue", "Thu"],        start: "16:00", end: "17:30", room: "MB-207" },
  { title: "PSC 312", units: 1.0, days: ["Mon", "Wed"],        start: "14:00", end: "15:00", room: "MB-212" },
  { title: "PSC 312", units: 1.0, days: ["Tue", "Thu"],        start: "15:00", end: "16:00", room: "MB-212" }
];

const DEFAULT_TASKS = [
  { title: "Study for ESC 311 finals", course: "ESC 311", due: "2026-11-11", done: false },
  { title: "Finish PSC 311 lab report", course: "PSC 311", due: "2026-11-12", done: false },
  { title: "Prepare midterm reviewer", course: "ESC 313", due: "2026-11-14", done: true },
  { title: "Submit system documentation", course: "ESC 314", due: "2026-11-16", done: false }
];

const SCHOOL_ANNOUNCEMENTS = [
  {
    tag: "ACADEMIC",
    title: "Final examination permit released",
    body: "Present your permit to every instructor before each final exam. Check room assignments carefully.",
    ts: Date.now() - 2 * 3600 * 1000
  },
  {
    tag: "CAMPUS",
    title: "Library operating hours",
    body: "The library is open from 8:00 AM to 5:00 PM on weekdays.",
    ts: Date.now() - 26 * 3600 * 1000
  }
];

const TOUR = [
  { t: "Welcome to StudentHub 👋", b: "This is your daily planner: schedule, tasks, reminders and a focus timer in one place. A 30-second tour — let's go." },
  { t: "Set up in 30 seconds 📸", b: "Open Schedule → \"Import from COR\". Take one photo of your Certificate of Registration and your whole weekly schedule builds itself — no typing." },
  { t: "Quick-add tasks ⚡", b: "On the Tasks screen, type things like \"ESC 314 docs Fri 5pm\". StudentHub works out the subject, day and time — press Enter and it's saved." },
  { t: "Week view & subject colors 🗓", b: "Schedule has a Day and a Week view. Every subject keeps its own stable color across the whole app so you can spot it at a glance." },
  { t: "Stay ahead ⏰", b: "Set reminders with a real alarm, pick a task to start the focus timer automatically, and press N for a new task or / to search everything." }
];

/* ============================================================
   2. State
   ============================================================ */

let uid = null;
let profile = { ...DEFAULT_PROFILE };
let classes = [];
let tasks = [];
let personalNotes = [];
let reminders = [];
let sessions = [];
let taskFilter = "all";
let unsubs = [];
let weekView = false;
let activeDay = "Mon";
let heroPhotoKey = null;

/* ============================================================
   3. Small helpers
   ============================================================ */

const $ = id => document.getElementById(id);

function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(full) {
  return (full || "").trim().split(/\s+/)[0] || "student";
}

function initials(full) {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "S";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function fmtDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function minutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatMinutes(mins) {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} h ${m} m`;
  if (h) return `${h} h`;
  return `${m} m`;
}

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// next occurrence (from today, inclusive) of a Mon..Sun day name
function nextDateFor(dayName) {
  const dow = new Date().getDay(); // JS: Sun = 0
  const jsTarget = (DAY_ORDER.indexOf(dayName) + 1) % 7;
  return addDaysIso(todayStr(), (jsTarget - dow + 7) % 7);
}

function todaysDay() {
  return DAY_ORDER[(new Date().getDay() + 6) % 7];
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function weekStartMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

function isWithin48h(dateString) {
  if (!dateString) return false;
  const end = new Date(`${dateString}T23:59:59`).getTime();
  const diff = end - Date.now();
  return diff >= 0 && diff <= 48 * 3600 * 1000;
}

function countdownText(deltaMin) {
  if (deltaMin <= 0) return "now";
  if (deltaMin < 60) return `in ${deltaMin} min`;
  const h = Math.floor(deltaMin / 60), m = deltaMin % 60;
  return `in ${h} h${m ? " " + m + " m" : ""}`;
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* One stable color per course code: saved on the class document when picked,
   otherwise derived deterministically from the code. */
function hashTint(title) {
  const key = (title || "").trim().toUpperCase();
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return TINTS[h % TINTS.length];
}

function courseTint(title) {
  const key = (title || "").trim().toUpperCase();
  if (!key) return "violet";
  const saved = classes.find(c =>
    (c.title || "").trim().toUpperCase() === key && TINTS.includes(c.color));
  return saved ? saved.color : hashTint(key);
}

function tintClass(title) {
  return "tint-" + courseTint(title);
}

/* ============================================================
   4. Data layer (localStorage fallback + profile seed)
   ============================================================ */

function lsKey(suffix) { return `studentHub:${uid}:${suffix}`; }

function lsRead(suffix, fallback) {
  try {
    const raw = localStorage.getItem(lsKey(suffix));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsWrite(suffix, value) {
  localStorage.setItem(lsKey(suffix), JSON.stringify(value));
}

function seedLocal() {
  // boot() already applied this account's registered defaults; saved edits win
  profile = { ...(profile || DEFAULT_PROFILE), ...lsRead("profile", {}) };
  classes = lsRead("classes", null) || DEFAULT_CLASSES.map((c, i) => ({ id: "seed" + i, ...c }));
  tasks = lsRead("tasks", null) || DEFAULT_TASKS.map((t, i) => ({ id: "seed" + i, ...t }));
  personalNotes = lsRead("announcements", []);
  reminders = lsRead("reminders", []);
  sessions = lsRead("sessions", []);
  lsWrite("classes", classes);
  lsWrite("tasks", tasks);
  lsWrite("announcements", personalNotes);
  lsWrite("reminders", reminders);
  lsWrite("sessions", sessions);
}

async function cloudInitProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const seeded = {
    ...DEFAULT_PROFILE,
    name: user.displayName || DEFAULT_PROFILE.name,
    email: user.email || "",
    createdAt: Date.now()
  };
  await setDoc(ref, seeded, { merge: true });
  return seeded;
}

/* ============================================================
   5. Firestore sync (always under users/{uid})
   ============================================================ */

function bindCollection(name, apply) {
  if (mode !== "firebase") return;
  const unsub = onSnapshot(collection(db, "users", uid, name), snapshot => {
    apply(snapshot.docs.map(d => ({ id: "cloud-" + d.id, ...d.data() })));
  }, error => console.error(`Firestore ${name}:`, error));
  unsubs.push(unsub);
}

function cloudId(id) { return String(id).replace(/^cloud-/, ""); }

/* ============================================================
   6. Routing
   ============================================================ */

function currentScreen() {
  const match = location.hash.match(/^#\/(\w+)/);
  return SCREENS[match ? match[1] : null] ? match[1] : "overview";
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const screen = $("screen-" + name);
  if (screen) screen.classList.add("active");
  document.querySelectorAll(".nav-link[data-screen]").forEach(link => {
    link.classList.toggle("active", link.dataset.screen === name);
  });
  $("crumbLabel").textContent = SCREENS[name];
  $("sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.addEventListener("hashchange", () => showScreen(currentScreen()));

/* ============================================================
   7. Rendering
   ============================================================ */

/* --- identity & profile --- */

function avatarElement(source, labelClass) {
  const makeInitials = () => {
    const div = document.createElement("div");
    div.className = labelClass + " fallback";
    div.textContent = initials(profile.name);
    return div;
  };
  if (!source) {
    const div = makeInitials();
    div.classList.remove("fallback");
    return div;
  }
  const img = document.createElement("img");
  img.className = labelClass;
  img.src = source;
  img.alt = "Profile photo";
  img.addEventListener("error", () => img.replaceWith(makeInitials()), { once: true });
  return img;
}

function renderIdentity() {
  const mini = $("miniProfile");
  mini.innerHTML = `
    <span data-avatar-slot></span>
    <div><strong>${escapeHTML(profile.name)}</strong>
    <small>${escapeHTML(profile.program || "—")} · ${escapeHTML(profile.year ? profile.year + " Year" : "—")}</small></div>`;
  mini.querySelector("[data-avatar-slot]").replaceWith(avatarElement(profile.photoURL, "avatar"));
  $("userEmail").textContent = profile.email || "student";
  $("topAvatarSlot").replaceChildren(avatarElement(profile.photoURL, "top-avatar"));
  $("welcomeName").innerHTML = `${greeting()}, ${escapeHTML(firstName(profile.name))}! <span class="wave">✦</span>`;
  $("semesterLabel").textContent = profile.semester || "1st Semester · 2026";
  renderProfileView();
}

function renderHeroPhoto() {
  const slot = $("profilePhotoSlot");
  if (!slot) return;
  const url = profile.photoURL || "";
  const key = url + "|" + initials(profile.name);
  if (key === heroPhotoKey) return;
  heroPhotoKey = key;
  slot.querySelector(".avatar-xl")?.remove();

  const makeInitials = () => {
    const div = document.createElement("div");
    div.className = "avatar-xl";
    div.textContent = initials(profile.name);
    slot.prepend(div);
  };

  if (url) {
    const img = document.createElement("img");
    img.className = "avatar-xl";
    img.alt = "Profile photo";
    img.src = url;
    img.addEventListener("error", () => {   // broken photo → initials instead
      img.remove();
      if (!slot.querySelector(".avatar-xl")) makeInitials();
    }, { once: true });
    slot.prepend(img);
  } else {
    makeInitials();
  }
}

function renderProfileView() {
  renderHeroPhoto();
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value || "—"; };
  set("pfHeroName", profile.name);
  set("pfHeroSub", `${profile.program || "Student"}${profile.year ? " · Year " + profile.year : ""}`);
  set("pfChipProgram", (profile.program || "—") + (profile.year ? " – " + profile.year : ""));
  set("pfChipSemester", profile.semester);
  set("pfChipId", "ID " + (profile.studentId || "—"));
  set("pfStudentIdView", profile.studentId);
  set("pfProgramView", profile.program && profile.year ? `${profile.program} – ${profile.year}` : profile.program);
  set("pfSemesterView", profile.semester);
  set("pfEmailView", profile.email);
  set("pfUnitsView", totalUnits().toFixed(1));
  set("pfStatCourses", distinctCourseCount());
  set("pfStatPending", tasks.filter(t => !t.done).length);
  const meetings = classes.reduce((sum, c) => sum + (c.days ? c.days.length : 0), 0);
  set("pfWeeklyView", meetings + " / week");
  set("pfDoneView", tasks.filter(t => t.done).length + " of " + tasks.length);
}

/* --- stats --- */

function distinctCourseCount() {
  return new Set(classes.map(c => c.title.trim().toUpperCase())).size;
}

function totalUnits() {
  return classes.reduce((sum, c) => sum + (Number(c.units) || 0), 0);
}

function renderStats() {
  const today = todaysDay();
  const pending = tasks.filter(t => !t.done).length;
  $("statCourses").textContent = distinctCourseCount();
  $("statUnits").textContent = totalUnits().toFixed(1);
  $("statToday").textContent = classes.filter(c => c.days && c.days.includes(today)).length;
  $("pendingCount").textContent = pending;
  $("pendingCount2").textContent = pending;
  $("doneCount").textContent = tasks.filter(t => t.done).length;
  $("portalPending").textContent = pending;
  $("portalUnits").textContent = totalUnits().toFixed(1);
}

/* --- today's classes --- */

function renderToday() {
  const day = todaysDay();
  $("todaySpan").textContent = `${DAY_FULL[day]} · ${profile.semester || ""}`;
  const list = $("todayList");
  const today = classes
    .filter(c => c.days && c.days.includes(day))
    .sort((a, b) => a.start.localeCompare(b.start));

  if (today.length === 0) {
    list.innerHTML = '<p class="muted today-empty">No classes today. Enjoy the free day! 🎉</p>';
    return;
  }
  const nMin = nowMinutes();
  const nextIndex = today.findIndex(c => minutes(c.start) > nMin);
  list.innerHTML = today.map((c, index) => {
    const isNext = index === nextIndex && minutes(c.end) >= nMin;
    return `
      <div class="today-row${isNext ? " next" : ""}">
        <span class="tint-dot ${tintClass(c.title)}" aria-hidden="true"></span>
        <div class="today-time"><b>${fmtTime(c.start)}</b><small>until ${fmtTime(c.end)}</small></div>
        <div class="today-info">
          <strong>${escapeHTML(c.title)}</strong>
          <small>${escapeHTML(c.room || "No room")} · ${c.days.length === 1 ? "weekly" : c.days.length + "×/week"}</small>
        </div>
        ${isNext ? '<span class="up-next-chip">Up next</span>' : ""}
      </div>`;
  }).join("");
}

/* --- course strip --- */

function renderCourseStrip() {
  const strip = $("courseStrip");
  strip.innerHTML = "";
  if (classes.length === 0) {
    strip.innerHTML = '<p class="muted">No classes yet — add one or import your COR above.</p>';
    return;
  }
  const seen = new Set();
  classes.forEach(c => {
    const key = c.title.trim().toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    const units = classes
      .filter(x => x.title.trim().toUpperCase() === key)
      .reduce((sum, x) => sum + (Number(x.units) || 0), 0);
    const chip = document.createElement("span");
    chip.className = "course-chip";
    chip.innerHTML = `<span class="tint-dot ${tintClass(c.title)}"></span> ${escapeHTML(c.title)} <small>${units.toFixed(1)} u</small>`;
    strip.appendChild(chip);
  });
}

/* --- schedule editor + week grid --- */

function renderDayTabs() {
  const tabs = $("dayTabs");
  const today = todaysDay();
  tabs.innerHTML = DAY_ORDER.map(day => {
    const count = classes.filter(c => c.days && c.days.includes(day)).length;
    const classesForDay = ["day-tab", day === activeDay ? "active" : "", day === today ? "is-today" : ""];
    return `<button type="button" class="${classesForDay.join(" ").trim()}" data-day="${day}">
      ${day}<i>${count}</i></button>`;
  }).join("");
  tabs.querySelectorAll(".day-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeDay = btn.dataset.day;
      renderDayTabs();
      renderSchedule();
    });
  });
}

function renderSchedule() {
  const list = $("scheduleEditor");
  const items = classes
    .filter(c => c.days && c.days.includes(activeDay))
    .sort((a, b) => a.start.localeCompare(b.start));

  if (items.length === 0) {
    list.innerHTML = `<p class="muted">No classes on ${DAY_FULL[activeDay]} yet.</p>`;
    return;
  }
  list.innerHTML = items.map(c => `
    <div class="sched-row">
      <span class="tint-dot ${tintClass(c.title)}" aria-hidden="true"></span>
      <span class="sched-time">${fmtTime(c.start)}<b>–</b>${fmtTime(c.end)}</span>
      <div class="sched-main"><strong>${escapeHTML(c.title)}</strong>
        <small>${escapeHTML(c.room || "No room")} · ${Number(c.units).toFixed(1)} units</small></div>
      <div class="sched-actions">
        <button type="button" class="icon-ghost" data-act="edit" title="Edit">✎</button>
        <button type="button" class="icon-ghost danger" data-act="delete" title="Delete">🗑</button>
      </div>
    </div>`).join("");

  list.querySelectorAll(".sched-row").forEach((row, i) => {
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openClassModal(items[i]));
    row.querySelector('[data-act="delete"]').addEventListener("click", () => removeClass(items[i]));
  });
}

function weekBounds(items) {
  const HOUR = 46;
  let startH = 7, endH = 20;
  items.forEach(c => {
    startH = Math.min(startH, Math.floor(minutes(c.start) / 60));
    endH = Math.max(endH, Math.ceil(minutes(c.end) / 60));
  });
  return { HOUR, startH, endH: Math.min(24, Math.max(endH, startH + 6)) };
}

function assignLanes(items) {
  const laneEnds = [];
  return items.map(c => {
    let lane = laneEnds.findIndex(end => end <= minutes(c.start));
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(minutes(c.end)); }
    else laneEnds[lane] = minutes(c.end);
    return { c, lane };
  }).map((entry, _, all) => ({ ...entry, laneCount: Math.max(1, laneEnds.length) }));
}

function renderWeekGrid() {
  const grid = $("weekGrid");
  if (!grid) return;
  const list = classes.filter(c => c.days && c.days.length);
  const { HOUR, startH, endH } = weekBounds(list);
  const today = todaysDay();

  let html = '<div class="week-corner"></div>';
  DAY_ORDER.forEach(d => {
    const num = new Date(nextDateFor(d) + "T00:00:00").getDate();
    html += `<div class="week-day${d === today ? " today" : ""}"><span>${d}</span><small>${num}</small></div>`;
  });
  html += '<div class="week-hours">';
  for (let h = startH; h < endH; h++) {
    html += `<span style="height:${HOUR}px">${fmtTime(String(h).padStart(2, "0") + ":00").replace(":00", "")}</span>`;
  }
  html += "</div>";

  DAY_ORDER.forEach(day => {
    const blocks = assignLanes(list
      .filter(c => c.days.includes(day))
      .sort((a, b) => minutes(a.start) - minutes(b.start)));

    html += `<div class="week-col${day === today ? " today" : ""}">`;
    blocks.forEach(({ c, lane, laneCount }) => {
      const top = Math.round((minutes(c.start) - startH * 60) / 60 * HOUR);
      const height = Math.max(20, Math.round((minutes(c.end) - minutes(c.start)) / 60 * HOUR) - 3);
      const w = 100 / laneCount;
      html += `<button type="button" class="week-block ${tintClass(c.title)}"
        style="top:${top}px;height:${height}px;left:calc(${lane * w}% + 2px);width:calc(${w}% - 4px)"
        data-id="${escapeHTML(String(c.id))}"
        title="${escapeHTML(c.title)} · ${fmtTime(c.start)}–${fmtTime(c.end)} · ${escapeHTML(c.room || "no room")}">
        <strong>${escapeHTML(c.title)}</strong><small>${fmtTime(c.start)}</small></button>`;
    });
    html += "</div>";
  });

  grid.innerHTML = html;
  grid.style.setProperty("--hour-h", HOUR + "px");
  grid.querySelectorAll(".week-col").forEach(col => col.style.setProperty("--hour-h", HOUR + "px"));
  grid.querySelectorAll(".week-block").forEach(block => {
    block.addEventListener("click", () => {
      const c = classes.find(x => String(x.id) === block.dataset.id);
      if (c) openClassModal(c);
    });
  });
}

/* --- briefing & exam cards --- */

function nextClassInfo() {
  const nMin = nowMinutes();
  const todayIdx = DAY_ORDER.indexOf(todaysDay());
  for (let off = 0; off < 7; off++) {
    const day = DAY_ORDER[(todayIdx + off) % 7];
    const items = classes.filter(c => c.days && c.days.includes(day))
      .sort((a, b) => a.start.localeCompare(b.start));
    if (off === 0) {
      const next = items.find(c => minutes(c.start) > nMin);
      const live = items.find(c => minutes(c.start) <= nMin && minutes(c.end) > nMin);
      if (next) return { cls: next, offset: 0, day };
      if (live) return { cls: live, offset: 0, day };
    } else if (items.length) {
      return { cls: items[0], offset: off, day };
    }
  }
  return null;
}

function nextClassSegment() {
  const info = nextClassInfo();
  if (!info) {
    return "<strong>No more classes this week 🎉</strong><small>Enjoy the break — check your tasks instead.</small>";
  }
  const { cls, offset } = info;
  const startMin = minutes(cls.start);
  const nMin = nowMinutes();
  let when;
  if (offset === 0 && startMin <= nMin && minutes(cls.end) > nMin) when = "happening now";
  else if (offset === 0) when = countdownText(startMin - nMin);
  else when = offset === 1 ? "tomorrow" : DAY_FULL[info.day].slice(0, 3);
  return `<strong>${escapeHTML(cls.title)}</strong><small>${when} · ${fmtTime(cls.start)}${cls.room ? " · " + escapeHTML(cls.room) : ""}</small>`;
}

function deadlineSegment() {
  const soon = tasks.filter(t => !t.done && isWithin48h(t.due));
  if (!soon.length) return "<strong>All clear 🌿</strong><small>Nothing due in the next 48 hours.</small>";
  const labels = soon.slice(0, 2).map(t => escapeHTML(t.title));
  return `<strong>${soon.length} due in 48 hours</strong><small>${labels.join(" · ")}${soon.length > 2 ? " …" : ""}</small>`;
}

function renderBriefing() {
  const box = $("briefing");
  if (!box) return;
  const todayCount = classes.filter(c => c.days && c.days.includes(todaysDay())).length;
  box.innerHTML = `
    <div class="brief-seg"><span class="brief-ico">👋</span><div><small>${greeting()} — you have</small><strong>${todayCount} class${todayCount === 1 ? "" : "es"} today</strong></div></div>
    <div class="brief-seg"><span class="brief-ico">◷</span><div><small>Next up</small>${nextClassSegment()}</div></div>
    <div class="brief-seg"><span class="brief-ico">⏳</span><div><small>Deadlines</small>${deadlineSegment()}</div></div>`;
}

function renderExamCards() {
  const box = $("examCards");
  const panel = $("examPanel");
  if (!box || !panel) return;
  const today = todayStr();
  const exams = tasks.filter(t => !t.done && t.type === "exam" && t.due && t.due >= today)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 4);
  if (exams.length === 0) { panel.hidden = true; return; }
  panel.hidden = false;

  box.innerHTML = exams.map(t => {
    const days = Math.round((new Date(t.due + "T00:00:00") - new Date(today + "T00:00:00")) / 864e5);
    const key = (t.course || "").trim().toUpperCase();
    const all = tasks.filter(x => (x.course || "").trim().toUpperCase() === key);
    const pct = all.length ? Math.round(all.filter(x => x.done).length / all.length * 100) : 0;
    const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} days`;
    return `<div class="exam-card ${tintClass(t.course)}">
      <div class="exam-top"><span class="exam-when">${when}</span><span class="exam-chip">EXAM</span></div>
      <strong>${escapeHTML(t.title)}</strong>
      <small>${escapeHTML(t.course || "No subject")} · ${fmtDate(t.due)}${t.dueTime ? " · " + fmtTime(t.dueTime) : ""}</small>
      <div class="exam-progress"><i style="width:${pct}%"></i></div>
      <span class="exam-pct">${pct}% of this subject's tasks done</span>
    </div>`;
  }).join("");
}

/* --- tasks --- */

function renderTasks() {
  const list = $("taskList");
  const visible = tasks.filter(t =>
    taskFilter === "all" ? true : taskFilter === "done" ? t.done : !t.done);

  if (visible.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <span aria-hidden="true">🗒️</span>
      <strong>${taskFilter === "done" ? "No completed tasks yet" : taskFilter === "pending" ? "You're all caught up!" : "No tasks yet"}</strong>
      <p>Press <kbd>N</kbd> for a new task, or use quick-add above — try <em>"ESC 314 docs Fri 5pm"</em>.</p>
    </div>`;
  } else {
    list.innerHTML = visible.map(task => `
      <div class="task-row${task.done ? " completed" : ""}" data-id="${escapeHTML(String(task.id))}">
        <input type="checkbox" class="task-check" ${task.done ? "checked" : ""} aria-label="Mark ${escapeHTML(task.title)} complete">
        <span class="tint-dot ${tintClass(task.course || "")}" aria-hidden="true"></span>
        <div class="task-main">
          <strong>${escapeHTML(task.title)}</strong>
          <small>${escapeHTML(task.course || "No subject")}</small>
          ${task.type === "exam" ? '<span class="task-exam-chip">EXAM</span>' : ""}
        </div>
        <span class="task-date">Due ${fmtDate(task.due)}${task.dueTime ? " · " + fmtTime(task.dueTime) : ""}</span>
        ${task.done ? "" : '<button type="button" class="icon-ghost focus-task" title="Start a focus session for this task" aria-label="Start focus for this task">▶</button>'}
        <button type="button" class="icon-ghost danger delete-task" title="Delete task" aria-label="Delete task">🗑</button>
      </div>`).join("");
  }

  list.querySelectorAll(".task-row").forEach((row, i) => {
    const task = visible[i];
    row.querySelector(".task-check").addEventListener("change", async event => {
      task.done = event.target.checked;
      await persistTaskUpdate(task);
      renderTasks();
      renderStats();
      renderExamCards();
      renderFocusTaskOptions();
      showToast(task.done ? "Task marked as complete." : "Task marked as pending.");
    });
    row.querySelector(".focus-task")?.addEventListener("click", () => startFocusForTask(task));
    row.querySelector(".delete-task").addEventListener("click", async () => {
      if (!confirm(`Delete "${task.title}"?`)) return;
      await deleteTask(task);
      renderExamCards();
      showToast("Task deleted.");
    });
  });
}

/* --- announcements --- */

function allAnnouncements() {
  return [...personalNotes.map(n => ({ ...n, mine: true })), ...SCHOOL_ANNOUNCEMENTS]
    .sort((a, b) => b.ts - a.ts);
}

function announcementCard(a, compact) {
  const dateLabel = a.mine
    ? new Date(a.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : timeAgo(a.ts);
  const tagClass = a.tag === "ACADEMIC" ? "" : a.tag === "CAMPUS" ? "tag-blue" : "tag-personal";
  const body = a.body
    ? `<p>${escapeHTML(compact && a.body.length > 90 ? a.body.slice(0, 90) + "…" : a.body)}</p>`
    : "";
  return `<div class="announcement">
    <span class="announcement-tag ${tagClass}">${escapeHTML(a.tag)}</span>
    <strong>${escapeHTML(a.title)}</strong>
    ${body}
    <small>${a.mine ? "My note · " : "Posted "}${dateLabel}</small>
  </div>`;
}

function renderAnnouncements() {
  const all = allAnnouncements();
  const preview = $("annPreviewList");
  const full = $("annList");
  if (preview) preview.innerHTML = all.slice(0, 2).map(a => announcementCard(a, true)).join("");
  if (full) full.innerHTML = all.length
    ? all.map(a => announcementCard(a, false)).join("")
    : '<p class="muted">No announcements yet.</p>';
}

/* ============================================================
   8. Persistence
   ============================================================ */

async function persistTaskUpdate(task) {
  if (mode === "firebase" && String(task.id).startsWith("cloud-")) {
    await updateDoc(doc(db, "users", uid, "tasks", cloudId(task.id)), { done: task.done });
  } else if (mode !== "firebase") {
    lsWrite("tasks", tasks);
  }
}

async function createTask(data) {
  const entry = { ...data, done: false };
  if (mode === "firebase") {
    await addDoc(collection(db, "users", uid, "tasks"), entry);
  } else {
    entry.id = String(Date.now());
    tasks.unshift(entry);
    lsWrite("tasks", tasks);
    renderTasks();
    renderStats();
  }
}

async function deleteTask(task) {
  if (mode === "firebase" && String(task.id).startsWith("cloud-")) {
    await deleteDoc(doc(db, "users", uid, "tasks", cloudId(task.id)));
  } else {
    tasks = tasks.filter(t => t.id !== task.id);
    lsWrite("tasks", tasks);
    renderTasks();
    renderStats();
  }
}

async function removeClass(entry) {
  if (!confirm(`Delete "${entry.title}" (${fmtTime(entry.start)}) from ${entry.days.map(d => DAY_FULL[d]).join(", ")}?`)) return;
  if (mode === "firebase" && String(entry.id).startsWith("cloud-")) {
    await deleteDoc(doc(db, "users", uid, "classes", cloudId(entry.id)));
  } else {
    classes = classes.filter(c => c.id !== entry.id);
    lsWrite("classes", classes);
    renderAllSchedule();
    showToast("Class removed from your schedule.");
  }
}

async function saveClass(original, data) {
  if (mode === "firebase" && original && String(original.id).startsWith("cloud-")) {
    await updateDoc(doc(db, "users", uid, "classes", cloudId(original.id)), data);
  } else if (original) {
    Object.assign(original, data);
    lsWrite("classes", classes);
    renderAllSchedule();
    showToast("Class updated.");
  } else if (mode === "firebase") {
    await addDoc(collection(db, "users", uid, "classes"), data);
  } else {
    const entry = { id: String(Date.now()) + Math.random().toString(36).slice(2, 5), ...data };
    classes.push(entry);
    lsWrite("classes", classes);
    renderAllSchedule();
    showToast("Class added to your schedule.");
  }
}

async function importClasses(entries) {
  const withColor = entries.map(entry => ({ ...entry, color: courseTint(entry.title) }));
  if (mode === "firebase") {
    for (const entry of withColor) {
      await addDoc(collection(db, "users", uid, "classes"), entry);
    }
  } else {
    withColor.forEach(entry => classes.push({
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6), ...entry
    }));
    lsWrite("classes", classes);
    renderAllSchedule();
  }
  showToast(`${withColor.length} class${withColor.length === 1 ? "" : "es"} imported from your COR.`);
  location.hash = "#/schedule";
}

async function saveProfileData(data) {
  profile = { ...profile, ...data };
  renderIdentity();
  if (mode === "firebase") {
    await setDoc(doc(db, "users", uid), data, { merge: true });
  } else {
    lsWrite("profile", profile);
  }
  showToast("Profile updated.");
}

async function createNote(data) {
  const entry = { ...data, ts: Date.now(), mine: true };
  if (mode === "firebase") {
    await addDoc(collection(db, "users", uid, "announcements"), entry);
  } else {
    personalNotes.unshift({ ...entry, id: String(Date.now()) });
    lsWrite("announcements", personalNotes);
    renderAnnouncements();
  }
}

async function createReminder(data) {
  const entry = { ...data, fired: false, lastFiredDay: null };
  if (mode === "firebase") {
    await addDoc(collection(db, "users", uid, "reminders"), entry);
  } else {
    entry.id = String(Date.now());
    reminders.unshift(entry);
    lsWrite("reminders", reminders);
    renderReminders();
  }
}

async function deleteReminder(rem) {
  if (mode === "firebase" && String(rem.id).startsWith("cloud-")) {
    await deleteDoc(doc(db, "users", uid, "reminders", cloudId(rem.id)));
  } else {
    reminders = reminders.filter(r => r.id !== rem.id);
    lsWrite("reminders", reminders);
    renderReminders();
  }
}

// taskId/taskTitle are extra fields on the same sessions document — no new path
async function recordSession(course, mins, taskInfo) {
  const entry = { course, minutes: mins, endedAt: Date.now() };
  if (taskInfo && taskInfo.id) {
    entry.taskId = taskInfo.id;
    entry.taskTitle = taskInfo.title;
  }
  if (mode === "firebase") {
    await addDoc(collection(db, "users", uid, "sessions"), entry);
  } else {
    sessions.unshift(entry);
    lsWrite("sessions", sessions);
  }
  renderFocusWeek();
}

/* ============================================================
   9. COR importer (paste · photo OCR · PDF)
   ============================================================ */

function dayCodeFix(code) {
  if (DAY_MAP[code]) return code;
  const fixes = [
    code.replace(/E/g, "F"),
    code.replace(/V/g, "W"),
    code.replace(/0/g, "O").replace(/[|l]/g, "")
  ];
  for (const fix of fixes) {
    if (fix && (DAY_MAP[fix] || /^[MTWHFSU]{1,6}$/.test(fix))) return fix;
  }
  return code;
}

function expandDays(codes) {
  const out = new Set();
  codes.forEach(code => {
    if (DAY_MAP[code]) {
      DAY_MAP[code].forEach(d => out.add(d));
    } else {
      [...code].forEach(ch => {
        if ("MTWHFSU".includes(ch) && DAY_MAP[ch]) out.add(DAY_MAP[ch][0]);
      });
    }
  });
  return [...out];
}

function toTime(h, m, ap) {
  h = Number(h);
  if (!ap) ap = h >= 1 && h <= 7 ? "PM" : "AM";
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`;
}

function extractRoom(line) {
  const roomM = line.match(/\b[A-Z]{1,4}-\d{1,4}[A-Z]?\b/i);
  if (!roomM) return { room: "", line };
  return { room: roomM[0].toUpperCase(), line: line.replace(roomM[0], " ") };
}

function extractTimes(line) {
  const range = line.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*([APap][Mm])\.?/);
  if (range) {
    return {
      start: toTime(range[1], range[2], range[5].toUpperCase()),
      end: toTime(range[3], range[4], range[5].toUpperCase()),
      line: line.replace(range[0], " ")
    };
  }
  const timeRe = /(\d{1,2}):(\d{2})\s*([APap][Mm])\.?/g;
  const found = [];
  let match;
  while ((match = timeRe.exec(line))) {
    found.push({ raw: match[0], time: toTime(match[1], match[2], match[3].toUpperCase()) });
  }
  if (!found.length) return { start: "", end: "", line };

  let end = found[found.length - 1].time;
  if (found.length === 1) {
    const [h, m] = found[0].time.split(":").map(Number);
    end = `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return { start: found[0].time, end, line: line.replace(timeRe, " ") };
}

function extractDayCodesAndTitle(line) {
  const dayCodes = [];
  const titleTokens = [];
  let units = "";
  line.split(/\s+/).filter(Boolean).forEach(tok => {
    const up = tok.toUpperCase().replace(/\./g, "");
    if (up === "AM" || up === "PM") return;
    if (/^\d(\.\d)?$/.test(tok)) { if (!units) units = tok; return; }
    const fixed = dayCodeFix(up);
    if (DAY_MAP[fixed] || /^[MTWHFSU]{1,6}$/.test(fixed)) { dayCodes.push(fixed); return; }
    titleTokens.push(tok);
  });
  return { dayCodes, title: titleTokens.join(" "), units: Number(units) || 0 };
}

function parseCOR(text) {
  const results = [];
  const warnings = [];
  text.split(/\n+/).forEach(raw => {
    const original = raw.trim();
    if (!original) return;
    let line = original.replace(/\d{6,8}/, " "); // strip 6–8 digit schedule code
    const roomInfo = extractRoom(line);
    const timeInfo = extractTimes(roomInfo.line);
    const parsed = extractDayCodesAndTitle(timeInfo.line);
    const days = expandDays(parsed.dayCodes);

    if (!parsed.title) warnings.push(`Skipped "${original}" — couldn't find a course code.`);
    else if (!timeInfo.start) warnings.push(`Skipped "${original}" — couldn't find a start time (use formats like 5:00 PM).`);
    else if (!days.length) warnings.push(`Skipped "${original}" — couldn't find days (use codes like MWF, TTH, S).`);
    else results.push({
      title: parsed.title, units: parsed.units,
      room: roomInfo.room, days, start: timeInfo.start, end: timeInfo.end
    });
  });
  return { results, warnings };
}

function loadScriptOnce(src, key) {
  if (!loadScriptOnce.loaded) loadScriptOnce.loaded = {};
  if (loadScriptOnce.loaded[key]) return loadScriptOnce.loaded[key];
  loadScriptOnce.loaded[key] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => {
      delete loadScriptOnce.loaded[key];
      reject(new Error("Could not load " + src));
    };
    document.head.appendChild(s);
  });
  return loadScriptOnce.loaded[key];
}

function setCorStatus(html, busy) {
  $("corStatus").innerHTML = busy ? `<span class="spin"></span> ${html}` : html;
}

async function imageToCanvas(file) {
  const bmp = await createImageBitmap(file);
  const maxW = 2600; // upscale small photos — OCR reads dot-matrix print better
  const scale = Math.min(2.5, maxW / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close && bmp.close();

  // grayscale + contrast stretch; full binarization erases faint dot-matrix print
  try {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    let min = 255, max = 0;
    const gray = new Uint8ClampedArray(px.length / 4);
    for (let i = 0, g = 0; i < px.length; i += 4, g++) {
      const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      gray[g] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = Math.max(1, max - min);
    for (let i = 0, g = 0; i < px.length; i += 4, g++) {
      const v = ((gray[g] - min) / range) * 255;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  } catch (e) {
    console.warn("Image cleanup skipped:", e);
  }
  return canvas;
}

async function ocrCanvas(canvas, label) {
  await loadScriptOnce("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", "tesseract");
  setCorStatus(`Reading ${escapeHTML(label)}… (first run downloads the OCR engine)`, true);
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: m => {
      if (m.status === "recognizing text") {
        setCorStatus(`Reading ${escapeHTML(label)}… ${Math.round(m.progress * 100)}%`, true);
      }
    }
  });
  const { data } = await worker.recognize(canvas);
  await worker.terminate();
  return data.text;
}

async function pdfToText(file) {
  await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "pdfjs");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(pdf.numPages, 5);
  let text = "";

  for (let p = 1; p <= pages; p++) {
    setCorStatus(`Reading PDF page ${p} of ${pages}…`, true);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    content.items.forEach(item => {
      if (!item.str || !item.str.trim()) return;
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(item);
    });
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
      items.sort((a, b) => a.transform[4] - b.transform[4]);
      text += items.map(it => it.str).join("  ") + "\n";
    });
    text += "\n";
  }

  // scanned PDF without a text layer → OCR the rendered pages
  if (text.replace(/\s/g, "").length < 40) {
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      text += (await ocrCanvas(canvas, `PDF page ${p}`)) + "\n";
    }
  }
  return text;
}

function renderCorPreview() {
  const { results, warnings } = parseCOR($("corText").value);
  const rows = results.map(r => `
    <div class="cor-row">
      <b>${escapeHTML(r.title)}</b>
      <small>${r.days.map(d => DAY_FULL[d].slice(0, 3)).join(" · ")} · ${fmtTime(r.start)} – ${fmtTime(r.end)} · ${escapeHTML(r.room || "no room")} · ${r.units.toFixed(1)} u</small>
    </div>`).join("");
  const photoTip = (warnings.length >= 5 && results.length > 0)
    ? '<p class="cor-tip">💡 Several lines couldn\'t be read — this happens with angled or wrinkled photos. Fix the preview below, edit the schedule afterwards, or import a straighter, well-lit photo.</p>'
    : "";
  $("corPreview").innerHTML =
    (results.length ? `<p class="cor-count"><b>${results.length}</b> class${results.length === 1 ? "" : "es"} detected:</p>${rows}` : "") +
    warnings.map(w => `<p class="cor-warning">⚠️ ${escapeHTML(w)}</p>`).join("") + photoTip;
  $("corImportButton").disabled = results.length === 0;
  $("corImportButton").textContent = results.length
    ? `Import ${results.length} class${results.length === 1 ? "" : "es"}` : "Import classes";
}

/* ============================================================
   10. Quick-add
   ============================================================ */

function parseQuickAdd(raw) {
  const out = { title: "", course: "", due: "", dueTime: "", exam: false, assumed: [] };
  let s = " " + raw.replace(/\s+/g, " ").trim() + " ";

  const courseM = s.match(/\s([A-Za-z]{2,4})\s?-?\s?(\d{3}[A-Za-z]?)\s/);
  if (courseM) {
    out.course = (courseM[1] + " " + courseM[2]).toUpperCase();
    s = s.replace(courseM[0], " ");
  }

  if (/\b(exam|finals?|midterms?|quiz)\b/i.test(s)) {
    out.exam = true;
    s = s.replace(/\b(exam|finals?|midterms?|quiz)\b/gi, " ");
  }

  const timeM = s.match(/\s(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeM) {
    out.dueTime = toTime(timeM[1], timeM[2] || "00", timeM[3].toUpperCase());
    s = s.replace(timeM[0], " ");
  } else {
    const t24 = s.match(/\s(\d{1,2}):(\d{2})\b/);
    if (t24) {
      out.dueTime = `${String(Number(t24[1]) % 24).padStart(2, "0")}:${t24[2]}`;
      s = s.replace(t24[0], " ");
    }
  }

  const todayIso = todayStr();
  const dayM = s.match(/\s(today|tomorrow|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i);
  if (dayM) {
    const w = dayM[1].toLowerCase();
    s = s.replace(dayM[0], " ");
    if (w === "today") out.due = todayIso;
    else if (w === "tomorrow") out.due = addDaysIso(todayIso, 1);
    else {
      const target = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[w.slice(0, 3)];
      const dow = new Date(todayIso + "T00:00:00").getDay();
      out.due = addDaysIso(todayIso, (target - dow + 7) % 7);
    }
  } else {
    out.due = todayIso;
    out.assumed.push("due today");
  }

  const title = s.replace(/\s(on|due|at|for|by)\s/gi, " ").replace(/\s+/g, " ").trim();
  out.title = title || (out.course ? out.course + (out.exam ? " exam" : " task") : "New task");
  if (!out.course) out.assumed.push("no subject");
  return out;
}

let qaParsed = null;

function renderQuickAddPreview() {
  const box = $("qaPreview");
  const input = $("quickAddInput");
  if (!box || !input) return;
  const text = input.value.trim();
  if (text.length < 3) { box.hidden = true; qaParsed = null; return; }
  qaParsed = parseQuickAdd(text);
  const bits = [
    qaParsed.course ? `<span class="qa-chip ${tintClass(qaParsed.course)}">${escapeHTML(qaParsed.course)}</span>` : "",
    `<span class="qa-chip">Due ${fmtDate(qaParsed.due)}${qaParsed.dueTime ? " · " + fmtTime(qaParsed.dueTime) : ""}</span>`,
    qaParsed.exam ? '<span class="qa-chip qa-exam">EXAM</span>' : "",
    ...qaParsed.assumed.map(a => `<span class="qa-chip qa-assumed">${escapeHTML(a)}</span>`)
  ].join("");

  box.innerHTML = `
    <div class="qa-summary">
      <span class="qa-arrow" aria-hidden="true">→</span>
      <div><strong>${escapeHTML(qaParsed.title)}</strong>${bits ? `<div class="qa-bits">${bits}</div>` : ""}</div>
    </div>
    <div class="qa-actions">
      <button type="button" class="small-outline" id="qaCancel">Discard</button>
      <button type="button" class="primary-button" id="qaSave">Save task</button>
    </div>`;
  box.hidden = false;
  $("qaSave").addEventListener("click", saveQuickAdd);
  $("qaCancel").addEventListener("click", clearQuickAdd);
}

async function saveQuickAdd() {
  if (!qaParsed) return;
  await createTask({
    title: qaParsed.title,
    course: qaParsed.course || "General",
    due: qaParsed.due,
    dueTime: qaParsed.dueTime,
    type: qaParsed.exam ? "exam" : "task"
  });
  clearQuickAdd();
  renderExamCards();
  showToast("Task added from quick-add ⚡");
}

function clearQuickAdd() {
  const input = $("quickAddInput");
  if (input) input.value = "";
  qaParsed = null;
  const box = $("qaPreview");
  if (box) box.hidden = true;
}

/* ============================================================
   11. Focus timer
   ============================================================ */

const focus = {
  phase: "work",
  remaining: FOCUS_PRESETS[0] * 60,
  totalSeconds: FOCUS_PRESETS[0] * 60,
  breakSeconds: 5 * 60,
  running: false,
  timer: null,
  cycles: 0,
  taskId: null,
  taskTitle: ""
};

let audioCtx = null;

// priming on a click/change keeps browser autoplay rules happy
function primeAlarm() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    // audio not supported — the visual toast + system notification still fire
  }
}

function playAlarm() {
  primeAlarm();
  if (!audioCtx) return;
  try {
    [0, 0.3, 0.6].forEach(offset => {
      const at = audioCtx.currentTime + offset;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, at);
      osc.frequency.setValueAtTime(660, at + 0.14);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.27);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.28);
    });
  } catch (err) {
    console.warn("Alarm audio unavailable:", err);
  }
  try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch { /* ignored */ }
}

// 5 minutes of break for every 25 minutes focused (90 min → 18 min)
function breakSecondsFor(workSeconds) {
  const workMinutes = Math.max(1, Math.round(workSeconds / 60));
  return Math.max(5, Math.round(workMinutes / 5)) * 60;
}

function applyFocusDuration(mins, announce = true) {
  const total = Math.min(720, Math.max(1, Math.round(Number(mins) || 25)));
  focus.totalSeconds = total * 60;
  focus.breakSeconds = breakSecondsFor(focus.totalSeconds);
  if (!focus.running && focus.phase === "work") focus.remaining = focus.totalSeconds;
  syncDurationInputs(total);
  focusRender();
  if (announce) showToast(`Session length set to ${formatMinutes(total)}.`);
}

function syncDurationInputs(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if ($("focusHours")) $("focusHours").value = hours;
  if ($("focusMinutes")) $("focusMinutes").value = mins;
  document.querySelectorAll("#focusPresets .duration-chip").forEach(chip => {
    chip.classList.toggle("active", Number(chip.dataset.min) === totalMinutes);
  });
}

function focusRender() {
  const timeEl = $("focusTime"), phaseEl = $("focusPhase"), ring = $("focusRing"), btn = $("focusStart");
  if (!timeEl) return;
  const m = Math.floor(focus.remaining / 60), s = focus.remaining % 60;
  timeEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  phaseEl.textContent = focus.phase === "work" ? "Focus" : "Break";
  $("focusDial")?.classList.toggle("is-break", focus.phase === "break");
  if (ring) {
    const phaseTotal = focus.phase === "work" ? focus.totalSeconds : focus.breakSeconds;
    ring.style.strokeDashoffset = String(RING_C * (1 - focus.remaining / phaseTotal));
  }
  btn.textContent = focus.running ? "Pause" : focus.phase === "work" ? "Start focus" : "Start break";
}

function startFocusTick() {
  primeAlarm();
  focus.running = true;
  window.clearInterval(focus.timer);
  focus.timer = window.setInterval(() => {
    focus.remaining--;
    if (focus.remaining <= 0) focusComplete();
    focusRender();
  }, 1000);
  focusRender();
}

function stopFocusTick() {
  focus.running = false;
  window.clearInterval(focus.timer);
  focusRender();
}

function focusComplete() {
  window.clearInterval(focus.timer);
  focus.running = false;
  playAlarm();

  if (focus.phase === "work") {
    const course = $("focusCourse")?.value || "General study";
    const mins = Math.round(focus.totalSeconds / 60);
    const taskInfo = focus.taskId ? { id: focus.taskId, title: focus.taskTitle } : null;
    recordSession(course, mins, taskInfo);
    focus.cycles++;
    focus.phase = "break";
    focus.breakSeconds = breakSecondsFor(focus.totalSeconds);
    focus.remaining = focus.breakSeconds;
    notifyDesktop("Focus session done 🎉",
      `${formatMinutes(mins)} logged for ${course}. Take a ${Math.round(focus.breakSeconds / 60)}-minute break.`);
    showToast(`${formatMinutes(mins)} logged for ${course} — take a break!`);
  } else {
    focus.phase = "work";
    focus.remaining = focus.totalSeconds;
    notifyDesktop("Break over", "Ready for another focus session?");
    showToast("Break over — ready when you are.");
  }
  focusRender();
  renderFocusWeek();
}

function focusReset() {
  stopFocusTick();
  focus.phase = "work";
  focus.breakSeconds = breakSecondsFor(focus.totalSeconds);
  focus.remaining = focus.totalSeconds;
  focusRender();
}

function currentFocusTask() {
  const id = $("focusTask")?.value;
  return id ? tasks.find(t => String(t.id) === id) : null;
}

function selectFocusTask(task) {
  const taskSel = $("focusTask");
  if (taskSel && [...taskSel.options].some(o => o.value === String(task.id))) {
    taskSel.value = String(task.id);
  }
  const courseSel = $("focusCourse");
  if (courseSel && [...courseSel.options].some(o => o.value === task.course)) {
    courseSel.value = task.course;
  } else if (courseSel) {
    courseSel.add(new Option(task.course, task.course));
    courseSel.value = task.course;
  }
  focus.taskId = task.id;
  focus.taskTitle = task.title;
}

function startFocusForTask(task) {
  location.hash = "#/tasks";
  selectFocusTask(task);
  focusReset();
  startFocusTick();
  showToast(`Focus started for ${task.title} ▶`);
}

function renderFocusCourseOptions() {
  const sel = $("focusCourse");
  if (!sel) return;
  const previous = sel.value;
  const titles = [];
  const seen = new Set();
  [...classes.map(c => c.title), ...tasks.map(t => t.course).filter(Boolean)].forEach(title => {
    const key = title.trim().toUpperCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    titles.push(title.trim());
  });
  if (!titles.length) titles.push("General study");
  sel.innerHTML = titles.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join("");
  if (titles.includes(previous)) sel.value = previous;
}

function renderFocusTaskOptions() {
  const sel = $("focusTask");
  if (!sel) return;
  const previous = sel.value;
  const open = tasks.filter(t => !t.done);
  sel.innerHTML = '<option value="">No task — just focus</option>' +
    open.map(t => `<option value="${escapeHTML(String(t.id))}">${escapeHTML(t.title)}</option>`).join("");
  if (open.some(t => String(t.id) === previous)) sel.value = previous;
}

function focusTotals(since) {
  const byCourse = new Map();
  const byTask = new Map();
  sessions.filter(s => (s.endedAt || 0) >= since).forEach(s => {
    const mins = Number(s.minutes) || 0;
    const course = s.course || "General study";
    byCourse.set(course, (byCourse.get(course) || 0) + mins);
    if (s.taskId) {
      const prior = byTask.get(s.taskId) || { title: s.taskTitle || "Task", minutes: 0 };
      prior.minutes += mins;
      byTask.set(s.taskId, prior);
    }
  });
  return {
    courses: [...byCourse.entries()].sort((a, b) => b[1] - a[1]),
    tasks: [...byTask.entries()].sort((a, b) => b[1].minutes - a[1].minutes)
  };
}

function totalRows(rows, limit) {
  const top = rows.slice(0, limit);
  const isTaskRow = value => value && typeof value === "object" && !Array.isArray(value);
  const rowMins = value => Number(isTaskRow(value) ? value.minutes : value) || 0;
  const rowLabel = (key, value) => isTaskRow(value) ? (value.title || key) : key;
  const max = Math.max(1, ...top.map(([, value]) => rowMins(value)));
  return top.map(([key, value]) => {
    const label = rowLabel(key, value);
    const mins = rowMins(value);
    return `<div class="focus-week-row">
      <span class="tint-dot ${tintClass(label)}"></span>
      <span class="fw-course" title="${escapeHTML(label)}">${escapeHTML(label)}</span>
      <span class="fw-bar"><i class="${tintClass(label)}" style="width:${Math.round(mins / max * 100)}%"></i></span>
      <b>${formatMinutes(mins)}</b>
    </div>`;
  }).join("");
}

function renderFocusWeek() {
  const box = $("focusWeek");
  if (!box) return;
  const { courses, tasks: byTask } = focusTotals(weekStartMs());
  if (!courses.length) {
    box.innerHTML = '<p class="muted focus-empty">No focus minutes logged this week yet — start a session!</p>';
    return;
  }
  box.innerHTML = `
    <p class="focus-subtitle">This week · by subject</p>
    ${totalRows(courses, 5)}
    ${byTask.length ? `<p class="focus-subtitle focus-subtitle-tasks">Time spent on tasks</p>${totalRows(byTask, 5)}` : ""}`;
}

/* ============================================================
   12. Notifications & reminders
   ============================================================ */

function updatePermissionChip() {
  const btn = $("permButton");
  if (!btn) return;
  if (!("Notification" in window)) { btn.hidden = true; return; }
  if (Notification.permission === "granted") { btn.textContent = "🔔 Notifications on"; btn.disabled = true; }
  else if (Notification.permission === "denied") { btn.textContent = "🔕 Blocked — in-app alerts only"; btn.disabled = true; }
  else { btn.textContent = "🔔 Turn on notifications"; btn.disabled = false; }
}

function updatePermissionNote() {
  const note = $("remPermNote");
  if (!note) return;
  if (!("Notification" in window)) {
    note.textContent = "This browser doesn't support system notifications — you'll get in-app alerts.";
  } else if (Notification.permission === "granted") {
    note.textContent = "✅ System notifications and the alarm are on — you'll be alerted even on another tab.";
  } else if (Notification.permission === "denied") {
    note.textContent = "🔕 Notifications are blocked in your browser — the alarm and in-app alerts still work.";
  } else {
    note.textContent = "💡 When you save your first reminder, we'll ask permission to show system notifications.";
  }
}

async function ensureNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("This browser doesn't support notifications — you'll get in-app alerts.");
    return;
  }
  if (Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch { /* ignored */ }
  }
  updatePermissionChip();
  updatePermissionNote();
  if (Notification.permission === "denied") {
    showToast("Notifications are blocked — reminders will show inside the app instead.");
  }
}

function notifyDesktop(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body }); } catch { /* ignored */ }
  }
}

function reminderIsDue(rem, nowHm, nowIso, dayKey, todayJs) {
  if (rem.weekly) {
    return Number(rem.weekday) === todayJs && nowHm >= rem.time && rem.lastFiredDay !== dayKey;
  }
  return !rem.fired && `${rem.date}T${rem.time}` <= nowIso;
}

async function markReminderFired(rem, dayKey) {
  if (mode === "firebase" && String(rem.id).startsWith("cloud-")) {
    await updateDoc(doc(db, "users", uid, "reminders", cloudId(rem.id)),
      rem.weekly ? { lastFiredDay: dayKey } : { fired: true });
  } else {
    if (rem.weekly) rem.lastFiredDay = dayKey; else rem.fired = true;
    lsWrite("reminders", reminders);
  }
}

async function checkReminders() {
  const now = new Date();
  const dayKey = now.toDateString();
  const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nowIso = `${todayStr(now)}T${nowHm}`;
  let firedAny = false;

  for (const rem of reminders) {
    if (!reminderIsDue(rem, nowHm, nowIso, dayKey, now.getDay())) continue;
    firedAny = true;
    markReminderFired(rem, dayKey).catch(() => {}); // don't block the alert on Firestore
    const body = rem.title + (rem.refTitle ? " — " + rem.refTitle : "");
    notifyDesktop("⏰ StudentHub reminder", body);
    showToast("⏰ " + body);
  }
  if (firedAny) playAlarm();
}

function buildRemLinkOptions() {
  const sel = $("remLink");
  const seen = new Set();
  const classOpts = [];
  classes.forEach(c => {
    const key = c.title.trim().toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    classOpts.push(`<option value="class:${escapeHTML(c.title.trim())}">Class · ${escapeHTML(c.title.trim())}</option>`);
  });
  const taskOpts = tasks.filter(t => !t.done)
    .map(t => `<option value="task:${escapeHTML(String(t.id))}">Task · ${escapeHTML(t.title)}</option>`);
  sel.innerHTML = '<option value="">Nothing — just a time I choose</option>' +
    (classOpts.length ? `<optgroup label="Classes">${classOpts.join("")}</optgroup>` : "") +
    (taskOpts.length ? `<optgroup label="Pending tasks">${taskOpts.join("")}</optgroup>` : "");
}

function openReminderModal() {
  buildRemLinkOptions();
  $("reminderForm").reset();
  $("remDate").value = todayStr();
  $("remTime").value = "17:00";
  updatePermissionNote();
  $("reminderModal").classList.add("show");
  $("reminderModal").setAttribute("aria-hidden", "false");
  $("remTitle").focus();
}

function closeReminderModal() {
  $("reminderModal").classList.remove("show");
  $("reminderModal").setAttribute("aria-hidden", "true");
  $("reminderForm").reset();
}

function prefillLinkedReminder() {
  const value = $("remLink").value;
  if (!value) return;
  const splitAt = value.indexOf(":");
  const kind = value.slice(0, splitAt);
  const ref = value.slice(splitAt + 1);
  if (kind === "class") {
    const first = classes.find(c => c.title.trim().toUpperCase() === ref.trim().toUpperCase());
    if (first) {
      $("remTitle").value = `${first.title} class starts soon`;
      $("remDate").value = nextDateFor((first.days || [])[0] || todaysDay());
      $("remTime").value = first.start;
    }
  } else if (kind === "task") {
    const task = tasks.find(t => String(t.id) === ref);
    if (task) {
      $("remTitle").value = `Task due: ${task.title}`;
      $("remDate").value = task.due || todayStr();
    }
  }
}

function renderReminders() {
  const list = $("reminderList");
  if (!list) return;
  if (!reminders.length) {
    list.innerHTML = `<div class="empty-state">
      <span aria-hidden="true">⏰</span>
      <strong>No reminders yet</strong>
      <p>Get a nudge 30 minutes before a class, or the morning a task is due — tap "New reminder".</p>
    </div>`;
    return;
  }
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const sorted = [...reminders].sort((a, b) =>
    (a.weekly ? 1 : 0) - (b.weekly ? 1 : 0) || `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  list.innerHTML = sorted.map(rem => {
    const when = rem.weekly
      ? `Every ${dayNames[Number(rem.weekday)] || "week"} · ${fmtTime(rem.time)}`
      : `${fmtDate(rem.date)} · ${fmtTime(rem.time)}${rem.fired ? " · done" : ""}`;
    return `<div class="reminder-row${rem.weekly ? " weekly" : ""}">
      <span class="rem-ico" aria-hidden="true">${rem.weekly ? "🔁" : "⏰"}</span>
      <div class="rem-main">
        <strong>${escapeHTML(rem.title)}</strong>
        <small>${rem.refTitle ? escapeHTML(rem.refTitle) + " · " : ""}${when}</small>
      </div>
      <button type="button" class="icon-ghost danger delete-reminder" title="Delete reminder" aria-label="Delete reminder">🗑</button>
    </div>`;
  }).join("");

  list.querySelectorAll(".delete-reminder").forEach((btn, i) => {
    btn.addEventListener("click", () => deleteReminder(sorted[i]));
  });
}

/* ============================================================
   13. Export weekly schedule as .ics
   ============================================================ */

function exportIcs() {
  if (classes.length === 0) { showToast("Add or import classes first."); return; }
  const dayMap = { Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA", Sun: "SU" };
  const dt = (iso, hhmm) => iso.replace(/-/g, "") + "T" + hhmm.replace(":", "") + "00";
  const esc = s => String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StudentHub//Schedule//EN",
    "CALSCALE:GREGORIAN", "X-WR-CALNAME:StudentHub schedule"
  ];
  classes.forEach(c => (c.days || []).forEach(day => {
    const iso = nextDateFor(day);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${(c.title + "-" + iso + "-" + day).replace(/\W+/g, "-").toLowerCase()}@studenthub`,
      `DTSTART:${dt(iso, c.start)}`,
      `DTEND:${dt(iso, c.end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${dayMap[day]}`,
      `SUMMARY:${esc(c.title)}`,
      `LOCATION:${esc(c.room || "")}`,
      "DESCRIPTION:Imported from StudentHub",
      "END:VEVENT"
    );
  }));
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "studenthub-schedule.ics";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Weekly schedule exported — open it in Google Calendar or Outlook 🗓");
}

/* ============================================================
   14. Search overlay (press /)
   ============================================================ */

let searchHits = [];

function openSearch() {
  $("searchOverlay").hidden = false;
  $("searchInput").value = "";
  renderSearchResults("");
  $("searchInput").focus();
}

function closeSearch() {
  $("searchOverlay").hidden = true;
}

function renderSearchResults(q) {
  const ql = q.trim().toLowerCase();
  const results = [];

  if (ql) {
    tasks.forEach(t => {
      if ((t.title + " " + (t.course || "")).toLowerCase().includes(ql)) {
        results.push({
          icon: t.type === "exam" ? "📝" : "☑", label: t.title,
          sub: `Task · ${t.course || "no subject"} · due ${fmtDate(t.due)}`, go: "#/tasks"
        });
      }
    });
    const seenClasses = new Set();
    classes.forEach(c => {
      const key = (c.title || "").trim().toUpperCase();
      if (seenClasses.has(key) || !key.toLowerCase().includes(ql)) return;
      seenClasses.add(key);
      results.push({
        icon: "◷", label: c.title,
        sub: `${(c.days || []).map(d => d.slice(0, 3)).join(" · ")} · ${fmtTime(c.start)} · ${c.room || "no room"}`,
        go: "#/schedule"
      });
    });
    [...personalNotes, ...SCHOOL_ANNOUNCEMENTS].forEach(n => {
      if (((n.title || "") + " " + (n.body || "")).toLowerCase().includes(ql)) {
        results.push({ icon: "♧", label: n.title, sub: "Announcement", go: "#/announcements" });
      }
    });
    reminders.forEach(r => {
      if ((r.title || "").toLowerCase().includes(ql)) {
        results.push({ icon: "⏰", label: r.title, sub: "Reminder", go: "#/reminders" });
      }
    });
  }

  searchHits = results.slice(0, 8);
  const box = $("searchResults");
  box.innerHTML = searchHits.length
    ? searchHits.map((r, i) => `<button type="button" class="search-hit" data-i="${i}">
        <span aria-hidden="true">${r.icon}</span>
        <div><strong>${escapeHTML(r.label)}</strong><small>${escapeHTML(r.sub)}</small></div>
      </button>`).join("")
    : ql
      ? '<p class="muted search-none">No matches — try a course code or task title.</p>'
      : '<p class="muted search-none">Search tasks, classes, announcements and reminders.</p>';
  box.querySelectorAll(".search-hit").forEach(btn => {
    btn.addEventListener("click", () => {
      location.hash = searchHits[Number(btn.dataset.i)].go;
      closeSearch();
    });
  });
}

/* ============================================================
   15. Onboarding & welcome tour
   ============================================================ */

let tourStep = 0;

function renderOnboarding() {
  const card = $("onboardingCard");
  if (card) card.hidden = classes.length > 0;
}

function tourRender() {
  $("tourStep").textContent = `STEP ${tourStep + 1} OF ${TOUR.length}`;
  $("tourTitle").textContent = TOUR[tourStep].t;
  $("tourBody").textContent = TOUR[tourStep].b;
  $("tourBack").disabled = tourStep === 0;
  $("tourNext").textContent = tourStep === TOUR.length - 1 ? "Done ✦" : "Next";
}

function maybeStartTour() {
  if (lsRead("tourDone", false)) return;
  tourStep = 0;
  $("tourOverlay").hidden = false;
  tourRender();
}

function endTour() {
  $("tourOverlay").hidden = true;
  lsWrite("tourDone", true);
}

/* ============================================================
   16. Modals
   ============================================================ */

const taskModal = $("taskModal");
const taskForm = $("taskForm");
const classModal = $("classModal");
const classForm = $("classForm");
const profileModal = $("profileModal");
const profileForm = $("profileForm");
const corModal = $("corModal");
const corForm = $("corForm");
const noteModal = $("noteModal");
const noteForm = $("noteForm");
const reminderModal = $("reminderModal");
const reminderForm = $("reminderForm");

let editingClass = null;
let pickedTint = null;
let pendingPickedPhoto = null;

function closeOnBackdrop(modal, closer) {
  modal.addEventListener("click", event => {
    if (event.target === modal) closer();
  });
}

function openModal(modal, focusId) {
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  if (focusId) $(focusId)?.focus();
}

function closeModal(modal, form) {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  form.reset();
}

/* --- task modal --- */

function openTaskModal() { openModal(taskModal, "taskTitle"); }
function closeTaskModal() { closeModal(taskModal, taskForm); }

taskForm.addEventListener("submit", async event => {
  event.preventDefault();
  const title = $("taskTitle").value.trim();
  const course = $("taskCourse").value.trim();
  const due = $("taskDue").value;
  if (!title || !course || !due) return;
  const type = $("taskIsExam").checked ? "exam" : "task";
  await createTask({ title, course, due, type });
  closeTaskModal();
  renderExamCards();
  showToast(type === "exam" ? "Exam added — countdown is on your Overview 📝" : "Your new task has been added.");
});

/* --- class modal --- */

function buildTintPicker(selected) {
  const box = $("tintPicker");
  box.innerHTML = "";
  pickedTint = selected || null;
  TINTS.forEach(name => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `tint-swatch tint-${name}${selected === name ? " picked" : ""}`;
    b.setAttribute("aria-label", "Subject color: " + name);
    b.title = name.charAt(0).toUpperCase() + name.slice(1);
    b.addEventListener("click", () => {
      pickedTint = name;
      box.querySelectorAll(".tint-swatch").forEach(s => s.classList.remove("picked"));
      b.classList.add("picked");
    });
    box.appendChild(b);
  });
}

function openClassModal(entry) {
  editingClass = entry || null;
  classForm.reset();
  document.querySelectorAll("#classForm input[name=days]").forEach(cb => { cb.checked = false; });
  buildTintPicker(entry ? courseTint(entry.title) : null);
  if (entry) {
    $("classTitle").value = entry.title;
    $("classUnits").value = entry.units;
    $("classRoom").value = entry.room;
    $("classStart").value = entry.start;
    $("classEnd").value = entry.end;
    (entry.days || []).forEach(day => {
      const cb = document.querySelector(`#classForm input[name=days][value="${day}"]`);
      if (cb) cb.checked = true;
    });
    $("classModalTitle").textContent = "Edit class";
  } else {
    $("classModalTitle").textContent = "Add a class";
  }
  openModal(classModal, "classTitle");
}

function closeClassModal() {
  closeModal(classModal, classForm);
  editingClass = null;
}

classForm.addEventListener("submit", event => {
  event.preventDefault();
  const title = $("classTitle").value.trim();
  const data = {
    title,
    units: Number($("classUnits").value) || 0,
    room: $("classRoom").value.trim(),
    start: $("classStart").value,
    end: $("classEnd").value,
    days: [...document.querySelectorAll("#classForm input[name=days]:checked")].map(cb => cb.value),
    color: pickedTint || courseTint(title)
  };
  if (!data.days.length) { showToast("Pick at least one day for this class."); return; }
  if (data.end && data.end <= data.start) { showToast("End time must be after start time."); return; }
  saveClass(editingClass, data);
  closeClassModal();
});

/* --- profile modal + photo --- */

// downscale to a small JPEG data URL for the Firestore profile document
function compressAvatar(file, maxSide = 512) {
  return new Promise((resolve, reject) => {
    const bmp = new Image();
    bmp.onerror = () => reject(new Error("That file doesn't look like an image."));
    bmp.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
      URL.revokeObjectURL(bmp.src);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    bmp.src = URL.createObjectURL(file);
  });
}

function showPhotoPreview(src) {
  const box = $("pfPhotoPreview");
  if (box) box.innerHTML = src ? `<img src="${escapeHTML(src)}" alt="Photo preview">` : "📷";
}

async function attachPickedPhoto(file, { immediate = false } = {}) {
  if (!file) return;
  try {
    const dataURL = await compressAvatar(file);
    if (immediate) {
      await saveProfileData({ photoURL: dataURL });
      showToast("Profile photo updated. 📷");
    } else {
      pendingPickedPhoto = dataURL;
      showPhotoPreview(dataURL);
      $("pfPhoto").value = "";
      showToast("Photo attached — click Save profile to keep it.");
    }
  } catch (err) {
    showToast(err.message || "Couldn't attach that image.");
  }
}

function openProfileModal() {
  pendingPickedPhoto = null;
  $("pfName").value = profile.name || "";
  $("pfStudentId").value = profile.studentId || "";
  $("pfProgram").value = profile.program || "";
  $("pfYear").value = profile.year || "1";
  $("pfPhoto").value = profile.photoURL || "";
  showPhotoPreview(profile.photoURL || "");
  openModal(profileModal);
}

function closeProfileModal() {
  closeModal(profileModal, profileForm);
  pendingPickedPhoto = null;
}

profileForm.addEventListener("submit", async event => {
  event.preventDefault();
  await saveProfileData({
    name: $("pfName").value.trim() || profile.name,
    studentId: $("pfStudentId").value.trim(),
    program: $("pfProgram").value.trim().toUpperCase(),
    year: $("pfYear").value,
    photoURL: pendingPickedPhoto || $("pfPhoto").value.trim()
  });
  closeProfileModal();
});

/* --- personal note modal --- */

function openNoteModal() { openModal(noteModal, "noteTitle"); }
function closeNoteModal() { closeModal(noteModal, noteForm); }

noteForm.addEventListener("submit", async event => {
  event.preventDefault();
  const title = $("noteTitle").value.trim();
  if (!title) return;
  await createNote({
    title,
    body: $("noteBody").value.trim(),
    tag: $("noteTag").value
  });
  closeNoteModal();
  showToast("Note posted to your announcements.");
});

/* --- COR modal --- */

function openCorModal() {
  $("corText").value = "";
  $("corPreview").innerHTML = "";
  openModal(corModal, "corText");
}
function closeCorModal() { closeModal(corModal, corForm); }

$("corText").addEventListener("input", renderCorPreview);

$("corSample").addEventListener("click", () => {
  $("corText").value =
    "1261275  ESC 311  3.0  5:00 PM  6:00 PM  MWF  MB-306\n" +
    "1261274  ESC 312  1.0  1:00 PM  2:00 PM  MWF  MB-207\n" +
    "1261268  GE JRIZ  3.0  9:00 AM  10:00 AM  MWF  MB-205\n" +
    "1261535  ESC 314  2.0  11:30 AM  1:00 PM  TTH  MB-205";
  renderCorPreview();
});

$("corFile").addEventListener("change", async () => {
  const input = $("corFile");
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const text = (file.type === "application/pdf" || /\.pdf$/i.test(file.name))
      ? await pdfToText(file)
      : await ocrCanvas(await imageToCanvas(file), file.name);
    const ta = $("corText");
    ta.value = (ta.value ? ta.value.trimEnd() + "\n" : "") + text.trim();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    setCorStatus(`✅ Text extracted from ${escapeHTML(file.name)} — check the preview below and fix anything the reader got wrong.`, false);
  } catch (err) {
    console.error("COR extraction failed:", err);
    setCorStatus("⚠️ Couldn't read that file — you can still paste the lines manually.", false);
  } finally {
    input.value = "";
  }
});

corForm.addEventListener("submit", async event => {
  event.preventDefault();
  const { results } = parseCOR($("corText").value);
  if (!results.length) return;
  const existing = new Set(classes.map(c =>
    `${c.title.toUpperCase()}|${c.start}|${c.end}|${(c.days || []).sort().join()}`));
  const fresh = results.filter(r =>
    !existing.has(`${r.title.toUpperCase()}|${r.start}|${r.end}|${[...r.days].sort().join()}`));
  if (!fresh.length) {
    showToast("Those classes are already on your schedule.");
    closeCorModal();
    return;
  }
  closeCorModal();
  await importClasses(fresh);
});

/* --- reminder modal --- */

$("remLink").addEventListener("change", prefillLinkedReminder);

reminderForm.addEventListener("submit", async event => {
  event.preventDefault();
  const date = $("remDate").value;
  const time = $("remTime").value;
  const title = $("remTitle").value.trim();
  if (!title || !date || !time) return;
  primeAlarm();
  const link = $("remLink").value;
  const splitAt = link.indexOf(":");
  const kind = link ? link.slice(0, splitAt) : "";
  const refTitle = link ? link.slice(splitAt + 1) : "";
  const weekly = $("remWeekly").checked;
  await ensureNotificationPermission();
  await createReminder({
    title, refType: kind, refTitle, date, time, weekly,
    weekday: weekly ? new Date(date + "T00:00:00").getDay() : null
  });
  closeReminderModal();
  showToast("Reminder saved ⏰");
});

/* ============================================================
   17. Event wiring
   ============================================================ */

const toast = $("toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

[taskModal, classModal, profileModal, corModal, noteModal, reminderModal]
  .forEach((modal, i) => closeOnBackdrop(modal, [
    closeTaskModal, closeClassModal, closeProfileModal,
    closeCorModal, closeNoteModal, closeReminderModal
  ][i]));

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeSearch();
    closeTaskModal();
    closeClassModal();
    closeProfileModal();
    closeCorModal();
    closeNoteModal();
    closeReminderModal();
    return;
  }
  // N = new task, / = search — ignored while typing
  const typing = event.target instanceof Element &&
    event.target.closest("input, textarea, select, [contenteditable]");
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "/") { event.preventDefault(); openSearch(); }
  else if (event.key === "n" || event.key === "N") { event.preventDefault(); openTaskModal(); }
});

const bindClick = (id, handler) => $(id)?.addEventListener("click", handler);

// buttons opening/closing modals
bindClick("addTaskButton", openTaskModal);
bindClick("addTaskTop", openTaskModal);
bindClick("closeModal", closeTaskModal);
bindClick("cancelModal", closeTaskModal);
bindClick("addClassButton", () => openClassModal(null));
bindClick("closeClassModal", closeClassModal);
bindClick("cancelClassModal", closeClassModal);
bindClick("editProfileButton", openProfileModal);
bindClick("closeProfileModal", closeProfileModal);
bindClick("cancelProfileModal", closeProfileModal);
bindClick("importCorButton", openCorModal);
bindClick("closeCorModal", closeCorModal);
bindClick("cancelCorModal", closeCorModal);
bindClick("addNoteButton", openNoteModal);
bindClick("closeNoteModal", closeNoteModal);
bindClick("cancelNoteModal", closeNoteModal);
bindClick("addReminderButton", openReminderModal);
bindClick("closeReminderModal", closeReminderModal);
bindClick("cancelReminderModal", closeReminderModal);

// schedule / export / notifications
bindClick("exportIcsButton", exportIcs);
bindClick("permButton", ensureNotificationPermission);
bindClick("notificationButton", () => { location.hash = "#/reminders"; });

document.querySelectorAll("#scheduleViewToggle .filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#scheduleViewToggle .filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    weekView = chip.dataset.view === "week";
    $("weekWrap").hidden = !weekView;
    $("dayTabs").hidden = weekView;
    $("scheduleEditor").hidden = weekView;
    if (weekView) renderWeekGrid();
  });
});

// quick-add
$("quickAddInput").addEventListener("input", renderQuickAddPreview);
$("quickAddInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && qaParsed) {
    event.preventDefault();
    saveQuickAdd();
  }
});

// focus timer
bindClick("focusStart", () => (focus.running ? stopFocusTick() : startFocusTick()));
bindClick("focusReset", focusReset);
bindClick("focusEdit", () => {
  const custom = $("focusCustom");
  const presets = $("focusPresets");
  const btn = $("focusEdit");
  const opening = custom.hidden;
  custom.hidden = !opening;
  presets.hidden = opening;
  btn.setAttribute("aria-expanded", String(opening));
  btn.textContent = opening ? "Cancel" : "✎ Edit";
  if (opening) $("focusHours").focus();
});
bindClick("focusApply", () => {
  const hours = Math.max(0, Math.min(12, Number($("focusHours").value) || 0));
  const mins = Math.max(0, Math.min(59, Number($("focusMinutes").value) || 0));
  const total = hours * 60 + mins;
  if (total < 1) { showToast("Set a session length of at least 1 minute."); return; }
  applyFocusDuration(total);
  $("focusCustom").hidden = true;
  $("focusPresets").hidden = false;
  $("focusEdit").textContent = "✎ Edit";
  $("focusEdit").setAttribute("aria-expanded", "false");
});
document.querySelectorAll("#focusPresets .duration-chip").forEach(chip => {
  chip.addEventListener("click", () => applyFocusDuration(Number(chip.dataset.min)));
});
$("focusTask").addEventListener("change", () => {
  const task = currentFocusTask();
  if (task) {
    selectFocusTask(task);
    focusReset();
    startFocusTick();
    showToast(`Focus started for ${task.title} ▶`);
  } else {
    focus.taskId = null;
    focus.taskTitle = "";
  }
});

// search
$("searchInput").addEventListener("input", event => renderSearchResults(event.target.value));
$("searchInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && searchHits.length) {
    event.preventDefault();
    location.hash = searchHits[0].go;
    closeSearch();
  }
});
$("searchOverlay").addEventListener("click", event => {
  if (event.target === $("searchOverlay")) closeSearch();
});

// tour
bindClick("tourSkip", endTour);
bindClick("tourBack", () => { if (tourStep > 0) { tourStep--; tourRender(); } });
bindClick("tourNext", () => {
  if (tourStep < TOUR.length - 1) { tourStep++; tourRender(); }
  else endTour();
});

// onboarding
bindClick("onboardImport", openCorModal);
bindClick("onboardManual", () => openClassModal(null));

// task filters
document.querySelectorAll("#taskFilters .filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#taskFilters .filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    taskFilter = chip.dataset.filter;
    renderTasks();
  });
});

// theme, mobile menu, navigation
bindClick("themeToggle", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("studentHubDarkMode", String(document.body.classList.contains("dark")));
});
if (localStorage.getItem("studentHubDarkMode") === "true") document.body.classList.add("dark");

bindClick("menuToggle", () => $("sidebar").classList.toggle("open"));

bindClick("logoutButton", async () => {
  if (mode === "firebase") await signOut(auth);
  else demoEndSession();
  window.location.href = "login.html";
});

const jumpToProfile = () => { location.hash = "#/profile"; };
bindClick("miniProfile", jumpToProfile);
bindClick("topAvatarSlot", jumpToProfile);

// profile photo pickers
$("pfPhotoFile").addEventListener("change", async () => {
  const file = $("pfPhotoFile").files && $("pfPhotoFile").files[0];
  $("pfPhotoFile").value = "";
  await attachPickedPhoto(file, { immediate: true });
});
$("pfPhotoUpload").addEventListener("change", async () => {
  const file = $("pfPhotoUpload").files && $("pfPhotoUpload").files[0];
  $("pfPhotoUpload").value = "";
  await attachPickedPhoto(file);
});

$("todayLabel").textContent = new Date()
  .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  .toUpperCase();

/* ============================================================
   18. Boot
   ============================================================ */

function renderAllSchedule() {
  renderDayTabs();
  if (weekView) renderWeekGrid(); else renderSchedule();
  renderToday();
  renderCourseStrip();
  renderStats();
  renderBriefing();
  renderExamCards();
  renderOnboarding();
  renderFocusCourseOptions();
  renderFocusTaskOptions();
  renderProfileView();
}

function bindFirestoreCollections() {
  bindCollection("tasks", rows => {
    if (!rows.length && !tasks.length) {
      DEFAULT_TASKS.forEach(t => addDoc(collection(db, "users", uid, "tasks"), t));
    }
    tasks = rows;
    renderTasks();
    renderStats();
    renderExamCards();
    renderFocusCourseOptions();
    renderFocusTaskOptions();
  });
  bindCollection("classes", rows => {
    if (!rows.length && !classes.length) {
      DEFAULT_CLASSES.forEach(c => addDoc(collection(db, "users", uid, "classes"), c));
    }
    classes = rows;
    renderAllSchedule();
    renderFocusCourseOptions();
  });
  bindCollection("announcements", rows => {
    personalNotes = rows;
    renderAnnouncements();
  });
  bindCollection("reminders", rows => {
    reminders = rows;
    renderReminders();
  });
  bindCollection("sessions", rows => {
    sessions = rows;
    renderFocusWeek();
  });
}

function boot(user, seededProfile) {
  uid = user.uid;
  profile = { ...DEFAULT_PROFILE, ...(seededProfile || {}) };
  renderIdentity();
  if (mode === "firebase") bindFirestoreCollections();
  else {
    seedLocal();
    renderIdentity();
  }
  renderAllSchedule();
  renderTasks();
  renderAnnouncements();
  renderReminders();
  renderFocusWeek();
  applyFocusDuration(FOCUS_PRESETS[0], false);
  updatePermissionChip();
  updatePermissionNote();
  demoBanner();
  showScreen(currentScreen());
  maybeStartTour();

  // keep the briefing, "up next" and reminders fresh while the app is open
  window.setInterval(() => {
    renderBriefing();
    renderToday();
    checkReminders();
  }, 30000);
  checkReminders();
}

function demoBanner() {
  if (mode === "firebase") return;
  const el = document.createElement("div");
  el.className = "demo-banner";
  el.innerHTML = `<span>⚙️</span> Demo mode — data is saved in this browser only.
    <a href="#" id="demoBannerLink">Connect Firebase</a> to sync your account, profile and schedule`;
  document.body.prepend(el);
  el.querySelector("a").addEventListener("click", event => {
    event.preventDefault();
    showToast("See js/firebase-config.js + the README to connect Firebase.");
  });
}

async function start() {
  if (mode === "firebase") {
    const user = await new Promise(resolve => {
      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); }, () => { unsub(); resolve(null); });
    });
    if (!user) { window.location.href = "login.html"; return; }
    boot(user, await cloudInitProfile(user));
  } else {
    const demoUser = demoUserFromSession();
    if (!demoUser) { window.location.href = "login.html"; return; }
    // each demo account carries its own registered profile — no cross-user leakage
    const ownProfile = { name: demoUser.name, email: demoUser.email, ...(demoUser.profile || {}) };
    boot({ uid: "demo-" + demoUser.uid }, ownProfile);
  }
}

start();
