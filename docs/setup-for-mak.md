# Karaki: the steps only MAK can do

Written 18 Oct 2026. Claude never makes, opens or copies a key; each key below is made by MAK and only its place is written down.

## Already done by MAK (18 Oct 2026)

1. The identifier com.besmart.karaki on developer.apple.com, with Sign in with Apple and Push Notifications ticked.
2. The app record in App Store Connect, SKU besmart-karaki.
3. The push key (APNs auth key, a file called AuthKey_CB........p8).

## Still to do

### 1. Put the push key in its folder

Move the file AuthKey_CB........p8 from Downloads into:

C:\Users\mahmo\OneDrive - Be Smart Me\Karaki APP\Push Key

That folder is outside the code, so the key never goes into git. Apple lets you download this key only once: keep this copy safe and send it to nobody. When the server goes online (step 4), you copy the same file onto the server yourself.

### 2. Send the app's Apple ID number

In App Store Connect, open Karaki, then App Information. Under General Information there is "Apple ID", a number of about ten digits. Send it in the chat. It goes into app/eas.json as ascAppId so every new build goes to TestFlight by itself.

### 2b. The very first build (once)

The first build of a new app needs a provisioning profile, and Expo makes it only when someone answers its questions. In PowerShell:

    cd "C:\Users\mahmo\OneDrive - Be Smart Me\Karaki APP\family-app\app"
    .\ios-build.ps1 -Interactive

Answer yes to each question (use the existing distribution certificate, make a new provisioning profile). It uses the App Store Connect key, so it should not ask for your Apple password; if it does, sign in with your Apple developer account. The build then runs in Expo's cloud for about 15 to 25 minutes and goes to TestFlight by itself. Every later build is just `.\ios-build.ps1`, and Claude can run those.

### 3. Let the family into TestFlight

When a build shows in App Store Connect under TestFlight:

1. Answer the export compliance question if it is asked (the app is already marked as using only standard encryption, so it usually is not).
2. For yourself: you are already on the team, so add yourself under Internal Testing and install TestFlight on your iPhone.
3. For the family: make a group under External Testing, add their Apple ID emails, and send the first build for Beta App Review (usually a day). After that, new builds reach them without another review most of the time.

The app installs and opens before the server is online, but signing in only works once step 4 is done. Until then the welcome screen says "Karaki is not online yet".

### 4. Put the server online (after Monday's bank demo, not before)

The demo box (20.74.255.57) is frozen until you say the demo is over. Nothing goes there before that. When it is over:

1. In GoDaddy, DNS for besmart-me.com: add an A record, name `karaki`, value `20.74.255.57`.
2. On the box, Node 22 or newer must be installed (`node -v`).
3. Copy the server folder (family-app\server, without node_modules) to /opt/karaki/server and in that folder run `npm install --omit=dev`.
4. Make a user and the data folder: `sudo useradd --system karaki`, `sudo mkdir -p /var/lib/karaki /etc/karaki/pushkey`, `sudo chown karaki /var/lib/karaki`.
5. Copy your AuthKey_CB........p8 into /etc/karaki/pushkey on the box yourself, readable only by the karaki user: `sudo chown -R karaki /etc/karaki/pushkey` and `sudo chmod 600 /etc/karaki/pushkey/*`.
6. Copy server/.env.example to /opt/karaki/server/.env. It already points at /etc/karaki/pushkey and /var/lib/karaki; nothing else needs changing.
7. Copy server/deploy/karaki.service to /etc/systemd/system/, then `sudo systemctl daemon-reload` and `sudo systemctl enable --now karaki`.
8. Add the block in server/deploy/Caddyfile.snippet to the box's Caddyfile and reload Caddy. Caddy gets the HTTPS certificate for karaki.besmart-me.com by itself.
9. Check: https://karaki.besmart-me.com/health in a browser shows `{"ok":true,...}`.
10. Make your own admin invite, on the box, in /opt/karaki/server:

    `sudo -u karaki node --env-file=.env scripts/invite.js --name MAK --admin`

    It prints a code like K7QX-M2PA. In Karaki on your iPhone: "I have an invite code", type it, Sign in with Apple. You are the first member and the admin.
11. Invite the family from the app: the people button at the top left, then "Invite someone". Share the code with each of them.

Port 4100 stays closed to the internet; only Caddy (ports 80 and 443) talks to the world.

The box is Ubuntu with systemd, like the R&B services, so these files fit as they are.

### 5. TURN for calls (after the demo, with step 4)

Most calls go straight from phone to phone. When a mobile network or an office WiFi blocks that, the call goes through a relay on the box called coturn. Without it some calls connect and then stay silent. On the box:

1. Install it: `sudo apt install coturn`, then in /etc/default/coturn make sure the line `TURNSERVER_ENABLED=1` is there.
2. Make the shared secret yourself: `openssl rand -hex 32`. It prints a long random value. Nobody else needs to see it.
3. Copy server/deploy/turnserver.conf to /etc/turnserver.conf and fill in its two blanks: `static-auth-secret=` the value from step 2, and `external-ip=20.74.255.57/` followed by the box's private address (`hostname -I` shows it, it starts with 10.).
4. In /opt/karaki/server/.env set `TURN_SECRET=` to the very same value. The STUN and TURN addresses in .env.example already point at karaki.besmart-me.com.
5. Open the ports in Azure (the box's network security group) and in the box's firewall: 3478 UDP and TCP, and UDP 49160 to 49200. For the firewall: `sudo ufw allow 3478` and `sudo ufw allow 49160:49200/udp`.
6. `sudo mkdir -p /var/log/turnserver && sudo chown turnserver /var/log/turnserver`, then `sudo systemctl restart coturn` and `sudo systemctl restart karaki`.

Nothing new is needed on developer.apple.com for calls: the same push key (AuthKey_CB........p8) also sends the ringing pushes (VoIP pushes), and the Push Notifications tick on com.besmart.karaki covers them.

### 6. Backups

Everything the family sends lives in /var/lib/karaki on the box (the database file and a media folder). Copying that folder somewhere safe is the whole backup.
