/**
 * Google Cloud Storage helper for Cloudflare Workers
 *
 * Uses service account JWT auth to access GCS JSON API.
 * Docs stored as: gs://sahamati-docs/{project_slug}/{doc_id}.md
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get an access token using service account JWT
 */
async function getAccessToken(keyJson: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const key: ServiceAccountKey = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const payload = btoa(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const signInput = `${header}.${payload}`;

  // Import RSA private key
  const pemBody = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");

  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signInput)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${signInput}.${signature}`;

  // Exchange JWT for access token
  const tokenRes = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`GCS token exchange failed: ${tokenRes.status}`);
  }

  const { access_token, expires_in } = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

/**
 * Upload document content to GCS
 */
export async function uploadDoc(
  keyJson: string,
  bucket: string,
  projectSlug: string,
  docId: string,
  content: string
): Promise<void> {
  const token = await getAccessToken(keyJson);
  const objectName = encodeURIComponent(`${projectSlug}/${docId}.md`);

  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${objectName}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/markdown; charset=utf-8",
      },
      body: content,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GCS upload failed: ${res.status} ${err}`);
  }
}

/**
 * Download document content from GCS
 */
export async function downloadDoc(
  keyJson: string,
  bucket: string,
  projectSlug: string,
  docId: string
): Promise<string | null> {
  const token = await getAccessToken(keyJson);
  const objectName = encodeURIComponent(`${projectSlug}/${docId}.md`);

  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${objectName}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GCS download failed: ${res.status}`);
  }

  return res.text();
}

/**
 * Delete document from GCS
 */
export async function deleteDoc(
  keyJson: string,
  bucket: string,
  projectSlug: string,
  docId: string
): Promise<void> {
  const token = await getAccessToken(keyJson);
  const objectName = encodeURIComponent(`${projectSlug}/${docId}.md`);

  await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${objectName}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}
