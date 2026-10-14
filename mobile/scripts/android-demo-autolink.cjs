// Build-only path normalisation: keep Windows subst paths on one drive.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.cwd();
const physical = fs.realpathSync.native(root);
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking'), 'react-native-config', '--platform', 'android', '--json'], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) { process.stderr.write(result.stderr || 'Native autolinking failed'); process.exit(result.status || 1); }
const values = JSON.parse(result.stdout);
function normalise(value) {
  if (typeof value === 'string') {
    for (const sourceRoot of [physical, process.env.KBC_DEPENDENCY_ROOT].filter(Boolean)) for (const sep of ['\\', '/']) {
      const from = sourceRoot.split(path.sep).join(sep);
      const to = root.split(path.sep).join(sep);
      if (value === from || value.startsWith(from + sep)) return to + value.slice(from.length);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, normalise(val)]));
  return value;
}
process.stdout.write(JSON.stringify(normalise(values)));
