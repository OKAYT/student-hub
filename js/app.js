/* StudentHub dashboard logic (index.html)
   - screen router (each sidebar item is its own page)
   - Firebase Auth guard + Firestore data when configured
   - localStorage demo fallback otherwise
   - editable profile + editable weekly schedule + tasks
   - COR importer: paste your Certificate of Registration lines
     and the schedule is built automatically (per user account) */

import { mode, auth, db } from "./firebase-init.js?v=10";
import { demoUserFromSession, demoEndSession } from "./demo-auth.js?v=10";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc, getDoc, setDoc, collection, onSnapshot,
  addDoc, deleteDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------- seed data (from the real COR) ---------------- */

const DEFAULT_PROFILE = {
  name: "Dela Cruz, Juan",
  studentId: "2025-0001",
  program: "BSCS",
  year: "1",
  photoURL: "img/avatar.svg",
  semester: "1st Semester · 2026"
};

const DEFAULT_CLASSES = [
  { title: "ESC 311",  units: 3.0, days: ["Mon", "Wed", "Fri"], start: "17:00", end: "18:00", room: "MB-306" },
  { title: "ESC 312",  units: 1.0, days: ["Mon", "Wed", "Fri"], start: "13:00", end: "14:00", room: "MB-207" },
  { title: "ESC 312",  units: 2.0, days: ["Tue", "Thu"],        start: "13:00", end: "14:00", room: "MB-212" },
  { title: "ESC 312",  units: 1.0, days: ["Sun"],               start: "12:00", end: "15:00", room: "MB-205" },
  { title: "ESC 313",  units: 1.0, days: ["Sat"],               start: "10:00", end: "12:00", room: "MB-212" },
  { title: "ESC 313",  units: 2.0, days: ["Mon", "Wed"],        start: "10:00", end: "11:00", room: "MB-212" },
  { title: "ESC 314",  units: 2.0, days: ["Tue", "Thu"],        start: "11:30", end: "13:00", room: "MB-205" },
  { title: "ESC 314",  units: 1.0, days: ["Tue", "Thu"],        start: "17:30", end: "19:00", room: "MB-208" },
  { title: "GE JRIZ",  units: 3.0, days: ["Mon", "Wed", "Fri"], start: "09:00", end: "10:00", room: "MB-205" },
  { title: "PSC 311",  units: 1.0, days: ["Tue", "Thu"],        start: "09:00", end: "10:00", room: "MB-212" },
  { title: "PSC 311",  units: 2.0, days: ["Tue", "Thu"],        start: "16:00", end: "17:30", room: "MB-207" },
  { title: "PSC 312",  units: 1.0, days: ["Mon", "Wed"],        start: "14:00", end: "15:00", room: "MB-212" },
  { title: "PSC 312",  units: 1.0, days: ["Tue", "Thu"],        start: "15:00", end: "16:00", room: "MB-212" }
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

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

/* ---------------- state ---------------- */

let uid = null;
let profile = { ...DEFAULT_PROFILE };
let classes = [];
let tasks = [];
let personalNotes = [];
let taskFilter = "all";
let unsubs = [];

/* ---------------- data layer ---------------- */

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
  // profile was already set by boot() from this user's own account record;
  // per-user saved edits (lsRead) take precedence over registration defaults
  profile = { ...(profile || DEFAULT_PROFILE), ...lsRead("profile", {}) };
  classes = lsRead("classes", null) || DEFAULT_CLASSES.map((c, i) => ({ id: "seed" + i, ...c }));
  tasks = lsRead("tasks", null) || DEFAULT_TASKS.map((t, i) => ({ id: "seed" + i, ...t }));
  personalNotes = lsRead("announcements", []);
  lsWrite("classes", classes);
  lsWrite("tasks", tasks);
  lsWrite("announcements", personalNotes);
}

async function cloudInitProfile(u) {
  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const seeded = {
    ...DEFAULT_PROFILE,
    name: u.displayName || DEFAULT_PROFILE.name,
    email: u.email || "",
    createdAt: Date.now()
  };
  await setDoc(ref, seeded, { merge: true });
  return seeded;
}

