// Copies secrets from the build environment (Cloudflare → Settings → Build →
// Variables and secrets) onto the live Worker. Runs after each deploy.
// Never prints secret values.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NAMES = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'YOUTUBE_API_KEY',
];

const secrets = {};
for (const name of NAMES) {
  const value = process.env[name]?.trim();
  if (value) secrets[name] = value;
}

const found = Object.keys(secrets);
console.log(`Secrets found in build settings: ${found.length ? found.join(', ') : 'none'}`);
if (!found.length) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
const file = join(dir, 'secrets.json');
try {
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  const result = spawnSync('npx', ['wrangler', 'secret', 'bulk', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('Uploading secrets failed');
    process.exit(result.status ?? 1);
  }
  console.log('Secrets attached to the live Worker');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
