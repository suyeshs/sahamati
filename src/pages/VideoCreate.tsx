import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  listTemplates,
  generateVideo,
  generateScript,
  getVideoStatus,
  getVideoLogs,
  getVideoDownloadUrl,
  type MarketingTemplate,
  type VideoScene,
  type GenerationLog,
  type AspectRatio,
  type VideoDuration,
} from "../lib/video-api";
import { notify } from "../lib/notify";

type Tab = "templates" | "scriptwriter" | "custom";

export default function VideoCreate() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("templates");
  const [templates, setTemplates] = useState<MarketingTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Template mode state
  const [selectedTemplate, setSelectedTemplate] = useState<MarketingTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string | number>>({});

  // Scriptwriter mode state
  const [brief, setBrief] = useState("");
  const [scriptResult, setScriptResult] = useState<any>(null);
  const [scriptLoading, setScriptLoading] = useState(false);

  // Custom mode state
  const [customPrompt, setCustomPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState<VideoDuration>(8);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generationVideoId, setGenerationVideoId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationLogs, setGenerationLogs] = useState<GenerationLog[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationComplete, setGenerationComplete] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listTemplates().then(setTemplates).finally(() => setLoading(false));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generationLogs]);

  const startPolling = (videoId: string) => {
    let lastLogId = 0;

    pollRef.current = setInterval(async () => {
      try {
        const [status, logsData] = await Promise.all([
          getVideoStatus(videoId),
          getVideoLogs(videoId, lastLogId),
        ]);

        if (logsData.logs.length > 0) {
          setGenerationLogs((prev) => [...prev, ...logsData.logs]);
          lastLogId = logsData.lastId;
        }

        setGenerationProgress(status.progress || 0);

        if (status.video.status === "completed") {
          setGenerationComplete(true);
          setGenerating(false);
          notify("Video ready", "Your video generation finished.");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (status.video.status === "failed") {
          setGenerationError(status.video.error || "Generation failed");
          setGenerating(false);
          notify("Video generation failed", status.video.error || "Generation failed");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
  };

  const handleGenerateFromTemplate = async () => {
    if (!selectedTemplate) return;
    setGenerating(true);
    setGenerationError(null);
    setGenerationLogs([]);
    setGenerationComplete(false);

    try {
      if (selectedTemplate.isMultiScene && selectedTemplate.scenes) {
        const scenes: VideoScene[] = selectedTemplate.scenes.map((s, i) => ({
          id: `scene-${i + 1}`,
          prompt: s.prompt,
          duration: s.duration,
        }));

        const result = await generateVideo({
          scenes,
          aspectRatio: selectedTemplate.suggestedAspectRatio,
          outputPreset: selectedTemplate.suggestedAspectRatio === "9:16" ? "social-reel" : "youtube",
          transition: { type: "crossfade", duration: 0.5 },
        });

        setGenerationVideoId(result.videoId);
        startPolling(result.videoId);
      } else {
        const result = await generateVideo({
          templateId: selectedTemplate.id,
          templateVariables: templateVars,
          aspectRatio: selectedTemplate.suggestedAspectRatio,
          duration: selectedTemplate.suggestedDuration,
        });

        setGenerationVideoId(result.videoId);
        startPolling(result.videoId);
      }
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Failed to start generation");
      setGenerating(false);
    }
  };

  const handleGenerateScript = async () => {
    if (!brief.trim()) return;
    setScriptLoading(true);
    setScriptResult(null);

    try {
      const result = await generateScript(brief);
      setScriptResult(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Scriptwriter failed");
    } finally {
      setScriptLoading(false);
    }
  };

  const handleGenerateFromScript = async () => {
    if (!scriptResult) return;
    setGenerating(true);
    setGenerationError(null);
    setGenerationLogs([]);
    setGenerationComplete(false);

    try {
      const scenes: VideoScene[] = scriptResult.veoPrompts.map((vp: any, i: number) => ({
        id: `scene-${i + 1}`,
        prompt: vp.prompt,
        duration: vp.duration,
        negativePrompt: vp.negativePrompt,
      }));

      const result = await generateVideo({
        scenes,
        aspectRatio: "16:9",
        outputPreset: "youtube",
        transition: { type: "crossfade", duration: 0.5 },
      });

      setGenerationVideoId(result.videoId);
      startPolling(result.videoId);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Failed to start generation");
      setGenerating(false);
    }
  };

  const handleGenerateCustom = async () => {
    if (!customPrompt.trim()) return;
    setGenerating(true);
    setGenerationError(null);
    setGenerationLogs([]);
    setGenerationComplete(false);

    try {
      const result = await generateVideo({
        prompt: customPrompt,
        aspectRatio,
        duration,
      });

      setGenerationVideoId(result.videoId);
      startPolling(result.videoId);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Failed to start generation");
      setGenerating(false);
    }
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case "thinking": return "...";
      case "action": return ">";
      case "success": return "+";
      case "error": return "x";
      default: return "i";
    }
  };

  // ---- Generation in progress / complete UI ----
  if (generating || generationComplete) {
    return (
      <div style={{ padding: "2rem", maxWidth: "700px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
          {generationComplete ? "Video Ready!" : "Generating Video..."}
        </h1>

        {/* Progress bar */}
        <div style={{
          height: "8px",
          borderRadius: "4px",
          background: "var(--bg-secondary, #e5e5e5)",
          marginBottom: "1.5rem",
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${generationComplete ? 100 : generationProgress}%`,
            background: generationComplete ? "var(--success, #22c55e)" : "var(--accent)",
            borderRadius: "4px",
            transition: "width 0.5s ease",
          }} />
        </div>

        {generationError && (
          <div style={{
            padding: "1rem",
            background: "var(--danger-bg, #fef2f2)",
            borderRadius: "var(--radius)",
            color: "var(--danger, #ef4444)",
            marginBottom: "1rem",
          }}>
            {generationError}
          </div>
        )}

        {/* Logs */}
        <div style={{
          background: "var(--bg-secondary, #111)",
          borderRadius: "var(--radius)",
          padding: "1rem",
          maxHeight: "400px",
          overflowY: "auto",
          fontFamily: "monospace",
          fontSize: "0.8rem",
          lineHeight: "1.6",
          marginBottom: "1.5rem",
        }}>
          {generationLogs.map((log) => (
            <div key={log.id} style={{
              color: log.level === "error" ? "var(--danger, #ef4444)"
                : log.level === "success" ? "var(--success, #22c55e)"
                : log.level === "thinking" ? "var(--text-muted)"
                : "var(--text)",
            }}>
              [{getLogIcon(log.level)}] {log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "1rem" }}>
          {generationComplete && generationVideoId && (
            <a
              href={getVideoDownloadUrl(generationVideoId)}
              className="btn btn-primary"
              style={{ textDecoration: "none" }}
            >
              Download Video
            </a>
          )}
          <button className="btn" onClick={() => navigate("/videos")}>
            {generationComplete ? "Back to Gallery" : "View Gallery"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Main creation UI ----
  return (
    <div style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Create Marketing Video</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Generate AI-powered videos for the Sahamati Account Aggregator ecosystem
      </p>

      {/* Tabs */}
      <div style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1.5rem",
        borderBottom: "2px solid var(--border, #e5e5e5)",
        paddingBottom: "0.5rem",
      }}>
        {(["templates", "scriptwriter", "custom"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="btn"
            style={{
              borderRadius: "var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0",
              fontWeight: tab === t ? 700 : 400,
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              background: tab === t ? "var(--bg)" : "transparent",
            }}
          >
            {t === "templates" ? "Templates" : t === "scriptwriter" ? "AI Scriptwriter" : "Custom Prompt"}
          </button>
        ))}
      </div>

      {/* Templates Tab */}
      {tab === "templates" && (
        <div>
          {loading ? (
            <p>Loading templates...</p>
          ) : selectedTemplate ? (
            <div>
              <button className="btn" onClick={() => setSelectedTemplate(null)} style={{ marginBottom: "1rem" }}>
                &larr; Back to Templates
              </button>

              <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", boxShadow: "var(--neu-raised)", padding: "1.5rem" }}>
                <h2 style={{ fontSize: "1.2rem", margin: "0 0 0.5rem" }}>{selectedTemplate.name}</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
                  {selectedTemplate.description}
                </p>
                <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  <span>{selectedTemplate.suggestedAspectRatio}</span>
                  <span>{selectedTemplate.isMultiScene ? `${selectedTemplate.scenes?.length} scenes` : `${selectedTemplate.suggestedDuration}s`}</span>
                  <span>{selectedTemplate.category}</span>
                </div>

                {/* Template variables */}
                {selectedTemplate.variables.map((v) => (
                  <div key={v.name} style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                      {v.label} {v.required && <span style={{ color: "var(--danger, #ef4444)" }}>*</span>}
                    </label>
                    {v.type === "select" ? (
                      <select
                        value={String(templateVars[v.name] ?? v.defaultValue ?? "")}
                        onChange={(e) => setTemplateVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                        style={{ width: "100%", padding: "0.5rem", borderRadius: "var(--radius-sm, 4px)", border: "1px solid var(--border, #ccc)", background: "var(--bg)", color: "var(--text)" }}
                      >
                        {v.options?.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={v.type === "number" ? "number" : "text"}
                        placeholder={v.placeholder}
                        value={String(templateVars[v.name] ?? v.defaultValue ?? "")}
                        onChange={(e) => setTemplateVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                        style={{ width: "100%", padding: "0.5rem", borderRadius: "var(--radius-sm, 4px)", border: "1px solid var(--border, #ccc)", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
                      />
                    )}
                  </div>
                ))}

                {/* Multi-scene preview */}
                {selectedTemplate.isMultiScene && selectedTemplate.scenes && (
                  <div style={{ marginBottom: "1rem" }}>
                    <h3 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Scenes</h3>
                    {selectedTemplate.scenes.map((scene, i) => (
                      <div key={i} style={{
                        padding: "0.75rem",
                        background: "var(--bg-secondary, #f5f5f5)",
                        borderRadius: "var(--radius-sm, 4px)",
                        marginBottom: "0.5rem",
                        fontSize: "0.8rem",
                      }}>
                        <strong>{scene.description}</strong>
                        <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>({scene.duration}s)</span>
                      </div>
                    ))}
                  </div>
                )}

                <button className="btn btn-primary" onClick={handleGenerateFromTemplate} style={{ width: "100%", padding: "0.75rem" }}>
                  Generate Video
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTemplate(t); setTemplateVars({}); }}
                  style={{
                    textAlign: "left",
                    padding: "1.25rem",
                    background: "var(--bg)",
                    borderRadius: "var(--radius)",
                    boxShadow: "var(--neu-raised)",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text)",
                    transition: "transform 0.1s",
                  }}
                >
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{t.name}</h3>
                  <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {t.description}
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.7rem" }}>
                    <span style={{ padding: "0.15rem 0.5rem", borderRadius: "2px", background: "var(--bg-secondary, #e5e5e5)" }}>
                      {t.suggestedAspectRatio}
                    </span>
                    <span style={{ padding: "0.15rem 0.5rem", borderRadius: "2px", background: "var(--bg-secondary, #e5e5e5)" }}>
                      {t.isMultiScene ? `${t.scenes?.length} scenes` : `${t.suggestedDuration}s`}
                    </span>
                    <span style={{ padding: "0.15rem 0.5rem", borderRadius: "2px", background: "var(--bg-secondary, #e5e5e5)" }}>
                      {t.category}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scriptwriter Tab */}
      {tab === "scriptwriter" && (
        <div>
          <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", boxShadow: "var(--neu-raised)", padding: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>AI Scriptwriter</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
              Describe your video idea in plain English. The AI will generate a complete multi-scene script.
            </p>

            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="E.g., Create a 30-second video showing how a small kirana shop owner in Mumbai used Account Aggregator to get a business loan quickly. Show the contrast between old paperwork and new digital process."
              rows={5}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "var(--radius-sm, 4px)",
                border: "1px solid var(--border, #ccc)",
                background: "var(--bg)",
                color: "var(--text)",
                resize: "vertical",
                fontSize: "0.9rem",
                boxSizing: "border-box",
              }}
            />

            <button
              className="btn btn-primary"
              onClick={handleGenerateScript}
              disabled={scriptLoading || !brief.trim()}
              style={{ marginTop: "1rem", width: "100%", padding: "0.75rem" }}
            >
              {scriptLoading ? "Generating Script..." : "Generate Script"}
            </button>
          </div>

          {/* Script result */}
          {scriptResult && (
            <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", boxShadow: "var(--neu-raised)", padding: "1.5rem", marginTop: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>{scriptResult.script.title}</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
                {scriptResult.analysis.briefSummary}
              </p>

              {/* Suggestions */}
              {scriptResult.analysis.suggestedImprovements.length > 0 && (
                <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--bg-secondary, #f5f5f5)", borderRadius: "var(--radius-sm, 4px)", fontSize: "0.8rem" }}>
                  <strong>AI Suggestions:</strong>
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                    {scriptResult.analysis.suggestedImprovements.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Scenes */}
              <div style={{ marginBottom: "1rem" }}>
                <h4 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>
                  {scriptResult.script.scenes.length} Scenes ({scriptResult.script.totalDuration}s total)
                </h4>
                {scriptResult.script.scenes.map((scene: any) => (
                  <div key={scene.sceneNumber} style={{
                    padding: "0.75rem",
                    background: "var(--bg-secondary, #f5f5f5)",
                    borderRadius: "var(--radius-sm, 4px)",
                    marginBottom: "0.5rem",
                    fontSize: "0.8rem",
                  }}>
                    <strong>Scene {scene.sceneNumber}: {scene.cinematography}</strong>
                    <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>({scene.duration}s)</span>
                    <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)" }}>{scene.description}</p>
                    {scene.dialogue && (
                      <p style={{ margin: "0.25rem 0 0", fontStyle: "italic" }}>
                        {scene.dialogue.speaker}: "{scene.dialogue.text}"
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Character */}
              <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--bg-secondary, #f5f5f5)", borderRadius: "var(--radius-sm, 4px)", fontSize: "0.8rem" }}>
                <strong>Character:</strong> {scriptResult.script.characterProfile.name} - {scriptResult.script.characterProfile.description}
              </div>

              <button className="btn btn-primary" onClick={handleGenerateFromScript} style={{ width: "100%", padding: "0.75rem" }}>
                Generate Video from Script
              </button>
            </div>
          )}
        </div>
      )}

      {/* Custom Tab */}
      {tab === "custom" && (
        <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", boxShadow: "var(--neu-raised)", padding: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", margin: "0 0 1rem" }}>Custom Prompt</h2>

          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Describe the video you want to generate..."
            rows={4}
            style={{
              width: "100%",
              padding: "0.75rem",
              borderRadius: "var(--radius-sm, 4px)",
              border: "1px solid var(--border, #ccc)",
              background: "var(--bg)",
              color: "var(--text)",
              resize: "vertical",
              fontSize: "0.9rem",
              boxSizing: "border-box",
            }}
          />

          <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "var(--radius-sm, 4px)", border: "1px solid var(--border, #ccc)", background: "var(--bg)", color: "var(--text)" }}
              >
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait/Reel)</option>
                <option value="1:1">1:1 (Square)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                Duration
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as VideoDuration)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "var(--radius-sm, 4px)", border: "1px solid var(--border, #ccc)", background: "var(--bg)", color: "var(--text)" }}
              >
                <option value={4}>4 seconds</option>
                <option value={5}>5 seconds</option>
                <option value={6}>6 seconds</option>
                <option value={7}>7 seconds</option>
                <option value={8}>8 seconds</option>
              </select>
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleGenerateCustom}
            disabled={!customPrompt.trim()}
            style={{ marginTop: "1rem", width: "100%", padding: "0.75rem" }}
          >
            Generate Video
          </button>
        </div>
      )}
    </div>
  );
}
