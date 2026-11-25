// Static value-import/export cycles in frontend production source.
// Uses the installed TypeScript resolver; does not import application modules.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const frontend = path.resolve(__dirname, '..');
const root = path.join(frontend, 'src');
const config = ts.readConfigFile(path.join(frontend, 'tsconfig.app.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, frontend);
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['__tests__', 'test', 'mocks'].includes(entry.name)) collect(file);
    } else if (/\.[jt]sx?$/.test(file) && !/(\.test\.|\.spec\.|\.d\.ts$)/.test(file)) {
      files.push(file);
    }
  }
}
collect(root);
const graph = new Map();
const unresolved = new Set();
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const edges = [];
  for (const node of source.statements) {
    if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
    if (node.isTypeOnly || node.importClause?.isTypeOnly) continue;
    const bindings = node.importClause?.namedBindings || node.exportClause;
    if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
      && bindings.elements.length && !node.importClause?.name
      && bindings.elements.every(element => element.isTypeOnly)) continue;
    const specifier = node.moduleSpecifier.text;
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
    if (!resolved) {
      // Assets are not source-module edges. Other unresolved local imports are reported.
      if ((specifier.startsWith('.') || specifier.startsWith('@/'))
        && !/\.(css|scss|svg|png|jpg|jpeg|gif|webp|json|woff2?|mp[34]|pdf)(\?.*)?$/.test(specifier)) {
        unresolved.add(`${path.relative(root, file)}: ${specifier}`);
      }
      continue;
    }
    const target = path.normalize(resolved.resolvedFileName);
    if (target.startsWith(root + path.sep) && !target.endsWith('.d.ts')) edges.push(target);
  }
  graph.set(file, edges);
}

let index = 0;
const indexes = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
function visit(file) {
  indexes.set(file, index);
  low.set(file, index++);
  stack.push(file);
  active.add(file);
  for (const target of graph.get(file)) {
    if (!graph.has(target)) continue;
    if (!indexes.has(target)) {
      visit(target);
      low.set(file, Math.min(low.get(file), low.get(target)));
    } else if (active.has(target)) low.set(file, Math.min(low.get(file), indexes.get(target)));
  }
  if (low.get(file) === indexes.get(file)) {
    const component = [];
    let member;
    do {
      member = stack.pop();
      active.delete(member);
      component.push(member);
    } while (member !== file);
    if (component.length > 1 || graph.get(file).includes(file)) {
      cycles.push(component.map(value => path.relative(root, value)).sort());
    }
  }
}
for (const file of graph.keys()) if (!indexes.has(file)) visit(file);
console.log(JSON.stringify({ files: files.length, cyclicComponents: cycles.length, cycles,
  unresolvedLocalSpecifiers: [...unresolved].sort() }, null, 2));
// Dynamic imports and auto-import plugin edges are outside this static check.
if (cycles.length) process.exitCode = 1;
