<div align="center">
  <img src="frontend/public/kbc-logo.png" alt="Kent Business College logo" width="280" />

  <h1>KBC LearningOS</h1>

  <p><strong>The apprenticeship operating system for connected, evidence-led delivery.</strong></p>

  <p>
    One platform for learning, coaching, curriculum, compliance, quality assurance,<br />
    employer engagement, and operational insight.
  </p>

  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" />
    <img alt="Django" src="https://img.shields.io/badge/Django-6.0-092E20?logo=django&logoColor=white" />
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Ready-4169E1?logo=postgresql&logoColor=white" />
    <img alt="Status" src="https://img.shields.io/badge/Status-Active%20Development-7C3AED" />
  </p>
</div>

---

<img src="frontend/public/hero-clean.png" alt="KBC LearningOS — connected apprenticeship delivery" width="100%" />

## Contents

- [Project at a Glance](#project-at-a-glance)
- [Overview](#overview)
- [Why LearningOS?](#why-learningos)
- [Platform Capabilities](#platform-capabilities)
- [Users and Workspaces](#users-and-workspaces)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Development Commands](#development-commands)
- [API Overview](#api-overview)
- [Quality and Security](#quality-and-security)
- [Documentation](#documentation)

## Project at a Glance

| | |
| --- | --- |
| **Product** | Enterprise apprenticeship management and learning platform |
| **Organisation** | Kent Business College |
| **Architecture** | React single-page application with Django REST and WebSocket services |
| **Primary users** | Learners, delivery staff, employers, operations, quality, and leadership teams |
| **Data services** | PostgreSQL/Neon, Redis, Azure Blob Storage, and local SQLite fallback |
| **Lifecycle** | Active development |

## Overview

**KBC LearningOS** is an enterprise learning management and apprenticeship delivery platform developed for **Kent Business College**. It connects every stage of the apprenticeship journey—from onboarding and programme delivery to evidence validation, gateway readiness, and audit preparation.

The platform gives each stakeholder a focused, role-aware workspace while maintaining a shared operational view of learner progress, risk, compliance, and quality. Its evidence-first approach helps delivery teams turn day-to-day activity into clear, inspection-ready records.

> [!NOTE]
> KBC LearningOS is under active development. The current application combines production-oriented Django APIs with demonstration data used to validate selected workflows and the wider product experience.

## Why LearningOS?

Apprenticeship delivery typically spans disconnected learning tools, spreadsheets, evidence stores, communication channels, and compliance systems. LearningOS brings those workflows together around a single learner journey.

| Challenge | LearningOS response |
| --- | --- |
| Fragmented learner records | A unified learner profile, training plan, timeline, and evidence history |
| Limited visibility of risk | Attendance, engagement, progress, and intervention signals in role-based dashboards |
| Manual evidence administration | Structured upload, review, approval, KSB mapping, and audit trails |
| Disconnected delivery teams | Shared workflows for learners, coaches, tutors, employers, QA, MIS, and compliance |
| Inspection preparation overhead | Evidence-led reporting with traceable decisions and quality controls |

## Platform Capabilities

### Learning and progress

- Personalised training plans and weekly learning pathways
- Module, activity, video, assignment, and quiz delivery
- Knowledge, Skills, and Behaviours (KSB) progression
- Off-the-job-hours recording and validation
- Gateway and end-point assessment readiness
- Learner rewards, badges, and engagement features

### Coaching and delivery

- Coach and tutor caseload workspaces
- Learner reviews, action plans, and intervention queues
- Coaching calendars and scheduled sessions
- Assignment marking and feedback workflows
- Evidence, KSB, and OTJH validation
- Attendance, absence, and catch-up management

### Curriculum and quality

- Programme, module, week, and component builders
- Curriculum-to-KSB mapping and coverage analysis
- Cohort, group, session, and staff assignment management
- Quality assurance, sampling, and audit workspaces
- Compliance, enrolment, and document workflows
- Inspection-ready reporting and evidence trails

### Organisation and communication

- Role-based workspaces and permission-aware navigation
- Employer and engagement management
- Real-time direct messaging using WebSockets
- Leadership, finance, MIS, administration, and auditor views
- Internationalisation-ready user interface
- AI-assisted reflection, transcription, moderation, and staff support

## Users and Workspaces

LearningOS supports the wider apprenticeship delivery ecosystem:

| Workspace | Primary focus |
| --- | --- |
| Learner | Learning activities, evidence, progress, attendance, and support |
| Coach | Caseload oversight, reviews, actions, risk, and learner communication |
| Tutor | Teaching sessions, marking, feedback, and validation queues |
| Employer | Learner oversight, evidence confirmation, and workplace engagement |
| Engagement | Attendance risk, outreach, intervention, and re-engagement |
| Curriculum | Programme design, learning structure, KSB mapping, and scheduling |
| Compliance & MIS | Onboarding, documentation, data quality, cohorts, and reporting |
| QA & Auditor | Sampling, assurance, traceability, and inspection evidence |
| Leadership & Finance | Operational intelligence, performance, budgets, and oversight |
| Administrator | Users, roles, permissions, tenants, integrations, and system settings |

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                    React + TypeScript Client                    │
│  Role workspaces · Learning journey · Curriculum · Reporting   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ REST + WebSocket
┌──────────────────────────────▼──────────────────────────────────┐
│                       Django Application                        │
│  Learner · Coach · Curriculum · Quiz · Engagement · Audit · Chat│
└──────────────┬──────────────────────┬──────────────────┬────────┘
               │                      │                  │
       ┌───────▼────────┐     ┌───────▼────────┐  ┌─────▼─────────┐
       │ PostgreSQL /   │     │ Redis Channels │  │ Azure Storage │
       │ Neon / SQLite  │     │ Real-time chat │  │ Evidence files│
       └────────────────┘     └────────────────┘  └───────────────┘
                                      │
                              ┌───────▼────────┐
                              │ OpenAI services│
                              │ AI assistance  │
                              └────────────────┘
```

The Vite development server proxies REST, media, and WebSocket traffic to Django. Django REST Framework provides the application APIs, while Django Channels and Redis support real-time messaging. PostgreSQL is the primary production data store; SQLite provides a lightweight local fallback.

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, React Router, Tailwind CSS |
| Data visualisation | Recharts |
| Internationalisation | i18next, react-i18next |
| Backend | Python 3.12+, Django 6, Django REST Framework |
| Real-time services | Django Channels, Redis |
| Data | PostgreSQL, Neon, SQLite for local development |
| Cloud and AI | Azure Blob Storage, Microsoft integrations, OpenAI API |
| Testing | Vitest, Testing Library, Django test framework |

## Repository Structure

```text
LMS/
├── backend/                    Django application and APIs
│   ├── audit_api/              Audit evidence and reporting
│   ├── chat/                   Messaging and WebSocket services
│   ├── coach_api/              Coaching, calendars, and absence workflows
│   ├── config/                 Django project configuration
│   ├── curriculum_api/         Programmes, modules, sessions, and KSBs
│   ├── engagement_api/         Engagement monitoring and rewards
│   ├── enrolment_api/          Enrolment, onboarding, and agreements
│   ├── learner_api/            Learner data, evidence, and attendance
│   ├── manual_audit_api/       Manual audit rows and classification
│   └── quiz_api/               Quiz delivery and configuration
├── frontend/                   React and TypeScript client
│   └── src/
│       ├── api/                Typed API clients
│       ├── components/         Shared and feature-level components
│       ├── hooks/              Reusable application hooks
│       ├── mocks/              Demonstration datasets
│       ├── pages/              Feature and role workspaces
│       └── router/             Route definitions
└── reports/                    Data reconciliation and audit outputs
```

## Getting Started

### Prerequisites

- Python 3.12 or later
- Node.js 20.19+ or 22.12+
- npm
- Redis for real-time messaging (optional for basic UI development)
- PostgreSQL for connected platform data (optional when using SQLite)

### 1. Clone the repository

```bash
git clone https://github.com/aiteamKBC/LMS.git
cd LMS
```

### 2. Start the backend

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

Install dependencies, apply migrations, and start Django:

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

The backend runs at **http://127.0.0.1:8000**.

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The application runs at **http://localhost:3000**. Vite proxies local API, media, and WebSocket requests to the Django server on port `8000`.

## Configuration

Django loads local configuration from `backend/.env`. Environment files are excluded from version control and must never contain committed credentials.

SQLite is used automatically when no database URL is provided. A connected development environment can be configured as follows:

```dotenv
# Application
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1

# Data
DATABASE_URL=postgresql://user:password@host:5432/database
ENROLMENT_DATABASE_URL=postgresql://user:password@host:5432/enrolment_database

# Real-time messaging
CHAT_REDIS_URL=redis://127.0.0.1:6379/1
CHAT_DEMO_BOOTSTRAP_ENABLED=true

# Shared API cache (use the deployment's Redis service in production)
CACHE_URL=redis://127.0.0.1:6379/2
CACHE_KEY_PREFIX=kbc-lms
CACHE_DEFAULT_TIMEOUT=300

# Optional API profiling. Adds Server-Timing and X-DB-Query-Count headers and
# logs requests slower than the configured threshold.
PERFORMANCE_DIAGNOSTICS=false
SLOW_REQUEST_THRESHOLD_MS=750

# AI services
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_REFLECTION_MODEL=gpt-4o-mini
OPENAI_MODERATION_MODEL=omni-moderation-latest

# Secure evidence storage
AZURE_STORAGE_ACCOUNT=
AZURE_STORAGE_KEY=
AZURE_QUARANTINE_CONTAINER=evidence-quarantine
AZURE_APPROVED_CONTAINER=evidence-approved
AZURE_REJECTED_CONTAINER=evidence-rejected
AZURE_SAS_TTL_MINUTES=15
```

Frontend proxy targets can also be overridden:

```dotenv
VITE_API_TARGET=http://127.0.0.1:8000
VITE_API_PROXY=http://127.0.0.1:8000
VITE_API_BASE_URL=/curriculum_api
VITE_CHAT_API_BASE_URL=/api/chat
VITE_CHAT_WS_BASE_URL=ws://127.0.0.1:8000
```

Microsoft Graph, attendance, enrolment, and audit integrations require additional credentials. They are not required for basic local UI development.

## Development Commands

### Frontend

Run these commands from `frontend/`:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Create a production build in `frontend/out` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint with zero warnings allowed |
| `npm run type-check` | Validate TypeScript types |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |

### Backend

Run these commands from `backend/`:

| Command | Description |
| --- | --- |
| `python manage.py runserver` | Start the Django development server |
| `python manage.py migrate` | Apply database migrations |
| `python manage.py createsuperuser` | Create a Django administrator |
| `python manage.py test` | Run the backend test suite |
| `python manage.py create_calendar_busy_slots_table` | Create the learner personal-calendar busy-slot cache |
| `python manage.py sync_calendar_busy_slots` | Refresh connected learner calendars (defaults to the next 90 days) |

Run `sync_calendar_busy_slots` every 10–15 minutes in the deployment scheduler. Example cron entry:

```cron
*/15 * * * * cd /path/to/LMS/backend && .venv/bin/python manage.py sync_calendar_busy_slots
```

The cache stores only start/end times and never stores personal event titles, descriptions, attendees, or locations. Booking endpoints still perform a live provider check before confirming a session.

Set `DJANGO_USE_SQLITE=true` to run backend tests against the isolated SQLite
configuration. PostgreSQL-only `chat` and `coach_api` migration histories are
skipped in that mode; Django creates their current test models directly, while
production continues to use the complete PostgreSQL migration history.

For production, set `DJANGO_DEBUG=false`, use the pooled PostgreSQL/Neon
connection URL for `DATABASE_URL`, and configure `CACHE_URL` so all Django
workers share the same curriculum cache. `GZipMiddleware` compresses large JSON
responses automatically when compression has not already been applied by the
reverse proxy.

After deploying, create the project-wide query indexes (the command safely
skips schemas/tables that are not present and can be run repeatedly):

```bash
python manage.py apply_performance_indexes --dry-run
python manage.py apply_performance_indexes
```

Curriculum module and component collections support opt-in server pagination:
`?page=1&page_size=50`. Module collections also accept `programme_id`,
`cohort_id`, `group_id`, `status`, and `compact=true`; component collections
accept `module_catalogue_ids=MOD-1,MOD-2`. Existing clients remain unpaginated
unless they send pagination parameters.

## API Overview

| Endpoint | Responsibility |
| --- | --- |
| `/learner_api/` | Learner profiles, attendance, evidence, quizzes, and reflections |
| `/coach_api/` | Coaching workflows, calendar events, messages, and absences |
| `/curriculum_api/` | Programmes, modules, sessions, staff, and KSB mappings |
| `/quiz_api/` | Quiz settings, content, and course links |
| `/engagement_api/` | Engagement monitoring and reward data |
| `/enrolment_api/` | Enrolment, onboarding, and agreement workflows |
| `/audit_api/` | Audit evidence and reporting |
| `/manual_audit_api/` | Manual audit rows and evidence classification |
| `/api/chat/` | Conversations and persisted messages |
| `/api/calendar/` | Learner personal-calendar integration |
| `/api/batch/` | Batched GET requests for reduced round-trips |
| `/ws/chat/<conversation_id>/` | Real-time conversation channel |
| `/admin/` | Django administration |

## Quality and Security

- API credentials, database URLs, and cloud storage keys must remain outside version control.
- Learner evidence follows a quarantine, validation, approval, or rejection lifecycle.
- Approved evidence downloads use short-lived, read-only Azure SAS URLs.
- Production deployments must disable Django debug mode and use a securely managed secret key.
- Production traffic should be served over HTTPS with explicit allowed hosts, trusted origins, and restricted cloud storage access.
- Frontend production builds do not publish source maps.

## Documentation

- [`frontend/project_plan.md`](frontend/project_plan.md) — product vision, workspaces, and feature roadmap

## Ownership

KBC LearningOS is proprietary software developed for Kent Business College. All rights reserved unless otherwise stated by the project owner.

---

<div align="center">
  <strong>Kent Business College</strong><br />
  Building confident learners through connected, high-quality apprenticeship delivery.
</div>
