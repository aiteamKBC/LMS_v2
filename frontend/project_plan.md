# KBC LearningOS — Master Project Plan

## 1. Project Description

**KBC LearningOS** is a premium, enterprise-grade SaaS apprenticeship operating platform built for Kent Business College. It manages the complete UK apprenticeship lifecycle — from initial lead/induction through to EPA completion and alumni tracking.

**Target Users:** Apprenticeship learners, coaches, tutors, employers, engagement managers, compliance officers, MIS teams, QA reviewers, curriculum designers, leadership, finance, and external auditors.

**Core Value:** Evidence-first, journey-driven apprenticeship delivery that combines LMS, ePortfolio, compliance, coaching, employer engagement, and QA into one intelligent operating system.

**Design Ethos:** Premium, British, elegant, purple-led, magical but professional, calm but powerful, structured and inspection-ready.

## 2. Page Routing Structure

```
/
├── /login                          — Role-based login
├── /onboarding                     — Pre-active learner onboarding flow
│   ├── /onboarding/induction
│   ├── /onboarding/employer-contracting
│   ├── /onboarding/self-onboarding
│   ├── /onboarding/enrolment-review
│   ├── /onboarding/eligibility
│   ├── /onboarding/initial-assessment
│   ├── /onboarding/skills-scan
│   ├── /onboarding/compliance-pack
│   ├── /onboarding/signatures
│   ├── /onboarding/das-tracker
│   ├── /onboarding/ilr-readiness
│   ├── /onboarding/qa-review
│   └── /onboarding/activation
├── /workspace                      — Main workspace (redirects to role dashboard)
│   ├── /workspace/learner          — Learner dashboard
│   ├── /workspace/coach            — Coach dashboard
│   ├── /workspace/tutor            — Tutor dashboard
│   ├── /workspace/employer         — Employer dashboard
│   ├── /workspace/engagement       — Engagement manager dashboard
│   ├── /workspace/compliance       — Compliance dashboard
│   ├── /workspace/mis              — MIS dashboard
│   ├── /workspace/qa               — QA dashboard
│   ├── /workspace/curriculum       — Curriculum dashboard
│   ├── /workspace/leadership       — Leadership dashboard
│   ├── /workspace/admin            — Admin console
│   ├── /workspace/finance          — Finance view
│   └── /workspace/auditor          — Auditor view
├── /learning                       — Learning journey
│   ├── /learning/plan              — Training plan view
│   ├── /learning/weekly            — Weekly learning pathway
│   ├── /learning/evidence          — Evidence library
│   ├── /learning/ksb               — KSB progression tracker
│   └── /learning/otjh              — OTJH log
├── /coaching                       — Coaching & progress
│   ├── /coaching/meetings          — Coaching meetings
│   ├── /coaching/progress          — Progress reviews
│   └── /coaching/gateway           — Gateway readiness
├── /compliance                     — Compliance & QA
│   ├── /compliance/documents       — Document management
│   ├── /compliance/audit           — Audit trail
│   └── /compliance/ofsted          — Ofsted evidence
├── /reports                        — Reports centre
├── /admin                          — Admin & system
│   ├── /admin/curriculum           — Curriculum builder
│   ├── /admin/programmes           — Programme builder
│   ├── /admin/cohorts              — Cohort delivery
│   ├── /admin/users                — User management
│   └── /admin/settings             — Tenant settings (incl. RBAC, AI Settings)
└── /profile                        — User profile & settings
```

## 3. Core Feature Checklist

### Foundation (Phase 1)
- [x] Multi-tenant SaaS architecture shell
- [x] Premium purple-led British design system
- [x] Role-based access with 16 roles
- [x] Workspace shell with sidebar navigation
- [x] Login / Role selection
- [x] Pre-active journey flow structure
- [x] AI/Manual mode toggle system

### SaaS Foundation (Phase 1b)
- [x] Multi-tenancy with 2 demo tenants
- [x] Multi-type organisation structure
- [x] Complete role & permission system (16 roles, 65 permissions)
- [x] Tenant Admin dashboard
- [x] Settings Hub (30 settings areas across 9 categories)

### RBAC System (Phase 1c) ✅ COMPLETE
- [x] 12 permission levels (None → Full Admin)
- [x] 9 access scopes (Global → Assigned Learners Only)
- [x] 65 granular permissions across 20 categories
- [x] 16 roles with full level+scope permission assignments
- [x] Auth context with mock session support
- [x] PermissionGate for conditional UI rendering
- [x] RouteGuard for route-level protection
- [x] RoleGate for role-based visibility
- [x] AdminGate for admin-only UI
- [x] Sidebar navigation filtered by RBAC
- [x] Header sign-out wired to auth context
- [x] RBAC management page (Role Detail, Full Matrix, Permission List views)
- [x] Route-to-permission mapping
- [x] Navigation-to-permission mapping

### AI Mode System (Phase 1d) ✅ COMPLETE
- [x] Two-layer AI control: tenant-level master switch + user-level session toggle
- [x] 17 granular AI feature toggles across 4 categories (Learner Support, Staff Support, Reporting, Quiz & Content)
- [x] AI Settings context/provider with full tenant-level configuration
- [x] AiSuggestion component with mandatory "requires human validation" label
- [x] Accept/Edit/Reject action buttons on AI suggestions
- [x] AI audit trail data model (8 mock entries with full lifecycle)
- [x] AI Settings admin page (Feature Toggles, Audit Trail, Governance Rules tabs)
- [x] 19 never-allowed AI actions (hardcoded absolute rules)
- [x] AI failure fallback rules (when disabled, when fails, grace period)
- [x] WorkspaceShell AI mode bar driven by AiSettingsContext
- [x] AiSettingsProvider wrapping entire app in App.tsx
- [x] auth.aiMode removed — AiSettingsContext is sole authority

