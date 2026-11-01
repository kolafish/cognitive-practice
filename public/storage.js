import { isValidSession, parseBackup } from './engine.js';

export const CHECKPOINT_KEY = 'cognitive-practice.checkpoint.v1';
const PREFS_KEY = 'cognitive-practice.preferences.v1';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法读取本地记录。'));
  });
}

function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error('本地记录写入失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本地记录写入中断。'));
  });
}

export async function openStore() {
  if (!globalThis.indexedDB) throw new Error('浏览器未提供本地存储。请使用普通模式的 Chrome、Safari 或 Edge。');
  const request = indexedDB.open('cognitive-practice', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭此站点的其他标签页后重试。'));
  });
  database.onversionchange = () => database.close();
  return {
    async all() {
      const transaction = database.transaction('sessions', 'readonly');
      const result = await requestResult(transaction.objectStore('sessions').getAll());
      return result.filter(isValidSession).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    },
    async save(session) {
      if (!isValidSession(session)) throw new Error('练习记录格式不正确。');
      const transaction = database.transaction('sessions', 'readwrite');
      const done = completed(transaction);
      transaction.objectStore('sessions').put(session);
      await done;
    },
    async remove(id) {
      const transaction = database.transaction('sessions', 'readwrite');
      const done = completed(transaction);
      transaction.objectStore('sessions').delete(id);
      await done;
    },
    async import(text) {
      const incoming = parseBackup(text);
      const existing = new Map((await this.all()).map((s) => [s.id, s]));
      const transaction = database.transaction('sessions', 'readwrite');
      const done = completed(transaction);
      let count = 0;
      for (const session of incoming) {
        if (!existing.has(session.id) || existing.get(session.id).updatedAt < session.updatedAt) {
          transaction.objectStore('sessions').put(session); count += 1;
        }
      }
      await done;
      return count;
    },
  };
}

export function readCheckpoint() {
  try {
    const value = JSON.parse(localStorage.getItem(CHECKPOINT_KEY));
    return isValidSession(value) && ['running', 'paused'].includes(value.status) ? { ...value, status: 'paused', anchorAt: null } : null;
  } catch { return null; }
}

export function saveCheckpoint(session) {
  if (['completed', 'stopped'].includes(session.status)) localStorage.removeItem(CHECKPOINT_KEY);
  else localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(session));
}

export function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY));
    return { minutes: Number.isInteger(value?.minutes) && value.minutes >= 4 && value.minutes <= 180 ? value.minutes : 60,
      mode: ['north', 'extended'].includes(value?.mode) ? value.mode : 'north' };
  } catch { return { minutes: 60, mode: 'north' }; }
}

export function savePreferences(value) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(value));
}
