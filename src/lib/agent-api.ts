const AGENT_SERVER_URL =
  import.meta.env.VITE_AGENT_SERVER_URL ?? "http://localhost:3001";

export type AgentType = "discovery" | "requirements" | "knowledge" | "process-docs" | "orchestrator";

export interface AgentRunOptions {
  prompt: string;
  agentType?: AgentType;
  sessionId?: string;
  userEmail?: string;
}

export interface AgentEvent {
  id: string;
  event: string;
  data: unknown;
}

export function runAgent(
  options: AgentRunOptions,
  callbacks: {
    onMessage: (data: unknown) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): AbortController {
  const controller = new AbortController();

  fetch(`${AGENT_SERVER_URL}/api/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        callbacks.onError((err as { error: string }).error ?? "Request failed");
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError("No response stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "message";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (currentEvent === "done") {
                callbacks.onDone();
                return;
              } else if (currentEvent === "error") {
                callbacks.onError(
                  (data as { error: string }).error ?? "Agent error"
                );
                return;
              } else {
                callbacks.onMessage(data);
              }
            } catch {
              // Skip non-JSON lines
            }
          }
        }
      }

      callbacks.onDone();
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      callbacks.onError(String(err));
    });

  return controller;
}

export interface GeneratedDoc {
  filename: string;
  category: string;
  path: string;
  title?: string;
  generatedBy?: string;
  date?: string;
  requiresReview?: boolean;
  confidence?: number;
}

export async function listGeneratedDocs(): Promise<GeneratedDoc[]> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/docs/generated`);
  const data = (await res.json()) as { docs: GeneratedDoc[] };
  return data.docs;
}

export async function getGeneratedDoc(
  category: string,
  filename: string
): Promise<{ content: string; path: string }> {
  const res = await fetch(
    `${AGENT_SERVER_URL}/api/docs/generated/${category}/${filename}`
  );
  return res.json();
}

export async function checkHealth(): Promise<{ status: string; agents: string[] }> {
  const res = await fetch(`${AGENT_SERVER_URL}/health`);
  return res.json();
}