/* ---------------- helpers ---------------- */

const $ = id => document.getElementById(id);

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

function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function avatarHTML(source, labelClass) {
  const fallback = `<div class="${labelClass} fallback">${initials(profile.name)}</div>`;
  if (source) {
    return `<img class="${labelClass}" src="${escapeHTML(source)}" alt="Profile photo"
            onerror="this.outerHTML='${fallback.replace(/'/g, "&#39;")}'">`;
  }
  return `<div class="${labelClass}">${initials(profile.name)}</div>`;
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

function minutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/* ---------------- router ---------------- */

const SCREENS = {
  overview: "Overview",
  schedule: "Schedule",
  tasks: "Tasks & Deadlines",
  announcements: "Announcements",
  profile: "My Profile"
};

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

/* ---------------- render: shared identity ---------------- */

function renderIdentity() {
  $("miniProfile").innerHTML = `
    ${avatarHTML(profile.photoURL, "avatar")}
    <div><strong>${escapeHTML(profile.name)}</strong>
    <small>${escapeHTML(profile.program || "—")} · ${escapeHTML(profile.year ? profile.year + " Year" : "—")}</small></div>`;

  $("userEmail").textContent = profile.email || "student";
  $("topAvatarSlot").innerHTML = avatarHTML(profile.photoURL, "top-avatar");
  $("welcomeName").innerHTML = `${greeting()}, ${escapeHTML(firstName(profile.name))}! <span class="wave">✦</span>`;
  $("semesterLabel").textContent = profile.semester || "1st Semester · 2026";
  renderProfileView();
}

let heroPhotoKey = null;

function renderHeroPhoto() {
  const slot = $("profilePhotoSlot");
  if (!slot) return;
  const url = profile.photoURL || "";
  const key = url + "|" + initials(profile.name);
  if (key === heroPhotoKey) return;
  heroPhotoKey = key;
  slot.querySelector(".avatar-xl")?.remove();
  if (url) {
    const img = document.createElement("img");
    img.className = "avatar-xl";
    img.alt = "Profile photo";
    img.src = url;
    img.addEventListener("error", () => {           // broken/missing photo → show initials instead
      img.remove();
      if (!slot.querySelector(".avatar-xl")) {
        const div = document.createElement("div");
        div.className = "avatar-xl";
        div.textContent = initials(profile.name);
        slot.prepend(div);
      }
    }, { once: true });
    slot.prepend(img);
  } else {
    const div = document.createElement("div");
    div.className = "avatar-xl";
    div.textContent = initials(profile.name);
    slot.prepend(div);
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

/* ---------------- render: stats ---------------- */

function distinctCourseCount() {
  return new Set(classes.map(c => c.title.trim().toUpperCase())).size;
}

function totalUnits() {
  return classes.reduce((sum, c) => sum + (Number(c.units) || 0), 0);
}

function renderStats() {
  const today = todaysDay();
  $("statCourses").textContent = distinctCourseCount();
  $("statUnits").textContent = totalUnits().toFixed(1);
  $("statToday").textContent = classes.filter(c => c.days && c.days.includes(today)).length;
  const pending = tasks.filter(t => !t.done).length;
  $("pendingCount").textContent = pending;
  $("pendingCount2").textContent = pending;
  $("doneCount").textContent = tasks.filter(t => t.done).length;
  $("portalPending").textContent = pending;
  $("portalUnits").textContent = totalUnits().toFixed(1);
}

/* ---------------- render: today's classes (fixed layout) ---------------- */

function todaysDay() {
  return DAY_ORDER[(new Date().getDay() + 6) % 7]; // JS: Sun=0
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function renderToday() {
  const day = todaysDay();
  $("todaySpan").textContent = `${DAY_FULL[day]} · ${profile.semester || ""}`;
  const list = $("todayList");
  const today = classes
    .filter(c => c.days && c.days.includes(day))
    .sort((a, b) => a.start.localeCompare(b.start));

  list.innerHTML = "";
  if (today.length === 0) {
    list.innerHTML = '<p class="muted today-empty">No classes today. Enjoy the free day! 🎉</p>';
    return;
  }
  const nMin = nowMinutes();
  const nextIndex = today.findIndex(c => minutes(c.start) > nMin);
  today.forEach((c, index) => {
    const isNext = index === nextIndex && minutes(c.end) >= nMin;
    const row = document.createElement("div");
    row.className = "today-row" + (isNext ? " next" : "");
    row.innerHTML = `
      <div class="today-time"><b>${fmtTime(c.start)}</b><small>until ${fmtTime(c.end)}</small></div>
      <div class="today-info">
        <strong>${escapeHTML(c.title)}</strong>
        <small>${escapeHTML(c.room || "No room")} · ${c.days.length === 1 ? "weekly" : c.days.length + "×/week"}</small>
      </div>
      ${isNext ? '<span class="up-next-chip">Up next</span>' : ""}`;
    list.appendChild(row);
  });
}

/* ---------------- render: course strip (schedule screen) ---------------- */

const TINTS = ["violet", "cyan", "amber", "rose", "green"];

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
    const meetings = classes.filter(x => x.title.trim().toUpperCase() === key);
    const units = meetings.reduce((s, x) => s + (Number(x.units) || 0), 0);
    const chip = document.createElement("span");
    chip.className = "course-chip";
    chip.innerHTML = `${escapeHTML(c.title)} <small>${units.toFixed(1)} u</small>`;
    strip.appendChild(chip);
  });
}

/* ---------------- render: schedule editor ---------------- */

let activeDay = "Mon";

function renderDayTabs() {
  const tabs = $("dayTabs");
  const today = todaysDay();
  tabs.innerHTML = "";
  DAY_ORDER.forEach(day => {
    const count = classes.filter(c => c.days && c.days.includes(day)).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-tab" + (day === activeDay ? " active" : "") + (day === today ? " is-today" : "");
    btn.innerHTML = `${day}<i>${count}</i>`;
    btn.addEventListener("click", () => { activeDay = day; renderDayTabs(); renderSchedule(); });
    tabs.appendChild(btn);
  });
}

function renderSchedule() {
  const list = $("scheduleEditor");
  const items = classes
    .filter(c => c.days && c.days.includes(activeDay))
    .sort((a, b) => a.start.localeCompare(b.start));

  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = `<p class="muted">No classes on ${DAY_FULL[activeDay]} yet.</p>`;
    return;
  }
  items.forEach(c => {
    const row = document.createElement("div");
    row.className = "sched-row";
    row.innerHTML = `
      <span class="sched-time">${fmtTime(c.start)}<b>–</b>${fmtTime(c.end)}</span>
      <div class="sched-main"><strong>${escapeHTML(c.title)}</strong><small>${escapeHTML(c.room || "No room")} · ${Number(c.units).toFixed(1)} units</small></div>
      <div class="sched-actions">
        <button class="icon-ghost" data-act="edit" title="Edit">✎</button>
        <button class="icon-ghost danger" data-act="delete" title="Delete">🗑</button>
      </div>`;
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openClassModal(c));
    row.querySelector('[data-act="delete"]').addEventListener("click", () => removeClass(c));
    list.appendChild(row);
  });
}

