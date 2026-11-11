import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { beginQuestion, submitAnswer, advanceSession, pauseSession, resumeSession, isValidSession } from '../public/engine.js';
import { createProfile, createUserSession, rememberSession, selectNorthFigure, selectRuleReinforcement,
  questionIdentity, groupIdentity, userBackup, parseUserBackup } from '../public/profiles.js';
import { openStore } from '../public/storage.js';

// Synthetic question metadata only; no downloaded questions or images.
const question = (name, level = 2, rules = ['regions'], family = 'figure-quantity') => ({
  id: `local-figure-test-${name}`, sourceQuestionId: `test-${name}`, category: 'figure', type: 'choice',
  sourceId: 'local-figure-rules', taskFamily: family, familyLevel: level, familyMaxLevel: 4, level,
  image: `private-figure/fixture/${name}.png`, prompt: '测试题', choicesEmbedded: true,
  choices: ['A', 'B', 'C', 'D'].map((id) => ({ id, text: id })), answer: 'B',
  explanation: '测试解析', ruleIds: rules, ruleTags: rules.map((rule) => `测试规律：${rule}`),
});
function answered(q = question('trigger'), answer = 'A', skipped = false) {
  let profile = createProfile('Reinforcement QA', 0), session = createUserSession(profile, 50, 'north', 0, 'practice');
  session.familyLevels[q.taskFamily] = q.level;
  session = submitAnswer(beginQuestion(session, q, 1), q, answer, 1000, skipped).session;
  profile = rememberSession(profile, session);
  return { profile, session, q };
}
const pick = (pool, state) => selectRuleReinforcement(pool, state.session, state.profile, () => 0);

test('a wrong figure rule gets an unseen matching question immediately, ahead of rotation and Sandia', () => {
  const state = answered(), matching = question('matching', 1), unrelated = question('other', 1, ['rotation'], 'figure-position');
  // Four rated responses make Sandia due, but an immediate follow-up takes priority.
  state.session.responses.unshift(...[0, 1, 2].map((n) => ({ ...state.session.responses[0],
    questionId: `older-${n}`, sourceId: 'mars_ib', taskFamily: 'matrix-choice', status: 'correct' })));
  const sandia = { id: 'local-matrix-sandia', sourceId: 'local-sandia', taskFamily: 'sandia-matrix', matrixItemId: 'sandia' };
  const selected = selectNorthFigure([unrelated, matching, state.q], [sandia], state.session, state.profile, new Set(), () => 0);
  assert.equal(selected.id, matching.id);
  assert.deepEqual(selected.ruleReinforcement, { version: 1, triggerQuestionId: state.q.id, ruleIds: ['regions'] });
  assert.equal(matching.ruleReinforcement, undefined, 'selection must not mutate the imported bank');
  const next = submitAnswer(beginQuestion(state.session, selected, 1001), selected, selected.answer, 2000).session;
  assert.equal(selectNorthFigure([unrelated, matching], [sandia], next, rememberSession(state.profile, next), new Set(), () => 0).id, sandia.id);
});

test('match the detailed main rule, not the broad family or an incidental shared tag', () => {
  const state = answered(question('trigger', 2, ['points', 'curves']));
  const sameFamily = question('regions', 1, ['regions']);
  const incidental = question('curves', 1, ['curves'], 'figure-attribute');
  const primaryOnly = question('points', 1, ['points']);
  const combo = question('combo', 1, ['points', 'curves']);
  const extra = question('extra', 1, ['points', 'curves', 'rotation']);
  assert.equal(pick([sameFamily, incidental, primaryOnly, extra, combo], state).id, combo.id);
  assert.equal(pick([incidental, primaryOnly], state).id, primaryOnly.id);
  assert.equal(pick([sameFamily, incidental], state), null);
  assert.equal(selectNorthFigure([incidental], [], state.session, state.profile).id, incidental.id);
});

test('consolidation follows the lowered target, using the nearest available level without jumping to a hard exact combo', () => {
  const state = answered(question('trigger', 3, ['translation', 'rotation'], 'figure-position'));
  const q1 = question('one', 1, ['translation'], 'figure-position');
  const q2 = question('two', 2, ['translation'], 'figure-position');
  const q3 = question('three', 3, ['translation', 'rotation'], 'figure-position');
  const q4 = question('four', 4, ['translation', 'rotation'], 'figure-position');
  assert.equal(state.session.familyLevels['figure-position'], 2);
  assert.equal(pick([q4, q3, q1, q2], state).id, q2.id);
  assert.equal(pick([q3, q1], state).id, q1.id, 'lower level wins an equal-distance tie');
  const firstLevel = answered(question('first', 1, ['points']));
  const nextLevel = question('next', 2, ['points']);
  assert.equal(pick([question('hard', 4, ['points']), nextLevel], firstLevel).id, nextLevel.id);
});

