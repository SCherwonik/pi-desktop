import { Component, For, Show } from "solid-js";

export interface Session {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
}

const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Sessions</span>
        <button
          class="new-session-btn"
          onClick={props.onNewSession}
          aria-label="New session"
        >
          +
        </button>
      </div>
      <div class="session-list">
        <Show
          when={props.sessions.length > 0}
          fallback={
            <div class="empty-sessions">
              <p>No sessions yet</p>
              <p class="empty-hint">Start a new conversation with Pi</p>
            </div>
          }
        >
          <For each={props.sessions}>
            {(session) => (
              <button
                class={`session-item ${session.id === props.activeSessionId ? "active" : ""}`}
                onClick={() => props.onSelectSession(session.id)}
              >
                <div class="session-icon">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div class="session-info">
                  <div class="session-title">{session.title}</div>
                  <div class="session-meta">
                    <span class="session-date">{formatDate(session.updatedAt)}</span>
                  </div>
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};

export default SessionSidebar;