/* ---------------- render: tasks ---------------- */

function renderTasks() {
  const list = $("taskList");
  list.innerHTML = "";
  const visible = tasks.filter(t =>
    taskFilter === "all" ? true : taskFilter === "done" ? t.done : !t.done
  );
  if (visible.length === 0) {
    list.innerHTML = taskFilter === "all"
      ? '<p class="muted">No tasks yet. Add one to get started.</p>'
      : `<p class="muted">No ${taskFilter} tasks.</p>`;
  }
  visible.forEach(task => {
    const row = document.createElement("div");
    row.className = `task-row ${task.done ? "completed" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-check";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", async () => {
      task.done = checkbox.checked;
      await persistTaskUpdate(task);
      renderTasks();
      renderStats();
      showToast(task.done ? "Task marked as complete." : "Task marked as pending.");
    });

    const main = document.createElement("div");
    main.className = "task-main";
    const title = document.createElement("strong");
    title.textContent = task.title;
    const course = document.createElement("small");
    course.textContent = task.course;
    main.append(title, course);

    const due = document.createElement("span");
    due.className = "task-date";
    due.textContent = `Due ${fmtDate(task.due)}`;

    const del = document.createElement("button");
    del.className = "icon-ghost danger";
    del.title = "Delete task";
    del.textContent = "🗑";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete "${task.title}"?`)) return;
      await deleteTask(task);
      showToast("Task deleted.");
    });

    row.append(checkbox, main, due, del);
    list.appendChild(row);
  });
}

