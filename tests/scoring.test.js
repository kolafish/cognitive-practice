import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSession, beginQuestion, submitAnswer, finishSession, advanceSession, summarize, isValidSession, pauseSession } from '../public/engine.js';
import { LEVEL_POINTS, levelPoints, scoreSummary, recordScore, scoreByFamily } from '../public/scoring.js';
import { createProfile, createUserSession, rememberSession, userBackup, parseUserBackup } from '../public/profiles.js';
import { openStore } from '../public/storage.js';

const NOW=Date.parse('2026-11-01T04:00:00Z');
const question=(id,level=1,category='figure',family='matrix-choice')=>({id,sourceId:'test',type:'choice',category,prompt:'Choose A',level,familyLevel:level,taskFamily:family,choices:[{id:'A',text:'yes'},{id:'B',text:'no'}],answer:'A'});
const start=()=>createSession(4,NOW,'score-run','north');

test('eight linear reward weights are transparent and score the actual item, not the target',()=>{
  assert.deepEqual(LEVEL_POINTS,[10,20,30,40,50,60,70,80]);
  assert.equal(levelPoints(0),0);assert.equal(levelPoints(9),0);assert.equal(levelPoints('4'),0);
  let s=start();s.familyLevels['matrix-choice']=3;
  const q={...question('gap',8),familyLevel:4};
  s=beginQuestion(s,q,NOW);
  assert.equal(s.current.scoreMaxPoints,40);
  const result=submitAnswer(s,q,'A',NOW+1000);
  assert.equal(result.response.levelBefore,3);assert.equal(result.response.levelAfter,4);
  assert.equal(result.response.presentedLevel,4);assert.equal(result.response.scorePoints,40);
  assert.equal(summarize(result.session,NOW+1000).points,40);
});

test('correct answers award all eight item values while incorrect and skipped answers award zero',()=>{
  let s=start(),elapsed=0;
  for(let level=1;level<=8;level++){
    const q=question(`correct-${level}`,level);s=beginQuestion(s,q,NOW+elapsed++);
    s=submitAnswer(s,q,'A',NOW+elapsed++).session;
  }
  for(const [id,answer,skip] of [['wrong','B',false],['skip',null,true]]){
    const q=question(id,8);s=beginQuestion(s,q,NOW+elapsed++);s=submitAnswer(s,q,answer,NOW+elapsed++,skip).session;
  }
  const info=summarize(s,NOW+elapsed);
  assert.equal(info.points,360);assert.equal(info.newPoints,360);assert.equal(info.reviewPoints,0);assert.equal(info.legacyPoints,0);
  assert.equal(info.correct,8);assert.equal(info.incorrect,1);assert.equal(info.skipped,1);
  assert.ok(isValidSession(s));
});

test('a double submit and late answer cannot award points twice; deadlines preserve zero-point items',()=>{
  const q=question('one',5);let s=beginQuestion(start(),q,NOW);
  s=submitAnswer(s,q,'A',NOW+1000).session;
  assert.equal(submitAnswer(s,q,'A',NOW+2000).rejected,true);
  const next=question('late',8);s=beginQuestion(s,next,NOW+3000);
  s=submitAnswer(s,next,'A',NOW+80000).session;
  assert.equal(s.responses.at(-1).status,'unanswered');assert.equal(s.responses.at(-1).scorePoints,0);
  assert.equal(summarize(s,NOW+80000).points,50);
  assert.ok(isValidSession(s));
});

test('new-question and review points remain separate after the session changes mode mid-section',()=>{
  let s=start();const fresh=question('fresh',2),review=question('review',3);
  s=beginQuestion(s,fresh,NOW);s=submitAnswer(s,fresh,'A',NOW+1000).session;
  s.reviewCategories=['figure'];
  s=beginQuestion(s,review,NOW+2000);s=submitAnswer(s,review,'A',NOW+3000).session;
  const info=scoreSummary(s);
  assert.equal(info.points,50);assert.equal(info.newPoints,20);assert.equal(info.reviewPoints,30);
  assert.equal(s.responses[0].scorePracticeKind,'new');assert.equal(s.responses[1].scorePracticeKind,'review');
});

