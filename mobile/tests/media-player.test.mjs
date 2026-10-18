import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PLAYER_CHANNEL, parseYouTubeVideoId, parsePlayerMessage, isTrustedFrameMessage, isAllowedPlayerNavigation, createNativePlayerHTML, createWebPlayerHTML, createWebPlayerScript, YOUTUBE_PLAYER_RUNTIME } from '../src/youtube-player.mjs';
import { initialState, recordInterval } from '../src/domain.mjs';
const id = 'M7lc1UVf-VE', nonce = 'test_nonce_01234567890123456789', origin = 'https://kentbusinesscollege.com';
const message = (overrides = {}) => ({ channel: PLAYER_CHANNEL, type: 'state', nonce, playing: true, buffering: false, position: 6, duration: 600, playbackRate: 1.5, ...overrides });

test('accepts official single-video URL forms, never lookalikes or injected URLs', () => {
  for (const url of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?si=example`, `https://m.youtube.com/shorts/${id}`, `https://www.youtube-nocookie.com/embed/${id}`, `https://youtube.com/live/${id}`]) assert.equal(parseYouTubeVideoId(url), id);
  for (const url of [`http://youtube.com/watch?v=${id}`, `https://youtube.com.evil.example/watch?v=${id}`, `https://youtube.com@evil.example/watch?v=${id}`, `javascript:alert(1)`, `https://youtube.com/playlist?list=${id}`, `https://youtu.be/${id}/extra`, `https://youtube.com/watch?v=%3Cscript%3E`, `https://youtube.com:444/watch?v=${id}`]) assert.equal(parseYouTubeVideoId(url), null);
});
test('bridge requires matching origin, exact source window, nonce and finite provider state', () => {
  const frame = {}, event = { source: frame, origin, data: message() };
  assert.equal(isTrustedFrameMessage(event, frame, origin, nonce).playing, true);
  assert.equal(isTrustedFrameMessage({ ...event, source: {} }, frame, origin, nonce), null);
  assert.equal(isTrustedFrameMessage({ ...event, origin: 'https://evil.example' }, frame, origin, nonce), null);
  assert.equal(isTrustedFrameMessage(event, frame, origin, 'wrong'), null);
  for (const update of [{ position: Infinity }, { duration: -1 }, { playing: 'yes' }, { type: 'command' }, { error: { toString() {} } }, { playbackRate: 100 }]) assert.equal(parsePlayerMessage(message(update), nonce), null);
  assert.equal(parsePlayerMessage(message({ buffering: true }), nonce).playing, false);
  assert.equal(parsePlayerMessage(message({ error: 'Unavailable' }), nonce).playing, false);
});
test('native navigation permits own document and official embeds, never arbitrary top navigation', () => {
  const nativeOrigin = 'https://com.kentbusinesscollege.learn';
  assert.equal(isAllowedPlayerNavigation(nativeOrigin + '/', nativeOrigin, true), true);
  assert.equal(isAllowedPlayerNavigation(`https://www.youtube.com/embed/${id}`, nativeOrigin, false), true);
  for (const url of ['https://evil.example/', `https://www.youtube.com/watch?v=${id}`, `https://www.youtube.com.evil.example/embed/${id}`, `http://www.youtube.com/embed/${id}`]) assert.equal(isAllowedPlayerNavigation(url, nativeOrigin, false), false);
  assert.equal(isAllowedPlayerNavigation(`https://www.youtube.com/embed/${id}`, nativeOrigin, true), false);
});
test('native document has strict content policy and static web artifacts match the shared implementation', () => {
  const html = createNativePlayerHTML({ videoId: id, nonce, origin: 'https://com.kentbusinesscollege.learn' });
  assert.match(html, /strict-origin-when-cross-origin/); assert.match(html, /Content-Security-Policy/); assert.match(html, /autoplay: 0/);
  assert.throws(() => createNativePlayerHTML({ videoId: '<script>', nonce, origin }), /Invalid/);
  assert.throws(() => createNativePlayerHTML({ videoId: id, nonce: 'x" onclick="evil', origin }), /Invalid/);
  assert.equal(fs.readFileSync(new URL('../public/player.html', import.meta.url), 'utf8'), createWebPlayerHTML());
  assert.equal(fs.readFileSync(new URL('../public/player-runtime.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), createWebPlayerScript());
});
function runtime({ script, native = false } = {}) {
  const sent = [], events = {}, documentEvents = {}, timers = [], intervals = [], scripts = [], notice = { textContent: '', hidden: false };
  const parent = { postMessage: (data, target) => sent.push({ data, target }) };
  const state = { code: -1, position: 0, duration: 600, rate: 1, pauses: 0, destroyed: false };
  let options;
  const player = { getPlayerState: () => state.code, getCurrentTime: () => state.position, getDuration: () => state.duration, getPlaybackRate: () => state.rate, pauseVideo: () => { state.pauses++; state.code = 2; }, destroy: () => { state.destroyed = true; } };
  const window = { parent, location: { origin, hash: '' }, addEventListener: (name, handler) => events[name] = handler, YT: { Player: function(_element, opts) { options = opts; return player; } } };
  if (native) window.ReactNativeWebView = { postMessage: raw => sent.push({ data: JSON.parse(raw), target: 'native' }) };
  const document = { hidden: false, getElementById: () => notice, addEventListener: (name, handler) => documentEvents[name] = handler, createElement: () => ({}), head: { appendChild: tag => scripts.push(tag) } };
  vm.runInNewContext(script ?? `(${YOUTUBE_PLAYER_RUNTIME})(${JSON.stringify({ videoId: id, nonce, origin, paused: false })})`, { window, document, URLSearchParams, setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval: () => {}, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  const ready = () => { window.onYouTubeIframeAPIReady(); options.events.onReady(); };
  const update = (code, position = state.position) => { state.code = code; state.position = position; options.events.onStateChange({ data: code }); };
  return { sent, events, documentEvents, document, window, scripts, state, parent, ready, update, intervals, timers, options: () => options, latest: () => sent.at(-1).data };
}

test('native HTML runs its real bridge when the release engine cannot stringify function source', () => {
  const config = { videoId: id, nonce, origin: 'https://com.kentbusinesscollege.learn.lmscandidate', paused: false };
  const source = fs.readFileSync(new URL('../src/youtube-player.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
  // Hermes releases retain bytecode rather than JavaScript function source.
  // Poison only this isolated VM, then execute the actual inline HTML script.
  const generated = vm.runInNewContext(`Function.prototype.toString = function () { return 'function youtubePlayerRuntime() { [bytecode] }'; };\n${source}\n({ html: createNativePlayerHTML(config), web: createWebPlayerScript() });`, { URL, config });
  const scripts = [...generated.html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const h = runtime({ script: scripts[0][1], native: true });
  assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0].src, 'https://www.youtube.com/iframe_api');
  assert.equal(typeof h.window.onYouTubeIframeAPIReady, 'function');
  assert.equal(typeof h.window.kbcPlayerPause, 'function');
  assert.equal(parsePlayerMessage(h.latest(), nonce).playing, false);
  h.ready(); h.update(1, 5);
  assert.equal(h.options().playerVars.origin, config.origin);
  assert.equal(h.options().playerVars.autoplay, 0);
  assert.equal(parsePlayerMessage(h.latest(), nonce).playing, true);
  assert.equal(parsePlayerMessage(h.latest(), 'wrong'), null);
  assert.ok(h.sent.every(message => message.target === 'native'));
  h.window.kbcPlayerPause('wrong', true);
  assert.equal(h.latest().playing, true);
  h.window.kbcPlayerPause(nonce, true);
  assert.equal(h.latest().playing, false);
  h.window.kbcPlayerPause(nonce, false);
  assert.equal(h.latest().playing, false, 'releasing host pause must not autoplay');
  assert.equal(generated.web, createWebPlayerScript());
});
test('official API states alone govern playback: cue is idle, play confirmed, buffering and end do not count', () => {
  const h = runtime(); h.ready();
  assert.equal(h.options().playerVars.autoplay, 0); assert.equal(h.state.pauses, 0); assert.equal(h.latest().playing, false);
  h.update(1, 1); assert.equal(h.latest().playing, true);
  h.update(3, 2); assert.equal(h.latest().playing, false); assert.equal(h.latest().buffering, true);
  h.update(2, 2); assert.equal(h.latest().playing, false);
  h.update(0, 600); assert.equal(h.latest().playing, false); assert.equal(h.latest().buffering, false);
});
test('forged host pause messages are ignored, genuine pause stops playback, release does not autoplay', () => {
  const h = runtime(); h.ready(); h.update(1, 5);
  const command = { channel: PLAYER_CHANNEL, nonce, type: 'pause', paused: true };
  h.events.message({ source: {}, origin, data: command }); h.events.message({ source: h.parent, origin: 'https://evil.example', data: command });
  h.events.message({ source: h.parent, origin, data: { ...command, nonce: 'wrong' } });
  assert.equal(h.state.pauses, 0);
  h.events.message({ source: h.parent, origin, data: command }); assert.equal(h.latest().playing, false); assert.equal(h.state.pauses, 1);
  h.events.message({ source: h.parent, origin, data: { ...command, paused: false } }); assert.equal(h.latest().playing, false);
});
test('hidden document and page removal pause the official player and stop future observations', () => {
  const h = runtime(); h.ready(); h.update(1, 5); h.document.hidden = true; h.documentEvents.visibilitychange();
  assert.equal(h.latest().playing, false); assert.equal(h.state.pauses, 1);
  h.events.pagehide(); assert.equal(h.state.destroyed, true); const length = h.sent.length; h.intervals[0](); assert.equal(h.sent.length, length);
});
test('provider embed restriction reports an honest error and never playable evidence', () => {
  const h = runtime(); h.ready(); h.options().events.onError({ data: 153 });
  assert.match(h.latest().error, /could not verify/); assert.equal(h.latest().playing, false);
  h.update(1, 10); assert.equal(h.latest().playing, false);
});
test('confirmed video samples integrate with measured-time logic without counting seeks or speed multiplication', () => {
  let state = initialState();
  const observe = (monotonicMs, position) => {
    const media = parsePlayerMessage(message({ position }), nonce);
    const result = recordInterval(state, { sessionId: 'video', activityId: 'w01:video', clockId: 'run', monotonicMs, active: media.playing, visible: true, kind: 'listening', playing: media.playing, buffering: media.buffering, mediaPositionSeconds: media.position, playbackRate: media.playbackRate });
    state = result.state; return result.creditedSeconds;
  };
  assert.equal(observe(0, 0), 0); assert.equal(observe(4000, 6), 4); assert.equal(observe(5000, 300), 0);
});