### Learner Features (Phase 2) ✅ COMPLETE
- [x] Learner dashboard with action cards, progress rings, stats, quick actions
- [x] Weekly learning pathway with task cards, live sessions, KSB links
- [x] Universal evidence capture box with filters, detail panel
- [x] OTJH claim system with entry form and validation tracking
- [x] KSB progression tracker with framework table and gateway readiness
- [x] Attendance & catch-up management with table and catch-up queue
- [x] Rewards, points & recognition with badges and rewards shop
- [x] 18 fully built learner workspace pages: Overview, This Week, My Training Plan, My Modules, Attendance & Catch-up, Report My Absence, My OTJH, My KSBs, My Evidence, My Quizzes, Monthly Cycle, Monthly Coaching, Progress Reviews, Rewards, Clubs, Gateway Readiness, Support, Messages
- [x] Single consistent demo learner: Sophie Williams — Marketing Executive L4 at Tim Hortons UK
- [x] All pages use WorkspaceShell with sidebar navigation, premium purple British SaaS style
- [x] Routes: /workspace/learner, /learner/this-week, /learner/training-plan, /learner/modules, /learner/attendance, /learner/report-absence, /learner/otjh, /learner/ksbs, /learner/evidence, /learner/quizzes, /learner/monthly-cycle, /learner/monthly-coaching, /learner/progress-reviews, /learner/rewards, /learner/clubs, /learner/gateway, /learner/support, /learner/messages
- [x] Files: src/mocks/learner-profile.ts, 18 page files under src/pages/learner/ and src/pages/workspace/learner/

### Coaching & Tutoring (Phase 3) ✅ COMPLETE
- [x] Coach dashboard with 8-learner caseload, risk flags, coaching calendar, evidence queue, absence reports
- [x] Coach workspace with learner detail expansion, AI insights, quick actions
- [x] Full coaching calendar with 11 scheduled sessions (confirmed/urgent/scheduled statuses)
- [x] Tutor Workspace dashboard with sessions management, learner list (8 learners), evidence review queue, assignment marking queue (8 items), KSB validation (6 items)
- [x] All routes: /workspace/coach, /workspace/tutor

### Employer & Engagement (Phase 4) ✅ COMPLETE
- [x] Employer dashboard with OTJH confirmation, attendance review, evidence validation for Sophie Williams
- [x] Engagement Command Centre dashboard with 8 learners, engagement scores, attendance risk monitoring (4 at-risk), absence reporting queue (7 items)
- [x] Gateway Readiness page with EPA readiness, KSB completion, portfolio checklist, mock review
- [x] Employer workspace: /workspace/employer
- [x] Engagement workspace: /workspace/engagement
- [x] Gateway Readiness: /learner/gateway

### Compliance & QA (Phase 5) ✅ COMPLETE
- [x] Compliance Control Centre dashboard — pre-active pipeline overview (15 stages, 100 learners), onboarding stages monitoring (8 active), employer contracting queue (5 employers)
- [x] MIS Operations Centre dashboard — cohort allocation (6 cohorts, 59 learners), weekly timetable (10 sessions), Teams sessions, coach/tutor assignment (5+5)
- [x] QA Review Centre dashboard — evidence QA (8 items), OTJH QA (6 items), KSB QA (5 items), rejected items (5 with actions), sampling queue (4 samples)
- [x] All routes: /workspace/compliance, /workspace/mis, /workspace/qa
- [x] Readdy Agent AI assistant added to all pages for 24/7 coaching Q&A and calendar booking
- [x] Sidebar redesigned with deep purple gradient background

### Admin & Leadership (Phase 6)
- [x] Curriculum Studio ✅ COMPLETE
- [x] Programme builder ✅ COMPLETE
- [x] Leadership Intelligence Centre ✅ COMPLETE
- [x] Admin console enhancements ✅ COMPLETE
- [x] Finance workspace ✅ COMPLETE
- [x] Auditor workspace ✅ COMPLETE
- [x] Complete demo login system with 11 role accounts ✅ COMPLETE
- [x] Role switcher for admin/demo testing ✅ COMPLETE
- [x] 80+ placeholder pages for complete platform navigation coverage ✅ COMPLETE

## 4. Data Model Design

### Table: tenants
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| name | text | Organisation name |
| slug | text | URL slug |
| branding | jsonb | Branding config |
| created_at | timestamptz | Creation timestamp |

### Table: users
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| tenant_id | uuid | FK to tenants |
| email | text | User email |
| full_name | text | Full name |
| role | text | Primary role |
| roles | text[] | All assigned roles |
| avatar_url | text | Avatar URL |
| created_at | timestamptz | Creation timestamp |

### Table: learners
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to users |
| cohort_id | uuid | FK to cohorts |
| programme_id | uuid | FK to programmes |
| status | text | pre-active/active/paused/withdrawn/completed |
| start_date | date | Programme start date |
| planned_end_date | date | Planned end date |
| employer_id | uuid | FK to employers |
| created_at | timestamptz | Creation timestamp |

