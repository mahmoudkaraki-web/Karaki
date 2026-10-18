// Starts the family server. In production it listens on 127.0.0.1 only; Caddy in front of it
// holds the HTTPS certificate for the family subdomain and passes requests (and /ws) through.
import { loadConfig } from './config.js';
import { createFamilyServer } from './server.js';

const config = loadConfig();
const s = createFamilyServer(config);
const addr = await s.listen();
console.log(`[family] listening on ${addr.address}:${addr.port}, data in ${config.dataDir}${config.production ? ' (production)' : ''}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[family] ${sig}: closing`);
    await s.close();
    process.exit(0);
  });
}
