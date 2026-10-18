import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, connect, sleep } from './helpers.js';

let t;
let mak; let sara; let omar;
before(async () => {
  t = await startTestServer({ limits: { photoBytes: 64 * 1024 } });
  mak = await t.join('MAK', { admin: true });
  sara = await t.join('Sara', { inviter: mak });
  omar = await t.join('Omar', { inviter: mak });
});
after(async () => { await t.close(); });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(300, 1)]);

async function upload(token, kind, bytes, fields = {}) {
  const fd = new FormData();
  fd.append('kind', kind);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  fd.append('file', new Blob([bytes]), kind === 'photo' ? 'p.jpg' : 'v.m4a');
  return t.api('POST', '/media', { token, raw: fd });
}

test('two members: a direct chat, live delivery, delivered and read ticks, typing', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const chat = (await t.api('POST', '/chats/direct', { token: mak.token, body: { memberId: sara.member.id } })).data.chat;
  assert.equal(chat.kind, 'direct');
  assert.deepEqual(chat.members.map((m) => m.name).sort(), ['MAK', 'Sara']);
  // opening it again gives the same chat, from either side
  const same = (await t.api('POST', '/chats/direct', { token: sara.token, body: { memberId: mak.member.id } })).data.chat;
  assert.equal(same.id, chat.id);
  await b.waitFor((e) => e.type === 'chat' && e.chat.id === chat.id);

  // typing reaches Sara, not MAK himself
  a.send({ type: 'typing', chatId: chat.id, on: true });
  const typing = await b.waitFor((e) => e.type === 'typing');
  assert.deepEqual([typing.chatId, typing.memberId, typing.on], [chat.id, mak.member.id, true]);

  const ack = await a.request({ type: 'send', chatId: chat.id, body: 'Dinner at 8?', clientId: 'mak-0001-abcd' });
  assert.equal(ack.type, 'ack');
  const sent = ack.message;
  assert.equal(sent.body, 'Dinner at 8?');

  const got = await b.waitFor((e) => e.type === 'message');
  assert.equal(got.message.id, sent.id);
  assert.equal(got.message.senderId, mak.member.id);

  // Sara's phone has it: one tick becomes two
  b.send({ type: 'delivered', chatId: chat.id, upTo: sent.id });
  const delivered = await a.waitFor((e) => e.type === 'receipt' && e.memberId === sara.member.id);
  assert.equal(delivered.delivered, sent.id);
  assert.equal(delivered.read, 0);

  // Sara opens the chat: read
  b.send({ type: 'read', chatId: chat.id, upTo: sent.id });
  const read = await a.waitFor((e) => e.type === 'receipt' && e.memberId === sara.member.id && e.read === sent.id);
  assert.equal(read.delivered, sent.id);

  // a resend of the same message (lost ack) does not make a double
  const retry = await a.request({ type: 'send', chatId: chat.id, body: 'Dinner at 8?', clientId: 'mak-0001-abcd' });
  assert.equal(retry.message.id, sent.id);

  // Sara answers over the plain HTTP route too
  const reply = await t.api('POST', `/chats/${chat.id}/messages`, { token: sara.token, body: { body: 'Yes!' } });
  assert.equal(reply.status, 200);
  const live = await a.waitFor((e) => e.type === 'message' && e.message.body === 'Yes!');
  assert.equal(live.message.senderId, sara.member.id);

  const list = (await t.api('GET', '/chats', { token: mak.token })).data.chats;
  const mine = list.find((c) => c.id === chat.id);
  assert.equal(mine.unread, 1);
  assert.equal(mine.last.body, 'Yes!');
  assert.equal(mine.receipts[sara.member.id].read, reply.data.message.id, 'her own reply moves her read mark too');

  await a.close(); await b.close();
});

test('history comes in pages, newest first, and can catch up after a gap', async () => {
  const chat = (await t.api('POST', '/chats/direct', { token: sara.token, body: { memberId: omar.member.id } })).data.chat;
  for (let i = 1; i <= 120; i++) t.srv.family.sendMessage(t.srv.family.authenticate(sara.token).member, chat.id, { body: `n${i}` });

  const p1 = (await t.api('GET', `/chats/${chat.id}/messages`, { token: omar.token })).data;
  assert.equal(p1.messages.length, 50);
  assert.equal(p1.hasMore, true);
  assert.equal(p1.messages.at(-1).body, 'n120');
  assert.equal(p1.messages[0].body, 'n71');
  const p2 = (await t.api('GET', `/chats/${chat.id}/messages?before=${p1.messages[0].id}`, { token: omar.token })).data;
  assert.equal(p2.messages[0].body, 'n21');
  const p3 = (await t.api('GET', `/chats/${chat.id}/messages?before=${p2.messages[0].id}`, { token: omar.token })).data;
  assert.equal(p3.messages.length, 20);
  assert.equal(p3.hasMore, false);
  assert.equal(p3.messages[0].body, 'n1');

  const gap = (await t.api('GET', `/chats/${chat.id}/messages?after=${p1.messages[40].id}`, { token: omar.token })).data;
  assert.deepEqual(gap.messages.map((m) => m.body), ['n112', 'n113', 'n114', 'n115', 'n116', 'n117', 'n118', 'n119', 'n120']);
});

