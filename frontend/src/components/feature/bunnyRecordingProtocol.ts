export type RecordingMedia = { -readonly [Key in 'currentTime' | 'duration' | 'paused' | 'seeking']: HTMLVideoElement[Key] };

export function isBunnyEmbed(value?: string): boolean {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && ['player.mediadelivery.net', 'iframe.mediadelivery.net'].includes(url.hostname)
      && /^\/embed\/\d+\/[a-f\d-]{36}$/i.test(url.pathname);
  } catch { return false; }
}
