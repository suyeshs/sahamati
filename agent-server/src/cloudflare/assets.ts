import { createHash } from "crypto";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep, posix } from "path";
import { accountPath, cfFetch } from "./client.js";

/**
 * Workers Static Assets upload flow:
 *   1. POST /workers/assets/upload-session with a manifest of {path -> hash}
 *   2. Server returns { jwt, buckets } — buckets is an array of arrays of hashes,
 *      each inner array a "bucket" of files to upload together (size-limited).
 *   3. POST /workers/assets/upload (with the JWT) once per non-empty bucket.
 *      Body is multipart: each file's base64 content + its hash as content-id.
 *   4. When all buckets are uploaded the JWT itself is the completion token —
 *      pass it as assets.jwt in the WfP script-upload metadata.
 *
 * Notes:
 *   - Hash is hex SHA-256 of the file content (no path involved).
 *   - Paths in the manifest are POSIX-style starting with "/" (CF requirement).
 *   - Empty bucket lists mean "all files already known", JWT is still the
 *     completion token.
 */

interface UploadSessionResponse {
  jwt: string;
  buckets: string[][];
}

interface DiscoveredFile {
  absPath: string;
  manifestPath: string;       // POSIX-style, leading "/"
  hash: string;
  size: number;
  contentType: string;
}

function walk(dir: string, root: string, acc: DiscoveredFile[] = []): DiscoveredFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, root, acc);
      continue;
    }
    if (!st.isFile()) continue;

    const rel = relative(root, full);
    const manifestPath = "/" + rel.split(sep).join(posix.sep);
    const bytes = readFileSync(full);
    const hash = createHash("sha256").update(bytes).digest("hex");
    acc.push({
      absPath: full,
      manifestPath,
      hash,
      size: st.size,
      contentType: guessContentType(full),
    });
  }
  return acc;
}

function guessContentType(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    txt: "text/plain",
    woff: "font/woff",
    woff2: "font/woff2",
    map: "application/json",
    wasm: "application/wasm",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Upload a directory of static assets and return the completion JWT.
 * Returns null if the directory is empty (no assets to upload).
 */
export async function uploadAssetsDirectory(directory: string): Promise<string | null> {
  const files = walk(directory, directory);
  if (files.length === 0) return null;

  const manifest: Record<string, { hash: string; size: number }> = {};
  for (const f of files) {
    manifest[f.manifestPath] = { hash: f.hash, size: f.size };
  }

  const session = await cfFetch<UploadSessionResponse>(
    accountPath("/workers/assets/upload-session"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest }),
    },
  );

  const filesByHash = new Map(files.map((f) => [f.hash, f]));

  for (const bucket of session.buckets) {
    if (bucket.length === 0) continue;
    await uploadBucket(session.jwt, bucket, filesByHash);
  }

  return session.jwt;
}

async function uploadBucket(
  jwt: string,
  hashes: string[],
  filesByHash: Map<string, DiscoveredFile>,
): Promise<void> {
  const form = new FormData();
  for (const hash of hashes) {
    const file = filesByHash.get(hash);
    if (!file) {
      throw new Error(`upload-session referenced unknown hash ${hash}`);
    }
    const bytes = readFileSync(file.absPath);
    const b64 = Buffer.from(bytes).toString("base64");
    // CF expects each part's name to be the file's hash, with Content-Type
    // header set to the file's actual content type and body base64-encoded.
    const blob = new Blob([b64], { type: file.contentType });
    form.append(hash, blob, hash);
  }

  await cfFetch(accountPath("/workers/assets/upload"), {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
}
