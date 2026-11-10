import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { createProfile, usernameIdentity, isValidProfile, rememberSession, mergeProfiles, createUserSession, questionIdentity, selectUserQuestion, freshVisualMemory, memorySignature, userBackup, parseUserBackup } from '../public/profiles.js';
import { createSession, beginQuestion, submitAnswer, pauseSession, finishSession, isValidSession } from '../public/engine.js';
import { generateVisualMemory } from '../public/practice.js';
import { openStore, saveCheckpoint, readCheckpoint, readCheckpoints, clearCheckpoint, savePreferences, readPreferences, saveActiveUser, readActiveUser } from '../public/storage.js';

const NOW = Date.parse('2026-11-01T03:00:00Z');
const bank = JSON.parse(readFileSync(new URL('../public/data/bank.json', import.meta.url)));
const map = new Map(Object.values(bank.categories).flat().map(q=>[q.id,q]));
const original = bank.categories.figure.find(q=>q.type==='choice');
const q = (id='q1', level=1, groupId) => ({...original,id,level,familyLevel:level,taskFamily:'matrix-choice',groupId});
const resolve = (r) => r.generatedQuestion ?? r.questionSnapshot ?? map.get(r.questionId);
function answered(profile, question=q(), id='run1', at=NOW) {
  let s = createUserSession(profile,4,'north',at,id);
  s = beginQuestion(s,question,at);
  return submitAnswer(s,question,question.answer,at+1000).session;
}
class MemoryLocalStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k,v) { this.values.set(k,String(v)); }
  removeItem(k) { this.values.delete(k); }
}
beforeEach(()=>{ globalThis.indexedDB = new IDBFactory(); globalThis.localStorage = new MemoryLocalStorage(); });

test('username normalization identifies the same user while rejecting blank or unsafe names', () => {
  assert.equal(usernameIdentity('  Ａlice  ').id, usernameIdentity('alice').id);
  assert.equal(usernameIdentity('小明').id,'user:小明');
  for (const name of ['', ' ', '<script>', 'a\u200bb', 'a'.repeat(25)]) assert.throws(()=>usernameIdentity(name));
  assert.ok(isValidProfile(createProfile('小明', NOW)));
  const invalid = createProfile('小明', NOW); invalid.id='user:别人'; assert.equal(isValidProfile(invalid),false);
});

test('a new session inherits only its user and mode difficulty, without changing saved history', () => {
  const alice=createProfile('Alice',NOW), bob=createProfile('Bob',NOW);
  const s=answered(alice);
  const updated=rememberSession(alice,s,resolve);
  const next=createUserSession(updated,4,'north',NOW+3000,'next');
  assert.equal(next.familyLevels['matrix-choice'],2);
  assert.deepEqual(createUserSession(updated,4,'extended',NOW,'ext').familyLevels,{});
  assert.deepEqual(createUserSession(bob,4,'north',NOW,'bob').familyLevels,{});
  assert.equal(s.current.presentedLevel,1);
  assert.ok(isValidSession(next)); assert.ok(isValidProfile(updated));
  assert.throws(()=>rememberSession(bob,s,resolve));
});

test('cross-session deduplication includes aliases and stem variants before matching difficulty', () => {
  const alice=createProfile('Alice',NOW), bob=createProfile('Bob',NOW);
  const first=q('first',1,'stem-a');
  const updated=rememberSession(alice,answered(alice,first),resolve);
  const alias={...first,id:'curated-first',sourceQuestionId:first.id};
  const variant=q('variant',1,'stem-a'), unseen=q('unseen',8,'stem-b');
  assert.equal(selectUserQuestion([alias,variant,unseen],createUserSession(updated,4,'north',NOW,'next'),updated,()=>0).id,'unseen');
  assert.equal(selectUserQuestion([first,unseen],createUserSession(bob,4,'north',NOW,'b'),bob,()=>0).id,'first');
  assert.equal(selectUserQuestion([first,variant],createUserSession(updated,4,'north',NOW,'end'),updated),null);
  const review=createUserSession(updated,4,'north',NOW,'review'); review.reviewCategories=['figure'];
  assert.ok(selectUserQuestion([first,variant],review,updated));
});

