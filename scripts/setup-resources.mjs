/**
 * Downloads node.exe and copies the Pi CLI into src-tauri/resources/
 * Run once before building: node scripts/setup-resources.mjs
 */
import { createWriteStream, existsSync, mkdirSync, cpSync } from "fs";
import { pipeline } from "stream/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES = join(ROOT, "src-tauri", "resources");
const NODE_VERSION = "v20.19.0";
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;
const NODE_DEST = join(RESOURCES, "node.exe");
const PI_CLI_SRC = join(ROOT, "node_modules", "@mariozechner", "pi-coding-agent", "dist");
const PI_CLI_DEST = join(RESOURCES, "pi-cli");

mkdirSync(RESOURCES, { recursive: true });

// Download node.exe
if (existsSync(NODE_DEST)) {
  console.log("node.exe already exists, skipping download.");
} else {
  console.log(`Downloading Node.js ${NODE_VERSION}...`);
  const res = await fetch(NODE_URL);
  if (!res.ok) throw new Error(`Failed to download node.exe: ${res.statusText}`);
  await pipeline(res.body, createWriteStream(NODE_DEST));
  console.log("node.exe downloaded.");
}

// Copy Pi CLI
if (existsSync(PI_CLI_DEST)) {
  console.log("pi-cli already exists, skipping copy.");
} else if (existsSync(PI_CLI_SRC)) {
  console.log("Copying Pi CLI...");
  cpSync(PI_CLI_SRC, PI_CLI_DEST, { recursive: true });
  console.log("Pi CLI copied.");
} else {
  console.error("Pi CLI not found. Run: npm install @mariozechner/pi-coding-agent");
  process.exit(1);
}

console.log("Resources ready. You can now run: cargo tauri build");
