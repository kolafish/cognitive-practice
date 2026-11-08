import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openMatrixStore, parseMatrixPack } from '../public/matrix-pack.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function fixture() {
  return {
    format: 'cognitive-practice-matrix-pack', version: 1, id: 'test-pack',
    images: Object.fromEntries(['stem', 'sheet', 'a', 'b', 'c', 'd'].map((key) => [key, png])),
    questions: [
      { id: 'q-variant', kind: 'mars-variant', image: 'stem', variantOf: 'original', options: ['a', 'b', 'c', 'd'], answer: 2 },
      { id: 'q-sandia', kind: 'sandia', image: 'stem', optionsImage: 'sheet', answer: 7 },
    ],
  };
}

test('local pack validates both option formats and rejects external or malformed media', () => {
  const input = fixture();
  const pack = parseMatrixPack(JSON.stringify(input));
  assert.equal(pack.questions.length, 2);
  assert.equal(pack.files.get('stem').type, 'image/png');
  input.images.stem = 'https://example.com/image.png';
  assert.throws(() => parseMatrixPack(JSON.stringify(input)), /有效的矩阵题包/);
  input.images.stem = png;
  input.questions[1].answer = 8;
  assert.throws(() => parseMatrixPack(JSON.stringify(input)), /有效的矩阵题包/);
});

test('private packs and answers survive reopening without crossing profiles or recording a duplicate', async () => {
  const owner = 'user:matrix-tester';
  const other = 'user:other-matrix-tester';
  const pack = parseMatrixPack(JSON.stringify(fixture()));
  const store = await openMatrixStore();
  await store.savePack(owner, pack);
  const record = { owner, packId: pack.id, questionId: 'q-variant', selected: 2, correct: true };
  const duplicate = { ...record, selected: 1, correct: false };
  const saved = await Promise.all([store.saveAnswer(record), store.saveAnswer(duplicate)]);
  assert.deepEqual(saved, [record, record]);
  const reopened = await openMatrixStore();
  assert.deepEqual((await reopened.pack(owner)).questions, pack.questions);
  assert.deepEqual(await reopened.answers(owner, pack.id), [record]);
  assert.equal(await reopened.pack(other), undefined);
  assert.deepEqual(await reopened.answers(other, pack.id), []);
});
