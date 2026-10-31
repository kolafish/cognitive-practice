import {
  CATEGORIES, MAX_LEVEL, createSession, elapsedTime, advanceSession, pauseSession, resumeSession,
  finishSession, snapshotSession, chooseQuestion, generatedMemory, beginQuestion, submitAnswer,
  summarize,
} from './engine.js';
import { openStore, readCheckpoint, saveCheckpoint, readPreferences, savePreferences } from './storage.js';

const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const icons = {
  figure: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="4" width="9" height="9" rx="1"/><rect x="19" y="4" width="9" height="9" rx="1"/><rect x="4" y="19" width="9" height="9" rx="1"/><circle cx="23.5" cy="23.5" r="4.5"/></svg>',
  memory: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="4" width="24" height="24" rx="5"/><path d="M12 4v24M20 4v24M4 12h24M4 20h24"/><rect x="12" y="12" width="8" height="8" fill="currentColor" stroke="none"/></svg>',
  spatial: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m16 3 12 7v13l-12 7-12-7V10zm0 14 12-7M16 17 4 10m12 7v13"/><path d="m10 6 12 7v13" opacity=".45"/></svg>',
  verbal: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 5h18v22H7zM11 11h10M11 16h10M11 21h6"/><path d="m20 20 4 4 5-7" stroke-width="2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 4h12l3 3v13H4V4zm3 0v6h8V4M8 20v-7h8v7"/></svg>',
  pause: '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><rect x="9" y="7" width="5" height="18" rx="1"/><rect x="19" y="7" width="5" height="18" rx="1"/></svg>',
};
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeAsset = (value) => typeof value === 'string' && /^assets\/[a-zA-Z0-9/_\-.]+$/.test(value) && !value.split('/').includes('..') ? value : '';
const safeLink = (value) => /^https:\/\//.test(value ?? '') ? esc(value) : '#';
const number = (value) => new Intl.NumberFormat('zh-CN').format(value);
const statusText = (value) => ({ completed: '已完成', stopped: '提前结束', paused: '未完成', running: '进行中', correct: '答对', incorrect: '答错', skipped: '跳过', unanswered: '未作答' }[value] ?? value);
const category = (id) => CATEGORIES.find((c) => c.id === id);
const dateKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
const dateLabel = (date) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date));
function clock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(seconds / 60);
  return `${String(min).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function duration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60 ? `${sec % 60}秒` : ''}`;
}

let bank = null;
let store = null;
let sessions = [];
let session = null;
let route = 'home';
let selectedSessionId = null;
let recordFilter = 'all';
let dateFilter = '';
let minutes = readPreferences().minutes;
let loadError = '';
let storageError = '';
let savedAt = 0;
let checkpointAt = 0;
let lastMemoryVisual = '';
let toastTimer;
let saveQueue = Promise.resolve();
const questions = new Map();
const exposures = {};

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 4200);
}
function logo() {
  return `<a href="#" data-action="home" class="brand"><span class="brand-mark">${icons.figure}</span><span>思维练习室<small>THINKING ROOM</small></span></a>`;
}
function header(active) {
  return `<header class="header">${logo()}<nav class="nav" aria-label="主要导航"><button data-action="home" class="${active === 'home' ? 'active' : ''}" ${active === 'home' ? 'aria-current="page"' : ''}>开始练习</button><button data-action="history" class="${active === 'history' ? 'active' : ''}" ${active === 'history' ? 'aria-current="page"' : ''}>练习记录</button><button data-action="about" class="${active === 'about' ? 'active' : ''}" ${active === 'about' ? 'aria-current="page"' : ''}>说明</button></nav></header>`;
}
function footer() {
  return '<footer class="footer"><div>每一次专注，都留下一点进步。<span class="num"> THINKING ROOM</span></div><div>记录仅保存在当前浏览器 · <a href="attributions.html">题库来源与许可</a> · 非商业练习</div></footer>';
}
function shell(content, active = route) { return `<div class="wrap">${header(active)}<main id="main" class="fade-in">${content}</main>${footer()}</div>`; }
function sourceName(id) { return bank?.sources.find((s) => s.id === id)?.name ?? (id === 'generated' ? '练习生成' : id); }
function getQuestion(current = session?.current) { return current?.generatedQuestion ?? questions.get(current?.questionId); }
function activeCandidate() { return sessions.find((s) => ['paused', 'running'].includes(s.status)); }

function home() {
  const pending = activeCandidate();
  const sectionTime = duration(minutes * 60000 / 4);
  return shell(`
    ${pending ? `<section class="resume-banner"><div><strong>还有一段练习，可以接着完成</strong><p>${dateLabel(pending.startedAt)}开始 · 已练习 ${duration(pending.elapsedMs)}</p></div><div class="button-row"><button class="ghost" data-action="stop-pending" data-id="${esc(pending.id)}">结束这次</button><button class="primary" data-action="resume" data-id="${esc(pending.id)}">继续练习 ${arrow}</button></div></section>` : ''}
    ${loadError ? `<div class="error-banner">${esc(loadError)} <button class="ghost" data-action="reload">重新加载</button></div>` : ''}
    ${storageError ? `<div class="error-banner">${esc(storageError)}</div>` : ''}
    <section class="hero"><div><div class="eyebrow">四类能力 · 自适应练习</div><h1>从一小步开始，<br>让思维慢慢展开。</h1><p class="lead">选择一段专注的时间。图形、记忆、空间与文字依次练习，题目会随着你的作答，逐步调整难度。</p><div class="hero-notes"><span>${icons.clock}四类平均分配时间</span><span>${icons.save}逐题记录，随时回看</span></div></div><div class="hero-art" aria-hidden="true">${CATEGORIES.map((c) => `<div class="art-card">${icons[c.id]}<small>${c.name}</small></div>`).join('')}<div class="art-tag"><b>1 → 8</b>从简单题开始</div></div></section>
    <section><div class="section-heading"><h2>四段专注，一次完整练习</h2><span class="quiet">${bank ? `${number(bank.stats.total)} 道题已就绪` : '正在加载题库…'}</span></div><div class="category-grid">${CATEGORIES.map((c) => `<article class="category-card"><div class="category-top"><span class="category-icon">${icons[c.id]}</span><span class="category-number">${c.number}</span></div><h3>${c.name}</h3><p>${c.description}</p><div class="category-foot"><span>${bank ? `${number(bank.categories[c.id].length)} 道题` : '准备中'}</span><b data-section-duration>${sectionTime}</b></div></article>`).join('')}</div></section>
    <section class="setup"><div><h2>这次，留多少时间给自己？</h2><div class="preset-row">${[20, 40, 60].map((value) => `<button data-action="duration" data-value="${value}" class="preset ${minutes === value ? 'selected' : ''}">${value} 分钟</button>`).join('')}<label class="custom-duration">自定义 <input id="minutes" type="number" min="4" max="180" step="1" value="${minutes}" aria-label="总练习分钟数"> 分钟</label></div><p class="quiet">每类 <span data-section-duration>${sectionTime}</span>，答对升一档，答错降一档。</p></div><div class="setup-action"><button class="primary start-button" data-action="start" ${!bank || !store || pending ? 'disabled' : ''}><span id="start-label">${bank ? `开始 ${minutes} 分钟练习` : '正在准备题库…'}</span>${arrow}</button><p class="quiet">${pending ? '先继续或结束未完成的练习' : '可以暂停 · 关闭页面后可恢复进度'}</p></div></section>
  `, 'home');
}