/* ---------------- render: announcements ---------------- */

function allAnnouncements() {
  return [...personalNotes.map(n => ({ ...n, mine: true })), ...SCHOOL_ANNOUNCEMENTS]
    .sort((a, b) => b.ts - a.ts);
}

function announcementCard(a, compact) {
  const dateLabel = a.mine
    ? new Date(a.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : timeAgo(a.ts);
  const tagClass = a.tag === "ACADEMIC" ? "" : a.tag === "CAMPUS" ? "tag-blue" : "tag-personal";
  return `
    <div class="announcement">
      <span class="announcement-tag ${tagClass}">${escapeHTML(a.tag)}</span>
      <strong>${escapeHTML(a.title)}</strong>
      ${a.body && !compact ? `<p>${escapeHTML(a.body)}</p>` : a.body && compact ? `<p>${escapeHTML(a.body.length > 90 ? a.body.slice(0, 90) + "…" : a.body)}</p>` : ""}
      <small>${a.mine ? "My note · " : "Posted "}${dateLabel}</small>
    </div>`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"} ago`;
}

function renderAnnouncements() {
  const all = allAnnouncements();
  const preview = $("annPreviewList");
  const full = $("annList");
  if (preview) preview.innerHTML = all.slice(0, 2).map(a => announcementCard(a, true)).join("");
  if (full) full.innerHTML = all.length ? all.map(a => announcementCard(a, false)).join("")
    : '<p class="muted">No announcements yet.</p>';
}

/* ---------------- persistence: tasks ---------------- */

function cloudId(id) { return String(id).replace(/^cloud-/, ""); }

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

/* ---------------- persistence: classes ---------------- */

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
  if (mode === "firebase") {
    for (const entry of entries) {
      await addDoc(collection(db, "users", uid, "classes"), entry);
    }
  } else {
    entries.forEach(entry => classes.push({ id: String(Date.now()) + Math.random().toString(36).slice(2, 6), ...entry }));
    lsWrite("classes", classes);
    renderAllSchedule();
  }
  showToast(`${entries.length} class${entries.length === 1 ? "" : "es"} imported from your COR.`);
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

/* ---------------- persistence: notes ---------------- */

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

/* ---------------- COR parser ---------------- */

const DAY_MAP = {
  M: ["Mon"], T: ["Tue"], W: ["Wed"], H: ["Thu"], TH: ["Thu"], F: ["Fri"],
  S: ["Sat"], U: ["Sun"], SU: ["Sun"], SAT: ["Sat"], SUN: ["Sun"],
  MWF: ["Mon", "Wed", "Fri"], TTH: ["Tue", "Thu"], MW: ["Mon", "Wed"],
  MF: ["Mon", "Fri"], WF: ["Wed", "Fri"], MTH: ["Mon", "Thu"],
  TTHF: ["Tue", "Thu", "Fri"], MTWTH: ["Mon", "Tue", "Wed", "Thu"],
  MTWTF: ["Mon", "Tue", "Wed", "Thu", "Fri"], MTWHF: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  MTWHFS: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
};

/* common OCR confusions in day codes: F read as E, W as V, etc. */
function dayCodeFix(code) {
  if (DAY_MAP[code]) return code;
  const fixes = [code.replace(/E/g, "F"), code.replace(/V/g, "W"), code.replace(/0/g, "O").replace(/[|l]/g, "")];
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

function parseCOR(text) {
  const results = [];
  const warnings = [];
  text.split(/\n+/).forEach(raw => {
    let line = raw.trim();
    if (!line) return;
    const original = line;

    line = line.replace(/\d{6,8}/, " "); // strip sched code (e.g. 1261275)

    let room = "";
    const roomM = line.match(/\b[A-Z]{1,4}-\d{1,4}[A-Z]?\b/i);
    if (roomM) {
      room = roomM[0].toUpperCase();
      line = line.replace(roomM[0], " ");
    }

    let start = "", end = "";
    const range = line.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*([APap][Mm])\.?/);
    if (range) {
      start = toTime(range[1], range[2], range[5].toUpperCase());
      end = toTime(range[3], range[4], range[5].toUpperCase());
      line = line.replace(range[0], " ");
    } else {
      const timeRe = /(\d{1,2}):(\d{2})\s*([APap][Mm])\.?/g;
      const times = [];
      let mm;
      while ((mm = timeRe.exec(line))) times.push({ s: mm[0], t: toTime(mm[1], mm[2], mm[3].toUpperCase()) });
      if (times.length) {
        line = line.replace(timeRe, " ");
        start = times[0].t;
        end = times[times.length - 1].t;
        if (times.length === 1) {
          const [h, m] = start.split(":").map(Number);
          end = String((h + 1) % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0");
        }
      }
    }

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

    const title = titleTokens.join(" ");
    if (!title) {
      warnings.push(`Skipped "${original}" — couldn't find a course code.`);
      return;
    }
    if (!start) {
      warnings.push(`Skipped "${original}" — couldn't find a start time (use formats like 5:00 PM).`);
      return;
    }
    const days = expandDays(dayCodes);
    if (days.length === 0) {
      warnings.push(`Skipped "${original}" — couldn't find days (use codes like MWF, TTH, S).`);
      return;
    }
    results.push({ title, units: Number(units) || 0, room, days, start, end });
  });
  return { results, warnings };
}

/* ---------------- COR modal ---------------- */

const corModal = $("corModal");

function openCorModal() {
  $("corText").value = "";
  $("corPreview").innerHTML = "";
  corModal.classList.add("show");
  corModal.setAttribute("aria-hidden", "false");
  $("corText").focus();
}

function closeCorModal() {
  corModal.classList.remove("show");
  corModal.setAttribute("aria-hidden", "true");
}

function renderCorPreview() {
  const { results, warnings } = parseCOR($("corText").value);
  const box = $("corPreview");
  const rows = results.map(r => `
    <div class="cor-row">
      <b>${escapeHTML(r.title)}</b>
      <small>${r.days.map(d => DAY_FULL[d].slice(0, 3)).join(" · ")} · ${fmtTime(r.start)} – ${fmtTime(r.end)} · ${escapeHTML(r.room || "no room")} · ${r.units.toFixed(1)} u</small>
    </div>`).join("");
  const photoTip = (warnings.length >= 5 && results.length > 0)
    ? '<p class="cor-tip">💡 Several lines couldn\'t be read — this happens with angled or wrinkled photos. Fix the preview below, edit the schedule afterwards, or import a straighter, well-lit photo.</p>'
    : "";
  box.innerHTML =
    (results.length ? `<p class="cor-count"><b>${results.length}</b> class${results.length === 1 ? "" : "es"} detected:</p>${rows}` : "") +
    warnings.map(w => `<p class="cor-warning">⚠️ ${escapeHTML(w)}</p>`).join("") +
    photoTip;
  $("corImportButton").disabled = results.length === 0;
  $("corImportButton").textContent = results.length ? `Import ${results.length} class${results.length === 1 ? "" : "es"}` : "Import classes";
}

/* ---------------- COR file extraction (photo OCR / PDF text) ---------------- */

const corFile = $("corFile");
const corStatus = $("corStatus");

function loadScriptOnce(src, key) {
  if (!loadScriptOnce.loaded) loadScriptOnce.loaded = {};
  if (loadScriptOnce.loaded[key]) return loadScriptOnce.loaded[key];
  loadScriptOnce.loaded[key] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete loadScriptOnce.loaded[key]; reject(new Error("Could not load " + src)); };
    document.head.appendChild(s);
  });
  return loadScriptOnce.loaded[key];
}

