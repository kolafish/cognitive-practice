// Original visual-memory exercises. Saved snapshots retain the actual stimulus.
export const MEMORY_FAMILIES = ['visual-positions', 'visual-recognition', 'visual-symmetry'];
export const MODES = { north: '北中主练', extended: '拓展练习', legacy: '旧版综合练习' };
export const FAMILY_NAMES = {
  'visual-positions': '位置记忆', 'visual-recognition': '图案辨认', 'visual-symmetry': '对称判断',
  'matrix-choice': '图形矩阵选择', 'matrix-construction': '矩阵构图',
  'matrix-variant': 'MaRs-IB 第 4 档变式', 'sandia-matrix': 'Sandia 八选一',
  'folding-static': '折纸孔位', 'folding-animation': '动画孔位', 'folding-count': '动画孔数',
  'verbal-order': '条件排序', 'verbal-analogy': '词语关系',
  'memory-sequence-grid': '位置序列', 'memory-sequence-digits': '数字序列',
  'memory-letter-binding': '字母位置绑定',
};

export const isMatrixVariant = (q) => q?.sourceId === 'local-mars-variant';
export const isUnratedMatrix = (q) => q?.sourceId === 'local-sandia';
export const isPrivateMatrixAsset = (path) => typeof path === 'string' && /^private-matrix\/[a-z0-9-]{1,80}\/[a-z0-9-]{1,80}\.png$/.test(path);

export function taskFamily(question) {
  if (typeof question.taskFamily === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(question.taskFamily) && !['constructor', 'prototype'].includes(question.taskFamily)) return question.taskFamily;
  if (question.sourceId === 'mars_ib') return 'matrix-choice';
  if (question.sourceId === 'omib') return 'matrix-construction';
  if (question.sourceId === 'bigbench_logical_deduction') return 'verbal-order';
  if (question.sourceId === 'ekar_chinese') return 'verbal-analogy';
  if (question.originalFamily === 'paper_folding') return 'folding-static';
  if (question.type === 'folding-video') return 'folding-count';
  if (question.type === 'memory-grid') return 'memory-sequence-grid';
  if (question.type === 'memory-digits') return 'memory-sequence-digits';
  if (question.type === 'memory-binding') return 'memory-letter-binding';
  return `${question.category}:${question.taskName ?? question.type}`;
}

export function familyName(family) {
  return FAMILY_NAMES[family] ?? ({ '2DRotation': '平面旋转', '3DRotation': '立体旋转',
    CubeReconstruction: '立方体重建', CubeUnfolding: '立方体展开', CubeAssembly: '积木组合',
    CubeCounting: '方块计数', '3ViewProjection': '三视图', CrossSection: '截面判断',
    ArrowMoving: '箭头移动', BlockMoving: '方块移动', MechanicalSystem: '机械运动' }[family.split(':')[1]]) ?? family;
}

export function targetLevel(session, questionOrFamily) {
  if (isUnratedMatrix(questionOrFamily)) return null;
  if (isMatrixVariant(questionOrFamily)) return 4;
  const family = typeof questionOrFamily === 'string' ? questionOrFamily : taskFamily(questionOrFamily);
  if (session.version >= 3) return session.familyLevels?.[family] ?? 1;
  return session.levels[questionOrFamily.category];
}

export function presentedLevel(session, question) {
  if (isUnratedMatrix(question)) return null;
  return session.version >= 3 ? question.familyLevel ?? question.level : question.level;
}

export function chooseFamily(families, session, category) {
  const responses = session.responses.filter((r) => r.category === category);
  const counts = new Map(families.map((family) => [family, responses.filter((r) => r.taskFamily === family).length]));
  const minimum = Math.min(...counts.values());
  return families.find((family) => counts.get(family) === minimum) ?? null;
}

