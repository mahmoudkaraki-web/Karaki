import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer, connect, sleep } from './helpers.js';

const TURN_SECRET = 'test-only-turn-secret';
let t;
let mak; let sara; let omar;
let direct; let group; let saraOmar;

before(async () => {
  t = await startTestServer({
    calls: {
      ringMs: 400, reconnectGraceMs: 150,
      stunUrls: ['stun:turn.example.test:3478'],
      turnUrls: ['turn:turn.example.test:3478?transport=udp', 'turn:turn.example.test:3478?transport=tcp'],
      turnSecret: TURN_SECRET, turnTtlSeconds: 3600,
    },
  });
  mak = await t.join('MAK', { admin: true });
  sara = await t.join('Sara', { inviter: mak });
  omar = await t.join('Omar', { inviter: mak });
  for (const [who, tok] of [[mak, 'a1'], [sara, 'b2'], [omar, 'c3']]) {
    await t.api('POST', '/me/push', { token: who.token, body: { voipToken: tok.repeat(32) } });
  }
  direct = (await t.api('POST', '/chats/direct', { token: mak.token, body: { memberId: sara.member.id } })).data.chat;
  saraOmar = (await t.api('POST', '/chats/direct', { token: sara.token, body: { memberId: omar.member.id } })).data.chat;
  group = (await t.api('POST', '/chats/group', { token: mak.token, body: { title: 'Home', memberIds: [sara.member.id, omar.member.id] } })).data.chat;
});
after(async () => { await t.close(); });

const ended = (c, callId) => c.waitFor((e) => e.type === 'call.ended' && e.callId === callId, 3000);

test('one to one: ring with a VoIP push, answer, offer and answer and ICE relayed, hang up, a line in the chat', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  t.pushes.length = 0;
  const callId = crypto.randomUUID();
  const start = await a.request({ type: 'call.start', chatId: direct.id, kind: 'video', callId });
  assert.equal(start.type, 'ack');
  assert.equal(start.call.id, callId, 'the phone chooses the id so CallKit can show the call at once');
  assert.ok(start.iceServers.length >= 1);

  const ring = await b.waitFor((e) => e.type === 'call.ring');
  assert.equal(ring.call.id, callId);
  assert.equal(ring.from.name, 'MAK');
  assert.equal(ring.call.kind, 'video');

  // the VoIP push: to Sara's VoIP token, push type voip, priority 10, delivered now or never
  await sleep(30);
  const voip = t.pushes.find((p) => p.opts?.pushType === 'voip');
  assert.ok(voip, 'a VoIP push was sent');
  assert.equal(voip.token, 'b2'.repeat(32));
  assert.deepEqual({ ...voip.opts }, { pushType: 'voip', priority: 10, expiration: 0 });
  assert.equal(voip.payload.callId, callId);
  assert.equal(voip.payload.fromName, 'MAK');
  assert.equal(voip.payload.kind, 'video');
  assert.equal(voip.payload.group, false);
  assert.ok(voip.payload.ringUntil > Date.now());

  const acc = await b.request({ type: 'call.accept', callId });
  assert.deepEqual(acc.peers, [mak.member.id], 'Sara offers to everyone already on the call');
  const st = await a.waitFor((e) => e.type === 'call.state' && e.call.members.some((m) => m.id === sara.member.id && m.state === 'joined'));
  assert.ok(st.call.answeredAt);

  b.send({ type: 'call.offer', callId, to: mak.member.id, sdp: 'v=0 offer' });
  const offer = await a.waitFor((e) => e.type === 'call.offer');
  assert.deepEqual([offer.from, offer.sdp], [sara.member.id, 'v=0 offer']);
  a.send({ type: 'call.answer', callId, to: sara.member.id, sdp: 'v=0 answer' });
  assert.equal((await b.waitFor((e) => e.type === 'call.answer')).sdp, 'v=0 answer');
  a.send({ type: 'call.ice', callId, to: sara.member.id, candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal((await b.waitFor((e) => e.type === 'call.ice')).from, mak.member.id);
  b.send({ type: 'call.media', callId, audio: true, video: false });
  const media = await a.waitFor((e) => e.type === 'call.media');
  assert.deepEqual([media.from, media.audio, media.video], [sara.member.id, true, false]);

  // the chat shows the call while it runs
  const during = (await t.api('GET', `/chats/${direct.id}`, { token: mak.token })).data.chat;
  assert.equal(during.activeCall.id, callId);
  assert.deepEqual(during.activeCall.joined.sort(), [mak.member.id, sara.member.id].sort());

  await b.request({ type: 'call.hangup', callId });
  const e1 = await ended(a, callId);
  assert.equal(e1.reason, 'ended');
  await ended(b, callId);
  const line = await a.waitFor((e) => e.type === 'message' && e.message.kind === 'call');
  const body = JSON.parse(line.message.body);
  assert.deepEqual([body.callId, body.kind, body.outcome], [callId, 'video', 'ended']);
  const after_ = (await t.api('GET', `/chats/${direct.id}`, { token: sara.token })).data.chat;
  assert.equal(after_.activeCall, null);
  assert.equal(after_.unread, 0, 'a call you were on is not unread news');
  await a.close(); await b.close();
});

test('declining ends a one to one call as declined', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const { call } = await a.request({ type: 'call.start', chatId: direct.id, kind: 'voice' });
  await b.waitFor((e) => e.type === 'call.ring' && e.call.id === call.id);
  await b.request({ type: 'call.decline', callId: call.id });
  assert.equal((await ended(a, call.id)).reason, 'declined');
  const line = await a.waitFor((e) => e.type === 'message' && e.message.kind === 'call');
  assert.equal(JSON.parse(line.message.body).outcome, 'declined');
  await a.close(); await b.close();
});

