import { Link } from "react-router-dom";
import { DOC_MANIFEST, groupByCategory } from "../lib/docs";

export default function Dashboard() {
  const grouped = groupByCategory(DOC_MANIFEST);

  return (
    <div className="page dashboard">
      <h2>Software Development Process Framework</h2>
      <p>
        Browse documentation, generate templates, or configure automation
        workflows for your team.
      </p>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h3>Documentation</h3>
          <p>{DOC_MANIFEST.length} documents available</p>
          <ul>
            {Object.entries(grouped).map(([category, docs]) => (
              <li key={category}>
                <strong>{category}</strong>: {docs.length} docs
              </li>
            ))}
          </ul>
          <Link to="/docs" className="card-link">
            Browse Documentation
          </Link>
        </div>

        <div className="dashboard-card">
          <h3>Templates</h3>
          <p>BRD, Intent Document, Architecture, User Story</p>
          <Link to="/templates" className="card-link">
            Generate Templates
          </Link>
        </div>

        <div className="dashboard-card">
          <h3>Workflows</h3>
          <p>Automation triggers and agent configuration</p>
          <Link to="/workflows" className="card-link">
            Manage Workflows
          </Link>
        </div>
      </div>
    </div>
  );
}
