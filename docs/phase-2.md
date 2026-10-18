# Karaki phase 2: calls

Written 18 Oct 2026, before any of it is built. Voice and video calls between two people first; group calls (phase 3) reuse the same parts.

## How a call works

1. Sara taps the phone or video button in a chat (the buttons are already there; today they say calls are coming soon).
2. Her phone makes a call offer (WebRTC, through react-native-webrtc) and sends it to the Karaki server over the live socket that already carries messages. The socket already refuses anything starting with `call.` with "calls_not_yet"; that is where the call messages go.
3. The server checks that both people are in that chat, then rings MAK's iPhone with a VoIP push (PushKit). This push wakes the app even when it is closed or the phone is locked.
4. The app tells iOS about the incoming call through CallKit, so MAK sees the normal full screen iPhone call (on the lock screen too), with Karaki and Sara's name.
5. MAK answers. His phone sends the answer back through the server, both phones exchange network details ("ICE candidates"), and then the voice and video go straight between the two phones, encrypted by WebRTC itself (DTLS and SRTP; this is built into every WebRTC call and needs nothing from us).
6. When the two phones cannot reach each other directly (some mobile networks and office WiFi block it), they relay through a TURN server.

## The parts

* react-native-webrtc: the calling engine on the phone (audio, camera, the connection).
* react-native-callkeep or a small own config plugin: CallKit (the iPhone call screen) and PushKit (VoIP pushes). Expo builds need a config plugin for both; the plan is a small plugin in the repo, so EAS keeps building in the cloud with no Mac.
* app.json additions: the background modes `voip` and `audio`, camera and microphone texts (the microphone one exists already).
* Server: the call messages on the socket (`call.offer`, `call.answer`, `call.ice`, `call.end`, `call.busy`), a VoIP push sender (already written: the push sender sends to the `com.besmart.karaki.voip` topic when asked for a voip push, and has a test), and the TURN details given to the phones with a short lived password.
* The devices table already has a `voip_token` column, and `POST /me/push` already accepts `voipToken`.
* A TURN server: coturn, a small free program, on the same box as the Karaki server, with ports 3478 (UDP and TCP) and a range of UDP ports open. It uses a shared secret so the server can hand out passwords that expire.

## What MAK must add for VoIP push

1. Nothing new on the identifier for VoIP push itself: the same APNs key (the AuthKey_CB........p8 already made) works for VoIP pushes. Apple's VoIP pushes go to the topic com.besmart.karaki.voip, which the server already uses.
2. In Xcode terms the app needs the "Voice over IP" background mode; in Expo that is one line in app.json, done in the build, nothing for MAK to tick.
3. On the box, when phase 2 goes online: open the TURN ports in Azure's network settings (3478 UDP and TCP, and UDP 49160 to 49200), and add a DNS A record `turn` pointing at the box if a separate name is wanted.
4. Apple's rule to know about: every VoIP push must show a CallKit call at once, or iOS stops delivering them to the app. The code will follow that rule; it is why VoIP pushes are used only for calls, never for messages.

## Group calls (phase 3)

With three people each phone opens a connection to the other two (a mesh): two outgoing and two incoming streams per phone. That is fine for three or four people on a modern iPhone, so no media server (SFU) is needed. CallKit shows it as one call with the group's name.

## Order of work

1. The socket messages for calls on the server, with tests (two simulated members ringing, answering, hanging up, a non member refused).
2. The config plugin for CallKit and PushKit; a test build to TestFlight that only rings.
3. Voice calls one to one, then video.
4. coturn on the box, and the TURN password handed out by the server.
5. Group calls.