### Table: programmes
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| tenant_id | uuid | FK to tenants |
| name | text | Programme name |
| standard_code | text | Apprenticeship standard code |
| level | int | Apprenticeship level |
| duration_months | int | Duration in months |
| created_at | timestamptz | Creation timestamp |

### Table: cohorts
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| programme_id | uuid | FK to programmes |
| name | text | Cohort name |
| start_date | date | Cohort start date |
| created_at | timestamptz | Creation timestamp |

### Table: evidence_items
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| learner_id | uuid | FK to learners |
| title | text | Evidence title |
| description | text | Evidence description |
| type | text | file/link/reflection/observation |
| ksb_refs | text[] | KSB references |
| otjh_hours | numeric | Off-the-job hours claimed |
| status | text | draft/submitted/validated/rejected |
| created_at | timestamptz | Creation timestamp |

### Table: otjh_entries
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| learner_id | uuid | FK to learners |
| date | date | Entry date |
| hours | numeric | Hours claimed |
| description | text | Activity description |
| status | text | pending/validated/rejected |
| created_at | timestamptz | Creation timestamp |

### Table: ksb_progress
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| learner_id | uuid | FK to learners |
| ksb_ref | text | KSB reference code |
| level | text | current/achieved/exceeded |
| evidence_ids | uuid[] | Linked evidence |
| created_at | timestamptz | Creation timestamp |

### Table: coaching_meetings
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| learner_id | uuid | FK to learners |
| coach_id | uuid | FK to users |
| scheduled_date | timestamptz | Scheduled date |
| status | text | scheduled/completed/cancelled |
| notes | text | Meeting notes |
| actions | jsonb | Action items |
| created_at | timestamptz | Creation timestamp |

### Table: progress_reviews
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| learner_id | uuid | FK to learners |
| review_date | date | Review date |
| period_start | date | Period start |
| period_end | date | Period end |
| otjh_total | numeric | Total OTJH in period |
| ksb_summary | jsonb | KSB progress summary |
| status | text | draft/completed/signed |
| created_at | timestamptz | Creation timestamp |

### Table: audit_log
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| tenant_id | uuid | FK to tenants |
| user_id | uuid | FK to users |
| action | text | Action performed |
| entity_type | text | Entity type |
| entity_id | uuid | Entity ID |
| changes | jsonb | Change details |
| created_at | timestamptz | Creation timestamp |

### Table: ai_audit_log (NEW)
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| tenant_id | uuid | FK to tenants |
| triggered_by_user_id | uuid | FK to users |
| ai_feature_used | text | Feature slug |
| learner_id | uuid | Optional FK to learners |
| evidence_id | uuid | Optional FK to evidence |
| input_data_summary | text | What data was used |
| ai_output | text | Raw AI output |
| user_decision | text | accepted/edited/rejected |
| final_approved_text | text | Human-approved version |
| session_mode | text | ai-assisted/manual-fallback |
| created_at | timestamptz | Creation timestamp |
| reviewed_at | timestamptz | When human reviewed |

## 5. Backend / Third-party Integration Plan

- **Supabase**: Required — Authentication, database, storage, edge functions for all backend logic
- **Shopify**: Not applicable
- **Stripe**: Not applicable (apprenticeship funding managed externally)
- **Readdy Agent**: Required — AI voice/chat assistant for learner support and Q&A

## 6. RBAC Architecture Summary

### Permission Levels (12)
`none` → `view` → `create` → `edit` → `approve` → `validate` → `reject` → `export` → `delete` → `archive` → `manage_settings` → `full_admin`

### Access Scopes (9)
`global` → `tenant` → `organisation` → `employer` → `programme` → `cohort` → `learner` → `own_record` → `assigned_learners_only`

### Roles (16)
Learner, Coach, Tutor, Employer/Line Manager, Engagement Manager, Compliance Officer, QA Officer, MIS User, Curriculum Developer, Programme Manager, Senior Leader, Finance User, Auditor, Tenant Admin, Super Admin

### RBAC Components
- `src/mocks/rbac.ts` — Complete data model (permissions, roles, route/nav mappings)
- `src/hooks/useAuth.tsx` — Auth context with full RBAC provider
- `src/components/feature/PermissionGate.tsx` — PermissionGate, RouteGuard, RoleGate, AdminGate
- `src/pages/admin/settings/RbacManagementPage.tsx` — RBAC management UI (Role Detail, Full Matrix, Permission List)

## 7. AI Mode Architecture Summary

### Two-Layer Control
1. **Tenant-level**: Master AI switch in AI Settings (admin-controlled). When OFF, all AI features disappear across the platform.
2. **User-level**: Individual users toggle between AI-Assisted and Manual modes in their workspace. Only available when tenant AI is ON.

### AI Feature Categories (17 features across 4 groups)
- **Learner Support (5):** Proofreading, Reflection Quality Check, KSB Suggestions, Evidence Checker, Revision Suggestions
- **Staff Support (5):** Marking Suggestions, OTJH Risk Detection, Coaching Summaries, Progress Review Drafts, Coaching Agenda Suggestions
- **Reporting (5):** Report Summaries, Employer Summary Drafts, Ofsted Evidence Summaries, Risk Pattern Summaries, SAR/QIP Evidence Insights
- **Quiz & Content (2):** Quiz Generation, XML Quiz Assistant

