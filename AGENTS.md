# Pi Desktop Agent Instructions

This document provides guidance for agents working on the Pi Desktop codebase.

## Project Overview

Pi Desktop is a Tauri-based desktop application that wraps the Pi coding agent CLI. It provides a modern chat-based interface for interacting with Pi, with session management, terminal output display, and theme support.

## Tech Stack

- **Framework**: Solid.js with TypeScript
- **Build Tool**: Vite with vite-plugin-solid
- **Desktop Runtime**: Tauri 2.x
- **Styling**: Plain CSS with CSS variables for theming
- **Plugins**: Various Tauri plugins for system integration

## Directory Structure

```
pi-desktop/
├── src/
│   ├── entry.tsx      # Solid.js entry point
│   ├── App.tsx        # Main application component
│   └── styles.css     # Global styles
├── index.html         # HTML shell
├── vite.config.ts     # Vite configuration
├── tsconfig.json      # TypeScript configuration
└── package.json       # Dependencies
```

## Key Components

### App.tsx

The main application component contains:

- **Header**: App header with logo, theme toggle, and settings
- **SessionSidebar**: Lists all Pi sessions with ability to create new ones
- **ChatMessage**: Individual message bubbles for user/assistant/system
- **ChatInput**: Multi-line input with Enter to send, Shift+Enter for newlines
- **TerminalOutput**: Shows command execution output
- **LoadingIndicator**: Animated dots during processing

### State Management

Solid.js signals are used for reactive state:

- `messages`: Array of chat messages
- `sessions`: Array of session metadata
- `activeSessionId`: Currently selected session
- `isLoading`: Loading state indicator
- `terminalOutput`: Terminal output content
- `error`: Current error message if any

## Tauri Integration

The app uses Tauri's IPC mechanism to communicate with the Rust backend. When integrating with the actual Pi CLI:

1. Use `@tauri-apps/plugin-shell` to spawn the pi process
2. Stream stdout/stderr to the terminal output
3. Parse responses and display in chat

## Theming

Dark theme is default. Light theme available via toggle. CSS variables control all colors:

- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`
- `--text-primary`, `--text-secondary`, `--text-muted`
- `--accent-color`, `--border-color`

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck
```

## Future Implementation Areas

1. **Backend Integration**: Connect to actual Pi CLI via Tauri commands
2. **Session Persistence**: Save/load sessions using @tauri-apps/plugin-store
3. **Notifications**: Add system notifications via @tauri-apps/plugin-notification
4. **Window Controls**: Minimize, maximize, close via Tauri window API
5. **File Operations**: Open files in editor, drag-drop support
6. **Settings Panel**: Configure Pi preferences
