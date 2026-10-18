// Code only sign in (MAK, 18 Oct 2026: "I'd rather have download link and invite code to login"):
// the invite code alone makes the member and signs the phone in; an admin's sign in code puts a
// new phone into an existing member's account; the join page and the privacy page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestServer, connect } from './helpers.js';
import { openDb } from '../src/db.js';

const env = { INSTALL_URL: 'https://testflight.apple.com/join/TESTLINK' };
let t;
let mak;
before(async () => {
  t = await startTestServer({ env, limits: { doorTries: 40 } });
  mak = await t.join('MAK', { admin: true }); // MAK's account from the Apple days keeps working
});
after(async () => { await t.close(); });

const codeLogin = (body) => t.api('POST', '/auth/code', { body });

test('an invite code alone makes the member and signs this phone in, once', async () => {
  const inv = (await t.api('POST', '/invites', { token: mak.token, body: { nameHint: 'Sara' } })).data;
  const r = await codeLogin({ code: inv.code.toLowerCase(), name: 'Sara K', deviceLabel: 'iPhone 17' });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.name, 'Sara K', 'the name typed in the app wins over the invite hint');
  assert.equal(r.data.member.isAdmin, false);
  const me = await t.api('GET', '/me', { token: r.data.token });
  assert.equal(me.data.member.id, r.data.member.id);
  assert.ok(me.data.members.some((m) => m.name === 'MAK'));

  const again = await codeLogin({ code: inv.code, name: 'Someone else' });
  assert.equal(again.status, 404, 'single use');
  assert.equal(again.data.error, 'invite_invalid');

  // no name typed: the invite's name is used
  const inv2 = (await t.api('POST', '/invites', { token: mak.token, body: { nameHint: 'Omar' } })).data;
  assert.equal((await codeLogin({ code: inv2.code })).data.member.name, 'Omar');
});

test('expired and revoked codes are refused', async () => {
  const old = t.srv.family.createInvite(null, { nameHint: 'Late' });
  t.srv.db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1, old.id);
  assert.equal((await codeLogin({ code: old.code })).status, 404);
  const gone = t.srv.family.createInvite(null, {});
  await t.api('DELETE', `/invites/${gone.id}`, { token: mak.token });
  assert.equal((await codeLogin({ code: gone.code })).status, 404);
});

test('a new phone: the admin makes a sign in code for a member, and it opens that same account', async () => {
  const inv = (await t.api('POST', '/invites', { token: mak.token, body: { nameHint: 'Lina' } })).data;
  const lina = (await codeLogin({ code: inv.code, name: 'Lina' })).data;
  // Lina has a chat with MAK and a message in it
  const chat = (await t.api('POST', '/chats/direct', { token: lina.token, body: { memberId: mak.member.id } })).data.chat;
  await t.api('POST', `/chats/${chat.id}/messages`, { token: lina.token, body: { body: 'my old phone' } });

  // only an admin can make one
  assert.equal((await t.api('POST', `/members/${mak.member.id}/signin-code`, { token: lina.token })).status, 403);
  const sc = await t.api('POST', `/members/${lina.member.id}/signin-code`, { token: mak.token });
  assert.equal(sc.status, 200);
  assert.equal(sc.data.forMember, lina.member.id);
  assert.match(sc.data.link, /\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const check = (await t.api('GET', `/invites/${sc.data.code}/check`)).data;
  assert.equal(check.kind, 'device', 'the app knows this code signs into an existing account');

  // the new phone: same member, same chats and history; a name typed does not rename her
  const phone2 = await codeLogin({ code: sc.data.code, name: 'Typed by mistake', deviceLabel: 'new iPhone' });
  assert.equal(phone2.status, 200);
  assert.equal(phone2.data.member.id, lina.member.id);
  assert.equal(phone2.data.member.name, 'Lina');
  const hist = (await t.api('GET', `/chats/${chat.id}/messages`, { token: phone2.data.token })).data;
  assert.ok(hist.messages.some((m) => m.body === 'my old phone'));
  // both phones stay signed in; nobody new joined the family
  assert.equal((await t.api('GET', '/me', { token: lina.token })).status, 200);
  const before_ = (await t.api('GET', '/members', { token: mak.token })).data.members.length;
  assert.equal(before_, (await t.api('GET', '/members', { token: mak.token })).data.members.length);
  assert.equal((await codeLogin({ code: sc.data.code })).status, 404, 'single use');

  // the live socket treats the new phone as Lina
  const live = await connect(t.base, phone2.data.token);
  assert.equal(live.ready.member.id, lina.member.id);
  await live.close();
});

test('a sign in code for someone removed from the family does not work', async () => {
  const inv = (await t.api('POST', '/invites', { token: mak.token, body: { nameHint: 'Gone' } })).data;
  const gone = (await codeLogin({ code: inv.code })).data;
  const sc = (await t.api('POST', `/members/${gone.member.id}/signin-code`, { token: mak.token })).data;
  await t.api('DELETE', `/members/${gone.member.id}`, { token: mak.token });
  const r = await codeLogin({ code: sc.code });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'removed');
  assert.equal((await t.api('POST', `/members/${gone.member.id}/signin-code`, { token: mak.token })).status, 404);
});

