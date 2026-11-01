import { taskFamily, targetLevel, presentedLevel, validVisualMemory, validStoredQuestion, familyName, chooseFamily } from './practice.js';

export const CATEGORIES = [
  { id: 'figure', name: '图形规律', short: '图形', number: '01', description: '观察变化，发现图形之间的规律。' },
  { id: 'memory', name: '记忆能力', short: '记忆', number: '02', description: '记住位置、数字与它们出现的顺序。' },
  { id: 'spatial', name: '空间推理', short: '空间', number: '03', description: '在脑海中折叠、旋转和展开图形。' },
  { id: 'verbal', name: '文字推演', short: '文字', number: '04', description: '理解条件，推断顺序与词语关系。' },
];
export const MAX_LEVEL = 8;
export const MEMORY_DISPLAY_MS = 1000;
export const TRAINING_WEIGHTS = [4, 2, 3, 3];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const copy = (value) => structuredClone(value);

export function trainingDurations(totalMs) {
  const durations = TRAINING_WEIGHTS.slice(0, -1).map((weight) => Math.round(totalMs * weight / 12));
  return [...durations, totalMs - durations.reduce((sum, duration) => sum + duration, 0)];
}

export function sectionDurations(session) {
  // Version 1 records and unfinished sessions keep their original equal allocation.
  return session.version === 1 ? CATEGORIES.map(() => session.sectionMs) : session.sectionDurationsMs;
}

export function sectionTiming(session, index = session.sectionIndex) {
  const durations = sectionDurations(session);
  const start = durations.slice(0, index).reduce((sum, duration) => sum + duration, 0);
  const duration = durations[index] ?? 0;
  return { start, duration, end: start + duration };
}

export function sectionIndexAt(session, now = Date.now()) {
  const elapsed = elapsedTime(session, now);
  let end = 0;
  const durations = sectionDurations(session);
  for (let index = 0; index < durations.length; index++) {
    end += durations[index];
    if (elapsed < end) return index;
  }
  return CATEGORIES.length;
}

export function createSession(minutes, now = Date.now(), id = crypto.randomUUID(), practiceMode = null) {
  if (!Number.isFinite(minutes) || minutes < 4 || minutes > 180) throw new Error('总时间应为 4–180 分钟。');
  if (practiceMode !== null && !['north', 'extended'].includes(practiceMode)) throw new Error('练习模式不正确。');
  const totalMs = Math.round(minutes * 60000);
  return {
    version: practiceMode ? 3 : 2, id, status: 'running', startedAt: new Date(now).toISOString(), updatedAt: now,
    ...(practiceMode ? { practiceMode, familyLevels: {} } : {}),
    finishedAt: null, totalMs, sectionDurationsMs: trainingDurations(totalMs),
    memoryDisplayMs: MEMORY_DISPLAY_MS, elapsedMs: 0, anchorAt: now,
    sectionIndex: 0, levels: Object.fromEntries(CATEGORIES.map((c) => [c.id, 1])),
    responses: [], current: null,
  };
}

export function elapsedTime(session, now = Date.now()) {
  const delta = session.status === 'running' ? Math.max(0, now - session.anchorAt) : 0;
  return clamp(session.elapsedMs + delta, 0, session.totalMs);
}

export function categoryAt(session, now = Date.now()) {
  return CATEGORIES[sectionIndexAt(session, now)] ?? null;
}

export function memoryDisplayDuration(session, question) {
  return session.memoryDisplayMs ?? question.displayMs ?? (session.version === 1 ? question.type === 'memory-binding' ? 1995 : 850 : MEMORY_DISPLAY_MS);
}