function setCorStatus(html, busy) {
  corStatus.innerHTML = busy ? `<span class="spin"></span> ${html}` : html;
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

  // gentle cleanup: grayscale + contrast stretch (no hard binarization —
  // dot-matrix print is faint and full thresholding erases it)
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
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  const pages = Math.min(pdf.numPages, 5);
  for (let p = 1; p <= pages; p++) {
    setCorStatus(`Reading PDF page ${p} of ${pages}…`, true);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // group text items into rows by vertical position, then sort left→right
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
  // scanned PDF without a text layer? fall back to OCR on rendered pages
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

corFile.addEventListener("change", async () => {
  const file = corFile.files && corFile.files[0];
  if (!file) return;
  try {
    let text = "";
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      text = await pdfToText(file);
    } else {
      const canvas = await imageToCanvas(file);
      text = await ocrCanvas(canvas, file.name);
    }
    const ta = $("corText");
    ta.value = (ta.value ? ta.value.trimEnd() + "\n" : "") + text.trim();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    setCorStatus(`✅ Text extracted from ${escapeHTML(file.name)} — check the preview below and fix anything the reader got wrong.`, false);
  } catch (err) {
    console.error("COR extraction failed:", err);
    setCorStatus("⚠️ Couldn't read that file — you can still paste the lines manually.", false);
  } finally {
    corFile.value = "";
  }
});

$("corText").addEventListener("input", renderCorPreview);
$("corSample").addEventListener("click", () => {
  $("corText").value =
    "1261275  ESC 311  3.0  5:00 PM  6:00 PM  MWF  MB-306\n" +
    "1261274  ESC 312  1.0  1:00 PM  2:00 PM  MWF  MB-207\n" +
    "1261268  GE JRIZ  3.0  9:00 AM  10:00 AM  MWF  MB-205\n" +
    "1261535  ESC 314  2.0  11:30 AM  1:00 PM  TTH  MB-205";
  renderCorPreview();
});

$("corForm").addEventListener("submit", async event => {
  event.preventDefault();
  const { results } = parseCOR($("corText").value);
  if (results.length === 0) return;
  // skip duplicates already on the schedule
  const existing = new Set(classes.map(c => `${c.title.toUpperCase()}|${c.start}|${c.end}|${(c.days || []).sort().join()}`));
  const fresh = results.filter(r => !existing.has(`${r.title.toUpperCase()}|${r.start}|${r.end}|${[...r.days].sort().join()}`));
  if (fresh.length === 0) {
    showToast("Those classes are already on your schedule.");
    closeCorModal();
    return;
  }
  closeCorModal();
  await importClasses(fresh);
});

/* ---------------- schedule modal ---------------- */

const classModal = $("classModal");
const classForm = $("classForm");
let editingClass = null;

function openClassModal(entry) {
  editingClass = entry || null;
  classForm.reset();
  document.querySelectorAll("#classForm input[name=days]").forEach(cb => { cb.checked = false; });
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
  classModal.classList.add("show");
  classModal.setAttribute("aria-hidden", "false");
  $("classTitle").focus();
}

function closeClassModal() {
  classModal.classList.remove("show");
  classModal.setAttribute("aria-hidden", "true");
  classForm.reset();
  editingClass = null;
}

classForm.addEventListener("submit", event => {
  event.preventDefault();
  const data = {
    title: $("classTitle").value.trim(),
    units: Number($("classUnits").value) || 0,
    room: $("classRoom").value.trim(),
    start: $("classStart").value,
    end: $("classEnd").value,
    days: [...document.querySelectorAll("#classForm input[name=days]:checked")].map(cb => cb.value)
  };
  if (data.days.length === 0) { showToast("Pick at least one day for this class."); return; }
  if (data.end && data.end <= data.start) { showToast("End time must be after start time."); return; }
  saveClass(editingClass, data);
  closeClassModal();
});

/* ---------------- profile photo attach ---------------- */

// Reads an image file, downscales it to a JPEG data URL that is small enough
// to store in the Firestore profile document (~100 KB).
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

let pendingPickedPhoto = null; // data URL chosen in the edit modal, saved on "Save profile"

function showPhotoPreview(src) {
  const box = $("pfPhotoPreview");
  if (!box) return;
  box.innerHTML = src ? `<img src="${escapeHTML(src)}" alt="Photo preview">` : "📷";
}

async function attachPickedPhoto(file, { immediate = false } = {}) {
  if (!file) return;
  try {
    const dataURL = await compressAvatar(file);
    if (immediate) {
      // camera button on the profile hero — apply right away
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

/* ---------------- profile modal ---------------- */

const profileModal = $("profileModal");
const profileForm = $("profileForm");

function openProfileModal() {
  pendingPickedPhoto = null;
  $("pfName").value = profile.name || "";
  $("pfStudentId").value = profile.studentId || "";
  $("pfProgram").value = profile.program || "";
  $("pfYear").value = profile.year || "1";
  $("pfPhoto").value = profile.photoURL || "";
  showPhotoPreview(profile.photoURL || "");
  profileModal.classList.add("show");
  profileModal.setAttribute("aria-hidden", "false");
}

function closeProfileModal() {
  profileModal.classList.remove("show");
  profileModal.setAttribute("aria-hidden", "true");
  profileForm.reset();
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

/* ---------------- task modal ---------------- */

const taskModal = $("taskModal");
const taskForm = $("taskForm");

function openTaskModal() {
  taskModal.classList.add("show");
  taskModal.setAttribute("aria-hidden", "false");
  $("taskTitle").focus();
}

function closeTaskModal() {
  taskModal.classList.remove("show");
  taskModal.setAttribute("aria-hidden", "true");
  taskForm.reset();
}

taskForm.addEventListener("submit", async event => {
  event.preventDefault();
  const title = $("taskTitle").value.trim();
  const course = $("taskCourse").value.trim();
  const due = $("taskDue").value;
  if (!title || !course || !due) return;
  await createTask({ title, course, due });
  closeTaskModal();
  showToast("Your new task has been added.");
});

/* ---------------- note modal ---------------- */

const noteModal = $("noteModal");
const noteForm = $("noteForm");

function openNoteModal() {
  noteModal.classList.add("show");
  noteModal.setAttribute("aria-hidden", "false");
  $("noteTitle").focus();
}

function closeNoteModal() {
  noteModal.classList.remove("show");
  noteModal.setAttribute("aria-hidden", "true");
  noteForm.reset();
}

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

/* ---------------- generic UI ---------------- */

const toast = $("toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function closeOnBackdrop(modal, closer) {
  modal.addEventListener("click", event => {
    if (event.target === modal) closer();
  });
}

closeOnBackdrop(taskModal, closeTaskModal);
closeOnBackdrop(classModal, closeClassModal);
closeOnBackdrop(profileModal, closeProfileModal);
closeOnBackdrop(corModal, closeCorModal);
closeOnBackdrop(noteModal, closeNoteModal);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeTaskModal();
    closeClassModal();
    closeProfileModal();
    closeCorModal();
    closeNoteModal();
  }
});

$("addTaskButton").addEventListener("click", openTaskModal);
$("addTaskTop").addEventListener("click", openTaskModal);
$("closeModal").addEventListener("click", closeTaskModal);
$("cancelModal").addEventListener("click", closeTaskModal);
$("addClassButton").addEventListener("click", () => openClassModal(null));
$("closeClassModal").addEventListener("click", closeClassModal);
$("cancelClassModal").addEventListener("click", closeClassModal);
$("editProfileButton").addEventListener("click", openProfileModal);
$("closeProfileModal").addEventListener("click", closeProfileModal);
$("cancelProfileModal").addEventListener("click", closeProfileModal);
$("importCorButton").addEventListener("click", openCorModal);
$("closeCorModal").addEventListener("click", closeCorModal);
$("cancelCorModal").addEventListener("click", closeCorModal);
$("addNoteButton").addEventListener("click", openNoteModal);
$("closeNoteModal").addEventListener("click", closeNoteModal);
$("cancelNoteModal").addEventListener("click", closeNoteModal);

document.querySelectorAll("#taskFilters .filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#taskFilters .filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    taskFilter = chip.dataset.filter;
    renderTasks();
  });
});

