# Role-Based Access Control (RBAC) Documentation
## Taekwondo Championship Management Platform

---

**Document Version:** 1.0.0
**Last Updated:** 2026-05-26
**Classification:** Internal — Development & Security Architecture
**Maintainer:** Platform Administrator

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Role Hierarchy](#2-role-hierarchy)
3. [Permission Matrix](#3-permission-matrix)
4. [Role Definitions](#4-role-definitions)
   - 4.1 [Super Admin](#41-super-admin)
   - 4.2 [Admin](#42-admin)
   - 4.3 [Tournament Organizer](#43-tournament-organizer)
   - 4.4 [Team Coach](#44-team-coach)
   - 4.5 [Athlete / Player](#45-athlete--player)
   - 4.6 [Referee](#46-referee)
   - 4.7 [Technical Official](#47-technical-official)
   - 4.8 [Registration Manager](#48-registration-manager)
   - 4.9 [Media Manager](#49-media-manager)
   - 4.10 [Spectator / Public User](#410-spectator--public-user)
5. [Firebase Security Architecture](#5-firebase-security-architecture)
6. [Authentication Architecture](#6-authentication-architecture)
7. [API Authorization Architecture](#7-api-authorization-architecture)
8. [Protected Route Architecture](#8-protected-route-architecture)
9. [Audit Logging & Activity Tracking](#9-audit-logging--activity-tracking)
10. [Recommended RBAC Schema](#10-recommended-rbac-schema)
11. [Security Best Practices](#11-security-best-practices)

---

## 1. System Overview

The **Taekwondo Championship Management Platform** is an enterprise-grade web application built to manage the full lifecycle of Taekwondo championships — from athlete registration and team management through bracket generation, match scheduling, venue assignment, and public result broadcasting.

### Platform Modules

| Module | Description |
|---|---|
| Tournament Management | Create, configure, and manage championships and events |
| Athlete Registration | Register athletes into weight/age categories |
| Team Management | Manage clubs, coaches, and team rosters |
| Bracket Generation | Auto-generate and manage knockout/round-robin brackets |
| Category & Division Management | Define and manage weight classes, age groups, belt ranks |
| Venue Management | Assign courts, halls, and mat areas to events |
| Schedule Management | Publish and manage match schedules |
| Referee Assignment | Assign referees to courts and match pools |
| Media Management | Upload, moderate, and publish tournament media |
| Announcements | Broadcast tournament communications |
| User & Role Management | Control platform access by role |
| Public Portal | Public-facing tournament viewer |
| Reporting & Export | Generate and download data reports |

### Platform Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Backend | Firebase Realtime Database |
| Authentication | Firebase Authentication + DB-based session auth |
| File Storage | Base64 encoded images in Firebase Realtime Database |
| Hosting | Firebase Hosting |
| Security | Firebase Security Rules + Client-side role guards |

---

## 2. Role Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                      SUPER ADMIN                        │
│         Full platform control, system-level access      │
└───────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
┌───────────▼──────────┐       ┌────────────▼────────────┐
│        ADMIN         │       │   TOURNAMENT ORGANIZER  │
│  Championship & user │       │   Event-scoped control  │
│  management          │       │   No user management    │
└──────────┬───────────┘       └────────────┬────────────┘
           │                                │
    ┌──────┴──────────────────┐             │
    │                         │             │
┌───▼──────────┐   ┌──────────▼──┐         │
│ REGISTRATION │   │    MEDIA    │         │
│   MANAGER   │   │   MANAGER   │         │
│             │   │             │         │
└─────────────┘   └─────────────┘         │
                                          │
              ┌───────────────────────────┘
              │
    ┌─────────┴──────────────────────────────────┐
    │                                            │
┌───▼──────────────┐                 ┌───────────▼──────────┐
│ TECHNICAL OFFICIAL│                │       REFEREE         │
│ Bracket/schedule  │                │ Court assignment view │
│ management        │                │ Match pool access     │
└──────────────────┘                 └──────────────────────┘

┌────────────────────┐   ┌───────────────────────┐   ┌──────────────────────┐
│    TEAM COACH      │   │   ATHLETE / PLAYER    │   │  SPECTATOR / PUBLIC  │
│ Team & roster mgmt │   │ Personal profile only │   │  Public portal only  │
└────────────────────┘   └───────────────────────┘   └──────────────────────┘
```

### Role Inheritance Overview

| Role | Inherits From | Additional Scope |
|---|---|---|
| Super Admin | Admin | System-wide, cross-tournament |
| Admin | — | Full championship management |
| Tournament Organizer | — | Event-scoped only |
| Registration Manager | — | Registration module only |
| Media Manager | — | Media module only |
| Technical Official | — | Bracket & schedule module |
| Referee | — | Court/match assignment view |
| Team Coach | — | Own team scope only |
| Athlete / Player | — | Own profile only |
| Spectator / Public User | — | Public portal only |

---

## 3. Permission Matrix

### Core Module Access

| Permission | Super Admin | Admin | Tourn. Organizer | Reg. Manager | Media Manager | Tech. Official | Referee | Team Coach | Athlete | Public |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Create Tournament | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Edit Tournament | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Delete Tournament | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Publish Tournament | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Archive Tournament | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create Team | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Edit Team | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (own) | ❌ | ❌ |
| Delete Team | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Register Athlete | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ (own) | ❌ | ❌ |
| Approve Registration | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reject Registration | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lock Registration | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Generate Brackets | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit Brackets | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Publish Schedule | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Assign Referees | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Venues | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Categories | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Weight Divisions | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Upload Media | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Moderate Media | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Announcements | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Users | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Export Reports | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ (own) | ❌ | ❌ |
| View Analytics | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View Public Portal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View Brackets (Public) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View Match Schedule | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Firebase Database Access Matrix

| Database Node | Super Admin | Admin | Judge | Referee | Team | Public |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `/teams` | R/W | R/W | R | R | R | R |
| `/users` | R/W | R/W | — | — | R (own) | — |
| `/referees` | R/W | R/W | R | R | — | R |
| `/players` | R/W | R/W | R | R | R/W | R |
| `/playerImages` | R/W | R/W | R | R | R/W | R |
| `/formConfig` | R/W | R/W | R | — | R | R |
| `/weightCategories` | R/W | R/W | R | — | R | R |
| `/brackets` | R/W | R/W | R/W | R | R | R |
| `/currentMatch` | R/W | R/W | R/W | R | — | R |
| `/matchResults` | R/W | R/W | R/W | R | — | R |
| `/matchHistory` | R/W | R/W | R/W | R | — | R |
| `/championships` | R/W | R/W | R | R | — | R |
| `/championshipSettings` | R/W | R/W | R | — | — | — |
| `/overallStandings` | R/W | R/W | R/W | — | R/W | — |
| `/categoryResults` | R/W | R/W | R/W | — | R/W | — |
| `/championshipHistory` | R/W | R/W | R | — | — | R |

---

## 4. Role Definitions

---

### 4.1 Super Admin

#### Role Overview

The Super Admin is the highest authority on the platform. This role exists at the system level and has unrestricted access to every module, database node, configuration setting, and administrative function across all championships and events. Super Admins are responsible for platform maintenance, user role provisioning, system configuration, and cross-tournament governance.

In the current Firebase implementation, the Super Admin role maps to the `admin` role in the database and is distinguished by being the primary account provisioned during platform setup.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Admin Dashboard | Full access — all widgets, all panels |
| User Management Panel | Full access |
| Role Management Panel | Full access |
| System Configuration | Full access |
| Championship Control Panel | Full access |
| Team Management | Full access |
| Referee Management | Full access |
| Bracket Control Center | Full access |
| Registration Control | Full access |
| Media Management | Full access |
| Announcement Center | Full access |
| Analytics & Reporting | Full access |
| Audit Logs | Full access |
| Firebase Console Proxy | Full access |
| Public Portal Preview | Full access |

All navigation items, sidebar links, modals, and admin controls are visible and interactive.

---

#### Permissions

**Tournament Management**
- Create new championships with name, dates, venue, rules, and categories
- Edit all details of any championship at any stage
- Delete championships, including purging all associated brackets, registrations, and media
- Archive completed championships to championship history
- Control tournament visibility (public / private / invite-only)
- Publish and unpublish tournaments
- Configure championship point systems and scoring structures
- Set registration open/close windows globally

**Team Management**
- Create team accounts with credentials
- Edit team names, usernames, passwords, email addresses
- Delete teams and all associated player records
- Open or close registration windows per team
- Set per-team registration deadlines
- View all teams and their registered athlete counts
- Export team rosters

**User & Role Management**
- Create user accounts (admin, judge, referee, team) via Firebase Authentication or DB-based auth
- Assign and modify roles for any user
- Revoke roles and disable accounts
- Reset credentials for any user
- Audit user login history
- Manage role permissions at configuration level

**Athlete & Registration Management**
- Register athletes into weight/age/gender categories
- Edit athlete profiles (name, age, weight, gender, center/team)
- Delete athlete records
- Approve or reject registrations
- Lock registrations globally or per team
- Move athletes between categories
- Upload and manage athlete profile images
- Export registration reports

**Bracket Management**
- Generate brackets for any category (knockout, round-robin)
- Edit bracket structure post-generation
- Publish brackets publicly
- Assign bye slots
- View all bracket states across all championships

**Schedule Management**
- Publish match schedules
- Edit court/mat assignments
- Modify session times and day assignments
- Assign referees to courts

**Category & Division Management**
- Create weight categories and divisions
- Edit category names, weight limits, gender restrictions, age restrictions
- Delete or merge categories
- Manage belt rank divisions

**Venue Management**
- Configure courts, halls, and mat areas
- Assign venue details to events
- Manage court numbering and layout

**Media Management**
- Upload tournament banners, photos, and athlete images
- Delete any uploaded media
- Approve or reject media submitted by other roles

**Announcement Management**
- Create and publish system-wide announcements
- Schedule announcements
- Delete announcements

**Reporting & Analytics**
- Access full platform analytics dashboard
- Export registration lists, bracket sheets, team rosters
- View historical championship data
- Download PDF bracket exports

---

#### Restrictions

The Super Admin has no functional restrictions within the platform. However, the following architectural constraints still apply:

- Cannot bypass Firebase Authentication token validation
- Cannot modify Firebase Security Rules directly from the platform UI (must use Firebase Console)
- Cannot access data outside the configured Firebase project
- Cannot impersonate other users without explicit session switching

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | Required — `auth.uid` must resolve to `admin` role |
| DB Role Path | `users/{uid}/role === 'admin'` |
| Session Type | Firebase Authentication token |
| Session Duration | Firebase token lifetime (1 hour, auto-refreshed) |
| Write Access | All nodes |
| Read Access | All nodes |
| Route Guard | `requireRole('admin')` on all admin routes |
| Rate Limiting | Standard Firebase quotas apply |

---

#### Data Access

| Data Type | Read | Write | Export | Delete |
|---|:---:|:---:|:---:|:---:|
| Tournament Records | ✅ | ✅ | ✅ | ✅ |
| Team Records | ✅ | ✅ | ✅ | ✅ |
| Athlete Records | ✅ | ✅ | ✅ | ✅ |
| Bracket Data | ✅ | ✅ | ✅ | ✅ |
| Match Records | ✅ | ✅ | ✅ | ✅ |
| User Accounts | ✅ | ✅ | ✅ | ✅ |
| Media Files | ✅ | ✅ | ✅ | ✅ |
| System Config | ✅ | ✅ | ✅ | ✅ |
| Audit Logs | ✅ | ✅ | ✅ | ❌ (append-only) |

---

#### Notification Permissions

- Receives all system-level alerts and error notifications
- Can broadcast announcements to all roles
- Can send targeted notifications to teams, referees, or officials
- Receives registration milestone alerts
- Receives bracket generation status notifications

---

### 4.2 Admin

#### Role Overview

The Admin manages the day-to-day operational aspects of championships. They have full control over tournament data, team management, athlete registration, bracket generation, and referee assignments. The Admin does not have system-level configuration access (that belongs exclusively to the Super Admin) but has complete authority over all event and tournament data.

In Firebase, the `admin` role is the highest role in the current implementation and covers both Super Admin and Admin functions in the live system.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Admin Dashboard | Full access |
| Championship Control Panel | Full access |
| Team Management | Full access |
| Athlete Registration | Full access |
| Referee Management | Full access |
| Bracket Control Center | Full access |
| Category Management | Full access |
| Announcement Center | Full access |
| Media Management | Full access |
| Reporting | Full access |
| Public Portal Preview | Full access |
| User Management | Full access |
| System Configuration | Read-only |
| Audit Logs | Read-only |

---

#### Permissions

Same as Super Admin for all tournament operations, team management, athlete registration, bracket management, schedule management, category management, venue management, media management, and announcements.

**Differences from Super Admin:**
- Cannot modify system-level Firebase configuration
- Cannot change the role of another Admin to Super Admin
- Cannot purge the audit log

---

#### Firebase Security Access

```json
"teams": {
  ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'"
},
"players": {
  ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'"
},
"championships": {
  ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'"
}
```

---

### 4.3 Tournament Organizer

#### Role Overview

The Tournament Organizer is responsible for managing specific events assigned to them. They can configure event details, publish schedules, manage registrations, assign referees to courts, and control public visibility for events within their scope. They do not have access to user management, system configuration, or cross-tournament data beyond what is assigned to them.

**Note:** In the current Firebase implementation, Tournament Organizer permissions are managed at the application layer (JavaScript role guards). The Firebase `judge` role is the closest built-in equivalent for elevated event-scope access.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Tournament Dashboard | Assigned events only |
| Event Configuration | Assigned events only |
| Registration Management | Assigned events only |
| Schedule Management | Assigned events only |
| Referee Assignment Panel | View + Assign |
| Bracket Viewer | Read-only |
| Venue Management | Assigned venues only |
| Announcement Center | Event-scoped only |
| Reporting | Event-scoped export |
| User Management | Hidden |
| System Configuration | Hidden |
| Team Management | Hidden |
| Category Management | Hidden |

---

#### Permissions

**Tournament Management**
- Edit event name, date, venue, and description for assigned events
- Publish and unpublish assigned events
- Control public visibility of assigned events
- Open and close registration windows for assigned events
- Manage event status (Draft → Active → Completed)

**Registration Management**
- View all athlete registrations for assigned events
- Approve or reject athlete registrations
- Lock registration windows
- Export registration reports for assigned events

**Schedule Management**
- Publish match schedules for assigned events
- Edit session timeslots and court assignments
- Announce schedule changes

**Referee Assignment**
- View the list of available referees
- Assign referees to courts within assigned events
- Reassign referees as needed

**Venue Management**
- Configure court details for assigned venues
- Assign mat numbers to sessions

**Announcements**
- Create and publish announcements scoped to their events
- Cannot send platform-wide announcements

---

#### Restrictions

- Cannot create or delete tournaments
- Cannot create, edit, or delete teams
- Cannot manage user accounts or roles
- Cannot modify weight categories or divisions
- Cannot generate or modify brackets
- Cannot access data from tournaments not assigned to them
- Cannot access system configuration or audit logs
- Cannot delete athlete records
- Cannot access the financial or analytics module

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | Required |
| DB Role | Application-layer — mapped to `judge` or custom `organizer` role |
| Session Type | Firebase Authentication token |
| Route Guard | `requireRole(['admin', 'organizer'])` |
| Database Write | Event-scoped nodes only |
| Database Read | All public nodes + assigned event nodes |

---

#### Data Access

| Data Type | Read | Write | Export | Delete |
|---|:---:|:---:|:---:|:---:|
| Assigned Tournament Records | ✅ | ✅ | ✅ | ❌ |
| Other Tournament Records | ✅ (public) | ❌ | ❌ | ❌ |
| Athlete Records (assigned event) | ✅ | ❌ | ✅ | ❌ |
| Team Records | ✅ (public) | ❌ | ❌ | ❌ |
| Bracket Data | ✅ | ❌ | ✅ | ❌ |
| Match Records | ✅ | ❌ | ✅ | ❌ |

---

### 4.4 Team Coach

#### Role Overview

The Team Coach manages their registered team's profile, athletes, and registration entries. They operate exclusively within the scope of their own team. They can register athletes, submit team information, view their team's bracket placements, and track their athletes through the tournament. They have no access to other teams' data beyond what is publicly visible.

In Firebase, the `team` role is assigned to team accounts. Teams authenticate via DB-based authentication (username/password stored in the `teams/` node) rather than Firebase Authentication.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Team Dashboard | Own team only |
| Athlete Registration Panel | Own team only |
| Athlete Roster | Own team only |
| Bracket Viewer | Public view (own athletes highlighted) |
| Schedule Viewer | Public view |
| Team Profile | Own team — edit allowed |
| Registration Status | Own team only |
| Results Viewer | Public view |
| User Management | Hidden |
| System Configuration | Hidden |
| Admin Panel | Hidden |

---

#### Permissions

**Team Profile Management**
- View their team's profile details
- Update team contact email (subject to admin approval in some flows)
- View their registration deadline

**Athlete Registration**
- Register athletes belonging to their center/team
- Upload athlete profile photos
- View and manage their submitted athlete registrations
- Edit athlete details before the registration deadline closes
- View which athletes have been approved or rejected

**Bracket & Schedule Viewing**
- View all published brackets
- Identify their athletes' positions within brackets
- View the published match schedule
- Track which court/session their athletes are assigned to

**Results Viewing**
- View publicly published match results
- View their team's standing in the championship

---

#### Restrictions

- Cannot access any other team's athlete data
- Cannot view other teams' internal profiles or contact details beyond what is public
- Cannot create or delete team accounts
- Cannot generate brackets
- Cannot modify the championship configuration
- Cannot access admin or system panels
- Cannot approve or reject registrations
- Cannot assign referees
- Cannot manage venues or categories
- Cannot access analytics or system-wide reports
- Cannot upload media to the public gallery (only athlete photos)
- Cannot send announcements
- Cannot see the user management panel

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | NOT used — DB-based authentication |
| Auth Mechanism | Username/password verified against `teams/` node |
| Session Storage | `sessionStorage` (browser session only) |
| DB Role | `users/{teamId}/role === 'team'` (written post-login) |
| Write Access | `players/` node (own athletes), `playerImages/` node |
| Read Access | All public nodes |
| Route Guard | `requireRole('team')` on team dashboard routes |
| Session Duration | Browser session (cleared on tab close) |

**Firebase rules enabling team login write to users node:**
```json
"users": {
  "$uid": {
    ".write": "auth != null && auth.uid === $uid || root.child('teams').child($uid).exists()"
  }
}
```

---

#### Data Access

| Data Type | Read | Write | Export | Delete |
|---|:---:|:---:|:---:|:---:|
| Own Team Profile | ✅ | Limited | ❌ | ❌ |
| Own Athletes | ✅ | ✅ | ✅ | ❌ |
| Other Teams' Athletes | ✅ (public fields) | ❌ | ❌ | ❌ |
| Brackets | ✅ (public) | ❌ | ❌ | ❌ |
| Match Schedule | ✅ (public) | ❌ | ❌ | ❌ |
| Championship Results | ✅ (public) | ❌ | ❌ | ❌ |

---

#### Notification Permissions

- Receives notifications about their team's registration status changes
- Receives announcements from tournament organizers
- Receives alerts when registration deadline is approaching
- Receives confirmation when athlete registration is approved/rejected
- Cannot send announcements or notifications to other users

---

### 4.5 Athlete / Player

#### Role Overview

The Athlete / Player represents an individual competitor registered in the tournament. In the current platform implementation, athletes are not given direct login accounts — they are registered and managed by their Team Coach or Admin. This role is therefore a **data-model role** rather than an interactive login role in the current system.

If direct athlete login is implemented in a future release, the following permissions apply.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Personal Profile Viewer | Own profile only |
| Registration Status | Own registration only |
| Bracket Viewer | Public view (own slot highlighted) |
| Match Schedule | Public view (own matches highlighted) |
| Results Viewer | Public view |
| Team Dashboard | Hidden |
| Admin Panel | Hidden |

---

#### Permissions

**Personal Profile**
- View their own registered athlete profile
- View their category, division, weight class, and team assignment
- View their registration approval status

**Tournament Viewing**
- View published brackets
- View their own bracket placement
- View their assigned court and session time
- View published match schedule

---

#### Restrictions

- Cannot edit their own profile (managed by team coach or admin)
- Cannot register other athletes
- Cannot view other athletes' personal details beyond publicly displayed fields
- Cannot access any administrative module
- Cannot send announcements
- Cannot generate or modify brackets
- Cannot access analytics or reporting

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | Not implemented in current system |
| Auth Mechanism | No direct login (managed entity) |
| Future Route Guard | `requireRole('athlete')` |
| Read Access | Public nodes only |
| Write Access | None |

---

### 4.6 Referee

#### Role Overview

The Referee is assigned to specific courts or match pools within a tournament. Referees can view their court assignments, access the match pool assigned to them, and view bracket and schedule information. They do not manage athletes, teams, brackets, or tournament data.

In Firebase, the `referee` role authenticates via DB-based authentication (username/password against the `referees/` node).

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Referee Dashboard | Own assignments only |
| Court Assignment Panel | View own assignments |
| Bracket Viewer | Public view |
| Match Schedule | Public view |
| Athlete Viewer | Public view |
| Admin Panel | Hidden |
| Team Management | Hidden |
| User Management | Hidden |
| Championship Control | Hidden |

---

#### Permissions

**Court & Match Pool**
- View court assignment details
- View the list of athletes assigned to their court
- View the match schedule for their assigned court
- Access the `assignedRefs` field on their referee record

**Tournament Viewing**
- View all published brackets
- View the full match schedule
- View athlete profiles (publicly available fields)
- View championship information

---

#### Restrictions

- Cannot create, edit, or delete any tournament data
- Cannot modify brackets or schedule
- Cannot register athletes
- Cannot manage teams
- Cannot access user accounts
- Cannot send announcements
- Cannot access analytics or administrative reporting
- Cannot modify referee records (only admin can create/edit referee accounts)
- Cannot assign themselves to courts (admin assigns referees)

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | NOT used — DB-based authentication |
| Auth Mechanism | Username/password verified against `referees/` node |
| Session Storage | `sessionStorage` |
| DB Role | `users/{refId}/role === 'referee'` |
| Write Access | `referees/{refId}/assignedRefs` (view acknowledgment) |
| Read Access | All public nodes |
| Route Guard | `requireRole('referee')` |

**Firebase rules for referee node:**
```json
"referees": {
  ".read": true,
  ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'",
  "$refId": {
    "assignedRefs": {
      ".read": true,
      ".write": "auth != null"
    }
  }
}
```

---

#### Data Access

| Data Type | Read | Write | Export | Delete |
|---|:---:|:---:|:---:|:---:|
| Own Referee Record | ✅ | ❌ | ❌ | ❌ |
| Court Assignments | ✅ | ❌ | ❌ | ❌ |
| Brackets | ✅ (public) | ❌ | ❌ | ❌ |
| Match Schedule | ✅ (public) | ❌ | ❌ | ❌ |
| Athlete Profiles | ✅ (public) | ❌ | ❌ | ❌ |

---

### 4.7 Technical Official

#### Role Overview

The Technical Official handles the technical operations of the tournament — primarily bracket generation, schedule management, and referee-to-court assignment. They act as the operational bridge between the Admin's setup and the on-day execution of the tournament. They have elevated read access to all tournament data and write access to brackets and scheduling nodes.

In Firebase, the Technical Official maps to the `judge` role which has write access to brackets, match records, and match history nodes.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Technical Dashboard | Full access |
| Bracket Control Center | Full access |
| Schedule Management | Full access |
| Referee Assignment Panel | Full access |
| Match Records | Read + Write |
| Match History | Read + Write |
| Current Match Control | Read + Write |
| Athlete Viewer | Read-only |
| Team Viewer | Read-only |
| Admin Panel | Hidden |
| User Management | Hidden |
| System Configuration | Hidden |

---

#### Permissions

**Bracket Management**
- Generate brackets for assigned categories
- Edit bracket structures (swap athletes, assign bye slots)
- Publish brackets for public visibility
- View bracket status across all categories
- Export bracket sheets as PDF

**Schedule Management**
- Create and publish match schedules
- Assign time slots to bracket rounds
- Assign courts/mats to rounds
- Update schedule as the tournament progresses

**Referee Assignment**
- View the full referee list
- Assign referees to courts
- Reassign referees in case of absence or conflict

**Match Records**
- Write match completion records
- Write match history entries
- Update current match status

**Reporting**
- Export bracket PDFs
- Export schedule sheets
- Export match results by category

---

#### Restrictions

- Cannot create or delete championships
- Cannot create or delete teams
- Cannot register or delete athletes
- Cannot manage weight categories or divisions
- Cannot manage user accounts or roles
- Cannot access financial data
- Cannot send platform-wide announcements
- Cannot access audit logs
- Cannot modify championship settings or point systems
- Cannot access media management module

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | Required |
| DB Role | `users/{uid}/role === 'judge'` |
| Session Type | Firebase Authentication token |
| Route Guard | `requireRole(['admin', 'judge'])` |
| Write Access | `/brackets`, `/currentMatch`, `/matchResults`, `/matchHistory` |
| Read Access | All public nodes + championships |

**Firebase rules for technical official write access:**
```json
"brackets": {
  ".write": "auth != null && (root.child('users').child(auth.uid).child('role').val() === 'admin' || root.child('users').child(auth.uid).child('role').val() === 'judge')"
},
"matchHistory": {
  ".write": "auth != null && (root.child('users').child(auth.uid).child('role').val() === 'admin' || root.child('users').child(auth.uid).child('role').val() === 'judge')"
}
```

---

#### Data Access

| Data Type | Read | Write | Export | Delete |
|---|:---:|:---:|:---:|:---:|
| Tournament Records | ✅ | ❌ | ✅ | ❌ |
| Bracket Data | ✅ | ✅ | ✅ | ❌ |
| Match Records | ✅ | ✅ | ✅ | ❌ |
| Match History | ✅ | ✅ | ✅ | ❌ |
| Athlete Profiles | ✅ | ❌ | ✅ | ❌ |
| Referee Records | ✅ | ❌ | ❌ | ❌ |
| Championship Data | ✅ | ❌ | ✅ | ❌ |

---

### 4.8 Registration Manager

#### Role Overview

The Registration Manager is a specialized operational role focused exclusively on the athlete registration workflow. They verify, approve, reject, and manage athlete registrations for an assigned event. They do not have access to bracket generation, user management, or system configuration.

**Note:** In the current system, Registration Manager functions are handled by the Admin. This role is documented as a planned delegation role for larger tournaments.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Registration Dashboard | Full access |
| Athlete Registration List | Full access |
| Approval Queue | Full access |
| Rejection Management | Full access |
| Team Roster Viewer | Read-only |
| Category Viewer | Read-only |
| Registration Reports | Export only |
| Bracket Viewer | Read-only |
| Admin Panel | Hidden |
| User Management | Hidden |
| Bracket Control | Hidden |

---

#### Permissions

**Athlete Registration**
- View all submitted athlete registrations
- Approve registrations that meet eligibility criteria
- Reject registrations with reason notes
- Move athletes between registration categories (with admin approval)
- Lock registration windows per team or globally
- Open registration windows
- Set and modify registration deadlines

**Verification**
- Verify athlete eligibility (age, weight, belt rank)
- Flag registrations for admin review
- Add internal notes to registration records

**Reporting**
- Export registration lists by category, gender, team
- Export approval/rejection statistics
- Download athlete data sheets

---

#### Restrictions

- Cannot create or delete teams
- Cannot create or delete championships
- Cannot generate brackets
- Cannot assign referees
- Cannot manage users or roles
- Cannot modify weight categories or divisions
- Cannot access media management
- Cannot modify championship configuration
- Cannot access analytics beyond registration data

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | Required |
| DB Role | Application-layer (`registrar` or mapped to `judge`) |
| Session Type | Firebase Authentication token |
| Route Guard | `requireRole(['admin', 'registrar'])` |
| Write Access | `/players`, `/playerImages` |
| Read Access | `/players`, `/teams`, `/weightCategories`, `/formConfig` |

---

### 4.9 Media Manager

#### Role Overview

The Media Manager is responsible for all media assets on the platform. They upload, organize, moderate, and publish tournament photos, athlete images, and banner graphics. They cannot access any tournament management, registration, or administrative functions.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Media Dashboard | Full access |
| Photo Upload Panel | Full access |
| Banner Management | Full access |
| Image Moderation Queue | Full access |
| Tournament Media Gallery | Full access |
| Athlete Photo Manager | Athlete images only |
| Admin Panel | Hidden |
| Registration Panel | Hidden |
| Bracket Control | Hidden |

---

#### Permissions

**Media Upload**
- Upload tournament photos and graphics
- Upload athlete profile images
- Upload tournament banners
- Organize media into tournament-specific galleries

**Media Moderation**
- Review and approve media submitted by other users
- Reject non-compliant media uploads
- Delete inappropriate or low-quality media
- Replace existing images with updated versions

**Publication**
- Set media as public or private
- Assign cover images to tournament entries

---

#### Restrictions

- Cannot create or edit tournament records
- Cannot register athletes
- Cannot generate brackets
- Cannot manage users or roles
- Cannot send announcements
- Cannot access registration data or athlete personal details beyond what is publicly visible
- Cannot access analytics beyond media engagement metrics

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | Required |
| DB Role | Application-layer (`media` role) |
| Session Type | Firebase Authentication token |
| Route Guard | `requireRole(['admin', 'media'])` |
| Write Access | `/playerImages` |
| Read Access | All public nodes |

**Firebase rules for player images:**
```json
"playerImages": {
  ".read": true,
  ".write": true,
  "$playerId": {
    ".validate": "newData.isString() && newData.val().length <= 250000"
  }
}
```

---

#### Data Access

| Data Type | Read | Write | Export | Delete |
|---|:---:|:---:|:---:|:---:|
| Athlete Images | ✅ | ✅ | ✅ | ✅ |
| Tournament Banners | ✅ | ✅ | ✅ | ✅ |
| Public Gallery | ✅ | ✅ | ✅ | ✅ |
| Athlete Profiles | ✅ (public) | ❌ | ❌ | ❌ |
| Registration Data | ❌ | ❌ | ❌ | ❌ |

---

### 4.10 Spectator / Public User

#### Role Overview

The Spectator / Public User is any visitor to the platform who has no account or session. They have access exclusively to public-facing pages — tournament information, published brackets, match schedules, and public results. All sensitive data (athlete contact details, team credentials, admin functions) is completely hidden.

---

#### Dashboard Access

| Section | Access Level |
|---|---|
| Public Tournament Portal | Full access |
| Bracket Viewer | Published brackets only |
| Match Schedule | Published schedule only |
| Championship Results | Published results only |
| Public Gallery | Published media only |
| Athlete Profiles | Public fields only (name, team, category) |
| Team Directory | Public team names only |
| Registration | Cannot register (form is team-gated) |
| Admin Panel | Hidden |
| All Internal Sections | Hidden |

---

#### Permissions

**Tournament Viewing**
- View published tournament information (name, dates, venue)
- Browse the public tournament calendar
- View published match schedules
- View published brackets
- View championship standings (when published)
- View completed match results
- Browse the public media gallery

---

#### Restrictions

- Cannot access any administrative module
- Cannot view athlete personal details (age, weight, contact information)
- Cannot view team credentials or internal team data
- Cannot register athletes or submit forms
- Cannot access championship settings or configuration
- Cannot view unpublished brackets, schedules, or results
- Cannot view user accounts
- Cannot modify any data

---

#### Security Access

| Property | Value |
|---|---|
| Firebase Auth | Not required |
| Auth State | `auth === null` |
| Session Type | Anonymous (no session) |
| Write Access | None (root `.write: false`) |
| Read Access | Explicitly public nodes only |

**Firebase root deny prevents unauthenticated writes:**
```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

---

#### Data Access

| Data Type | Read | Write | Export | Delete |
|---|:---:|:---:|:---:|:---:|
| Published Tournament Info | ✅ | ❌ | ❌ | ❌ |
| Published Brackets | ✅ | ❌ | ❌ | ❌ |
| Published Schedule | ✅ | ❌ | ❌ | ❌ |
| Published Results | ✅ | ❌ | ❌ | ❌ |
| Public Media Gallery | ✅ | ❌ | ❌ | ❌ |
| Athlete Personal Data | ❌ | ❌ | ❌ | ❌ |
| Team Internal Data | ❌ | ❌ | ❌ | ❌ |
| User Accounts | ❌ | ❌ | ❌ | ❌ |

---

## 5. Firebase Security Architecture

### Current Rule Structure Summary

The Firebase Realtime Database security rules enforce RBAC at the data layer. The following structure defines the current live rule configuration.

```
Root
├── .read: false          ← Default deny all reads
├── .write: false         ← Default deny all writes
│
├── teams/                ← Public read, admin write
│   └── $teamId/          ← Public read, admin write
│
├── users/                ← Admin read, per-uid read for owner
│   └── $uid/             ← Owner + admin read/write, team-bypass write
│       └── role/         ← Admin write only, validated enum
│
├── referees/             ← Public read, admin write
│   └── $refId/
│       ├── assignedRefs/ ← Any authenticated user write
│       └── updatedAt/    ← Admin write only
│
├── players/              ← Public read/write (open registration)
│   └── $playerId/
│
├── playerImages/         ← Public read/write, 250KB max
│   └── $playerId/
│
├── formConfig/           ← Public read, admin write
├── weightCategories/     ← Public read, admin write
│
├── brackets/             ← Public read, admin+judge write
├── currentMatch/         ← Public read, admin+judge write
├── matchResults/         ← Public read, admin+judge write
│   └── $matchId/
│
├── matchHistory/         ← Public read, admin+judge write
│   └── $categoryKey/
│       └── $matchId/
│
├── championships/        ← Public read (top level), auth read (sub-nodes), admin write
│   └── $championshipId/
│       ├── categories/
│       ├── participants/
│       ├── standings/    ← admin+judge write, rank/points validate
│       ├── medals/       ← admin write
│       └── matches/      ← admin+judge write
│
├── championshipSettings/ ← Auth read, admin write
│   ├── scoringRules/
│   └── pointSystem/
│
├── overallStandings/     ← Auth read, admin+judge+team write
│   └── $standingId/      ← rank/points validate
│
├── categoryResults/      ← Auth read, admin+judge+team write
│   └── $resultId/
│
└── championshipHistory/  ← Public read, admin write
    └── $championshipId/
```

### Role-to-Firebase-Role Mapping

| Platform Role | Firebase Role Value | Auth Mechanism |
|---|---|---|
| Super Admin | `admin` | Firebase Authentication |
| Admin | `admin` | Firebase Authentication |
| Tournament Organizer | `judge` (current) or `organizer` (planned) | Firebase Authentication |
| Technical Official | `judge` | Firebase Authentication |
| Team Coach | `team` | DB-based (teams/ node) |
| Referee | `referee` | DB-based (referees/ node) |
| Spectator | — (no auth) | Anonymous |
| Registration Manager | Application-layer only | Firebase Authentication |
| Media Manager | Application-layer only | Firebase Authentication |
| Athlete | Not implemented | — |

### Recommended Admin Check Pattern

```javascript
// Reusable admin check for all write rules
const isAdmin = "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'";

// Reusable judge check
const isJudge = "root.child('users').child(auth.uid).child('role').val() === 'judge'";

// Reusable admin or judge check
const isAdminOrJudge = `auth != null && (${isAdmin} || ${isJudge})`;
```

---

## 6. Authentication Architecture

### Authentication Flow Diagram

```
Browser Request
      │
      ▼
┌─────────────────────────────┐
│   Does route require auth?  │
└────────────┬────────────────┘
             │
      ┌──────▼──────┐
      │ Public Page │── YES ──► Render public page (no auth required)
      └─────────────┘
             │
             NO
             │
      ┌──────▼──────────────────────┐
      │ Check Firebase Auth State   │
      │ firebase.auth().currentUser  │
      └──────┬──────────────────────┘
             │
    ┌────────▼────────────┐
    │ Is user authenticated│
    └────────┬────────────┘
             │
       ┌─────▼─────┐
       │    YES    │── ► Read users/{uid}/role from DB
       └───────────┘          │
                              │
                    ┌─────────▼──────────┐
                    │ Role === 'admin'?  │── YES ──► Admin Dashboard
                    └─────────┬──────────┘
                              │ NO
                    ┌─────────▼──────────┐
                    │ Role === 'judge'?  │── YES ──► Judge Dashboard
                    └─────────┬──────────┘
                              │ NO
                    ┌─────────▼──────────┐
                    │ Role === 'team'?   │── YES ──► Team Dashboard
                    └─────────┬──────────┘
                              │ NO
                    ┌─────────▼──────────┐
                    │Role === 'referee'? │── YES ──► Referee Dashboard
                    └─────────┬──────────┘
                              │ NO
                              ▼
                         Access Denied → Redirect to Login
```

### DB-Based Authentication Flow (Teams & Referees)

```
Team Login Attempt
      │
      ▼
Query teams/ node by username
      │
      ▼
Match found? ──NO──► Show error "Team not found"
      │
      YES
      │
      ▼
Password matches? ──NO──► Show error "Invalid credentials"
      │
      YES
      │
      ▼
Write users/{teamId} = { role: 'team', teamId: teamId }
      │
      ▼
Store session in sessionStorage
      │
      ▼
Redirect to Team Dashboard
```

### Session Management

| Role | Session Type | Duration | Storage |
|---|---|---|---|
| Admin / Judge | Firebase ID Token | 1 hour (auto-refresh) | Memory |
| Team Coach | DB-based session | Browser session | sessionStorage |
| Referee | DB-based session | Browser session | sessionStorage |
| Public | No session | — | — |

---

## 7. API Authorization Architecture

### Recommended Middleware Pattern

```javascript
// Route guard factory
function requireRole(...allowedRoles) {
  return async function(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      const snapshot = await db.ref(`users/${decoded.uid}/role`).get();
      const role = snapshot.val();
      
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      req.user = { uid: decoded.uid, role };
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// Usage examples
app.post('/api/championships',      requireRole('admin'), createChampionship);
app.post('/api/brackets/generate',  requireRole('admin', 'judge'), generateBracket);
app.post('/api/players/register',   requireRole('admin', 'registrar'), registerPlayer);
app.get('/api/brackets/:id',        publicRoute, getBracket);
```

### API Endpoint Permission Table

| Endpoint | Method | Required Role |
|---|---|---|
| `/api/championships` | POST | admin |
| `/api/championships/:id` | PUT | admin, organizer |
| `/api/championships/:id` | DELETE | admin |
| `/api/teams` | POST | admin |
| `/api/teams/:id` | PUT | admin |
| `/api/teams/:id` | DELETE | admin |
| `/api/players` | POST | admin, registrar |
| `/api/players/:id` | PUT | admin, registrar |
| `/api/players/:id` | DELETE | admin |
| `/api/brackets/generate` | POST | admin, judge |
| `/api/brackets/:id` | PUT | admin, judge |
| `/api/referees` | POST | admin |
| `/api/referees/:id/assign` | POST | admin, judge |
| `/api/schedule` | POST | admin, judge, organizer |
| `/api/media/upload` | POST | admin, media |
| `/api/media/:id` | DELETE | admin, media |
| `/api/announcements` | POST | admin, organizer |
| `/api/users` | GET | admin |
| `/api/users/:id/role` | PUT | admin |
| `/api/brackets/:id` | GET | public |
| `/api/schedule` | GET | public |
| `/api/championships/:id` | GET | public |

---

## 8. Protected Route Architecture

### Recommended Folder Structure

```
/src
  /routes
    /public             ← No auth required
      index.html
      brackets.html
      schedule.html
      results.html
    /protected
      /admin            ← requireRole('admin')
        dashboard.html
        championships.html
        teams.html
        referees.html
        users.html
        categories.html
        settings.html
      /judge            ← requireRole('admin', 'judge')
        brackets.html
        schedule.html
        matches.html
      /team             ← requireRole('team')
        dashboard.html
        registration.html
        roster.html
      /referee          ← requireRole('referee')
        assignments.html
        schedule.html
  /js
    /auth
      auth.js           ← Firebase auth + DB-auth logic
      roleGuard.js      ← Client-side route protection
    /admin
      championship-manager.js
      team-manager.js
      referee-manager.js
    /public
      bracket.js
      schedule.js
```

### Client-Side Route Guard

```javascript
// roleGuard.js
const ROLE_ROUTES = {
  'admin':   ['/admin/', '/judge/'],
  'judge':   ['/judge/'],
  'team':    ['/team/'],
  'referee': ['/referee/']
};

function guardCurrentRoute() {
  const currentPath = window.location.pathname;
  const userRole = sessionStorage.getItem('userRole') 
                || getCurrentFirebaseUserRole();
  
  const allowedPaths = ROLE_ROUTES[userRole] || [];
  const isProtected = Object.values(ROLE_ROUTES)
    .flat()
    .some(path => currentPath.startsWith(path));
  
  if (isProtected) {
    const hasAccess = allowedPaths.some(path => currentPath.startsWith(path));
    if (!hasAccess) {
      window.location.href = '/login.html?reason=unauthorized';
    }
  }
}

document.addEventListener('DOMContentLoaded', guardCurrentRoute);
```

---

## 9. Audit Logging & Activity Tracking

### Recommended Audit Log Schema

```json
{
  "auditLogs": {
    "$logId": {
      "timestamp":   "2026-05-26T10:30:00Z",
      "userId":      "uid_admin_001",
      "userRole":    "admin",
      "action":      "CREATE_TEAM",
      "targetType":  "team",
      "targetId":    "team_001",
      "targetName":  "Jeonbuk Tigers",
      "ipAddress":   "192.168.1.1",
      "userAgent":   "Mozilla/5.0...",
      "result":      "success",
      "details":     { "teamName": "Jeonbuk Tigers", "username": "jbtigers" }
    }
  }
}
```

### Actions to Audit by Role

| Action | Logged | Severity |
|---|---|---|
| Admin Login | ✅ | INFO |
| Admin Logout | ✅ | INFO |
| Failed Login Attempt | ✅ | WARNING |
| Create Championship | ✅ | INFO |
| Delete Championship | ✅ | HIGH |
| Create Team | ✅ | INFO |
| Delete Team | ✅ | HIGH |
| Register Athlete | ✅ | INFO |
| Delete Athlete | ✅ | HIGH |
| Generate Bracket | ✅ | INFO |
| Edit Bracket | ✅ | INFO |
| Approve Registration | ✅ | INFO |
| Reject Registration | ✅ | INFO |
| Lock Registration | ✅ | INFO |
| Assign Referee | ✅ | INFO |
| Change User Role | ✅ | HIGH |
| Delete User | ✅ | HIGH |
| Modify Firebase Rules | ✅ | CRITICAL |
| Upload Media | ✅ | INFO |
| Delete Media | ✅ | WARNING |

### Activity Tracking by Role

| Role | Activity Tracked |
|---|---|
| Admin | All write operations, login/logout, configuration changes |
| Tournament Organizer | Event edits, schedule publishes, referee assignments |
| Technical Official | Bracket generation, match record writes |
| Team Coach | Athlete registrations, team profile updates |
| Registration Manager | Registration approvals/rejections |
| Media Manager | Uploads, deletions, moderation actions |
| Referee | Login, court assignment acknowledgements |
| Public User | Bracket views (analytics only, no PII) |

---

## 10. Recommended RBAC Schema

### Firebase Users Node Schema

```json
{
  "users": {
    "$uid": {
      "role":        "admin | judge | referee | team",
      "email":       "user@example.com",
      "displayName": "John Kim",
      "teamId":      "team_001",
      "createdAt":   "2026-05-26T00:00:00Z",
      "lastLogin":   "2026-05-26T10:30:00Z",
      "isActive":    true
    }
  }
}
```

### Extended Role Schema (Recommended)

```json
{
  "roles": {
    "admin": {
      "label":       "Administrator",
      "permissions": ["all"],
      "level":       100
    },
    "judge": {
      "label":       "Technical Official / Judge",
      "permissions": ["bracket:write", "match:write", "schedule:write"],
      "level":       70
    },
    "registrar": {
      "label":       "Registration Manager",
      "permissions": ["players:write", "registration:approve"],
      "level":       50
    },
    "media": {
      "label":       "Media Manager",
      "permissions": ["playerImages:write", "media:moderate"],
      "level":       40
    },
    "team": {
      "label":       "Team Coach",
      "permissions": ["players:write (own)", "profile:read (own)"],
      "level":       20
    },
    "referee": {
      "label":       "Referee",
      "permissions": ["assignedRefs:write (own)"],
      "level":       10
    }
  }
}
```

### Role Validation Middleware Example

```javascript
const PERMISSIONS = {
  'admin':     ['*'],
  'judge':     ['brackets:write', 'match:write', 'schedule:write', 'standings:write'],
  'registrar': ['players:write', 'players:read', 'teams:read'],
  'media':     ['playerImages:write', 'media:write'],
  'team':      ['players:write:own', 'profile:read:own'],
  'referee':   ['assignedRefs:write:own', 'public:read']
};

function hasPermission(role, permission) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}
```

---

## 11. Security Best Practices

### Firebase Security Rules

1. **Default Deny** — Always set root `.read: false` and `.write: false`. Never leave root open.
2. **Role Validation at DB Layer** — Always check `users/{uid}/role` in rules, not just in client code.
3. **Avoid Validate on Trusted Paths** — Do not use `.validate` rules for admin writes unless strictly necessary; partial updates will fail.
4. **Index All Queried Fields** — Use `.indexOn` for every field used in `orderByChild()` queries to prevent full DB scans.
5. **Limit String Lengths** — Validate max lengths on user-submitted strings to prevent storage abuse.
6. **Separate Auth Mechanisms** — Keep Firebase Auth (admin/judge) clearly separated from DB-based auth (teams/referees) to prevent role confusion.

### Application Layer

1. **Never trust client-side role** — Always re-validate role from the database on protected operations.
2. **Invalidate sessions on role change** — When an admin changes a user's role, force re-authentication.
3. **Use `sessionStorage` for DB-auth sessions** — Prevents session persistence across browser restarts for non-Firebase users.
4. **Route guard on every protected page** — Never rely solely on hiding navigation links; enforce access checks on page load.
5. **Sanitize all inputs** — Validate and sanitize all form inputs before writing to Firebase.
6. **Log all destructive operations** — Every delete, ban, or role change must create an audit log entry.

### Data Protection

1. **Never store passwords in plain text** — Use hashed passwords or Firebase Authentication for all role types where possible.
2. **Limit PII exposure** — Athlete ages, weights, and contact details should not be readable by unauthenticated users.
3. **Enforce image size limits** — All base64 image uploads must be validated for max size in Firebase rules.
4. **Restrict cross-team data access** — Teams must only be able to write athletes under their own `centerName`.
5. **Audit log immutability** — Audit log nodes should have `.write` only (append), never `.read` from client side except for admin.

### Scalability Recommendations

1. **Migrate to Firebase Custom Claims** — Store roles as Firebase ID token custom claims to reduce database reads on every permission check.
2. **Implement role inheritance in middleware** — Build a permission hierarchy so `admin` automatically passes all `judge` checks.
3. **Pagination all list queries** — Use `limitToFirst()` and `startAfter()` for all athlete/team list reads.
4. **Separate read/write databases** — For high-load tournaments, consider Firebase Firestore for structured queries and keep Realtime Database for live match feeds only.
5. **Implement token refresh monitoring** — Alert admins if Firebase tokens expire mid-session during critical operations.

---

*This document is maintained by the platform development team. All permission changes must be reflected here before deployment to production.*

*Last reviewed: 2026-05-26*
