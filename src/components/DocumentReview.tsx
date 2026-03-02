import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { listGeneratedDocs, getGeneratedDoc, type GeneratedDoc } from "../lib/agent-api";

export default function DocumentReview() {
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDoc | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listGeneratedDocs()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);

  const handleSelect = async (doc: GeneratedDoc) => {
    setSelectedDoc(doc);
    setLoading(true);
    try {
      const result = await getGeneratedDoc(doc.category, doc.filename);
      setContent(result.content);
    } catch {
      setContent("Failed to load document.");
    }
    setLoading(false);
  };

  const refresh = () => {
    listGeneratedDocs()
      .then(setDocs)
      .catch(() => setDocs([]));
  };

  if (docs.length === 0) {
    return (
      <div className="document-review-empty">
        <p>No generated documents yet. Run an agent workflow to generate documentation.</p>
        <button className="btn btn-secondary" onClick={refresh}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="document-review">
      <div className="document-review-header">
        <h3>Generated Documents</h3>
        <button className="btn btn-secondary" onClick={refresh}>
          Refresh
        </button>
      </div>

      <div className="document-review-list">
        {docs.map((doc) => (
          <div
            key={`${doc.category}/${doc.filename}`}
            className={`document-review-item ${selectedDoc?.filename === doc.filename ? "active" : ""}`}
            onClick={() => handleSelect(doc)}
          >
            <div className="doc-item-info">
              <strong>{doc.title ?? doc.filename}</strong>
              <span className="doc-item-meta">
                {doc.category} &middot; {doc.generatedBy ?? "unknown agent"}
              </span>
            </div>
            <div className="doc-item-badges">
              {doc.requiresReview && (
                <span className="badge badge-review">Needs Review</span>
              )}
              {doc.confidence !== undefined && (
                <span className="badge badge-confidence">
                  {Math.round(doc.confidence * 100)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedDoc && (
        <div className="document-review-content">
          {loading ? (
            <p className="md-viewer-loading">Loading document...</p>
          ) : (
            <div className="md-viewer">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
