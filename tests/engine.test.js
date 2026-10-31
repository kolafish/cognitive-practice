import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, createSession, elapsedTime, categoryAt, advanceSession, pauseSession, resumeSession,
  snapshotSession, finishSession, beginQuestion, submitAnswer, gradeAnswer, chooseQuestion,
  summarize, generatedMemory, parseBackup, isValidSession, trainingDurations, sectionTiming, sectionIndexAt, memoryStage, memoryDisplayDuration,
} from '../public/engine.js';

const NOW = Date.parse('2026-10-31T08:00:00Z');
const choice = (id = 'q1', level = 1, category = 'figure') => ({ id, level, category, sourceId: 'test', type: 'choice', choices: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], answer: 'A' });

test('60 minutes follows the 20/10/15/15 simulation schedule in the requested order', () => {
  const session = createSession(60, NOW, 'time');
  assert.deepEqual(session.sectionDurationsMs, [1200000, 600000, 900000, 900000]);
  assert.equal(session.memoryDisplayMs, 1000);
  assert.deepEqual(CATEGORIES.map((c) => c.id), ['figure', 'memory', 'spatial', 'verbal']);
  const boundaries = [0, 1200000, 1800000, 2700000, 3600000];
  for (let i = 0; i < 4; i++) {
    assert.equal(categoryAt(session, NOW + boundaries[i]).id, CATEGORIES[i].id);
    assert.equal(categoryAt(session, NOW + boundaries[i + 1] - 1).id, CATEGORIES[i].id);
    assert.deepEqual(sectionTiming(session, i), { start: boundaries[i], end: boundaries[i + 1], duration: boundaries[i + 1] - boundaries[i] });
  }
  assert.equal(categoryAt(session, NOW + 3600000), null);
  assert.throws(() => createSession(0));
  assert.throws(() => createSession(NaN));
});

test('90-minute and custom schedules preserve the total without rounding drift', () => {
  assert.deepEqual(createSession(90, NOW).sectionDurationsMs, [1800000, 900000, 1350000, 1350000]);
  assert.deepEqual(createSession(40, NOW).sectionDurationsMs, [800000, 400000, 600000, 600000]);
  for (const total of [240000, 240001, 270000, 10800000]) {
    assert.equal(trainingDurations(total).reduce((sum, duration) => sum + duration, 0), total);
    assert.equal(trainingDurations(total).every((duration) => Number.isInteger(duration) && duration > 0), true);
  }
});

test('correct moves up one level, wrong moves down, other categories stay independent', () => {
  let session = createSession(40, NOW, 'adaptive');
  const a = choice();
  session = beginQuestion(session, a, NOW);
  session = submitAnswer(session, a, 'A', NOW + 2000).session;
  assert.equal(session.levels.figure, 2);
  assert.equal(session.levels.memory, 1);
  const b = choice('q2', 2);
  session = beginQuestion(session, b, NOW + 3000);
  session = submitAnswer(session, b, 'B', NOW + 5000).session;
  assert.equal(session.levels.figure, 1);
  assert.deepEqual(session.responses.map((r) => r.status), ['correct', 'incorrect']);
  assert.equal(session.responses[0].timeMs, 2000);
});

test('levels clamp at 1 and 8; a double submit cannot grade twice', () => {
  let session = createSession(40, NOW, 'limits');
  session.levels.figure = 8;
  const q = choice();
  session = beginQuestion(session, q, NOW);
  session = submitAnswer(session, q, 'A', NOW + 1).session;
  assert.equal(session.levels.figure, 8);
  assert.equal(submitAnswer(session, q, 'B', NOW + 2).rejected, true);
  assert.equal(session.responses.length, 1);
  session.levels.figure = 1;
  session = beginQuestion(session, choice('q2'), NOW + 3);
  session = submitAnswer(session, choice('q2'), 'B', NOW + 4).session;
  assert.equal(session.levels.figure, 1);
});

