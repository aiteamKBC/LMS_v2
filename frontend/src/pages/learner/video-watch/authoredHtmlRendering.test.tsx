import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyComponent } from '@/utils/learnerJourney';
import { AuthoredContent } from '@/components/feature/AuthoredContent';
import { previewComponent } from '@/pages/curriculum/module-builder/learnerPreviewData';
import type { ModuleComponent } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { ComponentBody } from './page';

// The player itself is not under test; its source must still reach it.
vi.mock('@/components/feature/VideoPlayer', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/feature/VideoPlayer')>()),
  VideoPlayer: ({ parsed }: { parsed: { kind?: string } }) => <div data-testid="video-player">{JSON.stringify(parsed)}</div>,
}));

const fired = vi.fn();
beforeEach(() => {
  localStorage.clear();
  fired.mockReset();
  (window as unknown as { __fired: () => void }).__fired = fired;
});
afterEach(() => cleanup());

// Mirrors stored curriculum HTML: headings, both list kinds, a table, an
// uploaded-file link, a YouTube embed -- plus what must never run.
const AUTHORED = '<h1>Unit</h1><h2>Overview</h2><h4>Detail</h4><p>Intro <strong>bold</strong> <em>it</em> <u>under</u></p>'
  + '<ol><li>Step one</li><li>Step two</li></ol><ul><li>Point</li></ul><blockquote>Quoted</blockquote>'
  + '<table><tr><th>Risk</th><td>1 week&lt;US$100K</td></tr></table>'
  + '<p><a href="/curriculum_api/curriculum/uploads/2026/guide.pdf">Course guide (PDF)</a></p>'
  + '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen="allowfullscreen"></iframe>'
  + '<img src="x" onerror="window.__fired()"><a href="javascript:window.__fired()">bad</a><script>window.__fired()</script>';

function body(component: Partial<JourneyComponent>, contentKind: 'reading' | 'video', parsed: unknown = null) {
  return render(<ComponentBody component={{ componentId: 'C1', title: 'T', expectedOtjh: null, ...component } as JourneyComponent}
    contentKind={contentKind} parsed={parsed as never} title="Activity" onDuration={vi.fn()} onProgress={vi.fn()}
    onPlayingChange={vi.fn()} onEnded={vi.fn()} onUnsupported={vi.fn()} preview />);
}

function expectFormattedAndSafe(root: HTMLElement) {
  expect(root.querySelector('h1')?.textContent).toBe('Unit');
  expect(root.querySelector('h4')?.textContent).toBe('Detail');
  expect(root.querySelectorAll('ol li')).toHaveLength(2);
  expect(root.querySelector('blockquote')?.textContent).toBe('Quoted');
  expect(root.querySelector('td')?.textContent).toBe('1 week<US$100K');
  expect(root.querySelector('u')?.textContent).toBe('under');
  const file = Array.from(root.querySelectorAll('a')).find(a => a.textContent === 'Course guide (PDF)')!;
  expect(file.getAttribute('href')).toBe('/curriculum_api/curriculum/uploads/2026/guide.pdf');
  expect(file.getAttribute('target')).toBe('_blank');
  expect(file.getAttribute('rel')).toBe('noopener noreferrer');
  expect(root.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube.com/embed/abc');
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('[onerror]')).toBeNull();
  expect(root.innerHTML).not.toMatch(/javascript:/i);
  // No raw tags shown as text.
  expect(root.textContent).not.toMatch(/<h1>|<ol>|&lt;/);
  expect(fired).not.toHaveBeenCalled();
}