export function memoryStage(session, question, current = session.current, now = Date.now()) {
  if (current.presentationAtElapsed === null) return { phase: 'ready', key: 'ready' };
  const elapsed = Math.max(0, elapsedTime(session, now) - current.presentationAtElapsed);
  const display = memoryDisplayDuration(session, question);
  if (['memory-positions', 'memory-recognition', 'memory-symmetry'].includes(question.type)) {
    const lead = question.leadMs ?? 500;
    if (elapsed < lead) return { phase: 'lead', key: 'lead' };
    if (elapsed < lead + display) return { phase: 'target', key: 'target' };
    return { phase: 'answer', key: 'answer' };
  }
  if (question.type === 'memory-binding') {
    const delay = question.delayMs ?? 995;
    if (elapsed < display) return { phase: 'target', key: 'target' };
    if (elapsed < display + delay) return { phase: 'hold', key: 'hold', left: display + delay - elapsed };
    return { phase: 'answer', key: 'answer' };
  }
  const lead = 600;
  const interval = question.intervalMs ?? 250;
  if (elapsed < lead) return { phase: 'lead', key: 'lead' };
  const index = Math.floor((elapsed - lead) / (display + interval));
  if (index >= question.sequence.length) return { phase: 'answer', key: 'answer' };
  const lit = (elapsed - lead) % (display + interval) < display;
  return { phase: 'present', index, lit, key: `present-${index}-${lit}` };
}

function unanswered(session, atElapsed, now, reason) {
  if (!session.current || session.current.answered) return;
  const current = session.current;
  session.responses.push({
    questionId: current.questionId, category: current.category, type: current.type,
    sourceId: current.sourceId, groupId: current.groupId ?? null,
    ...(session.version >= 3 ? { taskFamily: current.taskFamily } : {}),
    presentedLevel: current.presentedLevel, levelBefore: targetLevel(session, current),
    levelAfter: targetLevel(session, current), answer: null, correct: null, status: 'unanswered',
    reason, answeredAt: new Date(now).toISOString(), elapsedAtAnswer: atElapsed,
    choicesOrder: current.choicesOrder ?? [],
    timeMs: Math.max(0, atElapsed - current.askedAtElapsed),
    generatedQuestion: current.generatedQuestion ?? null,
    ...(session.version >= 3 ? { questionSnapshot: current.questionSnapshot ?? null } : {}),
  });
}

export function advanceSession(session, now = Date.now()) {
  const next = copy(session);
  next.elapsedMs = elapsedTime(session, now);
  if (next.status !== 'running') return next;
  next.anchorAt = now;
  next.updatedAt = now;
  const index = sectionIndexAt(next, now);
  if (index !== next.sectionIndex) {
    unanswered(next, sectionTiming(next).end, now, 'section_timeout');
    next.current = null;
    next.sectionIndex = index;
  }
  if (next.elapsedMs >= next.totalMs) {
    next.status = 'completed';
    next.anchorAt = null;
    next.finishedAt = new Date(now).toISOString();
  }
  return next;
}

export function pauseSession(session, now = Date.now()) {
  const next = advanceSession(session, now);
  if (next.status === 'running') { next.status = 'paused'; next.anchorAt = null; }
  next.updatedAt = now;
  return next;
}

export function resumeSession(session, now = Date.now()) {
  if (session.status !== 'paused') return session;
  return { ...copy(session), status: 'running', anchorAt: now, updatedAt: now };
}

export function finishSession(session, now = Date.now()) {
  const next = advanceSession(session, now);
  if (next.status === 'completed' || next.status === 'stopped') return next;
  unanswered(next, next.elapsedMs, now, 'manual_end');
  next.current = null;
  next.status = 'stopped';
  next.anchorAt = null;
  next.finishedAt = new Date(now).toISOString();
  next.updatedAt = now;
  return next;
}

