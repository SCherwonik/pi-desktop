import { createMemo, For, type Component } from "solid-js";
import { diffLines, type Change } from "diff";

interface DiffViewerProps {
  oldText: string;
  newText: string;
}

const DiffViewer: Component<DiffViewerProps> = (props) => {
  const lines = createMemo(() => {
    const changes: Change[] = diffLines(props.oldText, props.newText);
    const result: { type: "added" | "removed" | "context"; lineNo: number; text: string }[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (const change of changes) {
      const parts = change.value.replace(/\n$/, "").split("\n");
      for (const text of parts) {
        if (change.removed) {
          result.push({ type: "removed", lineNo: oldLine++, text });
        } else if (change.added) {
          result.push({ type: "added", lineNo: newLine++, text });
        } else {
          result.push({ type: "context", lineNo: oldLine, text });
          oldLine++;
          newLine++;
        }
      }
    }
    return result;
  });

  return (
    <div class="diff-viewer">
      <For each={lines()}>
        {(line) => (
          <div class={`diff-line ${line.type}`}>
            <span class="diff-prefix">{line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}{line.lineNo}</span>
            <span class="diff-text">{line.text}</span>
          </div>
        )}
      </For>
    </div>
  );
};

export default DiffViewer;
