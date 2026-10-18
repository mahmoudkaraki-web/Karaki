// Builds the whole server (HTTP routes + live socket) from its parts, so tests can make one
// with a temporary data folder, a local Apple key set and a fake push sender.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { openDb } from './db.js';
import { makeFamily, FamilyError } from './family.js';
import { makeHub, attachRealtime } from './realtime.js';
import { makeCalls } from './calls.js';
import { makeAppleVerifier, AuthError } from './apple.js';
import { makeApnsSender } from './apns.js';

const STREAMING = Symbol('streaming'); // a route that answers with a file stream, not JSON

// a small fixed window limiter, per address, for the doors strangers can knock on
function limiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const k = req.ip;
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (n > max) return res.status(429).json({ error: 'too_many_tries' });
    return next();
  };
}

export function createFamilyServer(config, { appleKeySet, push, voipPush, log = console } = {}) {
  const db = openDb(config.dataDir);
  const hub = makeHub();
  const pushSender = push !== undefined ? push : makeApnsSender({ ...config.apns, topic: config.bundleId, log });
  const family = makeFamily({ db, config, hub, push: pushSender, log });
  // VoIP pushes go through the same APNs sender (same key), with push type voip and the .voip topic
  const calls = makeCalls({ db, config, hub, family, voipPush: voipPush !== undefined ? voipPush : pushSender, log });
  const verifyApple = makeAppleVerifier({
    jwksUrl: config.appleJwksUrl, issuer: config.appleIssuer, audience: config.bundleId, keySet: appleKeySet,
  });

  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 'loopback'); // Caddy on the same box
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'no-store');
    if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== STREAMING && !res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof FamilyError) return res.status(e.status).json({ error: e.code, ...(e.call ? { call: e.call } : {}) });
      if (e instanceof AuthError) return res.status(401).json({ error: e.code });
      log.error?.(`[http] ${req.method} ${req.path}: ${e.stack || e.message}`);
      return res.status(500).json({ error: 'server_error' });
    }
  };

  function auth(req, res, next) {
    const h = req.get('authorization') || '';
    const who = h.startsWith('Bearer ') ? family.authenticate(h.slice(7)) : null;
    if (!who) return res.status(401).json({ error: 'signed_out' });
    req.me = who.member;
    req.device = who.device;
    return next();
  }

  const doorLimit = limiter({ windowMs: 10 * 60_000, max: 30 });

  app.get('/health', (req, res) => res.json({ ok: true, name: 'family', version: 1 }));

  // ----- sign in -----
  app.get('/invites/:code/check', doorLimit, wrap((req) => family.checkInvite(req.params.code)));

  app.post('/auth/apple', doorLimit, wrap(async (req) => {
    const { identityToken, nonce, inviteCode, name, deviceLabel } = req.body || {};
    const apple = await verifyApple(identityToken, nonce);
    return family.signIn(apple, { inviteCode, name, deviceLabel });
  }));

  app.post('/auth/signout', auth, wrap((req) => family.signOut(req.device)));

  // ----- me and the family -----
  app.get('/me', auth, wrap((req) => ({ member: family.memberOut(req.me), members: family.listMembers(), unread: family.unreadTotal(req.me.id) })));
  app.patch('/me', auth, wrap((req) => ({ member: family.renameSelf(req.me, req.body?.name) })));
  app.post('/me/push', auth, wrap((req) => family.setPushToken(req.device, { pushToken: req.body?.pushToken, voipToken: req.body?.voipToken })));
  app.get('/members', auth, wrap(() => ({ members: family.listMembers() })));
  app.delete('/members/:id', auth, wrap((req) => family.removeMember(req.me, req.params.id)));

  app.get('/invites', auth, wrap((req) => ({ invites: family.listInvites(req.me) })));
  app.post('/invites', auth, wrap((req) => family.createInvite(req.me, { nameHint: req.body?.nameHint, isAdmin: !!req.body?.isAdmin })));
  app.delete('/invites/:id', auth, wrap((req) => family.revokeInvite(req.me, req.params.id)));

  // ----- chats -----
  app.get('/chats', auth, wrap((req) => ({ chats: family.listChats(req.me) })));
  app.post('/chats/direct', auth, wrap((req) => ({ chat: family.openDirect(req.me, req.body?.memberId) })));
  app.post('/chats/group', auth, wrap((req) => ({ chat: family.createGroup(req.me, req.body || {}) })));
  app.get('/chats/:id', auth, wrap((req) => ({ chat: family.getChat(req.me, req.params.id) })));
  app.patch('/chats/:id', auth, wrap((req) => ({ chat: family.renameGroup(req.me, req.params.id, req.body?.title) })));
  app.post('/chats/:id/members', auth, wrap((req) => ({ chat: family.addToGroup(req.me, req.params.id, req.body?.memberId) })));
  app.delete('/chats/:id/members/:memberId', auth, wrap((req) => ({ chat: family.removeFromGroup(req.me, req.params.id, req.params.memberId) })));

  app.get('/chats/:id/messages', auth, wrap((req) => family.history(req.me, req.params.id, req.query)));
  app.post('/chats/:id/messages', auth, wrap((req) => ({ message: family.sendMessage(req.me, req.params.id, req.body || {}) })));
  app.post('/chats/:id/read', auth, wrap((req) => family.markRead(req.me, req.params.id, req.body?.upTo)));
  app.post('/chats/:id/delivered', auth, wrap((req) => family.markDelivered(req.me, req.params.id, req.body?.upTo)));

  // ----- calls: the ringing and signalling run on the live socket; these two help the app -----
  app.get('/calls/ice', auth, wrap((req) => ({ iceServers: calls.iceServers(req.me.id) })));
  app.get('/calls/current', auth, wrap((req) => ({ call: calls.current(req.me) })));

  // ----- photos and voice notes: kept on the server's disk, in the data folder -----
  const tmpDir = path.join(config.dataDir, 'media', 'incoming');
  fs.mkdirSync(tmpDir, { recursive: true });
  const upload = multer({
    dest: tmpDir,
    limits: { fileSize: Math.max(config.limits.photoBytes, config.limits.voiceBytes), files: 1, fields: 8 },
  });
  app.post('/media', auth, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_big' });
      return res.status(400).json({ error: 'bad_upload' });
    });
  }, wrap((req) => {
    if (!req.file) throw new FamilyError(400, 'file_required');
    return { media: family.saveMedia(req.me, req.file, req.body || {}) };
  }));

  app.get('/media/:id', auth, wrap((req, res) => {
    const f = family.mediaFor(req.me, req.params.id);
    res.setHeader('Content-Type', f.mime);
    res.set('Content-Length', String(f.bytes));
    res.set('Cache-Control', 'private, max-age=31536000, immutable'); // a media id never changes content
    const stream = fs.createReadStream(f.path);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return STREAMING;
  }));

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  const server = http.createServer(app);
  const wss = attachRealtime(server, { family, calls, hub, log });

  return {
    app, server, family, calls, hub, db,
    listen: (port = config.port, host = config.host) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => {
      calls.stop();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(() => { db.close(); resolve(); });
    }),
  };
}
