import {
  createSignal,
  createMemo,
  createEffect,
  batch,
  For,
  Show,
  onMount,
  onCleanup,
  type Component,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Markdown from "./Markdown";
import DiffViewer from "./DiffViewer";
import {
  LayoutPanelLeft,
  GitBranch,
  GitCompare,
  FolderTree,
  Terminal as TerminalIcon,
  Sun,
  Moon,
  Settings,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Cpu,
  Atom,
  Aperture,
  CircuitBoard,
  BrainCircuit,
  Keyboard,
  Monitor,
} from "./icons";

// ============================================================================
// Types
// ============================================================================

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileEntry[];
}

interface GitFileStatus {
  path: string;
  status: string;
}

interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface ToolCall {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, any>;
  toolResult?: string;
  toolIsError?: boolean;
  toolDone: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "compaction";
  content: string;
  thinking?: string;
  usage?: TokenUsage;
  reasoningTokenEst?: number;
  cumulativeUsage?: TokenUsage;
  tools?: ToolCall[];
  timestamp: Date;
}

interface Session {
  id: string;        // file path (or generated id for current session)
  title: string;
  timestamp: Date;
  isCurrent?: boolean;
}

interface PiModel {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
}

interface SlashCommand {
  name: string;
  description: string;
  source: "builtin" | "extension" | "prompt" | "skill";
}

interface PiEvent {
  type: string;
  [key: string]: any;
}

// ============================================================================
// Slash command registry
// ============================================================================

const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: "settings",      description: "Open settings menu",                          source: "builtin" },
  { name: "model",         description: "Select model",                                source: "builtin" },
  { name: "scoped-models", description: "Enable/disable models for cycling",           source: "builtin" },
  { name: "export",        description: "Export session (.html or .jsonl)",            source: "builtin" },
  { name: "import",        description: "Import and resume a session from JSONL file", source: "builtin" },
  { name: "share",         description: "Share session as a secret GitHub gist",       source: "builtin" },
  { name: "copy",          description: "Copy last assistant message to clipboard",    source: "builtin" },
  { name: "name",          description: "Set session display name",                    source: "builtin" },
  { name: "session",       description: "Show session info and stats",                 source: "builtin" },
  { name: "changelog",     description: "Show changelog entries",                      source: "builtin" },
  { name: "hotkeys",       description: "Show all keyboard shortcuts",                 source: "builtin" },
  { name: "fork",          description: "Create a new fork from a previous message",   source: "builtin" },
  { name: "tree",          description: "Navigate session tree",                       source: "builtin" },
  { name: "login",         description: "Login with OAuth provider",                   source: "builtin" },
  { name: "logout",        description: "Logout from OAuth provider",                  source: "builtin" },
  { name: "new",           description: "Start a new session",                         source: "builtin" },
  { name: "compact",       description: "Compact the session context",                 source: "builtin" },
  { name: "resume",        description: "Resume a different session",                  source: "builtin" },
  { name: "reload",        description: "Reload keybindings, extensions, skills",      source: "builtin" },
  { name: "quit",          description: "Quit pi",                                     source: "builtin" },
];

// ============================================================================
// Theme
// ============================================================================

type Theme = "light" | "dark";
const [theme, setTheme] = createSignal<Theme>("dark");
const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

type Verbosity = "normal" | "thinking" | "verbose";
const [verbosity, setVerbosity] = createSignal<Verbosity>("thinking");
const cycleVerbosity = () =>
  setVerbosity((v) => v === "normal" ? "thinking" : v === "thinking" ? "verbose" : "normal");
const verbosityLabel = () =>
  verbosity() === "normal" ? "💬" : verbosity() === "thinking" ? "💭" : "🔍";

type Effort = "low" | "medium" | "high";
const [effort, setEffort] = createSignal<Effort>("medium");

// Panel open state (module-level so Titlebar can access directly)
const [fileTreeOpen, setFileTreeOpen] = createSignal(false);
const [gitOpen, setGitOpen] = createSignal(false);
const [terminalOpen, setTerminalOpen] = createSignal(false);
const [settingsOpen, setSettingsOpen] = createSignal(false);
const [panelDropdownOpen, setPanelDropdownOpen] = createSignal(false);
const [modelPickerForceOpen, setModelPickerForceOpen] = createSignal(false);
const [serverDropdownOpen, setServerDropdownOpen] = createSignal(false);
const [sidebarOpen, setSidebarOpen] = createSignal(false);

// In-app confirm dialog (window.confirm broken in Tauri WebView2)
type ConfirmState = { message: string; resolve: (v: boolean) => void } | null;
const [confirmState, setConfirmState] = createSignal<ConfirmState>(null);
const showConfirm = (message: string): Promise<boolean> =>
  new Promise(resolve => setConfirmState({ message, resolve }));
const confirmResolve = (v: boolean) => {
  confirmState()?.resolve(v);
  setConfirmState(null);
};

// ============================================================================
// Context window helpers
// ============================================================================

const CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  [/gemini-1\.5-pro/, 2_097_152],
  [/gemini-2\.5-pro|gemini-2\.0-flash|gemini-1\.5-flash/, 1_048_576],
  [/claude-opus-4|claude-sonnet-4|claude-3-7|claude-3-5|claude-3-opus|claude-3-haiku/, 200_000],
  [/o1|o3|gpt-4-turbo|gpt-4o/, 128_000],
  [/gpt-4(?![-o])/, 8_192],
  [/deepseek/, 65_536],
];

const getContextWindow = (model: PiModel | null): number | null => {
  if (!model) return null;
  // Pi provides actual context window — use it if available
  if (model.contextWindow && model.contextWindow > 0) return model.contextWindow;
  // Fallback: lookup by model ID pattern
  const id = (model.id ?? "").toLowerCase();
  for (const [re, size] of CONTEXT_WINDOWS) {
    if (re.test(id)) return size;
  }
  return null;
};

const formatTokenCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

// ============================================================================
// Helpers
// ============================================================================

const generateId = () => Math.random().toString(36).substring(2, 11);

// ============================================================================
// Model Picker Component
// ============================================================================

interface ModelPickerProps {
  currentModel: PiModel | null;
  availableModels: PiModel[];
  forceOpen: boolean;
  onClose: () => void;
  onSelectModel: (model: PiModel) => void;
  onOpen: () => void;
}

