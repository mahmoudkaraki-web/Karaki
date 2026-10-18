# Karaki: the plan

Karaki is a private app for the Karaki family: messages and calls between each other, one to one and in groups, private to the family. Agreed with MAK on 18 Oct 2026. The folder is still called family-app; the app, its bundle id and its server are called Karaki.

## What was decided

* Three family members for now, all on iPhone.
* The normal iPhone layout first. The iPhone Duo and iPad layouts come later.
* Voice calls and video calls, both.
* English.
* Invite only. Nobody can find the app's members or write to them unless an admin lets them in.
* Bundle id com.besmart.karaki, App Store Connect SKU besmart-karaki, server at karaki.besmart-me.com.

## Encryption

For now (MAK, 18 Oct 2026: "testing, no encryption to start with") messages, photos and voice notes are kept plainly on the family server's disk, in its data folder. The only encryption is HTTPS between the phones and the server, because iPhones require it for network calls. What does protect the family today: invite only, Sign in with Apple, and the server refusing anything in a chat to anyone who is not in that chat.

Encryption comes in a later phase (see below): first at rest on the server, then end to end, so that only the phones can read the messages.

## Phases

### Phase 1: members and messages (built 18 Oct 2026)

* Invite only: the first admin invite is made on the server; after that admins make invite links in the app.
* From build 8 (18 Oct 2026, MAK: "I'd rather have download link and invite code to login"): the invite link alone gets someone installed and signed in, no Apple sign in. A sign in code from an admin puts a new or reset iPhone into the same account. The join page and a privacy page are served by the Karaki server (/join/CODE, /privacy).
* One to one chats and group chats: start a group, rename it, add or remove someone, leave.
* Text, photos (camera or library), voice notes (hold to record, slide left to cancel).
* Ticks: one when the server has it, two when it reached the other phone, two in terracotta when read. In groups, "seen by" seals under your last message.
* Who is writing, and who has the app open right now.
* Push notifications for members who do not have the app open, with the unread count on the icon.
* History in pages of 50, older pages loading as you scroll up.

### Phases 2 and 3: calls (built 18 Oct 2026, together)

* One to one and group calls (up to 4 people), voice and video, from every chat, the person's page and the family screen.
* Ringing like a normal phone call through CallKit and VoIP pushes, also with the app closed and the phone locked; answer and decline from the lock screen.
* Mute, speaker, camera on and off, front or back camera.
* A group call that is going on shows in the chat with a Join button.
* Every call leaves a line in the chat ("Video call, 4 min", "Missed voice call").
* A relay (TURN, coturn on the box) for networks that block direct calls, with passwords that expire.

How it works and what is still to try on real iPhones: docs/phase-2.md.

### Later

1. The iPhone Duo and iPad layouts.
2. Encryption at rest on the server, then end to end encryption.
3. Distribution: TestFlight first (the family installs it from TestFlight), later an unlisted App Store listing.

## Where things are

* server/: the family server (Node 22 or newer, Express, SQLite, WebSocket). Tests: `npm test` in server/.
* app/: the iPhone app (Expo SDK 57). Build: app/ios-build.ps1.
* .interface-design/system.md: the look and why.
* docs/setup-for-mak.md: the steps only MAK can do.
* docs/phase-2.md: how calls work.
