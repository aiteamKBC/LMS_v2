import { afterEach, describe, expect, it, vi } from 'vitest';
import DOMPurify from 'dompurify';
import { looksLikeHtml, normalizeAuthoredHtml, sanitizeCurriculumHtml } from './curriculumHtml';

function parse(html: string) {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

describe('sanitizeCurriculumHtml', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the formatting authors use, unchanged', () => {
    const authored = '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>'
      + '<p>Para<br>next line</p><p><strong>b</strong> <b>b</b> <em>i</em> <i>i</i> <u>u</u> <s>s</s> <sub>2</sub><sup>3</sup></p>'
      + '<ul><li>one<ul><li>nested</li></ul></li></ul><ol><li>first</li><li>second</li></ol>'
      + '<blockquote>Quote</blockquote><pre><code>let x = 1;</code></pre><hr>'
      + '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td style="color: red;">C</td></tr></tbody></table>'
      + '<p data-start="1" class="lead" style="text-align: center;">Kept attributes</p>';
    expect(sanitizeCurriculumHtml(authored)).toBe(authored);
  });

  it('keeps uploaded-file links, external links and their targets', () => {
    const links = '<p><a href="/curriculum_api/curriculum/uploads/2026/notes.pdf" target="_blank" rel="noopener noreferrer">Notes (PDF)</a> '
      + '<a href="/curriculum_api/curriculum/uploads/2026/brief.docx" download="brief.docx">Brief</a> '
      + '<a href="https://example.test/deck.pptx">Deck</a> <a href="mailto:tutor@example.test">Email</a> <a href="#part-2">Jump</a></p>';
    const body = parse(sanitizeCurriculumHtml(links));
    const hrefs = Array.from(body.querySelectorAll('a'), a => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/curriculum_api/curriculum/uploads/2026/notes.pdf',
      '/curriculum_api/curriculum/uploads/2026/brief.docx',
      'https://example.test/deck.pptx',
      'mailto:tutor@example.test',
      '#part-2',
    ]);
    expect(body.querySelector('a[download]')?.getAttribute('download')).toBe('brief.docx');
    // Authoring/preview: links keep the target the author chose.
    expect(body.querySelector('a[href$="deck.pptx"]')?.hasAttribute('target')).toBe(false);
  });

  it('opens links in a new tab for learners, never in-page anchors', () => {
    const body = parse(sanitizeCurriculumHtml(
      '<a href="/curriculum_api/curriculum/uploads/a.pdf">A</a><a href="#top">Top</a><a href="https://x.test" target="_top">X</a>',
      { openLinksInNewTab: true },
    ));
    const [file, anchor, top] = Array.from(body.querySelectorAll('a'));
    expect(file.getAttribute('target')).toBe('_blank');
    expect(file.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.hasAttribute('target')).toBe(false);
    // A target that would navigate the LMS frame becomes a new tab.
    expect(top.getAttribute('target')).toBe('_blank');
    expect(top.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps media and https/same-site embeds', () => {
    const media = '<video controls src="/curriculum_api/curriculum/uploads/clip.mp4"></video>'
      + '<audio controls><source src="/curriculum_api/curriculum/uploads/a.mp3" type="audio/mpeg"></audio>'
      + '<img src="/curriculum_api/curriculum/uploads/fig.png" alt="Figure">'
      + '<iframe src="https://www.youtube.com/embed/abc" width="840" height="420" allowfullscreen="allowfullscreen" allow="autoplay; encrypted-media" frameborder="0"></iframe>'
      + '<iframe src="/curriculum_api/curriculum/uploads/doc.pdf"></iframe>';
    const body = parse(sanitizeCurriculumHtml(media));
    expect(body.querySelector('video')?.getAttribute('src')).toBe('/curriculum_api/curriculum/uploads/clip.mp4');
    expect(body.querySelector('source')?.getAttribute('src')).toBe('/curriculum_api/curriculum/uploads/a.mp3');
    expect(body.querySelector('img')?.getAttribute('src')).toBe('/curriculum_api/curriculum/uploads/fig.png');
    const [youtube, pdf] = Array.from(body.querySelectorAll('iframe'));
    expect(youtube.getAttribute('src')).toBe('https://www.youtube.com/embed/abc');
    expect(youtube.getAttribute('allowfullscreen')).toBe('allowfullscreen');
    expect(youtube.getAttribute('allow')).toBe('autoplay; encrypted-media');
    expect(pdf.getAttribute('src')).toBe('/curriculum_api/curriculum/uploads/doc.pdf');
  });

  it.each([
    ['script', '<p>ok</p><script>alert(1)</script>', 'script'],
    ['img onerror', '<img src="x" onerror="alert(1)">', '[onerror]'],
    ['svg onload', '<svg onload="alert(1)"><circle r="1"></circle></svg>', '[onload]'],
    ['body-level handler', '<p onclick="alert(1)" onmouseover="alert(1)">x</p>', '[onclick],[onmouseover]'],
    ['javascript link', '<a href="javascript:alert(1)">x</a>', 'a[href]'],
    ['entity-encoded javascript link', '<a href="jav&#x09;ascript:alert(1)">x</a>', 'a[href]'],
    ['data: html link', '<a href="data:text/html,<script>alert(1)</script>">x</a>', 'a[href]'],
    ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '[srcdoc]'],
    ['javascript iframe', '<iframe src="javascript:alert(1)"></iframe>', 'iframe[src]'],
    ['data iframe', '<iframe src="data:text/html,hi"></iframe>', 'iframe[src]'],
    ['plain http iframe', '<iframe src="http://insecure.test/x"></iframe>', 'iframe[src]'],
    ['protocol-relative iframe', '<iframe src="//evil.test/x"></iframe>', 'iframe[src]'],
    ['style block', '<style>body{display:none}</style><p>x</p>', 'style'],
    ['form', '<form action="https://evil.test"><input name="password"></form>', 'form'],
    ['object/embed', '<object data="x.swf"></object><embed src="x.swf">', 'object,embed'],
    ['base tag', '<base href="https://evil.test/">', 'base'],
  ])('removes %s', (_label, dirty, selector) => {
    const clean = sanitizeCurriculumHtml(dirty);
    expect(parse(clean).querySelector(selector)).toBeNull();
    expect(clean).not.toMatch(/alert\(1\)|javascript:/i);
  });

  it('never runs a handler while sanitising', () => {
    const fired = vi.fn();
    (window as unknown as { __fired: () => void }).__fired = fired;
    sanitizeCurriculumHtml('<img src="x" onerror="window.__fired()"><svg onload="window.__fired()"></svg>');
    expect(fired).not.toHaveBeenCalled();
  });

  it('does not change how other DOMPurify callers behave', () => {
    sanitizeCurriculumHtml('<a href="/x">x</a>', { openLinksInNewTab: true });
    // The default instance has no curriculum hooks or iframe allowance.
    expect(DOMPurify.sanitize('<a href="/x">x</a>')).toBe('<a href="/x">x</a>');
    expect(DOMPurify.sanitize('<iframe src="https://www.youtube.com/embed/a"></iframe>')).toBe('');
  });
});

