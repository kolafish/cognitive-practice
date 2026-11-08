import { readActiveUser } from './storage.js';
import { MAX_MATRIX_PACK_BYTES, MATRIX_SECTIONS, openMatrixStore, parseMatrixPack } from './matrix-pack.js';

const content = document.querySelector('#matrix-content');
const errorBox = document.querySelector('#matrix-error');
const fileInput = document.querySelector('#matrix-file');
const owner = readActiveUser();
if (owner) document.querySelector('#matrix-owner').textContent = `当前档案 · ${owner.slice('user:'.length)}`;
const answers = new Map();
const imageUrls = [];
let store, pack, question, kind, selected, startedAt;
let saving = false;

function showError(message = '') {
  errorBox.hidden = !message;
  errorBox.textContent = message;
}

function image(key, alt) {
  const url = URL.createObjectURL(pack.files.get(key));
  imageUrls.push(url);
  return `<img src="${url}" alt="${alt}">`;
}

function heading(title, description) {
  return `<div class="matrix-heading"><div class="eyebrow">图形规律 · 专项练习</div><h1 tabindex="-1">${title}</h1><p class="lead">${description}</p></div>`;
}

function optionLabel(index) { return question.options ? String.fromCharCode(65 + index) : String(index + 1); }

function practiceMarkup() {
  const section = MATRIX_SECTIONS[kind];
  const pool = pack.questions.filter((q) => q.kind === kind);
  const record = answers.get(question.id);
  const progress = pool.filter((q) => answers.has(q.id)).length;
  const choices = Array.from({ length: question.options ? 4 : 8 }, (_, index) => {
    const label = optionLabel(index);
    const chosen = index === (record?.selected ?? selected);
    const resultClass = record ? index === question.answer ? ' is-correct' : chosen ? ' is-wrong' : '' : '';
    return `<button type="button" class="choice matrix-choice${resultClass}" data-choice="${index}" aria-label="选项 ${label}" aria-pressed="${chosen}" ${record ? 'disabled' : ''}><b>${label}</b>${question.options ? image(question.options[index], `选项 ${label} 的图形`) : ''}</button>`;
  }).join('');
  return `<div class="matrix-toolbar"><button class="secondary" data-action="overview">← 补充练习</button><span>已答 ${progress} / ${pool.length} 道</span></div>
    <article class="matrix-card"><h1 tabindex="-1">${section.name}</h1>
      <p class="quiet">观察图形规律，选出能补全矩阵的一项。</p>
      <div class="matrix-stem">${image(question.image, '待补全的矩阵')}</div>
      ${question.options ? '' : `<div class="matrix-sheet">${image(question.optionsImage, '选项图，从左到右先上排 1 至 4，再下排 5 至 8')}<p class="quiet">先上排 1–4，再下排 5–8</p></div>`}
      <div class="matrix-choices${question.options ? ' matrix-choices-pictures' : ''}" role="group" aria-label="选择答案">${choices}</div>
      ${record ? `<p class="matrix-feedback ${record.correct ? 'is-correct' : 'is-wrong'}" role="status" tabindex="-1">${record.correct ? '答对了。' : `你选了 ${optionLabel(record.selected)}。正确答案是 ${optionLabel(question.answer)}。`}</p>` : ''}
      <div class="button-row">${record ? `<button class="primary" data-action="next">${progress === pool.length ? '查看完成情况' : '下一题'}</button>` : '<button class="primary" data-action="answer" disabled>确认答案</button>'}</div></article>`;
}

