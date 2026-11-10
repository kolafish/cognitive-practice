import {
  CATEGORIES, MAX_LEVEL, elapsedTime, advanceSession, pauseSession, resumeSession,
  finishSession, snapshotSession, chooseQuestion, generatedMemory, beginQuestion, submitAnswer,
  summarize, trainingDurations, sectionTiming, sectionIndexAt, memoryDisplayDuration, memoryStage as computeMemoryStage,
} from './engine.js';
import { openStore, readCheckpoints, clearCheckpoint, saveCheckpoint, readPreferences, savePreferences, readActiveUser, saveActiveUser } from './storage.js';
import { MODES, MEMORY_FAMILIES, familyName, taskFamily, targetLevel, presentedLevel, isMatrixVariant, isUnratedMatrix, isPrivateMatrixAsset, isPrivateFigureAsset, maximumLevel } from './practice.js';
import { openMatrixStore, northMatrixQuestions } from './matrix-pack.js';
import { MAX_FIGURE_PACK_BYTES, FIGURE_FAMILIES, northFigureQuestions, parseFigurePack, openFigureStore } from './figure-pack.js';

import { LEVEL_POINTS, levelPoints, recordScore, scoreByFamily } from './scoring.js';

import { createUserSession, rememberSession, mergeProfiles, selectUserQuestion, selectUserMemory, selectNorthFigure, memorySignature, userBackup, usernameIdentity } from './profiles.js';

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
function safeAsset(value) {
  if (isPrivateFigureAsset(value)) {
    const [, packId, filename] = value.split('/');
    const file = localFigurePacks.find((pack) => pack.id === packId)?.files.get(filename.slice(0, -4));
    if (!file) return '';
    if (!figureUrls.has(value)) figureUrls.set(value, URL.createObjectURL(file));
    return figureUrls.get(value);
  }
  if (isPrivateMatrixAsset(value)) {
    const [, packId, filename] = value.split('/');
    const file = packId === localMatrixPack?.id && localMatrixPack.files.get(filename.slice(0, -4));
    if (!file) return '';
    if (!matrixUrls.has(value)) matrixUrls.set(value, URL.createObjectURL(file));
    return matrixUrls.get(value);
  }
  return typeof value === 'string' && /^assets\/[a-zA-Z0-9/_\-.]+$/.test(value) && !value.split('/').includes('..') ? value : '';
}
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
let practiceBank = null;
let store = null;
let sessions = [];
let allSessions = [];
let profiles = [];
let currentProfile = null;
let viewingLegacy = false;
let bootReady = false;
let session = null;
let route = 'home';
let selectedSessionId = null;
let recordFilter = 'all';
let dateFilter = '';
let minutes = readPreferences().minutes;
let practiceMode = readPreferences().mode;
let loadError = '';
let storageError = '';
let savedAt = 0;
let checkpointAt = 0;
let lastMemoryVisual = '';
let toastTimer;
let saveQueue = Promise.resolve();
const questions = new Map();
const practiceQuestions = new Map();
let matrixStore, localMatrixPack, matrixOwner;
let matrixQuestions = [];
let matrixStandaloneSeen = new Set();
const matrixUrls = new Map();
let figureStore, figureOwner;
let localFigurePacks = [], localFigureQuestions = [];
const figureUrls = new Map();
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
  return `<header class="header">${logo()}<nav class="nav" aria-label="主要导航"><button data-action="home" class="${active === 'home' ? 'active' : ''}" ${active === 'home' ? 'aria-current="page"' : ''}>开始练习</button><button data-action="history" class="${active === 'history' ? 'active' : ''}" ${active === 'history' ? 'aria-current="page"' : ''}>练习记录</button><button data-action="about" class="${active === 'about' ? 'active' : ''}" ${active === 'about' ? 'aria-current="page"' : ''}>说明</button></nav><button class="user-button" data-action="users">${currentProfile ? `<span class="user-initial">${esc(Array.from(currentProfile.username)[0])}</span><span class="user-name">${esc(currentProfile.username)}</span><small>切换</small>` : '输入用户名'}</button></header>`;
}
function footer() {
  return '<footer class="footer"><div>每一次专注，都留下一点进步。<span class="num"> THINKING ROOM</span></div><div>记录仅保存在当前浏览器 · <a href="attributions.html">题库来源与许可</a> · 非商业练习</div></footer>';
}
function shell(content, active = route) { return `<div class="wrap">${header(active)}<main id="main" class="fade-in">${content}</main>${footer()}</div>`; }
function sourceName(id) {
  return practiceBank?.sources.find((s) => s.id === id)?.name ?? bank?.sources.find((s) => s.id === id)?.name
    ?? ({ generated: '练习生成', 'generated-north': '原创视觉记忆练习', 'local-mars-variant': '本地 MaRs-IB 变式', 'local-sandia': '本地 Sandia 矩阵', 'local-figure-rules': '本地筛选图形规律题' }[id] ?? id);
}
function modeName(record) { return MODES[record?.practiceMode] ?? MODES.legacy; }
function getQuestion(current = session?.current, parent = session) { return current?.generatedQuestion ?? current?.questionSnapshot ?? (parent?.practiceMode === 'north' ? practiceQuestions.get(current?.questionId) : null) ?? questions.get(current?.questionId); }
function questionFamilyName(question) { return question?.taskFamilyName ?? familyName(taskFamily(question)); }
function savePrefs() { savePreferences({ minutes, mode: practiceMode }, currentProfile?.id); }
function activeCandidate() { return sessions.find((s) => ['paused', 'running'].includes(s.status)); }