test('three members in a group: everyone gets every message and the ticks of each member', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const c = await connect(t.base, omar.token);
  const g = (await t.api('POST', '/chats/group', { token: mak.token, body: { title: 'Home', memberIds: [sara.member.id, omar.member.id] } })).data.chat;
  assert.equal(g.kind, 'group');
  assert.equal(g.members.length, 3);
  for (const x of [b, c]) await x.waitFor((e) => e.type === 'chat' && e.chat.id === g.id);

  const fromSara = (await b.request({ type: 'send', chatId: g.id, body: 'Who is picking up bread?' })).message;
  for (const x of [a, c]) assert.equal((await x.waitFor((e) => e.type === 'message' && e.message.id === fromSara.id)).message.body, 'Who is picking up bread?');
  const fromOmar = (await c.request({ type: 'send', chatId: g.id, body: 'Me' })).message;
  for (const x of [a, b]) await x.waitFor((e) => e.type === 'message' && e.message.id === fromOmar.id);

  // MAK reads; Sara sees MAK's read tick but Omar has not read her message yet... Omar's send marked it read
  a.send({ type: 'read', chatId: g.id, upTo: fromOmar.id });
  const r = await b.waitFor((e) => e.type === 'receipt' && e.memberId === mak.member.id && e.read === fromOmar.id);
  assert.equal(r.chatId, g.id);
  const summary = (await t.api('GET', `/chats/${g.id}`, { token: sara.token })).data.chat;
  assert.equal(summary.receipts[mak.member.id].read, fromOmar.id);
  assert.equal(summary.receipts[omar.member.id].read, fromOmar.id, 'sending a message marks everything before it read');
  assert.equal(summary.unread, 1, 'Omar\'s "Me" is unread for Sara');

  await a.close(); await b.close(); await c.close();
});

test('group changes: rename, remove a member (who is then shut out), add them back', async () => {
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const c = await connect(t.base, omar.token);
  const g = (await t.api('POST', '/chats/group', { token: sara.token, body: { title: 'Trip', memberIds: [mak.member.id, omar.member.id] } })).data.chat;

  const renamed = await t.api('PATCH', `/chats/${g.id}`, { token: omar.token, body: { title: 'Summer trip' } });
  assert.equal(renamed.data.chat.title, 'Summer trip');
  for (const x of [a, b, c]) {
    const line = await x.waitFor((e) => e.type === 'message' && e.message.chatId === g.id && e.message.kind === 'system' && /renamed/.test(e.message.body));
    assert.equal(line.message.body, 'Omar renamed the group to Summer trip');
  }

  // Omar did not start the group and is not an admin: he cannot remove Sara
  assert.equal((await t.api('DELETE', `/chats/${g.id}/members/${sara.member.id}`, { token: omar.token })).status, 403);
  // Sara started it: she removes Omar
  const rm = await t.api('DELETE', `/chats/${g.id}/members/${omar.member.id}`, { token: sara.token });
  assert.equal(rm.status, 200);
  assert.equal(rm.data.chat.members.length, 2);
  await c.waitFor((e) => e.type === 'chat_removed' && e.chatId === g.id);

  const sendAfter = await c.request({ type: 'send', chatId: g.id, body: 'still here?' });
  assert.equal(sendAfter.type, 'error');
  assert.equal(sendAfter.code, 'not_a_member');
  assert.equal((await t.api('GET', `/chats/${g.id}/messages`, { token: omar.token })).status, 403);
  assert.ok(!(await t.api('GET', '/chats', { token: omar.token })).data.chats.some((x) => x.id === g.id));

  // messages after the removal do not reach Omar
  await b.request({ type: 'send', chatId: g.id, body: 'Omar cannot see this' });
  await a.waitFor((e) => e.type === 'message' && e.message.body === 'Omar cannot see this');
  await sleep(100);
  assert.ok(!c.events.some((e) => e.type === 'message' && e.message.body === 'Omar cannot see this'));

  // MAK adds him back
  const add = await t.api('POST', `/chats/${g.id}/members`, { token: mak.token, body: { memberId: omar.member.id } });
  assert.equal(add.data.chat.members.length, 3);
  await c.waitFor((e) => e.type === 'chat' && e.chat.id === g.id);
  assert.equal((await t.api('GET', `/chats/${g.id}`, { token: omar.token })).data.chat.unread, 0, 'a returning member starts with nothing unread');

  // direct chats cannot be renamed or grown
  const d = (await t.api('POST', '/chats/direct', { token: mak.token, body: { memberId: omar.member.id } })).data.chat;
  assert.equal((await t.api('PATCH', `/chats/${d.id}`, { token: mak.token, body: { title: 'x' } })).data.error, 'not_a_group');

  await a.close(); await b.close(); await c.close();
});

