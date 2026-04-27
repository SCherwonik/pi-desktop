# pi-desktop Build Errors - Debug Log

## Environment
- Windows 11 Pro, x86_64
- Rust 1.95.0 (stable-x86_64-pc-windows-msvc)
- Tauri v2 (tauri 2.10.3)
- Project: C:\Users\Administrator\pi-desktop\src-tauri

## Current Status: UNRESOLVED — needs fresh eyes

## The Two Errors

### Error 1: OUT_DIR env var not set
```
error: OUT_DIR env var is not set, do you have a build script?
   --> src\lib.rs:284:14
284 |         .run(tauri::generate_context!())
    |              ^^^^^^^^^^^^^^^^^^^^^^^^^^
note: this error originates in the macro `tauri::generate_context`
```

### Error 2: Duplicate command symbol definitions (E0255)
```
error[E0255]: the name `__cmd__spawn_pi` is defined multiple times
  --> src\lib.rs:57:14
   |
56 | #[tauri::command]
   | ----------------- previous definition of the macro `__cmd__spawn_pi` here
57 | pub async fn spawn_pi(app: AppHandle, state: State<'_, PiStateHandle>) -> Result<SessionInfo, String> {
   |              ^^^^^^^^ `__cmd__spawn_pi` reimported here
```

Same pattern for: `__cmd__kill_pi`, `__cmd__pi_send_message`, `__cmd__await_initialization`

## All Fixes Attempted

### 1. Removed `crate-type` from [lib] section
**Before:**
```toml
[lib]
name = "pi_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```
**After:**
```toml
[lib]
name = "pi_desktop_lib"
```
**Result:** Errors persist.

### 2. Changed edition from "2024" to "2021"
**Before:** `edition = "2024"` (Rust 2024 is not yet stable)
**After:** `edition = "2021"`
**Result:** Errors persist. (This was the likely cause of the original errors before the first clean attempt.)

### 3. Added `Emitter` to tauri imports
**Before:** `use tauri::{AppHandle, Manager, State};`
**After:** `use tauri::{AppHandle, Emitter, Manager, State};`
**Result:** Fixed the original `emit` method not found error (E0599). This is now correct.

### 4. Wrapped `std::env::set_var` in unsafe blocks
**Before:**
```rust
#[cfg(windows)]
{
    std::env::set_var("NO_PROXY", "127.0.0.1,localhost,::1");
    std::env::set_var("no_proxy", "127.0.0.1,localhost,::1");
}
```
**After:**
```rust
#[cfg(windows)]
unsafe {
    std::env::set_var("NO_PROXY", "127.0.0.1,localhost,::1");
    std::env::set_var("no_proxy", "127.0.0.1,localhost,::1");
}
```
**Result:** Fixed unsafe block errors. This is now correct.

### 5. Full target/ clean + cargo clean
Deleted `target/` directory completely, ran `cargo clean`.
**Result:** Errors persist on fresh build.

### 6. Multiple incremental builds
Ran `cargo build` twice in a row. First build: only OUT_DIR error. Second build: only E0255 errors.
**Observation:** The OUT_DIR error appears first on fresh builds, then E0255 errors appear on subsequent incremental builds. This suggests the build script is failing on the first pass, then on second pass something is partially compiled.

## Current File State

### Cargo.toml
```toml
[package]
name = "pi-desktop"
version = "0.1.0"
description = "Desktop app for pi coding agent"
authors = ["SCherwonik"]
edition = "2021"

[lib]
name = "pi_desktop_lib"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-deep-link = "2"
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-store = "2"
tauri-plugin-window-state = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-http = "2"
tauri-plugin-notification = "2"
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["process", "io-util"] }
listeners = "0.3"
futures = "0.3"
tauri-plugin-os = "2"
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
uuid = { version = "1", features = ["v4"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
chrono = "0.4"
process-wrap = "9.0"
```

### src/lib.rs imports (line 1-8)
```rust
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::{error, info, warn};
```

### src/build.rs
```rust
fn main() {
    tauri_build::build()
}
```

### src/main.rs
```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pi_desktop_lib::run()
}
```

## Key Observations

1. **OUT_DIR error always appears first on fresh builds** → build script may not be running properly
2. **E0255 always appears second** → likely a cascading failure from the build script not completing
3. **`tauri::generate_context!()` needs OUT_DIR** → it reads generated files from OUT_DIR
4. **No workspace Cargo.toml exists** → single package, no workspace confusion
5. **`cargo expand` not installed** → couldn't use it to debug macro expansion

## Theories

### Theory 1: build.rs not running correctly
The `tauri_build::build()` should set up OUT_DIR before lib.rs is compiled. If it's not running, OUT_DIR stays unset.

**Test needed:** Add `println!("BUILD_SCRIPT_RUNNING")` to build.rs and check if it appears in output.

### Theory 2: The commands are being defined twice
The `#[tauri::command]` attribute generates a macro `__cmd__spawn_pi`. If the attribute is somehow being applied twice (maybe through macro expansion), it would create duplicate definitions.

**Test needed:** Look at what `tauri::generate_handler![]` expands to.

### Theory 3: The lib is compiled twice in a single cargo invocation
Maybe `cargo build` is building both `lib.rs` AND `main.rs` and somehow importing the lib symbols twice.

## Commands to try

```bash
# Test if build.rs runs
export PATH="/c/Users/Administrator/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH"
cd /c/Users/Administrator/pi-desktop/src-tauri
cargo clean
RUST_LOG=debug cargo build 2>&1 | grep -i "build.rs\|OUT_DIR\|tauri_build"

# Or add tracing to build.rs:
# build.rs:
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:warning=BUILD_SCRIPT_EXECUTED");
    tauri_build::build()
}
```

## Questions for the next model

1. Is `tauri::generate_context!()` in lib.rs the correct location, or should it be in main.rs?
2. Is there a way to check if `tauri_build::build()` is actually running?
3. Why does the first `cargo build` after a clean show OUT_DIR error, but subsequent builds show E0255?
4. Could `tauri v2` + `rust 1.95.0` have a compatibility issue with the `edition = "2021"` setup?
5. Is the `[lib]` section even needed in Cargo.toml for a Tauri v2 app where main.rs calls `pi_desktop_lib::run()`?