test('deadline rejects a late answer and saves it as unanswered, not wrong', () => {
  let session = createSession(60, NOW, 'deadline');
  const q = choice();
  session = beginQuestion(session, q, NOW + 1199000);
  const result = submitAnswer(session, q, 'A', NOW + 1200000);
  assert.equal(result.rejected, true);
  assert.equal(result.session.sectionIndex, 1);
  assert.equal(result.session.current, null);
  assert.equal(result.session.responses[0].status, 'unanswered');
  assert.equal(result.session.responses[0].timeMs, 1000);
  assert.equal(summarize(result.session, NOW + 1200000).incorrect, 0);
});

test('clock catches up across hidden tabs without extending any section', () => {
  let session = createSession(60, NOW, 'jump');
  session = beginQuestion(session, choice(), NOW);
  session = advanceSession(session, NOW + 2700123);
  assert.equal(session.sectionIndex, 3);
  assert.equal(session.responses.length, 1);
  assert.equal(session.responses[0].elapsedAtAnswer, 1200000);
  session = advanceSession(session, NOW + 3800000);
  assert.equal(session.status, 'completed');
  assert.equal(elapsedTime(session), 3600000);
  assert.deepEqual(summarize(session).sections.map((s) => s.timeMs), [1200000, 600000, 900000, 900000]);
});

test('pause, checkpoint reload and resume do not charge idle time', () => {
  let session = createSession(40, NOW, 'pause');
  session = pauseSession(session, NOW + 30000);
  assert.equal(elapsedTime(session, NOW + 7200000), 30000);
  session = resumeSession(session, NOW + 7200000);
  assert.equal(elapsedTime(session, NOW + 7205000), 35000);
  const snapshot = snapshotSession(session, NOW + 7205000);
  assert.equal(snapshot.status, 'paused');
  assert.equal(elapsedTime(snapshot, NOW + 86400000), 35000);
  assert.equal(session.status, 'running');
});

test('selection starts simple, finds nearest level, avoids repeats and repeated stems', () => {
  const session = createSession(40, NOW, 'choose');
  const pool = [choice('easy', 1), choice('hard', 8), { ...choice('same-context', 1), groupId: 'shared' }];
  assert.equal(chooseQuestion(pool, session, 'figure', {}, () => 0).id, 'easy');
  session.responses.push({ questionId: 'easy', groupId: 'shared' });
  assert.equal(chooseQuestion(pool, session, 'figure', {}, () => 0).id, 'hard');
  assert.equal(chooseQuestion([choice('seen', 2), choice('fresh', 2)], { ...session, levels: { ...session.levels, figure: 2 } }, 'figure', { seen: 3 }, () => 0).id, 'fresh');
});

test('constructive, ordered memory, binding, and hole-count answers grade correctly', () => {
  assert.equal(gradeAnswer({ type: 'construction', answer: ['0', '2'] }, ['2', '0']), true);
  assert.equal(gradeAnswer({ type: 'construction', answer: ['0', '2'] }, ['0', '0']), false);
  assert.equal(gradeAnswer({ type: 'memory-grid', answer: [3, 10] }, [10, 3]), false);
  assert.equal(gradeAnswer({ type: 'memory-digits', answer: [20, 54] }, [20, 54]), true);
  assert.equal(gradeAnswer({ type: 'memory-binding', answer: 'match' }, 'match'), true);
  assert.equal(gradeAnswer({ type: 'folding-video', answer: 4 }, '4'), true);
  assert.equal(gradeAnswer({ type: 'folding-video', answer: 0 }, ''), false);
  assert.equal(gradeAnswer({ type: 'folding-video', answer: 4 }, '4.5'), false);
});

test('skips lower the target but stay separate from incorrect responses', () => {
  let session = createSession(40, NOW, 'skip');
  session.levels.figure = 3;
  const q = choice();
  session = beginQuestion(session, q, NOW);
  session = submitAnswer(session, q, null, NOW + 1000, true).session;
  const result = summarize(session, NOW + 1000);
  assert.equal(session.levels.figure, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.incorrect, 0);
  assert.equal(result.accuracy, null);
});

