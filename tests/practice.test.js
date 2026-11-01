import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MEMORY_FAMILIES, generateVisualMemory, validVisualMemory, validStoredQuestion, taskFamily, targetLevel } from '../public/practice.js';
import { createSession, beginQuestion, submitAnswer, chooseQuestion, gradeAnswer, memoryStage, pauseSession, resumeSession, finishSession, parseBackup, isValidSession, summarize } from '../public/engine.js';

const NOW = Date.parse('2026-11-01T01:00:00Z');
const fullBank = JSON.parse(readFileSync(new URL('../public/data/bank.json', import.meta.url)));
const matrix = fullBank.categories.figure.find((q) => q.type === 'choice');
const start = (mode = 'north') => createSession(4, NOW, `test-${mode}`, mode);
const memorySession = (q) => beginQuestion(start(), q, NOW + 80000);
const envelope = (sessions) => JSON.stringify({ app: 'cognitive-practice', version: 1, sessions });

// Recompute mirror coordinates independently of the generator's helper.
function symmetric(q) {
  return q.cells.every((cell) => {
    const r = Math.floor((cell - 1) / q.gridColumns), c = (cell - 1) % q.gridColumns;
    const reflected = q.axis === 'vertical' ? r * q.gridColumns + q.gridColumns - c : (q.gridRows - 1 - r) * q.gridColumns + c + 1;
    return q.cells.includes(reflected);
  });
}

test('visual generation produces valid, reproducible exercises at all eight levels', () => {
  for (const family of MEMORY_FAMILIES) for (let level = 1; level <= 8; level++) {
    const answers = new Set();
    for (let seed = 0; seed < 80; seed++) {
      const q = generateVisualMemory(family, level, String(seed));
      assert.ok(validVisualMemory(q), `${family}/${level}/${seed}`);
      assert.deepEqual(q, generateVisualMemory(family, level, String(seed)));
      assert.equal(gradeAnswer(q, q.answer), true);
      assert.equal(q.displayMs, 1000);
      if (q.type === 'memory-positions') {
        assert.equal(q.cells.length, level + 1);
        assert.equal(gradeAnswer(q, [...q.answer].reverse()), true);
        assert.equal(gradeAnswer(q, Array(q.answer.length).fill(q.answer[0])), false);
      } else if (q.type === 'memory-recognition') {
        for (const choice of q.choices) {
          assert.equal(choice.cells.length, q.cells.length);
          assert.equal(gradeAnswer(q, choice.id), choice.cells.slice().sort((a,b)=>a-b).join(',') === q.cells.join(','));
        }
      } else {
        assert.equal(q.answer, symmetric(q) ? 'symmetric' : 'asymmetric');
        assert.equal(q.cells.length % 2, 0); // Counting marks cannot reveal the answer.
        answers.add(q.answer);
      }
    }
    if (family === 'visual-symmetry') assert.equal(answers.size, 2);
  }
});

test('whole-image exposure lasts one second, hides before recall, and freezes on pause', () => {
  for (const family of MEMORY_FAMILIES) {
    const q = generateVisualMemory(family, 2, 'timing');
    let s = memorySession(q);
    assert.equal(memoryStage(s, q, s.current, NOW + 80000).phase, 'ready');
    s.current.presentationAtElapsed = 80000;
    for (const [delta, phase] of [[0,'lead'],[499,'lead'],[500,'target'],[1499,'target'],[1500,'answer'],[20000,'answer']]) {
      assert.equal(memoryStage(s, q, s.current, NOW + 80000 + delta).phase, phase);
    }
    assert.equal(submitAnswer(s, q, q.answer, NOW + 81000).rejected, true);
    const paused = pauseSession(s, NOW + 80800);
    assert.equal(memoryStage(paused, q, paused.current, NOW + 999999).phase, 'target');
    const resumed = resumeSession(paused, NOW + 90000);
    assert.equal(memoryStage(resumed, q, resumed.current, NOW + 90699).phase, 'target');
    assert.equal(memoryStage(resumed, q, resumed.current, NOW + 90700).phase, 'answer');
    assert.equal(submitAnswer(s, q, q.answer, NOW + 81500).response.correct, true);
  }
});

test('subtypes start at one independently and selection balances subtypes before matching level', () => {
  const q1 = { ...matrix, id: 'matrix-a', taskFamily: 'matrix-choice', familyLevel: 1 };
  const q2 = { ...matrix, id: 'matrix-b', taskFamily: 'matrix-choice', familyLevel: 2 };
  const other = { ...matrix, id: 'construction-a', taskFamily: 'matrix-construction', familyLevel: 1 };
  let s = beginQuestion(start('extended'), q1, NOW);
  s = submitAnswer(s, q1, q1.answer, NOW + 1000).session;
  assert.equal(targetLevel(s, q2), 2);
  assert.equal(targetLevel(s, other), 1);
  assert.equal(chooseQuestion([q1,q2,other], s, 'figure', {}, () => 0).id, other.id);
  s = beginQuestion(s, other, NOW + 2000);
  s = submitAnswer(s, other, 'wrong', NOW + 3000).session;
  assert.equal(targetLevel(s, q2), 2);
  assert.equal(targetLevel(s, other), 1);
  assert.equal(chooseQuestion([q1,q2,other], s, 'figure', {}, () => 0).id, q2.id);
  assert.deepEqual(summarize(s, NOW + 3000).sections[0].families.map((f) => f.level), [2,1]);
});

test('all 5598 original questions can be retained as v3 snapshots in extension', () => {
  for (const q of Object.values(fullBank.categories).flat()) assert.ok(validStoredQuestion(q), q.id);
  for (const [index, category] of ['figure','memory','spatial','verbal'].entries()) {
    const startAt = [0,80000,120000,180000][index];
    for (const q of fullBank.categories[category]) {
      const s = beginQuestion(start('extended'), q, NOW + startAt);
      assert.equal(isValidSession(s), true, q.id);
    }
  }
});

