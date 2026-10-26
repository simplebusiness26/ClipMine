import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const config = readFileSync("wrangler.toml", "utf8");
export function validateConfig(
  config,
  { production = false, account, expected, database, url } = {},
) {
  const required = [
    /^name = "niches"$/m,
    /database_name = "niches"/,
    /bucket_name = "niches-media"/,
  ];
  if (required.some((pattern) => !pattern.test(config)))
    throw new Error("Only the niches Worker, database and bucket are allowed.");
  if (
    /agentcart|aiseo|2d15e48a-cd08-4910-9710-fcf4dac74e0d|\[\[routes\]\]|\[containers\]|\[\[queues\./i.test(
      config,
    )
  )
    throw new Error(
      "Cross-project routes/resources or unapproved paid infrastructure are forbidden.",
    );
  if (
    (config.match(/\[\[d1_databases\]\]/g) || []).length !== 1 ||
    (config.match(/\[\[r2_buckets\]\]/g) || []).length !== 1 ||
    (config.match(/^database_name\s*=/gm) || []).length !== 1 ||
    (config.match(/^bucket_name\s*=/gm) || []).length !== 1
  )
    throw new Error(
      "Exactly one Niches database and one Niches bucket are allowed.",
    );
  if (production) {
    if (!/^[a-f0-9]{32}$/i.test(expected || "") || account !== expected)
      throw new Error(
        "Niches account must match the independently confirmed AISO account ID. Configure Niches credentials; never retrieve AISO secrets.",
      );
    if (
      !/^[a-f0-9-]{36}$/i.test(database || "") ||
      database === "00000000-0000-0000-0000-000000000000" ||
      database === "2d15e48a-cd08-4910-9710-fcf4dac74e0d"
    )
      throw new Error("A distinct Niches D1 database ID is required.");
    const configuredId = config.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
    if (
      ![database, "00000000-0000-0000-0000-000000000000"].includes(configuredId)
    )
      throw new Error(
        "Configured database does not match the pinned Niches database.",
      );
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      !target.hostname.startsWith("niches.") ||
      !target.hostname.endsWith(".workers.dev") ||
      target.pathname !== "/" ||
      target.search ||
      target.hash
    )
      throw new Error(
        "Only a dedicated niches.<account>.workers.dev origin is allowed until domain review.",
      );
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve("ops/niches-bridge/check-config.mjs")
) {
  const production = process.argv.includes("--production");
  validateConfig(config, {
    production,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    expected: process.env.NICHES_EXPECTED_ACCOUNT_ID,
    database: process.env.NICHES_D1_DATABASE_ID,
    url: process.env.NICHES_URL,
  });
  if (production && process.argv.includes("--materialize"))
    writeFileSync(
      "wrangler.production.toml",
      config.replace(
        "00000000-0000-0000-0000-000000000000",
        process.env.NICHES_D1_DATABASE_ID,
      ) +
        `\n# Account identity validated by the Niches-only deployment guard.\n`,
    );
  console.log(
    `PASS: Niches ${production ? "production identity" : "static isolation"} guard`,
  );
}
