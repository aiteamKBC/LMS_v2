/**
 * How to show an authored document/slide-deck link inline.
 *
 * Authored resource URLs are free text or an uploaded file's path, and each kind
 * needs a different viewer:
 *
 * - A deck WE host is rendered in-house (see @/api/slideDeck) — the same result
 *   on a laptop as in production, and the file never leaves our servers.
 * - Google Slides/Docs links have native embeds, and a PDF the browser draws
 *   itself, so both work from any origin.
 * - Anything else falls to Microsoft's Office Online viewer, which downloads the
 *   file from Microsoft's own servers. That only works for a URL that is
 *   absolute AND publicly reachable: a relative upload path or a localhost
 *   origin both make it render its "An error occurred / we can't open this for
 *   you" page instead.
 *
 * So: resolve what can actually be shown, and say when nothing can be, rather
 * than handing the learner a broken frame.
 */

export type DocEmbed =
  /** Renders on its own in an iframe — a Google embed, or a PDF the browser draws. */
  | { mode: 'native'; src: string }
  /** One of our own uploaded decks: render it with SlideDeckViewer. */
  | { mode: 'deck'; src: string }
  /** Handed to the Office Online viewer; the URL is absolute and publicly reachable. */
  | { mode: 'office'; src: string }
  /** Not previewable inline — open/download it instead. `reason` says why. */
  | { mode: 'unavailable'; reason: string };

const PDF_RE = /\.pdf$/i;
/** Deck formats the in-house renderer reads (OOXML only — not legacy .ppt). */
const DECK_RE = /\.(pptx|ppsx|pptm|ppsm)$/i;

/** Hostnames the public internet cannot resolve or route to. */
function isPubliclyReachable(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return false;
  // Dot-less names (bare machine names, docker service names) and private TLDs.
  if (!host.includes('.') || /\.(local|localhost|internal|test|invalid|home\.arpa)$/.test(host)) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

/** Absolute form of an authored URL (relative upload paths resolve against the
 * page origin), or null when it isn't a URL we can use at all. */
export function absoluteDocUrl(url: string, origin = window.location.origin): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const resolved = new URL(trimmed, origin);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}

/** Google Slides "/edit" or "/present" link -> its embeddable "/embed" form, else null. */
export function googleSlidesEmbedUrl(url: string): string | null {
  const m = url.match(/docs\.google\.com\/presentation\/d\/([^/?#]+)/);
  return m ? `https://docs.google.com/presentation/d/${m[1]}/embed` : null;
}

/** Google Docs "/edit" link -> its embeddable "/preview" form, else null. */
export function googleDocsEmbedUrl(url: string): string | null {
  const m = url.match(/docs\.google\.com\/document\/d\/([^/?#]+)/);
  return m ? `https://docs.google.com/document/d/${m[1]}/preview` : null;
}

/** What, if anything, can be shown inline for this authored resource URL. */
export function resolveDocEmbed(url: string, origin = window.location.origin): DocEmbed {
  const absolute = absoluteDocUrl(url, origin);
  if (!absolute) return { mode: 'unavailable', reason: 'This link is not a web address we can open.' };

  const google = googleSlidesEmbedUrl(absolute) || googleDocsEmbedUrl(absolute);
  if (google) return { mode: 'native', src: google };

  const { pathname, hostname, origin: fileOrigin } = new URL(absolute);
  // A deck we host ourselves: the backend renders it, so it shows the same way
  // wherever this runs and the file is never handed to a third party.
  if (DECK_RE.test(pathname) && fileOrigin === new URL(origin).origin) {
    return { mode: 'deck', src: absolute };
  }
  // PDFs render in the browser's own viewer, so they work from any origin —
  // including a local dev server the Office viewer could never reach.
  if (PDF_RE.test(pathname)) return { mode: 'native', src: absolute };

  if (!isPubliclyReachable(hostname)) {
    return {
      mode: 'unavailable',
      reason: 'Inline preview uses Microsoft’s Office Online viewer, which has to download the file from the internet — it cannot reach this server.',
    };
  }
  // Everything else — Office documents, and any other public link an author
  // pasted — goes to the Office viewer, which handles what it recognises and
  // shows its own message for what it does not.
  return { mode: 'office', src: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absolute)}` };
}