$("themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("studentHubDarkMode", document.body.classList.contains("dark"));
});

if (localStorage.getItem("studentHubDarkMode") === "true") {
  document.body.classList.add("dark");
}

$("menuToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
});

$("logoutButton").addEventListener("click", async () => {
  if (mode === "firebase") {
    await signOut(auth);
  } else {
    demoEndSession();
  }
  window.location.href = "login.html";
});

$("notificationButton").addEventListener("click", () => showToast("You're all caught up!"));

const jumpToProfile = () => { location.hash = "#/profile"; };
$("miniProfile").addEventListener("click", jumpToProfile);
$("topAvatarSlot").addEventListener("click", jumpToProfile);

const todayDate = new Date();
$("todayLabel").textContent = todayDate
  .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  .toUpperCase();

function renderAllSchedule() {
  renderDayTabs();
  renderSchedule();
  renderToday();
  renderCourseStrip();
  renderStats();
  renderProfileView();
}

/* ---------------- realtime bindings ---------------- */

function bindCollection(name, apply) {
  if (mode !== "firebase") return;
  const unsub = onSnapshot(collection(db, "users", uid, name), snapshot => {
    apply(snapshot.docs.map(d => ({ id: "cloud-" + d.id, ...d.data() })));
  }, error => console.error(`Firestore ${name}:`, error));
  unsubs.push(unsub);
}

