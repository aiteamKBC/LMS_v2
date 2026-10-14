/** Provider URL/message validation and the shared official YouTube IFrame API bridge. */
export const PLAYER_CHANNEL = 'kbc-youtube-player-v1';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NONCE = /^[A-Za-z0-9_-]{20,160}$/;
export function parseYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const host = url.hostname.toLowerCase(), path = url.pathname.split('/').filter(Boolean);
    let id = null;
    if (host === 'youtu.be' && path.length === 1) id = path[0];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (['embed', 'shorts', 'live'].includes(path[0]) && path.length === 2) id = path[1];
    } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host) && path[0] === 'embed' && path.length === 2) id = path[1];
    return id && VIDEO_ID.test(id) ? id : null;
  } catch { return null; }
}
export function validPlayerConfig(config) {
  if (!config || !VIDEO_ID.test(config.videoId || '') || !NONCE.test(config.nonce || '')) return false;
  try { const origin = new URL(config.origin); return ['http:', 'https:'].includes(origin.protocol) && origin.origin === config.origin && !origin.username && !origin.password; } catch { return false; }
}
export function parsePlayerMessage(raw, expectedNonce) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.channel !== PLAYER_CHANNEL || data.nonce !== expectedNonce || data.type !== 'state') return null;
    if (typeof data.playing !== 'boolean' || typeof data.buffering !== 'boolean' || !Number.isFinite(data.position) || data.position < 0 || !Number.isFinite(data.duration) || data.duration < 0 || data.position > 604800 || data.duration > 604800) return null;
    if (data.error !== undefined && (typeof data.error !== 'string' || data.error.length > 300)) return null;
    if (data.playbackRate !== undefined && (!Number.isFinite(data.playbackRate) || data.playbackRate <= 0 || data.playbackRate > 4)) return null;
    return { playing: data.playing && !data.buffering && !data.error, buffering: data.buffering && !data.error, position: data.position, duration: data.duration, playbackRate: data.playbackRate || 1, ...(data.error ? { error: data.error } : {}) };
  } catch { return null; }
}
export function isTrustedFrameMessage(event, expectedWindow, expectedOrigin, expectedNonce) {
  if (!expectedWindow || event.source !== expectedWindow || event.origin !== expectedOrigin) return null;
  return parsePlayerMessage(event.data, expectedNonce);
}
export function isAllowedPlayerNavigation(raw, ownOrigin, isTopFrame = false) {
  if (raw === 'about:blank') return true;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.origin === ownOrigin && url.pathname === '/') return true;
    if (isTopFrame) return false;
    return ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname) && url.pathname.startsWith('/embed/');
  } catch { return false; }
}

