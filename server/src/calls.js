// Calls (phases 2 and 3): one to one and group calls between chat members.
//
// The server never touches voice or video. It keeps the call record, rings people (a message
// on the live socket plus a VoIP push that wakes a closed or locked iPhone into CallKit), and
// passes the WebRTC offers, answers and network candidates between the phones on the call.
//
// Mesh rule (no glare): whoever joins sends an offer to everyone already on the call. The
// caller is on the call from the start, so a callee who answers makes the first offer.
import crypto from 'node:crypto';
import { tx, one, all, run } from './db.js';
import { FamilyError } from './family.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TURN passwords the way coturn's use-auth-secret wants them: the user name is
// "<expiry unix seconds>:<member id>", the password base64(HMAC-SHA1(secret, user name)).
export function turnCredentials({ secret, ttlSeconds, memberId, nowMs = Date.now() }) {
  const username = `${Math.floor(nowMs / 1000) + ttlSeconds}:${memberId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

export function makeCalls({ db, config, hub, family, voipPush = null, log = console, now = () => Date.now() }) {
  const C = config.calls;
  const timers = new Map(); // callId -> ring timeout
  const graces = new Map(); // deviceId -> timer after a socket drops mid call
  let stopped = false;

  // ---------- shapes ----------
  function callOut(id) {
    const c = one(db, 'SELECT * FROM calls WHERE id = ?', id);
    if (!c) return null;
    const members = all(db, 'SELECT member_id, state FROM call_members WHERE call_id = ? ORDER BY rowid', id)
      .map((r) => ({ id: r.member_id, state: r.state }));
    return {
      id: c.id, chatId: c.chat_id, kind: c.kind, startedBy: c.started_by, createdAt: c.created_at,
      answeredAt: c.answered_at, endedAt: c.ended_at, endReason: c.end_reason,
      ringUntil: c.created_at + C.ringMs, members,
    };
  }

  function iceServers(memberId) {
    const list = [];
    if (C.stunUrls.length) list.push({ urls: C.stunUrls });
    if (C.turnUrls.length && C.turnSecret) {
      list.push({ urls: C.turnUrls, ...turnCredentials({ secret: C.turnSecret, ttlSeconds: C.turnTtlSeconds, memberId, nowMs: now() }) });
    }
    return list;
  }

  const stateOf = (callId, memberId) => one(db, 'SELECT * FROM call_members WHERE call_id = ? AND member_id = ?', callId, memberId);
  const joinedRows = (callId) => all(db, "SELECT * FROM call_members WHERE call_id = ? AND state = 'joined'", callId);
  const openCallOf = (chatId) => one(db, 'SELECT * FROM calls WHERE chat_id = ? AND ended_at IS NULL', chatId);
  const busyElsewhere = (memberId, exceptCallId = '') => !!one(db, `SELECT 1 AS x FROM call_members cm JOIN calls c ON c.id = cm.call_id
    WHERE cm.member_id = ? AND cm.state = 'joined' AND c.ended_at IS NULL AND c.id <> ?`, memberId, exceptCallId);

  function openCall(callId) {
    const c = typeof callId === 'string' ? one(db, 'SELECT * FROM calls WHERE id = ?', callId) : null;
    if (!c) throw new FamilyError(404, 'no_such_call');
    if (c.ended_at) throw new FamilyError(410, 'call_ended');
    return c;
  }

  // every member of the chat hears about every change (the chat shows "call in progress, Join")
  function announce(callId) {
    const call = callOut(callId);
    for (const mid of family.currentMemberIds(call.chatId)) hub.sendToMember(mid, { type: 'call.state', call });
    family.announceChat(call.chatId);
    return call;
  }

  // ---------- ringing ----------
  async function ring(call, memberIds, caller) {
    const chat = one(db, 'SELECT * FROM chats WHERE id = ?', call.chatId);
    const title = chat.kind === 'group' ? chat.title : caller.name;
    const ev = { type: 'call.ring', call, from: { id: caller.id, name: caller.name }, title, group: chat.kind === 'group' };
    for (const mid of memberIds) hub.sendToMember(mid, ev);
    if (!voipPush) return;
    // a VoIP push wakes the phone even when the app is closed; the app reports it to CallKit at once
    const payload = {
      callId: call.id, chatId: call.chatId, kind: call.kind, title, group: chat.kind === 'group',
      fromId: caller.id, fromName: caller.name, ringUntil: call.ringUntil,
    };
    for (const mid of memberIds) {
      for (const d of all(db, 'SELECT id, voip_token FROM devices WHERE member_id = ? AND revoked_at IS NULL AND voip_token IS NOT NULL', mid)) {
        const res = await voipPush(d.voip_token, payload, { pushType: 'voip', priority: 10, expiration: 0 });
        if (!res.ok && (res.status === 410 || res.reason === 'BadDeviceToken' || res.reason === 'Unregistered')) {
          run(db, 'UPDATE devices SET voip_token = NULL WHERE id = ?', d.id);
        } else if (!res.ok) log.warn?.(`[voip] device ${d.id}: ${res.status} ${res.reason}`);
      }
    }
  }

  function startRingTimer(callId) {
    clearTimeout(timers.get(callId));
    timers.set(callId, setTimeout(() => {
      timers.delete(callId);
      const c = one(db, 'SELECT * FROM calls WHERE id = ?', callId);
      if (!c || c.ended_at) return;
      run(db, "UPDATE call_members SET state = 'missed' WHERE call_id = ? AND state = 'ringing'", callId);
      if (!settle(callId)) announce(callId);
    }, C.ringMs));
  }

  // ---------- the call's life ----------
  function start(me, device, { chatId, kind, callId } = {}) {
    const chat = family.requireChat(chatId, me.id);
    if (!['voice', 'video'].includes(kind)) throw new FamilyError(400, 'bad_kind');
    const existing = openCallOf(chat.id);
    if (existing) throw Object.assign(new FamilyError(409, 'call_in_progress'), { call: callOut(existing.id) });
    if (busyElsewhere(me.id)) throw new FamilyError(409, 'already_in_call');
    const others = family.currentMemberIds(chat.id).filter((m) => m !== me.id);
    if (!others.length) throw new FamilyError(400, 'nobody_to_call');
    if (others.length + 1 > C.maxParticipants) throw new FamilyError(400, 'too_many_for_a_call');
    const id = typeof callId === 'string' && UUID.test(callId) && !one(db, 'SELECT 1 AS x FROM calls WHERE id = ?', callId.toLowerCase())
      ? callId.toLowerCase() : crypto.randomUUID();
    const ringing = [];
    tx(db, () => {
      const t = now();
      run(db, 'INSERT INTO calls (id, chat_id, kind, started_by, created_at) VALUES (?, ?, ?, ?, ?)', id, chat.id, kind, me.id, t);
      run(db, "INSERT INTO call_members (call_id, member_id, state, device_id, joined_at) VALUES (?, ?, 'joined', ?, ?)", id, me.id, device.id, t);
      for (const mid of others) {
        const busy = busyElsewhere(mid, id);
        run(db, 'INSERT INTO call_members (call_id, member_id, state) VALUES (?, ?, ?)', id, mid, busy ? 'busy' : 'ringing');
        if (!busy) ringing.push(mid);
      }
    });
    if (!ringing.length) {
      // everyone is on another call: say busy and close it straight away
      end(id, 'busy');
      return { call: callOut(id), iceServers: iceServers(me.id) };
    }
    const call = announce(id);
    startRingTimer(id);
    ring(call, ringing, me).catch((e) => log.error?.(`[voip] ${e.message}`));
    return { call, iceServers: iceServers(me.id) };
  }

  // answering a ring, or joining a group call that is already running
  function accept(me, device, callId) {
    const c = openCall(callId);
    family.requireChat(c.chat_id, me.id);
    const mine = stateOf(c.id, me.id);
    if (mine && mine.state === 'joined') {
      if (mine.device_id === device.id) return { call: callOut(c.id), peers: peersOf(c.id, me.id), iceServers: iceServers(me.id) };
      throw new FamilyError(409, 'answered_on_another_phone');
    }
    if (busyElsewhere(me.id, c.id)) throw new FamilyError(409, 'already_in_call');
    if (joinedRows(c.id).length >= C.maxParticipants) throw new FamilyError(409, 'call_full');
    const t = now();
    tx(db, () => {
      if (mine) run(db, "UPDATE call_members SET state = 'joined', device_id = ?, joined_at = ?, left_at = NULL WHERE call_id = ? AND member_id = ?", device.id, t, c.id, me.id);
      else run(db, "INSERT INTO call_members (call_id, member_id, state, device_id, joined_at) VALUES (?, ?, 'joined', ?, ?)", c.id, me.id, device.id, t);
      if (!c.answered_at) run(db, 'UPDATE calls SET answered_at = ? WHERE id = ?', t, c.id);
    });
    // the same person's other phones stop ringing
    hub.sendToMember(me.id, { type: 'call.taken', callId: c.id }, { exceptDevice: device.id });
    const call = announce(c.id);
    return { call, peers: peersOf(c.id, me.id), iceServers: iceServers(me.id) };
  }

  const peersOf = (callId, memberId) => joinedRows(callId).filter((r) => r.member_id !== memberId).map((r) => r.member_id);

  function decline(me, callId, { busy = false } = {}) {
    const c = openCall(callId);
    family.requireChat(c.chat_id, me.id);
    const mine = stateOf(c.id, me.id);
    if (!mine || mine.state !== 'ringing') return callOut(c.id);
    run(db, 'UPDATE call_members SET state = ? WHERE call_id = ? AND member_id = ?', busy ? 'busy' : 'declined', c.id, me.id);
    hub.sendToMember(me.id, { type: 'call.taken', callId: c.id });
    if (!settle(c.id)) return announce(c.id);
    return callOut(c.id);
  }

  function hangup(me, callId) {
    const c = one(db, 'SELECT * FROM calls WHERE id = ?', callId);
    if (!c || c.ended_at) return c ? callOut(c.id) : null;
    const mine = stateOf(c.id, me.id);
    if (!mine) throw new FamilyError(403, 'not_on_call');
    if (mine.state === 'ringing') return decline(me, callId);
    if (mine.state !== 'joined') return callOut(c.id);
    run(db, "UPDATE call_members SET state = 'left', left_at = ? WHERE call_id = ? AND member_id = ?", now(), c.id, me.id);
    for (const r of joinedRows(c.id)) hub.sendToDevice(r.device_id, { type: 'call.left', callId: c.id, memberId: me.id });
    if (!settle(c.id)) return announce(c.id);
    return callOut(c.id);
  }

  // decides whether the call goes on; ends it if not. Returns true when it ended.
  function settle(callId) {
    const c = one(db, 'SELECT * FROM calls WHERE id = ?', callId);
    if (!c || c.ended_at) return true;
    const rows = all(db, 'SELECT state FROM call_members WHERE call_id = ?', callId).map((r) => r.state);
    const joined = rows.filter((s) => s === 'joined').length;
    const ringing = rows.filter((s) => s === 'ringing').length;
    if (joined >= 2 || (joined === 1 && ringing > 0)) return false;
    let reason;
    if (c.answered_at) reason = 'ended';
    else if (joined === 0) reason = 'cancelled'; // the caller gave up before anyone answered
    else if (rows.filter((s) => s !== 'joined').every((s) => s === 'declined')) reason = 'declined';
    else if (rows.filter((s) => s !== 'joined').every((s) => s === 'busy')) reason = 'busy';
    else reason = 'missed';
    end(callId, reason);
    return true;
  }

  function end(callId, reason) {
    clearTimeout(timers.get(callId));
    timers.delete(callId);
    const c = one(db, 'SELECT * FROM calls WHERE id = ?', callId);
    if (!c || c.ended_at) return;
    const t = now();
    const wasOn = all(db, "SELECT member_id FROM call_members WHERE call_id = ? AND (state IN ('joined', 'left'))", callId).map((r) => r.member_id);
    tx(db, () => {
      run(db, 'UPDATE calls SET ended_at = ?, end_reason = ? WHERE id = ?', t, reason, callId);
      run(db, "UPDATE call_members SET state = 'missed' WHERE call_id = ? AND state = 'ringing'", callId);
      run(db, "UPDATE call_members SET state = 'left', left_at = ? WHERE call_id = ? AND state = 'joined'", t, callId);
    });
    const call = callOut(callId);
    for (const mid of family.currentMemberIds(c.chat_id)) hub.sendToMember(mid, { type: 'call.ended', callId, reason, call });
    // the line in the chat: answered calls show their length, the rest show as missed
    const seconds = c.answered_at ? Math.round((t - c.answered_at) / 1000) : 0;
    family.insertCallLine(c, reason, seconds, reason === 'ended' ? wasOn : [c.started_by]);
  }

  // ---------- signalling between the phones on the call ----------
  // type: call.offer, call.answer, call.ice, call.media; goes only to the target's phone on the call
  function relay(me, type, msg) {
    const c = openCall(msg.callId);
    const mine = stateOf(c.id, me.id);
    if (!mine || mine.state !== 'joined') throw new FamilyError(403, 'not_on_call');
    const out = { type, callId: c.id, from: me.id };
    if (type === 'call.offer' || type === 'call.answer') {
      if (typeof msg.sdp !== 'string' || msg.sdp.length > 20000) throw new FamilyError(400, 'bad_sdp');
      out.sdp = msg.sdp;
    } else if (type === 'call.ice') {
      if (!msg.candidate || typeof msg.candidate !== 'object' || JSON.stringify(msg.candidate).length > 2000) throw new FamilyError(400, 'bad_candidate');
      out.candidate = msg.candidate;
    } else if (type === 'call.media') {
      out.audio = !!msg.audio;
      out.video = !!msg.video;
      // camera and microphone state go to everyone on the call
      for (const r of joinedRows(c.id)) if (r.member_id !== me.id) hub.sendToDevice(r.device_id, out);
      return;
    }
    const target = stateOf(c.id, Number(msg.to));
    if (!target || target.state !== 'joined') throw new FamilyError(404, 'peer_not_on_call');
    hub.sendToDevice(target.device_id, out);
  }

  // a phone on a call lost its socket: give it a little while to come back before it counts as gone
  function socketClosed(member, deviceId) {
    if (stopped) return;
    const onCall = one(db, `SELECT cm.call_id FROM call_members cm JOIN calls c ON c.id = cm.call_id
      WHERE cm.member_id = ? AND cm.device_id = ? AND cm.state = 'joined' AND c.ended_at IS NULL`, member.id, deviceId);
    if (!onCall) return;
    clearTimeout(graces.get(deviceId));
    graces.set(deviceId, setTimeout(() => {
      graces.delete(deviceId);
      if (!hub.deviceOnline(deviceId)) {
        try { hangup(member, onCall.call_id); } catch (e) { log.warn?.(`[calls] ${e.message}`); }
      }
    }, C.reconnectGraceMs));
  }

  function current(me) {
    const r = one(db, `SELECT c.id FROM call_members cm JOIN calls c ON c.id = cm.call_id
      WHERE cm.member_id = ? AND cm.state IN ('joined', 'ringing') AND c.ended_at IS NULL ORDER BY c.created_at DESC LIMIT 1`, me.id);
    return r ? callOut(r.id) : null;
  }

  function stop() {
    stopped = true;
    for (const t of timers.values()) clearTimeout(t);
    for (const t of graces.values()) clearTimeout(t);
  }

  return { start, accept, decline, hangup, relay, socketClosed, iceServers, callOut, current, stop };
}
