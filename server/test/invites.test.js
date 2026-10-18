import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer, connect } from './helpers.js';

let t;
before(async () => { t = await startTestServer(); });
after(async () => { await t.close(); });

async function signIn(sub, extra = {}, tokenOpts = {}) {
  const nonce = crypto.randomUUID();
  const identityToken = await t.appleToken(sub, { nonce, ...tokenOpts });
  return t.api('POST', '/auth/apple', { body: { identityToken, nonce, ...extra } });
}

test('a stranger with a good Apple token but no invite is asked for one', async () => {
  const r = await signIn('apple-stranger');
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'invite_required');
});

test('the first member gets in with the admin invite made on the server, and is admin', async () => {
  const inv = t.srv.family.createInvite(null, { nameHint: 'MAK', isAdmin: true });
  assert.match(inv.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const check = await t.api('GET', `/invites/${inv.code.toLowerCase()}/check`);
  assert.equal(check.status, 200);
  assert.equal(check.data.nameHint, 'MAK');

  const r = await signIn('apple-mak', { inviteCode: inv.code, name: 'MAK' });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.name, 'MAK');
  assert.equal(r.data.member.isAdmin, true);
  assert.ok(r.data.token.length >= 40);

  const me = await t.api('GET', '/me', { token: r.data.token });
  assert.equal(me.data.member.id, r.data.member.id);

  // the same code cannot be used twice
  const again = await signIn('apple-someone-else', { inviteCode: inv.code });
  assert.equal(again.status, 404);
  assert.equal(again.data.error, 'invite_invalid');
});

test('an admin makes an invite in the app; a non admin cannot', async () => {
  const mak = await signIn('apple-mak');
  assert.equal(mak.status, 200, 'a known member signs in again without any invite');
  const inv = await t.api('POST', '/invites', { token: mak.data.token, body: { nameHint: 'Sara' } });
  assert.equal(inv.status, 200);
  assert.match(inv.data.link, /^family:\/\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const sara = await signIn('apple-sara', { inviteCode: inv.data.code.replace('-', ' ') });
  assert.equal(sara.status, 200);
  assert.equal(sara.data.member.name, 'Sara', 'the name comes from the invite when the phone sends none');
  assert.equal(sara.data.member.isAdmin, false);

  const denied = await t.api('POST', '/invites', { token: sara.data.token, body: {} });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error, 'admins_only');

  const list = await t.api('GET', '/invites', { token: mak.data.token });
  assert.equal(list.data.invites.length, 0, 'used invites are no longer open');
});

test('expired and revoked invites are refused', async () => {
  const expired = t.srv.family.createInvite(null, { nameHint: 'Late' });
  t.srv.db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, expired.id);
  assert.equal((await signIn('apple-late', { inviteCode: expired.code })).status, 404);

  const revoked = t.srv.family.createInvite(null, { nameHint: 'Gone' });
  const mak = (await signIn('apple-mak')).data;
  assert.equal((await t.api('DELETE', `/invites/${revoked.id}`, { token: mak.token })).status, 200);
  assert.equal((await signIn('apple-gone', { inviteCode: revoked.code })).status, 404);
});

test('Apple tokens are really checked: wrong audience, wrong key, expired, wrong nonce', async () => {
  const inv = t.srv.family.createInvite(null, {});
  const wrongAud = await signIn('apple-x', { inviteCode: inv.code }, { aud: 'com.someone.else' });
  assert.equal(wrongAud.status, 401);
  const wrongKey = await signIn('apple-x', { inviteCode: inv.code }, { key: t.otherKey });
  assert.equal(wrongKey.status, 401);
  const expired = await signIn('apple-x', { inviteCode: inv.code }, { expired: true });
  assert.equal(expired.status, 401);
  const wrongIss = await signIn('apple-x', { inviteCode: inv.code }, { iss: 'https://evil.example' });
  assert.equal(wrongIss.status, 401);

  const nonce = crypto.randomUUID();
  const identityToken = await t.appleToken('apple-x', { nonce });
  const replay = await t.api('POST', '/auth/apple', { body: { identityToken, nonce: 'a-different-nonce', inviteCode: inv.code } });
  assert.equal(replay.status, 401);
  assert.equal(replay.data.error, 'bad_nonce');
  // and the invite is still unused after all those failures
  assert.equal((await t.api('GET', `/invites/${inv.code}/check`)).status, 200);
});

test('signing out ends that phone only; a removed member is shut out everywhere', async () => {
  const mak = (await signIn('apple-mak')).data;
  const phone1 = (await signIn('apple-sara')).data;
  const phone2 = (await signIn('apple-sara')).data;
  assert.equal((await t.api('POST', '/auth/signout', { token: phone1.token })).status, 200);
  assert.equal((await t.api('GET', '/me', { token: phone1.token })).status, 401);
  assert.equal((await t.api('GET', '/me', { token: phone2.token })).status, 200);

  const live = await connect(t.base, phone2.token);
  assert.equal((await t.api('DELETE', `/members/${phone2.member.id}`, { token: mak.token })).status, 200);
  const closed = await live.closed;
  assert.equal(closed.code, 4001);
  assert.equal((await t.api('GET', '/me', { token: phone2.token })).status, 401);
  const back = await signIn('apple-sara');
  assert.equal(back.status, 403);
  assert.equal(back.data.error, 'removed');
});

test('the live socket refuses a bad token and anything before auth', async () => {
  const c = await connect(t.base);
  c.send({ type: 'auth', token: 'not-a-real-token-at-all-xxxxxxxx' });
  assert.equal((await c.closed).code, 4001);
  const d = await connect(t.base);
  d.send({ type: 'send', chatId: 1, body: 'hi' });
  assert.equal((await d.closed).code, 4000);
});
