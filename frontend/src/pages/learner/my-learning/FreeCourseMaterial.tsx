import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Media } from './StudentMaterial';
import { normalizeReadingHtml } from '@/lib/readingHtml';
import type { FreeCourseActivity } from '@/api/freeCourses';

// ============================================================================
// Renders one free-course activity's authored content, using the same players
// as the ordinary module workspace (Media / VideoPlayer / reading HTML). Free
// courses carry no progress, so there is no completion, reflection or hours
// flow here — just the material. Reading HTML is sanitised before it is
// rendered (never regress A8).
// ============================================================================

function ReadingHtml({ value }: { value: string }) {
  // Memoised so a parent re-render keeps the same innerHTML object (React 19
  // re-applies innerHTML on a new identity, restarting any embedded <video>).
  const { innerHtml, embeds } = useMemo(() => {
    const normalized = normalizeReadingHtml(value);
    const clean = DOMPurify.sanitize(normalized, { FORBID_TAGS: ['form'], FORBID_ATTR: ['srcdoc'] });
    const parsed = new DOMParser().parseFromString(normalized, 'text/html');
    return {
      innerHtml: { __html: clean },
      embeds: [...parsed.querySelectorAll('iframe')]
        .map((frame) => frame.getAttribute('src') || '')
        .filter((url) => /^https?:\/\//i.test(url)),
    };
  }, [value]);
  return (
    <div className="space-y-4">
      <div className="prose max-w-none break-words" dangerouslySetInnerHTML={innerHtml} />
      {embeds.map((url, index) => <Media key={`${index}:${url}`} value={url} kind="embed" title={`Embedded content ${index + 1}`} />)}
    </div>
  );
}

/** Which player an attachment needs, from its name and extension. */
function attachmentKind(url: string, fileName?: string | null) {
  const probe = `${fileName || ''} ${url.split(/[?#]/)[0]}`.toLowerCase();
  if (/\.(mp3|ogg|oga|wav|m4a|aac)\b/.test(probe)) return 'audio';
  if (/\.pdf\b/.test(probe)) return 'pdf';
  return 'embed';
}

export function FreeCourseMaterial({ activity }: { activity: FreeCourseActivity }) {
  const { title, type, description, contentHtml, videoUrl, audioUrl, resourceUrl, fileName } = activity;
  const normalised = (type || '').toLowerCase();

  // One primary player per activity, chosen by type — the same way the normal
  // module player shows a single body per component. Rendering every non-empty
  // field at once is what stacked two players (a video also resolves a resource
  // URL), each with its own "open in new tab" link.
  //
  // `primaryUrl` records which file that player consumed, so the attachment
  // list below can show every OTHER file without repeating this one. A reading
  // whose body is text consumes no file at all, and then every attachment is
  // listed.
  let primary = null;
  let primaryUrl = '';
  if (normalised === 'video' && videoUrl) { primary = <Media value={videoUrl} kind="video" title={title} />; primaryUrl = videoUrl; }
  else if (normalised === 'podcast' && audioUrl) { primary = <Media value={audioUrl} kind="audio" title={title} />; primaryUrl = audioUrl; }
  else if (contentHtml) primary = <ReadingHtml value={contentHtml} />;
  else if (videoUrl) { primary = <Media value={videoUrl} kind="video" title={title} />; primaryUrl = videoUrl; }
  else if (audioUrl) { primary = <Media value={audioUrl} kind="audio" title={title} />; primaryUrl = audioUrl; }
  else if (resourceUrl) { primary = <Media value={resourceUrl} kind={/\.pdf($|\?)/i.test(resourceUrl) ? 'pdf' : 'embed'} title={title} fileName={fileName || undefined} />; primaryUrl = resourceUrl; }

  // Each keeps the position it has in the authored list, so the numbering
  // matches the #1, #2 order the Week Builder shows the author.
  const extras = (activity.files || [])
    .map((file, index) => ({ file, position: index + 1 }))
    .filter(({ file }) => file.url !== primaryUrl);

  const isQuiz = /quiz/i.test(normalised);
  return (
    <div className="space-y-4">
      {description && !contentHtml && <p className="text-sm text-foreground-600">{description}</p>}
      {primary ?? (
        <p className="rounded-xl border border-dashed border-foreground-200 bg-background-50 p-4 text-sm text-foreground-500">
          {isQuiz
            ? 'Quizzes in free courses are coming soon.'
            : 'The content for this activity has not been added yet. Check back later.'}
        </p>
      )}
      {extras.length > 0 && (
        <section className="space-y-4 border-t border-background-200 pt-4" aria-label="More files">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400">
            {extras.length} more file{extras.length === 1 ? '' : 's'}
          </p>
          {extras.map(({ file, position }) => (
            <div key={`${file.url}:${position}`} className="space-y-2">
              <p className="text-sm font-semibold text-foreground-700">
                <span className="tabular-nums text-foreground-400">{position}.</span> {file.fileName || 'Attached file'}
              </p>
              <Media value={file.url} kind={attachmentKind(file.url, file.fileName)} title={file.fileName || title} fileName={file.fileName || undefined} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
