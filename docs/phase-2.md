# Karaki calls (phases 2 and 3)

Built 18 Oct 2026, both phases together: one to one and group calls, voice and video, ringing like a normal phone call. Not yet tried on a real iPhone; that needs the first TestFlight build and the server online.

## What the family sees

* A phone and a video button in every chat, on the person's page (tap the chat's title), and next to each person in the family screen.
* The call rings like a normal iPhone call, also when Karaki is closed and the phone is locked: answer or decline from the lock screen.
* On a call: mute, speaker, camera on and off, front or back camera, end. Video shows the others full screen (split when there are two or three) and you in a small tile.
* Group calls: up to 4 people. While a group call is going on, the chat shows "Call in progress" with a Join button, so anyone in the group can come in late.
* Every call leaves a line in the chat: "Video call, 4 min", or "Missed voice call" for whoever missed it (with a notification), and "Voice call, no answer" (or declined, busy) for whoever called.

## How it works

1. Calling: the phone makes a call id and shows the call to iOS through CallKit at once, then asks the Karaki server to ring the others (`call.start` on the live socket).
2. Ringing: the server checks that the caller and everyone rung are in that chat, keeps a call record in SQLite, and rings each person two ways: a `call.ring` message to any open app, and a VoIP push (PushKit) to every phone of theirs. The push goes through APNs with the same key as normal pushes, to the topic com.besmart.karaki.voip, push type voip, priority 10, delivered now or never.
3. Apple's rule: a VoIP push must be shown as a call at once, or iOS stops delivering them and may close the app. Karaki's own small native module (app/modules/karaki-calls, Swift) handles the push before any JavaScript runs and reports it to CallKit immediately. A push that arrives after the call stopped ringing is still reported, and then ended straight away.
4. Answering: CallKit tells the app, the app joins the call on the server (`call.accept`), and then sends a WebRTC offer to everyone already on the call. That one rule (whoever joins makes the offers) is the whole group call design: with three people every phone has a direct connection to each of the other two (a mesh), so no media server is needed.
5. Offers, answers and network candidates go phone to server to phone (`call.offer`, `call.answer`, `call.ice`); camera and microphone state too (`call.media`). Only people on the call get them.
6. Voice and video then flow directly between the phones, encrypted by WebRTC itself (DTLS and SRTP, built into every WebRTC call). When two phones cannot reach each other directly, they relay through the TURN server (coturn) on the box. That relay already runs on the box (coturn 4.6.1, set up by MAK on 18 Oct 2026, UDP and TCP on port 3478, relay ports UDP 49160 to 49200). The Karaki server gives each phone a TURN password that lasts about two hours, signed with the shared secret the way coturn expects.
7. Ending: whoever leaves sends `call.hangup`. A one to one call ends when either side leaves; a group call ends when one person is left. Nobody answering for 45 seconds ends the ring as missed. Busy (already on a call, or the phone said busy) and declined end it too. A phone that loses its connection mid call gets 20 seconds to come back before it counts as gone.

## The parts

* react-native-webrtc 155 with its Expo config plugin: the calling engine (microphone, camera, connections).
* app/modules/karaki-calls: CallKit and PushKit in Swift, loaded at app launch through an Expo app delegate hook. Chosen over react-native-callkeep and react-native-voip-push-notification because those need Objective C changes to the app delegate, which Expo SDK 57 now writes in Swift, and because the push has to reach CallKit natively anyway. It also hands CallKit's audio session to WebRTC (manual audio), which is what makes answering from the lock screen produce sound.
* app/src/calls.ts: the call logic on the phone. app/src/screens/Call.tsx: the call screen.
* server/src/calls.js: ringing, signalling, the ring timeout, busy, the call record, VoIP pushes, TURN passwords.
* The relay's install script and test: Karaki APP\relay-setup, outside the code.
* Info.plist: background modes voip and audio, camera and microphone texts.

## Tests

* Server: two and three people, decline, busy (both kinds), the ring timeout, a non member refused everything, a second call in the same chat, a dropped phone, the VoIP push format, TURN passwords checked against the HMAC.
* Real connections: WebRTC peers written in TypeScript (werift) connect through the server's signalling on this laptop, two people with sound packets and a data channel, then three people in a full mesh with the third joining a running call.

## Still to check on real iPhones

1. A call between two iPhones on WiFi, then one on mobile data (that one goes through the relay).
2. Ringing with Karaki closed and the phone locked; answering and declining from the lock screen.
3. Speaker, mute from the CallKit screen, Bluetooth earphones.
4. A group call with three phones, and someone joining late.
5. Missed call lines and their notifications.