function history() {
  const filtered = sessions.filter((s) => !dateFilter || dateKey(s.startedAt) === dateFilter);
  const stats = sessions.map((s) => summarize(s));
  const totalTime = stats.reduce((sum, s) => sum + s.elapsedMs, 0);
  const totalCorrect = stats.reduce((sum, s) => sum + s.correct, 0);
  return shell(`<div class="page-heading"><div><div class="eyebrow">记录自己的节奏</div><h1>练习记录</h1><p>哪天练了多久，每道题的答案，都在这里。</p></div><div class="button-row"><button class="secondary" data-action="import">导入备份</button><button class="primary" data-action="export" ${!sessions.length ? 'disabled' : ''}>导出全部记录</button></div></div>
    <div class="stats"><div class="stat"><div class="stat-label">累计练习</div><div class="stat-value">${sessions.length}<small>次</small></div></div><div class="stat"><div class="stat-label">累计专注</div><div class="stat-value">${Math.floor(totalTime / 60000)}<small>分钟</small></div></div><div class="stat"><div class="stat-label">累计答对</div><div class="stat-value">${totalCorrect}<small>道</small></div></div></div>
    <div class="filter-row"><span class="quiet">${dateFilter ? `${dateFilter} 的记录` : '全部练习'}</span><label class="date-filter">按日期查看 <input id="date-filter" type="date" value="${esc(dateFilter)}" aria-label="筛选练习日期">${dateFilter ? '<button data-action="clear-date">显示全部</button>' : ''}</label></div>
    <div class="table-card">${filtered.length ? `<table class="records-table"><thead><tr><th>练习时间（北京时间）</th><th>实际用时</th><th>作答情况</th><th>状态</th><th></th></tr></thead><tbody>${filtered.map((s) => { const info = summarize(s); return `<tr><td><span class="num">${dateLabel(s.startedAt)}</span><div class="quiet">计划 ${s.totalMs / 60000} 分钟</div></td><td class="num">${duration(info.elapsedMs)}</td><td><span style="color:var(--green)">${info.correct} 对</span> / <span style="color:var(--red)">${info.incorrect} 错</span><div class="quiet">${info.skipped} 跳过 · ${info.unanswered} 未答</div></td><td><span class="pill ${s.status}">${statusText(s.status)}</span></td><td><button class="ghost" data-action="detail" data-id="${esc(s.id)}">查看 →</button></td></tr>`; }).join('')}</tbody></table>` : `<div class="empty">${icons.verbal}<h2>${dateFilter ? '这一天还没有练习记录' : '第一段专注，从这里开始'}</h2><p>${dateFilter ? '可以选择其他日期，或显示全部记录。' : '完成练习后，会自动保存用时与逐题结果。'}</p>${!dateFilter ? '<button class="primary" data-action="home">开始一次练习</button>' : ''}</div>`}</div><p class="history-note">记录保存在当前浏览器，清理站点数据会清除记录。导出 JSON 备份后，可以在另一台设备导入；相同记录会按更新时间合并。</p>
  `, 'history');
}

