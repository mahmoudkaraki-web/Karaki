// End to end: real WebRTC peers (werift, a WebRTC stack written in TypeScript) connect to each
// other on this machine using nothing but the Karaki server's call signalling, the same mesh
// rule the app follows (whoever joins offers to everyone already on the call). Two people with
// sound packets and a data channel, then three people in a full mesh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader } from 'werift';
import { startTestServer, connect, sleep } from './helpers.js';

let t;
let mak; let sara; let omar;
before(async () => {
  t = await startTestServer();
  mak = await t.join('MAK', { admin: true });
  sara = await t.join('Sara', { inviter: mak });
  omar = await t.join('Omar', { inviter: mak });
});
after(async () => { await t.close(); });

// one person's side of the call: a peer connection per other person on the call
function meshPeer(name, client, meId, { audio = false } = {}) {
  const pcs = new Map();
  const pendingIce = new Map();
  const heard = new Set();      // names heard over data channels
  const rtpFrom = new Map();    // member id -> sound packets received
  let callId = null;

  function pcFor(peerId) {
    if (pcs.has(peerId)) return pcs.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) client.send({ type: 'call.ice', callId, to: peerId, candidate: candidate.toJSON() });
    };
    pc.ondatachannel = ({ channel }) => wire(channel);
    pc.ontrack = ({ track }) => {
      track.onReceiveRtp.subscribe(() => rtpFrom.set(peerId, (rtpFrom.get(peerId) || 0) + 1));
    };
    if (audio) {
      const track = new MediaStreamTrack({ kind: 'audio' });
      pc.addTransceiver(track, { direction: 'sendrecv' });
      pc.localAudio = track;
    }
    pcs.set(peerId, pc);
    return pc;
  }

  function wire(channel) {
    channel.onmessage = ({ data }) => heard.add(String(data));
    const hello = () => channel.send(name);
    if (channel.readyState === 'open') hello(); else channel.onopen = hello;
  }

  async function flushIce(peerId) {
    const pc = pcs.get(peerId);
    for (const c of pendingIce.get(peerId) || []) await pc.addIceCandidate(c);
    pendingIce.delete(peerId);
  }

  client.ws.on('message', async (raw) => {
    const ev = JSON.parse(raw.toString());
    if (ev.callId !== callId) return;
    if (ev.type === 'call.offer') {
      const pc = pcFor(ev.from);
      await pc.setRemoteDescription({ type: 'offer', sdp: ev.sdp });
      await flushIce(ev.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      client.send({ type: 'call.answer', callId, to: ev.from, sdp: pc.localDescription.sdp });
    } else if (ev.type === 'call.answer') {
      await pcs.get(ev.from).setRemoteDescription({ type: 'answer', sdp: ev.sdp });
      await flushIce(ev.from);
    } else if (ev.type === 'call.ice') {
      const pc = pcs.get(ev.from);
      if (pc && pc.remoteDescription) await pc.addIceCandidate(ev.candidate);
      else pendingIce.set(ev.from, [...(pendingIce.get(ev.from) || []), ev.candidate]);
    }
  });

  return {
    pcs, heard, rtpFrom,
    setCall: (id) => { callId = id; },
    // joining: offer to everyone already there
    async offerTo(peerIds) {
      for (const peerId of peerIds) {
        const pc = pcFor(peerId);
        wire(pc.createDataChannel('karaki'));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        client.send({ type: 'call.offer', callId, to: peerId, sdp: pc.localDescription.sdp });
      }
    },
    // a short burst of fake sound packets to every peer, on the negotiated codec
    sendSound(packets = 30) {
      for (const pc of pcs.values()) {
        const tr = pc.getTransceivers().find((x) => x.kind === 'audio');
        const pt = tr?.codecs?.[0]?.payloadType ?? 111;
        for (let i = 0; i < packets; i++) {
          const header = new RtpHeader({ payloadType: pt, sequenceNumber: 1000 + i, timestamp: 960 * i, ssrc: 4242, marker: false });
          pc.localAudio.writeRtp(new RtpPacket(header, Buffer.alloc(40, i)));
        }
      }
    },
    close: () => Promise.all([...pcs.values()].map((pc) => pc.close())),
  };
}

