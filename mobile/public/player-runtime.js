(function youtubePlayerRuntime(initialConfig) {
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
})(null);
