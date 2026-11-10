import { createSession, chooseQuestion, parseBackup, trainingDurations } from './engine.js';
import { taskFamily, generateVisualMemory, generatedMemorySignature, isMatrixVariant, isUnratedMatrix } from './practice.js';

export function usernameIdentity(value) {
  const username = String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._-]{0,23}$/u.test(username)) throw new Error('用户名用1–24个中文、字母或数字，可含空格、点、下划线或短横线。');
  return { id: `user:${username.toLocaleLowerCase('en-US')}`, username };
}
export function validUserId(value) {
  if (typeof value !== 'string' || !value.startsWith('user:')) return false;
  try { return usernameIdentity(value.slice(5)).id === value; } catch { return false; }
}
export function ownsSession(session, profile) { return session.userId === profile?.id; }
export function createProfile(name, now = Date.now()) {
  return { version: 1, ...usernameIdentity(name), createdAt: now, updatedAt: now,
    seenQuestions: [], seenGroups: [], memoryPatterns: [], levels: { north: {}, extended: {} } };
}
export function isValidProfile(value) {
  if (!value || value.version !== 1 || !validUserId(value.id)) return false;
  try { if (usernameIdentity(value.username).id !== value.id) return false; } catch { return false; }
  const time = (n) => Number.isFinite(n) && n >= 0 && n <= 8640000000000000;
  if (!time(value.createdAt) || !time(value.updatedAt)) return false;
  for (const key of ['seenQuestions', 'seenGroups', 'memoryPatterns']) {
    if (!Array.isArray(value[key]) || value[key].length > 200000 || !value[key].every((s) => typeof s === 'string' && s.length > 0 && s.length <= 1000) || new Set(value[key]).size !== value[key].length) return false;
  }
  if (!value.levels || typeof value.levels !== 'object' || Array.isArray(value.levels)) return false;
  return ['north', 'extended'].every((mode) => {
    const levels = value.levels[mode];
    return levels && typeof levels === 'object' && !Array.isArray(levels) && Object.keys(levels).length <= 100 && Object.entries(levels).every(([family, state]) => /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(family) && !['constructor', 'prototype'].includes(family) && state && Number.isInteger(state.level) && state.level >= 1 && state.level <= 8 && time(state.at) && typeof state.order === 'string' && state.order.length <= 500);
  });
}
function newer(a, b) { return !a || b.at > a.at || b.at === a.at && b.order > a.order; }
export function mergeProfiles(existing, incoming) {
  if (!isValidProfile(incoming) || existing && (!isValidProfile(existing) || existing.id !== incoming.id)) throw new Error('用户档案格式不正确。');
  if (!existing) return structuredClone(incoming);
  const result = structuredClone(existing);
  result.createdAt = Math.min(existing.createdAt, incoming.createdAt);
  result.updatedAt = Math.max(existing.updatedAt, incoming.updatedAt);
  for (const key of ['seenQuestions', 'seenGroups', 'memoryPatterns']) result[key] = [...new Set([...existing[key], ...incoming[key]])];
  for (const mode of ['north', 'extended']) for (const [family, state] of Object.entries(incoming.levels[mode])) {
    if (newer(result.levels[mode][family], state)) result.levels[mode][family] = structuredClone(state);
  }
  return result;
}
export function questionIdentity(q) { return `${taskFamily(q)}|${typeof q.sourceQuestionId === 'string' && q.sourceQuestionId.length <= 200 ? q.sourceQuestionId : q.id}`; }
export function groupIdentity(q) { return typeof q.groupId === 'string' && q.groupId.length <= 300 ? `${taskFamily(q)}|${q.groupId}` : null; }
export function memorySignature(q) {
  if (q.sourceId === 'generated-north') return `${q.taskFamily}|${q.gridRows}x${q.gridColumns}|${q.axis ?? '-'}|${q.cells.slice().sort((a,b)=>a-b).join(',')}`;
  return ['memory-grid', 'memory-digits'].includes(q.type) ? generatedMemorySignature(q) : null;
}
export function rememberSession(profile, session, resolve = (r) => r.generatedQuestion ?? r.questionSnapshot) {
  if (!ownsSession(session, profile)) throw new Error('练习记录不属于当前用户。');
  const result = structuredClone(profile);
  const ids = new Set(result.seenQuestions), groups = new Set(result.seenGroups), patterns = new Set(result.memoryPatterns);
  const remember = (record) => {
    const q = resolve(record, session);
    if (!q) return;
    const signature = memorySignature(q);
    if (signature) patterns.add(signature); else ids.add(questionIdentity(q));
    const group = groupIdentity(q); if (group) groups.add(group);
  };
  session.responses.forEach((record, index) => {
    // Even an unanswered stimulus has been seen; its level is left unchanged.
    remember(record);
    if (!['correct', 'incorrect', 'skipped'].includes(record.status)) return;
    if (isMatrixVariant(record) || isUnratedMatrix(record)) return;
    const q = resolve(record, session);
    const family = session.version >= 3 ? record.taskFamily : q ? taskFamily(q) : null;
    if (typeof family !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(family) || ['constructor','prototype'].includes(family)) return;
    const mode = session.version >= 3 ? session.practiceMode : 'extended';
    const state = { level: record.levelAfter, at: Date.parse(record.answeredAt), order: `${session.startedAt}:${session.id}:${String(index).padStart(6, '0')}` };
    if (newer(result.levels[mode][family], state)) result.levels[mode][family] = state;
  });
  if (session.current) remember(session.current);
  result.seenQuestions = [...ids]; result.seenGroups = [...groups]; result.memoryPatterns = [...patterns];
  result.updatedAt = Math.max(result.updatedAt, session.updatedAt);
  return result;
}
export function createUserSession(profile, minutes, mode, now = Date.now(), id = crypto.randomUUID()) {
  const session = createSession(minutes, now, id, mode);
  session.sectionDurationsMs = trainingDurations(session.totalMs);
  session.timingScheme = 'figure-focus-7-2-3-3';
  session.userId = profile.id; session.username = profile.username; session.reviewCategories = [];
  session.familyLevels = Object.fromEntries(Object.entries(profile.levels[mode]).map(([family, state]) => [family, state.level]));
  return session;
}
export function unseenQuestions(pool, profile) {
  const ids = new Set(profile.seenQuestions), groups = new Set(profile.seenGroups), patterns = new Set(profile.memoryPatterns);
  return pool.filter((q) => !ids.has(questionIdentity(q)) && !groups.has(groupIdentity(q)) && !patterns.has(memorySignature(q)));
}
export function selectUserQuestion(pool, session, profile, random = Math.random) {
  const category = pool[0]?.category;
  const review = session.reviewCategories?.includes(category);
  const candidates = review ? pool : unseenQuestions(pool, profile);
  return chooseQuestion(candidates, session, category, {}, random);
}

