import { isValidElement, useEffect, useId, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";
import { useResourceFile } from "../hooks/useFileSystem";

interface Props {
  filePath?: string | null;
  content?: string;
}

/** Tracks the resolved app theme (data-theme on <html>) so diagrams re-render on toggle. */
function useResolvedTheme(): "dark" | "light" {
  const read = () =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const [theme, setTheme] = useState<"dark" | "light">(read);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useResolvedTheme();
  // Mermaid requires a DOM-safe unique id; useId emits ":" which querySelector chokes on.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: "inherit",
    });
    mermaid
      .render(`mermaid-${id}`, chart)
      .then((result) => {
        if (cancelled) return;
        setSvg(result.svg);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSvg(null);
        setError(err instanceof Error ? err.message : String(err));
        // Mermaid leaves its scratch element behind when parsing fails.
        document.getElementById(`dmermaid-${id}`)?.remove();
      });
    return () => {
      cancelled = true;
    };
  }, [chart, theme, id]);

  if (error) {
    return (
      <div className="mermaid-error">
        <p>Diagram failed to render: {error}</p>
        <pre>
          <code>{chart}</code>
        </pre>
      </div>
    );
  }
  if (!svg) {
    return <div className="mermaid-diagram mermaid-loading">Rendering diagram…</div>;
  }
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

/**
 * Shared react-markdown components map. Replaces fenced ```mermaid blocks with
 * rendered diagrams (intercepted at <pre> so no <div> ends up nested inside it).
 */
export const markdownComponents = {
  pre(props: ComponentProps<"pre"> & { node?: unknown }) {
    // `node` is react-markdown's AST node — don't leak it onto the DOM element.
    const { children, node: _node, ...rest } = props;
    const child = Array.isArray(children) ? children[0] : children;
    if (
      isValidElement<{ className?: string; children?: ReactNode }>(child) &&
      /\blanguage-mermaid\b/.test(child.props.className ?? "")
    ) {
      return <MermaidDiagram chart={extractText(child.props.children).trim()} />;
    }
    return <pre {...rest}>{children}</pre>;
  },
};

export default function MarkdownViewer({ filePath, content: directContent }: Props) {
  const { content: fileContent, loading, error } = useResourceFile(filePath ?? null);

  // If direct content is provided, render it immediately
  if (directContent !== undefined) {
    return (
      <article className="md-viewer">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {directContent}
        </ReactMarkdown>
      </article>
    );
  }

  if (!filePath) {
    return <div className="md-viewer-empty">Select a document to view.</div>;
  }
  if (loading) {
    return <div className="md-viewer-loading">Loading...</div>;
  }
  if (error) {
    return <div className="md-viewer-error">Error loading file: {error}</div>;
  }

  return (
    <article className="md-viewer">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {fileContent ?? ""}
      </ReactMarkdown>
    </article>
  );
}
