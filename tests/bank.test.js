import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { gradeAnswer } from '../public/engine.js';

const bank = JSON.parse(await readFile(new URL('../public/data/bank.json', import.meta.url), 'utf8'));
test('all exported questions are renderable and their source answer grades as correct', async () => {
  const ids = new Set();
  const types = new Set(['choice', 'construction', 'memory-grid', 'memory-digits', 'memory-binding', 'folding-video']);
  const sources = new Set(bank.sources.map((s) => s.id));
  const media = new Set();
  for (const [category, list] of Object.entries(bank.categories)) {
    assert.ok(list.length);
    assert.ok(list.some((q) => q.level === 1));
    for (const q of list) {
      assert.equal(q.category, category);
      assert.ok(!ids.has(q.id)); ids.add(q.id);
      assert.ok(types.has(q.type));
      assert.ok(sources.has(q.sourceId));
      assert.ok(Number.isInteger(q.level) && q.level >= 1 && q.level <= 8);
      assert.ok(q.originalDifficulty && q.levelBasis);
      assert.equal(gradeAnswer(q, q.answer), true, q.id);
      if (q.type === 'choice') assert.ok(q.choices.some((c) => c.id === q.answer));
      if (q.promptNeedsOriginal) assert.ok(q.originalPromptEn);
      for (const key of ['image', 'video', 'answerImage', 'probeImage']) if (q[key]) media.add(q[key]);
      for (const option of [...(q.choices ?? []), ...(q.elements ?? [])]) if (option.image) media.add(option.image);
    }
  }
  assert.equal(ids.size, bank.stats.total);
  for (const path of media) {
    assert.match(path, /^assets\/bank\/[a-f0-9]+\.(?:jpeg|jpg|svg|png|mp4)$/);
    assert.ok((await stat(new URL(`../public/${path}`, import.meta.url))).size > 0);
  }
});