function legacyRecords() { return allSessions.filter((s)=>!s.userId); }
function visibleRecords() { return viewingLegacy ? legacyRecords() : sessions; }
function profileSummary() {
  if (!currentProfile) return '';
  const levels = Object.entries(currentProfile.levels[practiceMode]);
  return `<section class="profile-summary"><div><span class="eyebrow">${esc(currentProfile.username)} 的练习档案</span><p>已出 ${number(currentProfile.seenQuestions.length)} 道固定题 · ${number(currentProfile.memoryPatterns.length)} 种记忆图案或序列</p></div><div class="profile-levels">${levels.length ? levels.map(([family,state])=>`<span>${esc(familyName(family))} <b>${state.level}档</b></span>`).join('') : '<span>首次练习，各小题型从1档开始</span>'}</div><p class="quiet">新练习沿用个人难度，优先出未见题；新题用尽后可主动开启复习。</p></section>`;
}
function users() {
  return shell(`<section class="user-entry"><div class="eyebrow">本地用户档案</div><h1>输入名字，接着练。</h1><p class="lead">无需密码或验证。相同用户名会进入同一份档案，保存已做题目、难度与未完成进度。</p><form id="user-form" class="user-form"><label for="username">用户名</label><div><input id="username" name="username" maxlength="24" autocomplete="username" placeholder="例如：小明" required ${!bootReady || !store ? 'disabled' : ''}><button class="primary" type="submit" ${!bootReady || !store ? 'disabled' : ''}>进入练习 ${arrow}</button></div><p class="quiet">中文、字母或数字，最多24个字符；英文字母不区分大小写。</p></form>${storageError ? `<div class="error-banner">${esc(storageError)}</div>` : ''}${profiles.length ? `<div class="saved-users"><h2>这台设备上的用户</h2><div>${profiles.map((profile)=>`<button class="saved-user" data-action="enter-user" data-name="${esc(profile.username)}"><span class="user-initial">${esc(Array.from(profile.username)[0])}</span><span>${esc(profile.username)}<small>${number(profile.seenQuestions.length)} 道固定题 · 继续个人进度</small></span>${arrow}</button>`).join('')}</div></div>` : ''}<div class="user-entry-notes"><p>档案仅保存在当前浏览器。同名即视为同一用户；不同孩子请使用不同名字。换设备时可导出、导入备份。</p><div class="button-row"><button class="secondary" data-action="import">导入备份</button>${legacyRecords().length ? `<button class="ghost" data-action="legacy">查看未归属记录（${legacyRecords().length}条）</button>` : ''}${currentProfile ? '<button class="ghost" data-action="home">返回当前用户</button>' : ''}</div></div></section>`, 'users');
}
function scoringNotice(info = null) {
  return `<p class="score-notice">训练积分：答对得实际档位 × 10分，其余0分。各题型难度未统一校准；积分受题量、时长和题型影响。${info?.hasEstimated ? '<br>含历史回算：依据旧记录的实际出题档位计算，未改写旧记录。' : ''}</p>`;
}
function sandiaStats(info) {
  if (!info.unrated) return '';
  const { correct, incorrect, skipped, unanswered, timeMs } = info.unrated;
  return `<p class="quiet">Sandia 单列 · ${correct} 对 / ${incorrect} 错 · ${skipped} 跳过 · ${unanswered} 未答 · ${duration(timeMs)} · 不计积分及总体正确率</p>`;
}
function familyScoresMarkup(record) {
  const families = scoreByFamily(record, getQuestion);
  if (!families.length) return '';
  return `<details class="family-breakdown" open><summary>按小题型查看表现 <span>${families.length} 种 · 各档正确率与题量</span></summary><p class="quiet">每种题型分别观察。正确率为答对 ÷ 有效作答，跳过和未答另列；题量少时不宜据此判断稳定水平。</p><div class="family-score-grid">${families.map((family)=>{
    if (!family.levels.length) return `<article class="family-score-card"><h3>${esc(family.name)}</h3><p>${family.correct} 对 / ${family.incorrect} 错 · ${family.accuracy === null ? '尚无有效作答' : `正确率 ${Math.round(family.accuracy * 100)}%`}</p><div class="family-score-notes">${family.skipped} 跳过 · ${family.unanswered} 未答 · 未分档，不计积分</div></article>`;
    const available = family.id.startsWith('figure-') ? [1, 2, 3, 4] : family.id === 'matrix-variant' ? [4] : record.practiceMode === 'north' ? practiceBank?.stats.byTaskFamily[family.id]?.levels : null;
    return `<article class="family-score-card"><div class="family-score-heading"><h3>${esc(family.name)}</h3><span>${number(family.points)}<small>积分</small></span></div><p>${family.correct} 对 / ${family.incorrect} 错 · ${family.accuracy === null ? '尚无有效作答' : `正确率 ${Math.round(family.accuracy * 100)}%`}</p><div class="level-score-grid">${family.levels.map((bucket)=>{
      const attempted = bucket.correct + bucket.incorrect;
      const unavailable = available && !available.includes(bucket.level);
      return `<div class="level-score-cell ${attempted ? 'has-results' : ''}" title="${bucket.level}档：${bucket.correct}对、${bucket.incorrect}错、${bucket.skipped}跳过、${bucket.unanswered}未答"><small>${bucket.level}档</small><b>${attempted ? Math.round(bucket.correct / attempted * 100) + '%' : '—'}</b><span>${attempted ? `${bucket.correct}/${attempted}题` : unavailable ? '本库无题' : '尚未作答'}</span></div>`;
    }).join('')}</div><div class="family-score-notes">新题 ${family.newPoints}分 · 复习 ${family.reviewPoints}分${family.hasEstimated ? ` · 历史回算 ${family.legacyPoints}分` : ''}<br>${family.skipped} 跳过 · ${family.unanswered} 未答</div></article>`;
  }).join('')}</div></details>`;
}
function home() {
  if (!currentProfile) return users();
  const pending = activeCandidate();
  const timings = trainingDurations(minutes * 60000);
  const selectedBank = practiceMode === 'north' ? practiceBank : bank;
  const descriptions = practiceMode === 'north' ? {
    figure: '矩阵与本地规律题，练位置、样式、属性和数量变化。',
    memory: '整幅图展示1秒，练位置记忆、图案辨认与对称判断。',
    spatial: '折纸后打孔，判断展开后的孔位与镜像关系。',
    verbal: '从条件推断顺序，分辨常用词语之间的关系。',
  } : Object.fromEntries(CATEGORIES.map((c) => [c.id, c.description]));
  const counts = (id) => !selectedBank ? '准备中' : practiceMode === 'north' && id === 'memory' ? '按档位随机生成' : `${number(selectedBank.categories[id].length + (practiceMode === 'north' && id === 'figure' ? localFigureQuestions.length : 0))} 道题`;
  return shell(`
    ${profileSummary()}
    <p class="matrix-home-entry"><a class="secondary" href="matrix.html">矩阵补充练习 →</a>${matrixQuestions.length ? '<span class="quiet">本地题包已加入北中主练的图形段</span>' : ''}</p>
    ${figurePackMarkup()}
    ${pending ? `<section class="resume-banner"><div><strong>还有一段练习，可以接着完成</strong><p>${dateLabel(pending.startedAt)}开始 · ${esc(modeName(pending))} · 已练习 ${duration(pending.elapsedMs)}</p></div><div class="button-row"><button class="ghost" data-action="stop-pending" data-id="${esc(pending.id)}">结束这次</button><button class="primary" data-action="resume" data-id="${esc(pending.id)}">继续练习 ${arrow}</button></div></section>` : ''}
    ${loadError ? `<div class="error-banner">${esc(loadError)} <button class="ghost" data-action="reload">重新加载</button></div>` : ''}
    ${storageError ? `<div class="error-banner">${esc(storageError)}</div>` : ''}
    <section class="hero"><div><div class="eyebrow">四类能力 · 自适应练习</div><h1>从一小步开始，<br>让思维慢慢展开。</h1><p class="lead">选择一段专注的时间。图形、记忆、空间与文字依次练习，每种小题型独立调整难度。</p><div class="hero-notes"><span>${icons.clock}7∶2∶3∶3 训练配比</span><span>${icons.save}逐题记录，随时回看</span></div></div><div class="hero-art" aria-hidden="true">${CATEGORIES.map((c) => `<div class="art-card">${icons[c.id]}<small>${c.name}</small></div>`).join('')}<div class="art-tag"><b>逐步进阶</b>${currentProfile ? '沿用个人难度' : '从简单题开始'}</div></div></section>
    <section class="mode-section"><div class="mode-picker" role="group" aria-label="练习题库">${['north', 'extended'].map((mode) => `<button class="mode-option ${practiceMode === mode ? 'selected' : ''}" data-action="mode" data-value="${mode}" aria-pressed="${practiceMode === mode}"><strong>${MODES[mode]}</strong><span>${mode === 'north' ? '贴近四类机考能力' : '完整题库，拓宽思路'}</span></button>`).join('')}</div><p class="quiet mode-note">${practiceMode === 'north' ? '按公开反馈筛选的专项练习，含原创视觉记忆；不是真题或官方考试复刻。' : '保留原有完整题库，包括矩阵构图、数字序列、旋转、立方体与动画孔数等。'}</p></section>
    <section><div class="section-heading"><h2>四段专注，一次完整练习</h2><span class="quiet">${selectedBank ? `${number(selectedBank.stats.total + (practiceMode === 'north' ? localFigureQuestions.length : 0))} 道${practiceMode === 'north' ? '精选题 + 随机视觉记忆' : '题已就绪'}` : '正在加载题库…'}</span></div><div class="category-grid">${CATEGORIES.map((c, index) => `<article class="category-card"><div class="category-top"><span class="category-icon">${icons[c.id]}</span><span class="category-number">${c.number}</span></div><h3>${c.name}</h3><p>${descriptions[c.id]}</p><div class="category-foot"><span>${counts(c.id)}</span><b data-section-duration="${index}">${duration(timings[index])}</b></div></article>`).join('')}</div></section>
    <section class="setup"><div><h2>这次，留多少时间给自己？</h2><div class="preset-row">${[50, 60, 90].map((value) => `<button data-action="duration" data-value="${value}" class="preset ${minutes === value ? 'selected' : ''}">${value} 分钟</button>`).join('')}<label class="custom-duration">自定义 <input id="minutes" type="number" min="4" max="180" step="1" value="${minutes}" aria-label="总练习分钟数"> 分钟</label></div><p class="quiet">按 7∶2∶3∶3 分配时间（模拟训练方案）。${practiceMode === 'north' ? '记忆题整幅图展示1秒，再在本段剩余时间内作答。' : '记忆序列逐项展示1秒；位置绑定题目标图展示1秒。'}</p></div><div class="setup-action"><button class="primary start-button" data-action="start" ${!bank || !practiceBank || !store || pending ? 'disabled' : ''}><span id="start-label">${selectedBank ? `开始 ${minutes} 分钟练习` : '正在准备题库…'}</span>${arrow}</button><p class="quiet">${pending ? '先继续或结束未完成的练习' : '可以暂停 · 关闭页面后可恢复进度'}</p></div></section>
  `, 'home');
}

