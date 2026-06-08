const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const contractOutput = join(__dirname, "..", "dist", "contracts", "escrow");
mkdirSync(contractOutput, { recursive: true });
writeFileSync(join(contractOutput, "package.json"), JSON.stringify({ type: "commonjs" }));
