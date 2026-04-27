/**
 * Downloads node.exe and installs Pi CLI (with deps) into src-tauri/resources/
 * Run once before building: node scripts/setup-resources.mjs
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES = join(ROOT, "src-tauri", "resources");
const NODE_VERSION = "v20.19.0";
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;
const NODE_DEST = join(RESOURCES, "node.exe");
const PI_CLI_DEST = join(RESOURCES, "pi-cli");
const PI_CLI_ENTRY = join(PI_CLI_DEST, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js");

// Check what version is installed locally
let PI_VERSION = "latest";
try {
  const pkgPath = join(ROOT, "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(await import("fs").then(fs => fs.promises.readFile(pkgPath, "utf8")));
    PI_VERSION = pkg.version;
  }
} catch {}

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

// Install Pi CLI with all dependencies
if (existsSync(PI_CLI_ENTRY)) {
  console.log("pi-cli already installed, skipping.");
} else {
  console.log(`Installing @mariozechner/pi-coding-agent@${PI_VERSION} with dependencies...`);
  mkdirSync(PI_CLI_DEST, { recursive: true });
  writeFileSync(join(PI_CLI_DEST, "package.json"), JSON.stringify({
    name: "pi-cli-bundle",
    version: "1.0.0",
    private: true,
  }, null, 2));
  execSync(`npm install @mariozechner/pi-coding-agent@${PI_VERSION} --omit=dev`, {
    cwd: PI_CLI_DEST,
    stdio: "inherit",
  });
  console.log("Pi CLI installed.");
}

console.log("Resources ready. You can now run: cargo tauri build");
