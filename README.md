# 🥋 Taekwondo Championship Management System

> A full-featured web application for managing **Karnataka State Taekwondo Championships** — from player registration and bracket generation to live match scoring and result exports.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [User Roles](#user-roles)
- [Modules](#modules)
- [Firebase Configuration](#firebase-configuration)
- [Deployment](#deployment)
- [License](#license)

---

## Overview

The **Taekwondo Championship Management System** is a web-based platform designed for the **Karnataka Taekwondo Association** to streamline the end-to-end management of taekwondo tournaments. It supports multi-role authentication (Admin, Judge, Team), dynamic player registration, automatic bracket generation with smart opponent matching, live match management across multiple courts, and championship standings & medal tracking.

The application is hosted on **Firebase Hosting** and uses **Firebase Realtime Database** for real-time data synchronization, **Firebase Authentication** for admin/judge login, and **Firebase Storage** for media uploads.

---

## Features

### 🔐 Authentication & Authorization
- **Admin/Judge Login** — Firebase email/password authentication
- **Team Login** — Username/password-based login with team-specific database lookup
- **Role-based Access Control** — Pages are protected based on user roles (`admin`, `judge`, `team`)
- **Session Management** — Uses `sessionStorage` for fast role checks and page protection

### 📝 Player Registration
- **Dynamic Form Builder** — Admin-configurable registration forms fetched from Firebase
- **Camera/Photo Upload** — In-app camera capture or file upload with automatic image compression
- **Auto-Categorization** — Players are automatically categorized by:
  - Gender
  - Age group (auto-calculated from date of birth)
  - Weight class
- **Registration Deadlines** — Admin can set deadlines and hard-close registration
- **Edit & Update** — Teams can edit previously registered player data

### 🏆 Tournament Bracket System
- **Single-elimination brackets** with automatic generation
- **Smart Opponent Matching** — Prevents same-team players from meeting in early rounds
- **Multi-court Sync** — Real-time bracket updates across multiple courts/devices
- **Live Match Management** — Start matches, select winners, and advance players through rounds
- **Match History** — Complete log of all match results
- **PDF Export** — Download bracket fixtures as formatted PDF documents
- **Excel Export** — Export category results to Excel spreadsheets

### 📊 Championship Management
- **Create & Manage Championships** — Full CRUD for championship events
- **Weight Categories** — Admin-configurable weight categories by gender and age group
- **Standings & Rankings** — Automatic ranking derivation (1st, 2nd, 3rd from bracket results)
- **Medal Tracking** — Gold, Silver, Bronze medal assignment and tracking
- **Championship History** — Archival of past championship data

### 🖥️ Admin Dashboard
- **Overview Panel** — Quick stats and status of the current championship
- **Form Preview** — Preview the registration form as teams would see it
- **Category Editor** — Manage and edit player categories
- **Live Match View** — Monitor and manage live matches across all categories

### 👥 Team Dashboard
- **Player Management** — View, edit, and register players for the team
- **Registration Status** — Track registration status for each player

### ⚡ Performance & Offline
- **Service Worker** — Offline support and fast page loads via caching
- **Performance Cache** — In-memory caching layer for frequently accessed data
- **Connection Monitoring** — Offline/online banner with automatic reconnection
- **Firebase Preconnect** — DNS prefetch and preconnect for faster initial load

---

## Tech Stack

| Layer          | Technology                                           |
| -------------- | ---------------------------------------------------- |
| **Frontend**   | HTML5, CSS3, Vanilla JavaScript (ES Modules)         |
| **Backend**    | Firebase Realtime Database (serverless)              |
| **Auth**       | Firebase Authentication (Email/Password)             |
| **Storage**    | Firebase Storage (images), Base64 inline (compressed)|
| **Hosting**    | Firebase Hosting                                     |
| **PDF Export** | jsPDF (client-side PDF generation)                   |
| **Excel Export**| SheetJS / xlsx (client-side Excel generation)       |
| **PWA**        | Service Worker for offline caching                   |

---

## Project Structure

```
taekwondo-championship/
├── .firebase/                  # Firebase cache (auto-generated)
├── .firebaserc                 # Firebase project alias config
├── firebase.json               # Firebase Hosting configuration
├── firebase-rules.json         # Firebase Realtime Database security rules
├── README.md                   # Project documentation
│
└── public/                     # Hosted static files
    ├── index.html              # Login page (Admin/Judge & Team tabs)
    ├── register.html           # Player registration form
    │
    ├── admin/                  # Admin & Judge pages
    │   ├── dashboard.html      # Admin dashboard (main control panel)
    │   ├── bracket.html        # Tournament bracket view & management
    │   ├── championships.html  # Championship CRUD management
    │   ├── form-preview.html   # Registration form preview
    │   ├── Live-matches.html   # Live match monitoring
    │   ├── standings.html      # Championship standings & rankings
    │   └── weight-categories.html  # Weight category configuration
    │
    ├── team/                   # Team pages
    │   └── dashboard.html      # Team dashboard (player management)
    │
    ├── assets/
    │   ├── css/
    │   │   └── main.css        # Global stylesheet
    │   └── images/             # Static images (logos, backgrounds)
    │
    └── js/                     # JavaScript modules
        ├── firebase.js         # Firebase SDK initialization & global exports
        ├── auth.js             # Authentication manager (login, roles, guards)
        ├── ui.js               # UI utilities (loading, toasts, modals)
        ├── modal.js            # Modal dialog component
        ├── registration.js     # Player registration form logic
        ├── bracket.js          # Tournament bracket & match engine
        ├── championship-manager.js  # Championship CRUD operations
        ├── category-logic.js   # Age/weight category determination
        ├── form-config.js      # Dynamic form configuration loader
        ├── admin-form-editor.js     # Admin form builder
        ├── admin-category-editor.js # Admin category editor
        ├── Team-deadline-manager.js # Registration deadline handling
        ├── custom-select.js    # Custom dropdown select component
        ├── performance-cache.js # In-memory caching layer
        └── service-worker.js   # PWA service worker for offline support
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16+ recommended) — only needed for Firebase CLI
- [Firebase CLI](https://firebase.google.com/docs/cli) — for deployment

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/taekwondo-championship.git
   cd taekwondo-championship
   ```

2. **Install Firebase CLI** (if not already installed)
   ```bash
   npm install -g firebase-tools
   ```

3. **Login to Firebase**
   ```bash
   firebase login
   ```

4. **Serve locally**
   ```bash
   firebase serve
   ```
   The app will be available at `http://localhost:5000`.

> **Note:** Since this is a purely static site (no `npm install` needed), you can also open the `public/` folder via any static file server (e.g., VS Code Live Server extension).

---

## User Roles

| Role      | Access Level                                                                 |
| --------- | ---------------------------------------------------------------------------- |
| **Admin** | Full access — manage championships, brackets, categories, forms, teams, matches |
| **Judge** | Match management — start matches, declare winners, update brackets & standings |
| **Team**  | Player registration — register/edit players, view team dashboard             |

### Login Credentials

- **Admin/Judge**: Log in via the **Admin/Judge** tab on the login page using Firebase Auth email & password.
- **Team**: Log in via the **Team** tab using the assigned team username & password (stored in the `teams` node of the database).

---

## Modules

### `firebase.js`
Initializes Firebase SDK v11 (modular imports via CDN), sets up the Realtime Database, Auth, and Storage services. Includes connection monitoring (offline/online banners) and service worker registration.

### `auth.js`
Manages authentication state, role-based page protection, admin/team login flows, and session storage. Provides `AUTH_MANAGER` globally with methods like `loginAdmin()`, `loginTeam()`, `logout()`, `requireRole()`.

### `bracket.js`
The tournament engine — handles single-elimination bracket generation with smart seeding (avoids same-team early matchups), real-time match progression, multi-court synchronization, bracket rendering, PDF fixture downloads, and Excel result exports.

### `registration.js`
Dynamic player registration form — loads form structure from Firebase, handles photo capture/upload with compression, auto-calculates age categories from DOB, determines weight classes, and submits player data with validation.

### `championship-manager.js`
Full CRUD operations for championship events, including creation, editing, deletion, and championship history archival.

### `category-logic.js`
Logic for determining a player's category based on age, gender, and weight. Maps players to the correct weight division based on admin-configured categories.

### `ui.js`
Shared UI utilities — loading overlays, toast notifications, modal dialogs, and common DOM helpers used across all pages.

### `performance-cache.js`
In-memory caching layer that stores frequently accessed Firebase queries to reduce redundant reads and improve page responsiveness.

### `service-worker.js`
Progressive Web App (PWA) service worker that caches static assets for offline access and provides faster subsequent page loads.

---

## Firebase Configuration

### Database Structure

```
├── users/              # User profiles & roles
├── teams/              # Team accounts (username, password, details)
├── players/            # Registered player data
├── brackets/           # Tournament brackets (by category)
├── matchResults/       # Individual match outcomes
├── matchHistory/       # Historical match log
├── currentMatch/       # Currently active match state
├── championships/      # Championship events & metadata
│   └── {id}/
│       ├── categories/
│       ├── participants/
│       ├── standings/
│       ├── medals/
│       └── matches/
├── championshipSettings/   # Scoring rules & point system
├── championshipHistory/    # Archived championship data
├── overallStandings/       # Cross-championship rankings
├── categoryResults/        # Results per category
├── weightCategories/       # Admin-configured weight divisions
└── formConfig/             # Dynamic form field configuration
```

### Security Rules

Security rules are defined in `firebase-rules.json` and enforce:
- **Public read** for players, brackets, and weight categories
- **Authenticated write** for match results (admin + judge)
- **Admin-only write** for championships, forms, categories, and team management
- **Team-scoped access** for player registration and team data

---

## Deployment

Deploy to Firebase Hosting with a single command:

```bash
firebase deploy
```

To deploy only hosting (without rules):
```bash
firebase deploy --only hosting
```

To deploy only database rules:
```bash
firebase deploy --only database
```

The production site is available at:
`https://taekowndo-championship.web.app`

---

## License

© Karnataka Taekwondo Association. All rights reserved.