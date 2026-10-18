// The live line to each open app: one WebSocket per phone at /ws.
// The phone connects, sends { type: 'auth', token } within 10 seconds, then gets every event
// for its member (new messages, ticks, typing, chat changes) and can send messages, ticks and
// typing back. Commands may carry a ref; the answer comes back as { type: 'ack', ref, ... }.
import { WebSocketServer } from 'ws';
import { FamilyError } from './family.js';

export function makeHub() {
  const byMember = new Map(); // memberId -> Set of sockets

  return {
    add(memberId, ws) {
      if (!byMember.has(memberId)) byMember.set(memberId, new Set());
      byMember.get(memberId).add(ws);
    },
    remove(memberId, ws) {
      const set = byMember.get(memberId);
      if (!set) return;
      set.delete(ws);
      if (!set.size) byMember.delete(memberId);
    },
    isOnline: (memberId) => byMember.has(memberId),
    onlineIds: () => [...byMember.keys()],
    sendToMember(memberId, event) {
      const set = byMember.get(memberId);
      if (!set) return;
      const data = JSON.stringify(event);
      for (const ws of set) if (ws.readyState === 1) ws.send(data);
    },
    broadcast(event) {
      const data = JSON.stringify(event);
      for (const set of byMember.values()) for (const ws of set) if (ws.readyState === 1) ws.send(data);
    },
    closeDevice(deviceId) {
      for (const set of byMember.values()) for (const ws of set) if (ws.deviceId === deviceId) ws.close(4001, 'signed_out');
    },
    closeMember(memberId) {
      for (const ws of byMember.get(memberId) || []) ws.close(4001, 'signed_out');
    },
  };
}

export function attachRealtime(server, { family, hub, log = console }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

  // drop sockets that stopped answering (a phone that lost signal without closing)
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(beat));

  function presence(memberId, online) {
    hub.broadcast({ type: 'presence', memberId, online });
  }

  wss.on('connection', (ws) => {
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    let me = null;
    const authTimer = setTimeout(() => { if (!me) ws.close(4000, 'auth_timeout'); }, 10_000);
    const reply = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return reply({ type: 'error', code: 'bad_json' }); }
      if (!msg || typeof msg.type !== 'string') return reply({ type: 'error', code: 'bad_message' });
      const ref = msg.ref;

      if (!me) {
        if (msg.type !== 'auth') return ws.close(4000, 'auth_first');
        const who = family.authenticate(msg.token);
        if (!who) return ws.close(4001, 'bad_token');
        clearTimeout(authTimer);
        me = who.member;
        ws.memberId = me.id;
        ws.deviceId = who.device.id;
        const wasOnline = hub.isOnline(me.id);
        hub.add(me.id, ws);
        if (!wasOnline) presence(me.id, true);
        return reply({ type: 'ready', member: family.memberOut(me), online: hub.onlineIds() });
      }

      try {
        switch (msg.type) {
          case 'ping':
            return reply({ type: 'pong', ref });
          case 'send': {
            const message = family.sendMessage(me, msg.chatId, msg);
            return reply({ type: 'ack', ref, message });
          }
          case 'delivered':
            if (msg.chatId === undefined) family.markAllDelivered(me);
            else family.markDelivered(me, msg.chatId, msg.upTo);
            return ref !== undefined && reply({ type: 'ack', ref });
          case 'read':
            family.markRead(me, msg.chatId, msg.upTo);
            return ref !== undefined && reply({ type: 'ack', ref });
          case 'typing':
            family.typing(me, msg.chatId, msg.on);
            return undefined;
          // phase 2: call offers, answers and ICE candidates will be relayed here ('call.*')
          default:
            if (msg.type.startsWith('call.')) return reply({ type: 'error', ref, code: 'calls_not_yet' });
            return reply({ type: 'error', ref, code: 'unknown_type' });
        }
      } catch (e) {
        if (e instanceof FamilyError) return reply({ type: 'error', ref, code: e.code, status: e.status });
        log.error?.(`[ws] ${e.stack || e.message}`);
        return reply({ type: 'error', ref, code: 'server_error' });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!me) return;
      hub.remove(me.id, ws);
      if (!hub.isOnline(me.id)) presence(me.id, false);
    });
    ws.on('error', () => {});
  });

  return wss;
}