// This function is serialized into both the native HTML and the static web runtime.
export function youtubePlayerRuntime(initialConfig) {
  'use strict';
  const CHANNEL = 'kbc-youtube-player-v1';
  let config = initialConfig;
  if (!config) {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    config = { videoId: hash.get('video'), nonce: hash.get('nonce'), origin: window.location.origin, native: false, paused: hash.get('paused') === '1' };
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(config.videoId || '') || !/^[A-Za-z0-9_-]{20,160}$/.test(config.nonce || '')) {
    document.getElementById('notice').textContent = 'This video link is not supported.';
    return;
  }
  let player = null, ready = false, failed = false, destroyed = false, hostPaused = Boolean(config.paused), position = 0, duration = 0;
  function send(error) {
    if (destroyed) return;
    let state = -1, rate = 1;
    if (ready && player) {
      try { state = player.getPlayerState(); position = Math.max(0, Number(player.getCurrentTime()) || 0); duration = Math.max(0, Number(player.getDuration()) || 0); rate = Number(player.getPlaybackRate()) || 1; } catch { state = -1; }
    }
    const blocked = hostPaused || document.hidden || failed;
    const message = { channel: CHANNEL, type: 'state', nonce: config.nonce, playing: ready && state === 1 && !blocked, buffering: ready && state === 3 && !blocked, position, duration, playbackRate: rate };
    if (error) message.error = error;
    if (config.native && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else if (window.parent !== window) window.parent.postMessage(message, config.origin);
  }
  function pause(value) {
    hostPaused = Boolean(value);
    if (hostPaused && ready && player) { try { player.pauseVideo(); } catch {} }
    send();
  }
  window.kbcPlayerPause = function(nonce, value) { if (nonce === config.nonce) pause(value); };
  function fail(message) {
    if (failed || destroyed) return;
    failed = true;
    if (ready && player) { try { player.pauseVideo(); } catch {} }
    const notice = document.getElementById('notice'); notice.textContent = message; notice.hidden = false;
    send(message);
  }
  window.addEventListener('message', function(event) {
    if (config.native || event.source !== window.parent || event.origin !== config.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.nonce !== config.nonce || data.type !== 'pause' || typeof data.paused !== 'boolean') return;
    pause(data.paused);
  });
  document.addEventListener('visibilitychange', function() {
    if (document.hidden && ready && player) { try { player.pauseVideo(); } catch {} }
    send();
  });
  window.addEventListener('pagehide', function() {
    if (ready && player) { try { player.pauseVideo(); } catch {} }
    send(); destroyed = true; clearInterval(poll); clearTimeout(timeout);
    if (player) { try { player.destroy(); } catch {} }
  });
  const errorMessage = code => code === 100 ? 'This video is unavailable or private. Open it on YouTube.' : [101,150].includes(code) ? 'The owner does not allow this video to play here. Open it on YouTube.' : code === 153 ? 'YouTube could not verify this app’s player. Open the official video on YouTube.' : 'YouTube could not play this video here. Open it on YouTube.';
  window.onYouTubeIframeAPIReady = function() {
    if (destroyed) return;
    try {
      player = new window.YT.Player('player', {
        width: '100%', height: '100%', videoId: config.videoId,
        playerVars: { autoplay: 0, controls: 1, playsinline: 1, enablejsapi: 1, origin: config.origin, rel: 0 },
        events: {
          onReady: function() { ready = true; clearTimeout(timeout); document.getElementById('notice').hidden = true; if (hostPaused || document.hidden) { try { player.pauseVideo(); } catch {} } send(); },
          onStateChange: function(event) { if (event.data === 1 && (hostPaused || document.hidden || failed)) { try { player.pauseVideo(); } catch {} } send(); },
          onPlaybackRateChange: function() { send(); },
          onError: function(event) { fail(errorMessage(event.data)); },
          onAutoplayBlocked: function() { send(); },
        },
      });
    } catch { fail('The video player could not start. Open the official video on YouTube.'); }
  };
  const poll = setInterval(function() {
    if (ready && !destroyed) {
      if ((hostPaused || document.hidden) && player) { try { player.pauseVideo(); } catch {} }
      send();
    }
  }, 500);
  const timeout = setTimeout(function() { if (!ready) fail('YouTube is taking too long to load. Check your connection or open the official video.'); }, 20000);
  const tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; tag.async = true;
  tag.onerror = function() { fail('YouTube could not load. Check your connection or open the official video.'); };
  document.head.appendChild(tag);
  send();
}
const styles = 'html,body{margin:0;width:100%;height:100%;background:#10271f;color:#fff;font:16px system-ui}#player{width:100%;height:100%;min-height:200px}#notice{position:absolute;left:0;right:0;top:0;box-sizing:border-box;margin:0;padding:16px;background:#10271f;pointer-events:none}#notice[hidden]{display:none}';
export function createNativePlayerHTML(config) {
  if (!validPlayerConfig(config)) throw new TypeError('Invalid video player configuration');
  const json = JSON.stringify({ ...config, native: true }).replace(/</g, '\\u003c');
  const csp = `default-src 'none'; script-src 'nonce-${config.nonce}' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'unsafe-inline'; img-src https://i.ytimg.com data:; connect-src https://www.youtube.com; base-uri 'none'; form-action 'none'; object-src 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>KBC video player</title><style>${styles}</style></head><body><div id="player"></div><p id="notice" role="status">Loading the official YouTube player…</p><script nonce="${config.nonce}">(${youtubePlayerRuntime.toString()})(${json});</script></body></html>`;
}
export function createWebPlayerHTML() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'unsafe-inline'; img-src https://i.ytimg.com data:; connect-src https://www.youtube.com; base-uri 'none'; form-action 'none'; object-src 'none'"><title>KBC video player</title><style>${styles}</style></head><body><div id="player"></div><p id="notice" role="status">Loading the official YouTube player…</p><script src="./player-runtime.js"></script></body></html>`;
}
export function createWebPlayerScript() { return `(${youtubePlayerRuntime.toString()})(null);\n`; }
