import { useState, useEffect, useCallback } from "react";
import {
  listOpenClawAgents,
  getOpenClawAgent,
  createOpenClawAgent,
  updateOpenClawAgent,
  deleteOpenClawAgent,
  listAgentSkills,
  installCustomSkill,
  removeAgentSkill,
  getSkillContent,
  updateSkillContent,
  searchClawHubSkills,
  installSkillFromClawHub,
  type OpenClawAgentSummary,
  type OpenClawAgentConfig,
  type SkillInfo,
  type ClawHubSkill,
} from "../lib/agent-api";
import AgentRunner from "../components/AgentRunner";

type Tab = "soul" | "tools" | "identity" | "skills" | "config" | "run";
type View = "list" | "create" | "edit";

const LLM_PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "deepseek", label: "DeepSeek" },
];

const MODELS_BY_PROVIDER: Record<string, Array<{ value: string; label: string }>> = {
  anthropic: [
    { value: "sonnet", label: "Claude Sonnet" },
    { value: "opus", label: "Claude Opus" },
    { value: "haiku", label: "Claude Haiku" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat" },
    { value: "deepseek-coder", label: "DeepSeek Coder" },
  ],
};

export default function AgentStudio() {
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<OpenClawAgentConfig | null>(null);
  const [view, setView] = useState<View>("list");
  const [activeTab, setActiveTab] = useState<Tab>("soul");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: "",
    displayName: "",
    description: "",
    soul: "",
    tools: "",
    identity: "",
    llmProvider: "anthropic",
    llmModel: "sonnet",
  });

  // Edit state
  const [editState, setEditState] = useState({
    soul: "",
    tools: "",
    identity: "",
    heartbeat: "",
    llmProvider: "",
    llmModel: "",
  });

  // Skills state
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [clawHubQuery, setClawHubQuery] = useState("");
  const [clawHubResults, setClawHubResults] = useState<ClawHubSkill[]>([]);
  const [searchingSkills, setSearchingSkills] = useState(false);
  const [showNewSkillForm, setShowNewSkillForm] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [editingSkill, setEditingSkill] = useState<{ filename: string; content: string } | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const list = await listOpenClawAgents();
      setAgents(list);
    } catch {
      setError("Failed to load agents");
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleSelectAgent = async (name: string) => {
    setLoading(true);
    setError("");
    try {
      const agent = await getOpenClawAgent(name);
      setSelectedAgent(agent);
      setEditState({
        soul: agent.soul,
        tools: agent.tools,
        identity: agent.identity,
        heartbeat: agent.heartbeat ?? "",
        llmProvider: agent.llmProvider,
        llmModel: agent.llmModel,
      });
      setView("edit");
      setActiveTab("soul");
      const agentSkills = await listAgentSkills(name);
      setSkills(agentSkills);
    } catch {
      setError("Failed to load agent");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim() || !createForm.displayName.trim()) {
      setError("Name and display name are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createOpenClawAgent(createForm);
      setCreateForm({
        name: "",
        displayName: "",
        description: "",
        soul: "",
        tools: "",
        identity: "",
        llmProvider: "anthropic",
        llmModel: "sonnet",
      });
      setView("list");
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateOpenClawAgent(selectedAgent.name, editState);
      setSelectedAgent(updated);
      await loadAgents();
    } catch {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedAgent || !confirm(`Delete agent "${selectedAgent.name}"? This cannot be undone.`)) return;
    try {
      await deleteOpenClawAgent(selectedAgent.name);
      setSelectedAgent(null);
      setView("list");
      await loadAgents();
    } catch {
      setError("Failed to delete agent");
    }
  };

  const handleSearchClawHub = async () => {
    if (!clawHubQuery.trim()) return;
    setSearchingSkills(true);
    try {
      const results = await searchClawHubSkills(clawHubQuery);
      setClawHubResults(results);
    } catch {
      setClawHubResults([]);
    } finally {
      setSearchingSkills(false);
    }
  };

  const handleInstallClawHubSkill = async (skill: ClawHubSkill) => {
    if (!selectedAgent) return;
    try {
      await installSkillFromClawHub(selectedAgent.name, skill.id);
      const updated = await listAgentSkills(selectedAgent.name);
      setSkills(updated);
    } catch {
      setError("Failed to install skill");
    }
  };

  const handleRemoveSkill = async (filename: string) => {
    if (!selectedAgent) return;
    try {
      await removeAgentSkill(selectedAgent.name, filename);
      setSkills(skills.filter((s) => s.filename !== filename));
    } catch {
      setError("Failed to remove skill");
    }
  };

  const handleInstallCustomSkill = async () => {
    if (!selectedAgent || !newSkillName.trim()) return;
    const name = newSkillName.trim().replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const content = `---\nname: "${name}"\ndescription: "Custom skill"\n---\n\n# ${name}\n\nDescribe what this skill does and how the agent should use it.\n`;
    try {
      await installCustomSkill(selectedAgent.name, name, content);
      const updated = await listAgentSkills(selectedAgent.name);
      setSkills(updated);
      setNewSkillName("");
      setShowNewSkillForm(false);
      // Open the skill editor immediately so user can edit content
      setEditingSkill({ filename: `SKILL-${name}.md`, content });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create skill");
    }
  };

  const handleSaveSkillContent = async () => {
    if (!selectedAgent || !editingSkill) return;
    try {
      await updateSkillContent(selectedAgent.name, editingSkill.filename, editingSkill.content);
      const updated = await listAgentSkills(selectedAgent.name);
      setSkills(updated);
      setEditingSkill(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save skill");
    }
  };

  const handleEditSkill = async (filename: string) => {
    if (!selectedAgent) return;
    try {
      const content = await getSkillContent(selectedAgent.name, filename);
      setEditingSkill({ filename, content });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skill content");
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Agent Studio</h2>
        <p className="page-subtitle">Create and manage your AI agents using OpenClaw format</p>
      </div>

      {error && (
        <div className="agent-error" style={{ marginBottom: "1rem" }}>
          {error}
          <button onClick={() => setError("")} style={{ marginLeft: "0.5rem", background: "none", border: "none", cursor: "pointer" }}>
            x
          </button>
        </div>
      )}

      <div className="agent-studio-layout">
        {/* Left panel: agent list */}
        <div className="agent-studio-sidebar">
          <button className="btn btn-primary" style={{ width: "100%", marginBottom: "1rem" }} onClick={() => setView("create")}>
            + Create Agent
          </button>

          <div className="agent-list">
            {agents.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "1rem" }}>
                No agents yet. Create your first one!
              </p>
            )}
            {agents.map((a) => (
              <div
                key={a.name}
                className={`agent-list-item ${selectedAgent?.name === a.name ? "active" : ""}`}
                onClick={() => handleSelectAgent(a.name)}
              >
                <div className="agent-list-item-name">{a.displayName}</div>
                <div className="agent-list-item-meta">
                  {a.llmProvider} / {a.llmModel} &middot; {a.skillCount} skills
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main panel */}
        <div className="agent-studio-main">
          {view === "list" && (
            <div className="agent-studio-welcome">
              <h3>Welcome to Agent Studio</h3>
              <p>Select an agent from the sidebar to edit, or create a new one.</p>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Agents use the OpenClaw format: <strong>SOUL.md</strong> defines purpose,{" "}
                <strong>TOOLS.md</strong> defines capabilities, and <strong>IDENTITY.md</strong> sets personality.
              </p>
            </div>
          )}

          {view === "create" && (
            <div className="agent-studio-form">
              <h3>Create New Agent</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Agent ID (slug)</label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="my-agent"
                  />
                </div>
                <div className="form-group">
                  <label>Display Name</label>
                  <input
                    type="text"
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                    placeholder="My Agent"
                  />
                </div>
                <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                  <label>Description</label>
                  <input
                    type="text"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    placeholder="What does this agent do?"
                  />
                </div>
                <div className="form-group">
                  <label>LLM Provider</label>
                  <select
                    value={createForm.llmProvider}
                    onChange={(e) => setCreateForm({ ...createForm, llmProvider: e.target.value, llmModel: MODELS_BY_PROVIDER[e.target.value]?.[0]?.value ?? "" })}
                  >
                    {LLM_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Model</label>
                  <select
                    value={createForm.llmModel}
                    onChange={(e) => setCreateForm({ ...createForm, llmModel: e.target.value })}
                  >
                    {(MODELS_BY_PROVIDER[createForm.llmProvider] ?? []).map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                  <label>Soul (purpose & behavior)</label>
                  <textarea
                    value={createForm.soul}
                    onChange={(e) => setCreateForm({ ...createForm, soul: e.target.value })}
                    placeholder="Describe the agent's purpose, expertise, and behavior..."
                    rows={6}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
                  {saving ? "Creating..." : "Create Agent"}
                </button>
                <button className="btn" onClick={() => setView("list")}>Cancel</button>
              </div>
            </div>
          )}

          {view === "edit" && selectedAgent && (
            <>
              <div className="agent-editor-header">
                <h3>{agents.find((a) => a.name === selectedAgent.name)?.displayName ?? selectedAgent.name}</h3>
                <div className="agent-editor-actions">
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
                </div>
              </div>

              <div className="agent-editor-tabs">
                {(["soul", "tools", "identity", "skills", "config", "run"] as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    className={`agent-tab ${activeTab === tab ? "active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              <div className="agent-editor-content">
                {activeTab === "soul" && (
                  <div className="form-group">
                    <label>SOUL.md - Agent purpose, expertise, and behavior</label>
                    <textarea
                      value={editState.soul}
                      onChange={(e) => setEditState({ ...editState, soul: e.target.value })}
                      rows={20}
                      className="code-editor"
                    />
                  </div>
                )}

                {activeTab === "tools" && (
                  <div className="form-group">
                    <label>TOOLS.md - Agent capabilities and allowed tools</label>
                    <textarea
                      value={editState.tools}
                      onChange={(e) => setEditState({ ...editState, tools: e.target.value })}
                      rows={20}
                      className="code-editor"
                    />
                  </div>
                )}

                {activeTab === "identity" && (
                  <div className="form-group">
                    <label>IDENTITY.md - Personality and communication style</label>
                    <textarea
                      value={editState.identity}
                      onChange={(e) => setEditState({ ...editState, identity: e.target.value })}
                      rows={20}
                      className="code-editor"
                    />
                  </div>
                )}

                {activeTab === "skills" && (
                  <div className="skills-panel">
                    {/* Skill editor overlay */}
                    {editingSkill && (
                      <div className="skills-section" style={{ marginBottom: "1.5rem", padding: "1rem", border: "1px solid var(--border-color)", borderRadius: "0.5rem", background: "var(--bg-secondary, #1a1a2e)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                          <h4 style={{ margin: 0 }}>Editing: {editingSkill.filename}</h4>
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button className="btn btn-primary btn-sm" onClick={handleSaveSkillContent}>Save</button>
                            <button className="btn btn-sm" onClick={() => setEditingSkill(null)}>Close</button>
                          </div>
                        </div>
                        <textarea
                          value={editingSkill.content}
                          onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                          rows={14}
                          className="code-editor"
                          style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }}
                        />
                      </div>
                    )}

                    <div className="skills-section">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h4>Installed Skills ({skills.length})</h4>
                        <button className="btn" onClick={() => setShowNewSkillForm(!showNewSkillForm)}>+ Custom Skill</button>
                      </div>

                      {showNewSkillForm && (
                        <div style={{ display: "flex", gap: "0.5rem", margin: "0.75rem 0" }}>
                          <input
                            type="text"
                            value={newSkillName}
                            onChange={(e) => setNewSkillName(e.target.value)}
                            placeholder="Skill name (e.g., code-review)"
                            onKeyDown={(e) => e.key === "Enter" && handleInstallCustomSkill()}
                            autoFocus
                            style={{ flex: 1 }}
                          />
                          <button className="btn btn-primary" onClick={handleInstallCustomSkill} disabled={!newSkillName.trim()}>
                            Create
                          </button>
                          <button className="btn" onClick={() => { setShowNewSkillForm(false); setNewSkillName(""); }}>
                            Cancel
                          </button>
                        </div>
                      )}

                      {skills.length === 0 ? (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>No skills installed.</p>
                      ) : (
                        <div className="skills-list">
                          {skills.map((s) => (
                            <div key={s.filename} className="skill-item">
                              <div>
                                <strong>{s.name}</strong>
                                {s.description && <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>{s.description}</span>}
                              </div>
                              <div style={{ display: "flex", gap: "0.5rem" }}>
                                <button className="btn btn-sm" onClick={() => handleEditSkill(s.filename)}>Edit</button>
                                <button className="btn btn-danger btn-sm" onClick={() => handleRemoveSkill(s.filename)}>Remove</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="skills-section" style={{ marginTop: "1.5rem" }}>
                      <h4>Browse ClawHub</h4>
                      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
                        Search for community skills or browse the built-in catalog
                      </p>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <input
                          type="text"
                          value={clawHubQuery}
                          onChange={(e) => setClawHubQuery(e.target.value)}
                          placeholder="Search skills (e.g., code, test, debug)..."
                          onKeyDown={(e) => e.key === "Enter" && handleSearchClawHub()}
                        />
                        <button className="btn btn-primary" onClick={handleSearchClawHub} disabled={searchingSkills}>
                          {searchingSkills ? "..." : "Search"}
                        </button>
                      </div>
                      {clawHubResults.length > 0 && (
                        <div className="skills-list" style={{ marginTop: "0.75rem" }}>
                          {clawHubResults.map((s) => (
                            <div key={s.id} className="skill-item">
                              <div>
                                <strong>{s.name}</strong>
                                <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                                  by {s.author} {s.downloads > 0 && <>&middot; {s.downloads} downloads</>}
                                </span>
                                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>{s.description}</p>
                              </div>
                              <button className="btn btn-primary btn-sm" onClick={() => handleInstallClawHubSkill(s)}>Install</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "config" && (
                  <div className="form-grid">
                    <div className="form-group">
                      <label>LLM Provider</label>
                      <select
                        value={editState.llmProvider}
                        onChange={(e) =>
                          setEditState({
                            ...editState,
                            llmProvider: e.target.value,
                            llmModel: MODELS_BY_PROVIDER[e.target.value]?.[0]?.value ?? editState.llmModel,
                          })
                        }
                      >
                        {LLM_PROVIDERS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Model</label>
                      <select
                        value={editState.llmModel}
                        onChange={(e) => setEditState({ ...editState, llmModel: e.target.value })}
                      >
                        {(MODELS_BY_PROVIDER[editState.llmProvider] ?? []).map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                      <label>HEARTBEAT.md - Scheduled tasks (optional)</label>
                      <textarea
                        value={editState.heartbeat}
                        onChange={(e) => setEditState({ ...editState, heartbeat: e.target.value })}
                        rows={8}
                        className="code-editor"
                        placeholder="Define scheduled tasks for this agent..."
                      />
                    </div>
                  </div>
                )}

                {activeTab === "run" && (
                  <AgentRunner
                    openclawAgent={selectedAgent.name}
                    title={`Run ${agents.find((a) => a.name === selectedAgent.name)?.displayName ?? selectedAgent.name}`}
                    description="Test your agent with a prompt"
                    placeholder="Enter a prompt to test this agent..."
                  />
                )}
              </div>
            </>
          )}

          {loading && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
              Loading...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
