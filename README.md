<div align="center">
  <img src="frontend/public/kbc-logo.png" alt="Kent Business College" width="260" />

  <h1>KBC LearningOS</h1>

  <p><strong>A connected, evidence-led operating system for apprenticeship delivery.</strong></p>

  <p>
    Learning · Coaching · Curriculum · Compliance · Quality assurance · Reporting
  </p>

  <p>
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
    <img alt="TypeScript 5.8" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" />
    <img alt="Django 6" src="https://img.shields.io/badge/Django-6-092E20?logo=django&logoColor=white" />
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white" />
    <img alt="Project status" src="https://img.shields.io/badge/Status-Active%20Development-7C3AED" />
  </p>
</div>

---

<img src="frontend/public/hero-clean.png" alt="KBC LearningOS platform overview" width="100%" />

## Contents

- [Overview](#overview)
- [Platform capabilities](#platform-capabilities)
- [Users and workspaces](#users-and-workspaces)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Development commands](#development-commands)
- [API surface](#api-surface)
- [Quality and security](#quality-and-security)
- [Contributing](#contributing)
- [Documentation](#documentation)
- [Ownership](#ownership)

## Overview

**KBC LearningOS** is Kent Business College's apprenticeship management and
learning platform. It connects onboarding, programme delivery, learner support,
evidence, attendance, progress reviews, quality assurance, and operational
reporting in one role-aware system.

The platform is designed around a shared learner record. Each workspace exposes
the information and actions appropriate to its role while preserving ownership,
audit history, and programme context across the learner journey.

> [!IMPORTANT]
> This repository is under active development and contains integrations with
> managed databases, Microsoft services, Azure Storage, and AI providers. Use
> approved development credentials only, and never run schema or live-integration
> commands against a shared environment without the project owner's approval.

## Platform capabilities

| Area | Capabilities |
| --- | --- |
| Learning delivery | Personalised learning plans, modules, activities, videos, assignments, quizzes, and KSB progression |
| Coaching | Caseload management, progress reviews, action plans, intervention queues, and learner communication |
| Curriculum | Programme, cohort, group, module, week, component, holiday, and session planning |
| Evidence and compliance | Evidence upload and review, OTJH validation, signatures, audit trails, and gateway readiness |
| Attendance and meetings | Session calendars, Microsoft Teams meetings, attendance, recordings, and transcripts |
| Quality and operations | QA sampling, compliance workflows, enrolment, reports, dashboards, and data reconciliation |
| Engagement | Risk signals, outreach, rewards, claims, notifications, and re-engagement workflows |
| Communication | Real-time chat, role-aware notifications, email, calendar, and file integrations |

## Users and workspaces

| Workspace | Primary focus |
| --- | --- |
| Learner | Learning, evidence, progress, attendance, reviews, and support |
| Coach | Caseload oversight, coaching activity, actions, risk, and reviews |
| Tutor | Teaching sessions, marking, feedback, attendance, and validation |
| Employer | Learner oversight, workplace evidence, and review participation |
| Curriculum | Programme design, KSB coverage, cohorts, groups, and scheduling |
| Engagement | Attendance risk, outreach, intervention, and rewards |
| Compliance and MIS | Enrolment, documentation, data quality, and reporting |
| QA and auditor | Sampling, assurance, traceability, and inspection evidence |
| Leadership and finance | Performance, operational insight, and oversight |
| Administrator | Accounts, roles, permissions, tenants, and integrations |

## Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                    React + TypeScript client                       │
│  Role workspaces · Learning journey · Curriculum · Reporting      │
└───────────────────────────────┬────────────────────────────────────┘
                                │ REST + WebSocket
┌───────────────────────────────▼────────────────────────────────────┐
│                         Django application                         │
│ Login · Learner · Coach · Curriculum · Quiz · Audit · Chat · MIS  │
└───────────────┬──────────────────────┬────────────────────┬────────┘
                │                      │                    │
       ┌────────▼────────┐    ┌────────▼────────┐   ┌──────▼─────────┐
       │ PostgreSQL /    │    │ Redis / Django │   │ Azure Storage  │
       │ Neon            │    │ Channels       │   │ Evidence files │
       └─────────────────┘    └─────────────────┘   └────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │ Microsoft + AI services│
                    └────────────────────────┘
```

The Vite development server proxies API, media, and WebSocket traffic to the
Django application. Django REST Framework serves the HTTP APIs, Django Channels
provides real-time communication, and PostgreSQL/Neon is the primary connected
data store. Redis supports Channels and shared caching when configured.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript 5.8, Vite 8, React Router, TanStack Query, Tailwind CSS |
| UI and visualisation | Radix UI, Lucide, Recharts, SweetAlert2 |
| Backend | Python 3.12+, Django 6, Django REST Framework, Django Channels |
| Data | PostgreSQL/Neon, Redis, SQLite for isolated local and test scenarios |
| Storage and integrations | Azure Blob Storage, Microsoft Graph, OpenAI, Aptem-connected workflows |
| Testing | Vitest, Testing Library, Playwright, and Django test tooling |

## Repository structure

```text
LMS_v2/
├── backend/                    Django application and domain APIs
│   ├── config/                 Settings, routing, ASGI, caching, and middleware
│   ├── login/                  Platform sessions, roles, invitations, and access
│   ├── learner_api/            Learner journey, evidence, attendance, and calendar
│   ├── coach_api/              Coaching, reviews, bookings, and interventions
│   ├── curriculum_api/         Programmes, modules, sessions, KSBs, and Teams
│   ├── enrolment_api/          Onboarding, agreements, and learner records
│   ├── progress_reviews_api/   Review workflows and supporting records
│   ├── audit_api/              Hours, evidence, reconciliation, and reporting
│   ├── manual_audit_api/       Manual audit classification and review
│   ├── engagement_api/         Engagement, rewards, claims, and notifications
│   ├── quiz_api/               Quiz delivery, attempts, and configuration
│   └── chat/                   Persisted chat and WebSocket services
├── frontend/                   React single-page application
│   ├── public/                 Static brand and application assets
│   └── src/                    Features, pages, components, APIs, hooks, and tests
├── .gitignore                  Repository allowlist and local-file exclusions
├── AGENTS.md                   Shared repository working policy
└── README.md                   Project overview and developer guide
```

## Local development

### Prerequisites

- Python 3.12 or later
- Node.js 20.19+ or 22.12+
- npm
- Access to an approved database environment for connected workflows
- Redis when testing real-time chat or shared-cache behaviour

### 1. Clone the repository

```bash
git clone https://github.com/aiteamKBC/LMS_v2.git
cd LMS_v2
```

### 2. Prepare the backend

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS or Linux
source .venv/bin/activate
```

Install the pinned dependencies and start Django:

```bash
python -m pip install -r requirements.txt
python manage.py runserver
```

The backend listens on `http://127.0.0.1:8000` by default.

> [!CAUTION]
> Database provisioning and schema commands are environment-specific. Do not run
> migrations, bootstrap commands, seeders, or repair scripts against a shared
> database. Obtain the approved environment and setup procedure from the project
> owner first.

### 3. Prepare the frontend

Open a second terminal at the repository root:

```bash
cd frontend
npm ci
npm run dev
```

The frontend runs at `http://localhost:3000` and proxies local requests to the
Django server. To use a different backend address, set `VITE_API_TARGET` in a
local environment file.

## Configuration

Django reads local values from `backend/.env`. Vite reads its standard
environment files from `frontend/`. All real environment files are ignored by
Git; commit only sanitized examples.

| Area | Common variables |
| --- | --- |
| Django | `DJANGO_DEBUG`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `SYSTEM_TIME_ZONE` |
| Database | `DATABASE_URL`, `ENROLMENT_DATABASE_URL`, `AUDIT_DATABASE_URL` |
| Redis | `CHAT_REDIS_URL`, `CACHE_URL`, `CACHE_KEY_PREFIX` |
| Frontend proxy | `VITE_API_TARGET` or `VITE_API_PROXY` |
| Azure Storage | `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, container settings |
| Microsoft integration | Tenant, client, organizer, mail, calendar, and Graph settings |
| AI services | `OPENAI_API_KEY` and the feature-specific model settings |

Never commit credentials, database URLs, learner data, exported evidence, or
tenant identifiers. See the integration guides in [Documentation](#documentation)
for the required provider-specific settings.

## Development commands

Run frontend commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm --prefix frontend run dev` | Start the Vite development server |
| `npm --prefix frontend run type-check` | Validate TypeScript types |
| `npm --prefix frontend run lint` | Run ESLint with zero warnings allowed |
| `npm --prefix frontend test` | Run the Vitest suite once |
| `npm --prefix frontend run test:teams` | Run the protected Teams regression baseline |
| `npm --prefix frontend run test:learner` | Run learner-focused regression tests |
| `npm --prefix frontend run build` | Create the production bundle in `frontend/out` |

Backend management commands must be run from `backend/` with the virtual
environment active. Verify the target database and external-service side effects
before running any command. Backend suites that create tables or fixtures require
an approved isolated test environment.

## API surface

| Prefix | Responsibility |
| --- | --- |
| `/login_api/` | Sign-in, sessions, invitations, resets, and platform access |
| `/learner_api/` | Learner profiles, journey, evidence, attendance, and calendar |
| `/coach_api/` | Coaching workflows, bookings, reviews, and interventions |
| `/curriculum_api/` | Programmes, modules, sessions, KSBs, and Teams management |
| `/enrolment_api/` | Enrolment, onboarding, agreements, and documents |
| `/api/progress-reviews/` | Progress-review workflows and supporting records |
| `/quiz_api/` | Quiz configuration, delivery, attempts, and results |
| `/engagement_api/` | Engagement, rewards, claims, and notifications |
| `/audit_api/` | Hours, evidence, reconciliation, and reports |
| `/manual_audit_api/` | Manual audit rows and classification |
| `/api/chat/` | Conversations and persisted messages |
| `/api/calendar/` | Personal-calendar integration |
| `/api/batch/` | Batched read requests |
| `/ws/chat/<conversation_id>/` | Real-time conversation channel |
| `/django_admin/` | Django administration |

## Quality and security

- Authorization and record ownership are enforced server-side.
- Session cookies are server-managed and configured for secure deployment.
- Evidence follows quarantine, review, approval, or rejection workflows.
- Approved cloud downloads use short-lived, read-only access URLs.
- Production builds do not publish frontend source maps.
- Tests must use mocked external providers unless live validation is explicitly
  approved for a designated test environment.
- Teams meeting identity, attendees, options, dates, attendance, and recordings
  are protected regression boundaries throughout the platform.

## Contributing

1. Read [`AGENTS.md`](AGENTS.md) before investigating or changing the project.
2. Keep each change focused and preserve unrelated work in the shared tree.
3. Never commit secrets, personal learner data, local exports, generated media,
   or environment-specific configuration.
4. Attribute commits to the people who authored the work. Automated assistants
   must not be added as commit co-authors or repository contributors.
5. Run the Teams baseline and the affected feature checks before handoff.
6. Leave commits, pushes, pulls, and pull requests to the project owner unless
   the team's process explicitly assigns them to you.

Configure local AI tools to disable automatic attribution in commit messages and
pull-request descriptions. Personal tool state remains local and is excluded by
`.gitignore`.

## Documentation

- [`AGENTS.md`](AGENTS.md) — repository policy, scope controls, and validation gates
- [`frontend/project_plan.md`](frontend/project_plan.md) — product vision and workspace roadmap
- [`backend/AZURE_SETUP.md`](backend/AZURE_SETUP.md) — Azure mail and storage setup
- [`backend/MICROSOFT_SSO_SETUP.md`](backend/MICROSOFT_SSO_SETUP.md) — Microsoft SSO setup
- [`backend/LOGIN_TESTS.md`](backend/LOGIN_TESTS.md) — authentication test coverage
- [`backend/progress_reviews_api/README.md`](backend/progress_reviews_api/README.md) — progress-review API notes

## Ownership

KBC LearningOS is proprietary software developed for Kent Business College.
All rights are reserved unless the project owner states otherwise.

---

<div align="center">
  <strong>Kent Business College</strong><br />
  Building confident learners through connected, high-quality apprenticeship delivery.
</div>
