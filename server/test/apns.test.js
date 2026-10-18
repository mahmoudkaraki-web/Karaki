import { test } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jwtVerify } from 'jose';
import { makeApnsSender } from '../src/apns.js';

const quiet = { log() {}, warn() {}, error() {} };

test('push is simply off until the key, key id and team id are set', () => {
  assert.equal(makeApnsSender({ keyPath: '', keyId: '', teamId: 'T', topic: 'com.besmart.karaki', log: quiet }), null);
  assert.equal(makeApnsSender({ keyPath: 'C:/nowhere/AuthKey.p8', keyId: 'K', teamId: 'T', topic: 'x', log: quiet }), null);
});

test('APNs requests carry a signed token, the right topic and push type, and report a dead token', async () => {
  // a stand in for Apple's push server, speaking HTTP/2 like the real one
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-apns-'));
  const keyPath = path.join(dir, 'AuthKey_TEST123456.p8');
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const seen = [];
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.on('data', (c) => (body += c));
    stream.on('end', () => {
      seen.push({ headers, body: JSON.parse(body) });
      const dead = headers[':path'].endsWith('/dead');
      stream.respond({ ':status': dead ? 410 : 200 });
      stream.end(dead ? JSON.stringify({ reason: 'Unregistered' }) : '');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const send = makeApnsSender({
    keyPath, keyId: 'TEST123456', teamId: '5TV89KGJVR', topic: 'com.besmart.karaki', log: quiet,
    host: `http://127.0.0.1:${server.address().port}`,
  });

  const ok = await send('abc123', { aps: { alert: { title: 'MAK', body: 'hi' } } }, { collapseId: 'm1' });
  assert.deepEqual(ok, { ok: true, status: 200, reason: '' });
  const h = seen[0].headers;
  assert.equal(h[':path'], '/3/device/abc123');
  assert.equal(h['apns-topic'], 'com.besmart.karaki');
  assert.equal(h['apns-push-type'], 'alert');
  assert.equal(h['apns-collapse-id'], 'm1');
  const jwt = h.authorization.replace('bearer ', '');
  const { payload, protectedHeader } = await jwtVerify(jwt, publicKey, { algorithms: ['ES256'] });
  assert.equal(protectedHeader.kid, 'TEST123456');
  assert.equal(payload.iss, '5TV89KGJVR');
  assert.equal(seen[0].body.aps.alert.body, 'hi');

  const voip = await send('abc123', { callId: 'x' }, { pushType: 'voip' });
  assert.equal(voip.ok, true);
  assert.equal(seen[1].headers['apns-topic'], 'com.besmart.karaki.voip', 'ringing pushes use the .voip topic');
  assert.equal(seen[1].headers['apns-push-type'], 'voip');
  assert.equal(seen[1].headers['apns-priority'], '10');

  const dead = await send('dead', { aps: {} });
  assert.deepEqual(dead, { ok: false, status: 410, reason: 'Unregistered' });

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('APNS_KEY_PATH can be the Push Key folder: the AuthKey file there is used, its id read from the name', async () => {
  const { resolveApnsKey } = await import('../src/config.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-pushkey-'));
  fs.writeFileSync(path.join(dir, 'AuthKey_CB12345678.p8'), 'not a real key');
  assert.deepEqual(resolveApnsKey(dir, ''), { keyPath: path.join(dir, 'AuthKey_CB12345678.p8'), keyId: 'CB12345678' });
  assert.equal(resolveApnsKey(dir, 'OTHERID123').keyId, 'OTHERID123', 'an explicit key id wins');
  assert.deepEqual(resolveApnsKey('', ''), { keyPath: '', keyId: '' });
  fs.rmSync(dir, { recursive: true, force: true });
});
