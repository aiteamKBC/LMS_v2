import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Exercise the real helper with controlled asynchronous native API boundaries.
// These verify lifecycle races, not a device's microphone, voice quality or native audio session.
const source = fs.readFileSync(new URL('../src/voice.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness(overrides = {}) {
  const spoken = [], captured = [];
  const speech = { stop: async () => {}, getAvailableVoicesAsync: async () => [{ language: 'en-GB', identifier: 'british-device-voice' }], maxSpeechInputLength: 4000, speak: (text, options) => spoken.push({ text, options }), ...overrides.speech };
  const recognition = { abort: () => {}, isRecognitionAvailable: () => true, requestPermissionsAsync: async () => ({ granted: true }), start: options => captured.push(options), ...overrides.recognition };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === 'expo-speech' ? speech : { ExpoSpeechRecognitionModule: recognition }, module, module.exports);
  return { api: module.exports, spoken, captured };
}

test('stopping during pending voice lookup prevents any later speech', async () => {
  const voices = deferred(), h = harness({ speech: { getAvailableVoicesAsync: () => voices.promise } });
  let started = 0;
  const pending = h.api.speakBritish('This must not speak.', 1, undefined, () => started++);
  await flush();
  await h.api.stopVoice();
  voices.resolve([{ language: 'en-GB', identifier: 'british' }]);
  await pending;
  assert.equal(h.spoken.length, 0);
  assert.equal(started, 0);
});
test('late callbacks after cancellation cannot start the next sentence or report playing', async () => {
  const h = harness(); let started = 0, ended = 0;
  await h.api.speakBritish('First sentence. Second sentence.', 1, () => ended++, () => started++);
  const stale = h.spoken[0].options;
  await h.api.stopVoice();
  stale.onStart(); stale.onDone(); stale.onError();
  assert.equal(h.spoken.length, 1);
  assert.equal(started, 0);
  assert.equal(ended, 0);
});
test('normal British narration advances once and duplicate callbacks cannot skip a sentence', async () => {
  const h = harness(); let finished = 0;
  await h.api.speakBritish('One. Two. Three.', 1.25, () => finished++);
  const first = h.spoken[0].options;
  assert.equal(first.language, 'en-GB'); assert.equal(first.voice, 'british-device-voice'); assert.equal(first.rate, 1.25);
  first.onDone(); first.onDone();
  assert.equal(h.spoken.length, 2);
  h.spoken[1].options.onDone();
  h.spoken[2].options.onDone(); h.spoken[2].options.onDone();
  assert.equal(h.spoken.length, 3);
  assert.equal(finished, 1);
});
test('voice enumeration failure settles the speaking flag and reports a useful error', async () => {
  const h = harness({ speech: { getAvailableVoicesAsync: async () => { throw new Error('provider failure'); } } });
  let finished = 0, error = '';
  await h.api.speakBritish('A paragraph.', 1, () => finished++, undefined, message => error = message);
  assert.equal(finished, 1); assert.match(error, /could not start/); assert.equal(h.spoken.length, 0);
});
test('stop remains safe when native voice and recognition APIs reject', async () => {
  const h = harness({ speech: { stop: async () => { throw new Error('unavailable'); } }, recognition: { abort: () => { throw new Error('already stopped'); } } });
  await assert.doesNotReject(() => h.api.stopVoice());
});
test('cancelling a pending permission request cannot start microphone capture later', async () => {
  const permission = deferred(), h = harness({ recognition: { requestPermissionsAsync: () => permission.promise } });
  const pending = h.api.requestDictation();
  await flush(); await h.api.stopVoice();
  permission.resolve({ granted: true });
  assert.equal(await pending, false); assert.equal(h.captured.length, 0);
});
test('granted dictation starts en-GB once, whereas denied permission never captures', async () => {
  const allowed = harness();
  assert.equal(await allowed.api.requestDictation(), true); assert.equal(allowed.captured.length, 1); assert.equal(allowed.captured[0].lang, 'en-GB');
  const denied = harness({ recognition: { requestPermissionsAsync: async () => ({ granted: false }) } });
  await assert.rejects(() => denied.api.requestDictation(), /not granted/); assert.equal(denied.captured.length, 0);
});
test('long unpunctuated input is bounded without dropping learner words', () => {
  const h = harness(), text = Array.from({ length: 100 }, (_, i) => 'word' + i).join(' ');
  const chunks = h.api.chunkSpeechText(text, 40);
  assert.ok(chunks.length > 1); assert.ok(chunks.every(chunk => chunk.length <= 40)); assert.equal(chunks.join(' '), text);
});


test('a cancelled permission result cannot capture over a later dictation attempt', async () => {
  const first=deferred(),second=deferred();let calls=0;
  const h=harness({recognition:{requestPermissionsAsync:()=>++calls===1?first.promise:second.promise}});
  const a=h.api.requestDictation();await flush();await h.api.stopVoice();
  const b=h.api.requestDictation();await flush();first.resolve({granted:true});
  assert.equal(await a,false);assert.equal(h.captured.length,0);
  second.resolve({granted:true});assert.equal(await b,true);assert.equal(h.captured.length,1);
  await h.api.stopVoice();
});
