// Everything the family can do, independent of HTTP or WebSocket: members, invites, chats,
// messages, ticks, typing, media. Routes and the live socket both call into here, and every
// call checks that the member really belongs to the chat it touches.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MEMBER_COLORS, tx, one, all, run } from './db.js';
import { sha256Hex } from './apple.js';

export class FamilyError extends Error {
  constructor(status, code, detail) {
    super(detail || code);
    this.status = status;
    this.code = code;
  }
}

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: easy to read out on the phone

// words for a call line, as the person who did not place the call reads it
export function callWords(body) {
  let c = {};
  try { c = JSON.parse(body || '{}'); } catch { /* old or odd line */ }
  const what = c.kind === 'video' ? 'video call' : 'voice call';
  if (c.outcome === 'ended') {
    const mins = Math.round((c.seconds || 0) / 60);
    const Cap = what.charAt(0).toUpperCase() + what.slice(1);
    return mins >= 1 ? `${Cap}, ${mins} min` : `${Cap}, under a minute`;
  }
  return `Missed ${what}`;
}

export function normaliseInviteCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function newInviteCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  // drop control characters except new lines and tabs, trim the ends
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function makeFamily({ db, config, hub, push = null, log = console, now = () => Date.now() }) {
  const L = config.limits;
  const mediaDir = path.join(config.dataDir, 'media');

  // ---------- shapes sent to phones ----------
  const memberOut = (m) => m && { id: m.id, name: m.name, color: m.color, isAdmin: !!m.is_admin, removed: !!m.removed_at };

  function mediaOut(id) {
    if (!id) return null;
    const m = one(db, 'SELECT * FROM media WHERE id = ?', id);
    return m && { id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, width: m.width, height: m.height, durationMs: m.duration_ms };
  }

  function messageOut(r) {
    return {
      id: r.id, chatId: r.chat_id, senderId: r.sender_id, kind: r.kind, body: r.body,
      media: mediaOut(r.media_id), clientId: r.client_id, createdAt: r.created_at,
    };
  }

  function chatOut(chatId, forMemberId) {
    const c = one(db, 'SELECT * FROM chats WHERE id = ?', chatId);
    const rows = all(db, `SELECT cm.member_id, cm.delivered_up_to, cm.read_up_to, m.name, m.color, m.is_admin, m.removed_at
                          FROM chat_members cm JOIN members m ON m.id = cm.member_id
                          WHERE cm.chat_id = ? AND cm.left_at IS NULL ORDER BY cm.joined_at, cm.member_id`, chatId);
    const last = one(db, 'SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1', chatId);
    const mine = rows.find((r) => r.member_id === forMemberId);
    const unread = mine
      ? one(db, `SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND id > ? AND kind <> 'system'
                 AND (sender_id IS NULL OR sender_id <> ?)`, chatId, mine.read_up_to, forMemberId).n
      : 0;
    const receipts = {};
    for (const r of rows) receipts[r.member_id] = { delivered: r.delivered_up_to, read: r.read_up_to };
    const live = one(db, 'SELECT id, kind, started_by FROM calls WHERE chat_id = ? AND ended_at IS NULL', chatId);
    const activeCall = live
      ? { id: live.id, kind: live.kind, startedBy: live.started_by, joined: all(db, "SELECT member_id FROM call_members WHERE call_id = ? AND state = 'joined'", live.id).map((r) => r.member_id) }
      : null;
    return {
      id: c.id, kind: c.kind, title: c.title, createdBy: c.created_by, createdAt: c.created_at, updatedAt: c.updated_at,
      members: rows.map((r) => memberOut({ id: r.member_id, name: r.name, color: r.color, is_admin: r.is_admin, removed_at: r.removed_at })),
      receipts, unread, last: last ? messageOut(last) : null, activeCall,
    };
  }

  // ---------- guards ----------
  function activeMember(memberId) {
    const m = one(db, 'SELECT * FROM members WHERE id = ? AND removed_at IS NULL', memberId);
    if (!m) throw new FamilyError(404, 'no_such_member');
    return m;
  }

  function requireAdmin(me) {
    if (!me.is_admin) throw new FamilyError(403, 'admins_only');
  }

  function requireChat(chatId, memberId) {
    const id = Number(chatId);
    const c = Number.isInteger(id) ? one(db, 'SELECT * FROM chats WHERE id = ?', id) : null;
    if (!c) throw new FamilyError(404, 'no_such_chat');
    const cm = one(db, 'SELECT * FROM chat_members WHERE chat_id = ? AND member_id = ? AND left_at IS NULL', id, memberId);
    if (!cm) throw new FamilyError(403, 'not_a_member');
    return c;
  }

  const currentMemberIds = (chatId) =>
    all(db, 'SELECT member_id FROM chat_members WHERE chat_id = ? AND left_at IS NULL', chatId).map((r) => r.member_id);

  // tell each member of a chat about it; each gets their own unread count
  function announceChat(chatId) {
    for (const mid of currentMemberIds(chatId)) hub.sendToMember(mid, { type: 'chat', chat: chatOut(chatId, mid) });
  }

  function systemLine(chatId, body) {
    const t = now();
    const r = run(db, 'INSERT INTO messages (chat_id, sender_id, kind, body, created_at) VALUES (?, NULL, \'system\', ?, ?)', chatId, body, t);
    run(db, 'UPDATE chats SET updated_at = ? WHERE id = ?', t, chatId);
    return Number(r.lastInsertRowid);
  }

  function broadcastMessage(messageId) {
    const row = one(db, 'SELECT * FROM messages WHERE id = ?', messageId);
    const msg = messageOut(row);
    for (const mid of currentMemberIds(row.chat_id)) hub.sendToMember(mid, { type: 'message', message: msg });
    return msg;
  }

  // ---------- invites ----------
  function createInvite(byMember, { nameHint, isAdmin } = {}) {
    if (byMember) requireAdmin(byMember);
    const code = newInviteCode();
    const t = now();
    const expiresAt = t + L.inviteDays * 86400_000;
    const r = run(db, `INSERT INTO invites (code_hash, created_by, name_hint, is_admin, created_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, ?)`,
      sha256Hex(normaliseInviteCode(code)), byMember ? byMember.id : null, cleanText(nameHint, L.nameChars) || null, isAdmin ? 1 : 0, t, expiresAt);
    return { id: Number(r.lastInsertRowid), code, link: `karaki://join/${code}`, expiresAt, nameHint: cleanText(nameHint, L.nameChars) || null };
  }

  function findOpenInvite(code) {
    const inv = one(db, 'SELECT * FROM invites WHERE code_hash = ?', sha256Hex(normaliseInviteCode(code)));
    if (!inv || inv.used_at || inv.revoked_at || inv.expires_at < now()) return null;
    return inv;
  }

  function checkInvite(code) {
    const inv = findOpenInvite(code);
    if (!inv) throw new FamilyError(404, 'invite_invalid');
    const by = inv.created_by ? one(db, 'SELECT name FROM members WHERE id = ?', inv.created_by) : null;
    return { nameHint: inv.name_hint, invitedBy: by ? by.name : null, expiresAt: inv.expires_at };
  }

  function listInvites(me) {
    requireAdmin(me);
    return all(db, 'SELECT * FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC', now())
      .map((i) => ({ id: i.id, nameHint: i.name_hint, isAdmin: !!i.is_admin, expiresAt: i.expires_at }));
  }

  function revokeInvite(me, id) {
    requireAdmin(me);
    run(db, 'UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL', now(), Number(id));
  }

  // ---------- sign in and devices ----------
  function newDevice(memberId, label) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    run(db, 'INSERT INTO devices (member_id, token_hash, label, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
      memberId, sha256Hex(token), cleanText(label, 60) || null, t, t);
    return token;
  }

  // apple: the checked { sub } from the identity token. Returns a session token for this phone.
  function signIn(apple, { inviteCode, name, deviceLabel } = {}) {
    return tx(db, () => {
      let member = one(db, 'SELECT * FROM members WHERE apple_sub = ?', apple.sub);
      if (member && member.removed_at) throw new FamilyError(403, 'removed');
      if (!member) {
        if (!inviteCode) throw new FamilyError(409, 'invite_required');
        const inv = findOpenInvite(inviteCode);
        if (!inv) throw new FamilyError(404, 'invite_invalid');
        const count = one(db, 'SELECT COUNT(*) AS n FROM members').n;
        const finalName = cleanText(name, L.nameChars) || inv.name_hint || 'Family member';
        const r = run(db, 'INSERT INTO members (name, apple_sub, is_admin, color, created_at) VALUES (?, ?, ?, ?, ?)',
          finalName, apple.sub, inv.is_admin ? 1 : 0, MEMBER_COLORS[count % MEMBER_COLORS.length], now());
        run(db, 'UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?', Number(r.lastInsertRowid), now(), inv.id);
        member = one(db, 'SELECT * FROM members WHERE id = ?', Number(r.lastInsertRowid));
        queueMicrotask(() => hub.broadcast({ type: 'members', members: listMembers() }));
      }
      return { token: newDevice(member.id, deviceLabel), member: memberOut(member) };
    });
  }

  function authenticate(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const d = one(db, 'SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL', sha256Hex(token));
    if (!d) return null;
    const m = one(db, 'SELECT * FROM members WHERE id = ? AND removed_at IS NULL', d.member_id);
    if (!m) return null;
    if (now() - d.last_seen > 60_000) run(db, 'UPDATE devices SET last_seen = ? WHERE id = ?', now(), d.id);
    return { member: m, device: d };
  }

  function signOut(device) {
    run(db, 'UPDATE devices SET revoked_at = ?, push_token = NULL, voip_token = NULL WHERE id = ?', now(), device.id);
    hub.closeDevice(device.id);
  }

  function setPushToken(device, { pushToken, voipToken }) {
    const hex = /^[0-9a-fA-F]{32,200}$/;
    if (pushToken !== undefined) {
      if (pushToken !== null && !hex.test(pushToken)) throw new FamilyError(400, 'bad_push_token');
      // a phone that changed hands keeps one token: take it off any other device first
      if (pushToken) run(db, 'UPDATE devices SET push_token = NULL WHERE push_token = ? AND id <> ?', pushToken, device.id);
      run(db, 'UPDATE devices SET push_token = ? WHERE id = ?', pushToken, device.id);
    }
    if (voipToken !== undefined) {
      if (voipToken !== null && !hex.test(voipToken)) throw new FamilyError(400, 'bad_push_token');
      run(db, 'UPDATE devices SET voip_token = ? WHERE id = ?', voipToken, device.id);
    }
  }

  // ---------- members ----------
  function listMembers() {
    return all(db, 'SELECT * FROM members WHERE removed_at IS NULL ORDER BY id').map(memberOut);
  }

  function renameSelf(me, name) {
    const n = cleanText(name, L.nameChars);
    if (!n) throw new FamilyError(400, 'name_required');
    run(db, 'UPDATE members SET name = ? WHERE id = ?', n, me.id);
    hub.broadcast({ type: 'members', members: listMembers() });
    return memberOut(one(db, 'SELECT * FROM members WHERE id = ?', me.id));
  }

  function removeMember(me, memberId) {
    requireAdmin(me);
    const target = activeMember(Number(memberId));
    if (target.id === me.id) throw new FamilyError(400, 'cannot_remove_self');
    const chatIds = tx(db, () => {
      run(db, 'UPDATE members SET removed_at = ? WHERE id = ?', now(), target.id);
      run(db, 'UPDATE devices SET revoked_at = ?, push_token = NULL, voip_token = NULL WHERE member_id = ? AND revoked_at IS NULL', now(), target.id);
      const ids = all(db, `SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id
                           WHERE cm.member_id = ? AND cm.left_at IS NULL AND c.kind = 'group'`, target.id).map((r) => r.id);
      return ids.map((id) => {
        run(db, 'UPDATE chat_members SET left_at = ? WHERE chat_id = ? AND member_id = ?', now(), id, target.id);
        return [id, systemLine(id, `${target.name} is no longer in the family`)];
      });
    });
    hub.closeMember(target.id);
    for (const [id, lineId] of chatIds) { broadcastMessage(lineId); announceChat(id); }
    hub.broadcast({ type: 'members', members: listMembers() });
  }

  // ---------- chats ----------
  function listChats(me) {
    return all(db, `SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id
                    WHERE cm.member_id = ? AND cm.left_at IS NULL ORDER BY c.updated_at DESC, c.id DESC`, me.id)
      .map((r) => chatOut(r.id, me.id));
  }

  function getChat(me, chatId) {
    const c = requireChat(chatId, me.id);
    return chatOut(c.id, me.id);
  }

  function openDirect(me, otherId) {
    const other = activeMember(Number(otherId));
    if (other.id === me.id) throw new FamilyError(400, 'cannot_chat_with_self');
    const key = [me.id, other.id].sort((a, b) => a - b).join(':');
    let created = false;
    const id = tx(db, () => {
      const existing = one(db, 'SELECT id FROM chats WHERE direct_key = ?', key);
      if (existing) return existing.id;
      const t = now();
      const r = run(db, 'INSERT INTO chats (kind, direct_key, created_by, created_at, updated_at) VALUES (\'direct\', ?, ?, ?, ?)', key, me.id, t, t);
      const cid = Number(r.lastInsertRowid);
      for (const mid of [me.id, other.id]) run(db, 'INSERT INTO chat_members (chat_id, member_id, joined_at) VALUES (?, ?, ?)', cid, mid, t);
      created = true;
      return cid;
    });
    if (created) announceChat(id);
    return chatOut(id, me.id);
  }

  function createGroup(me, { title, memberIds }) {
    const t0 = cleanText(title, L.groupTitleChars);
    if (!t0) throw new FamilyError(400, 'title_required');
    const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(Number))].filter((x) => x !== me.id);
    if (ids.length < 1) throw new FamilyError(400, 'members_required');
    const others = ids.map(activeMember);
    const id = tx(db, () => {
      const t = now();
      const r = run(db, 'INSERT INTO chats (kind, title, created_by, created_at, updated_at) VALUES (\'group\', ?, ?, ?, ?)', t0, me.id, t, t);
      const cid = Number(r.lastInsertRowid);
      for (const m of [me, ...others]) run(db, 'INSERT INTO chat_members (chat_id, member_id, joined_at) VALUES (?, ?, ?)', cid, m.id, t);
      systemLine(cid, `${me.name} started ${t0}`);
      return cid;
    });
    announceChat(id); // the opening line travels as the chat's last message
    return chatOut(id, me.id);
  }

  function requireGroup(me, chatId) {
    const c = requireChat(chatId, me.id);
    if (c.kind !== 'group') throw new FamilyError(400, 'not_a_group');
    return c;
  }

  function renameGroup(me, chatId, title) {
    const c = requireGroup(me, chatId);
    const t0 = cleanText(title, L.groupTitleChars);
    if (!t0) throw new FamilyError(400, 'title_required');
    let lineId;
    tx(db, () => {
      run(db, 'UPDATE chats SET title = ? WHERE id = ?', t0, c.id);
      lineId = systemLine(c.id, `${me.name} renamed the group to ${t0}`);
    });
    broadcastMessage(lineId);
    announceChat(c.id);
    return chatOut(c.id, me.id);
  }

  function addToGroup(me, chatId, memberId) {
    const c = requireGroup(me, chatId);
    const m = activeMember(Number(memberId));
    const existing = one(db, 'SELECT * FROM chat_members WHERE chat_id = ? AND member_id = ?', c.id, m.id);
    if (existing && !existing.left_at) throw new FamilyError(409, 'already_a_member');
    let lineId;
    tx(db, () => {
      // a returning member starts with everything up to now marked read
      const top = one(db, 'SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE chat_id = ?', c.id).id;
      if (existing) run(db, 'UPDATE chat_members SET left_at = NULL, joined_at = ?, delivered_up_to = ?, read_up_to = ? WHERE chat_id = ? AND member_id = ?', now(), top, top, c.id, m.id);
      else run(db, 'INSERT INTO chat_members (chat_id, member_id, joined_at, delivered_up_to, read_up_to) VALUES (?, ?, ?, ?, ?)', c.id, m.id, now(), top, top);
      lineId = systemLine(c.id, `${me.name} added ${m.name}`);
    });
    broadcastMessage(lineId);
    announceChat(c.id);
    return chatOut(c.id, me.id);
  }

  function removeFromGroup(me, chatId, memberId) {
    const c = requireGroup(me, chatId);
    const m = activeMember(Number(memberId));
    const leaving = m.id === me.id;
    // anyone can leave; removing someone else is for whoever started the group or a family admin
    if (!leaving && c.created_by !== me.id && !me.is_admin) throw new FamilyError(403, 'not_allowed');
    const cm = one(db, 'SELECT * FROM chat_members WHERE chat_id = ? AND member_id = ? AND left_at IS NULL', c.id, m.id);
    if (!cm) throw new FamilyError(404, 'not_in_group');
    let lineId;
    tx(db, () => {
      run(db, 'UPDATE chat_members SET left_at = ? WHERE chat_id = ? AND member_id = ?', now(), c.id, m.id);
      lineId = systemLine(c.id, leaving ? `${me.name} left` : `${me.name} removed ${m.name}`);
    });
    hub.sendToMember(m.id, { type: 'chat_removed', chatId: c.id });
    broadcastMessage(lineId);
    announceChat(c.id);
    return leaving ? null : chatOut(c.id, me.id);
  }

  // ---------- messages ----------
  function sendMessage(me, chatId, { kind = 'text', body, mediaId, clientId } = {}) {
    const c = requireChat(chatId, me.id);
    if (!['text', 'photo', 'voice'].includes(kind)) throw new FamilyError(400, 'bad_kind');
    const text = cleanText(body, L.textChars + 1);
    if (text.length > L.textChars) throw new FamilyError(413, 'text_too_long');
    const cid = typeof clientId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(clientId) ? clientId : null;
    if (cid) {
      // the same message sent twice (a retry after a dropped connection) gives back the first one
      const dup = one(db, 'SELECT * FROM messages WHERE sender_id = ? AND client_id = ?', me.id, cid);
      if (dup) return messageOut(dup);
    }
    let media = null;
    if (kind === 'text') {
      if (!text) throw new FamilyError(400, 'empty_message');
    } else {
      media = mediaId ? one(db, 'SELECT * FROM media WHERE id = ?', String(mediaId)) : null;
      if (!media || media.owner_id !== me.id || media.kind !== kind) throw new FamilyError(400, 'bad_media');
      const used = one(db, 'SELECT id FROM messages WHERE media_id = ?', media.id);
      if (used) throw new FamilyError(400, 'media_already_sent');
    }
    const id = tx(db, () => {
      const t = now();
      const r = run(db, 'INSERT INTO messages (chat_id, sender_id, kind, body, media_id, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        c.id, me.id, kind, text || null, media ? media.id : null, cid, t);
      const mid = Number(r.lastInsertRowid);
      run(db, 'UPDATE chats SET updated_at = ? WHERE id = ?', t, c.id);
      run(db, 'UPDATE chat_members SET delivered_up_to = ?, read_up_to = ? WHERE chat_id = ? AND member_id = ?', mid, mid, c.id, me.id);
      return mid;
    });
    const msg = broadcastMessage(id);
    pushNewMessage(me, c, msg).catch((e) => log.error?.(`[push] ${e.message}`));
    return msg;
  }

  function history(me, chatId, { before, after, limit } = {}) {
    const c = requireChat(chatId, me.id);
    const n = Math.min(Math.max(Number(limit) || L.pageSize, 1), 200);
    let rows;
    if (after !== undefined && after !== null && after !== '') {
      rows = all(db, 'SELECT * FROM messages WHERE chat_id = ? AND id > ? ORDER BY id ASC LIMIT ?', c.id, Number(after), n + 1);
      const hasMore = rows.length > n;
      return { messages: rows.slice(0, n).map(messageOut), hasMore };
    }
    const b = Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER;
    rows = all(db, 'SELECT * FROM messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?', c.id, b, n + 1);
    const hasMore = rows.length > n;
    return { messages: rows.slice(0, n).reverse().map(messageOut), hasMore };
  }

  // delivered: the phone has the message; read: the person has seen it. Marks only ever move forward.
  function mark(me, chatId, upTo, which) {
    const c = requireChat(chatId, me.id);
    const top = one(db, 'SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE chat_id = ?', c.id).id;
    const to = Math.min(Math.max(Number(upTo) || 0, 0), top);
    const cm = one(db, 'SELECT * FROM chat_members WHERE chat_id = ? AND member_id = ?', c.id, me.id);
    let delivered = cm.delivered_up_to;
    let read = cm.read_up_to;
    if (which === 'read') { read = Math.max(read, to); delivered = Math.max(delivered, read); } else delivered = Math.max(delivered, to);
    if (delivered === cm.delivered_up_to && read === cm.read_up_to) return { delivered, read };
    run(db, 'UPDATE chat_members SET delivered_up_to = ?, read_up_to = ? WHERE chat_id = ? AND member_id = ?', delivered, read, c.id, me.id);
    const ev = { type: 'receipt', chatId: c.id, memberId: me.id, delivered, read };
    for (const mid of currentMemberIds(c.id)) hub.sendToMember(mid, ev);
    return { delivered, read };
  }

  const markDelivered = (me, chatId, upTo) => mark(me, chatId, upTo, 'delivered');
  const markRead = (me, chatId, upTo) => mark(me, chatId, upTo, 'read');

  // delivered for every chat at once: what a phone says after it reconnects and catches up
  function markAllDelivered(me) {
    for (const r of all(db, 'SELECT chat_id FROM chat_members WHERE member_id = ? AND left_at IS NULL', me.id)) {
      const top = one(db, 'SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE chat_id = ?', r.chat_id).id;
      mark(me, r.chat_id, top, 'delivered');
    }
  }

  function typing(me, chatId, on) {
    const c = requireChat(chatId, me.id);
    const ev = { type: 'typing', chatId: c.id, memberId: me.id, on: !!on };
    for (const mid of currentMemberIds(c.id)) if (mid !== me.id) hub.sendToMember(mid, ev);
  }

  // ---------- media ----------
  // the type is decided from the file's first bytes, never from what the phone claims
  function sniff(buf, kind) {
    const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
    if (kind === 'photo') {
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
      if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
      if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(ascii(8, 12))) return 'image/heic';
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
      return null;
    }
    if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
    if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'audio/aac';
    if (ascii(0, 4) === 'caff') return 'audio/x-caf';
    return null;
  }

  // file: { path, size } of the upload multer wrote to a temporary place
  function saveMedia(me, file, { kind, width, height, durationMs }) {
    const cleanup = () => fs.rm(file.path, { force: true }, () => {});
    if (!['photo', 'voice'].includes(kind)) { cleanup(); throw new FamilyError(400, 'bad_kind'); }
    const max = kind === 'photo' ? L.photoBytes : L.voiceBytes;
    if (file.size > max) { cleanup(); throw new FamilyError(413, 'file_too_big'); }
    if (file.size < 16) { cleanup(); throw new FamilyError(400, 'file_empty'); }
    const fd = fs.openSync(file.path, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    const mime = sniff(head, kind);
    if (!mime) { cleanup(); throw new FamilyError(415, 'unsupported_file'); }
    const dur = Number(durationMs) || null;
    if (kind === 'voice' && dur && dur > L.voiceSeconds * 1000) { cleanup(); throw new FamilyError(413, 'voice_too_long'); }
    const id = crypto.randomBytes(16).toString('hex');
    fs.renameSync(file.path, path.join(mediaDir, id));
    const intOrNull = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
    run(db, 'INSERT INTO media (id, owner_id, kind, mime, bytes, width, height, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, me.id, kind, mime, file.size, intOrNull(width), intOrNull(height), dur, now());
    return mediaOut(id);
  }

  // a file may be fetched by whoever uploaded it, or by a current member of a chat it was sent in
  function mediaFor(me, id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) throw new FamilyError(404, 'no_such_media');
    const m = one(db, 'SELECT * FROM media WHERE id = ?', id);
    if (!m) throw new FamilyError(404, 'no_such_media');
    if (m.owner_id !== me.id) {
      const ok = one(db, `SELECT 1 AS ok FROM messages msg JOIN chat_members cm ON cm.chat_id = msg.chat_id
                          WHERE msg.media_id = ? AND cm.member_id = ? AND cm.left_at IS NULL LIMIT 1`, id, me.id);
      if (!ok) throw new FamilyError(403, 'not_a_member');
    }
    return { path: path.join(mediaDir, m.id), mime: m.mime, bytes: m.bytes };
  }

  // ---------- call lines in the chat ("Missed voice call", "Video call, 4 min") ----------
  // readBy: members who were on the call, for whom the line is not news
  function insertCallLine(call, outcome, seconds, readBy = []) {
    const body = JSON.stringify({ callId: call.id, kind: call.kind, outcome, seconds });
    const id = tx(db, () => {
      const t = now();
      const r = run(db, "INSERT INTO messages (chat_id, sender_id, kind, body, created_at) VALUES (?, ?, 'call', ?, ?)", call.chat_id, call.started_by, body, t);
      const mid = Number(r.lastInsertRowid);
      run(db, 'UPDATE chats SET updated_at = ? WHERE id = ?', t, call.chat_id);
      for (const m of new Set([call.started_by, ...readBy])) {
        run(db, 'UPDATE chat_members SET delivered_up_to = MAX(delivered_up_to, ?), read_up_to = MAX(read_up_to, ?) WHERE chat_id = ? AND member_id = ?', mid, mid, call.chat_id, m);
      }
      return mid;
    });
    const msg = broadcastMessage(id);
    announceChat(call.chat_id);
    if (outcome !== 'ended') {
      // a missed call is worth a notification to whoever missed it
      const caller = one(db, 'SELECT * FROM members WHERE id = ?', call.started_by);
      const chat = one(db, 'SELECT * FROM chats WHERE id = ?', call.chat_id);
      pushNewMessage(caller, chat, msg, new Set(readBy)).catch((e) => log.error?.(`[push] ${e.message}`));
    }
    return msg;
  }

  // ---------- push ----------
  function unreadTotal(memberId) {
    return one(db, `SELECT COUNT(*) AS n FROM messages msg JOIN chat_members cm ON cm.chat_id = msg.chat_id AND cm.member_id = ?
                    WHERE cm.left_at IS NULL AND msg.id > cm.read_up_to AND msg.kind <> 'system'
                    AND (msg.sender_id IS NULL OR msg.sender_id <> ?)`, memberId, memberId).n;
  }

  async function pushNewMessage(sender, chat, msg, skip = new Set()) {
    if (!push) return;
    const preview = msg.kind === 'photo' ? 'Photo' : msg.kind === 'voice' ? 'Voice note' : msg.kind === 'call' ? callWords(msg.body) : msg.body;
    for (const mid of currentMemberIds(chat.id)) {
      if (mid === sender.id || skip.has(mid)) continue;
      if (hub.isOnline(mid)) continue; // the open app shows it already
      const devices = all(db, 'SELECT id, push_token FROM devices WHERE member_id = ? AND revoked_at IS NULL AND push_token IS NOT NULL', mid);
      if (!devices.length) continue;
      const alert = chat.kind === 'group'
        ? { title: chat.title, subtitle: sender.name, body: config.apns.showPreview ? preview : 'New message' }
        : { title: sender.name, body: config.apns.showPreview ? preview : 'New message' };
      const payload = {
        aps: { alert, sound: 'default', badge: unreadTotal(mid), 'thread-id': `chat-${chat.id}`, 'mutable-content': 1 },
        chatId: chat.id, messageId: msg.id,
      };
      for (const d of devices) {
        const res = await push(d.push_token, payload, { collapseId: `m${msg.id}` });
        if (!res.ok && (res.status === 410 || res.reason === 'BadDeviceToken' || res.reason === 'Unregistered')) {
          run(db, 'UPDATE devices SET push_token = NULL WHERE id = ?', d.id);
        } else if (!res.ok) log.warn?.(`[push] device ${d.id}: ${res.status} ${res.reason}`);
      }
    }
  }

  return {
    memberOut, createInvite, checkInvite, listInvites, revokeInvite,
    signIn, authenticate, signOut, setPushToken,
    listMembers, renameSelf, removeMember,
    listChats, getChat, openDirect, createGroup, renameGroup, addToGroup, removeFromGroup,
    sendMessage, history, markDelivered, markRead, markAllDelivered, typing,
    saveMedia, mediaFor, unreadTotal,
    // for the calls module
    requireChat, currentMemberIds, announceChat, insertCallLine,
  };
}
