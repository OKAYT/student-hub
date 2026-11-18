/* StudentHub dashboard logic (index.html)
   - screen router (each sidebar item is its own page)
   - Firebase Auth guard + Firestore data when configured
   - localStorage demo fallback otherwise
   - editable profile + editable weekly schedule + tasks
   - COR importer: paste your Certificate of Registration lines
     and the schedule is built automatically (per user account) */

import { mode, auth, db } from "./firebase-init.js?v=11";
import { demoUserFromSession, demoEndSession } from "./demo-auth.js?v=11";

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
let reminders = [];
let sessions = [];
let weekView = false;

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
  reminders = lsRead("reminders", []);
  sessions = lsRead("sessions", []);
  lsWrite("classes", classes);
  lsWrite("tasks", tasks);
  lsWrite("announcements", personalNotes);
  lsWrite("reminders", reminders);
  lsWrite("sessions", sessions);
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

/* ---------------- date + subject color helpers ---------------- */

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
  const dow = new Date().getDay(); // JS: Sun=0
  const jsTarget = (DAY_ORDER.indexOf(dayName) + 1) % 7;
  return addDaysIso(todayStr(), (jsTarget - dow + 7) % 7);
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

/* Every course code keeps one stable color: saved on the class document
   (picked in the modal) or hashed deterministically from the course code. */
const TINTS = ["violet", "cyan", "amber", "rose", "green", "teal", "coral", "slate"];

function hashTint(title) {
  const key = (title || "").trim().toUpperCase();
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return TINTS[h % TINTS.length];
}

function courseTint(title) {
  const key = (title || "").trim().toUpperCase();
  if (!key) return "violet";
  const saved = classes.find(c => (c.title || "").trim().toUpperCase() === key && TINTS.includes(c.color));
  return saved ? saved.color : hashTint(key);
}

function tintClass(title) {
  return "tint-" + courseTint(title);
}

/* ---------------- router ---------------- */

