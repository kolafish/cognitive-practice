import { validStoredQuestion } from './practice.js';

export const MAX_FIGURE_PACK_BYTES = 32 * 1024 * 1024;
export const FIGURE_FAMILIES = {
  position: '位置规律', style: '样式规律', attribute: '属性规律', quantity: '数量规律',
};
export const FIGURE_RULES = {
  regions: '数量规律 → 封闭区域数', closure: '属性规律 → 开放与封闭',
  translation: '位置规律 → 平移', rotation: '位置规律 → 旋转', reflection: '位置规律 → 翻转',
  xor: '样式规律 → 去同存异', intersection: '样式规律 → 去异存同', overlay: '样式规律 → 叠加',
  distribution: '样式规律 → 遍历', symmetry: '属性规律 → 对称性', curves: '属性规律 → 曲线与直线',
  points: '数量规律 → 交点', lines: '数量规律 → 线条', angles: '数量规律 → 角', elements: '数量规律 → 元素',
  markers: '特殊规律 → 功能标记', 'region-shape': '属性规律 → 封闭区域形状',
  'color-alternation': '样式规律 → 黑白交替', 'symbol-operation': '特殊规律 → 符号运算',
  'overlap-area': '属性规律 → 重叠区域与遮挡', 'inside-outside': '数量规律 → 内外数量关系',
  'overlap-alternation': '属性规律 → 分离与重叠交替', 'element-xor': '样式规律 → 完整元素去同存异',
  'one-stroke': '数量规律 → 最少笔画', 'pair-lines': '属性规律 → 线与轴的方向关系',
  'black-white-operation': '样式规律 → 黑白运算',
  connections: '属性规律 → 图形连接方式', 'area-units': '数量规律 → 面积单位换算',
  'turn-taking': '位置规律 → 元素轮流变化', 'element-transfer': '样式规律 → 元素传递',
};

const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const shortText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const https = (value) => typeof value === 'string' && value.length <= 1000 && /^https:\/\/[^\s]+$/.test(value);
export const figureAssetPath = (packId, imageId) => `private-figure/${packId}/${imageId}.png`;

export function northFigureQuestions(pack) {
  return pack.questions.map((q) => ({
    id: `local-figure-${q.id}`, sourceQuestionId: q.id, category: 'figure', type: 'choice',
    sourceId: 'local-figure-rules', taskFamily: `figure-${q.family}`, taskFamilyName: FIGURE_FAMILIES[q.family],
    familyLevel: q.level, familyMaxLevel: 4, level: q.level,
    image: figureAssetPath(pack.id, q.image), prompt: q.prompt,
    choicesEmbedded: true, choices: q.options.map((text, index) => ({ id: 'ABCD'[index], text })), answer: q.answer,
    ruleTags: q.rules.map((rule) => FIGURE_RULES[rule]), ruleIds: q.rules,
    explanation: q.explanation, sourceName: q.sourceName, sourceUrl: q.sourceUrl,
    originalSourceId: q.originalSourceId, reviewStatus: q.reviewStatus,
    originalDifficulty: { status: 'unrated', label_zh: '来源未提供逐题难度常模', cross_source_comparable: false },
    familyLevelBasis: '本批筛选题的结构估算，1–4档；按单一规律、辨别细节和复合规律递进，未经儿童作答校准，与MaRs档位不对齐。',
  }));
}