describe('normalizeAuthoredHtml', () => {
  it('decodes legacy escaped markup kept inside the old editor wrappers', () => {
    expect(normalizeAuthoredHtml('<div>&lt;h2&gt;Title&lt;/h2&gt;</div><div>&lt;p&gt;Body&lt;/p&gt;</div>'))
      .toBe('<h2>Title</h2>\n<p>Body</p>');
  });

  it('leaves real HTML that shows an escaped sample exactly as authored', () => {
    // A user-story template: the escaped text is what the learner must read.
    const authored = '<p><strong>As a</strong> <code>&lt;user role&gt;</code>, <strong>I want</strong> <code>&lt;goal/desire&gt;</code></p><br>';
    expect(normalizeAuthoredHtml(authored)).toBe(authored);
    const threshold = '<table><tr><td>1 week&lt;US$100K</td></tr></table>';
    expect(normalizeAuthoredHtml(threshold)).toBe(threshold);
  });

  it('leaves content without escaped markup alone', () => {
    expect(normalizeAuthoredHtml('<p>Hello</p>')).toBe('<p>Hello</p>');
    expect(normalizeAuthoredHtml('Plain text')).toBe('Plain text');
  });
});

describe('looksLikeHtml', () => {
  it('tells markup from plain text', () => {
    expect(looksLikeHtml('<p>Hi</p>')).toBe(true);
    expect(looksLikeHtml('Line one<br/>Line two')).toBe(true);
    expect(looksLikeHtml('Costs < £100 and > £50')).toBe(false);
    expect(looksLikeHtml('Plain\ntext')).toBe(false);
    expect(looksLikeHtml(null)).toBe(false);
  });
});