function render(focus = '') {
  imageUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  content.removeAttribute('aria-busy');
  if (!owner) {
    content.innerHTML = heading('矩阵补充练习', '先回到首页进入你的用户名档案，再打开矩阵补充练习。');
  } else if (!pack) {
    content.innerHTML = `${heading('矩阵补充练习', '导入收到的题包，一次导入后就能接着做。')}<section class="matrix-card"><h2>从本机选择题包</h2><p class="quiet">请选择矩阵题包 JSON 文件。题目和答题记录都保存在这个浏览器。</p><button class="primary" data-action="import">导入本地题包</button></section>`;
  } else if (question) {
    content.innerHTML = practiceMarkup();
  } else {
    const sections = Object.entries(MATRIX_SECTIONS).map(([key, section]) => {
      const pool = pack.questions.filter((q) => q.kind === key);
      if (!pool.length) return '';
      const records = pool.map((q) => answers.get(q.id)).filter(Boolean);
      const total = records.filter((r) => r.correct).length;
      const label = records.length ? '继续练习' : '开始练习';
      return `<section class="matrix-card"><h2>${section.name}</h2><p class="quiet">${section.note}</p><p class="matrix-progress">已答 <b>${records.length} / ${pool.length}</b> · 答对 <b>${total}</b> · 答错 <b>${records.length - total}</b></p><button class="primary" data-kind="${key}" ${records.length === pool.length ? 'disabled' : ''}>${records.length === pool.length ? '本组已完成' : label}</button></section>`;
    }).join('');
    content.innerHTML = `${heading('矩阵补充练习', '每组单独记录进度。答完一题就保存，下次从未做过的题继续。')}<div class="matrix-sections">${sections}</div>
      <div class="button-row matrix-export"><button class="secondary" data-action="export" ${answers.size ? '' : 'disabled'}>导出专项记录</button></div>`;
  }
  content.querySelector(focus || 'h1[tabindex]')?.focus({ preventScroll: true });
}

async function loadAnswers() {
  answers.clear();
  for (const record of await store.answers(owner, pack.id)) answers.set(record.questionId, record);
}

function startQuestion(section) {
  kind = section;
  question = pack.questions.find((q) => q.kind === kind && !answers.has(q.id));
  selected = undefined;
  render();
  startedAt = performance.now();
  window.scrollTo(0, 0);
}

function sameOwner() {
  if (readActiveUser() === owner) return true;
  showError('当前档案已切换。请从首页重新进入补充练习。');
  return false;
}

function exportAnswers() {
  const records = [...answers.values()].map(({ owner: _owner, packId: _packId, ...record }) => record);
  records.sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  const payload = { format: 'cognitive-practice-matrix-records', version: 1, packId: pack.id, exportedAt: new Date().toISOString(), records };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = '矩阵专项练习记录.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

content.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || saving || !sameOwner()) return;
  showError();
  if (button.dataset.kind) startQuestion(button.dataset.kind);
  if (button.dataset.choice !== undefined && question && !answers.has(question.id)) {
    selected = Number(button.dataset.choice);
    content.querySelectorAll('[data-choice]').forEach((option) => option.setAttribute('aria-pressed', option === button));
    content.querySelector('[data-action="answer"]').disabled = false;
  }
  switch (button.dataset.action) {
    case 'import': fileInput.click(); break;
    case 'overview': question = undefined; render(); break;
    case 'next': startQuestion(kind); break;
    case 'export': exportAnswers(); break;
    case 'answer': {
      if (selected === undefined || answers.has(question.id)) break;
      saving = true;
      button.disabled = true;
      try {
        const record = await store.saveAnswer({ owner, packId: pack.id, questionId: question.id, kind,
          selected, correctAnswer: question.answer, correct: selected === question.answer,
          answeredAt: new Date().toISOString(), timeMs: Math.round(performance.now() - startedAt),
          ...(question.variantOf ? { variantOf: question.variantOf, level: 4 } : {}) });
        answers.set(question.id, record);
        render('.matrix-feedback');
      } catch {
        showError('这题暂时未保存，请再试一次。');
        button.disabled = false;
      } finally { saving = false; }
      break;
    }
  }
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file || saving || !sameOwner()) return;
  saving = true;
  const button = content.querySelector('[data-action="import"]');
  button.disabled = true;
  try {
    if (file.size > MAX_MATRIX_PACK_BYTES) throw new Error('请选择 8 MB 以内的题包。');
    const parsed = parseMatrixPack(await file.text());
    if (!sameOwner()) return;
    pack = await store.savePack(owner, parsed);
    await loadAnswers();
    showError();
    render();
  } catch (error) {
    showError(error instanceof DOMException ? '导入失败，请检查浏览器存储空间后重试。' : error.message);
  } finally { saving = false; button.disabled = false; }
});

async function boot() {
  try {
    if (owner) {
      store = await openMatrixStore();
      pack = await store.pack(owner);
      if (pack) await loadAnswers();
    }
    render();
  } catch {
    content.removeAttribute('aria-busy');
    content.innerHTML = heading('矩阵补充练习', '暂时无法读取浏览器存储。请用平时练习的浏览器重新打开。');
  }
}

boot();
