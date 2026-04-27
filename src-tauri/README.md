# pi Desktop

Desktop application wrapper for the `pi` coding agent CLI (`@mariozechner/pi-coding-agent`).

## Overview

This Tauri/Rust application provides a desktop interface for the `pi` Node.js CLI tool. It spawns the `pi` process as a child and communicates via line-delimited JSON over stdin/stdout.

## Architecture

- **Backend**: Rust with Tauri 2
- **Frontend**: Vite + React (expected in parent directory)
- **IPC**: JSON messages over stdin/stdout to the `pi` child process

## Tauri Commands

| Command | Description |
|---------|-------------|
| `spawn_pi` | Start the pi child process |
| `kill_pi` | Terminate the pi process |
| `pi_send_message(msg)` | Send a JSON message to pi, return response |
| `await_initialization` | Wait for pi to be ready |

## Building

```bash
cd ..
bun install
bun run tauri build
```

## Configuration

The `pi` CLI is located at `node_modules/@mariozechner/pi-coding-agent/dist/cli.js` or via PATH.

On Windows, `NO_PROXY` is set to include loopback addresses.