### Never-Allowed Actions (19 absolute rules)
AI must never: validate KSBs, accept OTJH, approve evidence, approve eligibility/RPL/QA/funding/gateway/compliance, replace professional judgement (tutor/coach/employer/compliance/QA), or invent evidence/workplace application/employer benefit/learner experience.

### AI Components
- `src/mocks/ai-settings.ts` — AI settings data model, feature toggles, never-allowed actions, fallback rules
- `src/mocks/ai-audit.ts` — AI audit trail data model, 8 mock entries, stats
- `src/hooks/useAiSettings.tsx` — AI settings context/provider with tenant+user level control
- `src/components/feature/AiSuggestion.tsx` — AiSuggestion wrapper with mandatory validation label, AiFeatureIndicator
- `src/pages/admin/settings/AiSettingsPage.tsx` — Full AI Settings admin page (Toggles, Audit Trail, Governance Rules)

## 8. Development Phase Plan

### Phase 1: Foundation — SaaS Shell, Design System, Roles, Workspaces, Pre-Active Journey ✅ COMPLETE

### Phase 1b: SaaS Foundation — Multi-Tenancy, Admin Console, Settings Hub ✅ COMPLETE

### Phase 1c: RBAC System — Full Role-Based Access Control ✅ COMPLETE

### Phase 1d: AI Mode System — Dual-Mode Architecture, Feature Toggles, Audit Trail ✅ COMPLETE
- Two-layer AI control (tenant master + user session)
- 17 granular AI feature toggles across 4 categories
- Mandatory human validation labeling on all AI outputs
- 19 never-allowed AI actions (hardcoded rules)
- AI audit trail with accept/edit/reject lifecycle
- AI Settings admin page with 3 tabs
- Fallback to manual mode if AI disabled or fails

### Pre-Active Learner Journey (Phase 1g) ✅ COMPLETE
- [x] Full 15-stage pre-active pipeline engine: Lead/Campaign → Induction → Employer Contracting → Learner Self-Onboarding → Enrolment Review → Eligibility Review → Initial Assessment → RPL/Skills Scan → Compliance Pack → Digital Signatures → DAS Tracker → ILR Readiness → QA Final Review → Activation Setup → Active Learner
- [x] 45+ status values across all stages (Candidate, Induction Invited/Booked/Attended, No Show, Proceeding, Not Proceeding, Employer Contracting/In Review/Invalid/Contract Sent/Awaiting Signatures/Contract Signed, Learner Onboarding Unlocked/Started/Submitted/Returned to Learner, Enrolment Review/Missing Information/Ready for Eligibility, Eligibility Review/Evidence Required/Eligible/Not Eligible, Initial Assessment, RPL Required/Applied/Makes Learner Ineligible, Compliance Pack Generated, Awaiting Learner/Employer/Provider Signature, Partially Signed/Fully Signed, DAS Pending/Confirmed, ILR Not Ready/Ready, Ready for QA/QA Rejected/QA Approved, Activation Pending/Active Learner)
- [x] Comprehensive learner case header showing: name, programme, employer, line manager, current stage, overall status, case owner, compliance status, eligibility status, RPL status, DAS status, ILR status, signature status, QA status, risk status, next required action, last updated, audit trail button
- [x] 8 realistic mock learners at various pipeline stages (Lead, Induction No-Show, Employer Contracting, Eligibility Review, Initial Assessment, Digital Signatures, QA Final Review, Activation Setup)
- [x] 15-stage vertical journey timeline with color-coded status indicators (completed/emerald, in-progress/purple glow, pending/neutral, blocked/amber, no-show/red)
- [x] Learner list with search, stage filter, risk filter, and compact status strip (C/E/S/D/I/Q indicators)
- [x] Stats banner showing total pre-active, ready for activation, overdue actions, and high-risk learners
- [x] Route: /compliance/pre-active — accessible from Compliance Control Centre sidebar

