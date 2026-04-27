import { createMemo, type Component } from "solid-js";
import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

marked.use({
  breaks: false,
  gfm: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      const highlighted = hljs.highlight(text, { language }).value;
      return `<pre class="code-block"><div class="code-lang">${language}</div><code class="hljs language-${language}">${highlighted}</code></pre>`;
    },
  },
});

interface MarkdownProps {
  content: string;
}

const Markdown: Component<MarkdownProps> = (props) => {
  const html = createMemo(() => {
    const raw = marked.parse(props.content, { async: false }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["class"] });
  });

  return (
    <div
      class="markdown-body"
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={html()}
    />
  );
};

export default Markdown;
