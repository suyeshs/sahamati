import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  listVideos,
  deleteVideo,
  getVideoThumbnailUrl,
  getVideoDownloadUrl,
  type Video,
} from "../lib/video-api";

function VideoCard({ video }: { video: Video }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const aspectStyle = video.aspectRatio === "9:16" ? "9/16" : video.aspectRatio === "1:1" ? "1/1" : "16/9";

  if (video.status === "completed" && playing) {
    return (
      <div style={{ aspectRatio: aspectStyle, maxHeight: "280px", background: "#000", position: "relative" }}>
        <video
          ref={videoRef}
          src={getVideoDownloadUrl(video.id)}
          controls
          autoPlay
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onEnded={() => setPlaying(false)}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        aspectRatio: aspectStyle,
        maxHeight: "200px",
        background: "var(--bg-secondary, #1a1a1a)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        cursor: video.status === "completed" ? "pointer" : "default",
      }}
      onClick={() => video.status === "completed" && setPlaying(true)}
    >
      {video.status === "completed" && video.thumbnailPath ? (
        <>
          <img
            src={getVideoThumbnailUrl(video.id)}
            alt={video.prompt.substring(0, 50)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {/* Play button overlay */}
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.3)",
            transition: "background 0.2s",
          }}>
            <div style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "rgba(255,255,255,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#000">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </>
      ) : (
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {video.status === "processing" ? "Generating..." : video.status === "failed" ? "Failed" : "Pending"}
        </span>
      )}
    </div>
  );
}

export default function VideoGallery() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadVideos = async () => {
    try {
      setLoading(true);
      const data = await listVideos();
      setVideos(data.videos);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load videos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadVideos(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this video?")) return;
    try {
      await deleteVideo(id);
      setVideos((prev) => prev.filter((v) => v.id !== id));
      setTotal((prev) => prev - 1);
    } catch {
      alert("Failed to delete video");
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "var(--text-muted)",
      processing: "var(--accent)",
      completed: "var(--success, #22c55e)",
      failed: "var(--danger, #ef4444)",
    };
    return (
      <span
        style={{
          display: "inline-block",
          padding: "0.2rem 0.6rem",
          borderRadius: "var(--radius-sm, 4px)",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "#fff",
          background: colors[status] || "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <div className="loading-spinner" />
        <p>Loading videos...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Marketing Videos</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {total} video{total !== 1 ? "s" : ""} generated
          </p>
        </div>
        <Link to="/videos/create" className="btn btn-primary">
          Create Video
        </Link>
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "var(--danger-bg, #fef2f2)", borderRadius: "var(--radius)", marginBottom: "1rem", color: "var(--danger, #ef4444)" }}>
          {error}
        </div>
      )}

      {videos.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "4rem 2rem",
          background: "var(--bg)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--neu-raised)",
        }}>
          <p style={{ fontSize: "1.1rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
            No videos yet. Create your first marketing video!
          </p>
          <Link to="/videos/create" className="btn btn-primary">
            Create Your First Video
          </Link>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "1.5rem",
        }}>
          {videos.map((video) => (
            <div
              key={video.id}
              style={{
                background: "var(--bg)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--neu-raised)",
                overflow: "hidden",
              }}
            >
              {/* Video / Thumbnail */}
              <VideoCard video={video} />

              {/* Info */}
              <div style={{ padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
                  {getStatusBadge(video.status)}
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {video.aspectRatio} | {video.duration}s
                  </span>
                </div>

                <p style={{
                  margin: "0.5rem 0",
                  fontSize: "0.85rem",
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {video.prompt}
                </p>

                <p style={{ margin: "0.25rem 0 0.75rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {new Date(video.createdAt).toLocaleDateString()}
                  {video.metadata?.sceneCount ? ` | ${video.metadata.sceneCount} scenes` : ""}
                </p>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {video.status === "completed" && (
                    <a
                      href={getVideoDownloadUrl(video.id)}
                      className="btn"
                      style={{ flex: 1, fontSize: "0.8rem", padding: "0.4rem", textAlign: "center", textDecoration: "none" }}
                    >
                      Download
                    </a>
                  )}
                  <button
                    className="btn"
                    onClick={() => handleDelete(video.id)}
                    style={{ fontSize: "0.8rem", padding: "0.4rem", color: "var(--danger, #ef4444)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