### Master Workspaces — Navigation (Phase 1f) ✅ COMPLETE
- [x] Full navigation arrays for all 13 workspaces — 180+ total nav items across Learner, Coach, Tutor, Employer, Curriculum Studio, Engagement Command Centre, Compliance Control Centre, MIS Operations Centre, QA Review Centre, Leadership Intelligence Centre, Admin Console, Finance Workspace, and Auditor Workspace
- [x] Learner Workspace (18 items): Overview, This Week, My Training Plan, My Modules, Attendance & Catch-up, Report My Absence, My OTJH, My KSBs, My Evidence, My Quizzes, Monthly Cycle, Monthly Coaching, Progress Reviews, Rewards, Clubs, Gateway Readiness, Support, Messages
- [x] Coach Workspace (18 items): Dashboard, Learner Caseload, Learner Case Files, Attendance & Catch-up, Absence Reports, Catch-up Queue, Marking Queue, AI-assisted Marking, Coaching Meetings, Monthly Cycle, Progress Reviews, Monthly KSB Impact, OTJH Reports, Evidence Validation, Employer Actions, At-risk Learners, Messages, Reports
- [x] Tutor Workspace (12 items): Dashboard, Teaching Sessions, Learners, Evidence Review, Assignment Marking, Quiz Results, KSB Validation, OTJH Validation, Feedback Queue, AI Marking, Resources, Reports
- [x] Employer Workspace (11 items): Dashboard, My Apprentices, Actions Required, Progress Reviews, Documents to Sign, Workplace Confirmations, OTJH Confirmation, KSB Progress, Messages, Reports, Support Requests
<<<<<<< HEAD
- [x] Curriculum Studio (15 items): Dashboard, Programmes, Standards, KSB Frameworks, Module Builder, Week Builder, Component Builder, KSB Mapping, Quiz Workspace, Test Banks, Checkpoint Assessments, Version Control, Curriculum QA, MIS Allocation, Published Curriculum
=======
- [x] Curriculum Studio (15 items): Dashboard, Programmes, Standards, KSB Frameworks, Module Builder, Week Builder, Component Builder, KSB Mapping, Quiz XML Workspace, Test Banks, Checkpoint Assessments, Version Control, Curriculum QA, MIS Allocation, Published Curriculum
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
- [x] Engagement Command Centre (17 items): Dashboard, Learner Engagement, Attendance Risk, Absence Reporting Queue, Catch-up Overdue, Communication Centre, Call Logs, WhatsApp Logs, Email Logs, Employer Escalations, Points Rules, Rewards Shop, Voucher Claims, Events, Learner Clubs, Recognition, Engagement Reports
- [x] Compliance Control Centre (16 items): Dashboard, New Starters, Onboarding, Employer Contracting, Eligibility, Initial Assessment, RPL Review, Documents, Digital Signatures, DAS Tracker, ILR Readiness, Evidence Packs, Funding Risk, Aptem Sync, Audit Reports, Reports
- [x] MIS Operations Centre (14 items): Dashboard, Cohorts, Learner Allocation, Programme Allocation, Module Allocation, Timetables, Teams Sessions, Attendance Modes, Coach Assignment, Tutor Assignment, Calendar, Delivery Dates, Data Quality, Reports
- [x] QA Review Centre (13 items): Dashboard, Pre-Active QA, Module QA, Evidence QA, OTJH QA, KSB QA, Progress Review QA, Report QA, Rejected Items, Escalations, Sampling, QA Findings, QA Reports
- [x] Leadership Intelligence Centre (15 items): Dashboard, Cohort Performance, Programme Performance, Attendance Trends, Engagement Trends, OTJH Trends, KSB Progress, Employer Engagement, Tutor SLA, Coach Workload, Compliance Risk, QA Sampling, Ofsted Evidence, SAR/QIP Evidence, Reports
- [x] Admin Console (20 items): Dashboard, Users, Roles, Permissions, Tenants, Organisations, Employers, Programmes, Cohorts, Forms, Templates, Documents, Automations, Notifications, Messages, Integrations, AI Settings, Manual Mode Settings, Audit Logs, System Settings
- [x] Finance Workspace (6 items): Dashboard, Funding Overview, Invoicing, Payments, Budgets, Reports
- [x] Auditor Workspace (6 items): Dashboard, Evidence Sample, Audit Trail, Compliance Review, Ofsted Pack, Reports
- [x] Removed old nested-group structures — all workspaces now use flat, scannable nav items matching the spec
- [x] Curriculum Studio now has its own dedicated nav items (previously incorrectly mapped to tutorNavItems)
- [x] All workspace pages (learner, coach, admin) verified to reference correct roleNavMap keys

### Updated Files
- `src/mocks/navigation.ts` — Complete rewrite with all 13 workspace navigation arrays and updated roleNavMap

### Phase 2: Learner Experience — Learning Journey & Evidence
- **Goal**: Build the core learner experience including weekly pathways, evidence capture, OTJH, and KSB tracking
- **Deliverables**: Learner dashboard, weekly learning pathway, evidence box, OTJH claim, KSB tracker, attendance system

### Phase 3: Coaching & Tutoring — Support & Progress
- **Goal**: Build coaching and tutoring workflows
- **Deliverables**: Coach dashboard, tutor dashboard, coaching meetings, assignments, checkpoints, progress reviews

### Phase 4: Employer & Engagement — External Stakeholders
- **Goal**: Build employer and engagement manager experiences
- **Deliverables**: Employer dashboard, engagement manager dashboard, employer involvement tracking

### Phase 5: Compliance & QA — Governance Layer
- **Goal**: Build compliance, QA, and MIS dashboards
- **Deliverables**: Compliance dashboard, QA dashboard, MIS dashboard, audit trail, Ofsted evidence, ILR readiness

### Phase 6: Admin & Leadership — Management Layer
- **Goal**: Build admin, curriculum, leadership, and reporting tools
- **Deliverables**: Curriculum builder, programme builder, leadership dashboard, admin console, reports centre, finance view, auditor view

