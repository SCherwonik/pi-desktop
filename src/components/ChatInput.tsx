import { Component, createSignal } from "solid-js";

export interface ChatInputProps {
  onSendMessage: (content: string) => void;
  disabled?: boolean;
}

const ChatInput: Component<ChatInputProps> = (props) => {
  const [inputValue, setInputValue] = createSignal("");

  const handleSubmit = () => {
    const content = inputValue().trim();
    if (content && !props.disabled) {
      props.onSendMessage(content);
      setInputValue("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setInputValue(target.value);
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 150) + "px";
  };

  return (
    <div class="chat-input-container">
      <div class="chat-input-wrapper">
        <textarea
          class="chat-input"
          placeholder="Message Pi..."
          value={inputValue()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          disabled={props.disabled}
          rows={1}
        />
        <button
          class="send-btn"
          onClick={handleSubmit}
          disabled={props.disabled || !inputValue().trim()}
          aria-label="Send message"
        >
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
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <p class="chat-input-hint">Press Enter to send, Shift+Enter for new line</p>
    </div>
  );
};

export default ChatInput;
