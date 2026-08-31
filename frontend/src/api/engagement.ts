// ============================================================================
// Engagement API client.
// Talks to the Django engagement_api at /engagement_api (proxied to :8000 by
// Vite in dev — see vite.config.ts). Mirrors the self-contained
// request<T>() + fetch pattern in api/curriculum.ts / api/quizzes.ts
// (no axios, no react-query).
//
// Two boundary conventions handled here so the pages don't have to:
//  - IDs: the backend uses integer primary keys; the frontend types use
//    string ids (e.g. 'rw-01' in the mocks). We coerce number -> string on
//    the way in, and pass string ids straight back in the URL on the way out.
//  - Learner display fields: the backend voucher-claim stores only
//    learnerId + learner (name). The UI also needs avatar/programme/cohort,
//    which are owned by another team and stay MOCKED. We enrich each claim
//    from ENGAGEMENT_LEARNERS here (one-way dependency: api -> mocks) so
//    pages keep consuming the same full VoucherClaim shape as before.
// ============================================================================

import type { RewardItem, VoucherClaim, Recognition } from '@/mocks/engagement-data';

const BASE = '/engagement_api';

// Format a backend ISO timestamp into the friendly 'D MMM YYYY' the UI expects
// (the mocks used strings like '8 Jun 2026'). Falls back to the raw value if
// it isn't a parseable date.
function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- Session cookie + CSRF -------------------------------------------------
// Every engagement mutation now requires the kbc_session cookie (server derives
// identity from it — see engagement_api/permissions.py) and, since the views
// dropped @csrf_exempt, Django's own CSRF check on unsafe methods. The token
// endpoint is shared, app-agnostic Django CSRF bootstrap (see
// backend/coach_api/csrf.py) — reused here rather than duplicated.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_ENDPOINT = '/coach_api/csrf';

let csrfTokenPromise: Promise<string> | null = null;

async function requestCsrfToken(): Promise<string> {
  const response = await fetch(CSRF_ENDPOINT, { credentials: 'include' });
  const payload = (await response.json().catch(() => ({}))) as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) {
    throw new Error('Unable to initialise request verification.');
  }
  return payload.csrfToken;
}

function csrfToken(): Promise<string> {
  if (!csrfTokenPromise) {
    csrfTokenPromise = requestCsrfToken().catch(error => {
      csrfTokenPromise = null;
      throw error;
    });
  }
  return csrfTokenPromise;
}

async function request<T>(url: string, options?: { method?: string; body?: string }): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (UNSAFE_METHODS.has(method)) {
    headers['X-CSRFToken'] = await csrfToken();
  }

  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', headers, ...options });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

// ---- Rewards -------------------------------------------------------------

export interface RewardInput {
  name: string;
  description: string;
  points: number;
  category: string;
  // No physical vouchers — every reward is fulfilled digitally to the
  // learner's own on-file email. The server always stores 'digital'
  // regardless of what's sent, so there is nothing to set here.
  stock: number;
  image: string;
  popular: boolean;
  active: boolean;
}

// Backend reward -> frontend RewardItem (id number -> string).
function toReward(r: any): RewardItem {
  return { ...r, id: String(r.id) };
}

export async function fetchRewards(): Promise<RewardItem[]> {
  const data = await request<{ rewards: any[] }>(`${BASE}/rewards/`);
  return data.rewards.map(toReward);
}

