# Enrolment Console — Frontend Build Instructions

> **For Claude Code.** This describes a feature to add to an **existing** React + TypeScript + Vite project. The project already has its component library, styling, colours, and file conventions — **reuse them.** This document specifies *what* to build (screens, layout, fields, content, behaviour, data), not the visual design tokens or folder layout.
>
> Wherever this doc says "table", "panel", "button", "modal", "form field", "yes/no radio", "pagination", "file list", or "status/RAG colour", map it to the project's existing equivalent. Add new ones only following existing conventions. Match the look and feel of the current app.

---

## 1. What we're building

Three connected surfaces:

1. **Users List** — an admin table of all users with search filters, a Create action, and pagination.
2. **Enrolment Details Board** — a per-user, **read-only** profile summary that shows information already captured elsewhere (enrolment wizard, imports, admin edits). Opened by clicking a user in the list.
3. **Enrolment Wizard** — a **9-tab** guided form, opened from a **"Show Wizard"** button on the board. This is the editable surface where enrolment data is captured.

### Navigation flow

```
/users
  USERS LIST  (filters + Create + table + pagination)
     │  click a user's name (or their "Learning plan" link)
     ▼
/users/:userId
  ENROLMENT DETAILS BOARD  (read-only summary, pre-filled from data)
     │  header contains a [Show Wizard] button
     ▼
/users/:userId/wizard/:stepSlug?
  ENROLMENT WIZARD  (9 tabs, progress "x of 9", Back / Next / Finish)
```

### Routes

- `/users` — list
- `/users/:userId` — details board
- `/users/:userId/wizard/:stepSlug?` — wizard, deep-linkable per step; `stepSlug` defaults to `introduction`

The wizard should be a **route** (easier to deep-link and refresh) rather than a transient modal, though it may render as a full-screen panel over the board.

### UI building blocks this feature relies on (reuse existing)

- **Data table** — header row, zebra striping, thin row separators (no vertical gridlines), row hover, per-row action icons.
- **Collapsible section panel** — a title on the left with a collapse arrow (▼), optional action links/icons on the right, a thin rule under the title, then body. This is the backbone of the Details Board.
- **Field row** — two columns: label on the left, value/control on the right. Two modes: **read-only** (Details Board) and **editable** (Wizard). Same component, `readonly` prop.
- **Form field wrappers** — text, number, date (with calendar picker), select, textarea, and a **yes/no radio** group used heavily in the wizard.
- **Modal** — dimmed backdrop, title bar, body, footer actions, focus trap, Esc to close. Used by the Skills Radar "Assess" dialog and any add/edit dialogs.
- **Pagination** — first / prev / editable page number / "of N" / next / last.
- **File list** — uploaded files as links with optional delete, plus an "＋ Add file/evidence" affordance.
- **Buttons** — primary (confirm/next/search/add), destructive (back/delete), and a success variant for the final "Finish". Use the project's existing button variants.
- **Signature** — read-only image on the board; signature pad or uploaded image in the wizard.

**Quality floor everywhere:** responsive down to a usable mobile width; visible keyboard focus; `prefers-reduced-motion` respected; every input associated with a label; real `<table>` semantics.

---

## 2. Screen A — Users List

**Route:** `/users`. A centered, full-width admin page.

### Layout (what it looks like)

At the top-left is the page title **Users**. At the top-right is a **Create ▾** button that opens a small dropdown menu (menu items TBD by you, e.g. "Create user" / "Import users").

Beneath the title sits a **filter bar** — a grid of ~10 fields that wraps across three rows on desktop. After the fields, right-aligned, are **Search** and **Reset** buttons.

Below the filters is the **results table** of users. Rows alternate background shading, separated by thin horizontal lines only. Each row is one user. **Admin** users and **learner (User)** users render slightly differently (admins have no learning plan / programme status / notes / tasks cells filled).

At the very bottom, centered, is **pagination** (e.g. "Page 1 of 151"), followed by a small footer line of links.

### Filter bar fields

Arranged left-to-right, wrapping to new rows:

- **User name** — text
- **Group** — multi-select dropdown (placeholder "Select groups")
- **Email** — text
- **Status** — multi-select (sample selection: "FullUser, Invited, Prospect")
- **Type** — select, default `--All--` (options at least: Admin, User)
- **Programme** — text
- **Programme status** — text
- **NI number** — text
- **Case owner** — select, default `Any`
- **Reference number** — text
- **[Search]** (primary) and **[Reset]** (clears all filters to defaults)

The filter bar emits a filter object; whether filtering is client- or server-side depends on the API.

### Results table columns (in order)

| Column | Content / rule |
|---|---|
| **User** | User's name as a link → navigates to `/users/:userId`. |
| **Type** | `Admin` or `User`. |
| **Email** | Plain text; may wrap. |
| **Group** | e.g. "Kent Business College", "Test Accounts", "MRE - September 2024". |
| **Subscription status** | Text (e.g. `FullUser`) followed by a **red ✗** when unverified (a **green ✓** when verified). |
| **Learning plan** | Link labelled "Learning plan" **only for `User` rows**; blank for `Admin` rows. Also navigates to the board. |
| **Programme status** | Coloured status text: `Non starter`, `Active`, `Completed`, `Entered EPA`. Blank for admins. Use the project's status colours. |
| **Notes** | Notes icon + count (e.g. "0"). Blank for admins. |
| **Tasks** | Folder icon (opens tasks). Blank for admins. |
| **Edit** | Pencil icon → edit user. |