describe('Reading content for learners', () => {
  it('renders the authored HTML formatted, styled and sanitised', () => {
    body({ type: 'reading', contentHtml: AUTHORED }, 'reading');
    const content = document.querySelector('[data-reading-text]') as HTMLElement;
    expect(content.className).toContain('curriculum-html');
    expectFormattedAndSafe(content);
    // The linked uploaded PDF is offered as a download too.
    const download = screen.getByRole('link', { name: /Download original file/ });
    expect(download.getAttribute('href')).toContain('/curriculum_api/curriculum/uploads/2026/guide.pdf');
  });

  it('shows an escaped code sample as text instead of swallowing it', () => {
    body({ type: 'reading', contentHtml: '<p>As a <code>&lt;user role&gt;</code>, I want <code>&lt;goal&gt;</code></p><br>' }, 'reading');
    const content = document.querySelector('[data-reading-text]') as HTMLElement;
    expect(content.textContent).toBe('As a <user role>, I want <goal>');
  });

  it('still decodes legacy escaped readings', () => {
    body({ type: 'reading', contentHtml: '<div>&lt;h2&gt;Legacy&lt;/h2&gt;</div>' }, 'reading');
    expect((document.querySelector('[data-reading-text]') as HTMLElement).querySelector('h2')?.textContent).toBe('Legacy');
  });

  it('sanitises a saved highlighted copy as well', () => {
    const sourceHtml = '<p>Source</p>';
    localStorage.setItem('kbc-reading:C1:document', JSON.stringify({ sourceHtml, html: '<p><mark data-learner-highlight="true">Source</mark></p><img src="x" onerror="window.__fired()">' }));
    body({ type: 'reading', contentHtml: sourceHtml }, 'reading');
    const content = document.querySelector('[data-reading-text]') as HTMLElement;
    expect(content.querySelector('[onerror]')).toBeNull();
    expect(fired).not.toHaveBeenCalled();
  });
});

describe('Video lesson content for learners', () => {
  const parsed = { kind: 'youtube', id: 'abc' };

  it('shows the lesson content under the player, formatted and sanitised', () => {
    body({ type: 'video', videoUrl: 'https://www.youtube.com/watch?v=abc', lessonContentHtml: AUTHORED, description: 'Short description' }, 'video', parsed);
    expect(screen.getByTestId('video-player')).toHaveTextContent('youtube');
    const lesson = screen.getByRole('region', { name: 'Lesson content' });
    expect(lesson.querySelector('.curriculum-html')).not.toBeNull();
    expectFormattedAndSafe(lesson);
    // Description and URL are separate fields, not merged into the lesson.
    expect(lesson.textContent).not.toContain('Short description');
  });

  it('shows plain-text lesson content with its line breaks', () => {
    body({ type: 'video', lessonContentHtml: 'Watch the clip.\nThen note two ideas.' }, 'video', parsed);
    const paragraph = screen.getByRole('region', { name: 'Lesson content' }).querySelector('p')!;
    expect(paragraph.className).toContain('whitespace-pre-line');
    expect(paragraph.textContent).toBe('Watch the clip.\nThen note two ideas.');
  });

  it('adds nothing when the video has no lesson content', () => {
    body({ type: 'video', lessonContentHtml: '  ' }, 'video', parsed);
    expect(screen.getByTestId('video-player')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Lesson content' })).toBeNull();
  });
});

describe('AuthoredContent (descriptions)', () => {
  it('keeps a plain-text description exactly as before', () => {
    const { container } = render(<AuthoredContent value={'Line one\nLine two < 3'} className="text-sm" />);
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('Line one\nLine two < 3');
    expect(p.className).toBe('whitespace-pre-line text-sm');
  });

  it('formats an HTML description instead of showing its tags', () => {
    const { container } = render(<AuthoredContent value={'<p>See <a href="/curriculum_api/curriculum/uploads/a.pptx">slides</a></p><img src=x onerror="window.__fired()">'} />);
    expect(container.textContent).toBe('See slides');
    expect(container.querySelector('a')?.getAttribute('target')).toBe('_blank');
    expect(fired).not.toHaveBeenCalled();
  });
});

describe('Preview as learner mapping', () => {
  const base = { id: 'COMP-1', title: 'Clip', description: 'Desc', expectedOtjh: 1, reflectionRequired: false } as unknown as ModuleComponent;

  it('carries a video lesson content as its own field', () => {
    const video = previewComponent({ ...base, type: 'video', settings: { videoUrl: 'https://youtu.be/abc', lessonContent: '<p>Notes</p>', readingContent: '' } } as ModuleComponent);
    expect(video.lessonContentHtml).toBe('<p>Notes</p>');
    expect(video.videoUrl).toBe('https://youtu.be/abc');
    expect(video.description).toBe('Desc');
    expect(video.contentHtml).toBe('');
  });

  it('never shows another type its lesson content', () => {
    const reading = previewComponent({ ...base, type: 'reading', settings: { readingContent: '<p>Body</p>', lessonContent: '<p>Old</p>' } } as ModuleComponent);
    expect(reading.lessonContentHtml).toBe('');
    expect(reading.contentHtml).toBe('<p>Body</p>');
  });
});