const SCREENS = {
  overview: "Overview",
  schedule: "Schedule",
  tasks: "Tasks & Deadlines",
  reminders: "Reminders",
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
      <span class="tint-dot ${tintClass(c.title)}" aria-hidden="true"></span>
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
    chip.innerHTML = `<span class="tint-dot ${tintClass(c.title)}"></span> ${escapeHTML(c.title)} <small>${units.toFixed(1)} u</small>`;
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
      <span class="tint-dot ${tintClass(c.title)}" aria-hidden="true"></span>
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
    list.innerHTML = `<div class="empty-state">
      <span aria-hidden="true">🗒️</span>
      <strong>${taskFilter === "done" ? "No completed tasks yet" : taskFilter === "pending" ? "You're all caught up!" : "No tasks yet"}</strong>
      <p>Press <kbd>N</kbd> for a new task, or use quick-add above — try <em>"ESC 314 docs Fri 5pm"</em>.</p>
    </div>`;
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
      renderExamCards();
      showToast(task.done ? "Task marked as complete." : "Task marked as pending.");
    });

    const dot = document.createElement("span");
    dot.className = "tint-dot " + tintClass(task.course || "");
    dot.setAttribute("aria-hidden", "true");

    const main = document.createElement("div");
    main.className = "task-main";
    const title = document.createElement("strong");
    title.textContent = task.title;
    const course = document.createElement("small");
    course.textContent = task.course || "No subject";
    main.append(title, course);

    if (task.type === "exam") {
      const examChip = document.createElement("span");
      examChip.className = "task-exam-chip";
      examChip.textContent = "EXAM";
      main.append(examChip);
    }

    const due = document.createElement("span");
    due.className = "task-date";
    due.textContent = `Due ${fmtDate(task.due)}${task.dueTime ? " · " + fmtTime(task.dueTime) : ""}`;

    if (!task.done) {
      const focusBtn = document.createElement("button");
      focusBtn.className = "icon-ghost";
      focusBtn.title = "Start a focus session for this subject";
      focusBtn.textContent = "▶";
      focusBtn.addEventListener("click", () => startFocusForTask(task));
      row.append(focusBtn);
    }

    const del = document.createElement("button");
    del.className = "icon-ghost danger";
    del.title = "Delete task";
    del.textContent = "🗑";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete "${task.title}"?`)) return;
      await deleteTask(task);
      renderExamCards();
      showToast("Task deleted.");
    });

    row.append(checkbox, dot, main, due, del);
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
  const withColor = entries.map(entry => ({ ...entry, color: courseTint(entry.title) }));
  if (mode === "firebase") {
    for (const entry of withColor) {
      await addDoc(collection(db, "users", uid, "classes"), entry);
    }
  } else {
    withColor.forEach(entry => classes.push({ id: String(Date.now()) + Math.random().toString(36).slice(2, 6), ...entry }));
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

/* ---------------- persistence: reminders + focus sessions ---------------- */

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

async function recordSession(course, mins) {
  const entry = { course, minutes: mins, endedAt: Date.now() };
  if (mode === "firebase") {
    await addDoc(collection(db, "users", uid, "sessions"), entry);
  } else {
    sessions.unshift(entry);
    lsWrite("sessions", sessions);
  }
  renderFocusWeek();
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

/* ================================================================
   NEW FEATURES: briefing · week view · quick-add · focus timer
   reminders · exam countdown · .ics export · search · tour
   ================================================================ */

/* ---------------- Today briefing ---------------- */

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

function renderBriefing() {
  const box = $("briefing");
  if (!box) return;
  const day = todaysDay();
  const todayCount = classes.filter(c => c.days && c.days.includes(day)).length;
  const nMin = nowMinutes();
  const info = nextClassInfo();

  let nextHtml = "<strong>No more classes this week 🎉</strong><small>Enjoy the break — check your tasks instead.</small>";
  if (info) {
    const { cls, offset } = info;
    const startMin = minutes(cls.start);
    let when;
    if (offset === 0 && startMin <= nMin && minutes(cls.end) > nMin) when = "happening now";
    else if (offset === 0) when = countdownText(startMin - nMin);
    else when = offset === 1 ? "tomorrow" : DAY_FULL[info.day].slice(0, 3);
    nextHtml = `<strong>${escapeHTML(cls.title)}</strong><small>${when} · ${fmtTime(cls.start)}${cls.room ? " · " + escapeHTML(cls.room) : ""}</small>`;
  }

  const soon = tasks.filter(t => !t.done && isWithin48h(t.due));
  const soonLabels = soon.slice(0, 2).map(t => escapeHTML(t.title));
  const soonHtml = soon.length
    ? `<strong>${soon.length} due in 48 hours</strong><small>${soonLabels.join(" · ")}${soon.length > 2 ? " …" : ""}</small>`
    : "<strong>All clear 🌿</strong><small>Nothing due in the next 48 hours.</small>";

  box.innerHTML = `
    <div class="brief-seg"><span class="brief-ico">👋</span><div><small>${greeting()} — you have</small><strong>${todayCount} class${todayCount === 1 ? "" : "es"} today</strong></div></div>
    <div class="brief-seg"><span class="brief-ico">◷</span><div><small>Next up</small>${nextHtml}</div></div>
    <div class="brief-seg"><span class="brief-ico">⏳</span><div><small>Deadlines</small>${soonHtml}</div></div>`;
}

/* ---------------- Exam countdown cards ---------------- */

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
    const done = all.filter(x => x.done).length;
    const pct = all.length ? Math.round(done / all.length * 100) : 0;
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

/* ---------------- Week view (Mon–Sun time grid) ---------------- */

function renderWeekGrid() {
  const grid = $("weekGrid");
  if (!grid) return;
  const HOUR = 46;
  const list = classes.filter(c => c.days && c.days.length);
  let startH = 7, endH = 20;
  list.forEach(c => {
    startH = Math.min(startH, Math.floor(minutes(c.start) / 60));
    endH = Math.max(endH, Math.ceil(minutes(c.end) / 60));
  });
  endH = Math.min(24, Math.max(endH, startH + 6));
  const today = todaysDay();
  const dateNum = {};
  DAY_ORDER.forEach(d => { dateNum[d] = new Date(nextDateFor(d) + "T00:00:00").getDate(); });

  let html = '<div class="week-corner"></div>';
  DAY_ORDER.forEach(d => {
    html += `<div class="week-day${d === today ? " today" : ""}"><span>${d}</span><small>${dateNum[d]}</small></div>`;
  });
  html += '<div class="week-hours">';
  for (let h = startH; h < endH; h++) {
    html += `<span style="height:${HOUR}px">${fmtTime(String(h).padStart(2, "0") + ":00").replace(":00", "")}</span>`;
  }
  html += "</div>";

  DAY_ORDER.forEach(day => {
    const items = list.filter(c => c.days.includes(day)).sort((a, b) => minutes(a.start) - minutes(b.start));
    // simple lane assignment so overlapping classes sit side by side
    const laneEnds = [];
    const blocks = items.map(c => {
      let lane = laneEnds.findIndex(e => e <= minutes(c.start));
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(minutes(c.end)); }
      else laneEnds[lane] = minutes(c.end);
      return { c, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    html += `<div class="week-col${day === today ? " today" : ""}">`;
    blocks.forEach(({ c, lane }) => {
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

/* ---------------- Quick-add ---------------- */

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

/* ---------------- Focus timer (Pomodoro) ---------------- */

const FOCUS_LEN = { work: 25 * 60, break: 5 * 60 };
const RING_C = 2 * Math.PI * 52;
let focus = { phase: "work", remaining: FOCUS_LEN.work, running: false, timer: null, cycles: 0 };

function focusRender() {
  const timeEl = $("focusTime"), phaseEl = $("focusPhase"), ring = $("focusRing"), btn = $("focusStart");
  if (!timeEl) return;
  const m = Math.floor(focus.remaining / 60), s = focus.remaining % 60;
  timeEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  phaseEl.textContent = focus.phase === "work" ? "Focus" : "Break";
  const dial = $("focusDial");
  if (dial) dial.classList.toggle("is-break", focus.phase === "break");
  if (ring) ring.style.strokeDashoffset = String(RING_C * (1 - focus.remaining / FOCUS_LEN[focus.phase]));
  btn.textContent = focus.running ? "Pause" : focus.phase === "work" ? "Start focus" : "Start break";
}

function startFocusTick() {
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
  const course = ($("focusCourse") && $("focusCourse").value) || "General study";
  if (focus.phase === "work") {
    recordSession(course, 25);
    focus.cycles++;
    focus.phase = "break";
    focus.remaining = FOCUS_LEN.break;
    notifyDesktop("Focus session done 🎉", "Take a 5-minute break — you earned it.");
    showToast("25 minutes logged for " + course + " — take a break!");
  } else {
    focus.phase = "work";
    focus.remaining = FOCUS_LEN.work;
    notifyDesktop("Break over", "Ready for another 25-minute focus session?");
    showToast("Break over — ready when you are.");
  }
  focusRender();
  renderFocusWeek();
}

function focusReset() {
  stopFocusTick();
  focus.phase = "work";
  focus.remaining = FOCUS_LEN.work;
  focusRender();
}

function startFocusForTask(task) {
  location.hash = "#/tasks";
  const sel = $("focusCourse");
  if (sel && [...sel.options].some(o => o.value === task.course)) sel.value = task.course;
  focusReset();
  startFocusTick();
  showToast("Focus started for " + task.course + " ▶");
}

function renderFocusCourseOptions() {
  const sel = $("focusCourse");
  if (!sel) return;
  const seen = new Set();
  const titles = [];
  classes.forEach(c => {
    const key = c.title.trim().toUpperCase();
    if (!seen.has(key)) { seen.add(key); titles.push(c.title.trim()); }
  });
  if (titles.length === 0) titles.push("General study");
  sel.innerHTML = titles.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join("");
}

function renderFocusWeek() {
  const box = $("focusWeek");
  if (!box) return;
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  const totals = {};
  sessions.filter(s => (s.endedAt || 0) >= weekStart.getTime())
    .forEach(s => { totals[s.course] = (totals[s.course] || 0) + (Number(s.minutes) || 0); });
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (rows.length === 0) {
    box.innerHTML = '<p class="muted focus-empty">No focus minutes logged this week yet — start a session!</p>';
    return;
  }
  const max = rows[0][1];
  box.innerHTML = rows.map(([course, m]) => `
    <div class="focus-week-row">
      <span class="tint-dot ${tintClass(course)}"></span>
      <span class="fw-course">${escapeHTML(course)}</span>
      <span class="fw-bar"><i class="${tintClass(course)}" style="width:${Math.round(m / max * 100)}%"></i></span>
      <b>${m}m</b>
    </div>`).join("");
}

/* ---------------- Desktop notifications ---------------- */

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
  if (!("Notification" in window)) { note.textContent = "This browser doesn't support system notifications — you'll get in-app alerts."; return; }
  note.textContent = Notification.permission === "granted"
    ? "✅ System notifications are on — you'll be alerted even on another tab."
    : Notification.permission === "denied"
      ? "🔕 Notifications are blocked in your browser — reminders will show as in-app alerts instead."
      : "💡 When you save your first reminder, we'll ask permission to show system notifications.";
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

/* ---------------- Reminder checker (every minute) ---------------- */

function checkReminders() {
  const now = new Date();
  const dayKey = now.toDateString();
  const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nowIso = `${todayStr(now)}T${nowHm}`;
  reminders.forEach(rem => {
    let due = false;
    if (rem.weekly) {
      due = Number(rem.weekday) === now.getDay() && nowHm >= rem.time && rem.lastFiredDay !== dayKey;
    } else {
      due = !rem.fired && `${rem.date}T${rem.time}` <= nowIso;
    }
    if (!due) return;
    if (mode === "firebase" && String(rem.id).startsWith("cloud-")) {
      updateDoc(doc(db, "users", uid, "reminders", cloudId(rem.id)),
        rem.weekly ? { lastFiredDay: dayKey } : { fired: true }).catch(() => {});
    } else {
      if (rem.weekly) rem.lastFiredDay = dayKey; else rem.fired = true;
      lsWrite("reminders", reminders);
    }
    const body = rem.title + (rem.refTitle ? " — " + rem.refTitle : "");
    notifyDesktop("⏰ StudentHub reminder", body);
    showToast("⏰ " + body);
  });
}

/* ---------------- Reminders UI ---------------- */

const reminderModal = $("reminderModal");
const reminderForm = $("reminderForm");

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
  reminderForm.reset();
  $("remDate").value = todayStr();
  $("remTime").value = "17:00";
  updatePermissionNote();
  reminderModal.classList.add("show");
  reminderModal.setAttribute("aria-hidden", "false");
  $("remTitle").focus();
}

function closeReminderModal() {
  reminderModal.classList.remove("show");
  reminderModal.setAttribute("aria-hidden", "true");
  reminderForm.reset();
}

$("remLink").addEventListener("change", () => {
  const v = $("remLink").value;
  if (!v) return;
  const [kind, ...rest] = v.split(":");
  const val = rest.join(":");
  if (kind === "class") {
    const first = classes.find(c => c.title.trim().toUpperCase() === val.trim().toUpperCase());
    if (first) {
      $("remTitle").value = `${first.title} class starts soon`;
      $("remDate").value = nextDateFor((first.days || [])[0] || todaysDay());
      $("remTime").value = first.start;
    }
  } else if (kind === "task") {
    const task = tasks.find(t => String(t.id) === val);
    if (task) {
      $("remTitle").value = `Task due: ${task.title}`;
      $("remDate").value = task.due || todayStr();
    }
  }
});

reminderForm.addEventListener("submit", async event => {
  event.preventDefault();
  const date = $("remDate").value;
  const time = $("remTime").value;
  const title = $("remTitle").value.trim();
  if (!title || !date || !time) return;
  const link = $("remLink").value;
  const [kind, ...rest] = link ? link.split(":") : [];
  const refTitle = link ? rest.join(":") : "";
  const weekly = $("remWeekly").checked;
  await ensureNotificationPermission();
  await createReminder({
    title,
    refType: link ? kind : "",
    refTitle: link ? refTitle : "",
    date,
    time,
    weekly,
    weekday: weekly ? new Date(date + "T00:00:00").getDay() : null
  });
  closeReminderModal();
  showToast("Reminder saved ⏰");
});

function renderReminders() {
  const list = $("reminderList");
  if (!list) return;
  list.innerHTML = "";
  if (reminders.length === 0) {
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
  sorted.forEach(rem => {
    const when = rem.weekly
      ? `Every ${dayNames[Number(rem.weekday)] || "week"} · ${fmtTime(rem.time)}`
      : `${fmtDate(rem.date)} · ${fmtTime(rem.time)}${rem.fired ? " · done" : ""}`;
    const row = document.createElement("div");
    row.className = "reminder-row" + (rem.weekly ? " weekly" : "");
    row.innerHTML = `
      <span class="rem-ico" aria-hidden="true">${rem.weekly ? "🔁" : "⏰"}</span>
      <div class="rem-main">
        <strong>${escapeHTML(rem.title)}</strong>
        <small>${rem.refTitle ? escapeHTML(rem.refTitle) + " · " : ""}${when}</small>
      </div>
      <button class="icon-ghost danger" title="Delete reminder" aria-label="Delete reminder">🗑</button>`;
    row.querySelector("button").addEventListener("click", () => deleteReminder(rem));
    list.appendChild(row);
  });
}

/* ---------------- Export weekly schedule as .ics ---------------- */

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

/* ---------------- Search overlay (press /) ---------------- */

let searchHits = [];

function openSearch() {
  const overlay = $("searchOverlay");
  overlay.hidden = false;
  $("searchInput").value = "";
  renderSearchResults("");
  $("searchInput").focus();
}

function closeSearch() {
  $("searchOverlay").hidden = true;
}

function renderSearchResults(q) {
  const ql = q.trim().toLowerCase();
  const res = [];
  if (ql) {
    tasks.forEach(t => {
      if ((t.title + " " + (t.course || "")).toLowerCase().includes(ql)) {
        res.push({ icon: t.type === "exam" ? "📝" : "☑", label: t.title, sub: `Task · ${t.course || "no subject"} · due ${fmtDate(t.due)}`, go: "#/tasks" });
      }
    });
    const seen = new Set();
    classes.forEach(c => {
      const key = (c.title || "").trim().toUpperCase();
      if (seen.has(key) || !key.toLowerCase().includes(ql)) return;
      seen.add(key);
      res.push({ icon: "◷", label: c.title, sub: `${(c.days || []).map(d => d.slice(0, 3)).join(" · ")} · ${fmtTime(c.start)} · ${c.room || "no room"}`, go: "#/schedule" });
    });
    [...personalNotes.map(n => ({ ...n })), ...SCHOOL_ANNOUNCEMENTS].forEach(n => {
      if (((n.title || "") + " " + (n.body || "")).toLowerCase().includes(ql)) {
        res.push({ icon: "♧", label: n.title, sub: "Announcement", go: "#/announcements" });
      }
    });
    reminders.forEach(r => {
      if ((r.title || "").toLowerCase().includes(ql)) {
        res.push({ icon: "⏰", label: r.title, sub: "Reminder", go: "#/reminders" });
      }
    });
  }
  searchHits = res.slice(0, 8);
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

/* ---------------- First-login welcome tour ---------------- */

const TOUR = [
  { t: "Welcome to StudentHub 👋", b: "This is your daily planner: schedule, tasks, reminders and a focus timer in one place. A 30-second tour — let's go." },
  { t: "Set up in 30 seconds 📸", b: "Open Schedule → \"Import from COR\". Take one photo of your Certificate of Registration and your whole weekly schedule builds itself — no typing." },
  { t: "Quick-add tasks ⚡", b: "On the Tasks screen, type things like \"ESC 314 docs Fri 5pm\". StudentHub works out the subject, day and time — press Enter and it's saved." },
  { t: "Week view & subject colors 🗓", b: "Schedule has a Day and a Week view. Every subject keeps its own stable color across the whole app so you can spot it at a glance." },
  { t: "Stay ahead ⏰", b: "Set Reminders with real notifications, start a Focus timer from any task, and press N for a new task or / to search everything." }
];
let tourStep = 0;

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

function renderOnboarding() {
  const card = $("onboardingCard");
  if (card) card.hidden = classes.length > 0;
}

/* ---------------- schedule modal ---------------- */

const classModal = $("classModal");
const classForm = $("classForm");
let editingClass = null;
let pickedTint = null;

function buildTintPicker(selected) {
  const box = $("tintPicker");
  box.innerHTML = "";
  pickedTint = selected || null;
  TINTS.forEach(name => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tint-swatch tint-" + name + (selected === name ? " picked" : "");
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
  const type = $("taskIsExam").checked ? "exam" : "task";
  await createTask({ title, course, due, type });
  closeTaskModal();
  renderExamCards();
  showToast(type === "exam" ? "Exam added — countdown is on your Overview 📝" : "Your new task has been added.");
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
closeOnBackdrop(reminderModal, closeReminderModal);

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
  // shortcuts: N = new task, / = search (ignored while typing)
  const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]");
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "/") {
    event.preventDefault();
    openSearch();
  } else if (event.key === "n" || event.key === "N") {
    event.preventDefault();
    openTaskModal();
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
$("addReminderButton").addEventListener("click", openReminderModal);
$("closeReminderModal").addEventListener("click", closeReminderModal);
$("cancelReminderModal").addEventListener("click", closeReminderModal);

/* new feature wiring */
$("exportIcsButton").addEventListener("click", exportIcs);
$("permButton").addEventListener("click", ensureNotificationPermission);

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

$("quickAddInput").addEventListener("input", renderQuickAddPreview);
$("quickAddInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && qaParsed) {
    event.preventDefault();
    saveQuickAdd();
  }
});

$("focusStart").addEventListener("click", () => (focus.running ? stopFocusTick() : startFocusTick()));
$("focusReset").addEventListener("click", focusReset);

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

$("tourSkip").addEventListener("click", endTour);
$("tourBack").addEventListener("click", () => { if (tourStep > 0) { tourStep--; tourRender(); } });
$("tourNext").addEventListener("click", () => {
  if (tourStep < TOUR.length - 1) { tourStep++; tourRender(); }
  else endTour();
});

$("onboardImport").addEventListener("click", () => { openCorModal(); });
$("onboardManual").addEventListener("click", () => { openClassModal(null); });

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

$("notificationButton").addEventListener("click", () => { location.hash = "#/reminders"; });

const jumpToProfile = () => { location.hash = "#/profile"; };
$("miniProfile").addEventListener("click", jumpToProfile);
$("topAvatarSlot").addEventListener("click", jumpToProfile);

const todayDate = new Date();
$("todayLabel").textContent = todayDate
  .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  .toUpperCase();

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
      renderExamCards();
    });
    bindCollection("classes", rows => {
      if (rows.length === 0 && classes.length === 0) {
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
  } else {
    seedLocal();
    renderIdentity();
  }
  renderAllSchedule();
  renderTasks();
  renderAnnouncements();
  renderReminders();
  renderFocusWeek();
  renderFocusCourseOptions();
  focusRender();
  updatePermissionChip();
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
