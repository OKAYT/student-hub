# StudentHub — Student Dashboard

A responsive student dashboard with **real accounts, a backend, and editable data**, built with HTML, CSS, and vanilla JavaScript (Firebase JS SDK via CDN — no build tools needed).

## What's new in this version
- 🔐 **Login & registration page** (`login.html`) — real accounts with Firebase Authentication
- 🧑‍🎓 **Student profile** — starts with a sample profile (editable): name, student ID, program, year, photo and semester
- 🖥 **Separate portals** — each sidebar item opens its own full screen: Overview, Schedule, Tasks & Deadlines, Announcements, My Profile (hash routing: `#/schedule`, `#/tasks`, …)
- 🗓 **Editable class schedule** — day tabs with add/edit/delete; "Today's Classes" redesigned as clean rows with an "Up next" marker
- 📥 **COR importer** — paste your Certificate of Registration lines (e.g. `1261275 ESC 311 3.0 5:00 PM 6:00 PM MWF MB-306`) and the system auto-builds your schedule: course code, units, times, days and room. Skips duplicates, warns about unreadable lines. Every account gets its **own** schedule
- ☁️ **Firebase backend** — profile, classes, tasks, and personal notes sync to **Cloud Firestore** per logged-in user
- 📝 **Announcements portal** — school-wide updates plus your own personal notes (stored per account)
- ✅ **Tasks portal** — filter All / Pending / Completed, delete tasks, live pending counters
- 🎨 **UI refresh** — new login screen, portal quick-access cards, dark mode kept, mobile friendly
- 🧪 **Demo mode** — if Firebase isn't configured yet, the app still works end-to-end using browser localStorage

## How to run (VS Code)
1. Open the `student_dashboard` folder in Visual Studio Code.
2. Install the **Live Server** extension (recommended — Firebase Auth needs `localhost`/HTTP, not `file://`).
3. Right-click `login.html` → **Open with Live Server** (the app starts at the login page).
4. Register an account, and you'll land on the dashboard.

## Connect Firebase (10 minutes)
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (e.g. `student-hub`).
2. **Authentication** → Get started → **Email/Password** → Enable.
3. **Build → Firestore Database** → Create database → Production mode → pick a region.
4. **Project settings** (gear) → **Your apps** → Web `</>` → register app → copy the config object.
5. Paste the values into **`js/firebase-config.js`** (replace the `PASTE_...` placeholders).
6. **Firestore → Rules** tab → replace with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

7. Reload the app. The badge on the login page should say **"Firebase connected"**. Your data now syncs across devices/browsers.

> The Firebase web config is public by design — security comes from the rules above, which only let signed-in users read/write **their own** documents.

## Firestore data layout
```
users/{uid}                         → profile: name, studentId, program, year, photoURL, semester
users/{uid}/classes/{classId}       → { title, units, room, start, end, days: ["Mon","Wed",…] }
users/{uid}/tasks/{taskId}          → { title, course, due, done }
users/{uid}/announcements/{noteId}  → { title, body, tag, ts }   (personal notes)
```
Each account has its own schedule, tasks and notes — importing a COR only affects that user.

## Running it
Open `index.html` directly, or serve the folder for testing. For development use the included no-cache server so code edits show up on a plain refresh:

```
python serve.py        # serves on http://127.0.0.1:8741 with Cache-Control: no-store
```

(A plain `python -m http.server` also works, but the browser may keep serving stale cached files until a hard refresh.)

## COR importer
On the **Schedule** screen → **📥 Import from COR**. Three ways to bring your schedule in:

1. **Paste text** — one subject per line:
```
1261275  ESC 311  3.0  5:00 PM  6:00 PM  MWF  MB-306
1261268  GE JRIZ  3.0  9:00 AM  10:00 AM  MWF  MB-205
```
2. **Upload a photo** (JPG/PNG) of your COR — the browser reads it with on-device OCR (Tesseract.js, downloaded once, no server, works offline after first use). Works best with a flat, straight-on, well-lit photo of just the class table.
3. **Upload a PDF** — digital COR PDFs with selectable text are read almost perfectly (PDF.js). Scanned PDFs fall back to OCR automatically.

In all cases you get a **live preview before anything is saved**: correct the garbled lines in the textarea, or edit them in the schedule afterwards. Unreadable lines are reported as warnings, exact duplicates are skipped.

The parser reads: course code (title), units, start/end times (AM/PM), day codes (MWF, TTH, MW, S, SU, MTWTH…), and room (`XX-000`).

## Sample schedule (seeded, then editable in-app)
Every new account starts with this sample schedule so the dashboard isn't empty — open the **Schedule** tab and edit/import your real one:

| Course | Days | Time | Room | Units |
|---|---|---|---|---|
| ESC 311 | MWF | 5:00–6:00 PM | MB-306 | 3.0 |
| ESC 312 (lab) | MWF | 1:00–2:00 PM | MB-207 | 1.0 |
| ESC 312 (lec) | TTH | 1:00–2:00 PM | MB-212 | 2.0 |
| ESC 312 | SUN | 12:00–3:00 PM | MB-205 | 1.0 |
| ESC 313 | SAT | 10:00 AM–12:00 PM | MB-212 | 1.0 |
| ESC 313 | MW | 10:00–11:00 AM | MB-212 | 2.0 |
| ESC 314 | TTH | 11:30 AM–1:00 PM | MB-205 | 2.0 |
| ESC 314 (lab) | TTH | 5:30–7:00 PM | MB-208 | 1.0 |
| GE JRIZ | MWF | 9:00–10:00 AM | MB-205 | 3.0 |
| PSC 311 (lec) | TTH | 9:00–10:00 AM | MB-212 | 1.0 |
| PSC 311 (lab) | TTH | 4:00–5:30 PM | MB-207 | 2.0 |
| PSC 312 | MW | 2:00–3:00 PM | MB-212 | 1.0 |
| PSC 312 | TTH | 3:00–4:00 PM | MB-212 | 2.0 |

Total: **21 units** (sample total — edit freely).

## Customize
- Your photo: replace `img/avatar.svg` with your own image, or set a photo URL in **My Profile → Edit** (a local path like `img/myphoto.jpg` works too).
- Seed data: `js/app.js` → `DEFAULT_PROFILE`, `DEFAULT_CLASSES`, `DEFAULT_TASKS`.
- Colors/spacing: `css/style.css` (CSS variables at the top).

## File structure
```
index.html          → dashboard (profile, schedule, tasks)
login.html          → login + registration
css/style.css       → all styles (incl. dark mode)
js/firebase-config.js → paste your Firebase keys HERE
js/firebase-init.js   → Firebase bootstrap (requests CDN SDK)
js/auth.js            → login/register logic
js/demo-auth.js       → offline demo accounts (localStorage)
js/app.js             → dashboard logic + Firestore sync
img/avatar.svg        → default avatar
```

## Notes
- Demo mode stores data **per browser** — clear it via DevTools → Application → Local Storage.
- To reset a Firestore user's data, delete the `users/{uid}` document in the Firebase console; the app re-seeds defaults on next load.
- Attendance and study-hours stats were removed since there was no real data source for them — the new cards (enrolled courses, total units, weekly meetings, pending tasks) are **computed live** from your actual schedule.