Sample rows to illustrate the mix (admins first, then learners):

- Raissa Muhoza · Admin · raissa.muhoza@aptem.co.uk · Kent Business College · FullUser ✗ · — · — · — · — · ✏
- Amgad Badewi · Admin · amgad.badewi@ibisconsultancy.com · Kent Business College · FullUser ✗ · …
- L6 PCP TEST · User · afaankhan86@gmail.com · Test Accounts · FullUser ✗ · Learning plan · Non starter · 0 · 📁 · ✏
- Hoda Gad · User · Huda.gad82@gmail.com · MRE - September 2024 · FullUser ✗ · Learning plan · Active · 1 · 📁 · ✏
- Heba Aly · User · … · MRE - September 2024 · FullUser ✗ · Learning plan · Completed · 0 · 📁 · ✏
- Aya Mohamed · User · … · MRE - September 2024 · FullUser ✗ · Learning plan · Entered EPA · 0 · 📁 · ✏

### Data model

```ts
type UserType = "Admin" | "User";
type ProgrammeStatus = "Non starter" | "Active" | "Completed" | "Entered EPA" | string;

interface UserListRow {
  id: string;
  name: string;
  type: UserType;
  email: string;
  group: string;
  subscriptionStatus: string;    // "FullUser"
  subscriptionVerified: boolean; // false -> red ✗
  learningPlan: boolean;         // show "Learning plan" link
  programmeStatus?: ProgrammeStatus;
  notesCount?: number;
  hasTasks?: boolean;
}

interface UsersFilter {
  userName?: string;
  groups?: string[];
  email?: string;
  statuses?: string[];           // FullUser, Invited, Prospect...
  type?: UserType | "all";
  programme?: string;
  programmeStatus?: string;
  niNumber?: string;
  caseOwner?: string | "any";
  referenceNumber?: string;
  page: number;                  // 1-based
  pageSize: number;
}
```

---

## 3. Screen B — Enrolment Details Board

**Route:** `/users/:userId`. A single **narrow column** of stacked, collapsible section panels. The whole page is **read-only** — it's a profile summary of data captured elsewhere. Every block below is a collapsible section panel (title with a ▼ arrow and optional right-aligned action links).

### Board header

- Top line: **User profile {name} ({reference})** on the left; **Owner: {ownerName}** on the right. Example: "User profile L6 PCP TEST (MWS025RVA263)" · Owner: Ayman Badewi.
- A clear primary **[Show Wizard]** button in the header → navigates to `/users/:userId/wizard`. (In the source system this also appears as a "show wizard" action link within the Programme panel header, alongside "learning plan overview" and "stop" — you may mirror that too.)

Sections, top to bottom:

### 3.1 Contact details
Right-aligned action links: **view profile in console · communication report · edit users details**.
Read-only rows:
- User email address — e.g. afaankhan86@gmail.com
- Phone number — e.g. 07442302664
- Date of birth — e.g. 11/03/1999
- Group membership of user — e.g. Test Accounts
- Signature (no mandate) — a signature image, plus action links **prepare mandate / upload signed mandate**

### 3.2 Activity Summary (last 30 days)
Right-aligned action links: **usage report · view activity list · view user tasks**.
Read-only rows:
- Aptem usage — `hh:mm` (e.g. 00:00)
- Number of days till next reporting period — number
- Date last logged in — e.g. 30/04/2026
- Number of logins — number
- Number of new tasks added by user — number
- Number of uncompleted tasks — number, with an **add new task** action link
- Number of advice items accessed — number
- Date advice centre last accessed — date or blank
- Action plans — text (e.g. "No plans created")

### 3.3 Programme
Right-aligned action links: **learning plan overview · show wizard · stop**.
A **Programme Details** sub-panel (with an edit pencil on the right):
- Programme Type — e.g. Delivery
- Programme — e.g. "Project Control Professional Level 6 - Al Fanar"
- Status — coloured status link (e.g. "Non starter")
- Start date — e.g. 01/11/2025
- End date — e.g. 30/06/2027
- Enrolled — "{datetime} by {admin}" (e.g. "31/10/2025 18:24:17 by Ayman Badewi")

Then an **Onboarding** sub-panel:
- Onboarding status — e.g. Completed
- Onboarding completed — datetime (e.g. 23/06/2026 10:08:31)

### 3.4 Sub-programme
A table — columns: **Sub-programme · Start Date · End Date**. Rows are the enrolled modules. Example rows:
- OTHM level 7 - Module :- Advanced Project and Logistics Management — 01/03/2026 → 30/04/2026
- OTHM level 7 - Module :- Advanced Research Methods — 02/05/2026 → 30/06/2026
- OTHM level 7 - Module :- Operations and Information Management for Pro… — 01/01/2026 → 28/02/2026
- OTHM level 7 - Module :- Planning, Controlling, and Leading a Project — 01/07/2026 → 31/08/2026
- OTHM level 7 - Module :- Procurement Risk and Contract Management — 01/11/2025 → 31/12/2025

### 3.5 Aims / Qualifications
A table — columns: **Aim ref number · Qualification · Start Date · End Date · Exempt?**. Example row:
- Z0002040 · Non regulated provision, Level 6, Engineering · 01/11/2025 · 30/06/2027 · No