function history() {
  if (!currentProfile && !viewingLegacy) return users();
  const records = visibleRecords();
  const filtered = records.filter((s) => !dateFilter || dateKey(s.startedAt) === dateFilter);
  const stats = records.map((s) => summarize(s));
  const totalTime = stats.reduce((sum, s) => sum + s.elapsedMs, 0);
  const totalCorrect = stats.reduce((sum, s) => sum + s.correct, 0);
  const totalPoints = stats.reduce((sum,s)=>sum+s.points,0);
  const estimatedPoints = stats.reduce((sum,s)=>sum+s.legacyPoints,0);
  return shell(`<div class="page-heading"><div><div class="eyebrow">记录自己的节奏</div><h1>${viewingLegacy ? '未归属记录' : esc(currentProfile.username) + '的练习记录'}</h1><p>哪天练了多久，每道题的答案，都在这里。</p></div><div class="button-row"><button class="secondary" data-action="import">导入备份</button><button class="primary" data-action="export" ${!records.length && (viewingLegacy || !currentProfile) ? 'disabled' : ''}>导出${viewingLegacy ? '这些记录' : '当前用户'}</button></div></div>
    ${viewingLegacy ? `<section class="resume-banner"><div><strong>这些旧记录尚未归入用户名</strong><p>旧记录的答案、难度和未完成进度都已保留。</p></div>${currentProfile ? `<button class="primary" data-action="claim-legacy">归入 ${esc(currentProfile.username)}</button>` : '<button class="primary" data-action="users">先选择用户名</button>'}</section>` : legacyRecords().length ? `<section class="resume-banner"><div><strong>另有 ${legacyRecords().length} 条未归属旧记录</strong><p>可先查看，再决定是否归入当前用户。</p></div><button class="secondary" data-action="legacy">查看旧记录</button></section>` : ''}
    <div class="stats four-stats"><div class="stat"><div class="stat-label">记录内训练积分</div><div class="stat-value">${number(totalPoints)}<small>分</small></div>${estimatedPoints ? `<div class="stat-note">含历史回算 ${number(estimatedPoints)}分</div>` : ''}</div><div class="stat"><div class="stat-label">累计练习</div><div class="stat-value">${records.length}<small>次</small></div></div><div class="stat"><div class="stat-label">累计专注</div><div class="stat-value">${Math.floor(totalTime / 60000)}<small>分钟</small></div></div><div class="stat"><div class="stat-label">累计答对</div><div class="stat-value">${totalCorrect}<small>道</small></div></div></div>
    <div class="filter-row"><span class="quiet">${dateFilter ? `${dateFilter} 的记录` : '全部练习'}</span><label class="date-filter">按日期查看 <input id="date-filter" type="date" value="${esc(dateFilter)}" aria-label="筛选练习日期">${dateFilter ? '<button data-action="clear-date">显示全部</button>' : ''}</label></div>
    <div class="table-card">${filtered.length ? `<table class="records-table"><thead><tr><th>练习时间（北京时间）</th><th>实际用时</th><th>作答情况</th><th>状态</th><th></th></tr></thead><tbody>${filtered.map((s) => { const info = summarize(s); return `<tr><td><span class="num">${dateLabel(s.startedAt)}</span><div class="quiet">${esc(modeName(s))} · 计划 ${s.totalMs / 60000} 分钟</div></td><td class="num">${duration(info.elapsedMs)}</td><td><div class="record-points">${number(info.points)}<small>训练积分${info.hasEstimated ? ' · 含回算' : ''}</small></div><span style="color:var(--green)">${info.correct} 对</span> / <span style="color:var(--red)">${info.incorrect} 错</span><div class="quiet">${info.skipped} 跳过 · ${info.unanswered} 未答</div></td><td><span class="pill ${s.status}">${statusText(s.status)}</span></td><td><button class="ghost" data-action="detail" data-id="${esc(s.id)}">查看 →</button></td></tr>`; }).join('')}</tbody></table>` : `<div class="empty">${icons.verbal}<h2>${dateFilter ? '这一天还没有练习记录' : '第一段专注，从这里开始'}</h2><p>${dateFilter ? '可以选择其他日期，或显示全部记录。' : '完成练习后，会自动保存用时与逐题结果。'}</p>${!dateFilter ? '<button class="primary" data-action="home">开始一次练习</button>' : ''}</div>`}</div><p class="history-note">积分按当前保留的记录汇总；删除记录会移除相应积分，已学难度和去重清单仍保留。记录保存在当前浏览器，清理站点数据会清除记录。导出 JSON 备份后，可以在另一台设备导入；相同记录会按更新时间合并。</p>
  `, 'history');
}

