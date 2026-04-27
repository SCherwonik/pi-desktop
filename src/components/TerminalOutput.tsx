import { Component, createSignal, Show } from "solid-js";

export interface TerminalOutputProps {
  output: string;
  isVisible?: boolean;
}

interface ParsedLine {
  type: "stdout" | "stderr" | "system";
  content: string;
}

const TerminalOutput: Component<TerminalOutputProps> = (props) => {
  const [isCollapsed, setIsCollapsed] = createSignal(false);

  const parseOutput = (output: string): ParsedLine[] => {
    if (!output) return [];

    return output.split("\n").map((line) => {
      if (line.startsWith("[ERROR]") || line.startsWith("error:") || line.startsWith("Error:")) {
        return { type: "stderr" as const, content: line };
      }
      if (line.startsWith("[SYSTEM]") || line.startsWith("System:")) {
        return { type: "system" as const, content: line };
      }
      return { type: "stdout" as const, content: line };
    });
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed());
  };

  return (
    <Show when={props.output}>
      <div class="terminal-output">
        <div class="terminal-header">
          <span class="terminal-title">Terminal Output</span>
          <button class="terminal-btn" onClick={toggleCollapse}>
            {isCollapsed() ? "Expand" : "Collapse"}
          </button>
        </div>
        <Show when={!isCollapsed()}>
          <pre class="terminal-content">
            {parseOutput(props.output).map((line) => (
              <div class={`terminal-line ${line.type}`}>{line.content}</div>
            ))}
          </pre>
        </Show>
      </div>
    </Show>
  );
};

export default TerminalOutput;