export async function createReward(input: RewardInput): Promise<RewardItem> {
  const data = await request<{ reward: any }>(`${BASE}/rewards/`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return toReward(data.reward);
}

export async function updateReward(id: string, input: Partial<RewardInput>): Promise<RewardItem> {
  const data = await request<{ reward: any }>(`${BASE}/rewards/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return toReward(data.reward);
}

// ---- Voucher claims ------------------------------------------------------

// Backend claim -> VoucherClaim. Programme fields are not owned by the
// Engagement schema, so they intentionally stay blank rather than being
// filled with mock learner data.
function toClaim(c: any): VoucherClaim {
  return {
    id: String(c.id),
    learnerId: c.learnerId,
    learner: c.learner ?? c.learnerId,
    avatarImg: undefined,
    programmeCode: '',
    programme: '',
    cohort: '',
    rewardId: String(c.rewardId),
    reward: c.reward,
    points: c.points,
    requestedAt: c.requestedAt,
    status: c.status,
    reviewedBy: c.reviewedBy,
    reviewedAt: c.reviewedAt,
    deliveryType: c.deliveryType,
    deliveryMethod: c.deliveryMethod,
    deliveryDetail: c.deliveryDetail,
    deliveryInstructions: c.deliveryInstructions,
  };
}

export interface VoucherClaimInput {
  // The claimant is derived from the signed-in session server-side — the
  // backend ignores any learnerId/learnerName sent here, so there is
  // deliberately nothing to pass for identity.
  rewardId: string;
}

export interface VoucherClaimPatch {
  status?: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  // The reviewer is derived from the signed-in session server-side.
  deliveryDetail?: string;
  deliveryInstructions?: string | null;
}

export async function fetchVoucherClaims(learnerId?: string): Promise<VoucherClaim[]> {
  const query = learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : '';
  const data = await request<{ claims: any[] }>(`${BASE}/voucher-claims/${query}`);
  return data.claims.map(toClaim);
}

export async function createVoucherClaim(input: VoucherClaimInput): Promise<VoucherClaim> {
  const data = await request<{ claim: any }>(`${BASE}/voucher-claims/`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return toClaim(data.claim);
}

export async function updateVoucherClaim(id: string, patch: VoucherClaimPatch): Promise<VoucherClaim> {
  const data = await request<{ claim: any }>(`${BASE}/voucher-claims/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return toClaim(data.claim);
}

// ---- Recognitions --------------------------------------------------------

// Backend recognition -> frontend Recognition. Unlike voucher claims, the
// recognition row stores its own learner display fields, so no enrichment is
// needed — we only coerce the id and humanise the awarded-at date.
function toRecognition(r: any): Recognition {
  return { ...r, id: String(r.id), awardedAt: formatDate(r.awardedAt) };
}

export async function fetchRecognitions(learnerId?: string): Promise<Recognition[]> {
  const query = learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : '';
  const data = await request<{ recognitions: any[] }>(`${BASE}/recognitions/${query}`);
  return data.recognitions.map(toRecognition);
}

export interface RecognitionInput {
  learnerId: string;
  learnerName: string;
  avatarImg?: string;
  programmeCode: string;
  programme: string;
  cohort: string;
  type: Recognition['type'];
  title: string;
  description: string;
  // The awarder is derived from the signed-in session server-side.
  category: string;
  points: number;
  public: boolean;
}

export async function createRecognition(input: RecognitionInput): Promise<Recognition> {
  const data = await request<{ recognition: any }>(`${BASE}/recognitions/`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return toRecognition(data.recognition);
}

export interface RecognitionPatch {
  title?: string;
  description?: string;
  category?: string;
  points?: number;
  public?: boolean;
}

export async function updateRecognition(id: string, patch: RecognitionPatch): Promise<Recognition> {
  const data = await request<{ recognition: any }>(`${BASE}/recognitions/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return toRecognition(data.recognition);
}

// ---- Events --------------------------------------------------------------

// Named EngagementEvent (not Event) to avoid shadowing the DOM Event type.
// The Events page owns this shape locally today; we mirror it here 1:1.
export interface EngagementEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  type: 'workshop' | 'social' | 'networking' | 'competition' | 'celebration';
  attendees: number;
  status: 'upcoming' | 'ongoing' | 'completed';
  organizer: string;
}

export interface EventInput {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  type: EngagementEvent['type'];
  organizer: string;
  status?: EngagementEvent['status'];
  attendees?: number;
}

function toEvent(e: any): EngagementEvent {
  return { ...e, id: String(e.id) };
}

export async function fetchEvents(): Promise<EngagementEvent[]> {
  const data = await request<{ events: any[] }>(`${BASE}/events/`);
  return data.events.map(toEvent);
}

export async function createEvent(input: EventInput): Promise<EngagementEvent> {
  const data = await request<{ event: any }>(`${BASE}/events/`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return toEvent(data.event);
}

export async function updateEvent(id: string, patch: Partial<EventInput>): Promise<EngagementEvent> {
  const data = await request<{ event: any }>(`${BASE}/events/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return toEvent(data.event);
}

export async function deleteEvent(id: string): Promise<void> {
  await request(`${BASE}/events/${id}/`, { method: 'DELETE' });
}

export interface EventBooking {
  id: string;
  eventId: string;
  learnerId: string;
  learner: string;
  email: string;
  status: 'booked' | 'cancelled';
  bookedAt: string;
  cancelledAt?: string | null;
}

function toEventBooking(booking: any): EventBooking {
  return { ...booking, id: String(booking.id), eventId: String(booking.eventId) };
}

export async function fetchEventBookings(learnerId: string): Promise<EventBooking[]> {
  const data = await request<{ bookings: any[] }>(`${BASE}/event-bookings/?learnerId=${encodeURIComponent(learnerId)}`);
  return data.bookings.map(toEventBooking);
}

// The booking learner is derived from the signed-in session server-side —
// the backend ignores any learnerId/learnerName sent here.
export async function createEventBooking(input: { eventId: string; learnerEmail?: string }): Promise<{ booking: EventBooking; event: EngagementEvent }> {
  const data = await request<{ booking: any; event: any }>(`${BASE}/event-bookings/`, { method: 'POST', body: JSON.stringify(input) });
  return { booking: toEventBooking(data.booking), event: toEvent(data.event) };
}

export async function cancelEventBooking(id: string): Promise<{ booking: EventBooking; event: EngagementEvent }> {
  const data = await request<{ booking: any; event: any }>(`${BASE}/event-bookings/${id}/`, { method: 'DELETE' });
  return { booking: toEventBooking(data.booking), event: toEvent(data.event) };
}

// ---- Clubs + meetings ----------------------------------------------------

// Prefixed names to keep the api module's exports unambiguous; the Clubs page
// aliases them back to Club / ClubMeeting on import.
export interface EngagementClubMeeting {
  id: string;
  title: string;
  scheduled: boolean;
  date?: string;
  time?: string;
  venue?: string;
  attendees: number;
}

export interface EngagementClub {
  id: string;
  name: string;
  location: string;
  description: string;
  ambassador: string;
  ambassadorRole: string;
  members: number;
  sampleMembers: string[];
  active: boolean;
  meetings: EngagementClubMeeting[];
}

// Nullable meeting fields come back as null; the page's optional (?) fields
// expect undefined, so normalise here.
function toMeeting(m: any): EngagementClubMeeting {
  return {
    id: String(m.id),
    title: m.title,
    scheduled: m.scheduled,
    date: m.date ?? undefined,
    time: m.time ?? undefined,
    venue: m.venue ?? undefined,
    attendees: m.attendees,
  };
}

function toClub(c: any): EngagementClub {
  return {
    id: String(c.id),
    name: c.name,
    location: c.location,
    description: c.description,
    ambassador: c.ambassador,
    ambassadorRole: c.ambassadorRole,
    members: c.members,
    sampleMembers: c.sampleMembers ?? [],
    active: c.active,
    meetings: (c.meetings ?? []).map(toMeeting),
  };
}

export interface ClubInput {
  name: string;
  location: string;
  description?: string;
  ambassador: string;
  ambassadorRole: string;
  members?: number;
  sampleMembers?: string[];
  active?: boolean;
}

export interface ClubPatch {
  name?: string;
  location?: string;
  description?: string;
  ambassador?: string;
  ambassadorRole?: string;
  members?: number;
  sampleMembers?: string[];
  active?: boolean;
}

export interface MeetingInput {
  title: string;
  scheduled?: boolean;
  date?: string | null;
  time?: string | null;
  venue?: string | null;
  attendees?: number;
}

export async function fetchClubs(): Promise<EngagementClub[]> {
  const data = await request<{ clubs: any[] }>(`${BASE}/clubs/`);
  return data.clubs.map(toClub);
}

export async function createClub(input: ClubInput): Promise<EngagementClub> {
  const data = await request<{ club: any }>(`${BASE}/clubs/`, { method: 'POST', body: JSON.stringify(input) });
  return toClub(data.club);
}

export async function updateClub(id: string, patch: ClubPatch): Promise<EngagementClub> {
  const data = await request<{ club: any }>(`${BASE}/clubs/${id}/`, { method: 'PATCH', body: JSON.stringify(patch) });
  return toClub(data.club);
}

export async function deleteClub(id: string): Promise<void> {
  await request(`${BASE}/clubs/${id}/`, { method: 'DELETE' });
}

export async function addClubMeeting(clubId: string, input: MeetingInput): Promise<EngagementClubMeeting> {
  const data = await request<{ meeting: any }>(`${BASE}/clubs/${clubId}/meetings/`, { method: 'POST', body: JSON.stringify(input) });
  return toMeeting(data.meeting);
}

export async function updateClubMeeting(clubId: string, meetingId: string, patch: MeetingInput): Promise<EngagementClubMeeting> {
  const data = await request<{ meeting: any }>(`${BASE}/clubs/${clubId}/meetings/${meetingId}/`, { method: 'PATCH', body: JSON.stringify(patch) });
  return toMeeting(data.meeting);
}

export async function deleteClubMeeting(clubId: string, meetingId: string): Promise<void> {
  await request(`${BASE}/clubs/${clubId}/meetings/${meetingId}/`, { method: 'DELETE' });
}

// ---- Club membership (staff-assigned — learners never join themselves) ---

export interface ClubMember {
  id: string;
  learnerId: string;
  learnerName: string;
  assignedBy: string | null;
  assignedAt: string;
}

function toMember(m: any): ClubMember {
  return { id: String(m.id), learnerId: m.learnerId, learnerName: m.learnerName, assignedBy: m.assignedBy ?? null, assignedAt: m.assignedAt };
}

export async function fetchClubMembers(clubId: string): Promise<ClubMember[]> {
  const data = await request<{ members: any[] }>(`${BASE}/clubs/${clubId}/members/`);
  return data.members.map(toMember);
}

export async function assignClubMember(clubId: string, input: { learnerId: string; learnerName: string }): Promise<ClubMember> {
  const data = await request<{ member: any }>(`${BASE}/clubs/${clubId}/members/`, { method: 'POST', body: JSON.stringify(input) });
  return toMember(data.member);
}

export async function removeClubMember(clubId: string, learnerId: string): Promise<void> {
  await request(`${BASE}/clubs/${clubId}/members/${encodeURIComponent(learnerId)}/`, { method: 'DELETE' });
}

// ---- Attendance (club meetings + events) ----------------------------------
// Distinct from EventBooking (an RSVP/intent-to-attend): this is whether a
// learner actually showed up, marked by staff. Marking someone 'present'
// awards engagement points (club_meeting_attended / event_attended) — once
// per learner per occurrence, enforced server-side.

export interface AttendanceRosterEntry {
  learnerId: string;
  learnerName: string;
  status: 'present' | 'absent' | null;
  markedBy: string | null;
  markedAt: string | null;
  // Only present on the event roster — false marks a walk-in who wasn't booked.
  booked?: boolean;
}

export interface AttendanceMarkInput {
  learnerId: string;
  learnerName: string;
  status: 'present' | 'absent';
}

function toRosterEntry(r: any): AttendanceRosterEntry {
  return {
    learnerId: r.learnerId,
    learnerName: r.learnerName,
    status: r.status ?? null,
    markedBy: r.markedBy ?? null,
    markedAt: r.markedAt ?? null,
    ...(r.booked !== undefined ? { booked: r.booked } : {}),
  };
}

export async function fetchClubMeetingAttendance(clubId: string, meetingId: string): Promise<AttendanceRosterEntry[]> {
  const data = await request<{ roster: any[] }>(`${BASE}/clubs/${clubId}/meetings/${meetingId}/attendance/`);
  return data.roster.map(toRosterEntry);
}

export async function saveClubMeetingAttendance(
  clubId: string, meetingId: string, records: AttendanceMarkInput[],
): Promise<{ meeting: EngagementClubMeeting; roster: AttendanceRosterEntry[] }> {
  const data = await request<{ meeting: any; roster: any[] }>(`${BASE}/clubs/${clubId}/meetings/${meetingId}/attendance/`, {
    method: 'POST',
    body: JSON.stringify({ records }),
  });
  return { meeting: toMeeting(data.meeting), roster: data.roster.map(toRosterEntry) };
}

export async function fetchEventAttendance(eventId: string): Promise<AttendanceRosterEntry[]> {
  const data = await request<{ roster: any[] }>(`${BASE}/events/${eventId}/attendance/`);
  return data.roster.map(toRosterEntry);
}

export async function saveEventAttendance(eventId: string, records: AttendanceMarkInput[]): Promise<AttendanceRosterEntry[]> {
  const data = await request<{ roster: any[] }>(`${BASE}/events/${eventId}/attendance/`, {
    method: 'POST',
    body: JSON.stringify({ records }),
  });
  return data.roster.map(toRosterEntry);
}

// ---- Reports ---------------------------------------------------------------
// Live data behind the 4 kept engagement reports. The Engagement Scoreboard
// report reuses fetchLearnerAnalytics directly (already real per-learner
// data) rather than a dedicated endpoint.

export interface PointsRewardsReport {
  totalPointsAwarded: number;
  pointsAwardedThisMonth: number;
  pointsCommittedToClaims: number;
  byCategory: { category: string; points: number; learners: number }[];
  claimsByStatus: Record<'pending' | 'approved' | 'rejected' | 'fulfilled', number>;
  topRewards: { name: string; claims: number; points: number }[];
}

export interface ClubActivityReport {
  clubs: { clubId: number; name: string; location: string; members: number; meetings: number; meetingsScheduled: number; totalAttendanceMarked: number }[];
  totalClubs: number;
  totalMembers: number;
  totalMeetings: number;
  pointsAwardedForAttendance: number;
}

export interface EventAttendanceReport {
  events: { eventId: number; title: string; date: string; type: string; booked: number; present: number; absent: number; attendanceRate: number | null }[];
  totalEvents: number;
  totalBooked: number;
  totalPresent: number;
  pointsAwardedForAttendance: number;
}

export async function fetchReportData(reportId: 'points-rewards'): Promise<PointsRewardsReport>;
export async function fetchReportData(reportId: 'club-activity'): Promise<ClubActivityReport>;
export async function fetchReportData(reportId: 'event-attendance'): Promise<EventAttendanceReport>;
export async function fetchReportData(reportId: string): Promise<any> {
  return request(`${BASE}/reports/${reportId}/`);
}

// ---- Attendance interventions ---------------------------------------------

export interface AttendanceInterventionRecord {
  id: string;
  learnerId: string;
  learnerName: string;
  action: string;
  employerNotified: boolean;
  interventionDate: string | null;
  createdBy: string | null;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
}

export interface AttendanceInterventionInput {
  learnerId: string;
  learnerName: string;
  action: string;
  employerNotified?: boolean;
  interventionDate?: string | null;
}

function toIntervention(i: any): AttendanceInterventionRecord {
  return {
    id: String(i.id), learnerId: i.learnerId, learnerName: i.learnerName, action: i.action,
    employerNotified: i.employerNotified, interventionDate: i.interventionDate ?? null,
    createdBy: i.createdBy ?? null, createdAt: i.createdAt, resolved: i.resolved, resolvedAt: i.resolvedAt ?? null,
  };
}

export async function fetchAttendanceInterventions(learnerId?: string): Promise<AttendanceInterventionRecord[]> {
  const query = learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : '';
  const data = await request<{ interventions: any[] }>(`${BASE}/attendance-interventions/${query}`);
  return data.interventions.map(toIntervention);
}

export async function createAttendanceIntervention(input: AttendanceInterventionInput): Promise<AttendanceInterventionRecord> {
  const data = await request<{ intervention: any }>(`${BASE}/attendance-interventions/`, { method: 'POST', body: JSON.stringify(input) });
  return toIntervention(data.intervention);
}

export async function resolveAttendanceIntervention(id: string): Promise<AttendanceInterventionRecord> {
  const data = await request<{ intervention: any }>(`${BASE}/attendance-interventions/${id}/`, { method: 'PATCH', body: JSON.stringify({ resolved: true }) });
  return toIntervention(data.intervention);
}

// ---- Points rules + grants -----------------------------------------------

export interface EngagementPointsRule {
  id: string;
  name: string;
  description: string;
  points: number;
  category: string;
  frequency: string;
  trigger: string;
  active: boolean;
  key?: string | null;
  // Aggregates the backend computes from the grants table (not stored columns).
  learnersImpacted: number;
  totalPointsAwarded: number;
}

// A single recorded grant. The backend stores learnerId + name + a points
// snapshot; avatar/programme are enriched from the mock on the page.
export interface EngagementPointsGrant {
  id: string;
  ruleId: string;
  rule: string;
  category: string;
  learnerId: string;
  learner: string;
  points: number;
  awardedAt: string;
  awardedBy: string | null;
  sourceType: string | null;
  reason: string | null;
}

// The signed-in learner's own authoritative balance — the single source every
// balance display should read from, rather than re-deriving it from grants
// and claims client-side.
export interface EngagementPointsSummary {
  learnerId: string;
  earned: number;
  committed: number;
  balance: number;
}

export interface PointsRuleInput {
  name: string;
  description: string;
  points: number;
  category: string;
  frequency: string;
  trigger: string;
  active?: boolean;
}

export interface PointsRulePatch {
  name?: string;
  description?: string;
  points?: number;
  category?: string;
  frequency?: string;
  trigger?: string;
  active?: boolean;
}

function toRule(r: any): EngagementPointsRule {
  return { ...r, id: String(r.id), totalPointsAwarded: r.totalPointsAwarded ?? 0, learnersImpacted: r.learnersImpacted ?? 0 };
}

function toGrant(g: any): EngagementPointsGrant {
  return {
    id: String(g.id), ruleId: String(g.ruleId), rule: g.rule ?? 'Points award', category: g.category ?? '',
    learnerId: g.learnerId, learner: g.learner, points: g.points, awardedAt: formatDate(g.awardedAt),
    awardedBy: g.awardedBy ?? null, sourceType: g.sourceType ?? null, reason: g.reason ?? null,
  };
}

export async function fetchPointsGrants(learnerId?: string): Promise<EngagementPointsGrant[]> {
  const query = learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : '';
  const data = await request<{ grants: any[] }>(`${BASE}/points-grants/${query}`);
  return data.grants.map(toGrant);
}

// The signed-in learner's own balance — reads the single authoritative
// source (engagement_api.services.points_summary) rather than re-deriving
// earned-minus-committed client-side from separately fetched grants/claims.
export async function fetchMyPoints(): Promise<EngagementPointsSummary> {
  return request<EngagementPointsSummary>(`${BASE}/points/me/`);
}

// ---- Leaderboard -----------------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  learnerId: string;
  learner: string;
  points: number;
  cohort: string | null;
}

export interface LeaderboardResult {
  scope: 'monthly' | 'all-time';
  cohort: string | null;
  entries: LeaderboardEntry[];
}

// Real earned-points ranking — spend never affects rank. `cohort` narrows to
// a single real cohort (e.g. the viewer's own); omit for the full ranking.
export async function fetchLeaderboard(scope: 'monthly' | 'all-time', cohort?: string): Promise<LeaderboardResult> {
  const params = new URLSearchParams({ scope });
  if (cohort) params.set('cohort', cohort);
  return request<LeaderboardResult>(`${BASE}/leaderboard/?${params.toString()}`);
}

// Staff-only aggregate counts for the Engagement Command Centre overview —
// live COUNT/SUM over grants, voucher claims and event bookings.
export interface EngagementOverviewStats {
  pointsAwarded: number;
  pointsAwardedThisMonth: number;
  vouchersClaimed: number;
  vouchersClaimedThisMonth: number;
  activeLearners: number;
  eventSeatsBooked: number;
}

export async function fetchOverviewStats(): Promise<EngagementOverviewStats> {
  return request<EngagementOverviewStats>(`${BASE}/stats/overview/`);
}

// ---- Learner analytics (real — see /engagement_api/learner-analytics/) ---
// Every field here is computed from real backend data (attendance, KSB,
// OTJH, quiz scores, evidence, points, club assignment, message response) —
// not a mock roster. Null means "no data yet for this learner", not zero.
export interface LearnerAnalyticsRow {
  id: string;
  name: string;
  programme: string;
  cohort: string;
  coach: string | null;
  engagementScore: number | null;
  riskLevel: 'red' | 'amber' | 'green' | null;
  overallStatus: string | null;
  flags: string[];
  attendanceRate: number | null;
  sessionsAttended: number | null;
  totalSessions: number | null;
  sessionsMissed: number | null;
  consecutiveMissed: number | null;
  lastAttendance: string | null;
  otjhHours: number;
  otjhTarget: number;
  ksbProgress: number | null;
  evidenceSubmitted: number;
  evidenceTarget: number;
  quizAverage: number | null;
  messageResponse: number | null;
  clubActivity: number;
  lastActive: string | null;
  points: number;
  pointsThisMonth: number;
  attendanceAction: string | null;
  employerNotified: boolean;
  interventionDate: string | null;
}

export async function fetchLearnerAnalytics(programme?: string, cohort?: string): Promise<LearnerAnalyticsRow[]> {
  const params = new URLSearchParams();
  if (programme) params.set('programme', programme);
  if (cohort) params.set('cohort', cohort);
  const query = params.toString();
  const data = await request<{ learners: LearnerAnalyticsRow[] }>(`${BASE}/learner-analytics/${query ? `?${query}` : ''}`);
  return data.learners;
}

export async function fetchPointsRules(): Promise<EngagementPointsRule[]> {
  const data = await request<{ rules: any[] }>(`${BASE}/points-rules/`);
  return data.rules.map(toRule);
}

export async function createPointsRule(input: PointsRuleInput): Promise<EngagementPointsRule> {
  const data = await request<{ rule: any }>(`${BASE}/points-rules/`, { method: 'POST', body: JSON.stringify(input) });
  return toRule(data.rule);
}

export async function updatePointsRule(id: string, patch: PointsRulePatch): Promise<EngagementPointsRule> {
  const data = await request<{ rule: any }>(`${BASE}/points-rules/${id}/`, { method: 'PATCH', body: JSON.stringify(patch) });
  return toRule(data.rule);
}

export async function fetchRuleGrants(ruleId: string): Promise<EngagementPointsGrant[]> {
  const data = await request<{ grants: any[] }>(`${BASE}/points-rules/${ruleId}/grants/`);
  return data.grants.map(toGrant);
}

// ---- Flash cards (gamification) — deck builder ---------------------------
// A deck is authored for a programme -> module -> week (same targeting the quiz
// builder uses), then published. It is a points-only game: it never enters the
// training plan or affects progress. IDs here stay NUMERIC (unlike the mock
// 'rw-01' style) — card ids are sent back to the save endpoint, which matches
// them by integer id for its upsert.

export type FlashCardDifficulty = 'easy' | 'medium' | 'hard';
export type DeckStatus = 'draft' | 'published';

export interface FlashCardDeck {
  id: number;
  title: string;
  programmeId: number | null;
  programme: string;
  module: string;
  weekId: string;
  status: DeckStatus;
  author: string;
  cardCount: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

// A saved card belonging to a deck.
export interface FlashCard {
  id: number;
  question: string;
  answer: string;
  category: string;
  difficulty: FlashCardDifficulty;
  sortOrder: number;
}

// A card in the editor before it's saved (AI-generated or hand-added). An `id`
// is present only for cards already persisted; new cards omit it.
export interface FlashCardDraft {
  id?: number;
  question: string;
  answer: string;
  category?: string;
  difficulty?: FlashCardDifficulty;
}

// Programme/module options for the builder's targeting selectors.
export interface TrainingPlanModuleOption {
  value: string;
  label: string;
  programmeId: number;
}
export interface TrainingPlanOptions {
  programmes: { value: string; label: string }[];
  modulesByProgramme: Record<string, TrainingPlanModuleOption[]>;
}

export interface FlashCardDeckInput {
  title: string;
  programme?: string;
  module?: string;
  programmeId?: number | null;
  week?: string | number;
  status?: DeckStatus;
  author?: string;
  aiGenerated?: boolean;
}

export interface DeckCardsResult {
  deck: FlashCardDeck;
  cards: FlashCard[];
  pointsPerCard: number;
}

export interface GenerateFlashCardsInput {
  topic?: string;
  lessonContent?: string;
  customInstructions?: string;
  programme?: string;
  module?: string;
  questionCount?: number;
}

export interface GenerateFlashCardsResult {
  cards: FlashCardDraft[];
  source: {
    model: string;
    cardCount: number;
    readableFiles: string[];
    unreadableFiles: string[];
  };
}

export interface FlipResult {
  flipped: boolean;
  alreadyFlipped: boolean;
  answer: string;
  pointsAwarded: number;
}

// -- Builder: targeting options --
export async function fetchTrainingPlanOptions(): Promise<TrainingPlanOptions> {
  return request<TrainingPlanOptions>(`${BASE}/flash-cards/training-plan-options/`);
}

// -- Builder: deck CRUD --
export async function fetchFlashCardDecks(filters?: {
  status?: DeckStatus | 'all';
  search?: string;
  weekId?: string;
  programmeId?: number;
}): Promise<FlashCardDeck[]> {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.weekId) params.set('weekId', filters.weekId);
  if (filters?.programmeId != null) params.set('programmeId', String(filters.programmeId));
  const q = params.toString();
  const data = await request<{ decks: FlashCardDeck[] }>(`${BASE}/flash-cards/decks/${q ? `?${q}` : ''}`);
  return data.decks;
}

export async function createFlashCardDeck(input: FlashCardDeckInput): Promise<FlashCardDeck> {
  const data = await request<{ deck: FlashCardDeck }>(`${BASE}/flash-cards/decks/`, {
    method: 'POST', body: JSON.stringify(input),
  });
  return data.deck;
}

export async function updateFlashCardDeck(id: number, patch: Partial<FlashCardDeckInput>): Promise<FlashCardDeck> {
  const data = await request<{ deck: FlashCardDeck }>(`${BASE}/flash-cards/decks/${id}/`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
  return data.deck;
}

export async function deleteFlashCardDeck(id: number): Promise<void> {
  await request(`${BASE}/flash-cards/decks/${id}/`, { method: 'DELETE' });
}

// -- Builder: a deck's cards --
export async function fetchDeckCards(id: number): Promise<DeckCardsResult> {
  return request<DeckCardsResult>(`${BASE}/flash-cards/decks/${id}/cards/`);
}

export async function saveDeckCards(id: number, cards: FlashCardDraft[]): Promise<DeckCardsResult> {
  return request<DeckCardsResult>(`${BASE}/flash-cards/decks/${id}/cards/`, {
    method: 'POST', body: JSON.stringify({ cards }),
  });
}

// -- Builder: AI generation (topic/paste JSON, or FormData with uploaded files) --
export async function generateFlashCards(input: GenerateFlashCardsInput | FormData): Promise<GenerateFlashCardsResult> {
  const isForm = typeof FormData !== 'undefined' && input instanceof FormData;
  let res: Response;
  try {
    const token = await csrfToken();
    res = await fetch(`${BASE}/flash-cards/ai/generate/`, {
      method: 'POST',
      credentials: 'include',
      // For FormData, let the browser set the multipart Content-Type + boundary.
      ...(isForm
        ? { headers: { 'X-CSRFToken': token }, body: input }
        : { headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token }, body: JSON.stringify(input) }),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as GenerateFlashCardsResult;
}

// -- Learner: flip a card in the real (non-preview) game. The learner is
//    always derived from the signed-in session server-side. Awards points
//    once per (card, learner). --
export async function flipFlashCard(cardId: number): Promise<FlipResult> {
  return request<FlipResult>(`${BASE}/flash-cards/${cardId}/flip/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
