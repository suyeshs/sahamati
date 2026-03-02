import { useState } from "react";
import { useParams } from "react-router-dom";
import { DOC_MANIFEST, groupByCategory } from "../lib/docs";
import MarkdownViewer from "../components/MarkdownViewer";

export default function Documentation() {
  const { docPath } = useParams();
  const [selectedPath, setSelectedPath] = useState<string | null>(
    docPath ? decodeURIComponent(docPath) : null
  );
  const grouped = groupByCategory(DOC_MANIFEST);

  return (
    <div className="page documentation">
      <div className="doc-browser">
        <aside className="doc-list">
          <h3>Documents</h3>
          {Object.entries(grouped).map(([category, docs]) => (
            <div key={category} className="doc-category">
              <h4>{category}</h4>
              <ul>
                {docs.map((doc) => (
                  <li key={doc.path}>
                    <button
                      className={`doc-link ${selectedPath === doc.path ? "active" : ""}`}
                      onClick={() => setSelectedPath(doc.path)}
                    >
                      {doc.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
        <div className="doc-content">
          <MarkdownViewer filePath={selectedPath} />
        </div>
      </div>
    </div>
  );
}