export function snapshotSession(session, now = Date.now()) {
  // An unexpected browser exit restores a paused checkpoint, not hours of idle time.
  return session.status === 'running' ? pauseSession(session, now) : copy(session);
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function chooseQuestion(pool, session, category, exposures = {}, random = Math.random) {
  const used = new Set(session.responses.map((r) => r.questionId));
  const groups = new Set(session.responses.map((r) => r.groupId).filter(Boolean));
  if (session.current) used.add(session.current.questionId);
  let available = pool.filter((q) => !used.has(q.id) && (!q.groupId || !groups.has(q.groupId)));
  if (!available.length) return null;
  if (session.version >= 3) {
    const family = chooseFamily([...new Set(available.map(taskFamily))], session, category);
    available = available.filter((q) => taskFamily(q) === family);
  }
  const difference = (q) => Math.abs(presentedLevel(session, q) - targetLevel(session, q));
  const distance = Math.min(...available.map(difference));
  const close = available.filter((q) => difference(q) === distance);
  const minimumSeen = Math.min(...close.map((q) => exposures[q.id] ?? 0));
  const fresh = close.filter((q) => (exposures[q.id] ?? 0) === minimumSeen);
  return fresh[Math.floor(random() * fresh.length)];
}

export function generatedMemory(level, random = Math.random, id = crypto.randomUUID()) {
  const length = clamp(level + 1, 2, 9);
  const sequence = [];
  while (sequence.length < length) {
    let cell = 1 + Math.floor(random() * 16);
    if (cell === sequence.at(-1)) cell = cell % 16 + 1;
    sequence.push(cell);
  }
  return { id: `generated-memory-${id}`, category: 'memory', type: 'memory-grid', level,
    prompt: '记住方格亮起的顺序，再依次点击相同的位置。', sourceId: 'generated',
    gridRows: 4, gridColumns: 4, sequence, answer: sequence,
    originalDifficulty: { status: 'structural', label_zh: `记忆 ${length} 个位置` },
    levelBasis: '按记忆序列长度生成的练习分档', generated: true };
}

export function beginQuestion(session, question, now = Date.now(), random = Math.random) {
  const next = advanceSession(session, now);
  if (next.status !== 'running' || CATEGORIES[next.sectionIndex]?.id !== question.category) return next;
  if (next.current && !next.current.answered) throw new Error('请先完成当前题目。');
  const choices = question.choices ?? [];
  const order = question.choicesEmbedded ? choices.map((c) => c.id) : shuffle(choices.map((c) => c.id), random);
  if (next.version >= 3) next.familyLevels[taskFamily(question)] ??= 1;
  next.current = { questionId: question.id, category: question.category, type: question.type,
    sourceId: question.sourceId, groupId: question.groupId ?? null,
    ...(next.version >= 3 ? { taskFamily: taskFamily(question) } : {}),
    presentedLevel: presentedLevel(next, question), askedAtElapsed: next.elapsedMs, answered: false,
    choicesOrder: order, draft: null, presentationAtElapsed: null,
    generatedQuestion: question.generated ? question : null };
  if (next.version >= 3) next.current.questionSnapshot = question.generated ? null : copy(question);
  return next;
}

export function gradeAnswer(question, answer) {
  if (['memory-grid', 'memory-digits', 'construction', 'memory-positions'].includes(question.type)) {
    if (!Array.isArray(answer) || answer.length !== question.answer.length) return false;
    const expected = question.answer.map(String);
    const given = answer.map(String);
    if (['construction', 'memory-positions'].includes(question.type)) {
      if (new Set(given).size !== given.length) return false;
      expected.sort(); given.sort();
    }
    return expected.every((value, i) => value === given[i]);
  }
  if (question.type === 'folding-video') {
    return answer !== '' && answer !== null && Number.isInteger(Number(answer)) && Number(answer) === Number(question.answer);
  }
  return String(answer) === String(question.answer);
}

export function submitAnswer(session, question, answer, now = Date.now(), skipped = false) {
  const next = advanceSession(session, now);
  if (next.status !== 'running' || next.current?.questionId !== question.id || next.current.answered) {
    return { session: next, rejected: true };
  }
  if (!skipped && ['memory-positions', 'memory-recognition', 'memory-symmetry'].includes(question.type) && memoryStage(next, question, next.current, now).phase !== 'answer') return { session: next, rejected: true };
  const correct = !skipped && gradeAnswer(question, answer);
  const before = targetLevel(next, question);
  const after = clamp(before + (correct ? 1 : -1), 1, MAX_LEVEL);
  const response = {
    questionId: question.id, category: question.category, type: question.type,
    sourceId: question.sourceId, groupId: question.groupId ?? null,
    ...(next.version >= 3 ? { taskFamily: taskFamily(question) } : {}),
    presentedLevel: presentedLevel(next, question), levelBefore: before, levelAfter: after,
    answer: copy(answer), correct, status: skipped ? 'skipped' : correct ? 'correct' : 'incorrect',
    choicesOrder: [...next.current.choicesOrder],
    answeredAt: new Date(now).toISOString(), elapsedAtAnswer: next.elapsedMs,
    timeMs: Math.max(0, next.elapsedMs - next.current.askedAtElapsed),
    generatedQuestion: question.generated ? question : null,
    ...(next.version >= 3 ? { questionSnapshot: question.generated ? null : copy(question) } : {}),
  };
  next.responses.push(response);
  next.current.answered = true;
  next.levels[question.category] = after;
  if (next.version >= 3) next.familyLevels[taskFamily(question)] = after;
  next.updatedAt = now;
  return { session: next, response, rejected: false };
}

export function summarize(session, now = Date.now()) {
  const elapsed = elapsedTime(session, now);
  const sections = CATEGORIES.map((category, index) => {
    const timing = sectionTiming(session, index);
    const responses = session.responses.filter((r) => r.category === category.id);
    const correct = responses.filter((r) => r.status === 'correct').length;
    const incorrect = responses.filter((r) => r.status === 'incorrect').length;
    return { ...category, correct, incorrect,
      skipped: responses.filter((r) => r.status === 'skipped').length,
      unanswered: responses.filter((r) => r.status === 'unanswered').length,
      attempted: correct + incorrect,
      timeMs: clamp(elapsed - timing.start, 0, timing.duration), plannedMs: timing.duration,
      finalLevel: session.levels[category.id],
      families: [...new Set([...responses.map((r) => r.taskFamily).filter(Boolean), ...(session.current?.category === category.id && session.current.taskFamily ? [session.current.taskFamily] : [])])].map((family) => ({ id: family, name: familyName(family), level: session.familyLevels?.[family] ?? 1 })),
    };
  });
  const total = (key) => sections.reduce((sum, section) => sum + section[key], 0);
  return { elapsedMs: elapsed, plannedMs: session.totalMs, sections,
    correct: total('correct'), incorrect: total('incorrect'), skipped: total('skipped'),
    unanswered: total('unanswered'), attempted: total('attempted'),
    accuracy: total('attempted') ? total('correct') / total('attempted') : null };
}

export function isValidSession(value) {
  const validLevel = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL;
  const validString = (s) => typeof s === 'string' && s.length > 0 && s.length <= 1000;
  const validDate = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
  const validTime = (n) => Number.isFinite(n) && n >= 0 && n <= value.totalMs;
  const validAnswer = (a) => a === null || typeof a === 'string' && a.length <= 5000 || Number.isFinite(a) || Array.isArray(a) && a.length <= 32 && a.every((x) => typeof x === 'string' && x.length <= 200 || Number.isFinite(x));
  const validOrder = (a) => Array.isArray(a) && a.length <= 20 && a.every(validString);
  const validGenerated = (q) => q === null || validVisualMemory(q) || q && validString(q.id) && q.sourceId === 'generated' && q.category === 'memory' && q.type === 'memory-grid' && validLevel(q.level) && q.gridRows === 4 && q.gridColumns === 4 && Array.isArray(q.sequence) && q.sequence.length >= 2 && q.sequence.length <= 9 && q.sequence.every((n) => Number.isInteger(n) && n >= 1 && n <= 16) && Array.isArray(q.answer) && q.answer.length === q.sequence.length && q.answer.every((n, i) => n === q.sequence[i]);
  const validFamily = (family) => typeof family === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(family) && !['constructor', 'prototype'].includes(family);
  const validSnapshot = (record) => {
    if (value.version < 3) return true;
    const question = record.generatedQuestion ?? record.questionSnapshot;
    return validStoredQuestion(question) && question.id === record.questionId && question.type === record.type && question.category === record.category && taskFamily(question) === record.taskFamily;
  };
  const validQuestion = (q) => q && validString(q.questionId) && validString(q.sourceId) && CATEGORIES.some((c) => c.id === q.category) && ['choice', 'construction', 'memory-grid', 'memory-digits', 'memory-binding', 'folding-video', 'folding-choice', 'memory-positions', 'memory-recognition', 'memory-symmetry'].includes(q.type) && validLevel(q.presentedLevel) && validOrder(q.choicesOrder) && validGenerated(q.generatedQuestion) && validSnapshot(q) && (value.version < 3 || validFamily(q.taskFamily));
  if (!value || typeof value !== 'object' || ![1, 2, 3].includes(value.version) || !validString(value.id) || value.id.length > 200) return false;
  if (!['running', 'paused', 'completed', 'stopped'].includes(value.status)) return false;
  if (!validDate(value.startedAt) || !Number.isFinite(value.updatedAt) || value.finishedAt !== null && !validDate(value.finishedAt)) return false;
  if (!Number.isFinite(value.totalMs) || value.totalMs < 240000 || value.totalMs > 10800000) return false;
  if (value.version === 1 && value.sectionMs !== value.totalMs / 4) return false;
  if (value.version >= 2 && (!Array.isArray(value.sectionDurationsMs) || value.sectionDurationsMs.length !== 4 || !value.sectionDurationsMs.every((duration, i) => duration === trainingDurations(value.totalMs)[i]) || value.memoryDisplayMs !== MEMORY_DISPLAY_MS)) return false;
  if (value.version === 3 && (!['north', 'extended'].includes(value.practiceMode) || !value.familyLevels || Array.isArray(value.familyLevels) || typeof value.familyLevels !== 'object' || Object.keys(value.familyLevels).length > 100 || !Object.entries(value.familyLevels).every(([family, level]) => validFamily(family) && validLevel(level)))) return false;
  if (!validTime(value.elapsedMs) || value.status === 'running' && !Number.isFinite(value.anchorAt)) return false;
  if (!Number.isInteger(value.sectionIndex) || value.sectionIndex < 0 || value.sectionIndex > 4) return false;
  if (value.sectionIndex === 4 && value.status !== 'completed') return false;
  if (!value.levels || !CATEGORIES.every((c) => validLevel(value.levels[c.id]))) return false;
  if (!Array.isArray(value.responses) || value.responses.length > 20000) return false;
  if (!value.responses.every((r) => validQuestion(r) && ['correct', 'incorrect', 'skipped', 'unanswered'].includes(r.status) && validTime(r.timeMs) && validTime(r.elapsedAtAnswer) && validDate(r.answeredAt) && validLevel(r.levelBefore) && validLevel(r.levelAfter) && validAnswer(r.answer) && [true, false, null].includes(r.correct))) return false;
  if (value.current !== null && (!validQuestion(value.current) || !validTime(value.current.askedAtElapsed) || typeof value.current.answered !== 'boolean' || !validAnswer(value.current.draft) || value.current.presentationAtElapsed !== null && !validTime(value.current.presentationAtElapsed))) return false;
  return true;
}

export function parseBackup(text) {
  if (text.length > 50 * 1024 * 1024) throw new Error('备份文件过大，请选择 50 MB 以内的文件。');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('无法读取备份，请选择导出的 JSON 文件。'); }
  if (!data || typeof data !== 'object' || data.app !== 'cognitive-practice' || data.version !== 1 || !Array.isArray(data.sessions) || data.sessions.length > 5000 || !data.sessions.every(isValidSession)) {
    throw new Error('备份格式不正确，原有记录未改动。');
  }
  const ids = new Set(data.sessions.map((s) => s.id));
  if (ids.size !== data.sessions.length) throw new Error('备份中存在重复记录，原有记录未改动。');
  return data.sessions.map((s) => s.status === 'running' ? { ...s, status: 'paused', anchorAt: null } : s);
}