export async function parseFigurePack(text) {
  if (text.length > MAX_FIGURE_PACK_BYTES) throw new Error('请选择 32 MB 以内的图形规律题包。');
  const invalid = () => { throw new Error('图形规律题包格式不正确，原有题包和记录未改动。'); };
  let data;
  try { data = JSON.parse(text); } catch { invalid(); }
  if (data?.format !== 'cognitive-practice-figure-pack' || data.version !== 1 || !id(data.id)
    || !shortText(data.name, 100) || !Array.isArray(data.questions) || !data.questions.length || data.questions.length > 1000
    || !data.images || typeof data.images !== 'object' || Array.isArray(data.images) || Object.keys(data.images).length > 1000) invalid();
  const files = new Map(), ids = new Set();
  const questions = data.questions.map((q) => {
    if (!q || !id(q.id) || ids.has(q.id) || !id(q.image) || !Object.hasOwn(data.images, q.image)
      || !Object.hasOwn(FIGURE_FAMILIES, q.family) || !Number.isInteger(q.level) || q.level < 1 || q.level > 4
      || !shortText(q.prompt, 3000) || !shortText(q.explanation, 4000) || !['A','B','C','D'].includes(q.answer)
      || !Array.isArray(q.options) || q.options.length !== 4 || !q.options.every((s) => shortText(s, 500))
      || new Set(q.options).size !== 4 || !Array.isArray(q.rules) || !q.rules.length || q.rules.length > 6
      || new Set(q.rules).size !== q.rules.length || !q.rules.every((rule) => Object.hasOwn(FIGURE_RULES, rule))
      || !shortText(q.sourceName, 200) || !https(q.sourceUrl) || !shortText(q.originalSourceId, 100)
      || q.reviewStatus !== 'image-and-answer-reviewed') invalid();
    if (!files.has(q.image)) {
      const source = data.images[q.image];
      if (typeof source !== 'string' || source.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source)) invalid();
      let bytes;
      try { bytes = Uint8Array.from(atob(source), (char) => char.charCodeAt(0)); } catch { invalid(); }
      if (bytes.length < 45) invalid();
      const h = new DataView(bytes.buffer);
      if (h.getUint32(0) !== 0x89504e47 || h.getUint32(4) !== 0x0d0a1a0a || h.getUint32(8) !== 13 || h.getUint32(12) !== 0x49484452
        || ![16,20].every((offset) => h.getUint32(offset) > 0 && h.getUint32(offset) <= 4096)
        || h.getUint32(16) * h.getUint32(20) > 12000000) invalid();
      files.set(q.image, new Blob([bytes], { type: 'image/png' }));
    }
    ids.add(q.id);
    return { id: q.id, image: q.image, family: q.family, level: q.level, prompt: q.prompt, options: q.options,
      answer: q.answer, rules: q.rules, explanation: q.explanation, sourceName: q.sourceName, sourceUrl: q.sourceUrl,
      originalSourceId: q.originalSourceId, reviewStatus: q.reviewStatus };
  });
  // Ignore neither hidden extra assets nor executable document formats.
  if (files.size !== Object.keys(data.images).length) invalid();
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const pack = { id: data.id, name: data.name, questions, files, fingerprint };
  if (!northFigureQuestions(pack).every(validStoredQuestion)) invalid();
  return pack;
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openFigureStore() {
  const request = indexedDB.open('cognitive-practice-figures', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('packs').createIndex('owner', 'owner');
  const db = await result(request);
  db.onversionchange = () => db.close();
  return {
    packs: async (owner) => (await result(db.transaction('packs').objectStore('packs').index('owner').getAll(owner))).map((row) => row.pack),
    savePack: async (owner, pack) => {
      const tx = db.transaction('packs', 'readwrite'), store = tx.objectStore('packs');
      const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error ?? new Error('导入未完成')); });
      try {
        const existing = await result(store.get([owner, pack.id]));
        if (existing && existing.pack.fingerprint !== pack.fingerprint) throw new Error('同名题包内容不同，请使用新版本题包。原有题目和记录已保留。');
        const all = await result(store.index('owner').getAll(owner));
        const seen = new Set(all.filter((row) => row.pack.id !== pack.id).flatMap((row) => row.pack.questions.map((q) => q.id)));
        if (pack.questions.some((q) => seen.has(q.id))) throw new Error('题包与已导入题目重复，请使用不重叠的补充题包。');
        if (!existing) store.add({ owner, pack }, [owner, pack.id]);
        await done;
        return existing?.pack ?? pack;
      } catch (error) {
        try { tx.abort(); } catch {}
        await done.catch(() => {});
        throw error;
      }
    },
  };
}
