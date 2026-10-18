// Makes an invite code from the server's own shell (no app needed). This is how the very first
// member (MAK) gets in: an admin invite made here, typed into the app once.
//
//   node --env-file=.env scripts/invite.js --name MAK --admin
//   node --env-file=.env scripts/invite.js --name Sara
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { makeFamily } from '../src/family.js';

const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const config = loadConfig();
const db = openDb(config.dataDir);
const noHub = { sendToMember() {}, broadcast() {}, isOnline: () => false, closeDevice() {}, closeMember() {} };
const family = makeFamily({ db, config, hub: noHub });
const inv = family.createInvite(null, { nameHint: opt('--name'), isAdmin: args.includes('--admin') });
db.close();
console.log(`Invite code: ${inv.code}${args.includes('--admin') ? ' (admin)' : ''}`);
console.log(`Link: ${inv.link}`);
console.log(`Good until: ${new Date(inv.expiresAt).toUTCString()}`);