test('random visual memory excludes repeated content, including finite low-level exhaustion', () => {
  const profile=createProfile('记忆测试',NOW), old=generateVisualMemory('visual-positions',1,'old');
  profile.memoryPatterns=[memorySignature(old)];
  let calls=0;
  const next=freshVisualMemory('visual-positions',1,profile,()=>calls++===0?'old':`new-${calls}`);
  assert.notEqual(memorySignature(next),memorySignature(old));
  for(let a=1;a<=9;a++) for(let b=a+1;b<=9;b++) profile.memoryPatterns.push(`visual-positions|3x3|-|${a},${b}`);
  profile.memoryPatterns=[...new Set(profile.memoryPatterns)];
  let seed=0;
  assert.equal(freshVisualMemory('visual-positions',1,profile,()=>String(seed++)),null);
});

test('merging old or concurrent progress unions seen sets and never rolls difficulty back in time', () => {
  const p=createProfile('Alice',NOW);
  const old=rememberSession(p,answered(p,q('old'), 'old-run',NOW),resolve);
  const later=rememberSession(old,answered(old,q('new',2),'new-run',NOW+3000),resolve);
  const merged=mergeProfiles(later,old);
  assert.equal(merged.levels.north['matrix-choice'].level,3);
  assert.equal(merged.seenQuestions.length,2);
  assert.ok(isValidProfile(merged));
});

test('IndexedDB creates one canonical username and atomically retains user-owned progress', async () => {
  const store=await openStore(resolve), alice=await store.enter('Alice'), same=await store.enter('ＡLICE'), bob=await store.enter('Bob');
  assert.equal(alice.id,same.id); assert.equal((await store.profiles()).length,2);
  const s=answered(alice);
  await store.save(s);
  const persisted=(await store.profiles()).find(p=>p.id===alice.id);
  assert.equal(persisted.levels.north['matrix-choice'].level,2);
  assert.ok(persisted.seenQuestions.includes(questionIdentity(q())));
  assert.equal((await store.profiles()).find(p=>p.id===bob.id).seenQuestions.length,0);
  await assert.rejects(store.remove(s.id,bob.id));
  await store.remove(s.id,alice.id);
  assert.equal((await store.all()).length,0);
  assert.equal((await store.profiles()).find(p=>p.id===alice.id).seenQuestions.length,1);
});

test('database v1 upgrade preserves legacy records; explicit claim keeps an unfinished session intact', async () => {
  const legacy = pauseSession(beginQuestion(createSession(4,NOW,'legacy'),original,NOW),NOW+2345);
  const req=indexedDB.open('cognitive-practice',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('sessions',{keyPath:'id'});
  const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(legacy);tx.oncomplete=resolve;tx.onerror=reject;});db.close();
  const store=await openStore(resolve), profile=await store.enter('小明');
  assert.deepEqual((await store.all())[0],legacy);
  const result=await store.claimLegacy(profile.id);
  assert.equal(result.count,1);
  const restored=(await store.all())[0];
  assert.equal(restored.userId,profile.id); assert.equal(restored.version,2);
  assert.equal(restored.elapsedMs,2345); assert.deepEqual(restored.current,legacy.current);
  assert.equal((await store.claimLegacy(profile.id)).count,0);
});

test('profile backup carries levels and deduplication even when all detail records were deleted', async () => {
  const p=createProfile('小明',NOW), s=finishSession(answered(p),NOW+2000);
  const profile=rememberSession(p,s,resolve);
  const text=JSON.stringify(userBackup([],profile));
  const parsed=parseUserBackup(text);
  assert.deepEqual(parsed.profiles[0],profile); assert.deepEqual(parsed.sessions,[]);
  const store=await openStore(resolve); await store.import(text);
  const saved=(await store.profiles())[0];
  assert.deepEqual(createUserSession(saved,4,'north',NOW,'new').familyLevels,{'matrix-choice':2});
  assert.equal(selectUserQuestion([q()],createUserSession(saved,4,'north',NOW,'new'),saved),null);
});