test('busy: someone already on a call is not rung, and a phone can answer busy itself', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const c = await connect(t.base, omar.token);
  // MAK and Sara are talking
  const first = (await a.request({ type: 'call.start', chatId: direct.id, kind: 'voice' })).call;
  await b.request({ type: 'call.accept', callId: first.id });
  // Omar calls Sara: she is busy, so it ends at once without ringing her
  const second = await c.request({ type: 'call.start', chatId: saraOmar.id, kind: 'voice' });
  assert.equal(second.call.endReason, 'busy');
  assert.equal((await ended(c, second.call.id)).reason, 'busy');
  assert.ok(!b.events.some((e) => e.type === 'call.ring' && e.call.id === second.call.id));
  // and Sara cannot start a second call while on one
  const third = await b.request({ type: 'call.start', chatId: saraOmar.id, kind: 'voice' });
  assert.equal(third.code, 'already_in_call');
  await a.request({ type: 'call.hangup', callId: first.id });
  await ended(b, first.id);

  // the phone itself says busy (for example a normal phone call is going on)
  const fourth = (await c.request({ type: 'call.start', chatId: saraOmar.id, kind: 'voice' })).call;
  await b.waitFor((e) => e.type === 'call.ring' && e.call.id === fourth.id);
  await b.request({ type: 'call.busy', callId: fourth.id });
  assert.equal((await ended(c, fourth.id)).reason, 'busy');
  await a.close(); await b.close(); await c.close();
});

test('nobody answers: the ring times out, the call is missed, the person away gets a missed call notification', async () => {
  const a = await connect(t.base, mak.token);
  await t.api('POST', '/me/push', { token: sara.token, body: { pushToken: 'd4'.repeat(32) } });
  t.pushes.length = 0;
  const { call } = await a.request({ type: 'call.start', chatId: direct.id, kind: 'voice' });
  const e = await ended(a, call.id);
  assert.equal(e.reason, 'missed');
  assert.equal(e.call.members.find((m) => m.id === sara.member.id).state, 'missed');
  await sleep(50);
  const alert = t.pushes.find((p) => p.opts?.pushType !== 'voip' && p.payload.aps?.alert);
  assert.ok(alert, 'a normal push about the missed call');
  assert.equal(alert.token, 'd4'.repeat(32));
  assert.equal(alert.payload.aps.alert.body, 'Missed voice call');
  assert.equal(alert.payload.aps.alert.title, 'MAK');
  await a.close();
});

test('a group call for three: ring two, both join (mesh offers), one leaves and it goes on, last two leave and it ends', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const c = await connect(t.base, omar.token);
  const { call } = await a.request({ type: 'call.start', chatId: group.id, kind: 'video' });
  for (const x of [b, c]) {
    const r = await x.waitFor((e) => e.type === 'call.ring' && e.call.id === call.id);
    assert.equal(r.group, true);
    assert.equal(r.title, 'Home');
  }
  const sj = await b.request({ type: 'call.accept', callId: call.id });
  assert.deepEqual(sj.peers, [mak.member.id]);
  // Omar first says no, then changes his mind and joins the running call
  await c.request({ type: 'call.decline', callId: call.id });
  const chatNow = (await t.api('GET', `/chats/${group.id}`, { token: omar.token })).data.chat;
  assert.equal(chatNow.activeCall.id, call.id, 'the chat shows the call is going on, so Omar can join');
  const oj = await c.request({ type: 'call.accept', callId: call.id });
  assert.deepEqual(oj.peers.sort(), [mak.member.id, sara.member.id].sort(), 'the newcomer offers to both');
  c.send({ type: 'call.offer', callId: call.id, to: mak.member.id, sdp: 'o->m' });
  c.send({ type: 'call.offer', callId: call.id, to: sara.member.id, sdp: 'o->s' });
  assert.equal((await a.waitFor((e) => e.type === 'call.offer' && e.from === omar.member.id)).sdp, 'o->m');
  assert.equal((await b.waitFor((e) => e.type === 'call.offer' && e.from === omar.member.id)).sdp, 'o->s');

  // a fifth wheel cannot slip in: only joined people get signalling
  await c.request({ type: 'call.hangup', callId: call.id });
  const left = await a.waitFor((e) => e.type === 'call.left' && e.memberId === omar.member.id);
  assert.equal(left.callId, call.id);
  const still = (await t.api('GET', `/chats/${group.id}`, { token: mak.token })).data.chat.activeCall;
  assert.deepEqual(still.joined.sort(), [mak.member.id, sara.member.id].sort());

  await b.request({ type: 'call.hangup', callId: call.id });
  assert.equal((await ended(a, call.id)).reason, 'ended');
  await a.close(); await b.close(); await c.close();
});

