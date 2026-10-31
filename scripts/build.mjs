import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';

const bank = JSON.parse(await readFile(new URL('../public/data/bank.json', import.meta.url), 'utf8'));
for (const id of ['figure', 'memory', 'spatial', 'verbal']) {
  if (!bank.categories[id]?.length) throw new Error(`Missing category: ${id}`);
}
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url));
await cp(new URL('../public/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
await stat(new URL('../dist/index.html', import.meta.url));
console.log('Static site built in dist; all four question categories available.');