test('a non member is refused everything in a chat: read, send, ticks, typing, its photos', async () => {
  const d = (await t.api('POST', '/chats/direct', { token: mak.token, body: { memberId: sara.member.id } })).data.chat;
  const up = await upload(mak.token, 'photo', JPEG, { width: 10, height: 10 });
  assert.equal(up.status, 200);
  const photo = (await t.api('POST', `/chats/${d.id}/messages`, { token: mak.token, body: { kind: 'photo', mediaId: up.data.media.id, body: 'look' } })).data.message;
  assert.equal(photo.media.mime, 'image/jpeg');

  const o = omar.token;
  assert.equal((await t.api('GET', `/chats/${d.id}`, { token: o })).status, 403);
  assert.equal((await t.api('GET', `/chats/${d.id}/messages`, { token: o })).status, 403);
  assert.equal((await t.api('POST', `/chats/${d.id}/messages`, { token: o, body: { body: 'hi' } })).status, 403);
  assert.equal((await t.api('POST', `/chats/${d.id}/read`, { token: o, body: { upTo: 999 } })).status, 403);
  assert.equal((await t.api('GET', `/media/${up.data.media.id}`, { token: o })).status, 403);
  assert.equal((await t.api('GET', '/chats/999999', { token: o })).status, 404);
  assert.equal((await t.api('GET', '/chats', {})).status, 401, 'nothing at all without signing in');

  const c = await connect(t.base, o);
  for (const type of ['send', 'read', 'typing']) {
    const r = await c.request({ type, chatId: d.id, body: 'x', upTo: 1, on: true });
    assert.equal(r.code, 'not_a_member', type);
  }
  await c.close();

  // the members of the chat can fetch the photo
  const ok = await t.api('GET', `/media/${up.data.media.id}`, { token: sara.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.ok(ok.data.equals(JPEG));
});

test('photos and voice notes: types checked from the bytes, sizes limited', async () => {
  const fake = await upload(mak.token, 'photo', Buffer.from('this is not really a picture at all'));
  assert.equal(fake.status, 415);
  const big = await upload(mak.token, 'photo', Buffer.concat([JPEG, Buffer.alloc(70 * 1024)]));
  assert.equal(big.status, 413);
  const long = await upload(mak.token, 'voice', M4A, { durationMs: 3_600_000 });
  assert.equal(long.status, 413);

  const voice = await upload(mak.token, 'voice', M4A, { durationMs: 4200 });
  assert.equal(voice.status, 200);
  assert.equal(voice.data.media.mime, 'audio/mp4');
  assert.equal(voice.data.media.durationMs, 4200);
  const d = (await t.api('POST', '/chats/direct', { token: mak.token, body: { memberId: sara.member.id } })).data.chat;
  // someone else cannot send MAK's upload, and a voice file cannot go out as a photo
  assert.equal((await t.api('POST', `/chats/${d.id}/messages`, { token: sara.token, body: { kind: 'voice', mediaId: voice.data.media.id } })).data.error, 'bad_media');
  assert.equal((await t.api('POST', `/chats/${d.id}/messages`, { token: mak.token, body: { kind: 'photo', mediaId: voice.data.media.id } })).data.error, 'bad_media');
  const sent = await t.api('POST', `/chats/${d.id}/messages`, { token: mak.token, body: { kind: 'voice', mediaId: voice.data.media.id } });
  assert.equal(sent.data.message.kind, 'voice');
  assert.equal((await t.api('GET', `/media/${voice.data.media.id}`, { token: sara.token })).status, 200);
});

test('push goes to members who are away, with the unread count as the badge', async () => {
  const away = await t.api('POST', '/me/push', { token: sara.token, body: { pushToken: 'a'.repeat(64) } });
  assert.equal(away.status, 200);
  await t.api('POST', '/me/push', { token: omar.token, body: { pushToken: 'b'.repeat(64) } });
  assert.equal((await t.api('POST', '/me/push', { token: omar.token, body: { pushToken: 'not hex' } })).status, 400);

  const omarLive = await connect(t.base, omar.token); // Omar has the app open, Sara does not
  const g = (await t.api('POST', '/chats/group', { token: mak.token, body: { title: 'Cousins', memberIds: [sara.member.id, omar.member.id] } })).data.chat;
  t.pushes.length = 0;
  await t.api('POST', `/chats/${g.id}/messages`, { token: mak.token, body: { body: 'See you Sunday' } });
  await sleep(50);
  assert.equal(t.pushes.length, 1);
  const p = t.pushes[0];
  assert.equal(p.token, 'a'.repeat(64));
  assert.equal(p.payload.aps.alert.title, 'Cousins');
  assert.equal(p.payload.aps.alert.subtitle, 'MAK');
  assert.equal(p.payload.aps.alert.body, 'See you Sunday');
  assert.equal(p.payload.aps.badge, (await t.api('GET', '/me', { token: sara.token })).data.unread);
  assert.equal(p.payload.chatId, g.id);
  await omarLive.close();
});