const ModelPicker: Component<ModelPickerProps> = (props) => {
  const [localOpen, setLocalOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [activeIdx, setActiveIdx] = createSignal(0);
  let searchRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const open = () => localOpen() || props.forceOpen;

  const displayName = () => {
    const m = props.currentModel;
    if (!m) return "Model";
    return m.name || `${m.provider}/${m.id}`;
  };

  const filteredModels = () => {
    const q = search().toLowerCase();
    if (!q) return props.availableModels;
    return props.availableModels.filter(m =>
      (m.name || `${m.provider}/${m.id}`).toLowerCase().includes(q)
    );
  };

  createEffect(() => { search(); setActiveIdx(0); });

  // Focus search input whenever dropdown opens (covers both localOpen and forceOpen)
  createEffect(() => {
    if (open()) {
      requestAnimationFrame(() => requestAnimationFrame(() => searchRef?.focus()));
    }
  });

  // Scroll focused item into view on arrow key nav
  createEffect(() => {
    const idx = activeIdx();
    requestAnimationFrame(() => {
      const el = listRef?.querySelectorAll<HTMLElement>(".model-option")[idx];
      el?.scrollIntoView({ block: "nearest" });
    });
  });

  // Redirect any printable keystrokes to search while open
  createEffect(() => {
    if (!open()) return;
    const handler = (e: KeyboardEvent) => {
      if (!searchRef) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
        handleKeyDown(e);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        searchRef.focus();
      }
    };
    document.addEventListener("keydown", handler);
    onCleanup(() => document.removeEventListener("keydown", handler));
  });

  const close = () => {
    setLocalOpen(false);
    setSearch("");
    setActiveIdx(0);
    props.onClose();
  };

  const toggle = () => {
    if (!open()) {
      props.onOpen();
      setLocalOpen(true);
    } else {
      close();
    }
  };

  const select = (model: PiModel) => {
    props.onSelectModel(model);
    close();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const models = filteredModels();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, models.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = models[activeIdx()];
      if (m) select(m);
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <div class="model-picker">
      <button class="model-btn" onClick={toggle} title="Switch model">
        <span class="model-icon"><Atom size={14}/></span>
        <span class="model-label">{displayName()}</span>
        <span class="model-caret">{open() ? "▲" : "▼"}</span>
      </button>
      <Show when={open()}>
        <div class="model-drop-backdrop" onClick={close} />
        <div class="model-dropdown">
          <div class="model-search-wrap">
            <input
              ref={searchRef}
              class="model-search"
              type="text"
              placeholder="Search models…"
              value={search()}
              onInput={e => setSearch(e.currentTarget.value)}
            />
          </div>
          <div class="model-list" ref={listRef}>
            <Show when={props.availableModels.length === 0}>
              <div class="model-loading">Loading models…</div>
            </Show>
            <For each={filteredModels()}>
              {(model, idx) => {
                const label = model.name || `${model.provider}/${model.id}`;
                const active =
                  props.currentModel?.provider === model.provider &&
                  props.currentModel?.id === model.id;
                return (
                  <button
                    class={`model-option${active ? " active" : ""}${activeIdx() === idx() ? " focused" : ""}`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => select(model)}
                    onMouseEnter={() => setActiveIdx(idx())}
                  >
                    {label}
                  </button>
                );
              }}
            </For>
            <Show when={filteredModels().length === 0 && props.availableModels.length > 0}>
              <div class="model-loading">No matches</div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Titlebar Component
// ============================================================================

interface TitlebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  currentModel: PiModel | null;
  availableModels: PiModel[];
  onSelectModel: (model: PiModel) => void;
  onOpenModelPicker: () => void;
  cwd: string;
  homePath: string;
  piConnected: boolean;
}

const Titlebar: Component<TitlebarProps> = (props) => {
  let panelPickerRef: HTMLDivElement | undefined;

  const sessionName = createMemo(() => {
    if (!props.activeSessionId) return "New Session";
    const s = props.sessions.find((s) => s.id === props.activeSessionId);
    return s?.title || "New Session";
  });

  const modelLabel = createMemo(() => {
    const m = props.currentModel;
    if (!m) return "No model";
    return m.name || `${m.provider}/${m.id}`;
  });

  const handleOutsideClick = (e: MouseEvent) => {
    if (panelPickerRef && !panelPickerRef.contains(e.target as Node)) {
      setPanelDropdownOpen(false);
    }
  };

  createEffect(() => {
    if (panelDropdownOpen()) {
      document.addEventListener("mousedown", handleOutsideClick);
    } else {
      document.removeEventListener("mousedown", handleOutsideClick);
    }
  });

  onCleanup(() => document.removeEventListener("mousedown", handleOutsideClick));

  const openModel = () => {
    setPanelDropdownOpen(false);
    props.onOpenModelPicker();
    setModelPickerForceOpen(true);
  };

  return (
    <div class="titlebar" data-tauri-drag-region>
      <div class="titlebar-left">
        <button
          class={`icon-btn sidebar-toggle-btn${sidebarOpen() ? "" : " sidebar-closed"}`}
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen() ? "Collapse sidebar" : "Expand sidebar"}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen() ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
        <div class="titlebar-cwd" title={props.cwd || props.homePath}>
          {(() => {
            const p = (props.cwd || props.homePath).replace(/\\/g, "/");
            const parts = p.split("/").filter(Boolean);
            if (parts.length <= 2) return p;
            return "…/" + parts.slice(-2).join("/");
          })()}
        </div>
      </div>
      <div class="titlebar-center">
        <Show when={sessionName() !== "New Session"}>
          <span class="titlebar-session-name">{sessionName()}</span>
        </Show>
      </div>
      <div class="titlebar-right">
        {/* Hidden anchor for model picker dropdown positioning */}
        <div class="model-picker-anchor">
          <ModelPicker
            currentModel={props.currentModel}
            availableModels={props.availableModels}
            forceOpen={modelPickerForceOpen()}
            onClose={() => setModelPickerForceOpen(false)}
            onSelectModel={props.onSelectModel}
            onOpen={props.onOpenModelPicker}
          />
        </div>

        {/* Server status */}
        <div class="server-status-wrap">
          <button
            class={`icon-btn server-status-btn${serverDropdownOpen() ? " active" : ""}`}
            title="Server status"
            onClick={() => setServerDropdownOpen(v => !v)}
          >
            <Monitor size={15} />
            <span class={`server-dot${props.piConnected ? " connected" : ""}`} />
          </button>
          <Show when={serverDropdownOpen()}>
            <div class="server-drop-backdrop" onClick={() => setServerDropdownOpen(false)} />
            <div class="server-dropdown">
              <div class="server-drop-tabs">
                <span class="server-drop-tab active">1 Servers</span>
              </div>
              <div class="server-drop-body">
                <div class="server-entry">
                  <span class={`server-dot${props.piConnected ? " connected" : ""}`} />
                  <span class="server-entry-name">Local Server</span>
                  <Show when={props.piConnected}>
                    <span class="server-entry-check">✓</span>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>

        {/* Panel picker — single button with dropdown */}
        <div class="panel-picker" ref={panelPickerRef}>
          <button
            class={`icon-btn panel-picker-btn${panelDropdownOpen() ? " active" : ""}`}
            onClick={() => setPanelDropdownOpen(v => !v)}
            title="Panels"
            aria-label="Open panels menu"
          >
            <LayoutPanelLeft size={15} />
          </button>
          <Show when={panelDropdownOpen()}>
            <div class="panel-dropdown">
              {/* Model */}
              <button class="panel-dropdown-item" onClick={openModel}>
                <span class="panel-dropdown-icon"><Atom size={14}/></span>
                <span class="panel-dropdown-label">Model</span>
                <span class="panel-dropdown-meta">{modelLabel()}</span>
              </button>
              <div class="panel-dropdown-sep" />
              {/* Terminal */}
              <button
                class={`panel-dropdown-item${terminalOpen() ? " panel-item-active" : ""}`}
                onClick={() => { setTerminalOpen(v => !v); setPanelDropdownOpen(false); }}
              >
                <span class="panel-dropdown-icon"><TerminalIcon size={14} /></span>
                <span class="panel-dropdown-label">Terminal</span>
                <Show when={terminalOpen()}><span class="panel-dropdown-check">✓</span></Show>
              </button>
              {/* Git */}
              <button
                class={`panel-dropdown-item${gitOpen() ? " panel-item-active" : ""}`}
                onClick={() => { setGitOpen(v => !v); setPanelDropdownOpen(false); }}
              >
                <span class="panel-dropdown-icon"><GitBranch size={14} /></span>
                <span class="panel-dropdown-label">Git Changes</span>
                <Show when={gitOpen()}><span class="panel-dropdown-check">✓</span></Show>
              </button>
              {/* File Tree */}
              <button
                class={`panel-dropdown-item${fileTreeOpen() ? " panel-item-active" : ""}`}
                onClick={() => { setFileTreeOpen(v => !v); setPanelDropdownOpen(false); }}
              >
                <span class="panel-dropdown-icon"><FolderTree size={14} /></span>
                <span class="panel-dropdown-label">File Tree</span>
                <Show when={fileTreeOpen()}><span class="panel-dropdown-check">✓</span></Show>
              </button>
              <div class="panel-dropdown-sep" />
              {/* Theme */}
              <button
                class="panel-dropdown-item"
                onClick={() => { toggleTheme(); setPanelDropdownOpen(false); }}
              >
                <span class="panel-dropdown-icon">
                  {theme() === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                </span>
                <span class="panel-dropdown-label">Toggle Theme</span>
                <span class="panel-dropdown-meta">{theme() === "dark" ? "Dark" : "Light"}</span>
              </button>
            </div>
          </Show>
        </div>

        <button
          class={`icon-btn${settingsOpen() ? " active" : ""}`}
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(v => !v)}
        ><Settings size={15} /></button>
      </div>
    </div>
  );
};

// ============================================================================
// Status Bar Component
// ============================================================================

interface StatusBarProps {
  currentModel: PiModel | null;
  sessionUsage: TokenUsage;
  ctxTokens: number;
  onCompact: () => void;
}