### Employer Contracting & Workplace Validation (Phase 1h) ✅ COMPLETE
- [x] Full employer contracting data model: legal name, trading name, type, company number, UK address, workplace address, England check, employer contact, signatory, line manager (name/email/phone), learner job title, employment status, contract type, working hours, working pattern, PAYE, DAS, funding route, levy status, co-investment, 9 commitments/declarations
- [x] 15 employer contracting statuses: Not Started → Employer Details Required → Employer In Review → Employer Invalid → UK Address Required → Workplace England Check Failed → Line Manager Missing → Signatory Missing → PAYE Confirmation Required → DAS Action Required → Contract Sent → Awaiting Employer Signature → Awaiting Provider Signature → Contract Signed → Ready for Learner Onboarding
- [x] 5 realistic employer contracting records across all stages (Canterbury City Council signed, Dartford stuck at In Review, Kent Fire awaiting signature, Tonbridge & Malling signed, Gravesham just started)
- [x] 7 document types per employer: Contract for Services, Employer Declaration, Workplace Confirmation, Line Manager Confirmation, Payment/Co-investment Schedule, DAS Instruction Guide, Data Sharing Consent — each with status tracking (required/sent/signed/expired/N/A)
- [x] Employer Case Header with full detail grid (19 fields across 3 columns), commitment chip row, next action banner, risk reason banner
- [x] ContractingTimeline — vertical 15-stage status journey with progress bar, color-coded dots (emerald/completed, primary/current with pulse, neutral/pending), date stamps and notes per stage
- [x] ContractingForm — 6 collapsible sections (Employer Information, Addresses, Contacts & Signatory, Line Manager, Learner Employment, Funding & DAS, Declarations, Case Notes) with select dropdowns, checkboxes, textareas
- [x] DocumentTracker — 7-document per employer panel with status icons, progress bar, sent/signed dates, signatory names, upload button
- [x] Records list sidebar with search by employer/learner, status filter, risk filter, compact cards with risk dot and status badge
- [x] 4-tab detail panel: Overview (timeline + documents), Employer Details (full form), Documents (expanded), Status Timeline (expanded)
- [x] Stats banner: Total Employers (5), Ready for Onboarding (2), Awaiting Signature (1), Overdue Actions (2)
- [x] Route: /compliance/employer-contracting — accessible from Compliance Control Centre sidebar (badge: 5)

### Learner Self-Onboarding (Phase 1i) ✅ COMPLETE
- [x] Full 22-section onboarding form: Welcome & Introduction, Individualised Learner Record, Personal Details, Contact Details, Address History, Emergency Contact, Employment Details, Employer & Line Manager, Residency & Right to Work, Prior Attainment, Government-Funded Training, Personal Circumstances, Support Needs, Learning Support Screening, English & Maths, Programme Understanding, PLR / Prior Learning, CV / Job Description, Policy Acknowledgements, Declarations, Evidence Uploads, Review & Submit
- [x] 9 policy acknowledgements with per-policy tracking: policy name, version, document link, read checkbox, acknowledged date, learner signature, timestamp, audit trail — Health & Safety, Harassment & Bullying, Complaints Procedure, Business Continuity, Safeguarding & Prevent, Learner Code of Conduct, EDI, British Values, Attendance & Engagement Policy
- [x] 5 evidence uploads tracked per learner: ID Document, Proof of Address, Qualification Certificates, CV, Right to Work Evidence — each with status (uploaded/partial/missing), file names, upload dates, and overall completion percentage
- [x] 9 onboarding statuses: Not Started, In Progress, Submitted, Returned to Learner, Under Review, Missing Information, Approved, Rejected, Escalated
- [x] 6 realistic mock learners at every major stage: Sophie Martin (Submitted — 22/22 complete), Mia Okonkwo (In Progress — Evidence stage, 16/22), Daniel Walsh (In Progress — Policies stage, 11/22, dyslexia support needs), Amina Hussein (Missing Information — 8/22, right-to-work missing, HIGH risk), Oliver Grant (Returned to Learner — NI correction needed, 19/22), Chloe Parkinson (Not Started — 1/22, fresh record)
- [x] 17-section dynamic collapsible form with expand/collapse all, section-level completion tracking (Complete/In Progress/Pending badges), per-field type-aware rendering (text, longtext, date, boolean, select, list, number)
- [x] OnboardingHeader with full learner summary (name, programme, employer, line manager, cohort, target date, 8 detail fields, risk reason banner, next action callout, progress bar)
- [x] PolicyTracker with 9-policy accordion, per-policy read/acknowledged/signature tracking, document link buttons, completion progress bar
- [x] EvidenceTracker with 6 evidence items, required vs optional indicators, file names, upload dates, status badges
- [x] 4-tab detail panel: Overview (full form), Full Form (expanded), Policy Acknowledgements, Evidence Uploads
- [x] Learner records sidebar with search by name/employer, status filter, risk filter, compact cards with progress counters
- [x] Stats banner: Total Learners (6), Submitted (2), In Progress (2), Missing Info / Returned (2)
- [x] Route: /compliance/self-onboarding — accessible from Compliance Control Centre sidebar (badge: 6)
- [x] Files: src/mocks/self-onboarding.ts, src/mocks/self-onboarding-learners.ts, src/pages/compliance/self-onboarding/page.tsx, OnboardingHeader.tsx, OnboardingForm.tsx, PolicyTracker.tsx, EvidenceTracker.tsx