function about() {
  return shell(`<div class="page-heading"><div><div class="eyebrow">轻松上手</div><h1>怎样练，怎样记录</h1><p>按自己的节奏，完成四类思维练习。</p></div></div><div class="help-grid"><section class="help-card score-help"><h2>训练积分怎样算</h2><p>按题目实际出题档位计分，不按下一题目标档位计分。答对得档位×10分，答错、跳过、未答0分，不扣分；没有固定满分或通过线。新题与复习积分分开，旧记录按现行规则回算并标注，原答案与难度记录保留。</p><div class="score-rule-grid">${LEVEL_POINTS.map((points,index)=>`<div><small>${index+1}档</small><b>${points}<span>分</span></b></div>`).join('')}</div><p>这是一套奖励规则。积分受题量、时长与题型影响，不代表统一能力分数。回看进步时，优先观察同一题型、同一档位的正确率与作答题量。</p></section><section class="help-card"><h2>现在有几档，能互相比吗</h2><p>新增本地图形规律按位置、样式、属性、数量分别维护1–4档，不继承矩阵档位。既有小题型维护1–8目标档。北中主练的矩阵选择、三种视觉记忆、动画孔位、条件排序和词语关系均覆盖1–8档；静态折纸实际只有1、4、7档，缺档时选最近可用档位。例如目标3档抽到4档题，答对得40积分。</p><p>这些档位由各题型分别估算，尚未跨题型校准。词语8档、矩阵8档与记忆8档不代表相同的能力水平。<a href="https://www.ets.org/Media/Research/pdf/RD_Connections6.pdf" target="_blank" rel="noopener noreferrer">参考：ETS对不同测验分数比较的说明</a>。</p></section><section class="help-card"><h2>用用户名保存个人进度</h2><p>无需验证，同一浏览器内输入相同用户名即可进入同一份档案，英文字母不区分大小写。不同用户的记录、未完成练习与难度独立保存。新练习沿用上次各小题型的目标档位，主练和拓展分别保存。换设备需要导出、导入备份。</p></section><section class="help-card"><h2>已见题怎样去重</h2><p>同一用户优先排除曾经出过的固定题和同情境变式，随机记忆也按图案或序列避重；当前档位没有新题时选择最近的可用档位。本类新题用尽会提示，可主动开启复习。删除一次练习记录仍保留去重清单与档位。</p></section><section class="help-card"><h2>按模拟训练配比分配时间</h2><p>默认50分钟：图形23分20秒、记忆6分40秒、空间10分钟、文字10分钟。其他总时长按7∶2∶3∶3缩放；60分钟分别为28、8、12、12分钟。每段到时自动切换，暂停停止计时。这是模拟训练配比，不代表官方考试安排；旧版练习沿用创建时的时间方案。</p></section><section class="help-card"><h2>答对升级，答错降级</h2><p>新用户的每种小题型从1档开始，后续练习沿用个人档位；答对升一档，答错或跳过降一档，既有题型范围为1–8档，本地图形规律题为独立的1–4档。例如位置记忆做对，不会提高对称判断的起始档位。如果该档没有可用题，会选择最近的档位。同一段交替练习不同小题型，优先避免重复题及重复情境；旧记录继续沿用原有规则。</p></section><section class="help-card"><h2>练习档位怎样确定</h2><p>1–8档是练习分档，综合原始难度、题目结构或估算结果，不是年龄常模或智商分数。每道题均保留原始难度依据。北中主练按相关性筛题，保留图形选择、折纸孔位、条件排序与常用词关系；原有完整题库保存在拓展练习。部分档位题量不足时会用最近档位。</p></section><section class="help-card"><h2>记录由你自己保管</h2><p>每次记录开始日期、实际用时、四类用时，以及逐题答案、正确与否、作答时长和档位变化。作答后自动保存；导出备份可以迁移设备，导入不会清除已有记录。站点不向服务器上传练习记录。</p></section><section class="help-card"><h2>记忆题怎么操作</h2><p>北中主练包含位置记忆、图案辨认、对称判断，整幅黑白方格图同时展示1秒，图形消失后作答。位置题选全所有黑格，顺序不限；辨认题四选一；对称题按题干指定的中线判断。题目由本程序原创生成，不是考试真题。拓展练习保留逐项序列与位置绑定题。暂停可以停住进度。</p></section><section class="help-card"><h2>关闭页面也能继续</h2><p>练习中每秒保留进度检查点，回到网站后选择“继续练习”即可。记录里的实际用时不包含暂停或关闭网页的时间。浏览器无可用存储时会提示，避免开始一场无法保存的练习。</p></section></div><div class="section-heading"><h2>题库来源</h2><a class="quiet" href="attributions.html">完整许可与署名 →</a></div><div class="source-grid">${(bank?.sources ?? []).map((s) => `<div class="source-card"><a href="${safeLink(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a><p>${esc(s.license)}</p></div>`).join('')}</div>`, 'about');
}

function memoryStage(question, current, now = Date.now()) {
  return computeMemoryStage(session, question, current, now);
}

function choiceButtons(question, draft, order, disabled = false) {
  const choices = order.map((id) => question.choices.find((c) => c.id === id)).filter(Boolean);
  const imageChoices = choices.every((c) => c.image || c.cells);
  return `<div class="choices ${imageChoices ? 'image-choices' : ''} ${question.type === 'folding-choice' || question.type === 'memory-recognition' ? 'large-choices' : ''} ${isUnratedMatrix(question) ? 'numbered-choices' : ''}" role="group" aria-label="选择答案">${choices.map((choice, index) => {
    const label = isUnratedMatrix(question) ? String(index + 1) : String.fromCharCode(65 + index);
    return `<button class="choice ${String(draft) === String(choice.id) ? 'selected' : ''}" data-action="choice" data-id="${esc(choice.id)}" aria-label="选项${label}${choice.image || choice.cells || isUnratedMatrix(question) ? '' : `：${esc(choice.text ?? choice.id)}`}" aria-pressed="${String(draft) === String(choice.id)}" ${disabled ? 'disabled' : ''}><span class="choice-tag">${label}</span>${isUnratedMatrix(question) ? '' : choiceContent(question, choice, `选项${label}`)}</button>`;
  }).join('')}</div>`;
}
function choiceContent(question, choice, label = '图形') {
  if (choice.cells) return patternGrid(question, choice.cells, { mini: true, label });
  if (choice.image) return croppedImage(choice.image, choice.imageCrop, label);
  return `<span>${esc(choice.text ?? choice.id)}</span>`;
}
function croppedImage(path, crop, label) {
  const src = safeAsset(path);
  if (!src) return '';
  if (crop && ['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'].every((key) => Number.isFinite(crop[key]) && crop[key] >= 0 && crop[key] <= 20000) && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= crop.sourceWidth && crop.y + crop.height <= crop.sourceHeight) {
    return `<svg class="cropped-image" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" role="img" aria-label="${esc(label)}"><image href="${src}" width="${crop.sourceWidth}" height="${crop.sourceHeight}"/></svg>`;
  }
  return `<img src="${src}" alt="${esc(label)}" draggable="false">`;
}
function patternGrid(question, cells, { interactive = false, mini = false, label = '黑白方格图案' } = {}) {
  const marked = new Set(cells);
  const rows = question.gridRows, columns = question.gridColumns;
  return `<div class="visual-grid ${mini ? 'mini-grid' : ''} ${interactive ? 'interactive-grid' : ''}" style="--columns:${columns};--rows:${rows}" role="${interactive ? 'group' : 'img'}" aria-label="${esc(label)}">${Array.from({ length: rows * columns }, (_, i) => {
    const value = i + 1, active = marked.has(value);
    return interactive ? `<button class="visual-cell ${active ? 'marked' : ''}" data-action="visual-cell" data-value="${value}" aria-label="第${Math.floor(i / columns) + 1}行第${i % columns + 1}列" aria-pressed="${active}"></button>` : `<span class="visual-cell ${active ? 'marked' : ''}" aria-hidden="true"></span>`;
  }).join('')}</div>`;
}
function visualMemoryMarkup(question, current, stage) {
  if (stage.phase === 'ready') return `<div class="memory-area"><span class="category-icon">${icons.memory}</span><h2>准备好，再开始</h2><p>整幅图同时展示 1 秒，消失后再作答。</p><p class="quiet">${question.type === 'memory-positions' ? `记住全部${question.cells.length}个黑格，顺序不限。` : question.type === 'memory-symmetry' ? `留意${question.axis === 'vertical' ? '竖直' : '水平'}中线两侧是否对称。` : '记住图案，稍后从四幅图中选出原图。'}</p><button class="primary" data-action="begin-memory">开始记忆 ${arrow}</button></div>`;
  if (stage.phase === 'lead') return '<div class="memory-area visual-memory"><div class="memory-status">准备…</div><span class="memory-digit" aria-label="即将展示">＋</span></div>';
  if (stage.phase === 'target') return `<div class="memory-area visual-memory"><div class="memory-status">${question.type === 'memory-symmetry' ? `判断${question.axis === 'vertical' ? '竖直' : '水平'}中线对称` : '记住这幅图'}</div>${patternGrid(question, question.cells, { label: '请记住整幅黑白图案' })}</div>`;
  if (question.type === 'memory-positions') {
    const draft = Array.isArray(current.draft) ? current.draft : [];
    return `<div class="memory-area visual-memory"><div class="memory-status">选出原来的黑格 · 已选 ${draft.length} / ${question.cells.length}</div>${patternGrid(question, draft, { interactive: true, label: '选择记住的位置，顺序不限' })}<div class="memory-buttons"><button class="ghost" data-action="memory-clear">重新选择</button></div></div>`;
  }
  return `<p class="memory-status">${question.type === 'memory-symmetry' ? `刚才的图案关于${question.axis === 'vertical' ? '竖直' : '水平'}中线对称吗？` : '选出刚才展示的图案'}</p>${choiceButtons(question, current.draft, current.choicesOrder)}`;
}
function imageMarkup(path, alt = '题目图形', extra = '') {
  const src = safeAsset(path);
  return src ? `<img class="question-image ${extra}" src="${src}" alt="${esc(alt)}" data-action="zoom" data-src="${esc(path)}" loading="lazy"><p class="zoom-caption">点击图片可放大查看</p>` : '';
}

function memoryMarkup(question, current) {
  const stage = memoryStage(question, current);
  lastMemoryVisual = `${question.id}:${stage.key}`;
  if (MEMORY_FAMILIES.includes(question.taskFamily)) return visualMemoryMarkup(question, current, stage);
  const draft = Array.isArray(current.draft) ? current.draft : [];
  if (stage.phase === 'ready') return `<div class="memory-area"><span class="category-icon">${icons.memory}</span><h2>先看清，再记住</h2><p>${question.type === 'memory-binding' ? `目标图展示 ${memoryDisplayDuration(session, question) / 1000} 秒，等待后判断字母与位置是否相符。` : `将依次呈现${question.sequence.length}个${question.type === 'memory-grid' ? '位置' : '数字'}，每个展示 ${memoryDisplayDuration(session, question) / 1000} 秒。`}</p><p class="quiet">呈现结束后，在本段剩余时间内作答。</p><button class="primary" data-action="begin-memory">开始记忆 ${arrow}</button></div>`;
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
  if (question.choicesEmbedded) return `选项 ${answer}`;
  if (isUnratedMatrix(question)) return `选项 ${answer}`;
  if (question.type === 'construction') return Array.isArray(answer) && answer.length ? `元素 ${answer.map((id) => Number(id) + 1).join('、')}` : '空白组合';
  if (['memory-grid', 'memory-digits'].includes(question.type)) return Array.isArray(answer) ? answer.join(' → ') : String(answer);
  if (question.type === 'folding-video') return `${answer} 个孔`;
  if (question.type === 'memory-positions') return Array.isArray(answer) && answer.length ? answer.map((cell) => `${Math.floor((cell - 1) / question.gridColumns) + 1}行${(cell - 1) % question.gridColumns + 1}列`).join('、') : '未选择位置';
  const choice = question.choices?.find((c) => String(c.id) === String(answer));
  if (!choice) return String(answer);
  const index = order.length ? order.indexOf(choice.id) : question.choices.indexOf(choice);
  return `${index >= 0 ? `${String.fromCharCode(65 + index)} · ` : ''}${choice.text && choice.text !== choice.id ? choice.text : choice.image || choice.cells ? '图形选项' : choice.id}`;
}
function ruleExplanationMarkup(question) {
  if (!question?.ruleTags?.length) return '';
  return `<section class="rule-explanation"><h3>这道题的规律</h3><div class="rule-tags">${question.ruleTags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div><p>${esc(question.explanation)}</p></section>`;
}
function figurePackMarkup() {
  const counts = Object.entries(FIGURE_FAMILIES).map(([family, label]) => `${label} ${localFigureQuestions.filter((q) => q.taskFamily === 'figure-' + family).length}题`);
  return `<section class="figure-import"><div><h2>图形规律补充题</h2><p class="quiet">${localFigureQuestions.length ? `已加入北中主练 · ${localFigureQuestions.length}道 · ${esc(counts.join(' / '))}` : '导入筛选题包，把更多常见规律加入北中主练。'}<br>答案后显示规律类型与中文解法 · 四类规律分别以1–4档练习</p></div><button class="secondary" data-action="import-figures" ${!currentProfile || !store ? 'disabled' : ''}>导入图形规律题包</button></section>`;
}
function feedbackMarkup(question, response) {
  const isCorrect = response.status === 'correct';
  const earned = recordScore(session, response);
  const correctChoice = question.choices?.find((c) => String(c.id) === String(question.answer));
  if (isMatrixVariant(question) || isUnratedMatrix(question)) return `<div class="feedback ${isCorrect ? '' : 'incorrect'}" role="status"><strong>${isCorrect ? '答对了' : response.status === 'skipped' ? '已跳过这道题' : '这道题再想一想'}</strong><p>${isUnratedMatrix(question) ? 'Sandia 单独统计，不计积分。' : `复习积分 +${earned.points} · 本题不调整矩阵档位。`}</p><p>正确答案：${esc(formatAnswer(question, question.answer, response.choicesOrder))}</p>${correctChoice?.image ? `<div class="correct-pattern">${choiceContent(question, correctChoice, '正确图形')}</div>` : ''}</div>`;
  return `<div class="feedback ${isCorrect ? '' : 'incorrect'}" role="status"><strong>${isCorrect ? '答对了' : response.status === 'skipped' ? '已跳过这道题' : '这道题再想一想'} · ${response.levelAfter > response.levelBefore ? '同类题提高一档' : response.levelAfter < response.levelBefore ? '同类题降低一档' : isCorrect ? '继续挑战最高档' : '继续从基础档练习'}</strong><div class="earned-points">+${earned.points}<span>训练积分${earned.kind === 'review' ? ' · 复习' : earned.estimated ? ' · 历史回算' : ' · 新题'}</span></div><p>正确答案：${esc(formatAnswer(question, question.answer, response.choicesOrder))}</p>${correctChoice?.image || correctChoice?.cells ? `<div class="correct-pattern">${choiceContent(question, correctChoice, '正确图形')}</div>` : ''}${question.cells ? `<div class="memory-review"><div><small>原始图案</small>${patternGrid(question, question.cells, { mini: true })}</div>${question.type === 'memory-positions' && Array.isArray(response.answer) ? `<div><small>你的选择</small>${patternGrid(question, response.answer, { mini: true })}</div>` : ''}</div>` : ''}${question.answerImage ? `<details><summary>查看展开后的答案图</summary>${question.answerImageCrop ? croppedImage(question.answerImage, question.answerImageCrop, '展开后的孔位') : imageMarkup(question.answerImage, '展开后的孔位')}</details>` : ''}${ruleExplanationMarkup(question)}${!question.ruleTags?.length && (question.curatedExplanation ?? question.explanation) ? `<details><summary>查看解释</summary><p>${esc(question.curatedExplanation ?? (typeof question.explanation === 'string' ? question.explanation : JSON.stringify(question.explanation)))}</p></details>` : ''}<small>${session.version >= 3 ? esc(questionFamilyName(question)) + ' · 同类题目标' : '下题目标'} ${response.levelAfter} / ${maximumLevel(question)} 档</small></div>`;
}

function questionBody(question, current) {
  const answered = current.answered;
  const response = answered ? session.responses.at(-1) : null;
  const stem = question.image ? imageMarkup(question.image, '题目图形', question.sourceId === 'mars_ib' || isPrivateMatrixAsset(question.image) ? 'matrix' : '') : '';
  const matrixOptions = isUnratedMatrix(question) ? imageMarkup(question.matrixOptionsImage, '从左到右，先上排 1–4，再下排 5–8', 'matrix') : '';
  let content = '';
  if (answered) {
    if (!question.type.startsWith('memory')) content = stem + matrixOptions;
    content += feedbackMarkup(question, response);
  } else if (question.type.startsWith('memory')) {
    content = memoryMarkup(question, current);
  } else if (question.type === 'construction') {
    content = constructionMarkup(question, current);
  } else if (question.type === 'folding-choice') {
    content = `<video class="video-question" controls playsinline preload="metadata" data-question-video aria-label="折叠及打孔动画"><source src="${safeAsset(question.video)}" type="video/mp4"></video>${choiceButtons(question, current.draft, current.choicesOrder)}`;
  } else if (question.type === 'folding-video') {
    content = `<video class="video-question" controls playsinline preload="metadata" data-question-video aria-label="折叠及打孔动画"><source src="${safeAsset(question.video)}" type="video/mp4"></video><label class="answer-label" for="hole-answer">完全展开后，一共有多少个孔？</label><input id="hole-answer" class="answer-input" type="number" inputmode="numeric" min="0" max="512" step="1" autocomplete="off" value="${esc(current.draft ?? '')}" aria-label="展开后的孔数">`;
  } else {
    content = stem + matrixOptions + choiceButtons(question, current.draft, current.choicesOrder);
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
  const timing = sectionTiming(session);
  const sectionLeft = Math.max(0, timing.end - elapsed);
  const target = question ? targetLevel(session, question) : 1;
  const subtype = question ? questionFamilyName(question) : '';
  return `<div class="wrap"><header class="session-header">${logo()}<div class="overall-timer">全程剩余 <b class="timer" data-total-left>${clock(session.totalMs - elapsed)}</b></div><div class="session-actions"><button class="ghost" data-action="users">${esc(currentProfile?.username ?? '')} · 切换用户</button><button class="ghost" data-action="export-current">导出本次</button><button class="ghost" data-action="${paused ? 'unpause' : 'pause'}">${paused ? '继续计时' : '暂停'}</button><button class="ghost" data-action="finish">提前结束</button></div></header><main id="main"><div class="steps">${CATEGORIES.map((c, index) => `<div class="step ${index === session.sectionIndex ? 'active' : index < session.sectionIndex ? 'done' : ''}"><span><b>${c.number}</b>${c.name}</span><span>${index < session.sectionIndex ? '已结束' : duration(sectionTiming(session, index).duration)}</span></div>`).join('')}</div><div class="practice-layout"><section class="question-card">${paused ? `<div class="pause-surface"><span class="category-icon">${icons.pause}</span><h1>休息一下，进度已保存</h1><p>暂停期间不计入练习用时。<br>准备好了，就从刚才的地方继续。</p><button class="primary" data-action="unpause">继续练习 ${arrow}</button><div style="margin-top:12px"><button class="ghost" data-action="home">返回首页</button></div></div>` : question ? `<div class="question-heading"><div><h1>${currentCategory.name}</h1><div class="question-id">${esc(modeName(session))} · ${esc(subtype)}</div></div><span class="level-badge">${isUnratedMatrix(question) ? '未分档 · 单独统计' : isMatrixVariant(question) ? '4 档变式 · 复习积分' : `练习 ${presentedLevel(session, question)} / ${maximumLevel(question)} 档 · 答对 ${levelPoints(presentedLevel(session, question))}分`}</span></div><div class="question-body" id="question-body">${questionBody(question, current)}</div><div class="question-actions"><button class="ghost" data-action="skip" ${current.answered ? 'disabled' : ''}>跳过这道题</button><span class="shortcut-hint">${isUnratedMatrix(question) ? '可按 1–8 选择，Enter 提交' : question.choices ? `可按 A–${String.fromCharCode(64 + question.choices.length)} 选择，Enter 提交` : 'Enter 提交答案'}</span><button class="primary" data-action="${current.answered ? 'next' : 'submit'}" id="submit-button">${current.answered ? `下一题 ${arrow}` : '提交答案'}</button></div>` : `<div class="exhausted-card"><span class="category-icon">${icons[currentCategory.id]}</span><h1>这类新题，已练完了。</h1><p>已见题不会自动重复。可以开启本段复习，或等待倒计时进入下一段。</p><button class="primary" data-action="review-section">复习本类题目 ${arrow}</button></div>`}</section><aside class="practice-side"><div class="timer-card"><div class="timer-label">${currentCategory.name} · 本段剩余</div><div class="timer" data-section-left>${clock(sectionLeft)}</div><div class="track"><span data-section-progress style="width:${Math.max(0, sectionLeft / timing.duration * 100)}%"></span></div><p class="quiet">时间到后自动进入${CATEGORIES[session.sectionIndex + 1]?.name ?? '练习总结'}</p></div><div class="side-card"><h3>本次训练积分</h3><div class="live-points"><b>${number(info.points)}</b><small>本段 ${sectionInfo.points}分</small></div><h3>本段作答</h3><div class="side-counts"><div><b class="good num">${sectionInfo.correct}</b><small>答对</small></div><div><b class="bad num">${sectionInfo.incorrect}</b><small>答错</small></div><div><b class="num">${sectionInfo.skipped}</b><small>跳过</small></div></div>${currentCategory.id === 'figure' ? sandiaStats(info) : ''}</div><div class="side-card"><h3>${isUnratedMatrix(question) ? 'Sandia 单独统计' : isMatrixVariant(question) ? '第 4 档变式' : question ? `同类题目标 ${target} / ${maximumLevel(question)}` : '个人难度已保存'}</h3>${question && !isUnratedMatrix(question) && !isMatrixVariant(question) ? `<div class="level-ladder">${Array.from({ length: maximumLevel(question) }, (_, i) => `<span class="${i < target ? 'on' : ''}"></span>`).join('')}</div>` : ''}<p>${question ? session.version >= 3 ? isUnratedMatrix(question) || isMatrixVariant(question) ? '本题不改变主练档位。' : esc(subtype) + '独立升降档。' : '答对升一档，答错降一档。' : '各小题型的档位分别保存，复习时继续沿用。'}<br>档位为练习估算，原始难度信息保留在逐题记录中。</p></div></aside></div></main>${footer()}</div>`;
}

function resultMarkup(record, isResult = false) {
  const info = summarize(record);
  return `<div class="${isResult ? 'result-heading' : 'page-heading'}"><div><div class="eyebrow">${isResult ? '每一题，都有记录' : '逐题回看'}</div><h1>${isResult ? '这次练习，已记录。' : dateLabel(record.startedAt)}</h1><p>${isResult ? `${dateLabel(record.startedAt)}开始 · ` : ''}计划 ${record.totalMs / 60000} 分钟，实际 ${duration(info.elapsedMs)} · ${statusText(record.status)}</p><p class="quiet">${esc(record.username ?? '未归属记录')} · ${esc(modeName(record))} · ${record.version === 1 ? '旧版均分计时' : record.timingScheme === 'figure-focus-7-2-3-3' ? '模拟训练配比 7∶2∶3∶3 · 记忆材料每次展示 1 秒' : '模拟训练配比 20∶10∶15∶15 · 记忆材料每次展示 1 秒'}</p></div>${!isResult ? `<div class="button-row"><button class="secondary" data-action="export-one" data-id="${esc(record.id)}">导出本次</button><button class="ghost" data-action="delete-record" data-id="${esc(record.id)}">删除记录</button></div>` : ''}</div><div class="stats four-stats"><div class="stat"><div class="stat-label">本次训练积分</div><div class="stat-value">${number(info.points)}<small>分</small></div><div class="stat-note">新题 ${info.newPoints} · 复习 ${info.reviewPoints}${info.hasEstimated ? ` · 回算 ${info.legacyPoints}` : ''}</div></div><div class="stat"><div class="stat-label">答对</div><div class="stat-value" style="color:var(--green)">${info.correct}<small>道</small></div></div><div class="stat"><div class="stat-label">答错</div><div class="stat-value" style="color:var(--red)">${info.incorrect}<small>道</small></div></div><div class="stat"><div class="stat-label">有效作答正确率</div><div class="stat-value">${info.accuracy === null ? '—' : Math.round(info.accuracy * 100)}<small>${info.accuracy === null ? '' : '%'}</small></div></div></div>${scoringNotice(info)}${sandiaStats(info)}<div class="result-sections">${info.sections.map((section) => `<article class="result-section"><span class="category-icon">${icons[section.id]}</span><h3 style="margin-top:12px">${section.name}</h3><div class="result-numbers">${section.timeMs === 0 && section.correct + section.incorrect + section.skipped + section.unanswered === 0 ? '—' : number(section.points)}<small>${section.timeMs === 0 && section.correct + section.incorrect + section.skipped + section.unanswered === 0 ? '尚未练习' : '训练积分'}</small></div><div class="quiet">${section.correct} 对 / ${section.incorrect} 错</div><p>实际 ${duration(section.timeMs)} / 计划 ${duration(section.plannedMs)}${record.version < 3 ? ` · 最后目标 ${section.finalLevel} 档` : ''}</p>${record.version >= 3 ? `<div class="family-levels">${section.families.map((family) => `<span>${esc(family.name)} ${family.level}档</span>`).join('')}</div>` : ''}<div class="quiet">${section.skipped} 跳过 · ${section.unanswered} 未答</div></article>`).join('')}</div>${familyScoresMarkup(record)}`;
}
function results() {
  const record = visibleRecords().find((s) => s.id === selectedSessionId) ?? session;
  if (!record) return home();
  return shell(`${resultMarkup(record, true)}<div class="button-row" style="margin-top:26px"><button class="primary" data-action="detail" data-id="${esc(record.id)}">查看逐题记录 ${arrow}</button><button class="secondary" data-action="home">回到首页</button><button class="ghost" data-action="export-one" data-id="${esc(record.id)}">导出本次</button></div><p class="history-note">跳过与未作答单独统计，不计入有效作答正确率。每种小题型分别调整难度，正确率不直接代表能力高低。</p>`, 'history');
}
function reviewRecord(record, index, parent) {
  const question = getQuestion(record, parent);
  const q = question ?? { id: record.questionId, type: record.type, prompt: '此题不在当前题库版本中，原作答记录仍保留。' };
  let media = '';
  if (q.image) media += imageMarkup(q.image, '原题图形', q.sourceId === 'mars_ib' || isPrivateMatrixAsset(q.image) ? 'matrix' : '');
  if (isUnratedMatrix(q)) media += imageMarkup(q.matrixOptionsImage, '原题选项图', 'matrix');
  if (isPrivateMatrixAsset(q.image) && !safeAsset(q.image)) media = '<p class="quiet">这道题的图形需在原浏览器查看，或先在此浏览器导入同一个题包。</p>';
  if (q.probeImage) media += `<p class="quiet">探测图</p>${imageMarkup(q.probeImage, '探测图')}`;
  if (q.video) media += `<video class="video-question" controls playsinline preload="none" src="${safeAsset(q.video)}" aria-label="原折纸动画"></video>`;
  if (q.answerImage) media += q.answerImageCrop ? `<div class="answer-paper">${croppedImage(q.answerImage, q.answerImageCrop, '展开后的答案图')}</div>` : imageMarkup(q.answerImage, '展开后的答案图');
  if (q.cells) media += `<div class="memory-review"><div><small>原始图案</small>${patternGrid(q, q.cells, { mini: true })}</div>${q.type === 'memory-positions' && Array.isArray(record.answer) ? `<div><small>你的选择</small>${patternGrid(q, record.answer, { mini: true })}</div>` : ''}</div>`;
  if (q.type === 'construction') media += `<p class="quiet">构图元素（编号与作答时一致）</p><div class="element-grid">${q.elements.map((element, i) => `<figure class="review-element"><img src="${safeAsset(element.image)}" alt="构图元素${i + 1}"><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>`;
  if (q.choices?.some((c) => c.image || c.cells)) media += `<div class="choices image-choices ${['folding-choice', 'memory-recognition'].includes(q.type) ? 'large-choices' : ''}">${(record.choicesOrder?.length ? record.choicesOrder : q.choices.map((c) => c.id)).map((id, i) => { const choice = q.choices.find((c) => c.id === id); return choice ? `<div class="choice ${choice.id === record.answer ? 'selected' : ''}"><span class="choice-tag">${String.fromCharCode(65 + i)}</span>${choiceContent(q, choice, `选项${String.fromCharCode(65 + i)}`)}</div>` : ''; }).join('')}</div>`;
  const score = recordScore(parent, record);
  const explanation = q.curatedExplanation ?? (typeof q.explanation === 'string' ? q.explanation : '');
  return `<details class="record-detail"><summary class="record-summary"><span class="summary-main"><span class="status-dot ${record.status}"></span><b>${String(index + 1).padStart(2, '0')}</b><span>${category(record.category).short} · ${statusText(record.status)}</span><span class="quiet">${isUnratedMatrix(record) ? 'Sandia · 单列' : `${record.presentedLevel}档 · ${score.points}分${score.estimated ? '（回算）' : score.kind === 'review' ? '（复习）' : ''}`} · ${duration(record.timeMs)}</span><span class="question-code">${esc(record.questionId)}</span></span><span class="quiet">展开 ↓</span></summary><div class="record-review"><p class="question-prompt">${esc(q.prompt)}</p>${q.promptNeedsOriginal ? `<div class="original-prompt">${esc(q.originalPromptEn)}</div>` : ''}${media}<div class="answer-comparison"><div><small>你的答案</small>${esc(formatAnswer(q, record.answer, record.choicesOrder))}</div><div><small>正确答案</small>${question ? esc(formatAnswer(q, q.answer, record.choicesOrder)) : '请参考原题库'}</div></div>${ruleExplanationMarkup(q)}${!q.ruleTags?.length && explanation ? `<p class="review-explanation">${esc(explanation)}</p>` : ''}<p class="quiet" style="margin-top:15px">来源：${esc(q.sourceName ?? sourceName(record.sourceId))}${q.sourceUrl ? ` · <a href="${safeLink(q.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始题库</a>` : ''}<br>原始难度：${esc(q.originalDifficulty?.label_zh ?? '未提供')}<br>${esc(q.familyLevelBasis ?? q.levelBasis ?? '练习估算')}<br>${isUnratedMatrix(record) ? '未分档，不计训练积分。' : `目标档位 ${record.levelBefore} → ${record.levelAfter}<br>本题训练积分 ${score.points} / 可得 ${score.possible}分${score.estimated ? '（历史回算）' : '（当时规则）'}`}</p></div></details>`;
}
function detail() {
  const record = visibleRecords().find((s) => s.id === selectedSessionId);
  if (!record) return history();
  const responses = record.responses.map((response, index) => ({ response, index })).filter(({ response }) => {
    if (recordFilter === 'all') return true;
    if (recordFilter === 'other') return ['skipped', 'unanswered'].includes(response.status);
    return response.status === recordFilter;
  });
  return shell(`<button class="ghost" data-action="history-back" style="margin-top:22px;padding-left:0">← 全部记录</button>${resultMarkup(record)}<div class="filter-row">${[['all', '全部题目'], ['incorrect', '只看答错'], ['correct', '只看答对'], ['other', '跳过与未答']].map(([value, label]) => `<button class="${recordFilter === value ? 'active' : ''}" data-action="record-filter" data-value="${value}">${label}</button>`).join('')}<span class="quiet">${responses.length} 条</span></div><div class="table-card">${responses.length ? responses.map(({ response, index }) => reviewRecord(response, index, record)).join('') : '<div class="empty"><p>当前筛选下没有题目。</p></div>'}</div>`, 'history');
}

function render() {
  root.innerHTML = ({ home, users, history, about, practice: renderSession, results, detail }[route] ?? home)();
  if (route === 'practice') {
    const video = root.querySelector('[data-question-video]');
    if (video && session.current?.videoTime) video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(session.current.videoTime, video.duration || 0); }, { once: true });
    if (session?.status === 'running') updateSubmitState();
  }
}

function updateSessionList(value) {
  const index = allSessions.findIndex((s)=>s.id===value.id);
  if (index < 0) allSessions.unshift(value); else allSessions[index] = value;
  allSessions.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
  sessions = allSessions.filter((s)=>s.userId===currentProfile?.id && s.userId);
}
function updateProfile(profile) {
  if (!profile) return;
  const old = profiles.find((p)=>p.id===profile.id);
  const merged = mergeProfiles(old, profile);
  profiles = [merged, ...profiles.filter((p)=>p.id!==profile.id)];
  if (currentProfile?.id === profile.id) currentProfile = mergeProfiles(currentProfile, merged);
}
async function reloadLocalData() {
  [allSessions, profiles] = await Promise.all([store.all(), store.profiles()]);
  if (currentProfile) currentProfile = profiles.find((p)=>p.id===currentProfile.id) ?? currentProfile;
  sessions = allSessions.filter((s)=>s.userId===currentProfile?.id && s.userId);
  for (const id of Object.keys(exposures)) delete exposures[id];
  for (const s of sessions) for (const r of s.responses) exposures[r.questionId] = (exposures[r.questionId] ?? 0)+1;
  await refreshMatrixPack();
}
async function refreshMatrixPack() {
  const owner = currentProfile?.id;
  if (matrixOwner !== owner) {
    for (const url of matrixUrls.values()) URL.revokeObjectURL(url);
    matrixUrls.clear();
    matrixOwner = owner; localMatrixPack = null; matrixQuestions = []; matrixStandaloneSeen = new Set();
  }
  await refreshFigurePacks();
  if (!owner) return;
  try {
    matrixStore ??= await openMatrixStore();
    const pack = localMatrixPack ?? await matrixStore.pack(owner);
    const records = pack ? await matrixStore.answers(owner, pack.id) : [];
    if (currentProfile?.id !== owner) return;
    if (pack && !localMatrixPack) {
      localMatrixPack = pack;
      matrixQuestions = northMatrixQuestions(pack);
    }
    matrixStandaloneSeen = new Set(records.map((record) => record.questionId));
  } catch {
    // A missing or unavailable local pack must not prevent ordinary practice.
  }
}
async function refreshFigurePacks() {
  const owner = currentProfile?.id;
  if (figureOwner !== owner) {
    for (const url of figureUrls.values()) URL.revokeObjectURL(url);
    figureUrls.clear(); localFigurePacks = []; localFigureQuestions = []; figureOwner = owner;
  }
  if (!owner) return;
  try {
    figureStore ??= await openFigureStore();
    const packs = await figureStore.packs(owner);
    if (currentProfile?.id !== owner) return;
    localFigurePacks = packs;
    localFigureQuestions = packs.flatMap(northFigureQuestions);
  } catch {
    toast('本地图形题包暂时无法读取，请检查浏览器存储后重试。');
  }
}
function persist(force = true) {
  if (!session || !store) return;
  const snapshot = snapshotSession(session);
  try { saveCheckpoint(snapshot); } catch { toast('浏览器检查点空间不足，练习记录仍会尝试保存。请及时导出备份。'); }
  updateSessionList(snapshot);
  if (currentProfile?.id === snapshot.userId) updateProfile(rememberSession(currentProfile, snapshot, getQuestion));
  checkpointAt = Date.now();
  if (force || Date.now() - savedAt > 4500) {
    savedAt = Date.now();
    saveQueue = saveQueue.then(() => store.save(snapshot)).then(updateProfile).catch((error) => toast(`记录保存失败：${error.message}。请导出本次备份。`));
  }
}
function nextQuestion() {
  session = advanceSession(session);
  if (session.status === 'completed') return endView();
  const id = CATEGORIES[session.sectionIndex].id;
  const north = session.version >= 3 && session.practiceMode === 'north';
  const pool = north ? [...practiceBank.categories[id], ...(id === 'figure' ? localFigureQuestions : [])] : bank.categories[id];
  let question;
  if (north && id === 'memory') question = selectUserMemory(session, currentProfile);
  else if (north && id === 'figure') question = selectNorthFigure(pool, matrixQuestions, session, currentProfile, matrixStandaloneSeen);
  else question = selectUserQuestion(pool, session, currentProfile);
  if (!question && id === 'memory' && !north) {
    const seen = new Set(currentProfile.memoryPatterns);
    for (let attempt = 0; attempt < 512; attempt++) {
      const generated = generatedMemory(session.version >= 3 ? targetLevel(session, 'memory-sequence-grid') : session.levels[id]);
      if (session.reviewCategories?.includes(id) || !seen.has(memorySignature(generated))) { question = generated; break; }
    }
  }
  if (!question && session.reviewCategories?.includes(id)) question = chooseQuestion(pool, { ...session, responses: [], current: null }, id, exposures);
  if (!question) {
    session.current = null; session.exhaustedCategory = id;
    persist(); render(); return;
  }
  delete session.exhaustedCategory;
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
  if (question.type === 'memory-positions') return Array.isArray(current.draft) && current.draft.length === question.answer.length;
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
  if (sectionIndexAt(session) !== session.sectionIndex) {
    session = advanceSession(session);
    if (session.status === 'completed') return endView();
    toast(`现在进入${CATEGORIES[session.sectionIndex].name}，计时已开始。`);
    return nextQuestion();
  }
  document.querySelector('[data-total-left]')?.replaceChildren(clock(session.totalMs - elapsed));
  document.querySelector('[data-section-left]')?.replaceChildren(clock(sectionTiming(session).end - elapsed));
  const progress = document.querySelector('[data-section-progress]');
  if (progress) progress.style.width = `${Math.max(0, (sectionTiming(session).end - elapsed) / sectionTiming(session).duration * 100)}%`;
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
  const profile = currentProfile && records.every((r)=>r.userId===currentProfile.id) ? currentProfile : null;
  const data = userBackup(records, profile);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `思维练习记录-${profile?.username ?? '未归属'}-${dateKey(Date.now())}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${records.length} 次练习记录。`);
}

const actions = {
  home: () => { viewingLegacy = false; navigate('home'); }, history: () => { viewingLegacy = false; navigate('history'); }, about: () => navigate('about'),
  users: () => navigate('users'),
  'import-figures': () => document.querySelector('#figure-import-file').click(),
  'history-back': () => navigate('history'),
  legacy: () => { viewingLegacy = true; navigate('history'); },
  'enter-user': async (element) => {
    if (!store || !bootReady) return;
    const name = element?.dataset.name ?? document.querySelector('#username')?.value;
    usernameIdentity(name);
    if (session?.status === 'running') { session = pauseSession(session); persist(); }
    await saveQueue;
    currentProfile = await store.enter(name); saveActiveUser(currentProfile.id);
    session = null; viewingLegacy = false; selectedSessionId = null; recordFilter = 'all'; dateFilter = '';
    await reloadLocalData();
    ({ minutes, mode: practiceMode } = readPreferences(currentProfile.id));
    route = 'home'; render(); window.scrollTo({top:0});
  },
  'claim-legacy': () => currentProfile && confirmDialog(`把旧记录归入${currentProfile.username}？`, `将${legacyRecords().length}条未归属记录连同未完成进度归入这个用户名，并用于个人去重与难度衔接。`, '确认归入', async () => { await saveQueue; const result = await store.claimLegacy(currentProfile.id); currentProfile = result.profile; await reloadLocalData(); viewingLegacy = false; route = 'home'; render(); toast(`已归入${result.count}条旧记录。`); }),
  'review-section': () => { if (!session || session.status !== 'running') return; session.reviewCategories = [...new Set([...(session.reviewCategories ?? []), CATEGORIES[session.sectionIndex].id])]; nextQuestion(); },
  reload: () => location.reload(),
  mode: (element) => { if (!['north', 'extended'].includes(element.dataset.value)) return; practiceMode = element.dataset.value; savePrefs(); render(); },
  duration: (element) => { minutes = Number(element.dataset.value); savePrefs(); render(); },
  start: async (button) => {
    if (!bank || !practiceBank || !store || !currentProfile || activeCandidate()) return;
    const input = document.querySelector('#minutes');
    const value = input ? Number(input.value) : minutes;
    if (!Number.isInteger(value) || value < 4 || value > 180) return toast('请输入 4–180 之间的整数分钟数。');
    const owner = currentProfile.id;
    button.disabled = true;
    await refreshMatrixPack();
    if (currentProfile?.id !== owner || route !== 'home' || activeCandidate()) return;
    minutes = value; savePrefs();
    session = createUserSession(currentProfile, minutes, practiceMode);
    route = 'practice'; nextQuestion();
    window.scrollTo({ top: 0 });
  },
  resume: (element) => {
    const found = sessions.find((s) => s.id === element.dataset.id);
    if (!found || !bank || !practiceBank) return;
    const currentQuestion = getQuestion(found.current, found);
    if (!found.current?.answered && (isPrivateMatrixAsset(currentQuestion?.image) || isPrivateFigureAsset(currentQuestion?.image)) && !safeAsset(currentQuestion.image)) return toast('当前题需要对应的本地题包，请先重新导入题包再继续。');
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
  choice: (element) => { if (session?.status !== 'running' || session.current.answered) return; const q = getQuestion(); if (q.type.startsWith('memory') && memoryStage(q, session.current).phase !== 'answer') return; session.current.draft = element.dataset.id; render(); },
  element: (element) => { if (session?.status !== 'running' || session.current.answered) return; const selected = session.current.draft ?? []; session.current.draft = selected.includes(element.dataset.id) ? selected.filter((x) => x !== element.dataset.id) : [...selected, element.dataset.id]; render(); },
  'begin-memory': async (element) => {
    if (session?.status !== 'running' || session.current.presentationAtElapsed !== null) return;
    const question = getQuestion();
    const current = session.current;
    if (question.type === 'memory-binding') {
      element.disabled = true;
      element.textContent = '正在准备图形…';
      try {
        const image = new Image();
        image.src = safeAsset(question.image);
        await image.decode();
      } catch { render(); throw new Error('记忆图形加载失败，请重试。'); }
      if (session.status !== 'running' || session.current !== current || current.presentationAtElapsed !== null) return;
    }
    current.presentationAtElapsed = elapsedTime(session);
    current.draft = question.type === 'memory-digits' ? '' : ['memory-grid', 'memory-positions'].includes(question.type) ? [] : null;
    persist(); render();
  },
  'visual-cell': (element) => { const q = getQuestion(); if (session?.status !== 'running' || session.current.answered || q?.type !== 'memory-positions' || memoryStage(q, session.current).phase !== 'answer') return; const draft = session.current.draft ?? []; const value = Number(element.dataset.value); if (!draft.includes(value) && draft.length >= q.cells.length) return toast('已选够位置，点击已选方格可取消。'); session.current.draft = draft.includes(value) ? draft.filter((cell) => cell !== value) : [...draft, value]; render(); },
  'memory-cell': (element) => { const q = getQuestion(); if (session?.status !== 'running' || session.current.answered || memoryStage(q, session.current).phase !== 'answer') return; const current = session.current.draft ?? []; if (current.length >= q.sequence.length) return toast('已选完全部位置，可以提交，或撤回一步。'); session.current.draft = [...current, Number(element.dataset.value)]; render(); },
  'memory-undo': () => { session.current.draft = (session.current.draft ?? []).slice(0, -1); render(); },
  'memory-clear': () => { session.current.draft = []; render(); },
  submit: () => answer(), skip: () => answer(true), next: () => nextQuestion(),
  detail: (element) => { selectedSessionId = element.dataset.id; recordFilter = 'all'; navigate('detail'); },
  'record-filter': (element) => { recordFilter = element.dataset.value; render(); },
  'clear-date': () => { dateFilter = ''; render(); },
  export: () => downloadBackup(visibleRecords()),
  'export-one': (element) => { const record = visibleRecords().find((s) => s.id === element.dataset.id); if (record) downloadBackup([record]); },
  'export-current': () => { persist(); downloadBackup([snapshotSession(session)]); },
  import: () => document.querySelector('#import-file').click(),
  'delete-record': (element) => confirmDialog('删除这次练习记录？', '这只会删除当前浏览器里的这一条记录。已学难度和去重清单会保留；若已经导出备份，记录仍可重新导入。', '删除记录', async () => {
    await saveQueue; await store.remove(element.dataset.id, viewingLegacy ? null : currentProfile?.id);
    const old = allSessions.find((s)=>s.id===element.dataset.id);
    allSessions = allSessions.filter((s)=>s.id!==element.dataset.id);
    sessions = sessions.filter((s)=>s.id!==element.dataset.id);
    if (session?.id === element.dataset.id) session = null;
    clearCheckpoint(element.dataset.id, old?.userId);
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
      const timings = trainingDurations(minutes * 60000);
      document.querySelectorAll('[data-section-duration]').forEach((node) => node.textContent = duration(timings[Number(node.dataset.sectionDuration)]));
      document.querySelector('#start-label').textContent = `开始 ${minutes} 分钟练习`;
      document.querySelectorAll('.preset').forEach((node) => node.classList.toggle('selected', Number(node.dataset.value) === value));
      savePrefs();
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
    session = null;
    await reloadLocalData();
    if (!currentProfile && profiles.length === 1) {
      currentProfile = profiles[0]; saveActiveUser(currentProfile.id); await reloadLocalData();
      ({ minutes, mode: practiceMode } = readPreferences(currentProfile.id));
    }
    viewingLegacy = !currentProfile;
    route = currentProfile || legacyRecords().length ? 'history' : 'users'; render(); toast(`已导入或更新 ${count} 次练习；用户档案按用户名合并。`);
  } catch (error) { toast(error.message); }
});
document.addEventListener('keydown', (event) => {
  if (route !== 'practice' || session?.status !== 'running' || modal.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  const q = getQuestion();
  if (!q || !session.current) return;
  if (key === 'enter') { event.preventDefault(); session.current.answered ? nextQuestion() : answer(); }
  else if ((isUnratedMatrix(q) ? /^[1-8]$/ : /^[a-d]$/).test(key) && q.choices && !session.current.answered && (!q.type.startsWith('memory') || memoryStage(q, session.current).phase === 'answer')) {
    const id = session.current.choicesOrder[isUnratedMatrix(q) ? Number(key) - 1 : key.charCodeAt(0) - 97];
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

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'user-form') return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
  try { await actions['enter-user'](); } catch (error) { button.disabled = false; toast(error.message); }
});

document.querySelector('#figure-import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0], owner = currentProfile?.id;
  event.target.value = '';
  if (!file || !owner) return;
  const button = document.querySelector('[data-action="import-figures"]');
  if (button) button.disabled = true;
  try {
    if (file.size > MAX_FIGURE_PACK_BYTES) throw new Error('请选择32 MB以内的图形规律题包。');
    const pack = await parseFigurePack(await file.text());
    if (currentProfile?.id !== owner) throw new Error('用户名已切换，请在正确的档案下重新导入。');
    // Decode every PNG before committing. Header checks alone cannot detect a corrupt image.
    for (const blob of pack.files.values()) {
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
    }
    if (currentProfile?.id !== owner) throw new Error('用户名已切换，请在正确的档案下重新导入。');
    figureStore ??= await openFigureStore();
    await figureStore.savePack(owner, pack);
    if (currentProfile?.id !== owner) return;
    await refreshFigurePacks();
    render(); toast(`已导入${pack.questions.length}道图形规律题，选择北中主练即可练习。`);
  } catch (error) { toast(`导入未完成：${error.message}。原有练习记录仍保留。`); }
  finally { if (button?.isConnected) button.disabled = false; }
});

async function boot() {
  render();
  const loadBank = async (path) => { const response = await fetch(path); if (!response.ok) throw new Error('题库加载失败，请检查网络后重试。'); return response.json(); };
  const bankPromise = Promise.all([loadBank('data/bank.json'), loadBank('data/practice-bank.json')]).then(([full, main]) => {
    bank = full; practiceBank = main;
    for (const list of Object.values(full.categories)) for (const q of list) questions.set(q.id,q);
    for (const list of Object.values(main.categories)) for (const q of list) practiceQuestions.set(q.id,q);
  }).catch((error)=>{loadError=error.message;});
  const storagePromise = openStore(getQuestion).then((value)=>{store=value;}).catch((error)=>{storageError=`记录存储暂不可用：${error.message}`;});
  await Promise.all([bankPromise, storagePromise]);
  if (store) {
    try {
      await reloadLocalData();
      for (const checkpoint of readCheckpoints()) {
        const old = allSessions.find((s)=>s.id===checkpoint.id);
        if (!old || old.updatedAt <= checkpoint.updatedAt) await store.save(checkpoint);
      }
      await reloadLocalData();
      currentProfile = profiles.find((p)=>p.id===readActiveUser()) ?? null;
      await reloadLocalData();
      if (currentProfile) ({minutes, mode:practiceMode}=readPreferences(currentProfile.id));
      allSessions = allSessions.map((s)=>s.status==='running'?{...s,status:'paused',anchorAt:null}:s);
      sessions = allSessions.filter((s)=>s.userId===currentProfile?.id && s.userId);
    } catch (error) {storageError=`读取用户档案失败：${error.message}`;}
  }
  bootReady = true; render(); setInterval(tick,30);
}
boot();
