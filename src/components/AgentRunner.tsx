import { useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { runAgent, type AgentType } from "../lib/agent-api";
import { runProjectAgent, triggerSync, listDocuments, type DocumentWithPhase } from "../lib/project-api";
import GitHubFilePicker, { type GitHubFileSelection } from "./GitHubFilePicker";
import { notify } from "../lib/notify";

interface AgentRunnerProps {
  agentType?: string;
  openclawAgent?: string;
  placeholder?: string;
  title?: string;
  description?: string;
  userEmail?: string;
  projectSlug?: string;
  phaseId?: string;
  projectRepoUrl?: string | null;
}

type RunStatus = "idle" | "running" | "completed" | "error";

export default function AgentRunner({
  agentType,
  openclawAgent,
  placeholder,
  title = "Run Agent",
  description = "Describe what you need and the agent will generate it.",
  userEmail,
  projectSlug,
  phaseId,
  projectRepoUrl,
}: AgentRunnerProps) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [error, setError] = useState("");
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<GitHubFileSelection[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<DocumentWithPhase[]>([]);
  const [syncing, setSyncing] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const buildPromptWithContext = useCallback(() => {
    let prompt = input;
    if (selectedFiles.length > 0) {
      const fileList = selectedFiles
        .map((f) => `- ${f.type === "dir" ? "folder" : "file"}: ${f.owner}/${f.repo}/${f.path} (branch: ${f.branch})`)
        .join("\n");
      prompt = `${input}\n\n---\nGitHub context (use these files/folders as source):\n${fileList}`;
    }
    return prompt;
  }, [input, selectedFiles]);

  const fetchLinkedDocs = useCallback(async () => {
    if (!userEmail || !projectSlug) return;
    try {
      const data = await listDocuments(userEmail, projectSlug);
      setLinkedDocs(data.documents);
    } catch {
      // Non-critical — docs still generated, just can't list them
    }
  }, [userEmail, projectSlug]);

  const handleSync = useCallback(async () => {
    if (!userEmail) return;
    setSyncing(true);
    try {
      await triggerSync(userEmail);
    } catch {
      // Sync failure is non-critical
    } finally {
      setSyncing(false);
    }
  }, [userEmail]);

  const handleDone = useCallback(async () => {
    setStatus("completed");
    notify("Agent run complete", `${title} finished generating.`);
    // After agent completes, fetch linked docs and trigger sync
    if (projectSlug && userEmail) {
      await fetchLinkedDocs();
      handleSync();
    }
  }, [projectSlug, userEmail, fetchLinkedDocs, handleSync, title]);

  const handleRun = useCallback(() => {
    if (!input.trim()) return;

    setStatus("running");
    setOutput("");
    setError("");
    setLinkedDocs([]);

    const prompt = buildPromptWithContext();
    const resolvedAgentType = openclawAgent ? "openclaw" : (agentType || "discovery");

    const onMessage = (data: unknown) => {
      const msg = data as Record<string, unknown>;
      // Extract text content from agent messages
      if (msg.type === "assistant" && msg.message) {
        const message = msg.message as { content?: Array<{ type: string; text?: string }> };
        const textParts = message.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        if (textParts) {
          setOutput((prev) => prev + textParts);
        }
      } else if (msg.type === "result") {
        const result = (msg as { result?: string }).result;
        if (result && typeof result === "string") {
          setOutput((prev) => (prev ? prev + "\n\n---\n\n" + result : result));
        }
      }
    };

    const onError = (err: string) => {
      setError(err);
      setStatus("error");
      notify("Agent run failed", err.slice(0, 140));
    };

    // Use project-scoped endpoint when projectSlug is available
    // This auto-links generated docs to the project and records them for sync
    if (projectSlug && userEmail) {
      controllerRef.current = runProjectAgent(
        userEmail,
        projectSlug,
        prompt,
        resolvedAgentType,
        phaseId,
        onMessage,
        handleDone,
        onError,
      );
    } else {
      controllerRef.current = runAgent(
        {
          prompt,
          agentType: resolvedAgentType as AgentType,
          openclawAgent,
          userEmail,
          githubFiles: selectedFiles.length > 0 ? selectedFiles : undefined,
        },
        {
          onMessage,
          onDone: () => {
            setStatus("completed");
            notify("Agent run complete", `${title} finished generating.`);
          },
          onError,
        },
      );
    }
  }, [input, agentType, openclawAgent, userEmail, projectSlug, phaseId, buildPromptWithContext, selectedFiles, handleDone, title]);

  const handleStop = useCallback(() => {
    controllerRef.current?.abort();
    setStatus("idle");
  }, []);

  return (
    <div className="agent-runner">
      <div className="agent-runner-header">
        <h3>{title}</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
          {description}
        </p>
      </div>

      <div className="agent-runner-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder ?? "Describe what you need..."}
          rows={6}
          disabled={status === "running"}
        />

        {/* GitHub file picker toggle */}
        {userEmail && (
          <div className="agent-runner-context">
            <button
              className={`btn btn-sm ${showFilePicker ? "btn-active" : ""}`}
              onClick={() => setShowFilePicker(!showFilePicker)}
              type="button"
            >
              {selectedFiles.length > 0
                ? `GitHub Files (${selectedFiles.length})`
                : "Attach GitHub Files"}
            </button>
            {selectedFiles.length > 0 && !showFilePicker && (
              <span className="agent-context-hint">
                {selectedFiles.map((f) => f.name).join(", ")}
              </span>
            )}
          </div>
        )}

        {showFilePicker && userEmail && (
          <GitHubFilePicker
            userEmail={userEmail}
            projectRepoUrl={projectRepoUrl}
            selectedFiles={selectedFiles}
            onSelectionChange={setSelectedFiles}
          />
        )}

        <div className="agent-runner-actions">
          {status === "running" ? (
            <button className="btn btn-danger" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleRun}
              disabled={!input.trim()}
            >
              Run Agent
            </button>
          )}
          {status === "running" && (
            <span className="agent-status running">Agent is working...</span>
          )}
          {status === "completed" && (
            <span className="agent-status completed">
              Completed
              {syncing && " · Syncing..."}
            </span>
          )}
          {status === "error" && (
            <span className="agent-status error">Error</span>
          )}
        </div>
      </div>

      {error && <div className="agent-error">{error}</div>}

      {/* Generated documents list */}
      {linkedDocs.length > 0 && status === "completed" && (
        <div className="agent-runner-docs">
          <h4>Generated Documents</h4>
          <ul className="agent-doc-list">
            {linkedDocs.map((doc) => (
              <li key={doc.id} className="agent-doc-item">
                <span className="agent-doc-icon">
                  {doc.category === "business" ? "B" :
                   doc.category === "requirements" ? "R" :
                   doc.category === "knowledge" ? "K" :
                   doc.category === "process" ? "P" : "D"}
                </span>
                <div className="agent-doc-info">
                  <span className="agent-doc-title">{doc.title}</span>
                  <span className="agent-doc-meta">
                    {doc.category}
                    {doc.phase_name && ` · ${doc.phase_name}`}
                    {doc.requires_review === 1 && " · Needs Review"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {output && (
        <div className="agent-runner-output">
          <h4>Agent Output</h4>
          <div className="md-viewer">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
