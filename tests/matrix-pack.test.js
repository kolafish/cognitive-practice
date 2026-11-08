import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { northMatrixQuestions, openMatrixStore, parseMatrixPack } from '../public/matrix-pack.js';
import { advanceSession, beginQuestion, isValidSession, submitAnswer, summarize } from '../public/engine.js';
import { createProfile, createUserSession, questionIdentity, rememberSession, selectNorthFigure } from '../public/profiles.js';
import { scoreByFamily } from '../public/scoring.js';

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

test('North uses an unused exact-level original first, then a variant without reusing a template in the same round', () => {
  const pack = fixture();
  pack.questions.push({ ...pack.questions[0], id: 'same-template' });
  const supplement = northMatrixQuestions(parseMatrixPack(JSON.stringify(pack)));
  const [variant, sandia] = supplement;
  const profile = createProfile('Matrix QA', 0);
  const session = createUserSession(profile, 40, 'north', 0);
  session.familyLevels['matrix-choice'] = 4;
  const original = { id: 'original', sourceId: 'mars_ib', category: 'figure', taskFamily: 'matrix-choice', familyLevel: 4 };
  const adjacent = { ...original, id: 'adjacent', familyLevel: 3 };
  const pool = [original, adjacent];
  const pick = (seen = new Set()) => selectNorthFigure(pool, supplement, session, profile, seen, () => 0);
  assert.equal(pick(), original);
  profile.seenQuestions.push(questionIdentity(original));
  assert.equal(pick(), variant);
  assert.equal(pick(new Set(['q-variant'])).matrixItemId, 'same-template');
  session.responses.push({ category: 'figure', questionId: variant.id, questionSnapshot: variant, sourceId: variant.sourceId });
  assert.equal(pick(), adjacent);
  for (let i = 0; i < 3; i++) session.responses.push({ category: 'figure', questionId: `prior-${i}` });
  assert.equal(pick(), sandia);
  assert.equal(pick(new Set(['q-sandia'])), adjacent);
});

test('North records variants as review and Sandia without a level or points, including at the time limit', () => {
  const [variant, sandia] = northMatrixQuestions(parseMatrixPack(JSON.stringify(fixture())));
  const profile = createProfile('Matrix scoring QA', 0);
  let session = createUserSession(profile, 40, 'north', 0);
  session.familyLevels['matrix-choice'] = 4;
  session = beginQuestion(session, variant, 100);
  session = submitAnswer(session, variant, variant.answer, 200).session;
  session = beginQuestion(session, sandia, 300);
  assert.ok(isValidSession(session));
  const answered = submitAnswer(session, sandia, sandia.answer, 400).session;
  assert.ok(isValidSession(answered));
  assert.equal(answered.responses[1].presentedLevel, null);
  const info = summarize(answered, 400);
  assert.equal(info.correct, 1);
  assert.equal(info.newPoints, 0);
  assert.equal(info.reviewPoints, 40);
  assert.deepEqual(info.unrated, { correct: 1, incorrect: 0, skipped: 0, unanswered: 0, timeMs: 100 });
  assert.deepEqual(scoreByFamily(answered).find((row) => row.id === 'sandia-matrix').levels, []);
  assert.deepEqual(answered.familyLevels, { 'matrix-choice': 4 });
  const remembered = rememberSession(profile, answered);
  assert.deepEqual(remembered.levels.north, {});
  assert.deepEqual(remembered.seenQuestions, [questionIdentity(variant), questionIdentity(sandia)]);
  const timedOut = advanceSession(session, 800000);
  assert.ok(isValidSession(timedOut));
  assert.equal(summarize(timedOut, 800000).unrated.unanswered, 1);
});
