import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateConfig } from "./check-config.mjs";
const config = readFileSync("wrangler.toml", "utf8");
const safe = {
  production: true,
  account: "a".repeat(32),
  expected: "a".repeat(32),
  database: "12345678-1234-1234-1234-123456789abc",
  url: "https://niches.example.workers.dev",
};
test("deployment accepts only pinned Niches identities", () => {
  validateConfig(config);
  validateConfig(config, safe);
  for (const bad of [
    { account: "b".repeat(32) },
    { database: "2d15e48a-cd08-4910-9710-fcf4dac74e0d" },
    { url: "https://agentcart.ai-seo.workers.dev" },
    { url: "https://niches.example.workers.dev/other" },
  ])
    assert.throws(() => validateConfig(config, { ...safe, ...bad }));
  assert.throws(() =>
    validateConfig(
      config.replace('name = "niches"', 'name = "agentcart"'),
      safe,
    ),
  );
});

test("deployment rejects additional bindings or an unpinned configured database", () => {
  assert.throws(() =>
    validateConfig(
      config + '\n[[d1_databases]]\ndatabase_name = "other"\n',
      safe,
    ),
  );
  assert.throws(() =>
    validateConfig(
      config.replace(
        "00000000-0000-0000-0000-000000000000",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
      safe,
    ),
  );
});
