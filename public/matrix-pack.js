export const MAX_MATRIX_PACK_BYTES = 8 * 1024 * 1024;
export const MATRIX_SECTIONS = {
  'mars-variant': { name: 'MaRs-IB 第 4 档变式', note: '四选一。换一套图形，再练习原来的解题规律。' },
  sandia: { name: 'Sandia 矩阵', note: '八选一，按原题顺序作答。独立记录，暂无练习档位。' },
};

export const matrixAssetPath = (packId, key) => `private-matrix/${packId}/${key}.png`;

export function northMatrixQuestions(pack) {
  return pack.questions.map((item) => {
    const variant = item.kind === 'mars-variant';
    const path = (key) => matrixAssetPath(pack.id, key);
    const choices = variant ? item.options.map((key, i) => ({ id: String(i + 1), image: path(key) }))
      : Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), text: String(i + 1) }));
    return {
      id: `local-matrix-${item.id}`, matrixItemId: item.id, category: 'figure', type: 'choice',
      sourceId: variant ? 'local-mars-variant' : 'local-sandia', taskFamily: variant ? 'matrix-variant' : 'sandia-matrix',
      level: variant ? 4 : null, image: path(item.image), choices, answer: String(item.answer + 1),
      prompt: variant ? '观察图形规律，选出能补全矩阵的一项。'
        : '选出能补全矩阵的一项。选项图从左到右，先上排 1–4，再下排 5–8。',
      ...(variant ? { familyLevel: 4, matrixVariantOf: item.variantOf, familyLevelBasis: '沿用 MaRs-IB 母题的结构档位。' }
        : { choicesEmbedded: true, matrixOptionsImage: path(item.optionsImage), levelBasis: '未分档，单独统计。' }),
    };
  });
}

export function parseMatrixPack(text) {
  if (text.length > MAX_MATRIX_PACK_BYTES) throw new Error('请选择 8 MB 以内的题包。');
  const invalid = () => { throw new Error('这不是有效的矩阵题包，请选择收到的 JSON 文件。'); };
  let pack;
  try { pack = JSON.parse(text); } catch { invalid(); }
  const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
  if (pack?.format !== 'cognitive-practice-matrix-pack' || pack.version !== 1 || !id(pack.id)
      || !Array.isArray(pack.questions) || !pack.questions.length || pack.questions.length > 250
      || !pack.images || typeof pack.images !== 'object' || Array.isArray(pack.images)) invalid();
  const files = new Map();
  const keys = new Set();
  const getImage = (key) => {
    if (!id(key) || !Object.hasOwn(pack.images, key)) invalid();
    if (files.has(key)) return;
    const source = pack.images[key];
    if (typeof source !== 'string' || source.length > 240000) invalid();
    let bytes;
    try { bytes = Uint8Array.from(atob(source), (char) => char.charCodeAt(0)); } catch { invalid(); }
    if (bytes.length < 33) invalid();
    const header = new DataView(bytes.buffer);
    if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
        || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452
        || ![16, 20].every((offset) => header.getUint32(offset) > 0 && header.getUint32(offset) <= 1600)) invalid();
    files.set(key, new Blob([bytes], { type: 'image/png' }));
  };
  const questions = pack.questions.map((q) => {
    if (!q || !id(q.id) || keys.has(q.id) || !Object.hasOwn(MATRIX_SECTIONS, q.kind)) invalid();
    const variant = q.kind === 'mars-variant';
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (variant ? 4 : 8)) invalid();
    getImage(q.image);
    if (variant) {
      if (!id(q.variantOf) || !Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options).size !== 4) invalid();
      q.options.forEach(getImage);
    } else getImage(q.optionsImage);
    keys.add(q.id);
    return { id: q.id, kind: q.kind, image: q.image, answer: q.answer,
      ...(variant ? { options: q.options, variantOf: q.variantOf } : { optionsImage: q.optionsImage }) };
  });
  return { id: pack.id, questions, files };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openMatrixStore() {
  const request = indexedDB.open('cognitive-practice-matrix', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('packs');
    const answers = request.result.createObjectStore('answers');
    answers.createIndex('ownerPack', ['owner', 'packId']);
  };
  const db = await requestResult(request);
  db.onversionchange = () => db.close();
  async function write(store, update) {
    const transaction = db.transaction(store, 'readwrite');
    const finished = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    try {
      const result = await update(transaction.objectStore(store));
      await finished;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await finished.catch(() => {});
      throw error;
    }
  }
  return {
    pack: (owner) => requestResult(db.transaction('packs').objectStore('packs').get(owner)),
    savePack: (owner, pack) => write('packs', async (store) => {
      const existing = await requestResult(store.get(owner));
      if (existing) return existing;
      store.add(pack, owner);
      return pack;
    }),
    answers: (owner, packId) => requestResult(db.transaction('answers').objectStore('answers').index('ownerPack').getAll([owner, packId])),
    saveAnswer: (record) => write('answers', async (store) => {
      const key = [record.owner, record.packId, record.questionId];
      const existing = await requestResult(store.get(key));
      if (existing) return existing;
      store.add(record, key);
      return record;
    }),
  };
}
