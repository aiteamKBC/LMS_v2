import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { VERSIONS, PATCHES, applyPatches } = require('../scripts/patch-native-media-cookies.cjs');
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function originalSource(patch) {
  let source = fs.readFileSync(path.join(mobileRoot, 'node_modules', patch.package, patch.file), 'utf8').replace(/\r\n/g, '\n');
  if (hash(source) !== patch.originalSha256) {
    for (const [before, after] of [...patch.replacements].reverse()) source = source.replace(after, before);
  }
  assert.equal(hash(source), patch.originalSha256, 'test requires the reviewed installed Expo source');
  return source;
}

function fixture(t, { crlf = false, sharedVideo = false } = {}) {
  const tempParent = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(tempParent, 'kbc-native-media-test-'));
  t.after(() => {
    const checked = fs.realpathSync(temporary);
    assert.equal(path.dirname(checked), tempParent);
    assert.match(path.basename(checked), /^kbc-native-media-test-/);
    fs.rmSync(checked, { recursive: true });
  });
  const project = path.join(temporary, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({expo:{autolinking:{android:{buildFromSource:['expo-audio','expo-video']}}}}));
  const packageRoot = name => sharedVideo && name === 'expo-video'
    ? path.join(temporary, 'shared-expo-video') : path.join(project, 'node_modules', name);
  const files = PATCHES.map(patch => ({ patch, source: originalSource(patch), filename: path.join(packageRoot(patch.package), patch.file) }));
  const packages = {};
  for (const [name, version] of Object.entries(VERSIONS)) {
    const directory = packageRoot(name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
    packages[`node_modules/${name}`] = { version };
  }
  fs.writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify({ packages }));
  for (const { filename, source } of files) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, crlf ? source.replace(/\n/g, '\r\n') : source);
  }
  if (sharedVideo) fs.symlinkSync(packageRoot('expo-video'), path.join(project, 'node_modules/expo-video'), process.platform === 'win32' ? 'junction' : 'dir');
  return { project, temporary, files };
}

test('Android precompiled media modules are refused before patching because they omit authentication fixes', t => {
  const {project,files}=fixture(t);
  fs.writeFileSync(path.join(project,'package.json'), JSON.stringify({expo:{autolinking:{android:{buildFromSource:['expo-audio']}}}}));
  assert.throws(()=>applyPatches(project),/precompiled modules omit/);
  for (const {filename,source} of files) assert.equal(fs.readFileSync(filename,'utf8'),source);
  const real=JSON.parse(fs.readFileSync(path.join(mobileRoot,'package.json'),'utf8'));
  assert.ok(['expo-audio','expo-video'].every(name=>real.expo.autolinking.android.buildFromSource.includes(name)));
});

test('native media clients explicitly use the same per-URL platform-cookie handler as React Native', t => {
  const { project, files } = fixture(t);
  const result = applyPatches(project);
  assert.equal(result.length, 3);
  assert.ok(result.every(item => item.status === 'patched'));
  for (const { patch, filename } of files.filter(item => item.patch.file.endsWith('.kt'))) {
    const changed = fs.readFileSync(filename, 'utf8');
    assert.match(changed, /import com\.facebook\.react\.modules\.network\.ForwardingCookieHandler/);
    assert.match(changed, /OkHttpClientProvider\.getOkHttpClient\(\)\.newBuilder\(\)\s*\.cookieJar\(JavaNetCookieJar\(ForwardingCookieHandler\(\)\)\)\s*\.build\(\)/);
    // A provider-only copy has an uninitialized cookie container in RN 0.86.
    // The explicit handler is necessary on both audio and video transports.
    let restored = changed;
    for (const [before, after] of [...patch.replacements].reverse()) restored = restored.replace(after, before);
    assert.equal(hash(restored), patch.originalSha256, 'unrelated native player behavior must remain untouched');
  }
  assert.match(fs.readFileSync(files[1].filename, 'utf8'), /implementation 'com\.facebook\.react:react-android'/);
});

test('patch and verification are idempotent and preserve Windows line endings', t => {
  const { project, files } = fixture(t, { crlf: true });
  assert.throws(() => applyPatches(project, { checkOnly: true }), /patch is missing/);
  applyPatches(project);
  const before = files.map(item => fs.readFileSync(item.filename, 'utf8'));
  assert.ok(before.every(source => !source.replace(/\r\n/g, '').includes('\n')));
  assert.ok(applyPatches(project).every(item => item.status === 'verified'));
  assert.ok(applyPatches(project, { checkOnly: true }).every(item => item.status === 'verified'));
  assert.deepEqual(files.map(item => fs.readFileSync(item.filename, 'utf8')), before);
});

test('an unexpected installed Expo version stops before modifying either module', t => {
  const { project, files } = fixture(t);
  fs.writeFileSync(path.join(project, 'node_modules/expo-video/package.json'), JSON.stringify({ name: 'expo-video', version: '57.0.6' }));
  assert.throws(() => applyPatches(project), /expo-video.*requires installed and locked version 57\.0\.5/);
  assert.ok(files.every(item => fs.readFileSync(item.filename, 'utf8') === item.source));
});

test('an unexpected React Native version or lockfile change cannot reuse the reviewed patch', t => {
  const { project, files } = fixture(t);
  const lockPath = path.join(project, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath));
  lock.packages['node_modules/react-native'].version = '0.87.0';
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  assert.throws(() => applyPatches(project), /react-native.*requires installed and locked version 0\.86\.3/);
  assert.ok(files.every(item => fs.readFileSync(item.filename, 'utf8') === item.source));
});

test('an upstream source change in the last target aborts the whole patch before any write', t => {
  const { project, files } = fixture(t);
  fs.appendFileSync(files[2].filename, '\n// Upstream change requiring review.\n');
  assert.throws(() => applyPatches(project), /expo-video.*unexpected source/);
  assert.equal(fs.readFileSync(files[0].filename, 'utf8'), files[0].source);
  assert.equal(fs.readFileSync(files[1].filename, 'utf8'), files[1].source);
});

test('a partial provider-only patch is rejected instead of being treated as cookie-enabled', t => {
  const { project, files } = fixture(t);
  const { filename, source } = files[0];
  fs.writeFileSync(filename, source.replace('OkHttpClient()', 'OkHttpClientProvider.getOkHttpClient().newBuilder().build()'));
  assert.throws(() => applyPatches(project), /expo-audio.*unexpected source/);
  assert.equal(fs.readFileSync(files[2].filename, 'utf8'), files[2].source);
});

test('shared dependency junctions are refused without modifying their target', t => {
  const { project, files } = fixture(t, { sharedVideo: true });
  assert.throws(() => applyPatches(project), /refusing to edit shared or external package files/);
  assert.equal(fs.readFileSync(files[0].filename, 'utf8'), files[0].source);
  assert.equal(fs.readFileSync(files[2].filename, 'utf8'), files[2].source);
});

test('the checked-in install lifecycle applies and verifies the native media patch', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package-lock.json')));
  assert.equal(manifest.scripts.postinstall, 'node scripts/patch-native-media-cookies.cjs');
  assert.equal(manifest.scripts['check:native-media'], 'node scripts/patch-native-media-cookies.cjs --check');
  assert.equal(lock.packages[''].hasInstallScript, true);
});
