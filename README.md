# Karaki

The Karaki family's private app: messages now, calls next. The plan is in docs/plan.md.

* server/: Node 22 or newer. `npm test` runs the local tests; `npm start` runs it (settings in server/.env, see server/.env.example).
* app/: the iPhone app, Expo SDK 57. `npm run check` type checks and bundles it; app/ios-build.ps1 builds it in Expo's cloud and sends it to TestFlight.
* Packages: install with scripts/npm-install.ps1 (server or app), never `npm ci` and never plain `npm install` in the repo: node_modules are junctions into C:\dev\nm\Karaki APP\family-app so OneDrive does not sync them.
* No keys in this repo. The push key lives in Karaki APP\Push Key; the App Store Connect key stays in s2-guest-app\Keys.
