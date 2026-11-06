import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["build/index.js"] });
const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map(t => t.name).join(", "));

for (const [name, args] of [
  ["pattern_frequency", {}],
  ["compare_rounds", { theme: "trust" }],
  ["search_transcripts", { query: "confidence" }],
]) {
  const r = await client.callTool({ name, arguments: args });
  console.log("\n===== " + name + " =====");
  console.log(r.content[0].text);
}
await client.close();