export function seededRandom(seed) {
  let value = 2166136261;
  for (const ch of String(seed)) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return () => {
    value += 0x6D2B79F5;
    let n = Math.imul(value ^ value >>> 15, value | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function pick(items, count, random) {
  const available = [...items];
  const chosen = [];
  for (let i = 0; i < count; i++) chosen.push(available.splice(Math.floor(random() * available.length), 1)[0]);
  return chosen;
}

export function mirrorCell(cell, rows, columns, axis) {
  const row = Math.floor((cell - 1) / columns), column = (cell - 1) % columns;
  return axis === 'vertical' ? row * columns + columns - column : (rows - 1 - row) * columns + column + 1;
}

export function isSymmetric(cells, rows, columns, axis) {
  const marked = new Set(cells);
  return cells.every((cell) => marked.has(mirrorCell(cell, rows, columns, axis)));
}

export function generateVisualMemory(family, level, seed = crypto.randomUUID()) {
  if (!MEMORY_FAMILIES.includes(family) || !Number.isInteger(level) || level < 1 || level > 8) throw new Error('视觉记忆生成参数不正确。');
  const random = seededRandom(`${family}:${level}:${seed}`);
  const size = level <= 2 ? 3 : level <= 5 ? 4 : level <= 7 ? 5 : 6;
  let rows = size, columns = size;
  let cells, axis = null, answer, choices;
  let type = family === 'visual-positions' ? 'memory-positions' : family === 'visual-recognition' ? 'memory-recognition' : 'memory-symmetry';
  let prompt;
  if (family === 'visual-symmetry') {
    rows = level <= 4 ? 4 : 6;
    columns = level <= 2 ? 4 : level <= 6 ? 6 : 8;
    axis = level <= 4 || random() < .5 ? 'vertical' : 'horizontal';
    const total = rows * columns;
    const representatives = Array.from({ length: total }, (_, i) => i + 1).filter((cell) => cell < mirrorCell(cell, rows, columns, axis));
    cells = pick(representatives, Math.min(level + 1, 9), random).flatMap((cell) => [cell, mirrorCell(cell, rows, columns, axis)]);
    const symmetric = random() < .5;
    if (!symmetric) {
      const from = cells[Math.floor(random() * cells.length)];
      const rest = cells.filter((cell) => cell !== from);
      const candidates = Array.from({ length: total }, (_, i) => i + 1).filter((cell) => !cells.includes(cell) && !isSymmetric([...rest, cell], rows, columns, axis));
      cells = [...rest, candidates[Math.floor(random() * candidates.length)]];
    }
    answer = symmetric ? 'symmetric' : 'asymmetric';
    choices = [{ id: 'symmetric', text: '对称' }, { id: 'asymmetric', text: '不对称' }];
    prompt = `整幅图只展示1秒。请判断黑色图案是否关于${axis === 'vertical' ? '竖直' : '水平'}中线对称。`;
  } else {
    const total = rows * columns;
    cells = pick(Array.from({ length: total }, (_, i) => i + 1), level + 1, random);
    if (family === 'visual-positions') {
      answer = [...cells].sort((a, b) => a - b);
      prompt = `整幅图只展示1秒。记住${cells.length}个黑色方格的位置，图形消失后把它们全部选出来，顺序不限。`;
    } else {
      answer = 'pattern-0';
      choices = [{ id: answer, text: '图案', cells: [...cells] }];
      const signatures = new Set([cells.slice().sort((a, b) => a - b).join(',')]);
      for (let index = 1; index <= 3; index++) {
        let candidate;
        for (let attempt = 0; attempt < 200; attempt++) {
          const removed = pick(cells, level >= 5 ? 1 : Math.min(2, cells.length), random);
          const available = Array.from({ length: total }, (_, i) => i + 1).filter((cell) => !cells.includes(cell));
          candidate = [...cells.filter((cell) => !removed.includes(cell)), ...pick(available, removed.length, random)].sort((a, b) => a - b);
          const signature = candidate.join(',');
          if (!signatures.has(signature)) { signatures.add(signature); break; }
          candidate = null;
        }
        if (!candidate) throw new Error('图案干扰项生成失败。');
        choices.push({ id: `pattern-${index}`, text: '图案', cells: candidate });
      }
      prompt = '整幅图只展示1秒。记住黑色图案，图形消失后从四个选项中选出相同的一幅。';
    }
  }
  cells.sort((a, b) => a - b);
  return { id: `north-memory-${family}-${seed}`, category: 'memory', type, sourceId: 'generated-north',
    taskFamily: family, familyLevel: level, level, generated: true, generatorVersion: 1, seed: String(seed),
    gridRows: rows, gridColumns: columns, cells, axis, answer, ...(choices ? { choices } : {}), prompt,
    displayMs: 1000, leadMs: 500, originalDifficulty: { status: 'structural', label_zh: `${rows}×${columns}方格，${cells.length}个标记`,
      metrics: { grid_rows: rows, grid_columns: columns, marked_cells: cells.length, axis }, cross_source_comparable: false },
    levelBasis: '原创练习估算：按网格、标记数量与干扰差异分档；未作人群难度标定。',
    explanation: family === 'visual-symmetry' ? `原图关于${axis === 'vertical' ? '竖直' : '水平'}中线${answer === 'symmetric' ? '对称' : '不对称'}。对称图中每个黑格都能找到镜像黑格。` : '正确图案保留在逐题记录中，可与作答逐格比较。' };
}

export function validVisualMemory(question) {
  if (!question || question.sourceId !== 'generated-north' || question.category !== 'memory' || !MEMORY_FAMILIES.includes(question.taskFamily)) return false;
  const expectedType = { 'visual-positions': 'memory-positions', 'visual-recognition': 'memory-recognition', 'visual-symmetry': 'memory-symmetry' }[question.taskFamily];
  if (question.type !== expectedType || typeof question.id !== 'string' || question.id.length > 200 || typeof question.seed !== 'string' || question.seed.length > 100) return false;
  if (question.generatorVersion !== 1 || question.generated !== true || question.displayMs !== 1000 || question.leadMs !== 500) return false;
  if (!Number.isInteger(question.level) || question.level < 1 || question.level > 8 || question.familyLevel !== question.level) return false;
  const { gridRows: rows, gridColumns: columns } = question;
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 3 || rows > 8 || columns < 3 || columns > 8) return false;
  const validCells = (cells) => Array.isArray(cells) && cells.length > 0 && cells.length <= 32 && new Set(cells).size === cells.length && cells.every((cell) => Number.isInteger(cell) && cell >= 1 && cell <= rows * columns);
  if (!validCells(question.cells)) return false;
  if (question.type === 'memory-positions') return validCells(question.answer) && question.cells.length === question.answer.length && question.cells.every((cell) => question.answer.includes(cell));
  if (question.type === 'memory-symmetry') {
    return ['vertical', 'horizontal'].includes(question.axis) && question.answer === (isSymmetric(question.cells, rows, columns, question.axis) ? 'symmetric' : 'asymmetric') && Array.isArray(question.choices) && question.choices.length === 2 && ['symmetric', 'asymmetric'].every((id) => question.choices.some((choice) => choice?.id === id));
  }
  if (!Array.isArray(question.choices) || question.choices.length !== 4 || !question.choices.every((choice) => choice && typeof choice === 'object') || new Set(question.choices.map((choice) => choice.id)).size !== 4) return false;
  if (!question.choices.every((choice) => typeof choice.id === 'string' && choice.id.length < 100 && validCells(choice.cells) && choice.cells.length === question.cells.length)) return false;
  const signatures = question.choices.map((choice) => choice.cells.slice().sort((a, b) => a - b).join(','));
  return new Set(signatures).size === 4 && question.choices.find((choice) => choice.id === question.answer)?.cells.slice().sort((a, b) => a - b).join(',') === question.cells.slice().sort((a, b) => a - b).join(',');
}

export function validStoredQuestion(question) {
  if (validVisualMemory(question)) return true;
  if (!question || !['figure', 'memory', 'spatial', 'verbal'].includes(question.category)) return false;
  if (typeof question.id !== 'string' || question.id.length > 200 || typeof question.sourceId !== 'string' || question.sourceId.length > 200) return false;
  const variant = isMatrixVariant(question), unrated = isUnratedMatrix(question);
  if (typeof question.prompt !== 'string' || question.prompt.length > 20000 || (!unrated && (!Number.isInteger(question.level) || question.level < 1 || question.level > 8))) return false;
  if (question.familyLevel !== undefined && (!Number.isInteger(question.familyLevel) || question.familyLevel < 1 || question.familyLevel > 8)) return false;
  const asset = (path) => path === undefined || (variant || unrated ? isPrivateMatrixAsset(path) : typeof path === 'string' && /^assets\/bank\/[a-f0-9]+\.(png|jpg|jpeg|svg|mp4)$/.test(path));
  const crop = (value) => value === undefined || value && ['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'].every((key) => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 20000) && value.width > 0 && value.height > 0 && value.x + value.width <= value.sourceWidth && value.y + value.height <= value.sourceHeight;
  if (!['image', 'probeImage', 'video', 'answerImage'].every((key) => asset(question[key])) || !crop(question.answerImageCrop)) return false;
  const option = (choice) => choice && typeof choice.id === 'string' && choice.id.length < 200 && (choice.text === undefined || typeof choice.text === 'string' && choice.text.length < 10000) && asset(choice.image) && crop(choice.imageCrop);
  if (question.choices !== undefined && (!Array.isArray(question.choices) || question.choices.length > 20 || !question.choices.every(option))) return false;
  if (variant || unrated) {
    const matrixId = /^[a-z0-9][a-z0-9-]{0,79}$/;
    if (question.category !== 'figure' || question.type !== 'choice' || !matrixId.test(question.matrixItemId ?? '') || question.id !== `local-matrix-${question.matrixItemId}`
        || !isPrivateMatrixAsset(question.image) || question.choices?.length !== (variant ? 4 : 8)
        || !question.choices.every((c, i) => c.id === String(i + 1))) return false;
    if (variant && (question.taskFamily !== 'matrix-variant' || question.level !== 4 || question.familyLevel !== 4
        || !matrixId.test(question.matrixVariantOf ?? '') || !question.choices.every((c) => isPrivateMatrixAsset(c.image)))) return false;
    if (unrated && (question.taskFamily !== 'sandia-matrix' || question.level !== null || question.familyLevel !== undefined
        || question.choicesEmbedded !== true || !isPrivateMatrixAsset(question.matrixOptionsImage))) return false;
  }
  if (['choice', 'folding-choice', 'memory-binding'].includes(question.type)) return question.choices?.some((choice) => choice.id === question.answer) === true;
  if (question.type === 'folding-video') return Number.isInteger(question.answer) && question.answer >= 0 && question.answer <= 512;
  if (question.type === 'construction') return Array.isArray(question.elements) && question.elements.length <= 24 && question.elements.every(option) && Array.isArray(question.answer) && question.answer.every((id) => question.elements.some((choice) => choice.id === id));
  if (['memory-grid', 'memory-digits'].includes(question.type)) {
    const grid = question.type === 'memory-digits' || Number.isInteger(question.gridRows) && question.gridRows > 0 && question.gridRows <= 8 && Number.isInteger(question.gridColumns) && question.gridColumns > 0 && question.gridColumns <= 8;
    return grid && Array.isArray(question.sequence) && question.sequence.length > 0 && question.sequence.length <= 32 && question.sequence.every((n) => Number.isInteger(n) && n >= 0 && n <= 999) && Array.isArray(question.answer) && question.answer.length === question.sequence.length && question.answer.every((n, i) => n === question.sequence[i]);
  }
  return false;
}

export function generatedMemorySignature(q) {
  return `${taskFamily(q)}|${q.gridRows ?? '-'}x${q.gridColumns ?? '-'}|${q.sequence?.join(',') ?? ''}`;
}
