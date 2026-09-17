/**
 * Which video URLs the player can actually embed.
 *
 * Historical imports can contain Google Drive links in Drive's
 * share form (".../view"). That URL in an iframe renders Drive's own web page —
 * a sign-in or "you need permission" notice — rather than a player, which is
 * exactly what learners saw. They now go through the media proxy, which returns
 * the file itself, so the real <video> element plays it and can seek.
 */
import { describe, expect, it } from 'vitest';
import { embeddedSrc, framingRefusedHost, parseVideoUrl } from '../VideoPlayer';

describe('parseVideoUrl', () => {
  it('sends every shape of Drive link through the media proxy', () => {
    const id = '1Drhebl7pnUqpuH6wbkcDlr-NakfQ2USW';
    for (const url of [
      `https://drive.google.com/file/d/${id}/view`,
      `https://drive.google.com/file/d/${id}/view?usp=sharing`,
      `https://drive.google.com/file/d/${id}/preview`,
      `https://drive.google.com/open?id=${id}`,
      `https://drive.google.com/uc?export=download&id=${id}`,
    ]) {
      // 'file' rather than an iframe: it is played by the real video element,
      // which is what gives the learner a scrubber.
      expect(parseVideoUrl(url)).toEqual({
        kind: 'file', src: `/learner_api/media/google-drive/${id}/`,
        fallbackSrc: `https://drive.google.com/file/d/${id}/preview`,
      });
    }
  });

  it('retains a Drive resource key on its permitted preview', () => {
    expect(parseVideoUrl('https://drive.google.com/file/d/1234567890/view?resourcekey=key-123').fallbackSrc)
      .toBe('https://drive.google.com/file/d/1234567890/preview?resourcekey=key-123');
  });

  it('still recognises the platforms it always did', () => {
    expect(parseVideoUrl('https://youtu.be/t5zkilpisI4')).toMatchObject({
      kind: 'youtube', src: 'https://www.youtube.com/embed/t5zkilpisI4',
    });
    expect(parseVideoUrl('https://www.youtube.com/watch?v=t5zkilpisI4').kind).toBe('youtube');
    expect(parseVideoUrl('https://vimeo.com/123456789').src).toBe('https://player.vimeo.com/video/123456789');
  });

  it('plays a direct media file with the real player, not an iframe', () => {
    // Uploaded legacy videos are served from our own uploads route.
    expect(parseVideoUrl('/curriculum_api/curriculum/uploads/_legacy_files/1/lecture.mp4')).toMatchObject({
      kind: 'file',
    });
  });

  it('falls back to embedding an unknown link as-is', () => {
    expect(parseVideoUrl('https://example.test/watch/abc')).toMatchObject({
      kind: 'vimeo', src: 'https://example.test/watch/abc',
    });
  });

  it('plays the src of a pasted embed snippet, not the markup around it', () => {
    // SharePoint/Stream's "Copy embed code" hands the author a whole tag. Used
    // verbatim it is not an address at all: the browser resolved it against the
    // current route, so the learner got a 404 instead of the recording.
    const embed = '<iframe src="https://example.sharepoint.com/sites/Team/_layouts/15/embed.aspx'
      + '?UniqueId=d7609e36-b14f-4047-b095-3b6ee5e54a48&amp;referrer=StreamWebApp"'
      + ' width="640" height="360" frameborder="0" allowfullscreen title="Lecture"></iframe>';
    expect(parseVideoUrl(embed)).toMatchObject({
      kind: 'vimeo',
      // &amp; decoded back to &, or the provider drops the query parameters.
      src: 'https://example.sharepoint.com/sites/Team/_layouts/15/embed.aspx'
        + '?UniqueId=d7609e36-b14f-4047-b095-3b6ee5e54a48&referrer=StreamWebApp',
    });
  });

  it('still recognises the provider inside an embed snippet', () => {
    // Unwrapping happens before classification, so a YouTube embed keeps the
    // real player (and therefore real duration/progress), not a bare iframe.
    expect(parseVideoUrl("<iframe src='https://www.youtube.com/embed/t5zkilpisI4'></iframe>"))
      .toMatchObject({ kind: 'youtube', youTubeId: 't5zkilpisI4' });
  });

  it('names the host when a provider refuses to be framed', () => {
    // SharePoint answers with frame-ancestors listing Microsoft's surfaces only,
    // so the LMS gets "refused to connect" rather than a player. Caught while
    // authoring; no code of ours can override the responding server's header.
    expect(framingRefusedHost('<iframe src="https://kentbusinesscollege.sharepoint.com/sites/T/_layouts/15/embed.aspx?UniqueId=d76"></iframe>'))
      .toBe('kentbusinesscollege.sharepoint.com');
    expect(framingRefusedHost('https://web.microsoftstream.com/video/abc')).toBe('web.microsoftstream.com');
    // Providers that do allow embedding, and input too incomplete to judge.
    expect(framingRefusedHost('https://www.youtube.com/watch?v=t5zkilpisI4')).toBe('');
    expect(framingRefusedHost('https://example.sharepoint.com.evil.test/x')).toBe('');
    expect(framingRefusedHost('')).toBe('');
    expect(framingRefusedHost('not a url yet')).toBe('');
  });

  it('leaves a plain address and unparseable markup alone', () => {
    expect(embeddedSrc('https://example.test/watch/abc')).toBe('https://example.test/watch/abc');
    // No src to salvage — keep the original so the caller can still report it
    // rather than silently turning the component into an empty player.
    expect(embeddedSrc('<iframe></iframe>')).toBe('<iframe></iframe>');
    // Not the iframe's own src: a lazy-loading attribute must not be mistaken for it.
    expect(embeddedSrc('<iframe data-src="https://example.test/a"></iframe>'))
      .toBe('<iframe data-src="https://example.test/a"></iframe>');
  });
});