test('the join page: install and open buttons, the code, no names; an ended code says so', async () => {
  const inv = (await t.api('POST', '/invites', { token: mak.token, body: { nameHint: 'Secret Name' } })).data;
  const res = await fetch(`${t.base}/join/${inv.code}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('href="https://testflight.apple.com/join/TESTLINK"'), 'Install Karaki goes to INSTALL_URL');
  assert.ok(html.includes(`href="karaki://join/${inv.code}"`), 'Open Karaki opens the app with the code');
  assert.ok(html.includes(`>${inv.code}</div>`), 'the code, large, as a fallback');
  assert.ok(html.includes('Copy the code'));
  assert.ok(!html.includes('Secret Name') && !html.includes('MAK'), 'no names of anyone in the family');
  assert.ok(!/border-radius:\s*(999|50%)/.test(html), 'no pill shaped buttons');

  // INSTALL_URL is read on every request
  env.INSTALL_URL = 'https://apps.apple.com/app/id6824188269';
  assert.ok((await (await fetch(`${t.base}/join/${inv.code}`)).text()).includes('https://apps.apple.com/app/id6824188269'));

  await codeLogin({ code: inv.code, name: 'X' });
  const ended = await fetch(`${t.base}/join/${inv.code}`);
  assert.equal(ended.status, 410);
  const endedHtml = await ended.text();
  assert.ok(endedHtml.includes('This invite has ended. Ask for a new one.'));
  assert.ok(!endedHtml.includes('karaki://'), 'nothing to open for an ended code');
  const junk = await fetch(`${t.base}/join/%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
  assert.equal(junk.status, 410);
  assert.ok(!(await junk.text()).includes('<script>alert'), 'what is typed in the address never reaches the page');
});

test('the privacy page says what is kept, where, no ads or tracking, how to be removed, the contact', async () => {
  const res = await fetch(`${t.base}/privacy`);
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const words of ['names', 'Messages, photos and voice notes', 'record of calls', 'Device tokens', 'private server',
    'No advertising', 'No tracking', 'Ask the family admin', 'mahmoud.karaki@besmart-me.com']) {
    assert.ok(html.toLowerCase().includes(words.toLowerCase()), words);
  }
});

test('wrong codes are refused and the door closes after too many tries', async () => {
  let last;
  for (let i = 0; i < 42; i++) last = await codeLogin({ code: 'AAAA-AAAA' });
  assert.equal(last.status, 429, 'the same door limit as the other ways in');
  assert.equal(last.data.error, 'too_many_tries');
  assert.equal((await fetch(`${t.base}/join/AAAA-AAAA`)).status, 429, 'the join page shares the limit');
});

test('the database already on the box gets the new column without losing anything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-migrate-'));
  const old = new DatabaseSync(path.join(dir, 'family.sqlite'));
  old.exec(`CREATE TABLE invites (id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, created_by INTEGER, name_hint TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_by INTEGER, used_at INTEGER, revoked_at INTEGER);
    INSERT INTO invites (code_hash, name_hint, created_at, expires_at) VALUES ('h', 'Kept', 1, 2);`);
  old.close();
  const db = openDb(dir);
  const cols = db.prepare('PRAGMA table_info(invites)').all().map((c) => c.name);
  assert.ok(cols.includes('for_member'));
  assert.equal(db.prepare('SELECT name_hint FROM invites').get().name_hint, 'Kept');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