export function selectNorthFigure(pool, supplement, session, profile, standaloneSeen = new Set(), random = Math.random) {
  const original = selectUserQuestion(pool, session, profile, random);
  if (!supplement.length) return original;
  const seenIds = new Set(session.responses.map((record) => record.questionId));
  if (session.current) seenIds.add(session.current.questionId);
  const available = unseenQuestions(supplement, profile).filter((q) => !standaloneSeen.has(q.matrixItemId) && !seenIds.has(q.id));
  const figures = session.responses.filter((record) => record.category === 'figure');
  const unrated = figures.filter(isUnratedMatrix).length;
  const sandia = available.filter(isUnratedMatrix);
  if (sandia.length && unrated < Math.floor((figures.length - unrated) / 4)) return sandia[Math.floor(random() * sandia.length)];
  const lastRated = figures.findLast((record) => !isUnratedMatrix(record));
  if (session.familyLevels['matrix-choice'] === 4 && (!original || taskFamily(original) === 'matrix-choice') && original?.familyLevel !== 4
      && (!original || !isMatrixVariant(lastRated)) && !session.reviewCategories?.includes('figure')) {
    const stems = new Set(figures.map((record) => record.questionSnapshot?.matrixVariantOf ?? record.questionId));
    const variants = available.filter((q) => isMatrixVariant(q) && !stems.has(q.matrixVariantOf));
    if (variants.length) return variants[Math.floor(random() * variants.length)];
  }
  return original ?? sandia[Math.floor(random() * sandia.length)] ?? null;
}
export function freshVisualMemory(family, level, profile, seed = () => crypto.randomUUID()) {
  const used = new Set(profile.memoryPatterns);
  // Small low-level grids have finite pattern spaces. Exhaustion is explicit.
  for (let attempt = 0; attempt < 512; attempt++) {
    const q = generateVisualMemory(family, level, seed());
    if (!used.has(memorySignature(q))) return q;
  }
  return null;
}
export function selectUserMemory(session, profile) {
  const families = ['visual-positions', 'visual-recognition', 'visual-symmetry'];
  const counts = (family) => session.responses.filter((r)=>r.taskFamily === family).length;
  families.sort((a,b)=>counts(a)-counts(b));
  for (const family of families) {
    const target = session.familyLevels[family] ?? 1;
    if (session.reviewCategories?.includes('memory')) return generateVisualMemory(family, target);
    const levels = Array.from({length:8},(_,i)=>i+1).sort((a,b)=>Math.abs(a-target)-Math.abs(b-target));
    for (const level of levels) {
      const q = freshVisualMemory(family, level, profile);
      if (q) return q;
    }
  }
  return null;
}
export function userBackup(records, profile = null) {
  return { app: 'cognitive-practice', version: 2, exportedAt: new Date().toISOString(), profiles: profile ? [structuredClone(profile)] : [], sessions: records };
}
export function parseUserBackup(text) {
  if (text.length > 50 * 1024 * 1024) throw new Error('备份文件过大，请选择50 MB以内的文件。');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('无法读取备份，请选择导出的JSON文件。'); }
  if (![1, 2].includes(data?.version)) throw new Error('备份版本不正确，原有记录未改动。');
  const sessions = parseBackup(JSON.stringify({ ...data, version: 1 }));
  const profiles = data.version === 2 ? data.profiles : [];
  if (!Array.isArray(profiles) || profiles.length > 500 || !profiles.every(isValidProfile) || new Set(profiles.map((p)=>p.id)).size !== profiles.length) throw new Error('用户档案格式不正确，原有记录未改动。');
  for (const session of sessions) {
    if (session.userId !== undefined) {
      try { if (usernameIdentity(session.username).id !== session.userId) throw new Error(); } catch { throw new Error('备份中的用户名与记录不匹配。'); }
      if (data.version === 2 && !profiles.some((p)=>p.id===session.userId)) throw new Error('备份缺少对应用户档案。');
    }
  }
  return { profiles, sessions };
}
