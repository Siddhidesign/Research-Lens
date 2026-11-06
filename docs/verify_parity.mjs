/**
 * Parity check: docs/tools.js vs the real MCP server in src/index.ts.
 *
 * The browser demo reimplements the five tools in plain JS. That creates a drift
 * risk: the page could start saying something the server does not. This script
 * spawns the built server over stdio, calls every tool with the same arguments
 * as docs/tools.js, and asserts the responses are byte-identical.
 *
 * Run: npm run build && node docs/verify_parity.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "./tools.mjs";
import { REPO } from "./sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "build", "index.js");

const CASES = [
  ["search_transcripts", { query: "rent" }],
  ["search_transcripts", { query: "trust" }],
  ["search_transcripts", { query: "nothing matches this" }],
  ["quotes_by_theme", { theme: "trust" }],
  ["quotes_by_theme", { theme: "trust", round: 2 }],
  ["quotes_by_theme", { theme: "onboarding" }],
  ["quotes_by_theme", { theme: "not-a-theme" }],
  ["pattern_frequency", {}],
  ["compare_rounds", { theme: "trust" }],
  ["compare_rounds", { theme: "control" }],
  ["draft_findings", { theme: "control" }],
  ["draft_findings", { theme: "explainability" }],
  ["draft_findings", { theme: "not-a-theme" }],
];

const proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();

proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => reject(new Error(`timeout on ${method}`)), 10000);
  });
}

await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "parity-check", version: "1.0.0" },
});
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

let pass = 0;
const failures = [];

for (const [name, args] of CASES) {
  const res = await send("tools/call", { name, arguments: args });
  const fromServer = res?.result?.content?.[0]?.text;
  const fromBrowser = TOOLS[name](REPO, args);
  const label = `${name}(${JSON.stringify(args)})`;
  if (fromServer === fromBrowser) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    failures.push({ label, fromServer, fromBrowser });
    console.log(`  FAIL  ${label}`);
  }
}

proc.kill();

console.log(`\n${pass}/${CASES.length} identical`);

if (failures.length) {
  for (const f of failures) {
    console.log(`\n--- ${f.label}\nSERVER:\n${f.fromServer}\n\nBROWSER:\n${f.fromBrowser}`);
  }
  process.exit(1);
}
console.log("Browser demo matches the MCP server exactly.");
