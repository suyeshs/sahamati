import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useResourceFile } from "../hooks/useFileSystem";

interface Props {
  filePath?: string | null;
  content?: string;
}

export default function MarkdownViewer({ filePath, content: directContent }: Props) {
  const { content: fileContent, loading, error } = useResourceFile(filePath ?? null);

  // If direct content is provided, render it immediately
  if (directContent !== undefined) {
    return (
      <article className="md-viewer">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {fileContent ?? ""}
      </ReactMarkdown>
    </article>
  );
}
