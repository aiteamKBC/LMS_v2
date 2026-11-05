// SessionDetailPage and TranscriptPage in the existing Coaching Session app.
// Keep its login, report rendering and Export PDF flow on its own origin.
export function originalCoachingReportUrl(sessionId: string | null | undefined, tab: 'ai_report' | 'transcript' = 'ai_report'): string | null {
  if (!sessionId || !/^[a-f0-9]{32}$/.test(sessionId)) return null;
  return `https://coachingsessions.kentbusinesscollege.net/sessions/${sessionId}?tab=${tab}`;
}
