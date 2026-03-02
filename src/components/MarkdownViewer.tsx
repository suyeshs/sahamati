import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useResourceFile } from "../hooks/useFileSystem";

interface Props {
  filePath: string | null;
}

export default function MarkdownViewer({ filePath }: Props) {
  const { content, loading, error } = useResourceFile(filePath);

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
        {content ?? ""}
      </ReactMarkdown>
    </article>
  );
}