test('a non member cannot call, answer, join or send signalling', async () => {
  const a = await connect(t.base, mak.token);
  const c = await connect(t.base, omar.token);
  const refused = await c.request({ type: 'call.start', chatId: direct.id, kind: 'voice' });
  assert.equal(refused.code, 'not_a_member');
  const { call } = await a.request({ type: 'call.start', chatId: direct.id, kind: 'voice' });
  assert.equal((await c.request({ type: 'call.accept', callId: call.id })).code, 'not_a_member');
  assert.equal((await c.request({ type: 'call.offer', callId: call.id, to: mak.member.id, sdp: 'x' })).code, 'not_on_call');
  assert.equal((await c.request({ type: 'call.ice', callId: call.id, to: mak.member.id, candidate: { candidate: 'x' } })).code, 'not_on_call');
  assert.ok(!c.events.some((e) => e.type === 'call.ring'), 'Omar never hears the ring');
  await a.request({ type: 'call.hangup', callId: call.id });
  assert.equal((await ended(a, call.id)).reason, 'cancelled');
  await a.close(); await c.close();
});

test('a second call in the same chat joins the running one instead', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const { call } = await a.request({ type: 'call.start', chatId: direct.id, kind: 'voice' });
  const clash = await b.request({ type: 'call.start', chatId: direct.id, kind: 'voice' });
  assert.equal(clash.code, 'call_in_progress');
  assert.equal(clash.call.id, call.id);
  await a.request({ type: 'call.hangup', callId: call.id });
  await ended(b, call.id);
  await a.close(); await b.close();
});

test('a phone that drops off mid call counts as gone after a short grace', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const { call } = await a.request({ type: 'call.start', chatId: direct.id, kind: 'voice' });
  await b.request({ type: 'call.accept', callId: call.id });
  await b.close();
  assert.equal((await ended(a, call.id)).reason, 'ended');
  await a.close();
});

test('TURN credentials: short lived, and the password is the HMAC coturn expects', async () => {
  const r = await t.api('GET', '/calls/ice', { token: sara.token });
  assert.equal(r.status, 200);
  const [stun, turn] = r.data.iceServers;
  assert.deepEqual(stun.urls, ['stun:turn.example.test:3478']);
  assert.equal(turn.urls.length, 2);
  const [expiry, who] = turn.username.split(':');
  assert.equal(Number(who), sara.member.id);
  const left = Number(expiry) - Math.floor(Date.now() / 1000);
  assert.ok(left > 3500 && left <= 3600, `expires in about an hour (${left} s)`);
  const expected = crypto.createHmac('sha1', TURN_SECRET).update(turn.username).digest('base64');
  assert.equal(turn.credential, expected);
  assert.equal((await t.api('GET', '/calls/ice', {})).status, 401, 'nothing for strangers');
});

test('the relay settings come only from the environment, credentials last two hours by default', async () => {
  const { loadConfig } = await import('../src/config.js');
  const bare = loadConfig({});
  assert.deepEqual([bare.calls.turnUrls, bare.calls.turnSecret, bare.calls.stunUrls], [[], '', []], 'nothing built in');
  assert.equal(bare.calls.turnTtlSeconds, 7200);
  const box = loadConfig({
    STUN_URLS: 'stun:20.74.255.57:3478',
    TURN_URLS: 'turn:20.74.255.57:3478?transport=udp,turn:20.74.255.57:3478?transport=tcp',
    TURN_SECRET: 'from-turn-env',
  });
  assert.deepEqual(box.calls.turnUrls, ['turn:20.74.255.57:3478?transport=udp', 'turn:20.74.255.57:3478?transport=tcp']);
  assert.deepEqual(box.calls.stunUrls, ['stun:20.74.255.57:3478']);
  const { turnCredentials } = await import('../src/calls.js');
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  const c = turnCredentials({ secret: box.calls.turnSecret, ttlSeconds: box.calls.turnTtlSeconds, memberId: 7, nowMs: now });
  assert.equal(c.username, `${now / 1000 + 7200}:7`);
  assert.equal(c.credential, crypto.createHmac('sha1', 'from-turn-env').update(c.username).digest('base64'));
});
