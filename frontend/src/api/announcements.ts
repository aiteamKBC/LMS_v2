// ============================================================================
// Site-wide announcement banners — the public read
//
// GET /login_api/announcements/ (backend/login/announcements.py) returns only
// what is live right now. It is unauthenticated on purpose so the banner also
// shows on the sign-in page. Admin writes live in `platformAdmin.ts`; this file
// stays tiny because the banner that imports it is on every page.
// ============================================================================

export interface Announcement {
  id: number;
  message: string;
  /** "#RRGGBB" */
  backgroundColor: string;
  startsAt: string;
  endsAt: string;
}

export async function fetchActiveAnnouncements(signal?: AbortSignal): Promise<Announcement[]> {
  const res = await fetch('/login_api/announcements/', { credentials: 'include', signal });
  if (!res.ok) throw new Error(`Announcements request failed (${res.status})`);
  const data = await res.json() as { announcements?: Announcement[] };
  return data.announcements ?? [];
}

/** Near-black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableTextColor(hex: string): string {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // ~0.2 is where contrast against white equals contrast against #111827.
  return luminance > 0.2 ? '#111827' : '#FFFFFF';
}
