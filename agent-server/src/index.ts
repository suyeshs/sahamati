import { serve } from "@hono/node-server";
import app from "./server.js";

const port = Number(process.env.PORT ?? 3001);

console.log(`Sahamati Agent Server starting on http://localhost:${port}`);
console.log(`Available agents: discovery, requirements, knowledge`);
console.log(`Health check: http://localhost:${port}/health`);

serve({ fetch: app.fetch, port });