/* ---------------- boot ---------------- */

function boot(user, seededProfile) {
  uid = user.uid;
  profile = { ...DEFAULT_PROFILE, ...(seededProfile || {}) };
  renderIdentity();
  if (mode === "firebase") {
    bindCollection("tasks", rows => {
      if (rows.length === 0 && tasks.length === 0) {
        DEFAULT_TASKS.forEach(t => addDoc(collection(db, "users", uid, "tasks"), t));
      }
      tasks = rows;
      renderTasks();
      renderStats();
    });
    bindCollection("classes", rows => {
      if (rows.length === 0 && classes.length === 0) {
        DEFAULT_CLASSES.forEach(c => addDoc(collection(db, "users", uid, "classes"), c));
      }
      classes = rows;
      renderAllSchedule();
    });
    bindCollection("announcements", rows => {
      personalNotes = rows;
      renderAnnouncements();
    });
  } else {
    seedLocal();
    renderIdentity();
  }
  renderAllSchedule();
  renderTasks();
  renderAnnouncements();
  demoBanner();
  showScreen(currentScreen());
}

async function start() {
  if (mode === "firebase") {
    const user = await new Promise(resolve => {
      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); }, () => { unsub(); resolve(null); });
    });
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    const seeded = await cloudInitProfile(user);
    boot(user, seeded);
  } else {
    const demoUser = demoUserFromSession();
    if (!demoUser) {
      window.location.href = "login.html";
      return;
    }
    // each demo account carries its own registered profile — no cross-user leakage
    const ownProfile = { name: demoUser.name, email: demoUser.email, ...(demoUser.profile || {}) };
    boot({ uid: "demo-" + demoUser.uid }, ownProfile);
  }
}

start();