Followed by a **Previous programmes:** sub-heading with an (often empty) list.

### 3.6 Functional Skills
Three assessment blocks — **English Assessments**, **Maths Assessments**, **ICT Assessments** — each lists records or an empty state ("No {subject} assessment records yet").
Three exemption blocks — **English / Maths / ICT Exemption from Functional Skills** — each has:
- a toggle link showing current state (**Not Exempt** ⇄ **Exempt**),
- an **Exemption evidence** mini-table (columns: Uploaded · File · Delete) with an empty state ("No evidence") and its own pager,
- an **＋ Add file** action.

### 3.7 Managed jobs and placements/workshops
Right-aligned action links: **application report · matching**.
A table — columns: **Employer · Title · Categories · Available from · Available to · Hours planned · Hours logged/verified · Status · Date · Comments/Notes · Current step**, plus per-row actions (**Edit**, and **Unverify** or **Delete**). Example rows:
- Kent Business College · Lecture 1 · Lectures · 28/04/2025 · 28/04/2025 · 03:00 / 03:00 · Finished · 29/04/2025 · 0 · Edit / Unverify
- Kent Business College · April 2026 - PCP - 5s · Project Control Professional Level 6 · 01/04/2026 · 29/04/2026 · 12:30 / 00:00 · Finished · 20/05/2026 · 0 · Edit / Delete

### 3.8 Tracker
Right-aligned action: **add**. Table — columns: **Type · Status · Programme · Descripton · Documents · Edit · Print** (note the original header typo "Descripton" — keep or correct as you prefer). Usually empty.

### 3.9 Milestones
Right-aligned action: **add**. Table — columns: **Programme · Description · Date · Emp Wks left · Alw Wks left · Status · Claimed · Edit**. Usually empty.

### 3.10 Notes
Right-aligned action: **add new note**. Table — columns: **text · administrator · date time**. Usually empty.

### 3.11 Course progress
Right-aligned action: **start course**. Table — columns: **Is locked · Course name · Count of completed steps / % completed · Status**. Usually empty.

### 3.12 Contacts
Right-aligned action: **add contact**. Table — columns: **Name · Type · Phone · Email · Role · Notes · Edit · Delete**. Name is a link; Edit is a pencil. Paginated (e.g. "Page 1 of 10"). Example rows (staff/coaches):
- Adam Charl · Admin · — · adam.charl@kentbusinesscollege.com · Coach · ✏
- Adeyemi Adeshina · Admin · 07940743295 · adeyemi.adeshina@kentbusinesscollege.com · Coach · ✏
- Afaan Khan · Admin · 07442302664 · Afaan.khan@kentbusinesscollege.com · Operations Lead · ✏
- Ahmed Essam · Admin · — · Ahmed.Essam@kentbusinesscollege.com · — · ✏
- Ahmed Hisham · Admin · — · ahmed.hisham@kentbusinesscollege.com · Admin · ✏
- (…more admins across pages…)

### 3.13 Activities
Right-aligned actions: **export · add activity**. Contains a mini search bar (a **Search** text field + a **Type** select + **Search** / **Reset** buttons), a date-range strip ("Today ◀ ▶ {from} → {to}"), and a view toggle (**Day / Week / Month / agenda**). Below: a table with columns **Date · Time and status · Event** (usually empty).

### 3.14 Compliance documents
A column header **Programme Name**, an empty state ("No documents"), and a pager ("Page 0 of 0").

### 3.15 Review documents
Grouped by programme. Under a programme name (e.g. **Project Control Professional Level 6 - Al Fanar**) is a list of expandable review rows, each formatted `Review - {name} {date} ({count})`, with optional right-side actions (**Create**, or **needs signing** + **Reset** + **Update**). Example rows:
- Review - Gateway Review 25/04/2026 (0)
- Review - Personal Support Plan 04/11/2025 (0)
- Review - Personal Support Plan 08/12/2025 (0) — Create
- Review - Progress Review (+ Skills Radar) 26/01/2026 (0)
- Review - Progress Review (+ Skills Radar) 26/05/2026 (0) — Create
- Review - Progress Review 02/12/2025 (0) — Create
- Review - Progress Review 07/05/2026 (0)
- Review - Progress Review 11/11/2025 (0)
- Review - Progress Review 15/01/2026 (0)
- Review - Progress Review 30/10/2025 (2) — needs signing · Reset · Update

### 3.16 Documents
Right-aligned action: **upload**. Table — columns: **Uploaded · Description · Edit · Delete**. Usually empty.

### 3.17 Competencies
Right-aligned action: **add competency**. A list where each row is a competency name (as a link) with right-side actions **Dashboard · Delete · Report**. Example rows:
- Market Research Executive Level 4 Apprenticeship Standard [v1.0]
- Project Controls Professional Level 6 Apprenticeship Standard [v1.0]

### 3.18 Subscription details
Right-aligned action: **cancel user**. Read-only rows:
- Subscription start date — e.g. 27.06.2024
- Subscription end date — e.g. 27.06.2032
- Subscription status — e.g. "Full user"

### 3.19 Audit trail
A table — columns: **Date · Admin · Action · Changes**. "Changes" is a nested Property/Value sub-grid per entry (e.g. `Episode status → Non starter`). A `Created` entry can expand to a full property dump: Title, SubscriptionStatus, Postcode, Case owner, Mobile, LastName, Groups, Gender, First name, Country, Town/City, Birthday, Address, SanctionStatus, IsMandatory, Login, Email, Sub-programme owners, Episode status, Episode name, Roles. Render as read-only nested rows.

