#!/usr/bin/env node
'use strict';

// Expo's fresh Android media clients do not use the native LMS session cookies.
// RN 0.86 initializes a different networking client from its global provider,
// so copying the provider alone is insufficient. ForwardingCookieHandler uses
// Android CookieManager per request URL, as React Native's Fresco client does.
// No cookie values enter JavaScript, source files, headers or build logs here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSIONS = Object.freeze({ 'expo-audio': '57.0.5', 'expo-video': '57.0.5', 'react-native': '0.86.3' });
const nativeImports = 'import com.facebook.react.modules.network.ForwardingCookieHandler\n' +
  'import com.facebook.react.modules.network.OkHttpClientProvider\nimport okhttp3.JavaNetCookieJar\n';
const PATCHES = Object.freeze([
  {
    package: 'expo-audio', file: 'android/src/main/java/expo/modules/audio/AudioModule.kt',
    originalSha256: '637fe9bed875e47c3348a1f9623c4e049965efec2ebbe77cff6836c94544177a',
    replacements: [
      ['import okhttp3.OkHttpClient\n', nativeImports],
      ['  private val httpClient = OkHttpClient()\n',
       '  private val httpClient = OkHttpClientProvider.getOkHttpClient().newBuilder()\n' +
       '    .cookieJar(JavaNetCookieJar(ForwardingCookieHandler()))\n    .build()\n'],
    ],
  },
  {
    package: 'expo-audio', file: 'android/build.gradle',
    originalSha256: '6ca1b2685c5cd6f8dc0554bee3c57b465b45e8a7d0950ef50e797f55e156ca16',
    replacements: [['dependencies {\n', 'dependencies {\n  implementation \'com.facebook.react:react-android\'\n']],
  },
  {
    package: 'expo-video', file: 'android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt',
    originalSha256: '8ffd704064677f8862f093b43a14c20584c6235b9602384979a0e5498cb943ee',
    replacements: [
      ['import okhttp3.OkHttpClient\n', nativeImports],
      ['  val client = OkHttpClient.Builder().build()\n',
       '  val client = OkHttpClientProvider.getOkHttpClient().newBuilder()\n' +
       '    .cookieJar(JavaNetCookieJar(ForwardingCookieHandler()))\n    .build()\n'],
    ],
  },
]);

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/\r\n/g, '\n');

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function replaceOnce(source, from, to, label) {
  if (source.split(from).length !== 2) throw new Error(`${label}: expected exactly one reviewed patch location`);
  return source.replace(from, to);
}

function checkedSource(source, patch) {
  const normalized = normalize(source);
  if (hash(normalized) === patch.originalSha256) {
    const updated = patch.replacements.reduce((text, [from, to]) => replaceOnce(text, from, to, patch.file), normalized);
    return { changed: true, contents: source.includes('\r\n') ? updated.replace(/\n/g, '\r\n') : updated };
  }
  // Recognize only the exact fully patched file; partial patches or unrelated
  // upstream/source changes require a new reviewed patch, never a fuzzy edit.
  let restored;
  try {
    restored = patch.replacements.reduceRight((text, [from, to]) => replaceOnce(text, to, from, patch.file), normalized);
  } catch {
    throw new Error(`${patch.package}/${patch.file}: unexpected source; review the pinned native cookie patch`);
  }
  if (hash(restored) !== patch.originalSha256) {
    throw new Error(`${patch.package}/${patch.file}: unexpected source; review the pinned native cookie patch`);
  }
  return { changed: false, contents: source };
}

function planPatches(projectRoot) {
  const root = fs.realpathSync(projectRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const sourceModules = manifest.expo?.autolinking?.android?.buildFromSource || [];
  if (!['expo-audio', 'expo-video'].every(name => sourceModules.includes(name))) {
    throw new Error('Android must build expo-audio and expo-video from source; precompiled modules omit the session-cookie patch');
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [name, expected] of Object.entries(VERSIONS)) {
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.name !== name || installed.version !== expected || lock.packages?.[`node_modules/${name}`]?.version !== expected) {
      throw new Error(`${name}: native cookie patch requires installed and locked version ${expected}`);
    }
  }
  return PATCHES.map(patch => {
    const packageRoot = fs.realpathSync(path.join(root, 'node_modules', patch.package));
    const filename = fs.realpathSync(path.join(packageRoot, patch.file));
    if (!inside(root, packageRoot) || !inside(packageRoot, filename)) {
      throw new Error(`${patch.package}: refusing to edit shared or external package files; install private package copies in this checkout`);
    }
    const original = fs.readFileSync(filename, 'utf8');
    return { filename, original, package: patch.package, file: patch.file, ...checkedSource(original, patch) };
  });
}

function applyPatches(projectRoot, { checkOnly = false } = {}) {
  // Validate ALL files and versions before the first write. A changed second
  // package must not leave a partially patched dependency tree behind.
  const plan = planPatches(projectRoot);
  if (checkOnly && plan.some(item => item.changed)) throw new Error('Native media cookie patch is missing; run npm run patch:native-media');
  if (!checkOnly) {
    for (const item of plan) {
      if (fs.readFileSync(item.filename, 'utf8') !== item.original) throw new Error(`${item.package}: source changed while preparing the patch`);
    }
    for (const item of plan) if (item.changed) fs.writeFileSync(item.filename, item.contents, 'utf8');
  }
  return plan.map(({ package: name, file, changed }) => ({ package: name, file, status: changed ? 'patched' : 'verified' }));
}

module.exports = { VERSIONS, PATCHES, checkedSource, planPatches, applyPatches };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: patch-native-media-cookies.cjs [--check]');
    const result = applyPatches(path.resolve(__dirname, '..'), { checkOnly: args[0] === '--check' });
    for (const row of result) console.log(`Native media cookie transport: ${row.package}/${row.file} ${row.status}`);
  } catch (error) {
    console.error(`Native media cookie transport failed: ${error.message}`);
    process.exitCode = 1;
  }
}