function about() {
  return shell(`<div class="page-heading"><div><div class="eyebrow">轻松上手</div><h1>怎样练，怎样记录</h1><p>按自己的节奏，完成四类思维练习。</p></div></div><div class="help-grid"><section class="help-card"><h2>时间平均分成四段</h2><p>先图形，再记忆，然后空间，最后文字。例如设置40分钟，每类10分钟。每段时间到后自动进入下一类，不会把剩余时间挪给其他类别。暂停时所有计时都会停止。</p></section><section class="help-card"><h2>答对升级，答错降级</h2><p>四类题各自从1档开始，答对升一档，答错或跳过降一档，范围为1–8档。如果该档没有可用题，会选择最近的档位。同一段练习优先避免重复题及重复情境。</p></section><section class="help-card"><h2>练习档位怎样确定</h2><p>1–8档是练习分档，综合原始难度、题目结构或估算结果，不是年龄常模或智商分数。每道题均保留原始难度依据。部分空间题的条件依赖英文，会同时展示英文原文；动画折纸题在本练习中只判断孔数。</p></section><section class="help-card"><h2>记录由你自己保管</h2><p>每次记录开始日期、实际用时、四类用时，以及逐题答案、正确与否、作答时长和档位变化。作答后自动保存；导出备份可以迁移设备，导入不会清除已有记录。站点不向服务器上传练习记录。</p></section><section class="help-card"><h2>记忆题怎么操作</h2><p>点击“开始记忆”后，等待方格或数字依次呈现，结束后再作答。方格题按顺序点击，数字题用空格分隔。位置绑定题先看目标图、等待间隔，再判断探测图是否相符。每次只呈现一遍，暂停可以停住进度。</p></section><section class="help-card"><h2>关闭页面也能继续</h2><p>练习中每秒保留进度检查点，回到网站后选择“继续练习”即可。记录里的实际用时不包含暂停或关闭网页的时间。浏览器无可用存储时会提示，避免开始一场无法保存的练习。</p></section></div><div class="section-heading"><h2>题库来源</h2><a class="quiet" href="attributions.html">完整许可与署名 →</a></div><div class="source-grid">${(bank?.sources ?? []).map((s) => `<div class="source-card"><a href="${safeLink(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a><p>${esc(s.license)}</p></div>`).join('')}</div>`, 'about');
}

function memoryStage(question, current, now = Date.now()) {
  if (current.presentationAtElapsed === null) return { phase: 'ready', key: 'ready' };
  const elapsed = Math.max(0, elapsedTime(session, now) - current.presentationAtElapsed);
  if (question.type === 'memory-binding') {
    const display = question.displayMs ?? 1995;
    const delay = question.delayMs ?? 995;
    if (elapsed < display) return { phase: 'target', key: 'target' };
    if (elapsed < display + delay) return { phase: 'hold', key: 'hold', left: display + delay - elapsed };
    return { phase: 'answer', key: 'answer' };
  }
  const lead = 600;
  const display = question.displayMs ?? 850;
  const interval = question.intervalMs ?? 250;
  if (elapsed < lead) return { phase: 'lead', key: 'lead' };
  const index = Math.floor((elapsed - lead) / (display + interval));
  if (index >= question.sequence.length) return { phase: 'answer', key: 'answer' };
  const lit = (elapsed - lead) % (display + interval) < display;
  return { phase: 'present', index, lit, key: `present-${index}-${lit}` };
}

function choiceButtons(question, draft, order, disabled = false) {
  const choices = order.map((id) => question.choices.find((c) => c.id === id)).filter(Boolean);
  const imageChoices = choices.every((c) => c.image);
  return `<div class="choices ${imageChoices ? 'image-choices' : ''}" role="group" aria-label="选择答案">${choices.map((choice, index) => `<button class="choice ${String(draft) === String(choice.id) ? 'selected' : ''}" data-action="choice" data-id="${esc(choice.id)}" aria-pressed="${String(draft) === String(choice.id)}" ${disabled ? 'disabled' : ''}><span class="choice-tag">${String.fromCharCode(65 + index)}</span>${choice.image ? `<img src="${safeAsset(choice.image)}" alt="选项${String.fromCharCode(65 + index)}" draggable="false">` : `<span>${esc(choice.text ?? choice.id)}</span>`}</button>`).join('')}</div>`;
}
function imageMarkup(path, alt = '题目图形', extra = '') {
  const src = safeAsset(path);
  return src ? `<img class="question-image ${extra}" src="${src}" alt="${esc(alt)}" data-action="zoom" data-src="${src}" loading="lazy"><p class="zoom-caption">点击图片可放大查看</p>` : '';
}

function memoryMarkup(question, current) {
  const stage = memoryStage(question, current);
  lastMemoryVisual = `${question.id}:${stage.key}`;
  const draft = Array.isArray(current.draft) ? current.draft : [];
  if (stage.phase === 'ready') return `<div class="memory-area"><span class="category-icon">${icons.memory}</span><h2>先看清，再记住</h2><p>${question.type === 'memory-binding' ? '看目标图，等待后判断字母与位置是否相符。' : `将依次呈现${question.sequence.length}个${question.type === 'memory-grid' ? '位置' : '数字'}，呈现结束后再作答。`}</p><button class="primary" data-action="begin-memory">开始记忆 ${arrow}</button></div>`;
  if (question.type === 'memory-binding') {
    if (stage.phase === 'target') return `<div class="memory-area"><div class="memory-status">记住字母与它的位置</div><img class="binding-image" src="${safeAsset(question.image)}" alt="请记住目标图中的字母与位置"></div>`;
    if (stage.phase === 'hold') return '<div class="memory-area"><span class="memory-digit" aria-label="请保持记忆">＋</span><div class="memory-status">在脑海中保留刚才的图形…</div></div>';
    return `<div class="memory-area"><div class="memory-status">这张探测图与记忆相符吗？</div><img class="binding-image" src="${safeAsset(question.probeImage)}" alt="探测图"></div>${choiceButtons(question, current.draft, current.choicesOrder)}`;
  }
  const answering = stage.phase === 'answer';
  if (question.type === 'memory-grid') {
    const value = stage.phase === 'present' && stage.lit ? question.sequence[stage.index] : null;
    return `<div class="memory-area"><div class="memory-status">${answering ? `按顺序点击 · 已选 ${draft.length} / ${question.sequence.length} 个位置` : stage.phase === 'lead' ? '准备…' : '记住方格亮起的顺序'}</div><div class="memory-grid" style="grid-template-columns:repeat(${question.gridColumns},1fr)" role="group" aria-label="记忆方格">${Array.from({ length: question.gridRows * question.gridColumns }, (_, i) => { const cell = i + 1; const picked = draft.lastIndexOf(cell); return `<button class="memory-cell ${value === cell ? 'lit' : ''} ${answering && picked >= 0 ? 'picked' : ''}" data-action="memory-cell" data-value="${cell}" aria-label="第${cell}格" ${answering ? '' : 'disabled'}>${answering && picked >= 0 ? draft.reduce((a, x, index) => x === cell ? [...a, index + 1] : a, []).join('·') : ''}</button>`; }).join('')}</div>${answering ? '<div class="memory-buttons"><button class="ghost" data-action="memory-undo">撤回一步</button><button class="ghost" data-action="memory-clear">重新选择</button></div>' : '<p class="quiet">呈现结束后，方格才可以点击</p>'}</div>`;
  }
  return `<div class="memory-area">${answering ? `<div class="memory-status">按出现顺序输入 ${question.sequence.length} 个数字</div><label class="answer-label" for="digit-answer">按出现顺序输入，使用空格或逗号分隔</label><input class="answer-input" id="digit-answer" autocomplete="off" inputmode="text" value="${esc(typeof current.draft === 'string' ? current.draft : '')}" aria-label="记忆数字答案">` : `<div class="memory-status">${stage.phase === 'lead' ? '准备…' : '记住数字出现的顺序'}</div><div class="memory-digit" role="status">${stage.phase === 'present' && stage.lit ? question.sequence[stage.index] : '·'}</div><p class="quiet">呈现结束后再输入</p>`}</div>`;
}

function constructionMarkup(question, current) {
  const selected = Array.isArray(current.draft) ? current.draft : [];
  return `<div class="construction-layout"><div>${imageMarkup(question.image, '待补全的矩阵')}</div><div><p class="quiet">右下角的组合</p><div class="construction-preview">${question.elements.filter((e) => selected.includes(e.id)).map((e) => `<img src="${safeAsset(e.image)}" alt="已选元素${Number(e.id) + 1}">`).join('')}</div></div></div><p class="quiet">点击下方元素加入组合，再点一次可取消。</p><div class="element-grid" role="group" aria-label="20个构图元素">${question.elements.map((element) => `<button class="element-button ${selected.includes(element.id) ? 'selected' : ''}" data-action="element" data-id="${esc(element.id)}" aria-label="构图元素${Number(element.id) + 1}" aria-pressed="${selected.includes(element.id)}"><img src="${safeAsset(element.image)}" alt="元素${Number(element.id) + 1}"></button>`).join('')}</div>`;
}

function formatAnswer(question, answer, order = []) {
  if (answer === null || answer === undefined) return '未作答';
  if (question.type === 'construction') return Array.isArray(answer) && answer.length ? `元素 ${answer.map((id) => Number(id) + 1).join('、')}` : '空白组合';
  if (['memory-grid', 'memory-digits'].includes(question.type)) return Array.isArray(answer) ? answer.join(' → ') : String(answer);
  if (question.type === 'folding-video') return `${answer} 个孔`;
  const choice = question.choices?.find((c) => String(c.id) === String(answer));
  if (!choice) return String(answer);
  const index = order.length ? order.indexOf(choice.id) : question.choices.indexOf(choice);
  return `${index >= 0 ? `${String.fromCharCode(65 + index)} · ` : ''}${choice.text && choice.text !== choice.id ? choice.text : choice.image ? '图形选项' : choice.id}`;
}
function feedbackMarkup(question, response) {
  const isCorrect = response.status === 'correct';
  const correctChoice = question.choices?.find((c) => String(c.id) === String(question.answer));
  return `<div class="feedback ${isCorrect ? '' : 'incorrect'}" role="status"><strong>${isCorrect ? '答对了' : response.status === 'skipped' ? '已跳过这道题' : '这道题再想一想'} · ${response.levelAfter > response.levelBefore ? '下一题提高一档' : response.levelAfter < response.levelBefore ? '下一题降低一档' : isCorrect ? '继续挑战最高档' : '继续从基础档练习'}</strong><p>正确答案：${esc(formatAnswer(question, question.answer, response.choicesOrder))}</p>${correctChoice?.image ? `<img src="${safeAsset(correctChoice.image)}" alt="正确图形" style="height:90px;margin-top:8px;background:white;border-radius:5px">` : ''}${question.answerImage ? `<details><summary>查看展开后的答案图</summary>${imageMarkup(question.answerImage, '展开后的孔位')}</details>` : ''}${question.explanation ? `<details><summary>查看解释</summary><p>${esc(typeof question.explanation === 'string' ? question.explanation : JSON.stringify(question.explanation))}</p></details>` : ''}<small>下题目标 ${response.levelAfter} / ${MAX_LEVEL} 档</small></div>`;
}

function questionBody(question, current) {
  const answered = current.answered;
  const response = answered ? session.responses.at(-1) : null;
  let content = '';
  if (answered) {
    if (question.image && !question.type.startsWith('memory')) content = imageMarkup(question.image, '题目图形', question.sourceId === 'mars_ib' ? 'matrix' : '');
    content += feedbackMarkup(question, response);
  } else if (question.type.startsWith('memory')) {
    content = memoryMarkup(question, current);
  } else if (question.type === 'construction') {
    content = constructionMarkup(question, current);
  } else if (question.type === 'folding-video') {
    content = `<video class="video-question" controls playsinline preload="metadata" data-question-video aria-label="折叠及打孔动画"><source src="${safeAsset(question.video)}" type="video/mp4"></video><label class="answer-label" for="hole-answer">完全展开后，一共有多少个孔？</label><input id="hole-answer" class="answer-input" type="number" inputmode="numeric" min="0" max="512" step="1" autocomplete="off" value="${esc(current.draft ?? '')}" aria-label="展开后的孔数">`;
  } else {
    content = (question.image ? imageMarkup(question.image, '题目图形', question.sourceId === 'mars_ib' ? 'matrix' : '') : '') + choiceButtons(question, current.draft, current.choicesOrder);
  }
  return `<p class="question-prompt">${esc(question.prompt)}</p>${question.promptNeedsOriginal ? `<div class="original-prompt"><b>原题条件（英文，作答时请一并参考）</b>\n${esc(question.originalPromptEn)}</div>` : ''}${content}`;
}

function renderSession() {
  if (!session) return home();
  const info = summarize(session);
  const currentCategory = CATEGORIES[Math.min(3, session.sectionIndex)];
  const question = getQuestion();
  const paused = session.status === 'paused';
  const current = session.current;
  const sectionInfo = info.sections[session.sectionIndex] ?? info.sections[3];
  const elapsed = elapsedTime(session);
  const sectionLeft = Math.max(0, (session.sectionIndex + 1) * session.sectionMs - elapsed);
  return `<div class="wrap"><header class="session-header">${logo()}<div class="overall-timer">全程剩余 <b class="timer" data-total-left>${clock(session.totalMs - elapsed)}</b></div><div class="session-actions"><button class="ghost" data-action="export-current">导出本次</button><button class="ghost" data-action="${paused ? 'unpause' : 'pause'}">${paused ? '继续计时' : '暂停'}</button><button class="ghost" data-action="finish">提前结束</button></div></header><main id="main"><div class="steps">${CATEGORIES.map((c, index) => `<div class="step ${index === session.sectionIndex ? 'active' : index < session.sectionIndex ? 'done' : ''}"><span><b>${c.number}</b>${c.name}</span><span>${index < session.sectionIndex ? '已结束' : duration(session.sectionMs)}</span></div>`).join('')}</div><div class="practice-layout"><section class="question-card">${paused ? `<div class="pause-surface"><span class="category-icon">${icons.pause}</span><h1>休息一下，进度已保存</h1><p>暂停期间不计入练习用时。<br>准备好了，就从刚才的地方继续。</p><button class="primary" data-action="unpause">继续练习 ${arrow}</button><div style="margin-top:12px"><button class="ghost" data-action="home">返回首页</button></div></div>` : question ? `<div class="question-heading"><div><h1>${currentCategory.name}</h1><div class="question-id">${esc(question.id)}</div></div><span class="level-badge">练习 ${question.level} / ${MAX_LEVEL} 档</span></div><div class="question-body" id="question-body">${questionBody(question, current)}</div><div class="question-actions"><button class="ghost" data-action="skip" ${current.answered ? 'disabled' : ''}>跳过这道题</button><span class="shortcut-hint">${question.type === 'choice' ? '可按 A–D 选择，Enter 提交' : 'Enter 提交答案'}</span><button class="primary" data-action="${current.answered ? 'next' : 'submit'}" id="submit-button">${current.answered ? `下一题 ${arrow}` : '提交答案'}</button></div>` : '<div class="loading-card">正在准备下一题…</div>'}</section><aside class="practice-side"><div class="timer-card"><div class="timer-label">${currentCategory.name} · 本段剩余</div><div class="timer" data-section-left>${clock(sectionLeft)}</div><div class="track"><span data-section-progress style="width:${Math.max(0, sectionLeft / session.sectionMs * 100)}%"></span></div><p class="quiet">时间到后自动进入${CATEGORIES[session.sectionIndex + 1]?.name ?? '练习总结'}</p></div><div class="side-card"><h3>本段作答</h3><div class="side-counts"><div><b class="good num">${sectionInfo.correct}</b><small>答对</small></div><div><b class="bad num">${sectionInfo.incorrect}</b><small>答错</small></div><div><b class="num">${sectionInfo.skipped}</b><small>跳过</small></div></div></div><div class="side-card"><h3>下题目标档位 ${session.levels[currentCategory.id]} / ${MAX_LEVEL}</h3><div class="level-ladder">${Array.from({ length: MAX_LEVEL }, (_, i) => `<span class="${i < session.levels[currentCategory.id] ? 'on' : ''}"></span>`).join('')}</div><p>答对升一档，答错降一档。<br>档位为练习估算，原始难度信息保留在逐题记录中。</p></div></aside></div></main>${footer()}</div>`;
}

function resultMarkup(record, isResult = false) {
  const info = summarize(record);
  return `<div class="${isResult ? 'result-heading' : 'page-heading'}"><div><div class="eyebrow">${isResult ? '每一题，都有记录' : '逐题回看'}</div><h1>${isResult ? '这次练习，已记录。' : dateLabel(record.startedAt)}</h1><p>${isResult ? `${dateLabel(record.startedAt)}开始 · ` : ''}计划 ${record.totalMs / 60000} 分钟，实际 ${duration(info.elapsedMs)} · ${statusText(record.status)}</p></div>${!isResult ? `<div class="button-row"><button class="secondary" data-action="export-one" data-id="${esc(record.id)}">导出本次</button><button class="ghost" data-action="delete-record" data-id="${esc(record.id)}">删除记录</button></div>` : ''}</div><div class="stats"><div class="stat"><div class="stat-label">答对</div><div class="stat-value" style="color:var(--green)">${info.correct}<small>道</small></div></div><div class="stat"><div class="stat-label">答错</div><div class="stat-value" style="color:var(--red)">${info.incorrect}<small>道</small></div></div><div class="stat"><div class="stat-label">有效作答正确率</div><div class="stat-value">${info.accuracy === null ? '—' : Math.round(info.accuracy * 100)}<small>${info.accuracy === null ? '' : '%'}</small></div></div></div><div class="result-sections">${info.sections.map((section) => `<article class="result-section"><span class="category-icon">${icons[section.id]}</span><h3 style="margin-top:12px">${section.name}</h3><div class="result-numbers">${section.correct}<small> 对 / ${section.incorrect} 错</small></div><p>${duration(section.timeMs)} · 最后目标 ${section.finalLevel} 档</p><div class="quiet">${section.skipped} 跳过 · ${section.unanswered} 未答</div></article>`).join('')}</div>`;
}
function results() {
  const record = sessions.find((s) => s.id === selectedSessionId) ?? session;
  if (!record) return home();
  return shell(`${resultMarkup(record, true)}<div class="button-row" style="margin-top:26px"><button class="primary" data-action="detail" data-id="${esc(record.id)}">查看逐题记录 ${arrow}</button><button class="secondary" data-action="home">回到首页</button><button class="ghost" data-action="export-one" data-id="${esc(record.id)}">导出本次</button></div><p class="history-note">跳过与未作答单独统计，不计入有效作答正确率。四类难度各自调整，正确率不直接代表能力高低。</p>`, 'history');
}
function reviewRecord(record, index) {
  const question = record.generatedQuestion ?? questions.get(record.questionId);
  const q = question ?? { id: record.questionId, type: record.type, prompt: '此题不在当前题库版本中，原作答记录仍保留。' };
  let media = '';
  if (q.image) media += imageMarkup(q.image, '原题图形', q.sourceId === 'mars_ib' ? 'matrix' : '');
  if (q.probeImage) media += `<p class="quiet">探测图</p>${imageMarkup(q.probeImage, '探测图')}`;
  if (q.video) media += `<video class="video-question" controls playsinline preload="none" src="${safeAsset(q.video)}" aria-label="原折纸动画"></video>`;
  if (q.answerImage) media += imageMarkup(q.answerImage, '展开后的答案图');
  if (q.type === 'construction') media += `<p class="quiet">构图元素（编号与作答时一致）</p><div class="element-grid">${q.elements.map((element, i) => `<figure class="review-element"><img src="${safeAsset(element.image)}" alt="构图元素${i + 1}"><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>`;
  if (q.type === 'choice' && q.choices?.some((c) => c.image)) media += `<div class="choices image-choices">${(record.choicesOrder?.length ? record.choicesOrder : q.choices.map((c) => c.id)).map((id, i) => { const choice = q.choices.find((c) => c.id === id); return choice ? `<div class="choice"><span class="choice-tag">${String.fromCharCode(65 + i)}</span><img src="${safeAsset(choice.image)}" alt="选项${String.fromCharCode(65 + i)}"></div>` : ''; }).join('')}</div>`;
  const explanation = typeof q.explanation === 'string' ? q.explanation : '';
  return `<details class="record-detail"><summary class="record-summary"><span class="summary-main"><span class="status-dot ${record.status}"></span><b>${String(index + 1).padStart(2, '0')}</b><span>${category(record.category).short} · ${statusText(record.status)}</span><span class="quiet">${record.presentedLevel}档 · ${duration(record.timeMs)}</span><span class="question-code">${esc(record.questionId)}</span></span><span class="quiet">展开 ↓</span></summary><div class="record-review"><p class="question-prompt">${esc(q.prompt)}</p>${q.promptNeedsOriginal ? `<div class="original-prompt">${esc(q.originalPromptEn)}</div>` : ''}${media}<div class="answer-comparison"><div><small>你的答案</small>${esc(formatAnswer(q, record.answer, record.choicesOrder))}</div><div><small>正确答案</small>${question ? esc(formatAnswer(q, q.answer, record.choicesOrder)) : '请参考原题库'}</div></div>${explanation ? `<p class="review-explanation">${esc(explanation)}</p>` : ''}<p class="quiet" style="margin-top:15px">来源：${esc(sourceName(record.sourceId))}<br>原始难度：${esc(q.originalDifficulty?.label_zh ?? '未提供')}<br>${esc(q.levelBasis ?? '练习估算')}<br>目标档位 ${record.levelBefore} → ${record.levelAfter}</p></div></details>`;
}
function detail() {
  const record = sessions.find((s) => s.id === selectedSessionId);
  if (!record) return history();
  const responses = record.responses.map((response, index) => ({ response, index })).filter(({ response }) => {
    if (recordFilter === 'all') return true;
    if (recordFilter === 'other') return ['skipped', 'unanswered'].includes(response.status);
    return response.status === recordFilter;
  });
  return shell(`<button class="ghost" data-action="history" style="margin-top:22px;padding-left:0">← 全部记录</button>${resultMarkup(record)}<div class="filter-row">${[['all', '全部题目'], ['incorrect', '只看答错'], ['correct', '只看答对'], ['other', '跳过与未答']].map(([value, label]) => `<button class="${recordFilter === value ? 'active' : ''}" data-action="record-filter" data-value="${value}">${label}</button>`).join('')}<span class="quiet">${responses.length} 条</span></div><div class="table-card">${responses.length ? responses.map(({ response, index }) => reviewRecord(response, index)).join('') : '<div class="empty"><p>当前筛选下没有题目。</p></div>'}</div>`, 'history');
}

function render() {
  root.innerHTML = ({ home, history, about, practice: renderSession, results, detail }[route] ?? home)();
  if (route === 'practice') {
    const video = root.querySelector('[data-question-video]');
    if (video && session.current?.videoTime) video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(session.current.videoTime, video.duration || 0); }, { once: true });
    if (session?.status === 'running') updateSubmitState();
  }
}

function updateSessionList(value) {
  const index = sessions.findIndex((s) => s.id === value.id);
  if (index < 0) sessions.unshift(value); else sessions[index] = value;
  sessions.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
function persist(force = true) {
  if (!session || !store) return;
  const snapshot = snapshotSession(session);
  try { saveCheckpoint(snapshot); } catch { toast('浏览器检查点空间不足，练习记录仍会尝试保存。请及时导出备份。'); }
  updateSessionList(snapshot);
  checkpointAt = Date.now();
  if (force || Date.now() - savedAt > 4500) {
    savedAt = Date.now();
    saveQueue = saveQueue.then(() => store.save(snapshot)).catch((error) => toast(`记录保存失败：${error.message}。请导出本次备份。`));
  }
}
function nextQuestion() {
  session = advanceSession(session);
  if (session.status === 'completed') return endView();
  const id = CATEGORIES[session.sectionIndex].id;
  let question = chooseQuestion(bank.categories[id], session, id, exposures);
  if (!question && id === 'memory') question = generatedMemory(session.levels[id]);
  if (!question) {
    question = chooseQuestion(bank.categories[id], { ...session, responses: [], current: null }, id, exposures);
    toast('本类题目已练过一遍，继续巩固相近档位。');
  }
  if (!question) { toast('此类题目暂不可用。进度已暂停。'); session = pauseSession(session); persist(); return render(); }
  session = beginQuestion(session, question);
  lastMemoryVisual = '';
  persist(); render();
}
function endView() {
  persist();
  selectedSessionId = session.id;
  route = 'results';
  render();
  window.scrollTo({ top: 0 });
}
function navigate(next) {
  if (session?.status === 'running') { session = pauseSession(session); persist(); }
  route = next;
  render();
  window.scrollTo({ top: 0 });
}
function getDraft(question) {
  if (question.type === 'memory-digits') return String(session.current.draft ?? '').trim().split(/[\s,，、;；]+/).filter(Boolean).map(Number);
  return session.current.draft;
}
function canSubmit(question) {
  if (!question || session.current?.answered || session.status !== 'running') return false;
  const current = session.current;
  if (question.type.startsWith('memory') && memoryStage(question, current).phase !== 'answer') return false;
  if (question.type === 'construction') return true;
  if (question.type === 'memory-grid') return Array.isArray(current.draft) && current.draft.length === question.sequence.length;
  if (question.type === 'memory-digits') {
    const draft = getDraft(question); return draft.length === question.sequence.length && draft.every(Number.isFinite);
  }
  if (question.type === 'folding-video') return current.draft !== null && current.draft !== '' && Number.isInteger(Number(current.draft)) && Number(current.draft) >= 0;
  return current.draft !== null && current.draft !== undefined;
}
function updateSubmitState() {
  const button = document.querySelector('#submit-button');
  if (button) button.disabled = !session.current?.answered && !canSubmit(getQuestion());
}
function answer(skipped = false) {
  if (session?.status !== 'running') return;
  const question = getQuestion();
  if (!question || (!skipped && !canSubmit(question))) return;
  const answerValue = skipped ? null : question.type === 'construction' ? (session.current.draft ?? []) : getDraft(question);
  const result = submitAnswer(session, question, answerValue, Date.now(), skipped);
  session = result.session;
  if (result.rejected) {
    if (session.status === 'completed') return endView();
    return nextQuestion();
  }
  exposures[question.id] = (exposures[question.id] ?? 0) + 1;
  persist(); render();
  document.querySelector('[data-action="next"]')?.focus({ preventScroll: true });
}
function tick() {
  if (route !== 'practice' || session?.status !== 'running') return;
  const elapsed = elapsedTime(session);
  if (Math.floor(elapsed / session.sectionMs) !== session.sectionIndex) {
    session = advanceSession(session);
    if (session.status === 'completed') return endView();
    toast(`现在进入${CATEGORIES[session.sectionIndex].name}，计时已开始。`);
    return nextQuestion();
  }
  document.querySelector('[data-total-left]')?.replaceChildren(clock(session.totalMs - elapsed));
  document.querySelector('[data-section-left]')?.replaceChildren(clock((session.sectionIndex + 1) * session.sectionMs - elapsed));
  const progress = document.querySelector('[data-section-progress]');
  if (progress) progress.style.width = `${Math.max(0, ((session.sectionIndex + 1) * session.sectionMs - elapsed) / session.sectionMs * 100)}%`;
  const question = getQuestion();
  if (question?.type.startsWith('memory') && !session.current.answered) {
    const stage = memoryStage(question, session.current);
    if (`${question.id}:${stage.key}` !== lastMemoryVisual) {
      const body = document.querySelector('#question-body');
      if (body) body.innerHTML = questionBody(question, session.current);
      updateSubmitState();
    }
  }
  if (Date.now() - checkpointAt > 1000) persist(false);
}

async function confirmDialog(title, body, label, onConfirm, destructive = false) {
  modal.className = 'modal';
  modal.innerHTML = `<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="button-row"><button class="ghost" data-action="close-modal">取消</button><button class="${destructive ? 'danger' : 'primary'}" id="modal-confirm">${esc(label)}</button></div>`;
  modal.showModal();
  modal.querySelector('#modal-confirm').addEventListener('click', async () => { modal.close(); await onConfirm(); }, { once: true });
}
function downloadBackup(records) {
  const data = { app: 'cognitive-practice', version: 1, exportedAt: new Date().toISOString(), sessions: records };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `思维练习记录-${dateKey(Date.now())}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${records.length} 次练习记录。`);
}

const actions = {
  home: () => navigate('home'), history: () => navigate('history'), about: () => navigate('about'),
  reload: () => location.reload(),
  duration: (element) => { minutes = Number(element.dataset.value); savePreferences({ minutes }); render(); },
  start: async () => {
    if (!bank || !store || activeCandidate()) return;
    const input = document.querySelector('#minutes');
    const value = input ? Number(input.value) : minutes;
    if (!Number.isInteger(value) || value < 4 || value > 180) return toast('请输入 4–180 之间的整数分钟数。');
    minutes = value; savePreferences({ minutes });
    session = createSession(minutes);
    route = 'practice'; nextQuestion();
    window.scrollTo({ top: 0 });
  },
  resume: (element) => {
    const found = sessions.find((s) => s.id === element.dataset.id);
    if (!found || !bank) return;
    session = resumeSession({ ...structuredClone(found), status: 'paused', anchorAt: null });
    route = 'practice';
    if (!session.current) return nextQuestion();
    if (!getQuestion()) {
      const current = session.current;
      session = submitAnswer(session, { id: current.questionId, category: current.category, type: current.type, sourceId: current.sourceId, level: current.presentedLevel }, null, Date.now(), true).session;
      return nextQuestion();
    }
    lastMemoryVisual = ''; persist(); render(); window.scrollTo({ top: 0 });
  },
  'stop-pending': (element) => confirmDialog('结束未完成的练习？', '已完成的作答和实际用时会保留在练习记录中。', '结束并保留记录', () => {
    session = finishSession(sessions.find((s) => s.id === element.dataset.id)); persist(); render();
  }),
  pause: () => { session = pauseSession(session); persist(); render(); },
  unpause: () => { session = resumeSession(session); persist(); render(); },
  finish: () => { session = pauseSession(session); persist(); render(); confirmDialog('现在结束这次练习？', '本次实际用时和已答题目都会保存。还没有完成的题目会单独标为未作答。', '结束并查看结果', () => { session = finishSession(session); endView(); }); },
  choice: (element) => { if (session?.status !== 'running' || session.current.answered) return; session.current.draft = element.dataset.id; render(); },
  element: (element) => { if (session?.status !== 'running' || session.current.answered) return; const selected = session.current.draft ?? []; session.current.draft = selected.includes(element.dataset.id) ? selected.filter((x) => x !== element.dataset.id) : [...selected, element.dataset.id]; render(); },
  'begin-memory': () => { if (session?.status !== 'running' || session.current.presentationAtElapsed !== null) return; session.current.presentationAtElapsed = elapsedTime(session); session.current.draft = getQuestion().type === 'memory-digits' ? '' : getQuestion().type === 'memory-binding' ? null : []; persist(); render(); },
  'memory-cell': (element) => { const q = getQuestion(); if (session?.status !== 'running' || session.current.answered || memoryStage(q, session.current).phase !== 'answer') return; const current = session.current.draft ?? []; if (current.length >= q.sequence.length) return toast('已选完全部位置，可以提交，或撤回一步。'); session.current.draft = [...current, Number(element.dataset.value)]; render(); },
  'memory-undo': () => { session.current.draft = (session.current.draft ?? []).slice(0, -1); render(); },
  'memory-clear': () => { session.current.draft = []; render(); },
  submit: () => answer(), skip: () => answer(true), next: () => nextQuestion(),
  detail: (element) => { selectedSessionId = element.dataset.id; recordFilter = 'all'; navigate('detail'); },
  'record-filter': (element) => { recordFilter = element.dataset.value; render(); },
  'clear-date': () => { dateFilter = ''; render(); },
  export: () => downloadBackup(sessions),
  'export-one': (element) => { const record = sessions.find((s) => s.id === element.dataset.id); if (record) downloadBackup([record]); },
  'export-current': () => { persist(); downloadBackup([snapshotSession(session)]); },
  import: () => document.querySelector('#import-file').click(),
  'delete-record': (element) => confirmDialog('删除这次练习记录？', '这只会删除当前浏览器里的这一条记录。若已经导出备份，仍可以重新导入。', '删除记录', async () => {
    await saveQueue; await store.remove(element.dataset.id);
    sessions = sessions.filter((s) => s.id !== element.dataset.id);
    if (session?.id === element.dataset.id) { session = null; localStorage.removeItem('cognitive-practice.checkpoint.v1'); }
    if (readCheckpoint()?.id === element.dataset.id) localStorage.removeItem('cognitive-practice.checkpoint.v1');
    route = 'history'; render(); toast('这次练习记录已删除。');
  }, true),
  zoom: (element) => { const src = safeAsset(element.dataset.src); if (!src) return; modal.className = 'modal image-modal'; modal.innerHTML = `<button class="ghost" data-action="close-modal">关闭 ×</button><img src="${src}" alt="放大的题目图形">`; modal.showModal(); },
  'close-modal': () => modal.close(),
};

document.addEventListener('click', async (event) => {
  const element = event.target.closest('[data-action]');
  if (!element || element.disabled) return;
  event.preventDefault();
  try { await actions[element.dataset.action]?.(element); } catch (error) { console.error(error); toast(error.message || '操作没有完成，请重试。'); }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'minutes') {
    const value = Number(event.target.value);
    if (Number.isInteger(value) && value >= 4 && value <= 180) {
      minutes = value;
      document.querySelectorAll('[data-section-duration]').forEach((node) => node.textContent = duration(minutes * 60000 / 4));
      document.querySelector('#start-label').textContent = `开始 ${minutes} 分钟练习`;
      document.querySelectorAll('.preset').forEach((node) => node.classList.toggle('selected', Number(node.dataset.value) === value));
      savePreferences({ minutes });
    }
  }
  if (['digit-answer', 'hole-answer'].includes(event.target.id) && session?.current && !session.current.answered) { session.current.draft = event.target.value; updateSubmitState(); }
});
document.addEventListener('change', async (event) => {
  if (event.target.id === 'date-filter') { dateFilter = event.target.value; render(); }
  if (event.target.id !== 'import-file') return;
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !store) return;
  if (file.size > 50 * 1024 * 1024) return toast('请选择 50 MB 以内的 JSON 备份文件。');
  try {
    await saveQueue;
    const count = await store.import(await file.text());
    sessions = await store.all();
    if (session && ['running', 'paused'].includes(session.status)) updateSessionList(snapshotSession(session));
    const pending = activeCandidate();
    if (pending) saveCheckpoint(pending);
    route = 'history'; render(); toast(`已导入或更新 ${count} 次练习记录。`);
  } catch (error) { toast(error.message); }
});
document.addEventListener('keydown', (event) => {
  if (route !== 'practice' || session?.status !== 'running' || modal.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  const q = getQuestion();
  if (key === 'enter') { event.preventDefault(); session.current.answered ? nextQuestion() : answer(); }
  else if (/^[a-d]$/.test(key) && q?.type === 'choice' && !session.current.answered) {
    const id = session.current.choicesOrder[key.charCodeAt(0) - 97];
    if (id) { session.current.draft = id; render(); }
  }
});
document.addEventListener('keydown', (event) => {
  if (['digit-answer', 'hole-answer'].includes(event.target.id) && event.key === 'Enter') { event.preventDefault(); answer(); }
});
document.addEventListener('timeupdate', (event) => {
  if (event.target.matches?.('[data-question-video]') && session?.current) session.current.videoTime = event.target.currentTime;
}, true);
window.addEventListener('pagehide', () => { if (session && ['running', 'paused'].includes(session.status)) persist(); });
window.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
modal.addEventListener('click', (event) => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close(); } });

async function boot() {
  render();
  const bankPromise = fetch('data/bank.json').then((response) => { if (!response.ok) throw new Error('题库加载失败，请检查网络后重试。'); return response.json(); });
  const storagePromise = openStore().then(async (value) => { store = value; sessions = await store.all();
    const checkpoint = readCheckpoint();
    if (checkpoint && (!sessions.some((s) => s.id === checkpoint.id) || sessions.find((s) => s.id === checkpoint.id).updatedAt <= checkpoint.updatedAt)) { updateSessionList(checkpoint); await store.save(checkpoint); }
    sessions = sessions.map((s) => s.status === 'running' ? { ...s, status: 'paused', anchorAt: null } : s);
  }).catch((error) => { storageError = `记录存储暂不可用：${error.message}`; store = null; });
  await Promise.all([bankPromise.then((value) => { bank = value;
    for (const list of Object.values(bank.categories)) for (const q of list) questions.set(q.id, q);
  }).catch((error) => { loadError = error.message; }), storagePromise]);
  for (const record of sessions) for (const response of record.responses) exposures[response.questionId] = (exposures[response.questionId] ?? 0) + 1;
  render();
  setInterval(tick, 150);
}
boot();
