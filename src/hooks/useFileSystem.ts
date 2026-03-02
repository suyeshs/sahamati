import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useResourceFile(relativePath: string | null) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!relativePath) {
      setContent(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const text = await invoke<string>("read_resource_file", {
          path: relativePath,
        });
        if (!cancelled) setContent(text);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relativePath]);

  return { content, loading, error };
}