### Enrolment Team Review (Phase 1j) ✅ COMPLETE
- [x] 15-item enrolment review checklist: Personal details complete, NI number present, DOB valid, Address complete, Employment details complete, Employer details linked, Line manager present, Eligibility questions answered, CV uploaded, Job description uploaded, PLR attempted, Policies acknowledged, Declarations signed, Support needs flagged, Evidence uploaded
- [x] Each check item tracks: pass/fail/not-reviewed/not-applicable, reviewer note, reviewed timestamp, reviewed by
- [x] 7 enrolment review statuses: Submitted → Under Enrolment Review → Missing Information → Returned to Learner → Ready for Eligibility Review → Rejected at Enrolment → Escalated
- [x] 6 review actions with modal confirmation forms: Approve for Eligibility, Return to Learner, Request Evidence, Add Internal Note, Escalate, Reject Case — each with their own modal dialog, textarea input, and feedback banner
- [x] 6 realistic learner records at different review stages: Sophie Martin (13/15 checks pass, 1 fail — Business Continuity policy, nearly ready), Mia Okonkwo (7/15 checks pass, significant gaps — missing JD, 4 policies, incomplete evidence, anxiety support flagged), Daniel Walsh (HIGH risk — confirmed dyslexia, LSP required, CV/JD missing, escalated to SENCO), Amina Hussein (HIGH risk — zero evidence, right-to-work unconfirmed, BSc overqualification concern, all 9 policies unacknowledged, 9 missing items), Oliver Grant (Returned — NI format error, GCSE scans unclear, corrections in progress), Joshua Bennett (fresh submission — zero checks started)
- [x] Review progress chips showing pass/fail/pending counts with emerald/red/grey dots
- [x] Missing information panel with collapsible red-alert box listing all flagged items per learner
- [x] Internal notes section with author, timestamp, visibility badge (Internal/Shared), and full note content
- [x] Action history timeline showing all actions (approved/returned/evidence-requested/note-added/escalated/rejected) with colored dots, timestamps, and detail text
- [x] 6 modal dialog forms: Approve confirmation (with missing-items warning), Return to Learner (with reason textarea, 500 char limit), Request Evidence (with items textarea), Add Internal Note (with content textarea), Escalate (with reason textarea), Reject Case (with permanent warning + reason textarea)
- [x] Action button states: disabled when incompatible (approve disabled when rejected/escalated, reject disabled when already rejected)
- [x] Success feedback banner (emerald) after any action, dismissible
- [x] Learner records sidebar with search, status filter (6 active statuses), risk filter, compact cards showing pass/fail counts
- [x] 2-tab detail panel: Review Checklist (expandable items + missing info + internal notes + action history), Actions & Notes (6 action buttons + note/action history)
- [x] Stats banner: Total In Review (6), Ready for Eligibility (0), Missing Information (1), High Risk (2)
- [x] Route: /compliance/enrolment-review — accessible from Compliance Control Centre sidebar (badge: 6)
- [x] Files: src/mocks/enrolment-review.ts, src/mocks/enrolment-review-data.ts, src/pages/compliance/enrolment-review/page.tsx, EnrolmentReviewHeader.tsx, ReviewChecklist.tsx, ReviewActions.tsx

### Eligibility Review (Phase 1k) ✅ COMPLETE
- [x] Full eligibility review with 3-residency-test validation: 3-Year Continuous Residence, Settled Status / Right to Abode, Habitual Residence Test — each with evidence, reviewer notes, reviewed-by, and pass/fail/evidence-required status
- [x] 4 funding eligibility checks: Levy-Paying Employer, Funding Route Confirmed, PAYE Confirmation, OTJH Feasibility — each with pass/fail/N/A/not-reviewed status
- [x] Prior attainment table with qualification, level, year, awarding body, grade, verified status, relevance (relevant/partial/not-relevant), evidence, and assessor notes — includes overqualification detection (Level 5+ alerts)
- [x] Right to Work verification panel (verified/evidence-required/not-checked/flagged) with document type and expiry tracking
- [x] Age validation panel (DOB, age at start, meets minimum check)
- [x] Eligibility Outcome panel with decision banner (Eligible/Not Eligible/Conditionally Eligible/Pending), condition list, internal notes
- [x] 7 eligibility statuses: Submitted, Under Eligibility Review, Evidence Required, Eligible, Not Eligible, Conditionally Eligible, Escalated
- [x] 6 realistic learner records: Sophie Martin (Eligible — clean case, all 3 residency passed, levy-funded), Amina Hussein (Not Eligible — BSc overqualification at Level 6, right-to-work missing, escalated), Daniel Walsh (Evidence Required — residency gap, LSP pending), Mia Okonkwo (Conditionally Eligible — BTEC L3 partial overlap, needs marketing differentiation statement), Oliver Grant (Under Eligibility Review — just arrived from enrolment), Chloe Parkinson (Eligible — CACHE L2 childcare, strong RPL potential)
- [x] 5-tab detail panel: Overview (residency + funding + prior attainment + outcome), Residency Tests (expanded), Funding (expanded), Outcome (decision details), History (action timeline)
- [x] ResidencyTests accordion with expandable cards showing description, evidence, reviewer note, and reviewer info
- [x] FundingPanel with card list showing each check with pass/fail/N/A badges, detail descriptions, and assessor notes
- [x] PriorAttainmentPanel with full table including relevance badges, verification status, overqualification alert banner
- [x] Records sidebar with search, status filter (7 active statuses), risk filter, compact cards showing residency count and decision
- [x] Stats banner: Total In Review (6), Eligible (2), Not Eligible (1), Evidence Required (1)
- [x] Route: /compliance/eligibility — accessible from Compliance Control Centre sidebar (badge: 6)
- [x] Files: src/mocks/eligibility-review.ts, src/mocks/eligibility-review-data.ts, src/pages/compliance/eligibility/page.tsx, EligibilityHeader.tsx, ResidencyTests.tsx, FundingPanel.tsx, PriorAttainmentPanel.tsx, EligibilityOutcome.tsx