### Board data model (shape only)

```ts
interface EnrolmentBoard {
  user: { id: string; name: string; reference: string; owner: string };
  contact: {
    email: string; phone: string; dob: string;
    groupMembership: string; signatureUrl?: string; hasMandate: boolean;
  };
  activity: {
    aptemUsage: string; daysTillNextReporting: number; lastLoggedIn?: string;
    logins: number; tasksAddedByUser: number; uncompletedTasks: number;
    adviceItemsAccessed: number; adviceLastAccessed?: string; actionPlans: string;
  };
  programme: {
    type: string; name: string; status: ProgrammeStatus;
    startDate: string; endDate: string; enrolledAt: string; enrolledBy: string;
    onboardingStatus: string; onboardingCompletedAt?: string;
  };
  subProgrammes: { name: string; startDate: string; endDate: string }[];
  aims: { aimRef: string; qualification: string; startDate: string; endDate: string; exempt: boolean }[];
  functionalSkills: { english: FsBlock; maths: FsBlock; ict: FsBlock };
  managedJobs: ManagedJob[];
  tracker: TrackerRow[];
  milestones: MilestoneRow[];
  notes: NoteRow[];
  courseProgress: CourseProgressRow[];
  contacts: ContactRow[];
  activities: ActivityRow[];
  complianceDocuments: DocRow[];
  reviewDocuments: ReviewGroup[];
  documents: DocRow[];
  competencies: { name: string; version: string }[];
  subscription: { startDate: string; endDate: string; status: string };
  auditTrail: AuditEntry[];
}
// Define FsBlock, ManagedJob, ContactRow, ReviewGroup, AuditEntry, etc. as needed.
```

Each section reads from this object; when a slice is missing/empty, render that section's empty state.

---

## 4. The Wizard — shell (shared by all 9 tabs)

**Route:** `/users/:userId/wizard/:stepSlug?`. Renders as a full-width panel (or full-screen overlay). The chrome is identical across tabs; only the body swaps.

### Layout regions

```
You are viewing: {name} ({reference})            ← context line at the top

[◯ tab] [● tab] [● tab] [● tab]      x of 9   (→)         │ [Create a task]
◀ ═════════▓▓▓▓═════════ ▶  (scroll strip)               │ [Create a follow up]
──────────────────────────────────────────────────────── │
                                                          │
STEP BODY (changes per tab)                               │
                                                          │
──────────────────────────────────────────────────────── │
[Back]                                     [Next] / [Finish]
```

