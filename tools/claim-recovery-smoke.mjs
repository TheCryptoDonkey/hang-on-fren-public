// Private integration gate: compiled API, disposable keys, no external network.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent} from 'nostr-tools/pure';
import {nip19} from 'nostr-tools';
const scratch = await mkdtemp(join(tmpdir(), 'hof-claim-recovery-'));
const gameKey = generateSecretKey(), playerKey = generateSecretKey();
const registry = createServer((req,res) => {res.setHeader('content-type','application/json');res.end('{"names":{}}');});
await new Promise(resolve => registry.listen(0,'127.0.0.1',resolve));
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0,'127.0.0.1',resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const journal = join(scratch,'claims.jsonl'), publications = join(scratch,'publications.jsonl');
const bootstrap = join(scratch,'bootstrap.mjs');
await writeFile(bootstrap, `
import {appendFileSync,readFileSync} from 'node:fs';
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, ...args) => {
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('external_fetch_blocked');
  return nativeFetch(url, ...args);
};
globalThis.WebSocket = class {
  constructor() {setTimeout(() => this.onopen?.(), 0);}
  send(raw) {
    const [, event] = JSON.parse(raw);
    if (event.kind === 30762 && !readFileSync(process.env.PROBE_JOURNAL,'utf8').trim().split('\\n').map(JSON.parse).some(row=>JSON.stringify(row.event)===JSON.stringify(event))) throw new Error('event_not_durable_before_publish');
    if (event.kind === 30762) appendFileSync(process.env.PROBE_PUBLICATIONS, JSON.stringify(event)+'\\n');
    setTimeout(() => this.onmessage?.({data:JSON.stringify(['OK',event.id,process.env.PROBE_ACK === '1','fixture'])}),0);
  }
  close() {}
};
await import(${JSON.stringify(new URL('../server-dist/index.js',import.meta.url).href)});
`);
let child;
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise(resolve => child.once('exit',resolve));
  child.kill('SIGTERM'); await done;
}
async function start(ack) {
  child=spawn(process.execPath,[bootstrap],{stdio:['ignore','ignore','ignore'],env:{...process.env,
    PORT:String(port),HOST:'127.0.0.1',HANGONFREN_CLAIM_LOG:journal,
    HANGONFREN_GAME_NSEC:Buffer.from(gameKey).toString('hex'),
    HANGONFREN_GAME_NPUB:nip19.npubEncode(getPublicKey(gameKey)),
    HANGONFREN_WRITE_RELAYS:'ws://private-fixture.invalid',
    HANGONFREN_PUBLISH:'1',PROBE_JOURNAL:journal,PROBE_ACK:ack?'1':'0',PROBE_PUBLICATIONS:publications}});
  for(let i=0;i<100;i++) {
    if(child.exitCode!==null) throw new Error('private_api_exited');
    try {if((await fetch(`${origin}/healthz`)).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('private_api_not_ready');
}
async function claim(body,{age=0,key=playerKey}={}) {
  const payload=JSON.stringify(body),url=`${origin}/api/claim`;
  const auth=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000)-age,content:'',tags:[
    ['u',url],['method','POST'],['payload',createHash('sha256').update(payload).digest('hex')]]},key);
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}`},body:payload});
  return {status:res.status,body:await res.json()};
}
try {
  const finished=Date.now()-7*86400000;
  const run={game:'hangonfren',run_id:'saved-run-seven-days',score:12000,distance_m:8000,duration_s:180,
    started_at:finished-190000,finished_at:finished,roses:4,overtakes:12,crashes:2,top_speed_kph:260,
    level:4,ended_by:'time',player_name:'PRIVATE',player_mode:'nostr',tour:'grand'};
  const events=async()=> (await readFile(publications,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  await start(false);
  const first=await claim(run);assert.equal(first.status,200);assert.equal(first.body.published.ok,0);
  const initial=await events();assert.equal(initial.length,1);assert(verifyEvent(initial[0]));
  assert(initial[0].tags.some(t=>t[0]==='p'&&t[1]===getPublicKey(playerKey)));
  const durable=JSON.parse((await readFile(journal,'utf8')).trim().split('\n')[0]);
  assert.equal(durable.event.id,initial[0].id);assert.equal(durable.claim.finished_at,finished);
  assert.equal(durable.key,`${getPublicKey(playerKey)}:${run.run_id}:${run.started_at}:${run.finished_at}`);
  await stop();await start(true);
  const corrected={...run,started_at:run.started_at+500,finished_at:run.finished_at+500};
  const recovered=await claim(corrected);assert.equal(recovered.status,200);assert.equal(recovered.body.published.ok,1);
  assert.equal(recovered.body.score_event_id,first.body.score_event_id);
  const duplicate=await claim(run);assert.equal(duplicate.body.score_event_id,first.body.score_event_id);
  assert.equal((await claim({...run,score:12001})).status,409);
  assert.equal((await claim({...run,finished_at:run.finished_at+1})).status,409);
  assert.equal((await claim({...run,finished_at:Date.now()+120000})).status,422);
  assert.equal((await claim(run,{age:600})).status,401);
  const published=await events();assert.equal(published.length,2);assert.equal(published[0].id,published[1].id);
  const saved=JSON.parse((await readFile(journal,'utf8')).trim().split('\n').at(-1));
  assert.equal(saved.claim.started_at,run.started_at);assert.equal(saved.claim.finished_at,run.finished_at);
  await stop();await start(true);
  const higher={...run,run_id:'parallel-higher-run',score:13000};
  const parallel=await Promise.all([claim(higher),claim(higher)]);
  assert(parallel.every(r=>r.status===200));assert.equal(parallel[0].body.score_event_id,parallel[1].body.score_event_id);
  const afterParallel=await events();assert.equal(afterParallel.length,3);
  assert(afterParallel[2].created_at>published[1].created_at);
  const lower=await claim({...run,run_id:'lower-run',score:11000});
  assert.equal(lower.status,200);assert.equal(lower.body.reason,'below_best');assert.equal((await events()).length,3);
  await stop();await start(false);
  const pending={...run,run_id:'pending-higher-run',score:14000};
  const pendingResult=await claim(pending);assert.equal(pendingResult.body.published.ok,0);
  const newest={...run,run_id:'newest-higher-run',score:15000};
  await claim(newest);assert.equal((await events()).length,5);
  await stop();await start(true);
  const superseded=await claim(pending);
  assert.equal(superseded.body.reason,'below_best');assert.equal((await events()).length,5);
  const newestResult=await claim(newest);assert.equal(newestResult.body.published.ok,1);
  const afterNewest=await events();assert.equal(afterNewest.length,6);
  assert.equal(afterNewest[4].id,afterNewest[5].id);
  // A lower score on the separate stone tour must still publish.
  const stone=await claim({...run,run_id:'stone-tour-run',tour:'stone',score:10000});
  assert.equal(stone.body.published.ok,1);assert.equal((await events()).length,7);
  await stop();
  const legacy={...durable,published:{ok:0,total:1}};delete legacy.event;
  await writeFile(journal,JSON.stringify(legacy)+'\n');await start(true);
  const legacyRetry=await claim(run);assert.equal(legacyRetry.status,409);
  assert.equal(legacyRetry.body.error,'recovery_event_missing');assert.equal((await events()).length,7);
  await stop();await writeFile(journal,JSON.stringify({...legacy,published:{ok:1,total:1}})+'\n');
  await start(true);const confirmed=await claim(run);assert.equal(confirmed.body.published.ok,1);
  assert.equal((await events()).length,7);
  await stop();await writeFile(journal,JSON.stringify({...durable,claim:{...durable.claim,score:12001}})+'\n');
  await assert.rejects(()=>start(true),/private_api_exited/);
  await stop();await writeFile(journal,'corrupt durable history\n');
  await assert.rejects(()=>start(true),/private_api_exited/);
  console.log(JSON.stringify({ok:true,runAgeDays:7,restartRecovery:true,eventDurableBeforePublish:true,sameEventRepublished:true,
    coherentClockCorrectionKeepsFirstRun:true,changedRunConflict:true,concurrentDeduplication:true,
    higherScoreTimestampOrdered:true,lowerScoreCannotReplaceBest:true,supersededPendingCannotPublish:true,
    stoneTourIndependent:true,freshNip98Required:true,legacyJournalKeyCompatible:true,
    legacyConfirmedNoRepublish:true,legacyMissingEventFailsClosed:true,corruptHistoryFailsClosed:true,eventClaimMismatchFailsClosed:true,
    externalNetwork:false,liveProvider:false}));
} finally {await stop();await new Promise(resolve=>registry.close(resolve));await rm(scratch,{recursive:true,force:true});}
