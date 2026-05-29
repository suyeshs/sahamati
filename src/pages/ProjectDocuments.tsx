import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useProject } from "../context/ProjectContext";
import { listDocuments, getDocumentContent, type DocumentWithPhase } from "../lib/project-api";
import MarkdownViewer from "../components/MarkdownViewer";

export default function ProjectDocuments() {
  const { user } = useAuth();
  const { project, phases } = useProject();
  const [docs, setDocs] = useState<DocumentWithPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    if (!user?.email || !project?.slug) return;
    setLoading(true);
    listDocuments(user.email, project.slug)
      .then((data) => setDocs(data.documents))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.email, project?.slug]);

  const handleDocClick = async (doc: DocumentWithPhase) => {
    if (!user?.email || !project?.slug) return;
    try {
      const data = await getDocumentContent(user.email, project.slug, doc.id);
      setSelectedDoc({ title: doc.title, content: data.content });
    } catch (err) {
      console.error("Failed to load document:", err);
    }
  };

  // Group docs by phase
  const docsByPhase = new Map<string, DocumentWithPhase[]>();
  const unphased: DocumentWithPhase[] = [];

  for (const doc of docs) {
    if (doc.phase_name) {
      const existing = docsByPhase.get(doc.phase_name) || [];
      existing.push(doc);
      docsByPhase.set(doc.phase_name, existing);
    } else {
      unphased.push(doc);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Loading documents...</p>
      </div>
    );
  }

  return (
    <div className="project-documents">
      <div className="doc-browser">
        <div className="doc-sidebar">
          <h2>Documents</h2>
          {phases.map((phase) => {
            const phaseDocs = docsByPhase.get(phase.name) || [];
            return (
              <div key={phase.id} className="doc-phase-group">
                <h4 className="doc-phase-title">
                  {phase.name}
                  <span className="doc-count">{phaseDocs.length}</span>
                </h4>
                {phaseDocs.length === 0 ? (
                  <p className="text-muted text-small">No documents</p>
                ) : (
                  <ul className="doc-list">
                    {phaseDocs.map((doc) => (
                      <li key={doc.id}>
                        <button
                          className="doc-list-item"
                          onClick={() => handleDocClick(doc)}
                          type="button"
                        >
                          {doc.title}
                          {doc.requires_review === 1 && (
                            <span className="badge badge-warning">Review</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {unphased.length > 0 && (
            <div className="doc-phase-group">
              <h4 className="doc-phase-title">General</h4>
              <ul className="doc-list">
                {unphased.map((doc) => (
                  <li key={doc.id}>
                    <button
                      className="doc-list-item"
                      onClick={() => handleDocClick(doc)}
                      type="button"
                    >
                      {doc.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="doc-content">
          {selectedDoc ? (
            <>
              <h2>{selectedDoc.title}</h2>
              <MarkdownViewer content={selectedDoc.content} />
            </>
          ) : (
            <div className="empty-state">
              <p>Select a document to view its content.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
