import { cp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const bank = JSON.parse(await readFile(new URL('public/data/bank.json', root), 'utf8'));
const practiceBank = JSON.parse(await readFile(new URL('public/data/practice-bank.json', root), 'utf8'));
for (const id of ['figure', 'memory', 'spatial', 'verbal']) {
  if (!bank.categories[id]?.length) throw new Error(`Missing category: ${id}`);
  if (!Array.isArray(practiceBank.categories[id]) || id !== 'memory' && !practiceBank.categories[id].length) throw new Error(`Missing main-practice category: ${id}`);
}
const modules = ['app.js', 'engine.js', 'storage.js', 'practice.js', 'profiles.js', 'scoring.js'];
const files = [...modules, 'styles.css', 'data/practice-bank.json'];
const source = new Map(await Promise.all(files.map(async (path) => [path, await readFile(new URL(`public/${path}`, root), 'utf8')])));
const release = createHash('sha256').update([...source.values()].join('\n')).digest('hex').slice(0, 12);
await rm(new URL('dist/', root), { recursive: true, force: true });
await mkdir(new URL('dist/', root));
await cp(new URL('public/', root), new URL('dist/', root), { recursive: true });
// One release key keeps module imports and curated data coherent across browser caches.
for (const path of modules) {
  let content = source.get(path).replace(/from '(\.\/[^']+\.js)'/g, `from '$1?v=${release}'`);
  content = content.replace(/(fetch|loadBank)\('data\/(bank|practice-bank)\.json'\)/g, `$1('data/$2.json?v=${release}')`);
  await writeFile(new URL(`dist/${path}`, root), content);
}
const html = (await readFile(new URL('public/index.html', root), 'utf8')).replace('src="app.js"', `src="app.js?v=${release}"`).replace('href="styles.css"', `href="styles.css?v=${release}"`);
await writeFile(new URL('dist/index.html', root), html);
await stat(new URL('dist/index.html', root));
console.log(`Static site built in dist; main and extension banks available. Release ${release}.`);