test('reinforcement respects profile, source-alias, group and current-session deduplication', () => {
  const state = answered(), seen = question('seen', 1), grouped = { ...question('grouped', 1), groupId: 'old-stem' };
  state.profile.seenQuestions.push(questionIdentity(seen));
  state.profile.seenGroups.push(groupIdentity(grouped));
  const alias = { ...state.q, id: 'local-figure-trigger-alias', level: 1, familyLevel: 1 };
  const fresh = question('fresh', 1);
  assert.equal(pick([state.q, alias, seen, grouped, fresh], state).id, fresh.id);
  assert.equal(pick([state.q, alias, seen, grouped], state), null);
  // Even if profile persistence has not caught up, current-session snapshots exclude aliases.
  state.profile = createProfile('Reinforcement QA', 0);
  assert.equal(pick([alias], state), null);
  state.session = beginQuestion(state.session, fresh, 1001);
  assert.equal(pick([question('another', 1)], state), null, 'do not replace an unanswered current question');
});

test('one follow-up only, whether it is correct, wrong or skipped; normal rotation resumes', () => {
  for (const [answer, skipped] of [['B', false], ['A', false], [null, true]]) {
    const state = answered(), followup = pick([question('followup', 1)], state);
    const next = submitAnswer(beginQuestion(state.session, followup, 1001), followup, answer, 2000, skipped).session;
    const updated = rememberSession(state.profile, next);
    const remaining = question('remaining', 1), other = question('rotation', 1, ['rotation'], 'figure-position');
    assert.ok(isValidSession(next));
    assert.equal(selectRuleReinforcement([remaining], next, updated), null);
    assert.equal(selectNorthFigure([remaining, other], [], next, updated, new Set(), () => 0).id, other.id);
    assert.equal(next.responses.at(-1).scorePracticeKind, 'new');
    assert.equal(next.responses.at(-1).scorePoints, answer === 'B' ? 10 : 0);
    assert.equal(next.familyLevels['figure-quantity'], answer === 'B' ? 2 : 1);
    assert.ok(updated.seenQuestions.includes(questionIdentity(followup)));
  }
});

test('correct, skipped, timed out, review and non-local responses do not trigger a follow-up', () => {
  const candidate = question('candidate', 1);
  assert.equal(pick([candidate], answered(undefined, 'B')), null);
  assert.equal(pick([candidate], answered(undefined, null, true)), null);
  for (const change of [
    (s) => { s.responses[0].status = 'unanswered'; },
    (s) => { s.responses[0].sourceId = 'mars_ib'; },
    (s) => { delete s.responses[0].questionSnapshot.ruleIds; },
    (s) => { s.reviewCategories = ['figure']; },
    (s) => { s.practiceMode = 'extended'; },
    (s) => { s.version = 2; },
    (s) => { s.status = 'completed'; },
  ]) {
    const state = answered(); change(state.session); assert.equal(pick([candidate], state), null);
  }
  const state = answered(), deadline = state.session.sectionDurationsMs[0];
  state.session = advanceSession(state.session, deadline);
  assert.equal(state.session.sectionIndex, 1);
  assert.equal(pick([candidate], state), null);
  assert.deepEqual(state.session.sectionDurationsMs, [1400000, 400000, 600000, 600000]);
  const freshSession = createUserSession(state.profile, 50, 'north', deadline);
  assert.equal(selectRuleReinforcement([candidate], freshSession, state.profile), null, 'no old-session backlog');
});

test('reload, IndexedDB and backup preserve both a pending follow-up and the one-follow-up boundary', async () => {
  const state = answered(), candidate = question('candidate', 1);
  const paused = pauseSession(state.session, 1001);
  const restored = parseUserBackup(JSON.stringify(userBackup([paused], state.profile))).sessions[0];
  state.session = resumeSession(restored, 2000);
  const followup = pick([candidate], state);
  assert.equal(followup.ruleReinforcement.triggerQuestionId, state.q.id);
  state.session = pauseSession(beginQuestion(state.session, followup, 2001), 2100);
  globalThis.indexedDB = new IDBFactory();
  const store = await openStore();
  await store.save(state.session);
  const saved = (await store.all()).find((s) => s.id === state.session.id);
  assert.deepEqual(saved.current.questionSnapshot.ruleReinforcement, followup.ruleReinforcement);
  const backup = parseUserBackup(JSON.stringify(userBackup([saved], rememberSession(state.profile, saved))));
  let resumed = resumeSession(backup.sessions[0], 3000);
  resumed = submitAnswer(resumed, resumed.current.questionSnapshot, 'A', 3100).session;
  assert.ok(isValidSession(resumed));
  assert.equal(selectRuleReinforcement([question('next', 1)], resumed, backup.profiles[0]), null);
});

test('malformed reinforcement metadata rejects a backup without requiring metadata on older snapshots', () => {
  const state = answered(), followup = pick([question('candidate', 1)], state);
  const current = beginQuestion(state.session, followup, 1001);
  assert.ok(isValidSession(state.session));
  for (const edit of [
    (q) => { q.ruleReinforcement = null; },
    (q) => { q.ruleReinforcement.version = 2; },
    (q) => { q.ruleReinforcement.triggerQuestionId = q.id; },
    (q) => { q.ruleReinforcement.ruleIds = ['rotation']; },
    (q) => { q.ruleIds = ['regions', 'regions']; },
    (q) => { q.ruleReinforcement.ruleIds = []; },
  ]) {
    const invalid = structuredClone(current); edit(invalid.current.questionSnapshot);
    assert.equal(isValidSession(invalid), false);
    assert.throws(() => parseUserBackup(JSON.stringify(userBackup([invalid], state.profile))));
  }
});
