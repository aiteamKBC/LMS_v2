import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import config from '../frontend/vitest.config';

const root = resolve(process.cwd(), '..');
const files = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const sources = new Map(files.filter(file => /\.(ts|tsx)$/.test(file)).map(file => [
  resolve(root, file).replaceAll('\\', '/'),
  execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' }),
]));
export default {
  ...config,
  plugins: [{ name: 'read-only-head-baseline', enforce: 'pre', load(id: string) { return sources.get(id.split('?')[0]); } }, ...config.plugins],
};
