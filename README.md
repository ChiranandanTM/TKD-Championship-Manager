# TKD Championship Manager

Web application for end-to-end Taekwondo championship operations: team registration, auto category mapping, bracket management, live matches, standings, and championship archival.

Live URL: https://taekowndo-championship.web.app

## Highlights

- Multi-role access: admin, judge, team
- Team login with username/password and admin/judge login with Firebase Auth email/password
- Dynamic registration form managed by admin
- Auto age category from DOB (Mini, Sub-Junior, Cadet, Junior, Senior)
- Auto weight category from gender + age category + weight
- Team registration deadline and hard-close controls
- Bracket progression with live status tracking
- Export options from bracket screen:
   - PDF fixtures
   - Excel results
- Team dashboard filters:
   - Medal filter
   - Age category dropdown filter
- Championship archive/restore and history management
- Service worker and caching optimizations for faster repeat loads

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript (ES modules)
- Backend: Firebase Realtime Database
- Auth: Firebase Authentication
- Storage: Firebase Storage
- Hosting: Firebase Hosting
- Client libraries: jsPDF, SheetJS (xlsx)

## Repository Structure

```text
.
├── firebase.json
├── firebase-rules.json
├── PERFORMANCE_OPTIMIZATIONS.md
├── README.md
├── functions/                    # currently empty
└── public/
      ├── index.html               # login page
      ├── register.html            # team player registration page
      ├── admin/
      │   ├── dashboard.html
      │   ├── bracket.html
      │   ├── championships.html
      │   ├── form-preview.html
      │   ├── Live-matches.html
      │   ├── standings.html
      │   └── weight-categories.html
      ├── team/
      │   └── dashboard.html
      ├── assets/
      │   ├── css/main.css
      │   └── images/
      └── js/
            ├── firebase.js
            ├── auth.js
            ├── ui.js
            ├── modal.js
            ├── registration.js
            ├── bracket.js
            ├── championship-manager.js
            ├── category-logic.js
            ├── form-config.js
            ├── admin-form-editor.js
            ├── admin-category-editor.js
            ├── player-manager.js
            ├── Team-deadline-manager.js
            ├── custom-select.js
            ├── performance-cache.js
            └── service-worker.js
```

## Core Data Nodes (Realtime Database)

- users
- teams
- players
- brackets
- currentMatch
- matchResults
- matchHistory
- championships
- championshipHistory
- championshipSettings
- overallStandings
- categoryResults
- weightCategories
- formConfig

## Local Setup

### 1) Prerequisites

- Node.js 18+
- Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 2) Clone

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd "TKD Championship Manager"
```

### 3) Use your Firebase project

```bash
firebase use --add
```

### 4) Configure Firebase project keys

This project currently has Firebase config in two places:

- public/js/firebase.js (SDK v11 modules)
- public/index.html (inline login bootstrap uses SDK v9)

Update both with your own Firebase project credentials.

### 5) Run locally

```bash
firebase emulators:start --only hosting,database
```

Or:

```bash
firebase serve
```

Default local URL is usually http://localhost:5000.

## First-Time Role Bootstrapping

To sign in as admin/judge, a Firebase Auth account must exist and its UID must map to a role in users.

Recommended initial setup:

1. Create an email/password user in Firebase Authentication.
2. Copy that user UID.
3. Add this in Realtime Database:

```json
{
   "users": {
      "<AUTH_UID>": {
         "role": "admin"
      }
   }
}
```

After admin login, use Admin Dashboard to create team accounts.

## Deployment

Deploy hosting + database rules:

```bash
firebase deploy
```

Deploy only hosting:

```bash
firebase deploy --only hosting
```

Deploy only database rules:

```bash
firebase deploy --only database
```

## Security Note

Current database rules include permissive write access in some nodes (for example players has open writes). This may be acceptable for controlled event operations, but before public production rollout you should harden and least-privilege all write paths.

Rules file: firebase-rules.json

## Operational Notes

- Team registration can be blocked by:
   - registrationClosed flag
   - registrationDeadline date
- Admin new-championship flow archives current data and clears active players/teams/brackets/matches.
- Team dashboard supports medal and age-category filtering for faster roster management.

## Credits

- Built and developed by Chiranandan T M
- Co-supporter: Sharan B N
