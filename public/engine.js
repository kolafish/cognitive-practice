export const CATEGORIES = [
  { id: 'figure', name: '图形规律', short: '图形', number: '01', description: '观察变化，发现图形之间的规律。' },
  { id: 'memory', name: '记忆能力', short: '记忆', number: '02', description: '记住位置、数字与它们出现的顺序。' },
  { id: 'spatial', name: '空间推理', short: '空间', number: '03', description: '在脑海中折叠、旋转和展开图形。' },
  { id: 'verbal', name: '文字推演', short: '文字', number: '04', description: '理解条件，推断顺序与词语关系。' },
];
export const MAX_LEVEL = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const copy = (value) => structuredClone(value);

export function createSession(minutes, now = Date.now(), id = crypto.randomUUID()) {
  if (!Number.isFinite(minutes) || minutes < 4 || minutes > 180) throw new Error('总时间应为 4–180 分钟。');
  const totalMs = Math.round(minutes * 60000);
  return {
    version: 1, id, status: 'running', startedAt: new Date(now).toISOString(), updatedAt: now,
    finishedAt: null, totalMs, sectionMs: totalMs / 4, elapsedMs: 0, anchorAt: now,
    sectionIndex: 0, levels: Object.fromEntries(CATEGORIES.map((c) => [c.id, 1])),
    responses: [], current: null,
  };
}

export function elapsedTime(session, now = Date.now()) {
  const delta = session.status === 'running' ? Math.max(0, now - session.anchorAt) : 0;
  return clamp(session.elapsedMs + delta, 0, session.totalMs);
}

export function categoryAt(session, now = Date.now()) {
  const index = Math.floor(elapsedTime(session, now) / session.sectionMs);
  return CATEGORIES[index] ?? null;
}

function unanswered(session, atElapsed, now, reason) {
  if (!session.current || session.current.answered) return;
  const current = session.current;
  session.responses.push({
    questionId: current.questionId, category: current.category, type: current.type,
    sourceId: current.sourceId, groupId: current.groupId ?? null,
    presentedLevel: current.presentedLevel, levelBefore: session.levels[current.category],
    levelAfter: session.levels[current.category], answer: null, correct: null, status: 'unanswered',
    reason, answeredAt: new Date(now).toISOString(), elapsedAtAnswer: atElapsed,
    choicesOrder: current.choicesOrder ?? [],
    timeMs: Math.max(0, atElapsed - current.askedAtElapsed),
    generatedQuestion: current.generatedQuestion ?? null,
  });
}

export function advanceSession(session, now = Date.now()) {
  const next = copy(session);
  next.elapsedMs = elapsedTime(session, now);
  if (next.status !== 'running') return next;
  next.anchorAt = now;
  next.updatedAt = now;
  const index = Math.min(4, Math.floor(next.elapsedMs / next.sectionMs));
  if (index !== next.sectionIndex) {
    unanswered(next, Math.min((next.sectionIndex + 1) * next.sectionMs, next.totalMs), now, 'section_timeout');
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
  const available = pool.filter((q) => !used.has(q.id) && (!q.groupId || !groups.has(q.groupId)));
  if (!available.length) return null;
  const level = session.levels[category];
  const distance = Math.min(...available.map((q) => Math.abs(q.level - level)));
  const close = available.filter((q) => Math.abs(q.level - level) === distance);
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
  next.current = { questionId: question.id, category: question.category, type: question.type,
    sourceId: question.sourceId, groupId: question.groupId ?? null,
    presentedLevel: question.level, askedAtElapsed: next.elapsedMs, answered: false,
    choicesOrder: order, draft: null, presentationAtElapsed: null,
    generatedQuestion: question.generated ? question : null };
  return next;
}

export function gradeAnswer(question, answer) {
  if (['memory-grid', 'memory-digits', 'construction'].includes(question.type)) {
    if (!Array.isArray(answer) || answer.length !== question.answer.length) return false;
    const expected = question.answer.map(String);
    const given = answer.map(String);
    if (question.type === 'construction') {
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
  const correct = !skipped && gradeAnswer(question, answer);
  const before = next.levels[question.category];
  const after = clamp(before + (correct ? 1 : -1), 1, MAX_LEVEL);
  const response = {
    questionId: question.id, category: question.category, type: question.type,
    sourceId: question.sourceId, groupId: question.groupId ?? null,
    presentedLevel: question.level, levelBefore: before, levelAfter: after,
    answer: copy(answer), correct, status: skipped ? 'skipped' : correct ? 'correct' : 'incorrect',
    choicesOrder: [...next.current.choicesOrder],
    answeredAt: new Date(now).toISOString(), elapsedAtAnswer: next.elapsedMs,
    timeMs: Math.max(0, next.elapsedMs - next.current.askedAtElapsed),
    generatedQuestion: question.generated ? question : null,
  };
  next.responses.push(response);
  next.current.answered = true;
  next.levels[question.category] = after;
  next.updatedAt = now;
  return { session: next, response, rejected: false };
}

export function summarize(session, now = Date.now()) {
  const elapsed = elapsedTime(session, now);
  const sections = CATEGORIES.map((category, index) => {
    const responses = session.responses.filter((r) => r.category === category.id);
    const correct = responses.filter((r) => r.status === 'correct').length;
    const incorrect = responses.filter((r) => r.status === 'incorrect').length;
    return { ...category, correct, incorrect,
      skipped: responses.filter((r) => r.status === 'skipped').length,
      unanswered: responses.filter((r) => r.status === 'unanswered').length,
      attempted: correct + incorrect,
      timeMs: clamp(elapsed - index * session.sectionMs, 0, session.sectionMs),
      finalLevel: session.levels[category.id],
    };
  });
  const total = (key) => sections.reduce((sum, section) => sum + section[key], 0);
  return { elapsedMs: elapsed, plannedMs: session.totalMs, sections,
    correct: total('correct'), incorrect: total('incorrect'), skipped: total('skipped'),
    unanswered: total('unanswered'), attempted: total('attempted'),
    accuracy: total('attempted') ? total('correct') / total('attempted') : null };
}

export function isValidSession(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || typeof value.id !== 'string' || value.id.length > 200) return false;
  if (!['running', 'paused', 'completed', 'stopped'].includes(value.status)) return false;
  if (!Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(value.updatedAt)) return false;
  if (!Number.isFinite(value.totalMs) || value.totalMs < 240000 || value.totalMs > 10800000 || value.sectionMs !== value.totalMs / 4) return false;
  if (!Number.isFinite(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > value.totalMs) return false;
  if (!Number.isInteger(value.sectionIndex) || value.sectionIndex < 0 || value.sectionIndex > 4) return false;
  if (!value.levels || !CATEGORIES.every((c) => Number.isInteger(value.levels[c.id]) && value.levels[c.id] >= 1 && value.levels[c.id] <= MAX_LEVEL)) return false;
  if (!Array.isArray(value.responses) || value.responses.length > 20000) return false;
  if (!value.responses.every((r) => r && typeof r.questionId === 'string' && CATEGORIES.some((c) => c.id === r.category) && ['correct', 'incorrect', 'skipped', 'unanswered'].includes(r.status) && Number.isFinite(r.timeMs) && r.timeMs >= 0)) return false;
  if (value.current !== null && (typeof value.current !== 'object' || typeof value.current.questionId !== 'string' || !CATEGORIES.some((c) => c.id === value.current.category))) return false;
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