async function until(fn, ms = 15000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

test('two phones really connect through the server: ICE, DTLS, a data channel and sound packets', async () => {
  const chat = (await t.api('POST', '/chats/direct', { token: mak.token, body: { memberId: sara.member.id } })).data.chat;
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const pa = meshPeer('MAK', a, mak.member.id, { audio: true });
  const pb = meshPeer('Sara', b, sara.member.id, { audio: true });

  const { call } = await a.request({ type: 'call.start', chatId: chat.id, kind: 'voice' });
  pa.setCall(call.id);
  await b.waitFor((e) => e.type === 'call.ring');
  pb.setCall(call.id);
  const acc = await b.request({ type: 'call.accept', callId: call.id });
  await pb.offerTo(acc.peers);

  await until(() => pa.heard.has('Sara') && pb.heard.has('MAK'), 15000, 'data channel hellos');
  assert.equal(pa.pcs.get(sara.member.id).connectionState, 'connected');
  assert.equal(pb.pcs.get(mak.member.id).connectionState, 'connected');

  pa.sendSound();
  pb.sendSound();
  await until(() => (pa.rtpFrom.get(sara.member.id) || 0) > 0 && (pb.rtpFrom.get(mak.member.id) || 0) > 0, 10000, 'sound packets');

  await a.request({ type: 'call.hangup', callId: call.id });
  await pa.close(); await pb.close();
  await a.close(); await b.close();
});

test('three phones form a full mesh through the server, the third joining a running call', async () => {
  const g = (await t.api('POST', '/chats/group', { token: mak.token, body: { title: 'Mesh', memberIds: [sara.member.id, omar.member.id] } })).data.chat;
  const a = await connect(t.base, mak.token);
  const b = await connect(t.base, sara.token);
  const c = await connect(t.base, omar.token);
  const pa = meshPeer('MAK', a, mak.member.id);
  const pb = meshPeer('Sara', b, sara.member.id);
  const pc = meshPeer('Omar', c, omar.member.id);

  const { call } = await a.request({ type: 'call.start', chatId: g.id, kind: 'video' });
  for (const p of [pa, pb, pc]) p.setCall(call.id);
  const sj = await b.request({ type: 'call.accept', callId: call.id });
  await pb.offerTo(sj.peers);
  await until(() => pa.heard.has('Sara') && pb.heard.has('MAK'), 15000, 'MAK and Sara connected');

  const oj = await c.request({ type: 'call.accept', callId: call.id });
  assert.equal(oj.peers.length, 2);
  await pc.offerTo(oj.peers);
  await until(() => ['Sara', 'Omar'].every((n) => pa.heard.has(n)) && ['MAK', 'Omar'].every((n) => pb.heard.has(n)) && ['MAK', 'Sara'].every((n) => pc.heard.has(n)), 20000, 'full mesh');
  for (const p of [pa, pb, pc]) {
    assert.equal(p.pcs.size, 2);
    for (const conn of p.pcs.values()) assert.equal(conn.connectionState, 'connected');
  }

  for (const [cl, who] of [[a, 'a'], [b, 'b'], [c, 'c']]) await cl.request({ type: 'call.hangup', callId: call.id }).catch(() => who);
  for (const p of [pa, pb, pc]) await p.close();
  await a.close(); await b.close(); await c.close();
});

// The app's way of switching video on and off mid call (src/calls.ts): the offer always carries
// an audio and an empty video channel; the camera is swapped in and out with replaceTrack, with
// no new offer, so there is no clash of offers in the mesh.
test('video switched on and off in a voice call, both sides, with no new offer', async () => {
  const chat = (await t.api('POST', '/chats/direct', { token: mak.token, body: { memberId: omar.member.id } })).data.chat;
  const a = await connect(t.base, mak.token);
  const c = await connect(t.base, omar.token);
  let callId = null;
  let offersRelayed = 0;
  const videoIn = { a: 0, c: 0 };

  function side(client, name) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const mic = new MediaStreamTrack({ kind: 'audio' });
    let peerId = null;
    const pending = [];
    pc.onicecandidate = ({ candidate }) => { if (candidate && peerId) client.send({ type: 'call.ice', callId, to: peerId, candidate: candidate.toJSON() }); };
    pc.ontrack = ({ track }) => { if (track.kind === 'video') track.onReceiveRtp.subscribe(() => { videoIn[name] += 1; }); };
    client.ws.on('message', async (raw) => {
      const ev = JSON.parse(raw.toString());
      if (ev.callId !== callId) return;
      if (ev.type === 'call.offer') {
        offersRelayed += 1;
        peerId = ev.from;
        await pc.setRemoteDescription({ type: 'offer', sdp: ev.sdp });
        // the answering side takes the offer's channels and sends on both, video empty for now
        for (const tr of pc.getTransceivers()) {
          tr.setDirection('sendrecv');
          if (tr.kind === 'audio') await tr.sender.replaceTrack(mic);
        }
        for (const cand of pending.splice(0)) await pc.addIceCandidate(cand);
        await pc.setLocalDescription(await pc.createAnswer());
        client.send({ type: 'call.answer', callId, to: ev.from, sdp: pc.localDescription.sdp });
      } else if (ev.type === 'call.answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: ev.sdp });
        for (const cand of pending.splice(0)) await pc.addIceCandidate(cand);
      } else if (ev.type === 'call.ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(ev.candidate); else pending.push(ev.candidate);
      }
    });
    return {
      pc,
      async offer(to) {
        peerId = to;
        pc.addTransceiver(mic, { direction: 'sendrecv' });
        pc.addTransceiver('video', { direction: 'sendrecv' }); // the empty video channel
        await pc.setLocalDescription(await pc.createOffer());
        client.send({ type: 'call.offer', callId, to, sdp: pc.localDescription.sdp });
      },
      // the camera button: a track in (or out) of the video channel, nothing else
      async camera(on) {
        const tr = pc.getTransceivers().find((x) => x.kind === 'video');
        if (!on) { await tr.sender.replaceTrack(null); return null; }
        const cam = new MediaStreamTrack({ kind: 'video' });
        await tr.sender.replaceTrack(cam);
        return { cam, pt: tr.codecs[0].payloadType };
      },
    };
  }

  const pa = side(a, 'a');
  const pc_ = side(c, 'c');
  const start = await a.request({ type: 'call.start', chatId: chat.id, kind: 'voice' });
  callId = start.call.id;
  await c.waitFor((e) => e.type === 'call.ring');
  const acc = await c.request({ type: 'call.accept', callId });
  await pc_.offer(acc.peers[0]);
  await until(() => pa.pc.connectionState === 'connected' && pc_.pc.connectionState === 'connected', 15000, 'voice call connected');

  const frames = async (cam, pt, n = 20) => {
    for (let i = 0; i < n; i++) {
      cam.writeRtp(new RtpPacket(new RtpHeader({ payloadType: pt, sequenceNumber: 5000 + i, timestamp: 3000 * i, ssrc: 777 + pt, marker: true }), Buffer.from([0x90, 0x80, i & 0x7f, 0x10, 0, 0, 0, 0])));
      await sleep(5);
    }
  };

  // MAK turns his camera on: Omar gets video
  const macCam = await pa.camera(true);
  const notify = await a.request({ type: 'call.media', callId, audio: true, video: true });
  assert.equal(notify.type, 'ack');
  const told = await c.waitFor((e) => e.type === 'call.media' && e.from === mak.member.id);
  assert.equal(told.video, true, 'Omar is told MAK\'s camera is on');
  await frames(macCam.cam, macCam.pt);
  await until(() => videoIn.c > 0, 10000, 'video reaching Omar');

  // Omar turns his on too, then MAK turns his off
  const omarCam = await pc_.camera(true);
  await frames(omarCam.cam, omarCam.pt);
  await until(() => videoIn.a > 0, 10000, 'video reaching MAK');
  await pa.camera(false);
  a.send({ type: 'call.media', callId, audio: true, video: false });
  assert.equal((await c.waitFor((e) => e.type === 'call.media' && e.from === mak.member.id && e.video === false)).video, false);

  assert.equal(offersRelayed, 1, 'only the first offer ever: switching video needed no renegotiation');
  assert.equal(pa.pc.connectionState, 'connected');
  await a.request({ type: 'call.hangup', callId });
  await pa.pc.close(); await pc_.pc.close();
  await a.close(); await c.close();
});