test('manual end preserves actual time and excludes future categories', () => {
  let session = createSession(40, NOW, 'stop');
  session = beginQuestion(session, choice(), NOW);
  session = finishSession(session, NOW + 12345);
  const result = summarize(session);
  assert.equal(session.status, 'stopped');
  assert.equal(result.elapsedMs, 12345);
  assert.deepEqual(result.sections.map((s) => s.timeMs), [12345, 0, 0, 0]);
  assert.equal(result.unanswered, 1);
});

test('memory fallback has a bounded sequence and a recoverable snapshot', () => {
  const q = generatedMemory(8, () => 0, 'generated');
  assert.equal(q.sequence.length, 9);
  assert.equal(q.sequence.some((x, i) => i && x === q.sequence[i - 1]), false);
  let session = advanceSession(createSession(4, NOW, 'fallback'), NOW + 80000);
  session = beginQuestion(session, q, NOW + 80000);
  assert.equal(session.current.generatedQuestion.id, q.id);
  assert.equal(gradeAnswer(q, q.sequence), true);
});

test('backup round trip preserves per-question data; malformed import rejects all', () => {
  let session = createSession(40, NOW, 'backup');
  session = beginQuestion(session, choice(), NOW);
  session = submitAnswer(session, choice(), 'A', NOW + 4500).session;
  session = finishSession(session, NOW + 5000);
  const text = JSON.stringify({ app: 'cognitive-practice', version: 1, sessions: [session] });
  assert.deepEqual(parseBackup(text), [session]);
  assert.equal(isValidSession(session), true);
  for (const bad of ['null', '{}', 'not json', JSON.stringify({ app: 'cognitive-practice', version: 1, sessions: [session, session] })]) assert.throws(() => parseBackup(bad));
  const broken = { ...session, totalMs: -1 };
  assert.throws(() => parseBackup(JSON.stringify({ app: 'cognitive-practice', version: 1, sessions: [broken] })));
});

test('backup rejects unsafe display fields and invalid memory snapshots before import', () => {
  let session = beginQuestion(createSession(40, NOW, 'validation'), choice(), NOW);
  session = submitAnswer(session, choice(), 'A', NOW + 1).session;
  assert.equal(isValidSession(session), true);
  for (const change of [
    (s) => { s.responses[0].presentedLevel = '<img src=x onerror=alert(1)>'; },
    (s) => { s.responses[0].levelAfter = '<svg onload=alert(1)>'; },
    (s) => { s.current.choicesOrder = 'A'; },
    (s) => { s.current.presentationAtElapsed = 'invalid'; },
  ]) {
    const broken = structuredClone(session); change(broken);
    assert.equal(isValidSession(broken), false);
  }
  let memory = advanceSession(createSession(4, NOW, 'generated-backup'), NOW + 80000);
  memory = beginQuestion(memory, generatedMemory(3, () => 0, 'safe'), NOW + 80000);
  assert.equal(isValidSession(memory), true);
  memory.current.generatedQuestion.gridColumns = '4;background:url(https://example.com)';
  assert.equal(isValidSession(memory), false);
});

test('each grid or digit is visible for one second; recall has the remaining section time', () => {
  for (const type of ['memory-grid', 'memory-digits']) {
    const q = { id: type, category: 'memory', type, level: 1, sourceId: 'test', sequence: [3, 10], displayMs: 850, intervalMs: 250 };
    let session = advanceSession(createSession(4, NOW, type), NOW + 80000);
    session = beginQuestion(session, q, NOW + 80000);
    assert.equal(memoryStage(session, q, session.current, NOW + 80000).phase, 'ready');
    session.current.presentationAtElapsed = 80000;
    const stage = (offset) => memoryStage(session, q, session.current, NOW + 80000 + offset);
    assert.equal(stage(599).phase, 'lead');
    assert.equal(stage(600).lit, true);
    assert.equal(stage(1599).lit, true);
    assert.equal(stage(1600).lit, false);
    assert.deepEqual([stage(1850).index, stage(1850).lit], [1, true]);
    assert.equal(stage(2849).lit, true);
    assert.equal(stage(2850).lit, false);
    assert.equal(stage(3100).phase, 'answer');
    assert.equal(stage(20000).phase, 'answer');
    assert.equal(sectionIndexAt(session, NOW + 100000), 1);
    assert.equal(q.displayMs, 850);
  }
});

