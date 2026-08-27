/**
 * Which authored links can be shown inline.
 *
 * The bug this guards: an uploaded deck is stored as a relative path
 * ("/curriculum_api/curriculum/uploads/…"), and handing that straight to the
 * Office Online viewer produced "An error occurred — we can't open this for
 * you" on the learner's screen, in every environment.
 */
import { describe, expect, it } from 'vitest';
import { absoluteDocUrl, resolveDocEmbed } from '../docEmbed';

const PUBLIC = 'https://lms.kentbusinesscollege.net';
const LOCAL = 'http://localhost:3000';

describe('absoluteDocUrl', () => {
  it('resolves an upload path against the page origin', () => {
    expect(absoluteDocUrl('/curriculum_api/curriculum/uploads/m/c/deck.pptx', PUBLIC))
      .toBe(`${PUBLIC}/curriculum_api/curriculum/uploads/m/c/deck.pptx`);
  });

  it('leaves an absolute link alone', () => {
    expect(absoluteDocUrl('https://example.com/deck.pptx', PUBLIC)).toBe('https://example.com/deck.pptx');
  });

  it('rejects blanks and non-web schemes', () => {
    expect(absoluteDocUrl('   ', PUBLIC)).toBeNull();
    expect(absoluteDocUrl('javascript:alert(1)', PUBLIC)).toBeNull();
    expect(absoluteDocUrl('file:///C:/deck.pptx', PUBLIC)).toBeNull();
  });
});

describe('resolveDocEmbed', () => {
  it('sends a Word upload to the Office viewer as an absolute URL', () => {
    // The original bug: a relative path became src=%2Fcurriculum_api%2F…,
    // which is not something Microsoft's servers can fetch.
    const embed = resolveDocEmbed('/curriculum_api/curriculum/uploads/m/c/brief.docx', PUBLIC);
    expect(embed.mode).toBe('office');
    expect(embed.mode === 'office' && embed.src).toBe(
      'https://view.officeapps.live.com/op/embed.aspx?src='
      + encodeURIComponent(`${PUBLIC}/curriculum_api/curriculum/uploads/m/c/brief.docx`),
    );
  });

  it.each(['http://127.0.0.1:8000', 'http://192.168.1.20', 'http://10.0.0.5', 'http://172.20.3.4', 'http://kbc-laptop', 'http://box.local'])(
    'treats %s as unreachable from the public internet',
    origin => {
      expect(resolveDocEmbed('/uploads/notes.docx', origin).mode).toBe('unavailable');
    },
  );

  it('renders one of our own uploaded decks in-house, on any origin', () => {
    // The whole point: this is what used to hand a relative path to the Office
    // viewer and produce its "An error occurred" page.
    for (const origin of [PUBLIC, LOCAL]) {
      expect(resolveDocEmbed('/curriculum_api/curriculum/uploads/m/c/deck.pptx', origin))
        .toEqual({ mode: 'deck', src: `${origin}/curriculum_api/curriculum/uploads/m/c/deck.pptx` });
    }
  });

  it.each(['deck.pptx', 'deck.ppsx', 'deck.pptm'])('renders %s in-house', name => {
    expect(resolveDocEmbed(`/uploads/${name}`, PUBLIC).mode).toBe('deck');
  });

  it('leaves a deck hosted elsewhere to the Office viewer', () => {
    // We can only render files we host; a third-party link is not ours to read.
    expect(resolveDocEmbed('https://partner.example.com/deck.pptx', PUBLIC).mode).toBe('office');
  });

  it('cannot render a legacy .ppt, so it falls back to the Office viewer', () => {
    expect(resolveDocEmbed('/uploads/old.ppt', PUBLIC).mode).toBe('office');
    expect(resolveDocEmbed('/uploads/old.ppt', LOCAL).mode).toBe('unavailable');
  });

  it('renders one of our own PDFs in-house, page by page', () => {
    // Not the browser's viewer: whether a browser previews a PDF in a frame or
    // offers it as a download is a setting on the reader's machine, and the
    // download prompt is what learners were getting.
    const embed = resolveDocEmbed('/curriculum_api/curriculum/uploads/m/c/handout.pdf', LOCAL);
    expect(embed).toEqual({ mode: 'deck', src: `${LOCAL}/curriculum_api/curriculum/uploads/m/c/handout.pdf` });
  });

  it('leaves a PDF hosted elsewhere to the browser, since we cannot render it', () => {
    const embed = resolveDocEmbed('https://partner.example.com/handout.pdf', PUBLIC);
    expect(embed).toEqual({ mode: 'native', src: 'https://partner.example.com/handout.pdf' });
  });

  it('uses the native Google embeds for Slides and Docs links', () => {
    expect(resolveDocEmbed('https://docs.google.com/presentation/d/ABC123/edit#slide=id.p1', LOCAL))
      .toEqual({ mode: 'native', src: 'https://docs.google.com/presentation/d/ABC123/embed' });
    expect(resolveDocEmbed('https://docs.google.com/document/d/DOC456/edit', LOCAL))
      .toEqual({ mode: 'native', src: 'https://docs.google.com/document/d/DOC456/preview' });
  });

  it('reports an unusable link rather than embedding it', () => {
    expect(resolveDocEmbed('', PUBLIC).mode).toBe('unavailable');
    expect(resolveDocEmbed('javascript:alert(1)', PUBLIC).mode).toBe('unavailable');
  });

  it('tolerates free-text junk by letting the Office viewer answer for it', () => {
    // Authored URLs are a plain text field. Junk resolves as a relative path on
    // a public origin; the viewer shows its own message, as it always did.
    expect(resolveDocEmbed('not a url at all', PUBLIC).mode).toBe('office');
  });
});
