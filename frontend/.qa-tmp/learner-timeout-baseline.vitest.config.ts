import { mergeConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import base from '../vitest.config';

const root = process.cwd();
const originals = new Map([
  [resolve(root, 'src/components/feature/LearnerProgrammeGate.tsx').replaceAll('\\', '/'),
   readFileSync(resolve(root, '../.qa-tmp/learner-timeout-baseline-gate.txt'), 'utf8')],
  [resolve(root, 'src/pages/learner/video-watch/page.tsx').replaceAll('\\', '/'),
   readFileSync(resolve(root, '../.qa-tmp/learner-timeout-baseline-activity.txt'), 'utf8')],
]);

export default mergeConfig(base, {
  root,
  plugins: [{
    name: 'unchanged-head-source-baseline',
    enforce: 'pre',
    load(id) {
      return originals.get(id.split('?')[0].replaceAll('\\', '/')) ?? null;
    },
  }],
});
