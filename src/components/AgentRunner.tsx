import { useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { runAgent, type AgentType } from "../lib/agent-api";

interface AgentRunnerProps {
  agentType?: AgentType;
  placeholder?: string;
  title: string;
  description: string;
  userEmail?: string;
}

type RunStatus = "idle" | "running" | "completed" | "error";

export default function AgentRunner({
  agentType,
  placeholder,
  title,
  description,
  userEmail,
}: AgentRunnerProps) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const handleRun = useCallback(() => {
    if (!input.trim()) return;

    setStatus("running");
    setOutput("");
    setError("");

    controllerRef.current = runAgent(
      { prompt: input, agentType, userEmail },
      {
        onMessage: (data) => {
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
        },
        onDone: () => setStatus("completed"),
        onError: (err) => {
          setError(err);
          setStatus("error");
        },
      }
    );
  }, [input, agentType, userEmail]);

  const handleStop = useCallback(() => {
    controllerRef.current?.abort();
    setStatus("idle");
  }, []);

  return (
    <div className="agent-runner">
      <div className="agent-runner-header">
        <h3>{title}</h3>
        <p style={{ fontSize: "0.85rem", color: "#666", margin: "0.25rem 0 0" }}>
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
            <span className="agent-status completed">Completed</span>
          )}
          {status === "error" && (
            <span className="agent-status error">Error</span>
          )}
        </div>
      </div>

      {error && <div className="agent-error">{error}</div>}

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
