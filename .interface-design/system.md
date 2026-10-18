# Karaki: interface system

Written 18 Oct 2026 for phase 1 (members and messages). The app was first called Family; MAK named it Karaki the same day. The tokens live in `app/src/theme.ts`; this file is the why.

## Intent

Who: three people in one family, on their own iPhones, opening the app between other things: at the office, in the car park, on the sofa at night. They know each other; there are no strangers here, no discovery, no growth.
What: write to one person or to all of us, send a photo or a quick voice note, see that it arrived and was read.
Feel: the kitchen table. Warm, quiet, private, a little bit paper. Not a social network, not a bank, not a startup. Nothing shouts.

## Domain

the house, the kitchen table, the front door and its keys (the invite), notes stuck on the fridge, letters and envelopes, the porch light left on, voices down the hallway, the family name on the doorbell.

## Colour world

linen tablecloth, walnut table, enamel kettle ink, terracotta plant pot, warm lamplight at night, the brass of a door handle.

## Signature: the household seal

Every member has one fixed colour, given in join order (terracotta, olive green, slate violet, ochre, plum, ...), and an initial seal: a rounded square, never a circle. The seal shows up in five places:

1. The household strip at the top of the chat list: every member's seal and first name. Tapping a seal opens the chat with that person (with three people, that is the main way in).
2. The porch light: a small warm dot on a seal when that person has the app open right now.
3. Group chats: the sender's first name above a run of their messages, in their seal colour.
4. Seen by: under your last message in a group, tiny seals of the people who have read it.
5. Group rows in the chat list: the members' seals stacked and overlapping.

## Defaults rejected

1. Blue and green bubbles: replaced by ink and paper. Your messages are written in walnut ink (dark fill, linen text); theirs are on raised paper with a hairline edge.
2. Circle avatars with photos: replaced by the initial seal in the member's colour.
3. A floating round "+" button and pill shaped buttons: replaced by slim, squared buttons (8 px radius) and a quiet "New" in the header.

## Type

* Fraunces (soft serif, by Undercase Type, free) for the wordmark, screen titles, chat titles, the invite code. It gives the letter and kitchen table feel.
* The iPhone's own system font (SF Pro) for messages, lists and controls: the most readable thing on an iPhone, and messages are read a lot.
* Scale, ratio 1.25 from a 16 px body: caption 12 · meta 13 · secondary 14 · body 16 · title 20 · heading 25 · display 34 (the wordmark 44).
* Weight and colour carry hierarchy before size: names 600 primary, previews 400 secondary, times 400 tertiary.
* Times and counts use tabular numbers.
* Dates in full read like 18 Oct 2026; today and yesterday are written as words; times as 14:05.

## Colour tokens

Light (the table by day):
* `linen` #F5F0E7: the page.
* `paper` #FFFCF6: raised surfaces, their bubbles, rows on press.
* `inset` #ECE5D8: text fields and the composer (inset is darker than its surroundings).
* `ink` #1F1B16, `inkSoft` #5C5348, `inkFaint` #8A7F72, `inkGhost` #B5AB9E: the four text levels.
* `walnut` #2B2520 with `walnutText` #F5EEE3: your own bubbles.
* `terracotta` #B4532A: the one accent. Send, primary buttons, unread counts, read ticks, links. Nothing else.
* `hairline` rgba(60,40,20,0.12), `hairlineSoft` rgba(60,40,20,0.07).
* `danger` #A33A2B (leave, remove, sign out, recording).
* `porch` #E3A547: the presence dot.

Dark (the table at night, lamplight, warm black, never blue black):
* `linen` #15130F, `paper` #1F1C17, `raised` #27231D, `inset` #0E0D0A.
* `ink` #F2EADF, `inkSoft` #BDB2A4, `inkFaint` #8C8275, `inkGhost` #5F574C.
* `walnut` #4A3527 with `walnutText` #F6EBDC.
* `terracotta` #D27A4E (lifted so it reads on dark).
* `hairline` rgba(255,240,220,0.10), `hairlineSoft` rgba(255,240,220,0.06).

## Depth

Surface colour shifts plus hairlines. No drop shadows anywhere (they read as dirt on dark and as "app template" on light). Elevation steps are a few points of lightness: linen, paper, raised.

## Spacing and shape

* Base unit 4. Steps 4, 8, 12, 16, 24, 32. Screen side margin 16.
* Radius scale: 6 small chips and the unread count, 8 buttons, inputs and seals up to 36 px, 10 the composer field, 12 bubbles (the corner nearest the sender drops to 4 on the last bubble of a run), 16 sheets.
* Density: calm. List rows 68 px tall, bubble padding 8 by 12, runs of the same sender 2 px apart, new sender 10 px.

## Components

* Button primary: 40 px tall, 16 px side padding, radius 8, terracotta fill, 15/600 linen text. Never pill shaped.
* Button quiet: same size, transparent with a hairline border, ink text. Small variant 32 px tall, 12 px padding, 14/600.
* Header text button ("New", "Done"): 15/600 terracotta, 44 px hit area.
* Seal: sizes 24 (seen by, typing), 36 (rows, header), 48 (household strip), 72 (profile). Radius 8 at 36 and below, 12 at 48, 18 at 72. Initial in Fraunces 600, linen on the member colour.
* Ticks: SF Symbol checkmarks at 11 px, semibold. One sent, two overlapping (4.5 px apart) delivered in inkFaint, two read in terracotta (a lighter terracotta #E9A27C inside your own walnut bubbles). A small clock while waiting for the server, a red mark when it failed.
* Composer: inset field radius 10, min 40 px; photo button left; on the right a mic you hold to record (slide left to cancel), which becomes a 34 px terracotta squared send button once there is text.
* Call buttons (phone, video) in the chat header, on the person's page and beside each person in the family screen.
* The call screen is always the night table (#15130F) whatever the phone's theme, like the iPhone's own call screen. Controls are squared tiles, 60 by 52, radius 12, a quiet fill (rgba 255,240,220,0.10) that turns linen when switched on (muted, speaker, camera off); the label sits under the tile at 11 px. End, Answer and Decline are wide slim bars, 48 tall, radius 10: danger red #C2493A, answer green #3F8F5C. Never round pills.
* Call screen structure, top to bottom: the stage (the people) takes all the room above the controls and nothing in it reaches below; the title and status are laid over the top of the stage; the control tiles have their own row; the End bar sits 20 px under the tiles and 16 px above the home indicator (24 px above the edge on phones without one). Checked at 375 by 667, 393 by 852 and 430 by 932.
* Video: the others fill the stage, split top to bottom for two or three; anyone with the camera off shows as their seal with "Camera off"; you in a 100 by 142 tile, radius 12, top right, mirrored on the front camera. Voice: the others' seals at 72 with name and state under each. The camera tile is there in voice calls too.
* A running group call shows as a paper band under the chat header: phone or video icon in terracotta, "Call in progress" with who is on it, and a small Join button.
* Call lines in the chat: a small centred paper chip with a phone or video icon, the words and the time; terracotta when it is a missed call. Tapping it calls back.

## Motion

Almost none. New bubbles appear without animation (messaging is repeated hundreds of times a day). Press feedback is an opacity drop to 0.6 over 100 ms. Recording shows a slowly pulsing red dot.