test('fixed and generated snapshots round trip with legacy history without bank lookups', () => {
  let fixed = beginQuestion(start(), matrix, NOW);
  fixed = submitAnswer(fixed, matrix, matrix.answer, NOW + 1000).session;
  fixed = finishSession(fixed, NOW + 2000);
  assert.deepEqual(fixed.responses[0].questionSnapshot, matrix);
  const generated = MEMORY_FAMILIES.map((family) => {
    const q = generateVisualMemory(family, 3, `backup-${family}`);
    let s = memorySession(q);
    s.id = family;
    s.current.presentationAtElapsed = 80000;
    s = submitAnswer(s, q, q.answer, NOW + 82000).session;
    return finishSession(s, NOW + 83000);
  });
  const old2 = createSession(4, NOW, 'v2');
  const old1 = { ...createSession(4, NOW, 'v1'), version: 1, sectionMs: 60000 };
  delete old1.sectionDurationsMs; delete old1.memoryDisplayMs;
  const parsed = parseBackup(envelope([fixed,...generated,old1,old2]));
  assert.equal(parsed.length, 6);
  assert.deepEqual(parsed[0].responses, fixed.responses);
  for (let i = 0; i < generated.length; i++) assert.deepEqual(parsed[i+1].responses[0].generatedQuestion, generated[i].responses[0].generatedQuestion);
  assert.equal(parsed[4].sectionMs, 60000);
  assert.equal(parsed[5].version, 2);
  assert.equal(parsed[5].status, 'paused');
});

test('timeouts retain original stimulus and subtype, without changing subtype level', () => {
  const q = generateVisualMemory('visual-positions', 1, 'timeout');
  const s = finishSession(memorySession(q), NOW + 85000);
  const r = s.responses[0];
  assert.equal(r.status, 'unanswered');
  assert.equal(r.taskFamily, 'visual-positions');
  assert.equal(r.levelAfter, 1);
  assert.deepEqual(r.generatedQuestion, q);
  assert.ok(isValidSession(s));
});

test('malformed backup snapshots, media, cells, and prototype family names reject safely', () => {
  const base = memorySession(generateVisualMemory('visual-recognition', 2, 'unsafe'));
  const edits = [
    (s) => { s.current.generatedQuestion.choices[0] = null; },
    (s) => { s.current.generatedQuestion.gridColumns = 100000; },
    (s) => { s.current.generatedQuestion.cells[0] = 9999; },
    (s) => { s.current.generatedQuestion.cells[1] = s.current.generatedQuestion.cells[0]; },
    (s) => { s.current.taskFamily = '__proto__'; },
    (s) => { s.familyLevels.constructor = 4; },
    (s) => { delete s.current.generatedQuestion; },
  ];
  for (const edit of edits) {
    const bad = structuredClone(base); edit(bad);
    assert.equal(isValidSession(bad), false);
    assert.throws(() => parseBackup(envelope([bad])));
  }
  const staticBase = beginQuestion(start(), matrix, NOW);
  for (const edit of [
    (q) => { q.image = 'https://example.com/tracker.png'; },
    (q) => { q.choices[0].imageCrop = {x:0,y:0,width:100,height:100,sourceWidth:20,sourceHeight:20}; },
  ]) {
    const bad = structuredClone(staticBase); edit(bad.current.questionSnapshot);
    assert.equal(isValidSession(bad), false);
  }
});

test('main pool contains only curated tasks; folding options require position reasoning', () => {
  const bank = JSON.parse(readFileSync(new URL('../public/data/practice-bank.json', import.meta.url)));
  const all = Object.values(bank.categories).flat();
  assert.equal(bank.stats.total, all.length);
  assert.equal(bank.categories.memory.length, 0); // Generated separately, never borrowed from the extension pool.
  assert.equal(bank.categories.figure.length, 80);
  assert.equal(new Set(all.map((q) => q.id)).size, all.length);
  const original = new Map(Object.values(fullBank.categories).flat().map((q) => [q.id,q]));
  for (const q of all) {
    assert.ok(validStoredQuestion(q), q.id);
    assert.ok(q.curationReason && q.sourceQuestionId && Number.isInteger(q.familyLevel), q.id);
    assert.equal(q.promptNeedsOriginal ?? false, false);
    assert.ok(original.has(q.sourceQuestionId));
    assert.ok(['matrix-choice','folding-static','folding-animation','verbal-order','verbal-analogy'].includes(taskFamily(q)));
    assert.equal(gradeAnswer(q, q.answer), true);
    if (q.type === 'folding-choice') {
      assert.notEqual(q.id, q.sourceQuestionId); // Old count-only results remain identifiable.
      assert.equal(q.choices.length, 4);
      const correct = q.choices.find((c) => c.id === q.answer);
      assert.equal(correct.image, q.answerImage);
      const shapes = (c) => JSON.stringify(c.holeShapeSizes);
      assert.ok(q.choices.every((c) => c.holeCount === correct.holeCount && shapes(c) === shapes(correct)));
      assert.equal(new Set(q.choices.map((c) => JSON.stringify(c.holePositions))).size, 4);
      for (const c of q.choices) assert.ok(c.imageCrop.width > 0 && c.imageCrop.x + c.imageCrop.width <= c.imageCrop.sourceWidth);
    }
    if (q.taskFamily === 'verbal-order') {
      assert.equal(q.curationMetrics.sourceAnswerVerified, true);
      assert.equal(q.curationMetrics.directRestatement, false);
      assert.ok(q.curationMetrics.minimumRequiredClues >= 2);
    }
  }
});
