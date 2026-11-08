import { familyName, taskFamily, isMatrixVariant, isUnratedMatrix } from './practice.js';

// Reward weights, not psychometric difficulty coefficients or an ability scale.
export const SCORE_RULE_VERSION = 1;
export const LEVEL_POINTS = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80]);
export function levelPoints(level) {
  return Number.isInteger(level) && level >= 1 && level <= 8 ? LEVEL_POINTS[level - 1] : 0;
}
export function scoreFields(level, status, kind = 'new') {
  return { scoreMaxPoints: levelPoints(level), scorePoints: status === 'correct' ? levelPoints(level) : 0,
    scorePracticeKind: kind === 'review' ? 'review' : 'new' };
}
export function validScoreFields(record, isCurrent = false) {
  const keys = isCurrent ? ['scoreMaxPoints', 'scorePracticeKind'] : ['scoreMaxPoints', 'scorePoints', 'scorePracticeKind'];
  if (isUnratedMatrix(record)) return keys.every((key) => record[key] === undefined);
  if (isMatrixVariant(record) && record.scorePracticeKind !== 'review') return false;
  // Missing metadata remains readable when an older tab writes a newer session.
  if (keys.every((key) => record[key] === undefined)) return true;
  if (record.scoreMaxPoints !== levelPoints(record.presentedLevel) || !['new', 'review'].includes(record.scorePracticeKind)) return false;
  return isCurrent || record.scorePoints === (record.status === 'correct' ? record.scoreMaxPoints : 0);
}
export function recordScore(session, record) {
  if (isUnratedMatrix(record)) return { points: 0, possible: 0, kind: 'unrated', estimated: false };
  const stored = session.scoreRuleVersion === SCORE_RULE_VERSION && record.scorePoints !== undefined && validScoreFields(record);
  return { points: stored ? record.scorePoints : record.status === 'correct' ? levelPoints(record.presentedLevel) : 0,
    possible: levelPoints(record.presentedLevel), kind: stored ? record.scorePracticeKind : 'legacy', estimated: !stored };
}
export function scoreSummary(session, responses = session.responses) {
  const total = { points: 0, newPoints: 0, reviewPoints: 0, legacyPoints: 0, possiblePoints: 0, hasEstimated: false };
  for (const record of responses) {
    const score = recordScore(session, record);
    if (score.kind === 'unrated') continue;
    total.points += score.points; total.possiblePoints += score.possible; total.hasEstimated ||= score.estimated;
    total[{ new: 'newPoints', review: 'reviewPoints', legacy: 'legacyPoints' }[score.kind]] += score.points;
  }
  return total;
}
export function scoreByFamily(session, resolve = (r) => r.generatedQuestion ?? r.questionSnapshot) {
  const families = new Map();
  for (const record of session.responses) {
    const q = resolve(record, session);
    const id = record.taskFamily ?? (q ? taskFamily(q) : `${record.category}:${record.type}`);
    const key = `${record.category}|${id}`;
    if (!families.has(key)) families.set(key, { id, category: record.category, name: q?.taskFamilyName ?? familyName(id), responses: [],
      levels: Array.from({ length: isUnratedMatrix(record) ? 0 : 8 }, (_, i) => ({ level: i + 1, correct: 0, incorrect: 0, skipped: 0, unanswered: 0, points: 0 })) });
    const family = families.get(key); family.responses.push(record);
    const bucket = family.levels[record.presentedLevel - 1];
    if (bucket) { bucket[record.status]++; bucket.points += recordScore(session, record).points; }
  }
  return [...families.values()].map((family) => {
    const correct = family.responses.filter((r) => r.status === 'correct').length;
    const incorrect = family.responses.filter((r) => r.status === 'incorrect').length;
    return { id: family.id, category: family.category, name: family.name, levels: family.levels,
      correct, incorrect, skipped: family.responses.filter((r) => r.status === 'skipped').length,
      unanswered: family.responses.filter((r) => r.status === 'unanswered').length,
      attempted: correct + incorrect, accuracy: correct + incorrect ? correct / (correct + incorrect) : null,
      ...scoreSummary(session, family.responses) };
  });
}
