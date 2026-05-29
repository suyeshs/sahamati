// Shared Vertex AI client for Gemini / Veo calls.
//
// Two auth paths, in priority order:
//   1. KMS-supplied SA JSON (parsed in memory, never on disk) — preferred.
//   2. Application Default Credentials via GOOGLE_APPLICATION_CREDENTIALS
//      pointing at a service-account JSON file on disk — fallback for dev
//      environments without KMS access.
//
// The service account behind either path needs roles/aiplatform.user on the
// configured GOOGLE_CLOUD_PROJECT.

import { GoogleGenAI } from "@google/genai";
import { getVertexSACredentials } from "./secrets-bootstrap.js";

let client: GoogleGenAI | null = null;

export function getGoogleAI(): GoogleGenAI {
  if (client) return client;

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

  if (!project) {
    throw new Error(
      "Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT, " +
        "GOOGLE_CLOUD_LOCATION (defaults to us-central1), and either " +
        "(a) configure KMS_URL/KMS_AUTH_TOKEN so a vertex_sa_json key is " +
        "fetched at startup, or (b) GOOGLE_APPLICATION_CREDENTIALS pointing " +
        "at a service-account JSON with roles/aiplatform.user."
    );
  }

  const kmsCredentials = getVertexSACredentials();
  if (kmsCredentials) {
    // GoogleAuthOptions.credentials expects { client_email, private_key }
    // which the SA JSON satisfies — the cast bridges JSON parsing typing.
    const credentials = kmsCredentials as { client_email: string; private_key: string };
    client = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: { credentials },
    });
  } else {
    client = new GoogleGenAI({ vertexai: true, project, location });
  }

  return client;
}
