import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const entry = resolve(root, 'src/game.js');
const modules = new Map();
const edges = new Map();
const remoteNames = new Map();

function exactFile(path) {
  assert.ok(
    readdirSync(dirname(path)).includes(basename(path)),
    `Missing or incorrectly cased local import: ${path}`
  );
}

function load(path) {
  exactFile(path);
  if (modules.has(path)) return modules.get(path);

  const source = readFileSync(path, 'utf8');
  const module = new SourceTextModule(source, { identifier: path });
  modules.set(path, module);
  edges.set(path, []);

  for (const specifier of module.dependencySpecifiers) {
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(path), specifier);
      edges.get(path).push(target);
      load(target);
    } else {
      assert.match(specifier, /^https:\/\//, `Unexpected import: ${specifier}`);
      const names = remoteNames.get(specifier) ?? new Set();
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`, 'g');
      for (const match of source.matchAll(pattern)) {
        for (const name of match[1].split(',')) {
          const imported = name.trim().split(/\s+as\s+/)[0];
          if (imported) names.add(imported);
        }
      }
      remoteNames.set(specifier, names);
    }
  }
  return module;
}

load(entry);

const visiting = new Set();
const visited = new Set();
function checkCycles(path) {
  assert.ok(!visiting.has(path), `Circular local import: ${path}`);
  if (visited.has(path)) return;
  visiting.add(path);
  for (const target of edges.get(path)) checkCycles(target);
  visiting.delete(path);
  visited.add(path);
}
checkCycles(entry);

const remotes = new Map(
  [...remoteNames].map(([url, names]) => [
    url,
    new SyntheticModule([...names], function () {
      for (const name of names) this.setExport(name, undefined);
    }, { identifier: url })
  ])
);

await modules.get(entry).link((specifier, referencingModule) =>
  specifier.startsWith('.')
    ? modules.get(resolve(dirname(referencingModule.identifier), specifier))
    : remotes.get(specifier)
);

console.log(`Import graph valid: ${modules.size} local modules, 0 unresolved imports or cycles.`);