test('import merges profile progress and legacy backups without unclaiming or overwriting other users', async () => {
  const store=await openStore(resolve), alice=await store.enter('Alice');
  const s=finishSession(answered(alice),NOW+2000), profile=rememberSession(alice,s,resolve);
  await store.import(JSON.stringify(userBackup([s],profile)));
  assert.equal((await store.all()).length,1);
  const unowned={...s};delete unowned.userId;delete unowned.username;
  await store.import(JSON.stringify({app:'cognitive-practice',version:1,sessions:[unowned]}));
  assert.equal((await store.all())[0].userId,alice.id);
  const bob=createProfile('Bob',NOW), other={...s,userId:bob.id,username:bob.username,updatedAt:s.updatedAt+100};
  await assert.rejects(store.import(JSON.stringify(userBackup([other],bob))));
  assert.equal((await store.all())[0].userId,alice.id);
  assert.equal((await store.profiles()).length,1);
});

test('checkpoint and preference keys isolate users and preserve partially answered progress', () => {
  const alice=createProfile('Alice',NOW),bob=createProfile('Bob',NOW);
  const a=pauseSession(beginQuestion(createUserSession(alice,4,'north',NOW,'a'),q(),NOW),NOW+1000);
  const b=pauseSession(beginQuestion(createUserSession(bob,4,'north',NOW,'b'),q(),NOW),NOW+2000);
  a.current.draft='A'; saveCheckpoint(a);saveCheckpoint(b);
  assert.equal(readCheckpoints().length,2);assert.equal(readCheckpoint(alice.id).current.draft,'A');
  clearCheckpoint('wrong-id',alice.id);assert.ok(readCheckpoint(alice.id));
  clearCheckpoint('a',alice.id);assert.equal(readCheckpoint(alice.id),null);assert.equal(readCheckpoint(bob.id).id,'b');
  savePreferences({minutes:40,mode:'extended'},alice.id);savePreferences({minutes:90,mode:'north'},bob.id);
  assert.deepEqual(readPreferences(alice.id),{minutes:40,mode:'extended'});assert.equal(readPreferences(bob.id).minutes,90);
  saveActiveUser(alice.id);assert.equal(readActiveUser(),alice.id);
});

test('malformed profile backups reject as a whole before any existing data changes', async () => {
  const store=await openStore(resolve), profile=await store.enter('Alice');
  const s=answered(profile), backup=userBackup([s],rememberSession(profile,s,resolve));
  for(const edit of [
    data=>{data.profiles[0].id='user:bob';},
    data=>{data.sessions[0].username='Bob';},
    data=>{data.profiles[0].levels.north.constructor={level:1,at:NOW,order:'x'};},
    data=>{data.profiles[0].seenQuestions=[1];},
    data=>{data.profiles=[];},
  ]) {
    const bad=structuredClone(backup);edit(bad);
    await assert.rejects(store.import(JSON.stringify(bad)));
    assert.equal((await store.all()).length,0);
    assert.equal((await store.profiles())[0].seenQuestions.length,0);
  }
});

test('a named memory checkpoint and content ledger survive database save and backup restore', async () => {
  const store=await openStore(resolve), p=await store.enter('记忆用户');
  const question=generateVisualMemory('visual-positions',2,'round-trip');
  let session=createUserSession(p,4,'north',NOW,'memory-user');
  session=beginQuestion(session,question,NOW+112000);
  session.current.presentationAtElapsed=112000;
  session=pauseSession(session,NOW+112800);
  saveCheckpoint(session);await store.save(session);
  const saved=(await store.profiles())[0];
  assert.ok(saved.memoryPatterns.includes(memorySignature(question)));
  const text=JSON.stringify(userBackup([session],saved));
  const parsed=parseUserBackup(text);
  assert.deepEqual(parsed.sessions[0].current,session.current);
  assert.equal(parsed.sessions[0].elapsedMs,112800);
  assert.deepEqual(parsed.profiles[0].memoryPatterns,saved.memoryPatterns);
  assert.ok(isValidProfile(saved));
});

test('identical fixed memory sequences are excluded even if the question ID changes',()=>{
  const p=createProfile('序列用户',NOW);
  const fixed=bank.categories.memory.find(q=>q.type==='memory-grid');
  let session=createUserSession(p,4,'extended',NOW,'seq');
  session=beginQuestion(session,fixed,NOW+112000);
  const updated=rememberSession(p,session,resolve);
  const alias={...fixed,id:'same-sequence-different-id'};
  assert.equal(selectUserQuestion([alias],createUserSession(updated,4,'extended',NOW,'seq2'),updated),null);
});