test('legacy records are estimated without mutation, including records from an older tab',()=>{
  const q=question('legacy',4);
  let s=beginQuestion(createSession(4,NOW,'legacy'),q,NOW);
  s=submitAnswer(s,q,'A',NOW+1000).session;
  const before=JSON.stringify(s), info=scoreSummary(s);
  assert.equal(info.points,40);assert.equal(info.legacyPoints,40);assert.equal(info.newPoints,0);assert.equal(info.hasEstimated,true);
  assert.equal(JSON.stringify(s),before);
  // Older engines retain the session version while omitting newly added metadata.
  const mixed=submitAnswer(beginQuestion(start(),q,NOW),q,'A',NOW+1000).session;
  for(const key of ['scorePoints','scoreMaxPoints','scorePracticeKind']) delete mixed.responses[0][key];
  mixed.current=null;
  assert.ok(isValidSession(mixed));assert.equal(recordScore(mixed,mixed.responses[0]).estimated,true);
});

test('task families and each actual difficulty retain their own accuracy denominators',()=>{
  let s=start();const a=question('a',1),b=question('b',2),c=question('c',4);
  for(const [i,q,answer] of [[0,a,'A'],[1,b,'B'],[2,c,'A']]){s=beginQuestion(s,q,NOW+i*2000);s=submitAnswer(s,q,answer,NOW+i*2000+1000).session;}
  s=advanceSession(s,NOW+80000);
  const m=question('memory',8,'memory','visual-recognition');s=beginQuestion(s,m,NOW+80000);s=submitAnswer(s,m,'A',NOW+81000).session;
  const families=scoreByFamily(s);
  assert.equal(families.length,2);assert.equal(families[0].points,50);assert.equal(families[0].levels[1].incorrect,1);
  assert.equal(families[0].levels[3].correct,1);assert.equal(families[1].points,80);
  assert.equal(families[1].accuracy,1);assert.equal(families[0].attempted,3);
  const info=summarize(s,NOW+81000);
  assert.equal(info.points,130);assert.equal(info.sections[0].points,50);assert.equal(info.sections[1].points,80);
});

test('manual end, pause and unfinished questions retain their actual value without giving points',()=>{
  const q=question('unfinished',7);const s=finishSession(beginQuestion(start(),q,NOW),NOW+1000);
  assert.equal(s.responses[0].scoreMaxPoints,70);assert.equal(s.responses[0].scorePoints,0);
  assert.equal(summarize(s).points,0);assert.ok(isValidSession(s));
  const paused=pauseSession(beginQuestion(start(),q,NOW),NOW+500);
  assert.equal(paused.current.scoreMaxPoints,70);assert.ok(isValidSession(paused));
});

test('backup and IndexedDB preserve awarded values, independent of a subsequent difficulty change',async()=>{
  globalThis.indexedDB=new IDBFactory();const store=await openStore();const p=await store.enter('积分测试');
  const q=question('stored',4);let s=beginQuestion(createUserSession(p,4,'north',NOW,'stored-run'),q,NOW);
  s=submitAnswer(s,q,'A',NOW+1000).session;s=finishSession(s,NOW+2000);
  const profile=rememberSession(p,s);
  const backup=JSON.stringify(userBackup([s],profile));
  assert.equal(parseUserBackup(backup).sessions[0].responses[0].scorePoints,40);
  await store.import(backup);await store.import(backup);
  const saved=(await store.all())[0];assert.equal(saved.responses[0].scorePoints,40);assert.equal(scoreSummary(saved).points,40);
  saved.familyLevels['matrix-choice']=8;assert.equal(scoreSummary(saved).points,40);
  assert.equal((await store.all()).length,1);
});

test('unsupported rules, forged awards and partially missing metadata reject safely',()=>{
  const q=question('invalid',4);const base=submitAnswer(beginQuestion(start(),q,NOW),q,'A',NOW+1000).session;
  for(const edit of [s=>{s.scoreRuleVersion=99;},s=>{s.responses[0].scorePoints=999;},s=>{s.responses[0].scoreMaxPoints=80;},s=>{s.responses[0].scorePracticeKind='fake';},s=>{delete s.responses[0].scorePoints;},s=>{s.current.scoreMaxPoints=80;}]){
    const bad=structuredClone(base);edit(bad);assert.equal(isValidSession(bad),false);
    assert.throws(()=>parseUserBackup(JSON.stringify(userBackup([bad],createProfile('积分测试',NOW)))));
  }
});