### Initial Assessment (Phase 1l) ✅ COMPLETE
- [x] BKSB assessment results for English and Maths with subject tabs — initial level, diagnostic level, score, time taken, proctored status, and 5 individual skill area breakdowns with percentage bars (Reading Comprehension, Spelling, Grammar, Punctuation, Vocabulary / Number & Calculation, FDP, Data Handling, MS&S, Problem Solving)
- [x] Each skill area colour-coded: above (emerald), at (primary), below (amber), well-below (red)
- [x] VARK Learning Style profile with 4-dimension percentage bars (Visual, Auditory, Reading/Writing, Kinaesthetic), primary and secondary style identification, date assessed, and personalised learning recommendations list
- [x] Programme Readiness Score with SVG donut ring visualization, 5-domain breakdown (Academic Readiness, Motivation & Commitment, Workplace Integration, Digital Literacy, Independent Learning), band classification (Ready/Ready with Support/Requires Development/Not Ready), and assessor notes
- [x] Support Requirements panel with per-item type, detail, urgency (standard/priority/critical), recommended flag, and cost implication — critical items get red-alert styling
- [x] Diagnostic summary and assessor recommendation callout boxes
- [x] 7 initial assessment statuses: Not Started, Awaiting BKSB, Awaiting Diagnostics, Assessed, Below Required Level, Requires LSP, Ready for Programme, Escalated
- [x] 6 realistic learner records: Sophie Martin (Ready for Programme — 82% readiness, BKSB L2 English & Maths, Visual learner), Daniel Walsh (Requires LSP — confirmed dyslexia, 58% readiness, spelling 44%, Visual-Kinaesthetic learner, 3 support requirements), Joshua Bennett (Below Required Level — Maths Entry Level 3, English Level 1, 32% readiness, functional skills programme needed), Chloe Parkinson (Ready for Programme — 86% readiness, BKSB L2, Multimodal learner, exceptional motivation 95%), Mia Okonkwo (Assessed — 74% Ready with Support, anxiety access arrangements, Visual learner), Ryan Fletcher (Not Started — employer contracting incomplete)
- [x] 4-tab detail panel: Overview (BKSB + Readiness + Learning Style), BKSB Results (expanded with subject tabs), Support & Style (Readiness + Learning Style + Support), History
- [x] Records sidebar with search, status filter, risk filter, compact cards showing readiness percentage
- [x] Stats banner: Total Assessed (6), Ready for Programme (3), Requires LSP (1), Below Required (1)
- [x] Route: /compliance/initial-assessment — accessible from Compliance Control Centre sidebar (badge: 6)
- [x] Files: src/mocks/initial-assessment.ts, src/mocks/initial-assessment-data.ts, src/pages/compliance/initial-assessment/page.tsx, InitialAssessmentHeader.tsx, BKSBPanel.tsx, LearningStylePanel.tsx, ReadinessScore.tsx

### RPL / Skills Scan (Phase 1m) ✅ COMPLETE
- [x] Full KSB mapping table (Knowledge, Skills, Behaviours) with per-item: type badge (colour-coded), reference code, description, RPL percentage bar, assessor decision (Accept/Partial Accept/Reject/Pending), evidence summary, and assessor note — 14 KSBs for Business Admin, 12 for Early Years Educator, 11 for Digital Marketer, 9 for Data Technician, 6 for Customer Service
- [x] Experience-to-Standards Crosswalk: role, employer, duration, responsibilities list (with checkmarks), mapped KSB chips, relevance score percentage, and evidence strength indicator (strong/moderate/weak)
- [x] Duration Reduction Calculator: standard duration vs adjusted duration side-by-side comparison, reduction months and percentage callout, colour-coded breakdown list (category, months saved, reason), approval status and approved-by with date
- [x] Prior qualifications summary panel showing relevant qualifications and RPL potential
- [x] RPL Decision Summary with outcome banner, KSB counts, percentage RPL, and full summary text
- [x] 7 RPL statuses: Not Started, Evidence Collection, RPL In Progress, RPL Applied, RPL Approved, RPL Rejected, Makes Learner Ineligible
- [x] 6 realistic learner records: Sophie Martin (RPL Approved — 57% RPL, 8/14 KSBs recognised, 2-month reduction 18→16), Chloe Parkinson (RPL Applied — 75% RPL, 9/12 KSBs, 3-month reduction 18→15, awaiting QA sign-off), Mia Okonkwo (RPL In Progress — 36% RPL, limited overlap with BTEC Business, good for funding compliance), Daniel Walsh (Not Started — LSP and eligibility pending, BTEC Creative Media Distinction has strong RPL potential), Amina Hussein (Makes Learner Ineligible — BSc CS covers 85%+ of Data Technician KSBs, 7/9 fully met, recommended Level 4 instead), Oliver Grant (Evidence Collection — collecting GCSE and workplace evidence)
- [x] 4-tab detail panel: Overview (KSB Mapping + Duration Calculator + Decision), KSB Mapping (expanded full table), Duration Calculator (expanded with crosswalk), History
- [x] Records sidebar with search, status filter, risk filter, compact cards showing RPL percentage and reduction months
- [x] Stats banner: Total In RPL (6), RPL Approved (2), In Progress (2), RPL Rejected (1)
- [x] Route: /compliance/rpl-review — accessible from Compliance Control Centre sidebar (badge: 6)
- [x] Files: src/mocks/rpl-review.ts, src/mocks/rpl-review-data.ts, src/pages/compliance/rpl-review/page.tsx, RPLHeader.tsx, KSBMappingTable.tsx, DurationCalculator.tsx