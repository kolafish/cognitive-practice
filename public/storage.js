import { isValidSession } from './engine.js';
import { createProfile, usernameIdentity, validUserId, isValidProfile, mergeProfiles, rememberSession, parseUserBackup } from './profiles.js';

export const CHECKPOINT_KEY = 'cognitive-practice.checkpoint.v1';
const CHECKPOINT_PREFIX = 'cognitive-practice.checkpoint.user.';
const PREFS_KEY = 'cognitive-practice.preferences.v1';
const ACTIVE_USER_KEY = 'cognitive-practice.active-user.v1';
const checkpointKey = (userId) => userId ? CHECKPOINT_PREFIX + encodeURIComponent(userId) : CHECKPOINT_KEY;
const preferenceKey = (userId) => userId ? `${PREFS_KEY}.${encodeURIComponent(userId)}` : PREFS_KEY;
function requestResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('无法读取本地记录。')); });
}
function completed(transaction) {
  return new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error ?? new Error('本地记录写入失败。')); transaction.onabort = () => reject(transaction.error ?? new Error('本地记录写入中断。')); });
}
function validOwner(session) {
  if (session.userId === undefined) return session.username === undefined;
  try { return usernameIdentity(session.username).id === session.userId; } catch { return false; }
}
export async function openStore(resolveQuestion = (r) => r.generatedQuestion ?? r.questionSnapshot) {
  if (!globalThis.indexedDB) throw new Error('浏览器未提供本地存储。请使用普通模式的Chrome、Safari或Edge。');
  const request = indexedDB.open('cognitive-practice', 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'id' });
    if (!request.result.objectStoreNames.contains('profiles')) request.result.createObjectStore('profiles', { keyPath: 'id' });
  };
  const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('请关闭此站点的其他标签页后重新加载。原有记录不会删除。')); });
  database.onversionchange = () => database.close();
  async function mutate(callback) {
    const transaction = database.transaction(['sessions', 'profiles'], 'readwrite');
    const done = completed(transaction);
    try {
      const result = await callback(transaction.objectStore('sessions'), transaction.objectStore('profiles'));
      await done;
      return result;
    } catch (error) { try { transaction.abort(); } catch {} await done.catch(() => {}); throw error; }
  }
  return {
    async all() {
      const transaction = database.transaction('sessions', 'readonly');
      return (await requestResult(transaction.objectStore('sessions').getAll())).filter((s) => isValidSession(s) && validOwner(s)).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
    },
    async profiles() {
      const transaction = database.transaction('profiles', 'readonly');
      return (await requestResult(transaction.objectStore('profiles').getAll())).filter(isValidProfile).sort((a,b)=>b.updatedAt-a.updatedAt);
    },
    async enter(name) {
      const incoming = createProfile(name);
      return mutate(async (_sessions, profiles) => {
        const existing = await requestResult(profiles.get(incoming.id));
        if (existing && !isValidProfile(existing)) throw new Error('这个用户的档案暂时无法读取，请先导出已有备份。');
        if (!existing) profiles.put(incoming);
        return existing ?? incoming;
      });
    },
    async save(session) {
      if (!isValidSession(session) || !validOwner(session)) throw new Error('练习记录格式不正确。');
      return mutate(async (sessions, profiles) => {
        const [old, stored] = await Promise.all([requestResult(sessions.get(session.id)), session.userId ? requestResult(profiles.get(session.userId)) : null]);
        if (old?.userId && old.userId !== session.userId) throw new Error('练习记录属于另一用户，未覆盖。');
        if (old && old.updatedAt > session.updatedAt) return stored;
        sessions.put(session);
        if (!session.userId) return null;
        const profile = rememberSession(stored ?? createProfile(session.username), session, resolveQuestion);
        profiles.put(profile);
        return profile;
      });
    },
    async remove(id, userId) {
      return mutate(async (sessions) => {
        const old = await requestResult(sessions.get(id));
        if (old && (old.userId ?? null) !== (userId ?? null)) throw new Error('不能删除其他用户的记录。');
        sessions.delete(id); // The learned level and deduplication ledger are retained.
      });
    },
    async claimLegacy(userId) {
      const result = await mutate(async (sessions, users) => {
        const [records, stored] = await Promise.all([requestResult(sessions.getAll()), requestResult(users.get(userId))]);
        if (!isValidProfile(stored)) throw new Error('请先进入有效的用户档案。');
        let profile = stored, count = 0; const ids = [];
        for (const old of records) {
          if (old.userId !== undefined || !isValidSession(old)) continue;
          const record = { ...old, userId, username: stored.username, updatedAt: Date.now(), ...(old.status === 'running' ? { status: 'paused', anchorAt: null } : {}) };
          profile = rememberSession(profile, record, resolveQuestion); sessions.put(record); count++;
          ids.push(old.id);
        }
        users.put(profile);
        return { count, profile, ids };
      });
      for (const id of result.ids) clearCheckpoint(id);
      return result;
    },
    async import(text) {
      const incoming = parseUserBackup(text);
      return mutate(async (sessions, users) => {
        const [oldSessions, oldProfiles] = await Promise.all([requestResult(sessions.getAll()), requestResult(users.getAll())]);
        const records = new Map(oldSessions.map((s)=>[s.id,s]));
        const profiles = new Map(oldProfiles.filter(isValidProfile).map((p)=>[p.id,p]));
        for (const profile of incoming.profiles) profiles.set(profile.id, mergeProfiles(profiles.get(profile.id), profile));
        let count = 0;
        for (const record of incoming.sessions) {
          const old = records.get(record.id);
          if (old?.userId && !record.userId) continue; // An old anonymous backup cannot undo a claim.
          if (old?.userId && old.userId !== record.userId) throw new Error('备份中有记录已属于其他用户，原有数据未改动。');
          if (!old || old.updatedAt < record.updatedAt) { sessions.put(record); records.set(record.id, record); count++; }
        }
        // Reconcile all owned records as well as imported progress-only ledgers.
        for (const record of records.values()) if (record.userId && isValidSession(record) && validOwner(record)) {
          const profile = profiles.get(record.userId) ?? createProfile(record.username, Date.parse(record.startedAt));
          profiles.set(profile.id, rememberSession(profile, record, resolveQuestion));
        }
        for (const profile of profiles.values()) users.put(profile);
        return count;
      });
    },
  };
}
export function readCheckpoints() {
  const records = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== CHECKPOINT_KEY && !key.startsWith(CHECKPOINT_PREFIX)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (isValidSession(value) && validOwner(value) && ['running','paused'].includes(value.status) && key === checkpointKey(value.userId)) records.push({ ...value, status: 'paused', anchorAt: null });
      } catch {}
    }
  } catch {}
  return records;
}
export function readCheckpoint(userId = null) { return readCheckpoints().find((s)=>(s.userId ?? null)===(userId ?? null)) ?? null; }
export function clearCheckpoint(id, userId = null) {
  const key = checkpointKey(userId);
  try { if (JSON.parse(localStorage.getItem(key))?.id === id) localStorage.removeItem(key); } catch {}
}
export function saveCheckpoint(session) {
  if (['completed', 'stopped'].includes(session.status)) clearCheckpoint(session.id, session.userId);
  else localStorage.setItem(checkpointKey(session.userId), JSON.stringify(session));
}
export function readPreferences(userId = null) {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey(userId)));
    return { minutes: Number.isInteger(value?.minutes) && value.minutes >= 4 && value.minutes <= 180 ? value.minutes : 60,
      mode: ['north','extended'].includes(value?.mode) ? value.mode : 'north' };
  } catch { return { minutes: 60, mode: 'north' }; }
}
export function savePreferences(value, userId = null) { localStorage.setItem(preferenceKey(userId), JSON.stringify(value)); }
export function readActiveUser() { try { const id = localStorage.getItem(ACTIVE_USER_KEY); return validUserId(id) ? id : null; } catch { return null; } }
export function saveActiveUser(id) { if (id) localStorage.setItem(ACTIVE_USER_KEY, id); else localStorage.removeItem(ACTIVE_USER_KEY); }
