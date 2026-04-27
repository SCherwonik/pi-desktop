import { Component, JSX } from "solid-js";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface ChatMessageProps {
  message: Message;
}

const ChatMessage: Component<ChatMessageProps> = (props) => {
  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getAvatar = (role: string): string => {
    switch (role) {
      case "user":
        return "U";
      case "assistant":
        return "P";
      case "system":
        return "!";
      default:
        return "?";
    }
  };

  const getRoleLabel = (role: string): string => {
    switch (role) {
      case "user":
        return "You";
      case "assistant":
        return "Pi";
      case "system":
        return "System";
      default:
        return role;
    }
  };

  return (
    <div
      class={`message message-${props.message.role === "assistant" ? "assistant" : props.message.role}`}
    >
      <div class="message-avatar">{getAvatar(props.message.role)}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-role">{getRoleLabel(props.message.role)}</span>
          <span class="message-time">{formatTime(props.message.timestamp)}</span>
        </div>
        <div class="message-body">
          <p class="message-text">{props.message.content}</p>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
