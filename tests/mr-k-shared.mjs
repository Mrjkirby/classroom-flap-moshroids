import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Match } from '../server/src/match.mjs';
import { MrKShake } from '../src/mrKShake.js';
import { syncMrKBlasts } from '../src/mrKBlast.js';
import { createMrKHitQueue } from '../src/mrKHitQueue.js';
import { createCollisionSystem } from '../src/collisionSystem.js';
import { mrKPosition } from '../src/mrKRules.js';

for (const room of ['classroom', 'classroom-teams', 'classroom-1vw']) {
  test(`${room}: combined hits share health and launch one authoritative wave`, () => {
    let now=18_001_000;
    const match=new Match(room,{clock:()=>now}), messages=new Map();
    for(const id of ['a','b','c']) {
      const received=[];messages.set(id,received);
      match.join({studentId:id,displayName:id},{send:v=>received.push(structuredClone(v)),close(){}});
    }
    const hit=(player,batch,count,id='epoch-10-mrk-0')=>match.shared.apply(match.players.get(player),'mrkHit',{id,batchId:batch,count});
    assert.equal(hit('a','batch-a-0001',40),true);
    assert.equal(hit('a','batch-a-0001',40),true,'duplicate retry is acknowledged without counting twice');
    assert.equal(hit('b','batch-b-0001',20),true);
    for(const id of ['a','b','c']) assert.equal(messages.get(id).filter(v=>v.channel==='mrk').at(-1).state.health,940);
    const late=[];match.shared.snapshot({send:v=>late.push(structuredClone(v))});
    assert.equal(late.find(v=>v.channel==='mrk').state.health,940,'late join and reconnect see the same counter');
    assert.equal(hit('b','invalid-0001',41),false);
    for(let i=0;i<23;i++) assert.equal(hit(i%2?'a':'b',`batch-${String(i).padStart(4,'0')}`,40),true);
    assert.equal(hit('c','finisher-001',20),true);
    const key='epoch-10-mrk-0', event=match.shared.destroyed.get(key);
    assert.equal(event.destroyedBy,'c');
    assert.deepEqual({x:event.x,y:event.y},mrKPosition(now,18_000_000,0,2880,1620));
    assert.equal(match.shared.destroyed.size,1);
    assert.equal(match.shared.missiles.active.size,20);
    assert.equal(hit('a','too-late-001',1),false);
    assert.equal(match.shared.apply(match.players.get('a'),'asteroidClaim',{id:key}),false);
    const other=new Match(room==='classroom'?'classroom-teams':'classroom',{clock:()=>now});
    assert.equal(other.shared.destroyed.size,0,'another room sees no event');

    for (const id of ['a','b','c']) {
      const shake=new MrKShake();shake.activate(now-1);
      let explosions = 0;
      syncMrKBlasts(shake,match.shared.destroyed,now,()=>explosions++);
      syncMrKBlasts(shake,match.shared.destroyed,now,()=>explosions++);
      assert.equal(explosions,1,`${id} receives one visual blast`);
      const snapshot=messages.get(id).filter(value=>value.channel==='missiles').at(-1);
      assert.equal(snapshot.missiles.length,20,`${id} receives the same server wave`);
    }
    const newPlayer=new MrKShake();newPlayer.activate(now+1);let replayed=0;
    syncMrKBlasts(newPlayer,match.shared.destroyed,now+2,()=>replayed++);
    assert.equal(replayed,0,'old blasts do not replay on a new join');
    assert.equal(hit('a','nextgen-0001',1,'epoch-10-mrk-1'),false,'respawn delay applies');
    now+=60_000;
    assert.equal(hit('a','nextgen-0001',1,'epoch-10-mrk-1'),true);
    assert.equal(match.shared.currentMrK(now).health,999);
  });
}

test('only the local pilot reports Mr. K hits, including reconstructed Team volleys', () => {
  const rock={x:100,y:100,radius:105,health:1000};
  const bullet=owner=>({owner,x:100,y:100,previousX:100,previousY:100,radius:3});
  const world={mrK:rock,bullets:[bullet('A'),bullet('remote'),bullet('A')],asteroids:[],missiles:[],ships:[],scores:{A:0}};
  let hits=0;
  const collision=createCollisionSystem({world,getWorldWidth:()=>2880,getWorldHeight:()=>1620,
    destroyAsteroid:()=>false,isAsteroidDestructionPending:()=>false,playerDestroyed:()=>false,
    addExplosion(){},addRockExplosion(){},releaseMissiles(){},advanceAsteroidsFromMrK(){},
    updateScores(){},publishPlayerState(){},recordSharedMrKHits:n=>{hits+=n;}});
  collision.resolveBulletMrKCollisions();
  assert.equal(hits,2);assert.equal(world.scores.A,2);assert.equal(rock.health,1000);
});

test('a small shared-clock offset does not drop the missile wave', () => {
  const shake = new MrKShake(); shake.activate(900);
  const events = new Map([['epoch-10-mrk-0', { destroyedAt: 1001, x: 20, y: 30 }]]);
  let waves = 0;
  syncMrKBlasts(shake, events, 1000, () => waves++);
  assert.equal(waves, 1);
});

test('hit batches retry the same ID after a lost acknowledgement and stop at a new rock', async () => {
  let time=0;const calls=[];let result=false;
  const queue=createMrKHitQueue({now:()=>time,makeId:()=>`batch-${calls.length}-12345`,request:async(_action,data)=>{calls.push(data);return result;}});
  queue.add('epoch-10-mrk-0',4);queue.flush();
  await new Promise(resolve=>setImmediate(resolve));
  time=600;result=true;queue.flush();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
  queue.add('epoch-10-mrk-0',2);queue.reset('epoch-10-mrk-1');queue.flush();
  assert.equal(calls.length,2,'a stale generation cannot damage its successor');
});
