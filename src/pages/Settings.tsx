export default function Settings() {
  return (
    <div className="page settings">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>General</h3>
        <div className="settings-row">
          <span>Team Name</span>
          <input type="text" placeholder="My Team" disabled />
        </div>
        <div className="settings-row">
          <span>Default Process</span>
          <select disabled>
            <option>Hybrid (Agile)</option>
            <option>Traditional</option>
            <option>AI-Native</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>Documentation</h3>
        <div className="settings-row">
          <span>Docs Directory</span>
          <input type="text" value="./docs" disabled />
        </div>
        <div className="settings-row">
          <span>Auto-refresh</span>
          <select disabled>
            <option>Enabled</option>
            <option>Disabled</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>Agent Configuration</h3>
        <p className="placeholder-note">
          Agent and LLM configuration will be available when the agentic
          documentation framework is connected.
        </p>
      </div>
    </div>
  );
}