test('binding target uses one second while preserving both original retention delays', () => {
  for (const delayMs of [995, 7995]) {
    const q = { id: 'binding', category: 'memory', type: 'memory-binding', sourceId: 'test', level: 3, displayMs: 1995, delayMs };
    let session = advanceSession(createSession(4, NOW, 'binding'), NOW + 80000);
    session = beginQuestion(session, q, NOW + 80000);
    session.current.presentationAtElapsed = 80000;
    const stage = (offset) => memoryStage(session, q, session.current, NOW + 80000 + offset).phase;
    assert.equal(stage(999), 'target');
    assert.equal(stage(1000), 'hold');
    assert.equal(stage(1000 + delayMs - 1), 'hold');
    assert.equal(stage(1000 + delayMs), 'answer');
    assert.equal(q.displayMs, 1995);
  }
});

test('pausing freezes the one-second memory exposure', () => {
  const q = { id: 'pause-memory', category: 'memory', type: 'memory-binding', sourceId: 'test', level: 3 };
  let session = beginQuestion(advanceSession(createSession(4, NOW, 'memory-pause'), NOW + 80000), q, NOW + 80000);
  session.current.presentationAtElapsed = 80000;
  session = pauseSession(session, NOW + 80500);
  assert.equal(memoryStage(session, q, session.current, NOW + 999999).phase, 'target');
  session = resumeSession(session, NOW + 1000000);
  assert.equal(memoryStage(session, q, session.current, NOW + 1000499).phase, 'target');
  assert.equal(memoryStage(session, q, session.current, NOW + 1000500).phase, 'hold');
});

test('legacy records retain equal allocation and original memory timing alongside new backups', () => {
  const old = {
    version: 1, id: 'legacy', status: 'running', startedAt: new Date(NOW).toISOString(), updatedAt: NOW,
    finishedAt: null, totalMs: 2400000, sectionMs: 600000, elapsedMs: 0, anchorAt: NOW,
    sectionIndex: 0, levels: { figure: 1, memory: 1, spatial: 1, verbal: 1 }, responses: [], current: null,
  };
  assert.equal(isValidSession(old), true);
  assert.equal(categoryAt(old, NOW + 600000).id, 'memory');
  assert.deepEqual(summarize(old, NOW + 2400000).sections.map((s) => s.timeMs), [600000, 600000, 600000, 600000]);
  assert.equal(memoryDisplayDuration(old, { type: 'memory-grid' }), 850);
  assert.equal(memoryDisplayDuration(old, { type: 'memory-binding', displayMs: 1995 }), 1995);
  const modern = pauseSession(createSession(60, NOW, 'modern'), NOW + 2000);
  const incoming = parseBackup(JSON.stringify({ app: 'cognitive-practice', version: 1, sessions: [old, modern] }));
  assert.equal(incoming[0].status, 'paused');
  assert.equal(incoming[0].sectionMs, 600000);
  assert.equal(incoming[1].memoryDisplayMs, 1000);
  assert.deepEqual(incoming[1].sectionDurationsMs, [1200000, 600000, 900000, 900000]);
});

test('import rejects incomplete schedules and unsupported presentation timing', () => {
  const session = createSession(60, NOW, 'bad-plan');
  for (const change of [
    (s) => { s.sectionDurationsMs = [1200000, 600000, 900000]; },
    (s) => { s.sectionDurationsMs[0] = 600000; },
    (s) => { s.memoryDisplayMs = 0; },
  ]) {
    const broken = structuredClone(session); change(broken);
    assert.equal(isValidSession(broken), false);
  }
});