const StatusBar: Component<StatusBarProps> = (props) => {
  const [verbDropOpen, setVerbDropOpen] = createSignal(false);
  const [effortDropOpen, setEffortDropOpen] = createSignal(false);

  const shortModelLabel = () => {
    const m = props.currentModel;
    if (!m) return "No model";
    const raw = m.name || m.id || m.provider;
    return raw
      .replace(/^claude-/i, "")
      .replace(/-\d{8}$/, "")
      .split("-")
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  const ctxWindow = () => getContextWindow(props.currentModel);
  // Use the last API call's actual context token count (input+output+cache),
  // NOT cumulative session totals — matches what Pi TUI displays.
  const ctxUsed = () => props.ctxTokens;
  const ctxPct = () => {
    const w = ctxWindow();
    if (!w || ctxUsed() <= 0) return null;
    return Math.min(100, (ctxUsed() / w) * 100);
  };
  const ctxColor = () => {
    const p = ctxPct();
    if (p === null) return "var(--accent-base)";
    if (p > 80) return "var(--icon-critical-base, #f87171)";
    if (p > 50) return "var(--icon-warning-base, #fb923c)";
    return "var(--accent-base)";
  };

  const effortLabel = () => effort().charAt(0).toUpperCase() + effort().slice(1);
  const verbLabel = () => verbosity() === "normal" ? "Normal" : verbosity() === "thinking" ? "Thinking" : "Verbose";

  return (
    <div class="status-bar">
      {/* LEFT: model · effort · transcript view */}
      <div class="status-left">
        <span class="status-model-label">{shortModelLabel()}</span>

        <div class="status-drop-wrap">
          <button
            class="status-pill"
            onClick={() => { setEffortDropOpen(o => !o); setVerbDropOpen(false); }}
            title="Effort level"
          >
            {effortLabel()}
          </button>
          <Show when={effortDropOpen()}>
            <div class="status-drop-backdrop" onClick={() => setEffortDropOpen(false)} />
            <div class="status-dropdown">
              {(["low", "medium", "high"] as Effort[]).map(e => (
                <button
                  class={`status-drop-item${effort() === e ? " active" : ""}`}
                  onClick={() => { setEffort(e); setEffortDropOpen(false); }}
                >
                  {e.charAt(0).toUpperCase() + e.slice(1)}
                </button>
              ))}
            </div>
          </Show>
        </div>

        <div class="status-drop-wrap">
          <button
            class="status-pill"
            onClick={() => { setVerbDropOpen(o => !o); setEffortDropOpen(false); }}
            title="Transcript view"
          >
            {verbLabel()}
          </button>
          <Show when={verbDropOpen()}>
            <div class="status-drop-backdrop" onClick={() => setVerbDropOpen(false)} />
            <div class="status-dropdown">
              {(["normal", "thinking", "verbose"] as Verbosity[]).map(v => (
                <button
                  class={`status-drop-item${verbosity() === v ? " active" : ""}`}
                  onClick={() => { setVerbosity(v); setVerbDropOpen(false); }}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </Show>
        </div>
      </div>

      {/* RIGHT: compact + ctx bar + cost */}
      <div class="status-right">
        <Show when={ctxPct() !== null && ctxPct()! > 75}>
          <button class="compact-btn" onClick={props.onCompact} title="Compact context">
            ↺ Compact
          </button>
        </Show>
        <div class="ctx-usage" title={ctxWindow() ? `Context: ${ctxUsed().toLocaleString()} / ${ctxWindow()!.toLocaleString()} tokens (${(ctxPct() ?? 0).toFixed(1)}%)` : "Context window"}>
          <div class="ctx-bar-track">
            <div class="ctx-bar-fill" style={{ width: `${ctxPct() ?? 0}%`, background: ctxColor() }} />
          </div>
          <span class="ctx-bar-label">
            {formatTokenCount(ctxUsed())} / {ctxWindow() ? formatTokenCount(ctxWindow()!) : "—"}
          </span>
        </div>
        <div class="status-usage">
          <span title="Session output tokens">↓ {props.sessionUsage.output.toLocaleString()}</span>
          <Show when={props.sessionUsage.cacheRead > 0}>
            <span class="usage-sep">·</span>
            <span title="Cache read">⚡ {props.sessionUsage.cacheRead.toLocaleString()}</span>
          </Show>
          <span class="usage-sep">·</span>
          <span class="usage-cost" title="Session cost">${props.sessionUsage.cost.toFixed(4)}</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Loading Indicator
// ============================================================================

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const BrailleSpinner: Component = () => {
  const [frame, setFrame] = createSignal(0);
  onMount(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % BRAILLE_FRAMES.length), 80);
    onCleanup(() => clearInterval(id));
  });
  return <span class="braille-spinner" aria-hidden="true">{BRAILLE_FRAMES[frame()]}</span>;
};

// ============================================================================
// Chat Message
// ============================================================================

interface ChatMessageProps {
  message: Message;
}

// Parse pi tool result JSON → extract text content
function parseResultText(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const r = JSON.parse(raw);
    if (Array.isArray(r)) return r.map((x: any) => x?.text ?? "").join("\n");
    if (r?.content) return parseResultText(JSON.stringify(r.content));
    if (typeof r === "string") return r;
  } catch {}
  return raw;
}

// Parse pi's pre-computed diff string from result.details.diff
// Format: "-1 old line\n+1 new line\n 2 context"
interface ParsedDiffLine { type: "added" | "removed" | "context"; lineNo: number; text: string; }
function parsePiDiff(diffStr: string): ParsedDiffLine[] {
  return diffStr.split("\n").filter(Boolean).map((line) => {
    const m = line.match(/^([+\- ])(\d+) (.*)$/);
    if (!m) return { type: "context" as const, lineNo: 0, text: line };
    return {
      type: m[1] === "+" ? "added" : m[1] === "-" ? "removed" : "context",
      lineNo: parseInt(m[2]),
      text: m[3],
    } as ParsedDiffLine;
  });
}

const PiDiffView: Component<{ diffStr: string }> = (props) => {
  const lines = () => parsePiDiff(props.diffStr);
  return (
    <div class="diff-viewer">
      <For each={lines()}>
        {(line) => (
          <div class={`diff-line ${line.type}`}>
            <span class="diff-prefix">{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}{line.lineNo}</span>
            <span class="diff-text">{line.text}</span>
          </div>
        )}
      </For>
    </div>
  );
};

const ToolCard: Component<{ tool: ToolCall; forceOpen?: boolean }> = (props) => {
  const [open, setOpen] = createSignal(false);
  const isOpen = () => open() || !!props.forceOpen;
  const t = () => props.tool;
  const args = () => t().toolArgs;
  const nameLower = () => t().toolName.toLowerCase();
  const isEdit  = () => nameLower().includes("edit");
  const isWrite = () => nameLower().includes("write");
  const isRead  = () => nameLower().includes("read");
  const isBash  = () => nameLower().includes("bash") || nameLower().includes("shell");

  const fp = () => args().file_path ?? args().path ?? "";
  const title = () => {
    const n = t().toolName;
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  const subtitle = () => {
    if (fp()) return fp();
    if (isBash() && args().command) return String(args().command).slice(0, 60);
    return "";
  };

  const piDiff = (): string | null => {
    try {
      const r = JSON.parse(t().toolResult ?? "null");
      return r?.details?.diff ?? null;
    } catch { return null; }
  };

  const pending = () => !t().toolDone;

  return (
    <div data-component="collapsible" class="tool-collapsible">
      <button
        data-slot="collapsible-trigger"
        aria-expanded={isOpen()}
        onClick={() => setOpen(v => !v)}
      >
        <div data-component="tool-trigger">
          <div data-slot="basic-tool-tool-trigger-content">
            <div data-slot="basic-tool-tool-indicator">
              <Show when={pending()}>
                <span data-component="spinner" />
              </Show>
              <Show when={!pending() && !t().toolIsError}>
                <span class="tool-status-ok">✓</span>
              </Show>
              <Show when={!pending() && t().toolIsError}>
                <span class="tool-status-err">✗</span>
              </Show>
            </div>
            <div data-slot="basic-tool-tool-info">
              <div data-slot="basic-tool-tool-info-structured">
                <div data-slot="basic-tool-tool-info-main">
                  <span data-slot="basic-tool-tool-title" class="capitalize">{title()}</span>
                  <Show when={subtitle()}>
                    <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>
                  </Show>
                </div>
              </div>
            </div>
          </div>
          <div data-slot="collapsible-arrow">
            <span data-slot="collapsible-arrow-icon" />
          </div>
        </div>
      </button>
      <Show when={isOpen()}>
        <div data-slot="collapsible-content" data-expanded>
          <Show when={t().toolDone && !t().toolIsError}>
            <Show when={isEdit()}>
              <Show when={piDiff()} fallback={
                <DiffViewer oldText={args().old_string ?? ""} newText={args().new_string ?? ""} />
              }>
                <PiDiffView diffStr={piDiff()!} />
              </Show>
            </Show>
            <Show when={isWrite()}>
              <Show when={args().content} fallback={
                <div data-component="tool-output"><pre>{parseResultText(t().toolResult)}</pre></div>
              }>
                <DiffViewer oldText="" newText={args().content ?? ""} />
              </Show>
            </Show>
            <Show when={isRead()}>
              <div data-component="tool-output">
                <pre>{parseResultText(t().toolResult)}</pre>
              </div>
            </Show>
            <Show when={isBash()}>
              <div data-component="bash-output">
                <div data-slot="bash-scroll">
                  <pre data-slot="bash-pre">
                    <code>{args().command ? `$ ${args().command}\n` : ""}{parseResultText(t().toolResult)}</code>
                  </pre>
                </div>
              </div>
            </Show>
            <Show when={!isEdit() && !isWrite() && !isRead() && !isBash()}>
              <div data-component="tool-output">
                <pre>{parseResultText(t().toolResult)}</pre>
              </div>
            </Show>
          </Show>
          <Show when={t().toolIsError}>
            <div data-component="bash-output">
              <div data-slot="bash-scroll">
                <pre data-slot="bash-pre">
                  <code class="tool-err-out">{parseResultText(t().toolResult)}</code>
                </pre>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const ThinkingBlock: Component<{ thinking: string; streaming?: boolean; inline?: boolean }> = (props) => {
  const [open, setOpen] = createSignal(!!props.streaming);

  return (
    <Show
      when={!props.inline}
      fallback={
        <div data-component="reasoning-part" class={props.streaming ? "streaming" : ""}>
          <p class="reasoning-text">{props.thinking}</p>
        </div>
      }
    >
      <div data-component="collapsible" class={`tool-collapsible thinking-collapsible${props.streaming ? " streaming" : ""}`}>
        <button data-slot="collapsible-trigger" aria-expanded={open()} onClick={() => setOpen(v => !v)}>
          <span style="margin-right:6px;font-size:13px">{props.streaming ? "⟳" : "💭"}</span>
          <span style="flex:1;font-weight:500">{props.streaming ? "Thinking…" : "Thought process"}</span>
          <div data-slot="collapsible-arrow">
            <span data-slot="collapsible-arrow-icon" />
          </div>
        </button>
        <Show when={open()}>
          <div data-slot="collapsible-content" data-expanded>
            <pre class="thinking-content">{props.thinking}</pre>
          </div>
        </Show>
      </div>
    </Show>
  );
};

const ChatMessage: Component<ChatMessageProps> = (props) => {
  const m = () => props.message;

  if (m().role === "compaction") {
    return (
      <div class="compaction-divider" aria-label="Context compacted">
        <div class="compaction-line" />
        <span class="compaction-label">↺ Compaction</span>
        <div class="compaction-line" />
      </div>
    );
  }

  if (m().role === "system") {
    return (
      <div class="system-message">
        <pre class="system-text">{m().content}</pre>
      </div>
    );
  }

  if (m().role === "user") {
    return (
      <div data-component="user-message">
        <div data-slot="user-message-body">
          <div data-slot="user-message-text">{m().content}</div>
        </div>
      </div>
    );
  }

  // assistant
  const reasoning = () => m().reasoningTokenEst ?? 0;
  const generation = () => Math.max(0, (m().usage?.output ?? 0) - reasoning());

  return (
    <div data-component="assistant-message">
      <Show when={m().thinking && verbosity() !== "normal"}>
        <ThinkingBlock thinking={m().thinking!} streaming={!m().content} inline={true} />
      </Show>
      <Show when={m().tools && m().tools!.length > 0}>
        <div class="tool-list">
          <For each={m().tools}>
            {(tool) => <ToolCard tool={tool} forceOpen={verbosity() === "verbose"} />}
          </For>
        </div>
      </Show>
      <Show when={m().content}>
        <div data-component="text-part">
          <div data-slot="text-part-body">
            <Markdown content={m().content} />
          </div>
        </div>
      </Show>
      <Show when={m().usage}>
        {(u) => (
          <div class="message-usage">
            <span title="Input tokens">↑ {u().input.toLocaleString()}</span>
            <Show when={reasoning() > 0}>
              <span class="usage-sep">·</span>
              <span class="usage-reasoning" title="Reasoning tokens">💭 {reasoning().toLocaleString()}</span>
            </Show>
            <span class="usage-sep">·</span>
            <span title="Generation tokens">✦ {generation().toLocaleString()}</span>
            <Show when={u().cacheRead > 0}>
              <span class="usage-sep">·</span>
              <span title="Cache read">⚡ {u().cacheRead.toLocaleString()}</span>
            </Show>
            <span class="usage-sep">·</span>
            <span class="usage-cost" title="Cost">${u().cost.toFixed(4)}</span>
          </div>
        )}
      </Show>
    </div>
  );
};

// ============================================================================
// Slash Palette
// ============================================================================

interface SlashPaletteProps {
  filter: string;
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}

const SlashPalette: Component<SlashPaletteProps> = (props) => {
  const filtered = createMemo(() => {
    const q = props.filter.toLowerCase();
    return props.commands.filter((c) => c.name.startsWith(q) || c.name.includes(q));
  });

  return (
    <Show when={filtered().length > 0}>
      <div class="slash-palette" role="listbox">
        <For each={filtered()}>
          {(cmd, i) => (
            <button
              class={`slash-option${i() === props.selectedIndex ? " selected" : ""}`}
              role="option"
              aria-selected={i() === props.selectedIndex}
              onMouseDown={(e) => { e.preventDefault(); props.onSelect(cmd); }}
            >
              <span class="slash-name">/{cmd.name}</span>
              <span class="slash-desc">{cmd.description}</span>
              <Show when={cmd.source !== "builtin"}>
                <span class="slash-badge">{cmd.source}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};

// ============================================================================
// Chat Input
// ============================================================================

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  slashCommands: SlashCommand[];
}

const ChatInput: Component<ChatInputProps> = (props) => {
  const [input, setInput] = createSignal("");
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  let textareaRef: HTMLTextAreaElement | undefined;

  const slashFilter = createMemo(() => {
    const v = input();
    if (!v.startsWith("/")) return null;
    if (v.includes(" ")) return null;
    return v.slice(1);
  });

  const paletteCommands = createMemo(() => {
    const f = slashFilter();
    if (f === null) return [];
    return props.slashCommands.filter(
      (c) => c.name.startsWith(f) || c.name.includes(f)
    );
  });

  const paletteOpen = () => slashFilter() !== null && paletteCommands().length > 0;

  const selectCommand = (cmd: SlashCommand) => {
    setInput(`/${cmd.name} `);
    setPaletteIndex(0);
    textareaRef?.focus();
  };

  const handleSubmit = () => {
    const value = input().trim();
    if (value && !props.disabled) {
      props.onSend(value);
      setInput("");
      if (textareaRef) textareaRef.style.height = "auto";
      setPaletteIndex(0);
      // Restore focus so user can type immediately after sending
      requestAnimationFrame(() => textareaRef?.focus());
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (paletteOpen()) {
      const cmds = paletteCommands();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPaletteIndex((i) => Math.min(i + 1, cmds.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPaletteIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && paletteOpen())) {
        const selected = cmds[paletteIndex()];
        if (selected) {
          e.preventDefault();
          selectCommand(selected);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        setPaletteIndex(0);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setInput(target.value);
    setPaletteIndex(0);
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 150)}px`;
  };

  return (
    <div class="chat-input-container">
      <Show when={paletteOpen()}>
        <div data-dock-surface="tray" data-dock-attach="top">
          <SlashPalette
            filter={slashFilter()!}
            commands={props.slashCommands}
            selectedIndex={paletteIndex()}
            onSelect={selectCommand}
          />
        </div>
      </Show>
      <div data-dock-surface="shell">
        <div class="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            class={`chat-input${props.disabled ? " chat-input-busy" : ""}`}
            placeholder={props.disabled ? "Pi is responding…" : "Ask anything…"}
            value={input()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            class="send-btn"
            onClick={handleSubmit}
            disabled={props.disabled || !input().trim()}
            aria-label="Send message"
          >
            ➤
          </button>
        </div>
        <div class="chat-input-footer">
          <span class="chat-input-hint">↵ send · ⇧↵ newline · / commands</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Session Sidebar
// ============================================================================

interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
}

const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <aside class={`sidebar${sidebarOpen() ? "" : " collapsed"}`}>
      <div class="sidebar-header">
        <button class="new-session-btn" onClick={props.onNewSession} aria-label="New session" title="New session">
          +
        </button>
      </div>
      <div class="session-list">
        <For each={props.sessions}>
          {(session) => (
            <div class={`session-item ${session.id === props.activeSessionId ? "active" : ""}`}>
              <button
                class="session-item-body"
                onClick={() => props.onSelectSession(session.id)}
              >
                <div class="session-info">
                  <div class="session-title">{session.title}</div>
                  <div class="session-meta">
                    <span class="session-date">{formatDate(session.timestamp)}</span>
                  </div>
                </div>
              </button>
              <button
                class="session-delete-btn"
                title="Delete session"
                onClick={e => { e.stopPropagation(); props.onDeleteSession(session.id); }}
              >✕</button>
            </div>
          )}
        </For>
        <Show when={props.sessions.length === 0}>
          <div class="empty-sessions">
            <p>No sessions yet</p>
            <p class="empty-hint">Start a new conversation with Pi</p>
          </div>
        </Show>
      </div>
    </aside>
  );
};

// ============================================================================
// File Tree Panel
// ============================================================================

const FileNode: Component<{
  entry: FileEntry;
  depth: number;
  expandedPaths: () => Record<string, boolean>;
  onToggle: (path: string) => void;
}> = (props) => {
  const isExpanded = () => !!props.expandedPaths()[props.entry.path];
  return (
    <div>
      <button
        class={`file-tree-node${props.entry.is_dir ? " is-dir" : ""}`}
        style={`padding-left:${props.depth * 12 + 8}px`}
        onClick={() => props.entry.is_dir && props.onToggle(props.entry.path)}
        title={props.entry.path}
      >
        <span class="file-tree-icon">
          {props.entry.is_dir ? (isExpanded() ? "▾" : "▸") : "·"}
        </span>
        <span class="file-tree-name">{props.entry.name}</span>
      </button>
      <Show when={props.entry.is_dir && isExpanded()}>
        <For each={props.entry.children}>
          {(child) => (
            <FileNode
              entry={child}
              depth={props.depth + 1}
              expandedPaths={props.expandedPaths}
              onToggle={props.onToggle}
            />
          )}
        </For>
      </Show>
    </div>
  );
};

const FileTreePanel: Component<{ cwd: string }> = (props) => {
  const [tree, setTree] = createSignal<FileEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [expandedPaths, setExpandedPaths] = createSignal<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const entries = await invoke<FileEntry[]>("list_directory", { path: props.cwd, depth: 3 });
      setTree(entries);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  onMount(load);

  const toggleExpand = (path: string) =>
    setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] }));

  return (
    <div class="side-panel">
      <div class="side-panel-header">
        <span class="side-panel-title">Files</span>
        <div class="side-panel-actions">
          <button class="icon-btn" onClick={load} title="Refresh">↺</button>
          <button class="icon-btn" onClick={() => setFileTreeOpen(false)} title="Close">✕</button>
        </div>
      </div>
      <div class="side-panel-content">
        <Show when={loading()}><div class="panel-status">Loading…</div></Show>
        <Show when={error()}><div class="panel-status panel-error">{error()}</div></Show>
        <Show when={!loading() && !error()}>
          <For each={tree()}>
            {(entry) => (
              <FileNode entry={entry} depth={0} expandedPaths={expandedPaths} onToggle={toggleExpand} />
            )}
          </For>
          <Show when={tree().length === 0}>
            <div class="panel-status">Empty directory</div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

// ============================================================================
// Git Panel
// ============================================================================

const GitPanel: Component<{ cwd: string }> = (props) => {
  const [files, setFiles] = createSignal<GitFileStatus[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<GitFileStatus[]>("get_git_status", { cwd: props.cwd });
      setFiles(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  onMount(load);

  const statusColor = (s: string) => {
    if (s === "A") return "var(--icon-success-base)";
    if (s === "D") return "var(--icon-critical-base)";
    if (s === "M") return "var(--icon-warning-base)";
    return "var(--text-weak)";
  };

  return (
    <div class="side-panel">
      <div class="side-panel-header">
        <span class="side-panel-title">
          Changes{files().length > 0 ? ` (${files().length})` : ""}
        </span>
        <div class="side-panel-actions">
          <button class="icon-btn" onClick={load} title="Refresh">↺</button>
          <button class="icon-btn" onClick={() => setGitOpen(false)} title="Close">✕</button>
        </div>
      </div>
      <div class="side-panel-content">
        <Show when={loading()}><div class="panel-status">Loading…</div></Show>
        <Show when={error()}><div class="panel-status panel-error">{error()}</div></Show>
        <Show when={!loading() && !error() && files().length === 0}>
          <div class="panel-status">No changes</div>
        </Show>
        <Show when={!loading() && !error()}>
          <For each={files()}>
            {(f) => (
              <div class="git-file-row">
                <span class="git-status-badge" style={`color:${statusColor(f.status)}`}>
                  {f.status}
                </span>
                <span class="git-file-path">{f.path}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};

// ============================================================================
// Terminal Panel
// ============================================================================

const TerminalPanel: Component<{ content: string; onClear: () => void }> = (props) => (
  <div class="terminal-panel">
    <div class="side-panel-header">
      <span class="side-panel-title">Terminal Output</span>
      <div class="side-panel-actions">
        <button class="icon-btn" onClick={props.onClear} title="Clear">⌫</button>
        <button class="icon-btn" onClick={() => setTerminalOpen(false)} title="Close">✕</button>
      </div>
    </div>
    <div class="terminal-panel-content">
      <pre class="terminal-pre">{props.content || "No output yet…"}</pre>
    </div>
  </div>
);

// ============================================================================
// Session history loader
// ============================================================================

function parseSessionEntries(entries: any[]): Message[] {
  const messages: Message[] = [];
  // Collect tool results keyed by tool_use_id for O(1) lookup
  const toolResultMap = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    if (msg.role === "user") {
      for (const block of content) {
        if (block.type === "tool_result") {
          const resultText = Array.isArray(block.content)
            ? block.content.map((c: any) => c.text ?? "").join("\n")
            : (typeof block.content === "string" ? block.content : JSON.stringify(block.content));
          toolResultMap.set(block.tool_use_id, resultText);
        }
      }
    }
  }

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg) continue;
    const content = Array.isArray(msg.content) ? msg.content : [];

    if (msg.role === "user") {
      const textBlocks = content.filter((b: any) => b.type === "text");
      if (textBlocks.length === 0) continue; // skip tool-result-only messages
      const text = textBlocks.map((b: any) => b.text ?? "").join("\n");
      if (!text.trim()) continue;
      messages.push({
        id: entry.id ?? generateId(),
        role: "user",
        content: text,
        timestamp: new Date(entry.timestamp ?? Date.now()),
      });
    } else if (msg.role === "assistant") {
      let text = "";
      let thinking = "";
      const tools: ToolCall[] = [];
      for (const block of content) {
        if (block.type === "text") text += block.text ?? "";
        else if (block.type === "thinking") thinking += block.thinking ?? "";
        else if (block.type === "tool_use") {
          const result = toolResultMap.get(block.id) ?? "";
          tools.push({
            toolCallId: block.id,
            toolName: block.name ?? "",
            toolArgs: block.input ?? {},
            toolResult: result,
            toolIsError: false,
            toolDone: true,
          });
        }
      }
      if (!text.trim() && tools.length === 0 && !thinking) continue;
      messages.push({
        id: entry.id ?? generateId(),
        role: "assistant",
        content: text,
        thinking: thinking || undefined,
        tools: tools.length > 0 ? tools : undefined,
        timestamp: new Date(entry.timestamp ?? Date.now()),
      });
    }
  }
  return messages;
}

// ============================================================================
// Settings Modal
// ============================================================================

type SettingsTab = "general" | "models" | "shortcuts";

const SHORTCUTS = [
  { keys: "Enter",       description: "Send message" },
  { keys: "Shift+Enter", description: "New line" },
  { keys: "/",           description: "Open command palette" },
  { keys: "Esc",         description: "Close palette / cancel" },
  { keys: "↑ / ↓",      description: "Navigate command list" },
  { keys: "Tab",         description: "Select command" },
];

const ConfirmDialog: Component = () => (
  <Show when={confirmState()}>
    <div class="confirm-backdrop">
      <div class="confirm-dialog">
        <p class="confirm-message">{confirmState()!.message}</p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel" onClick={() => confirmResolve(false)}>Cancel</button>
          <button class="confirm-btn confirm-ok" onClick={() => confirmResolve(true)}>Delete</button>
        </div>
      </div>
    </div>
  </Show>
);

const SettingsModal: Component<{
  availableModels: PiModel[];
  currentModel: PiModel | null;
  onSelectModel: (m: PiModel) => void;
  onFetchModels: () => void;
}> = (props) => {
  const [tab, setTab] = createSignal<SettingsTab>("general");

  onMount(() => {
    // Always fetch fresh model list when settings opens
    props.onFetchModels();
  });

  return (
    <div class="settings-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <div class="settings-dialog">
        <div class="settings-sidebar">
          <div class="settings-app-info">
            <span class="settings-app-icon">π</span>
            <div>
              <div class="settings-app-name">Pi Desktop</div>
            </div>
          </div>
          <nav class="settings-nav">
            <button class={`settings-nav-item${tab() === "general" ? " active" : ""}`} onClick={() => setTab("general")}>
              <Settings size={13}/> General
            </button>
            <button class={`settings-nav-item${tab() === "models" ? " active" : ""}`} onClick={() => setTab("models")}>
              <Atom size={13}/> Models
            </button>
            <button class={`settings-nav-item${tab() === "shortcuts" ? " active" : ""}`} onClick={() => setTab("shortcuts")}>
              <Keyboard size={13}/> Shortcuts
            </button>
          </nav>
        </div>

        <div class="settings-content">
          <button class="settings-close" onClick={() => setSettingsOpen(false)}>✕</button>

          <Show when={tab() === "general"}>
            <div class="settings-section">
              <h2 class="settings-section-title">General</h2>

              <div class="settings-group">
                <div class="settings-row">
                  <div class="settings-row-label">
                    <span class="settings-row-name">Theme</span>
                    <span class="settings-row-desc">Light or dark interface</span>
                  </div>
                  <div class="settings-row-control">
                    <button
                      class={`settings-option-btn${theme() === "light" ? " active" : ""}`}
                      onClick={() => setTheme("light")}
                    >Light</button>
                    <button
                      class={`settings-option-btn${theme() === "dark" ? " active" : ""}`}
                      onClick={() => setTheme("dark")}
                    >Dark</button>
                  </div>
                </div>

                <div class="settings-row">
                  <div class="settings-row-label">
                    <span class="settings-row-name">Verbosity</span>
                    <span class="settings-row-desc">How much detail to show during responses</span>
                  </div>
                  <div class="settings-row-control">
                    {(["normal", "thinking", "verbose"] as const).map(v => (
                      <button
                        class={`settings-option-btn${verbosity() === v ? " active" : ""}`}
                        onClick={() => setVerbosity(v)}
                      >{v}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Show>

          <Show when={tab() === "models"}>
            <div class="settings-section">
              <h2 class="settings-section-title">Models</h2>
              <div class="settings-group">
                <Show when={props.availableModels.length === 0}>
                  <div class="settings-empty">No models loaded — open the model picker first to fetch the list.</div>
                </Show>
                <For each={props.availableModels}>
                  {(model) => {
                    const label = model.name || `${model.provider}/${model.id}`;
                    const active = props.currentModel?.provider === model.provider && props.currentModel?.id === model.id;
                    return (
                      <div
                        class={`settings-model-row${active ? " active" : ""}`}
                        onClick={() => props.onSelectModel(model)}
                      >
                        <div class="settings-model-name">{label}</div>
                        <div class="settings-model-meta">{model.provider}</div>
                        <Show when={active}><span class="settings-model-check">✓</span></Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>

          <Show when={tab() === "shortcuts"}>
            <div class="settings-section">
              <h2 class="settings-section-title">Keyboard Shortcuts</h2>
              <div class="settings-group">
                <For each={SHORTCUTS}>
                  {(s) => (
                    <div class="settings-shortcut-row">
                      <span class="settings-shortcut-desc">{s.description}</span>
                      <kbd class="settings-kbd">{s.keys}</kbd>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Welcome Hero (empty state for new sessions)
// ============================================================================

interface WelcomeHeroProps {
  cwd: string;
  gitBranch: string | null;
  homePath: string;
  lastSession: Date | null;
}

const WelcomeHero: Component<WelcomeHeroProps> = (props) => {
  const displayCwd = () => (props.cwd || props.homePath).replace(/\\/g, "/");

  const cwdParts = () => {
    const parts = displayCwd().split("/").filter(Boolean);
    if (parts.length === 0) return { prefix: "", last: "~" };
    const last = parts[parts.length - 1];
    const prefix = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
    return { prefix, last };
  };

  const branchLabel = () => {
    const b = props.gitBranch ?? "main";
    return b.charAt(0).toUpperCase() + b.slice(1) + " branch";
  };

  const timeAgo = (date: Date) => {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  };

  return (
    <div class="welcome-hero">
      <div class="welcome-logo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" class="welcome-pi-svg">
          <path fill="currentColor" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
          <path fill="currentColor" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
        </svg>
      </div>
      <h1 class="welcome-title">Build anything</h1>
      <p class="welcome-cwd">
        <span class="welcome-cwd-prefix">{cwdParts().prefix}</span>
        <span class="welcome-cwd-last">{cwdParts().last}</span>
      </p>
      <div class="welcome-branch">
        <GitCompare size={13} />
        <span>{branchLabel()}</span>
      </div>
      <Show when={props.lastSession}>
        <div class="welcome-last-active">
          Last active <strong>{timeAgo(props.lastSession!)}</strong>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Main App
// ============================================================================

const App: Component = () => {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  const [cwd, setCwd] = createSignal<string>("");
  const [gitBranch, setGitBranch] = createSignal<string | null>(null);
  const [homePath, setHomePath] = createSignal<string>("~");
  const [isLoading, setIsLoading] = createSignal(false);
  const [terminalOutput, setTerminalOutput] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [piConnected, setPiConnected] = createSignal(false);
  const [currentModel, setCurrentModel] = createSignal<PiModel | null>(null);
  const [availableModels, setAvailableModels] = createSignal<PiModel[]>([]);
  const [sessionUsage, setSessionUsage] = createSignal<TokenUsage>({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
  const [lastCtxTokens, setLastCtxTokens] = createSignal(0); // context window usage from last API call
  const [pendingMessage, setPendingMessage] = createSignal<Message | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
  const [pendingTools, setPendingTools] = createSignal<ToolCall[]>([]);
  const [dynamicSlashCommands, setDynamicSlashCommands] = createSignal<SlashCommand[]>([]);
  const [progressState, setProgressState] = createSignal<"hidden" | "showing" | "hiding">("hidden");

  const allSlashCommands = createMemo<SlashCommand[]>(() => [
    ...BUILTIN_SLASH_COMMANDS,
    ...dynamicSlashCommands(),
  ]);

  let unlistenFn: UnlistenFn | undefined;
  let hideProgressTimer: ReturnType<typeof setTimeout> | undefined;
  let scrollRef: HTMLDivElement | undefined;
  let userScrolled = false;

  const scrollToBottom = () => {
    if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
  };

  // Auto-scroll: new user message always scrolls; streaming scrolls if not manually scrolled up
  createEffect(() => {
    const msgs = messages();
    if (msgs.length > 0 && msgs[msgs.length - 1].role === "user") {
      userScrolled = false;
    }
    requestAnimationFrame(scrollToBottom);
  });

  createEffect(() => {
    pendingMessage(); // track streaming updates
    if (!userScrolled) requestAnimationFrame(scrollToBottom);
  });
  // Fetch home dir once on mount
  onMount(() => {
    invoke<string>("get_home_dir")
      .then(h => setHomePath(h))
      .catch(() => {});
  });

  // Fetch git branch when cwd changes
  createEffect(() => {
    const dir = cwd();
    if (!dir) { setGitBranch(null); return; }
    invoke<string>("get_git_branch", { cwd: dir })
      .then(b => setGitBranch(b))
      .catch(() => setGitBranch(null));
  });

  let taskStartTime = 0;

  // Progress bar: show while loading, fade-out on finish
  createEffect(() => {
    if (isLoading()) {
      clearTimeout(hideProgressTimer);
      setProgressState("showing");
    } else {
      if (progressState() !== "hidden") {
        setProgressState("hiding");
        hideProgressTimer = setTimeout(() => setProgressState("hidden"), 400);
      }
    }
  });

  // Elapsed timer: counts up every second while loading
  let elapsedInterval: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    if (isLoading()) {
      setElapsedSeconds(0);
      elapsedInterval = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      clearInterval(elapsedInterval);
    }
    onCleanup(() => clearInterval(elapsedInterval));
  });

  const formatElapsed = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  const pendingTokenEst = createMemo(() => {
    const pm = pendingMessage();
    if (!pm) return 0;
    return Math.round(((pm.content?.length ?? 0) + (pm.thinking?.length ?? 0)) / 4);
  });

  const sendDesktopNotification = async (title: string, body: string) => {
    if (!("Notification" in window)) return;
    if (document.hasFocus()) return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission === "granted") {
      new Notification(title, { body, silent: false });
    }
  };

  const loadSessions = async () => {
    try {
      const raw = await invoke<{ path: string; title: string; modified_ms: number }[]>("list_pi_sessions");
      const loaded: Session[] = raw.map((s) => ({
        id: s.path,
        title: s.title,
        timestamp: new Date(s.modified_ms),
      }));
      setSessions(loaded);
    } catch (e) {
      console.warn("list_pi_sessions failed:", e);
    }
  };

  const sendRpc = async (payload: Record<string, any>) => {
    try {
      await invoke("pi_send_rpc", { payload });
    } catch (e) {
      console.error("pi_send_rpc failed:", e);
    }
  };

  const addSystemMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: generateId(), role: "system", content, timestamp: new Date() },
    ]);
  };

  const handleOpenModelPicker = async () => {
    await sendRpc({ type: "get_available_models", id: generateId() });
  };

  const handleSelectModel = async (model: PiModel) => {
    await sendRpc({ type: "set_model", provider: model.provider, modelId: model.id, id: generateId() });
  };

  const handleSlashCommand = async (name: string, args: string) => {
    switch (name) {
      case "model":
        await handleOpenModelPicker();
        setModelPickerForceOpen(true);
        break;

      case "new":
        await handleNewSession();
        break;

      case "compact":
        await sendRpc({
          type: "compact",
          ...(args ? { customInstructions: args } : {}),
          id: generateId(),
        });
        break;

      case "session":
        await sendRpc({ type: "get_session_stats", id: generateId() });
        break;

      case "copy":
        await sendRpc({ type: "get_last_assistant_text", id: generateId() });
        break;

      case "name":
        if (args) {
          await sendRpc({ type: "set_session_name", name: args, id: generateId() });
          setSessions((prev) =>
            prev.map((s) =>
              s.id === activeSessionId() ? { ...s, title: args } : s
            )
          );
        }
        break;

      case "export":
        await sendRpc({
          type: "export_html",
          ...(args ? { outputPath: args } : {}),
          id: generateId(),
        });
        break;

      case "fork":
        // args = entryId (optional)
        if (args) {
          await sendRpc({ type: "fork", entryId: args, id: generateId() });
        } else {
          addSystemMessage("Usage: /fork <entryId>");
        }
        break;

      case "quit":
        await invoke("kill_pi").catch(console.error);
        break;

      case "settings":
        setSettingsOpen(true);
        break;

      case "scoped-models":
      case "share":
      case "changelog":
      case "hotkeys":
      case "tree":
      case "login":
      case "logout":
      case "reload":
      case "import":
      case "resume":
        addSystemMessage(`/${name} is not yet supported in desktop mode.`);
        break;

      default:
        // Extension / prompt / skill commands — send as prompt, they route correctly
        await invoke("pi_send_message", {
          msg: `/${name}${args ? " " + args : ""}`,
          id: generateId(),
        });
        break;
    }
  };

  onMount(async () => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) {
      console.log("Not in Tauri runtime — UI preview only");
      return;
    }

    try {
      await invoke("spawn_pi");
      setPiConnected(true);
      console.log("Pi process spawned");
      // Create a fresh disk-backed session (Pi spawned with --no-session
      // to avoid auto-loading stale history → keeps token count lean).
      await sendRpc({ type: "new_session", id: generateId() });
      await Promise.all([
        sendRpc({ type: "get_state", id: generateId() }),
        sendRpc({ type: "get_commands", id: generateId() }),
        loadSessions(),
      ]);
    } catch (e) {
      console.error("Failed to spawn pi:", e);
      setError(`Failed to spawn pi: ${e}`);
    }

    try {
      unlistenFn = await listen<PiEvent>("pi-event", (event) => {
        const data = event.payload;
        console.log("pi-event:", data.type, data);

        switch (data.type) {
          case "session":
            console.log("Session started:", data.id, "cwd:", data.cwd);
            if (data.cwd) setCwd(data.cwd);
            loadSessions();
            break;

          case "agent_start":
            taskStartTime = Date.now();
            setIsLoading(true);
            break;

          case "agent_end":
            setIsLoading(false);
            setPendingTools([]);
            break;

          case "message_start":
            if (data.message?.role === "assistant") {
              setPendingMessage({ id: generateId(), role: "assistant", content: "", timestamp: new Date() });
            }
            break;

          case "message_update": {
            const evt = data.assistantMessageEvent;
            if (evt?.type === "text_delta") {
              setPendingMessage((prev) =>
                prev ? { ...prev, content: prev.content + evt.delta } : prev
              );
            } else if (evt?.type === "thinking_delta") {
              setPendingMessage((prev) =>
                prev ? { ...prev, thinking: (prev.thinking ?? "") + evt.delta } : prev
              );
            }
            break;
          }

          case "message_end": {
            if (data.message?.role === "assistant") {
              const pending = pendingMessage();
              const tools = pendingTools();
              const u = data.message?.usage;
              const usage: TokenUsage | undefined = u
                ? { input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0, cost: u.cost?.total ?? u.cost ?? 0 }
                : undefined;
              const reasoningTokenEst = Math.round((pending?.thinking?.length ?? 0) / 4);
              const prev = sessionUsage();
              const cumulative: TokenUsage = usage
                ? { input: prev.input + usage.input, output: prev.output + usage.output, cacheRead: prev.cacheRead + usage.cacheRead, cacheWrite: prev.cacheWrite + usage.cacheWrite, cost: prev.cost + usage.cost }
                : prev;
              const hasTools = tools.length > 0;
              const hasContent = !!pending?.content.trim();
              batch(() => {
                if (hasContent || hasTools) {
                  setMessages((msgs) => [...msgs, {
                    ...(pending ?? { id: generateId(), role: "assistant" as const, content: "", timestamp: new Date() }),
                    usage,
                    reasoningTokenEst,
                    cumulativeUsage: cumulative,
                    tools: hasTools ? tools : undefined,
                  }]);
                  setPendingTools([]);
                }
                setPendingMessage(null);
                if (usage) {
                  setSessionUsage(cumulative);
                  setLastCtxTokens(usage.input + usage.output + usage.cacheRead + usage.cacheWrite);
                }
              });
            }
            break;
          }

          case "turn_end": {
            setIsLoading(false);
            const elapsed = Date.now() - taskStartTime;
            if (elapsed > 4000) {
              const secs = Math.round(elapsed / 1000);
              sendDesktopNotification("Pi finished", `Task completed in ${secs}s`);
            }
            break;
          }

          case "tool_execution_start": {
            const tool: ToolCall = {
              toolCallId: data.toolCallId ?? generateId(),
              toolName: data.toolName,
              toolArgs: data.args ?? {},
              toolDone: false,
            };
            setPendingTools((prev) => [...prev, tool]);
            setTerminalOutput((prev) => prev + `\n[tool] ${data.toolName}\n`);
            break;
          }

          case "tool_execution_end": {
            const resultText = data.isError
              ? JSON.stringify(data.result)
              : (typeof data.result === "string" ? data.result : JSON.stringify(data.result));
            setPendingTools((prev) =>
              prev.map((t) =>
                t.toolCallId === data.toolCallId
                  ? { ...t, toolResult: resultText, toolIsError: !!data.isError, toolDone: true }
                  : t
              )
            );
            setTerminalOutput((prev) =>
              prev + (data.isError ? `[error] ${resultText}` : `[OK]`) + "\n"
            );
            break;
          }

          case "compaction_start":
            setTerminalOutput((prev) => prev + "\n[Compacting context...]\n");
            setMessages((prev) => [
              ...prev,
              { id: generateId(), role: "compaction" as const, content: "", timestamp: new Date() },
            ]);
            // Reset session usage — context has been summarized
            setSessionUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
            break;

          case "response": {
            const cmd = data.command as string;
            if (!data.success) {
              console.warn(`RPC ${cmd} failed:`, data.error);
              if (cmd === "set_model") {
                addSystemMessage(`Model switch failed: ${data.error}`);
              }
              break;
            }

            if (cmd === "get_available_models" && data.data?.models) {
              const models: PiModel[] = (data.data.models as any[]).map((m: any) => ({
                provider: m.provider ?? m.providerId ?? "",
                id: m.id ?? m.modelId ?? "",
                name: m.name,
                contextWindow: m.contextWindow ?? m.context_window ?? m.maxTokens ?? m.max_tokens ?? undefined,
              }));
              setAvailableModels(models);
              // Update context window on current model if we now have better data
              const cur = currentModel();
              if (cur) {
                const found = models.find(m => m.provider === cur.provider && m.id === cur.id);
                if (found?.contextWindow) setCurrentModel({ ...cur, contextWindow: found.contextWindow });
              }

            } else if (cmd === "set_model" && data.data) {
              const m = data.data;
              setCurrentModel({
                provider: m.provider ?? m.providerId ?? "",
                id: m.id ?? m.modelId ?? "",
                name: m.name,
                contextWindow: m.contextWindow ?? m.context_window ?? m.maxTokens ?? m.max_tokens ?? undefined,
              });
              addSystemMessage(`Switched to model: ${m.name || `${m.provider}/${m.id}`}`);

            } else if (cmd === "get_state" && data.data) {
              const m = data.data.model;
              if (m) setCurrentModel({
                provider: m.provider ?? m.providerId ?? "",
                id: m.id ?? m.modelId ?? "",
                name: m.name,
                contextWindow: m.contextWindow ?? m.context_window ?? m.maxTokens ?? m.max_tokens ?? undefined,
              });
              if (data.data.cwd) setCwd(data.data.cwd);
              if (data.data.sessionFile) {
                const sf = data.data.sessionFile as string;
                setActiveSessionId(sf);
                // Load history if chat is currently empty (initial load)
                if (messages().length === 0) {
                  invoke<any[]>("read_session_file", { path: sf })
                    .then((entries) => {
                      const history = parseSessionEntries(entries);
                      if (history.length > 0) setMessages(history);
                    })
                    .catch((e) => console.warn("Could not load initial session history:", e));
                }
              }

            } else if (cmd === "get_session_stats" && data.data) {
              const s = data.data;
              const tok = s.tokens ?? {};
              const cost = typeof s.cost === "number" ? `$${s.cost.toFixed(4)}` : "n/a";
              addSystemMessage(
                `Session Stats\n` +
                `Messages: ${s.totalMessages ?? "?"} (${s.userMessages ?? "?"} user / ${s.assistantMessages ?? "?"} assistant)\n` +
                `Tool calls: ${s.toolCalls ?? "?"}\n` +
                `Tokens: ${tok.total ?? "?"} total (${tok.input ?? "?"} in / ${tok.output ?? "?"} out)\n` +
                `Cache read: ${tok.cacheRead ?? "?"} · Cache write: ${tok.cacheWrite ?? "?"}\n` +
                `Cost: ${cost}`
              );

            } else if (cmd === "get_last_assistant_text" && data.data) {
              const text = typeof data.data === "string" ? data.data : data.data.text ?? "";
              if (text) {
                navigator.clipboard.writeText(text).then(
                  () => addSystemMessage("Last assistant message copied to clipboard."),
                  () => addSystemMessage(`Could not access clipboard. Text:\n${text.slice(0, 200)}…`)
                );
              }

            } else if (cmd === "get_commands" && Array.isArray(data.data)) {
              const cmds: SlashCommand[] = (data.data as any[]).map((c: any) => ({
                name: c.name,
                description: c.description ?? "",
                source: (c.source as SlashCommand["source"]) ?? "extension",
              }));
              setDynamicSlashCommands(cmds);

            } else if (cmd === "export_html") {
              addSystemMessage(`Session exported.${data.data?.path ? ` Path: ${data.data.path}` : ""}`);

            } else if (cmd === "new_session") {
              if (!data.data?.cancelled) {
                // Re-query state to get the new sessionFile path, then refresh list
                setTimeout(async () => {
                  await sendRpc({ type: "get_state", id: generateId() });
                  await loadSessions();
                }, 300);
              }

            } else if (cmd === "switch_session") {
              if (!data.data?.cancelled) {
                const newPath = data.data?.sessionFile ?? data.data?.path ?? null;
                if (newPath) setActiveSessionId(newPath);
                loadSessions();
              }

            } else if (cmd === "compact") {
              addSystemMessage("Context compacted.");

            } else if (cmd === "set_session_name") {
              addSystemMessage(`Session renamed.`);
            }
            break;
          }

          case "error":
            setError(data.message || "Unknown error from pi");
            setIsLoading(false);
            break;
        }
      });
    } catch (e) {
      console.error("Failed to listen for pi events:", e);
    }
  });

  onCleanup(() => {
    unlistenFn?.();
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) invoke("kill_pi").catch(console.error);
  });

  const handleSendMessage = async (content: string) => {
    // Route slash commands
    if (content.startsWith("/")) {
      const trimmed = content.trim();
      const spaceIdx = trimmed.indexOf(" ");
      const name = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
      const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
      await handleSlashCommand(name, args);
      return;
    }

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    setTerminalOutput((prev) => prev + `$ ${content}\n`);

    try {
      await invoke("pi_send_message", { msg: content, id: generateId() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setIsLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "system",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleNewSession = async () => {
    await sendRpc({ type: "new_session", id: generateId() });
    batch(() => {
      setMessages([]);
      setTerminalOutput("");
      setError(null);
      setSessionUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
      setPendingMessage(null);
      setPendingTools([]);
    });
    // Sidebar refreshes when pi emits "session" event
  };

  const handleSelectSession = async (id: string) => {
    if (id === activeSessionId()) return;
    setActiveSessionId(id);
    // Load history from file immediately for display
    try {
      const entries = await invoke<any[]>("read_session_file", { path: id });
      const history = parseSessionEntries(entries);
      batch(() => {
        setMessages(history);
        setTerminalOutput("");
        setPendingMessage(null);
        setPendingTools([]);
        setIsLoading(false);
        setSessionUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
        setError(null);
      });
    } catch (e) {
      console.warn("Failed to load session history:", e);
    }
    // Tell pi to switch so future prompts use this session
    await sendRpc({ type: "switch_session", sessionPath: id, id: generateId() });
  };

  const handleDeleteSession = async (id: string) => {
    const sess = sessions().find(s => s.id === id);
    const label = sess?.title || "this session";
    if (!await showConfirm(`Permanently delete "${label}"?`)) return;
    try {
      await invoke("delete_session_file", { path: id });
      setSessions(s => s.filter(sess => sess.id !== id));
      if (activeSessionId() === id) {
        await handleNewSession();
      }
    } catch (e) {
      console.warn("Failed to delete session:", e);
    }
  };

  return (
    <div class={`app ${theme()}`}>
      <Titlebar
        sessions={sessions()}
        activeSessionId={activeSessionId()}
        currentModel={currentModel()}
        availableModels={availableModels()}
        onSelectModel={handleSelectModel}
        onOpenModelPicker={handleOpenModelPicker}
        cwd={cwd()}
        homePath={homePath()}
        piConnected={piConnected()}
      />
      <div class="app-content">
        <SessionSidebar
          sessions={sessions()}
          activeSessionId={activeSessionId()}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
        />
        <div class="workspace">
          <div class="workspace-main">
            <main class="main-content">
              <Show when={progressState() !== "hidden"}>
                <div data-component="session-progress" data-state={progressState()}>
                  <div data-component="session-progress-bar" />
                </div>
              </Show>
              <Show when={error()}>
                <div class="error-banner" role="alert">
                  <span class="error-icon">⚠️</span>
                  <span class="error-text">{error()}</span>
                  <button class="error-dismiss" onClick={() => setError(null)}>×</button>
                </div>
              </Show>

              <div class="chat-container">
                <div data-component="session-turn">
                  <div
                    data-slot="session-turn-content"
                    ref={scrollRef}
                    onScroll={() => {
                      if (!scrollRef) return;
                      const { scrollTop, scrollHeight, clientHeight } = scrollRef;
                      userScrolled = scrollHeight - scrollTop - clientHeight > 120;
                    }}
                  >
                    <Show when={messages().length === 0 && !isLoading()}>
                      <WelcomeHero cwd={cwd()} gitBranch={gitBranch()} homePath={homePath()} lastSession={sessions()[0]?.timestamp ?? null} />
                    </Show>
                    <div data-slot="session-turn-message-container">
                      <For each={messages()}>
                        {(message) => <ChatMessage message={message} />}
                      </For>
                      <Show when={pendingMessage()}>
                        {(msg) => <ChatMessage message={msg()} />}
                      </Show>
                      <Show when={isLoading()}>
                        <div data-slot="session-turn-thinking">
                          <BrailleSpinner />
                          <span class="agent-elapsed">{formatElapsed(elapsedSeconds())}</span>
                          <span class="usage-sep">·</span>
                          <span class="agent-tokens">
                            ↓ {pendingTokenEst() > 0
                              ? `${pendingTokenEst().toLocaleString()} tokens`
                              : "thinking…"}
                          </span>
                        </div>
                      </Show>
                    </div>
                  </div>
                </div>

                <div class="chat-dock">
                  <ChatInput
                    onSend={handleSendMessage}
                    disabled={isLoading()}
                    slashCommands={allSlashCommands()}
                  />
                  <StatusBar currentModel={currentModel()} sessionUsage={sessionUsage()} ctxTokens={lastCtxTokens()} onCompact={() => sendRpc({ type: "compact", id: generateId() })} />
                </div>
              </div>
            </main>

            <Show when={fileTreeOpen() && cwd()}>
              <FileTreePanel cwd={cwd()} />
            </Show>
            <Show when={gitOpen() && cwd()}>
              <GitPanel cwd={cwd()} />
            </Show>
            <Show when={fileTreeOpen() && !cwd()}>
              <div class="side-panel">
                <div class="side-panel-header">
                  <span class="side-panel-title">Files</span>
                  <button class="icon-btn" onClick={() => setFileTreeOpen(false)}>✕</button>
                </div>
                <div class="panel-status">No working directory — start a session first.</div>
              </div>
            </Show>
            <Show when={gitOpen() && !cwd()}>
              <div class="side-panel">
                <div class="side-panel-header">
                  <span class="side-panel-title">Changes</span>
                  <button class="icon-btn" onClick={() => setGitOpen(false)}>✕</button>
                </div>
                <div class="panel-status">No working directory — start a session first.</div>
              </div>
            </Show>
          </div>

          <Show when={terminalOpen()}>
            <TerminalPanel
              content={terminalOutput()}
              onClear={() => setTerminalOutput("")}
            />
          </Show>
        </div>
      </div>
      <Show when={settingsOpen()}>
        <SettingsModal
          availableModels={availableModels()}
          currentModel={currentModel()}
          onSelectModel={handleSelectModel}
          onFetchModels={handleOpenModelPicker}
        />
      </Show>
      <ConfirmDialog />
    </div>
  );
};

export default App;