- **Context line** at the very top: "You are viewing: {name} ({reference})".
- **Tab bar**: shows a window of ~4 tabs at a time with **◀ / ▶** scroll arrows and a draggable scroll strip beneath (there are 9 tabs; they don't all fit). Implement as a horizontally scrollable row that the arrows scroll. Each tab has a **status dot** on the left plus its label. The **active tab** is visually highlighted with a hollow ring marker (◯); inactive tabs show a filled dot (●). Right of the tabs: an **"x of 9"** counter and a circular **→** button that duplicates the footer Next. Clicking any tab jumps to it (free navigation; see §14 for validation). Tab labels ellipsize to fit — show the full label in a tooltip.
- **Right sidebar**: two stacked action buttons present on every step — **Create a task** and **Create a follow up** (wire to your task flow later; render as buttons for now).
- **Footer**: **[Back]** (destructive variant) on the left, hidden/disabled on step 1; **[Next]** (primary) on steps 1–8; **[Finish]** (success variant) on step 9.

### The 9 tabs, in order

1. **Introduction**
2. **Personal Details**
3. **Skills Radar**
4. **Individualised Learner Record** (label may truncate to "Individual Learner …")
5. **Contact Preferences** (source system labels this tab "Additional Information"; use "Contact Preferences")
6. **Personal Learning Record** (truncates to "Personal Learning R…")
7. **CV / Job Description**
8. **Policies**
9. **Next Steps**

### Wizard state

Hold a single draft object keyed by step; track current step, dirty state, and per-step completion. Persist on Next/Finish (or autosave on step change / debounce).

```ts
interface WizardDraft {
  personalDetails: PersonalDetails;
  skillsRadar: SkillsRadarState;        // assessments keyed by KSB id
  ilr: IlrForm;
  contactPreferences: ContactPreferencesForm;
  plr: PlrState;                        // uln + records[]
  cvJob: CvJobForm;
  policies: PoliciesState;              // acknowledgements
  // Introduction & Next Steps carry no input
}
interface WizardMeta {
  currentStepIndex: number;             // 0..8
  totalSteps: 9;
  completed: boolean[];                 // length 9
  dirty: boolean;
}
```

---

## 5. Tab 1 — Introduction

Static content, no inputs. Body:

- Heading: **Introduction**
- Sub-heading: **Your Enrolment**
- Paragraphs (use this exact copy):
  1. "Welcome to your apprenticeship with IBIS."
  2. "You will now be guided through the enrolment process, you will be asked to provide information about yourself and your participation on the course, complete your Individual Learning Record (ILR) and confirm details surrounding your eligibility and suitability for the programme."
  3. "This information is very important as it allows for your place on the course to be confirmed, please ensure all details are accurate, completed in full, and the required documentation is signed with your digital signature."
  4. "If you have any questions or concerns about this, please contact meadmissions@ibisconsultancy.com" (render the email as a mailto link).
- Footer: **[Next]** only (no Back on step 1).

---

## 6. Tab 2 — Personal Details

A simple two-column form (label left, control right). Fields:

- First Name — text
- Last Name — text
- Email — email
- Phone — tel
- Address — text
- Date of Birth — date (calendar picker)
- Age — number (you may auto-derive from DOB; the source shows it editable)
- Sex — select

Pre-fill from the user record / board data where known (this mirrors §3.1). Footer: **[Back] [Next]**.

---

## 7. Tab 3 — Skills Radar

The most involved tab. It is a **competence self-assessment matrix**.

### What it looks like

- At the top, a **programme/standard selector** dropdown (sample value: "Project Controls Professional Le…"). Switching it changes which set of KSBs is shown. Support multiple standards; this build ships one (PCP Level 6).
- Below, a **grid of KSB cards** (the source lays them out **5 columns** wide, reflowing on smaller screens). Each column has two parts:
  1. **A vertical "radar bar" of 5 stacked cells** sitting above the card. The 5 cells represent the 5 competence levels, top-to-bottom: **Always → Often → Sometimes → Rarely → Never**. Unassessed cells are empty (white) with a small colour marker in the corner indicating that row's level. Once the learner assesses this KSB, the cell at the chosen level fills with that level's colour.
  2. **A KSB card**: the KSB description text plus an **[Assess]** button.
- Map the 5 levels to the project's existing RAG/status colours in this order of competence (best → worst): **Always** (highest/"blue"), **Often** ("green"), **Sometimes** ("amber/yellow"), **Rarely** ("orange"), **Never** (lowest/"red"). Use whatever the project already uses for RAG — colour is never the only signal (each level also has a text label and each filled cell has an accessible name/tooltip).

### Pre-added KSB dataset (PCP Level 6)

Seed these as data. Some titles are truncated with "…" — fill from the official standard. Grouped by competence theme:

**Strategic Project Management**
- K1 (Knowledge) — Organisational and business strategies
- K30 (Knowledge) — Leadership strategies
- B3 & B4 (Behaviour) — Commercial astuteness; Pre-emptive thinking

**Scope**
- K2 & K6 (Knowledge) — Principles of project control and project life cycle; Breakdown and coding structures
- S18 & S20 (Skill) — Preparing estimating framework; Preparing planning and scheduling strategic frameworks

**Time & Cost**
- K22 / K23 / K20 (Knowledge) — Planning and scheduling practice; Modelling techniques; Estimating techniques
- S23 / S21 / S19 (Skill) — Applying cost engineering practice; Creating credible control schedules; Evidence-based …

**Integration & CMS**
- K7 & K8 (Knowledge) — Project Control Plans and reporting frameworks; Strategic principles of …
- S28 & S26 (Skill) — Steering project controls functions and mentor team members; identifying and explain …

**Quality**
- K21 & K31 (Knowledge) — Assurance techniques; Continuous improvement
- S29 (Skill) — Applying continuous improvement approaches
- B9 (Behaviour) — Innovation; learning from innovative solutions and seeking out new ideas to deliver

**Risk and Health & Safety**
- K15 & K18 (Knowledge) — Risk management and risk process; Environmental impact and sustainability …
- B1 (Behaviour) — Safety culture
- S14 & S9 (Skill) — Risk management and analysis; Ensuring project control work adheres …

**Communication and Engagement**
- K14 (Knowledge) — Approaches to communicating with stakeholders
- S27 & S13 (Skill) — Communicating and justifying conclusions and recommendations; Identifying …
- B8 (Behaviour) — Collaboration; interacting within a wide, multi-disciplinary …

**Procurement and Contracting**
- K18 & K19 (Knowledge) — Commercial matters; Key principles of invitations to tender …
- S16 & S17 (Skill) — Commercial matters and subcontractor/supplier performance …

```ts
type CompetenceKind = "Knowledge" | "Skill" | "Behaviour";
type RagLevel = "always" | "often" | "sometimes" | "rarely" | "never";

interface Ksb {
  id: string;            // e.g. "PCP-K1"
  theme: string;         // "Strategic Project Management"
  kind: CompetenceKind;
  codes: string[];       // ["K1"] or ["B3","B4"]
  title: string;         // full KSB description
}

interface KsbAssessment {
  ksbId: string;
  level: RagLevel | null;      // learner self-rating
  evidenceFiles: string[];     // "Evidence discussed" uploads
  actionPlan: {
    text: string;
    action?: string;           // from "Select action" or "Enter action"
    goal?: string;             // from "Select goal"
    dueDate?: string;          // "Date to complete"
  } | null;
  note?: string;
}

interface SkillsRadarState {
  standardId: string;                          // selected standard
  assessments: Record<string /*ksbId*/, KsbAssessment>;
}
```

### The Assess modal

Opens when **[Assess]** is clicked on a KSB card. **Modal title = the full KSB text** (e.g. "Understanding of Strategic Project Management (Knowledge) - K1: Organisational and business strategies").

**Left column — the 5 rating options.** Each is a selectable bordered box tinted with its RAG colour and has a **?** help icon showing guidance. Use this exact wording:
- **Always** — "I do not need any training as I am fully competent and can evidence my abilities."
- **Often** — "I am confident in my ability but would benefit from further training to be fully competent."
- **Sometimes** — "I have limited experience and need further training."
- **Rarely** — "I have some basic experience but still need training."
- **Never** — "I have no experience and need training."

Below the options: an **Evidence discussed** label + a **[Browse]** file button (multi-file).

**Right column — Action plan.**
- A large multiline text area (free-text plan).
- **Select action** — dropdown, default "-none-".
- **Enter action** — text input (free-text alternative to the dropdown).
- **Select goal** — dropdown, default "-none-".
- **Date to complete** — date picker.
- **[Add]** — appends the composed action/goal/date to the plan.

**Full width at the bottom:** a **Note** label + a text input.

**Footer:** **[Cancel]** (destructive) · **[Confirm]** (primary). Confirm writes the chosen `level`, evidence, action plan and note back into `SkillsRadarState.assessments[ksbId]`, closes the modal, and fills the corresponding grid cell with the level's colour. Cancel returns focus to the triggering Assess button.

Tab footer (below the grid): **[Back] [Next]**.

---

## 8. Tab 4 — Individualised Learner Record (ILR)

Title: **Individualised Learner Record 2025/26 - Learner Details Data Capture Form**. A two-column form. Fields:

- Family name — text
- Given names — text
- Date of birth — date; show the helper text "Age {n} on 31 Aug of the year programme started" (compute and display).
- Current postcode — text
- Current address line 1 / 2 / 3 / 4 — four text fields
- How long have you been at this address (years)? — number
- Telephone number — tel
- **Postcode prior to enrolment*** — text, required
- National insurance number — text (NI-format validation)
- Email address — email
- Legal Sex — radio: Male / Female
- What pronouns do you use? — text
- **Ethnicity*** — select (DfE ethnicity code list, e.g. "34 - Any other White background"), required
- "Do you consider yourself to have a long term disability, health problem or any learning difficulties?" — yes/no

**Learner Funding and Monitoring** (short intro paragraph about selecting the highest qualification achieved).
- **Prior Attainment** — a repeatable list; each item shows a level + date with edit/delete (✏ / ✕); an **＋ Add prior attainment** action. Example item: "Level 6 · 15/10/2025".
- **Employment status** — a repeatable list; each item shows a coded status + date with edit/delete; an **＋ Add employment status** action. Example item: "10 - In paid employment · 26/08/2025".

**Declaration** — a long statutory ILR privacy-notice block (render the full text as read-only prose; keep it collapsible if long). It ends with a **User signature** (signature pad or uploaded image).

```ts
interface IlrForm {
  familyName: string; givenNames: string; dob: string;
  currentPostcode: string;
  addressLine1: string; addressLine2: string; addressLine3: string; addressLine4: string;
  yearsAtAddress?: number;
  telephone: string; postcodePriorToEnrolment: string; niNumber: string; email: string;
  legalSex: "Male" | "Female";
  pronouns?: string; ethnicityCode: string;
  hasLongTermDisability: boolean | null;
  priorAttainment: { level: string; date: string }[];
  employmentStatus: { code: string; date: string }[];
  signatureUrl?: string;
}
```

Footer: **[Back] [Next]**.

---

## 9. Tab 5 — Contact Preferences

A long, multi-section form (the source system's "Additional Information" step). Group into fieldsets:

**Contact Preferences** — intro: "Where the use of your contact details is not part of our statutory duties, you can give your consent to be contacted about:". Yes/no rows:
- About courses or learning opportunities
- For surveys and research
- By post
- By phone
- By e-mail

**Emergency contact details / Next of kin**
- Full name / Relationship to you / Email address / Phone number — four text fields
- Address same as learner? — yes/no
- Postcode lookup + Address / Address 2 / City — three text fields

**Eligibility**
- Country of birth — select
- Are you primarily employed in England? — yes/no
- Country of residence — select
- Are you a UK/EEA National? — yes/no
- Nationality — select
- Have you been resident in the UK/EEA for the previous 3 years? — yes/no
- How many full years have you lived in the UK? — number
- Do you require a Work Permit? — yes/no
- **Proof upload block** — instruction text (guidance for UK / non-UK / EEA nationals) + a free-text evidence description box + a **file list** of uploaded evidence + an **＋ Add evidence** action. Sample uploaded files: "LUCIAN MORARU - immigration status details.pdf", "Lucian Moraru Passport.pdf".

**Other training**
- Have you attended any other government funded training programmes in the last 12 months? — yes/no

**Personal Circumstances** (textareas)
- What is your current home situation? Who do you live with?
- Do you have any caring responsibilities?
- Are there any other personal circumstances you want to tell us about?
- What support, if any, do you need to achieve this programme? (for example, childcare, travel planning, holidays etc.)
- Care leaver — yes/no

**Programme understanding** (textareas)
- What is your understanding of the programme you are applying for?
- How will this programme help you in your career development/aspirations, and/or with your progression?

**Additional information**
- "Please confirm your 'current wage rate per hour' is equal to or higher than:" — select (e.g. National Living Wage…)
- "If you have identified any long term disability, health problem or any learning difficulties, can you confirm if this can be discussed with your employer, where appropriate?" — select (Yes/No)
- "If selected other, please confirm your weekly or annual income" — text
- Are you aged between 16 and 18? — yes/no
- Are you aged between 19 and 24? — yes/no

**Media Consent**
- Consent paragraph. "Do you give Kent Business College consent for the above?" — yes/no
- Gender-identity note (the DfE only offers two gender options; ask how the learner would like to be known). Then: "What name do you prefer to be called?" — text · **Gender Identity** — select · "If other please detail" — text · "What are your preferred pronouns?" — select.

**Declarations / consents** (all yes/no):
- I understand that my Personal Learning Record (PLR) information will be shared with Kent Business College and other relevant organisations
- I understand that I am on a programme that is part funded by the DfE, and that members of the qualification and funding authorities may contact me in connection to my apprenticeship
- I understand that relevant personal details will be provided to the End Point and Awarding Organisation so that Registration and Certification can take place
- I understand that Kent Business College will hold any relevant copies of my certificates for audit purposes
- I confirm that all the information contained in this application is accurate and true

```ts
interface ContactPreferencesForm {
  consent: { courses: boolean; surveys: boolean; byPost: boolean; byPhone: boolean; byEmail: boolean };
  nextOfKin: {
    fullName: string; relationship: string; email: string; phone: string;
    sameAddressAsLearner: boolean; postcode?: string; address?: string; address2?: string; city?: string;
  };
  eligibility: {
    countryOfBirth: string; employedInEngland: boolean; countryOfResidence: string;
    ukEeaNational: boolean; nationality: string; residentPrev3Years: boolean;
    yearsInUk?: number; requiresWorkPermit: boolean;
    evidenceDescription?: string; evidenceFiles: string[];
  };
  otherGovFundedTraining12m: boolean;
  circumstances: { homeSituation: string; caringResponsibilities: string; other: string; supportNeeded: string; careLeaver: boolean };
  understanding: { programmeUnderstanding: string; careerProgression: string };
  additional: { wageRateBand: string; disabilityDiscussEmployer: string; otherIncome?: string; aged16to18: boolean; aged19to24: boolean };
  media: { consent: boolean; preferredName: string; genderIdentity: string; genderOther?: string; pronouns: string };
  declarations: { plrShared: boolean; dfeContact: boolean; epaoDetails: boolean; kbcHoldsCerts: boolean; infoAccurate: boolean };
}
```

Footer: **[Back] [Next]**.

---

## 10. Tab 6 — Personal Learning Record (PLR)

- A **ULN** text input (sample: `5757627173`) + a **[Get PLR]** button (fetches records; a stub/action here).
- An **[Add]** button (manual add) and an **Export to CSV** link on the right.
- A records table — columns: **Place of Study · Qualification Type · Subject · Level · Award Date · Credits · Grade · Record Type · Edit · Delete**. Example imported rows:
  - LONDON METROPOLITAN COLLEGE LIMITED · BSc · "BSc (Hons) in Project Management – The University of West London – Project Management Degree Apprenticeship Standard (00305040)" · — · — · 0 · 999999999 · Imported
  - LONDON METROPOLITAN COLLEGE LIMITED · Other · "Non regulated provision Level 6 Business Management (Z0002074)" · — · — · 0 · 999999999 · Imported
  - LONDON METROPOLITAN COLLEGE LIMITED · Other · "Apprenticeship standard / Project Manager (integrated degree) (ZPROG001)" · — · — · 0 · 999999999 · Imported
  - Pager: "Page 1 of 1".

```ts
interface PlrRecord {
  placeOfStudy: string; qualificationType: string; subject: string;
  level?: string; awardDate?: string; credits: number; grade: string;
  recordType: "Imported" | "Manual" | string;
}
interface PlrState { uln: string; records: PlrRecord[] }
```

Footer: **[Back] [Next]**.

---

## 11. Tab 7 — CV / Job Description

Heading **CV/Job Description**; sub-heading **Your Work Experience** + intro: "It is important that we match your previous experience and current job role and responsibilities to ensure this apprenticeship is the most appropriate route for you." Fields:

- "Please upload an up to date CV which includes your current job role:" — file upload (shows the uploaded file as a link, e.g. "Lucian Moraru CV.pdf").
- "If you do not have a CV to upload, please list your previous experience and description of your current job role and responsibilities:" — textarea.
- "Do you have any project management qualifications? If yes, please name them. If not, just write 'no.'" — text (sample value: "Site Management Safety Training Scheme").
- "If you do not have GCSEs available, or if you do not meet the required grades in English and Maths, would you like to enrol in a funded Functional Skills course in these subjects?" — select.

```ts
interface CvJobForm {
  cvFile?: string;
  experienceText?: string;
  pmQualifications: string;       // free text; "no" if none
  functionalSkillsEnrol?: string; // select value
}
```

Footer: **[Back] [Next]**.

---

## 12. Tab 8 — Policies

Heading **Documents**. Two lists of policy PDFs.

**Group A — Kent Business College.** Each row is a PDF link **plus a checkbox labelled "I have read and understood this document"**:
- Apprentice Attendance and Engagement Policy Kent Business College.pdf
- BUSINESS CONTINUITY POLICY KENT BUSINESS COLLEGE.pdf
- COMPLAINT PROCEDURES POLICY KENT BUSINESS COLLEGE.pdf
- HARASSMENT AND BULLYING POLICY KENT BUSINESS COLLEGE.pdf
- Health and Safety Handbook Kent Business College.pdf
- Introduction to British Values Kent Business College.pdf
- Introduction to Equality, Diversity _ Inclusion Kent Business College.pdf
- Introduction to Safeguarding and Prevent Kent Business College.pdf
- Learner Code of Conduct Kent Business College.pdf
- Manager_Handbook Kent Business College.pdf
- Safeguarding and Prevent Handbook Kent Business College.pdf

**Group B — IBIS.** In the source these are **links only** (no checkbox) — replicate as links, or add checkboxes if your policy requires acknowledgement:
- Health and Safety Handbook IBIS.pdf
- HARASSMENT AND BULLYING POLICY IBIS.pdf
- COMPLAINT PROCEDURES POLICY IBIS.pdf
- BUSINESS CONTINUITY POLICY IBIS.pdf
- Safeguarding and Prevent Handbook IBIS.pdf
- Learner Code of Conduct IBIS.pdf
- Introduction to Safeguarding _ PREVENT IBIS.pdf
- Introduction to Equality, Diversity _ Inclusion IBIS.pdf
- Introduction to British Values IBIS.pdf
- Apprentice Attendance and Engagement Policy IBIS.pdf

```ts
interface PolicyDoc { id: string; label: string; url: string; requiresAck: boolean }
interface PoliciesState { acknowledged: Record<string /*docId*/, boolean> }
```

Consider gating **Next** until all `requiresAck` documents are checked (your rule). Footer: **[Back] [Next]**.

---

## 13. Tab 9 — Next Steps

Static content, no inputs. Body:

- Heading: **Next Steps**
- Sub-heading: **Welcome to Your Apprenticeship**
- Paragraphs (use this exact copy):
  1. "Thank you for completing your enrolment process."
  2. "Once you click 'Finish' you will be directed to read and sign your compliance documents which will summarise all the information captured as part of your enrolment, these documents include your Training Plan, Apprenticeship Agreement, and Individual Learning Record (ILR)."
  3. "Once signatures are completed, you will be directed to your Aptem e-portfolio learning plan where you will need to open and complete your first piece of learning… When you have finished these activities and submitted your answers your enrolment will be complete."
  4. "Your tutor will provide further guidance on the next steps of your learning journey."
  5. "If you have any questions or queries, please contact meadmissions@ibisconsultancy.com" (mailto link).
- Footer: **[Back]** (destructive) · **[Finish]** (success). Finish submits the whole `WizardDraft` and returns to the board (`/users/:userId`), where the Onboarding status should reflect completion.

---

## 14. State, validation & data-flow rules

- **Pre-fill from the board data.** Tabs 2 (Personal Details) and 4 (ILR) share fields with the profile board; hydrate the wizard draft from the same source so nothing is retyped. Where the board shows a value, the wizard defaults to it.
- **Draft persistence.** Keep the whole `WizardDraft` in a wizard-scoped store/provider. Autosave on step change (Next/Back) or on a debounce; submit everything on Finish.
- **Free tab navigation, soft validation.** Let users click any tab. Mark a tab "complete" once its required fields pass. Optionally block **Finish** until required tabs are complete. Obvious required fields are marked in this doc (e.g. ILR "Postcode prior to enrolment*", "Ethnicity*").
- **Skills Radar** writes per-KSB via the Assess modal; a KSB counts as "assessed" when `level != null`.
- **Policies** acknowledgements are booleans keyed by document id.
- **Read-only vs editable.** The board is always read-only; the wizard is the editable surface. The shared field/form components support both via a `readonly` prop.
- **Dates** display as `DD/MM/YYYY`; datetimes as `DD/MM/YYYY HH:mm:ss`; durations as `HH:mm`. Centralise formatting.

---

## 15. Build order (suggested)

1. **Users List** (`/users`) with mock data — filter bar, table, pagination, Create menu.
2. **Enrolment Board** (`/users/:userId`) — header + all §3 sections as read-only panels fed by one `EnrolmentBoard` object (mock first).
3. **Wizard shell** — tab bar + footer + sidebar + wizard store, with 9 empty step placeholders and working Back/Next/Finish + "x of 9".
4. **Static steps** — Introduction (1) and Next Steps (9).
5. **Simple forms** — Personal Details (2), CV/Job (7), PLR (6), Policies (8).
6. **Skills Radar** (3) — grid + Assess modal (the RAG matrix is the trickiest piece).
7. **Long forms** — ILR (4) and Contact Preferences (5).
8. **Wire pre-fill** from board data into tabs 2 & 4; hook up autosave + Finish submission.
9. **Accessibility & responsive pass** — focus rings, labels, keyboard tab order, reduced motion, mobile stacking of two-column rows, KSB grid reflow.

---

## 16. Accessibility & quality floor (throughout, not at the end)

- Every input has an associated label; radio groups use `<fieldset>`/`<legend>`.
- The tab bar is keyboard-navigable (arrow keys move between tabs; Enter/Space activates) with visible focus.
- The modal traps focus, closes on Esc, and returns focus to the triggering Assess button.
- Tables use real `<table>` semantics with `<th scope>`.
- Colour is never the only signal: the RAG level always has a text label, and each filled radar cell has an accessible name/tooltip.
- Respect `prefers-reduced-motion` for tab scrolling and transitions.
- Layout is responsive: two-column label/value rows collapse to stacked rows on narrow screens; the 5-column KSB grid reflows to 2–1 columns.

---

### Appendix — content to reuse verbatim

*Scope is the frontend only. Backend endpoints, auth, and persistence are intentionally out of scope — every data structure above is named so it can be mapped to the existing API when wired up.*
