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
  const normalized = normalizeReadingHtml(value);
  const clean = DOMPurify.sanitize(normalized, { FORBID_TAGS: ['form'], FORBID_ATTR: ['srcdoc'] });
  const parsed = new DOMParser().parseFromString(normalized, 'text/html');
  const embeds = [...parsed.querySelectorAll('iframe')]
    .map((frame) => frame.getAttribute('src') || '')
    .filter((url) => /^https?:\/\//i.test(url));
  return (
    <div className="space-y-4">
      <div className="prose max-w-none break-words" dangerouslySetInnerHTML={{ __html: clean }} />
      {embeds.map((url, index) => <Media key={`${index}:${url}`} value={url} kind="embed" title={`Embedded content ${index + 1}`} />)}
    </div>
  );
}

export function FreeCourseMaterial({ activity }: { activity: FreeCourseActivity }) {
  const { title, type, description, contentHtml, videoUrl, audioUrl, resourceUrl, fileName } = activity;
  const normalised = (type || '').toLowerCase();

  // One primary player per activity, chosen by type — the same way the normal
  // module player shows a single body per component. Rendering every non-empty
  // field at once is what stacked two players (a video also resolves a resource
  // URL), each with its own "open in new tab" link.
  let primary = null;
  if (normalised === 'video' && videoUrl) primary = <Media value={videoUrl} kind="video" title={title} />;
  else if (normalised === 'podcast' && audioUrl) primary = <Media value={audioUrl} kind="audio" title={title} />;
  else if (contentHtml) primary = <ReadingHtml value={contentHtml} />;
  else if (videoUrl) primary = <Media value={videoUrl} kind="video" title={title} />;
  else if (audioUrl) primary = <Media value={audioUrl} kind="audio" title={title} />;
  else if (resourceUrl) primary = <Media value={resourceUrl} kind={/\.pdf($|\?)/i.test(resourceUrl) ? 'pdf' : 'embed'} title={title} fileName={fileName || undefined} />;

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
    </div>
  );
}
