# Support chat widget

A floating assistant on the learner Home page. The learner asks a question, the
bot answers from the support team's knowledge base, and if it cannot resolve the
problem it offers to open a ticket, put them through to a live agent, or book a
session — without the learner leaving the LMS.

The bot itself lives in the Kent Support Desk, not here. This repository only
contains the widget that talks to it, and the SSO endpoint that tells it who the
learner is.

## What this branch adds

| File | What it does |
| --- | --- |
| `frontend/src/components/SupportChatWidget.tsx` | The widget: launcher, chat panel, and the calls to the support API |
| `frontend/src/pages/learner/home/page.tsx` | Mounts the widget (two lines) |
| `backend/login/support_sso.py` | Issues a short-lived signed token identifying the signed-in learner |
| `backend/login/urls.py` | Routes `login_api/support/authorize/` to that endpoint |

## Settings

### Frontend — optional

The widget defaults to the deployed support portal, so it works with no
configuration. Override only when pointing at a local backend:

```env
VITE_SUPPORT_API_BASE=http://127.0.0.1:8010
VITE_SUPPORT_PORTAL_BASE=http://127.0.0.1:3001
```

### Backend — required for the SSO endpoint

```env
SUPPORT_SSO_SECRET=<must match the support portal's own SUPPORT_SSO_SECRET>
SUPPORT_SSO_CALLBACK_URL=https://technicalsupport.kentbusinesscollege.net/lms
SUPPORT_SSO_TOKEN_TTL=300
```

The secret is shared with the support portal and is what makes the learner's
identity trustworthy — ask Khaled for the value rather than inventing one. If
the two sides differ, every sign-in fails with "this sign-in link could not be
verified".

## Two things to know before it ships

**The support portal must allow this origin.** It only accepts browser calls
from origins listed in its own `CORS_ALLOWED_ORIGINS`. `lms.kentbusinesscollege.org`
is already there; a new environment on a different hostname needs adding.

**The widget is deliberately only on Home.** Its launcher is positioned against
the Inclusion & Safeguarding tab, which exists on that page alone, and Home is
the one learner page that does not render the shared workspace shell. Mounting
it elsewhere would put the launcher somewhere arbitrary.

That last point also matters for what the bot says: a learner chatting from Home
cannot see the sidebar, so the assistant is told to explain how to reach a page
rather than to say "open it from the menu". That instruction lives in the support
portal's knowledge base, not here.

## Behaviour worth knowing

- **Conversations survive navigation.** The widget keeps the thread in
  `localStorage`, keyed per learner, capped at the last 60 messages. A **Clear**
  button in its header wipes the thread and the saved copy. Clearing only makes
  the widget forget a ticket — the ticket itself stays open in the support system.
- **The learner decides when to escalate.** The assistant offers; it does not
  open a ticket on its own.
- **Pressing an option is an instruction, not a question.** The support portal
  carries it out directly rather than interpreting it, so "book a session" cannot
  be mistaken for the LMS's own coach booking.
