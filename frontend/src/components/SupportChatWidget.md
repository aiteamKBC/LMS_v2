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
| `frontend/src/assets/support-robot.lottie.json` | The launcher mascot's animation (see **The mascot** below) |
| `frontend/src/pages/learner/home/page.tsx` | Mounts the widget (two lines) |
| `backend/login/support_sso.py` | Issues a short-lived signed token identifying the signed-in learner |
| `backend/login/urls.py` | Routes `login_api/support/authorize/` to that endpoint |

## The mascot

The launcher is a waving support robot, played with Lottie.

| | |
| --- | --- |
| Source | LottieFiles public animation `7cd2dc17-51bb-40a1-9efb-b4870cabc98c`, "chatbot waving" |
| Licence | Lottie Simple License — commercial use permitted, no attribution required |
| Dependency | `lottie-web` ^5.13.0 light SVG player (MIT) |
| File | 235 KB JSON, 800×800, 194 frames at 30fps |

**Its colours cannot be themed.** The artwork is raster, not vector: eight PNG
layers (eyes, mouth, both arms, head, body, thruster glow) that the animation
moves around. There are no shape fills in the JSON to recolour, so the robot
keeps its original blue-and-white palette rather than the college purple. Giving
it KBC colours would mean either repainting the eight PNGs or commissioning a
vector mascot — a design job, not a code change.

The licence covers use, not ownership. A mascot that belongs to the college
outright still needs an original commissioned design.

Two consequences worth knowing:

- **The launcher is a transparent button, not a purple disc.** The character
  fills a 104px square with its own glow; boxing it in a circle would crop it.
  That is also why hover drops the drop-shadow and scales instead.
- **The animation contains no Lottie expressions.** The widget uses the
  SVG-only light player, which preserves the keyframed motion without shipping
  the expression engine or requiring `eval`/`'unsafe-eval'`.

The small SVG face in the chat panel's header is unchanged. It is a flat avatar
in the brand colours and reads better at 24px than the full character would.

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

**The widget is deliberately only on Home.** Home is the one learner page that
does not render the shared workspace shell, so the launcher has the corner to
itself there. Mounting it elsewhere would drop it on top of that shell's own
furniture.

That last point also matters for what the bot says: a learner chatting from Home
cannot see the sidebar, so the assistant is told to explain how to reach a page
rather than to say "open it from the menu". That instruction lives in the support
portal's knowledge base, not here.

## Behaviour worth knowing

- **Conversations survive navigation.** The widget keeps the thread in
  `localStorage`, keyed per learner, capped at the last 60 messages. A **Clear**
  button in its header wipes the thread and the saved copy. Clearing only makes
  the widget forget a ticket — the ticket itself stays open in the support system.
- **The launcher can be dragged.** It starts in the bottom-right corner, above
  the page's sign-off. Wherever the learner drops it is kept in `localStorage`
  under their own key, so it survives leaving Home and coming back. The position
  is held as a distance from the bottom-right corner rather than the top-left,
  because browser zoom changes the viewport's size in CSS pixels and a
  top-left-anchored launcher wanders across the page every time someone zooms.
- **The learner decides when to escalate.** The assistant offers; it does not
  open a ticket on its own.
- **Pressing an option is an instruction, not a question.** The support portal
  carries it out directly rather than interpreting it, so "book a session" cannot
  be mistaken for the LMS's own coach booking.
