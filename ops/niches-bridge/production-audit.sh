#!/usr/bin/env bash
# Read-only: no migration, publishing, resource creation or deletion commands.
set -euo pipefail
node ops/niches-bridge/check-config.mjs --production --materialize
npx wrangler whoami >/dev/null
npx wrangler d1 execute niches --config wrangler.production.toml --remote --command 'SELECT name FROM d1_migrations ORDER BY id;' --json > /tmp/niches-migrations.json
node --input-type=module <<'JS'
import fs from 'node:fs';
const report=JSON.parse(fs.readFileSync('/tmp/niches-migrations.json','utf8'));
if(!report[0]?.results?.some(row=>row.name==='0001_niches.sql'))throw new Error('Niches schema migration is missing');
JS
npx wrangler d1 execute niches --config wrangler.production.toml --remote --command 'SELECT COUNT(*) AS users FROM users;' --json >/dev/null
# List object metadata only, without reading private media.
npx wrangler r2 bucket info niches-media --json >/dev/null
curl --fail --silent --show-error --max-time 20 "$NICHES_URL/api/health" > /tmp/niches-health.json
node --input-type=module <<'JS'
import fs from 'node:fs';
const health=JSON.parse(fs.readFileSync('/tmp/niches-health.json','utf8'));
if(health.service!=='niches'||!health.database||!health.storage)throw new Error('Unexpected or unhealthy application');
if(process.env.NICHES_EXPECTED_BUILD&&health.build!==process.env.NICHES_EXPECTED_BUILD)throw new Error('Wrong deployed commit');
console.log(`PASS: Niches health build ${health.build}; database/storage bindings present`);
console.log('NOTE: R2 bucket metadata access is verified; private media write/read requires a separate authorised journey.');
JS
printf 'PASS: read-only Niches deployment audit\n'
