// Test kit: a real server on a random port with a throwaway data folder, our own stand in for
// Apple's signing key (so the real token checks run, offline), a fake push sender that records,
// and a small WebSocket client that waits for events.
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createFamilyServer } from '../src/server.js';

const quiet = { log() {}, warn() {}, error() {} };

export async function startTestServer({ limits = {}, calls = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-test-'));
  const config = loadConfig({ DATA_DIR: dataDir });
  Object.assign(config.limits, limits);
  Object.assign(config.calls, calls);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const pushes = [];
  const push = async (token, payload, opts) => { pushes.push({ token, payload, opts }); return { ok: true, status: 200 }; };
  const srv = createFamilyServer(config, { appleKeySet: createLocalJWKSet({ keys: [jwk] }), push, voipPush: push, log: quiet });
  const addr = await srv.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;

  async function appleToken(sub, { aud = config.bundleId, iss = config.appleIssuer, key = privateKey, nonce, expired = false } = {}) {
    const jwt = new SignJWT({ sub, ...(nonce ? { nonce: crypto.createHash('sha256').update(nonce).digest('hex') } : {}) })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(iss).setAudience(aud)
      .setIssuedAt(expired ? Math.floor(Date.now() / 1000) - 7200 : undefined)
      .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 3600 : '10m');
    return jwt.sign(key);
  }

  async function api(method, url, { token, body, raw, headers = {} } = {}) {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    let payload;
    if (raw) payload = raw;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }

  // signs a new person in with Apple + invite, the way the app does it
  async function join(name, { sub = `apple-${name}-${crypto.randomUUID()}`, admin = false, inviter = null } = {}) {
    let code;
    if (inviter) {
      const r = await api('POST', '/invites', { token: inviter.token, body: { nameHint: name } });
      code = r.data.code;
    } else code = srv.family.createInvite(null, { nameHint: name, isAdmin: admin }).code;
    const nonce = crypto.randomUUID();
    const r = await api('POST', '/auth/apple', { body: { identityToken: await appleToken(sub, { nonce }), nonce, inviteCode: code, name } });
    if (r.status !== 200) throw new Error(`join ${name} failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { ...r.data, sub, name };
  }

  async function close() {
    await srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { srv, config, base, api, appleToken, join, pushes, close, otherKey: (await generateKeyPair('RS256')).privateKey };
}

// a member's phone on the live socket
export async function connect(base, token) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const events = [];
  const waiters = [];
  let refN = 0;
  ws.on('message', (d) => {
    const ev = JSON.parse(d.toString());
    events.push(ev);
    for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(ev); }
  });
  const closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  const client = {
    ws, events, closed,
    send: (obj) => ws.send(JSON.stringify(obj)),
    // resolves with the first event (already seen or still to come) that matches
    waitFor(pred, ms = 2000) {
      const seen = events.find(pred);
      if (seen) { events.splice(events.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (ev) => { events.splice(events.indexOf(ev), 1); resolve(ev); } };
        w.t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timed out waiting for event')); }, ms);
        waiters.push(w);
      });
    },
    // a command that expects an answer
    request(obj, ms) {
      const ref = `r${++refN}`;
      client.send({ ...obj, ref });
      return client.waitFor((e) => e.ref === ref, ms);
    },
    close: () => { ws.close(); return closed; },
  };
  if (token) {
    client.send({ type: 'auth', token });
    client.ready = await client.waitFor((e) => e.type === 'ready');
  }
  return client;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
