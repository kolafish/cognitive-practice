import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { parseFigurePack, northFigureQuestions, openFigureStore } from '../public/figure-pack.js';
import { createProfile, createUserSession, rememberSession, selectNorthFigure, unseenQuestions, userBackup, parseUserBackup } from '../public/profiles.js';
import { beginQuestion, submitAnswer, createSession, pauseSession, resumeSession, isValidSession, trainingDurations, sectionIndexAt } from '../public/engine.js';
import { readPreferences, savePreferences } from '../public/storage.js';

// An original one-pixel fixture, never third-party question media.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const fixture = (pack = 'fixture', qid = 'source-01') => ({
  format: 'cognitive-practice-figure-pack', version: 1, id: pack, name: '测试题包', images: { image1: png },
  questions: [{ id: qid, image: 'image1', family: 'quantity', level: 2, prompt: '选择答案', options: ['A','B','C','D'],
    answer: 'B', rules: ['regions'], explanation: '示例解析', sourceName: '测试来源', sourceUrl: 'https://example.com/dataset',
    originalSourceId: '01', reviewStatus: 'image-and-answer-reviewed' }],
});
const parse = (value = fixture()) => parseFigurePack(JSON.stringify(value));

test('private figure import retains rules, source, fixed option labels and independent capped difficulty', async () => {
  const pack = await parse(), [q] = northFigureQuestions(pack);
  assert.equal(pack.files.get('image1').type, 'image/png');
  const p = createProfile('Figure QA', 0);
  p.levels.north['matrix-choice'] = { level: 8, at: 0, order: 'old' };
  let s = createUserSession(p, 50, 'north', 0, 'figure-qa');
  assert.equal(s.familyLevels['figure-quantity'], undefined);
  s = beginQuestion(s, q, 0);
  assert.deepEqual(s.current.choicesOrder, ['A','B','C','D']);
  s = submitAnswer(s, q, 'B', 1000).session;
  assert.equal(s.responses[0].scorePoints, 20);
  assert.equal(s.familyLevels['figure-quantity'], 2);
  assert.equal(s.familyLevels['matrix-choice'], 8);
  const updated = rememberSession(p, s);
  assert.equal(unseenQuestions([q], updated).length, 0);
  assert.deepEqual(parseUserBackup(JSON.stringify(userBackup([s], updated))).sessions[0].responses[0].questionSnapshot, q);
  s.familyLevels['figure-quantity'] = 4;
  const q2 = { ...q, id: 'local-figure-source-02', sourceQuestionId: 'source-02' };
  s = submitAnswer(beginQuestion(s, q2, 2000), q2, 'B', 3000).session;
  assert.equal(s.familyLevels['figure-quantity'], 4);
  assert.ok(isValidSession(s));
});

test('matrix variants cannot replace a selected new rule family', async () => {
  const [q] = northFigureQuestions(await parse());
  const p = createProfile('Selection QA', 0), s = createUserSession(p, 50, 'north', 0);
  s.familyLevels['matrix-choice'] = 4;
  const variant = { ...q, id: 'local-matrix-variant', matrixItemId: 'variant', sourceId: 'local-mars-variant', taskFamily: 'matrix-variant', familyLevel: 4, matrixVariantOf: 'old-matrix' };
  assert.equal(selectNorthFigure([q], [variant], s, p, new Set(), () => 0).id, q.id);
});

test('new 50-minute timing adds exactly ten figure minutes to old 40, while old backups resume unchanged', () => {
  const old = createSession(40, 0, 'old', 'north');
  const fresh = createUserSession(createProfile('Timing QA', 0), 50, 'north', 0, 'new');
  assert.deepEqual(old.sectionDurationsMs, [800000,400000,600000,600000]);
  assert.deepEqual(fresh.sectionDurationsMs, [1400000,400000,600000,600000]);
  assert.deepEqual(fresh.sectionDurationsMs.map((n, i) => n - old.sectionDurationsMs[i]), [600000,0,0,0]);
  assert.deepEqual(trainingDurations(3600000), [1680000,480000,720000,720000]);
  assert.deepEqual(trainingDurations(5400000), [2520000,720000,1080000,1080000]);
  for (const s of [old, fresh]) {
    assert.ok(isValidSession(s));
    assert.deepEqual(resumeSession(pauseSession(s, 1000), 5000).sectionDurationsMs, s.sectionDurationsMs);
    assert.equal(sectionIndexAt(s, s.sectionDurationsMs[0] - 1), 0);
    assert.equal(sectionIndexAt(s, s.sectionDurationsMs[0]), 1);
  }
  assert.equal(isValidSession({ ...old, timingScheme: 'figure-focus-7-2-3-3' }), false);
  assert.equal(isValidSession({ ...fresh, timingScheme: 'unknown' }), false);
});

test('old saved 40-minute preference migrates once; explicitly selecting 40 remains possible', () => {
  const map = new Map();
  globalThis.localStorage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  assert.equal(readPreferences().minutes, 50);
  savePreferences({ minutes: 40, mode: 'north' });
  assert.equal(readPreferences().minutes, 40);
  for (const [key, text] of map) {
    const old = JSON.parse(text); delete old.timingScheme; map.set(key, JSON.stringify(old));
  }
  assert.equal(readPreferences().minutes, 50);
});

test('malformed packs reject remote media, unsupported rules, invalid labels, and oversized images', async () => {
  const edits = [
    (p) => { p.questions.push(p.questions[0]); },
    (p) => { p.questions[0].rules = ['constructor']; },
    (p) => { p.questions[0].family = '__proto__'; },
    (p) => { p.questions[0].sourceUrl = 'javascript:alert(1)'; },
    (p) => { p.questions[0].options = ['A','B','C','C']; },
    (p) => { p.questions[0].level = 8; },
    (p) => { p.questions[0].answer = 'E'; },
    (p) => { p.questions[0].reviewStatus = 'unreviewed'; },
    (p) => { p.questions[0].explanation = ''; },
    (p) => { p.questions[0].image = 'https://example.com/image.png'; },
    (p) => { p.images.image1 = btoa('<svg onload="alert(1)"></svg>'); },
    (p) => { p.images.unused = png; },
    (p) => { const b = Buffer.from(png, 'base64'); b.writeUInt32BE(5000, 16); p.images.image1 = b.toString('base64'); },
  ];
  for (const edit of edits) { const p = fixture(); edit(p); await assert.rejects(parse(p)); }
});

test('imports are owner-scoped, additive and idempotent, rejecting changed or overlapping packs atomically', async () => {
  globalThis.indexedDB = new IDBFactory();
  const store = await openFigureStore(), a = await parse(), b = await parse(fixture('second', 'source-02'));
  await store.savePack('user:jeff', a); await store.savePack('user:jeff', a); await store.savePack('user:jeff', b);
  assert.equal((await store.packs('user:jeff')).length, 2);
  assert.equal((await store.packs('user:other')).length, 0);
  assert.equal((await store.packs('user:jeff'))[0].files.get('image1').size, a.files.get('image1').size);
  const changed = fixture(); changed.questions[0].answer = 'D';
  await assert.rejects(store.savePack('user:jeff', await parse(changed)));
  await assert.rejects(store.savePack('user:jeff', await parse(fixture('overlap'))));
  assert.equal((await store.packs('user:jeff')).length, 2);
  assert.equal((await store.packs('user:jeff'))[0].questions[0].answer, 'B');
});
