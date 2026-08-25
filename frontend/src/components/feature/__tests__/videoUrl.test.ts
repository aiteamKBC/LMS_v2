/**
 * Which video URLs the player can actually embed.
 *
 * The legacy MBA import brought in 3,884 Google Drive links, all in Drive's
 * share form (".../view"). That URL in an iframe renders Drive's own web page —
 * a sign-in or "you need permission" notice — rather than a player, which is
 * exactly what learners saw. "/preview" is the embeddable form.
 */
import { describe, expect, it } from 'vitest';
import { parseVideoUrl } from '../VideoPlayer';

describe('parseVideoUrl', () => {
  it('turns a Drive share link into its embeddable form', () => {
    const id = '1Drhebl7pnUqpuH6wbkcDlr-NakfQ2USW';
    for (const url of [
      `https://drive.google.com/file/d/${id}/view`,
      `https://drive.google.com/file/d/${id}/view?usp=sharing`,
      `https://drive.google.com/file/d/${id}/preview`,
      `https://drive.google.com/open?id=${id}`,
      `https://drive.google.com/uc?export=download&id=${id}`,
    ]) {
      expect(parseVideoUrl(url).src).toBe(`https://drive.google.com/file/d/${id}/preview`);
    }
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
});
