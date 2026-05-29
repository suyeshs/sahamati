import { z } from "zod";

/**
 * `sahamati.deploy.json` — committed at the root of a Claude-Code-generated app.
 *
 * MVP scope: pre-built artefacts only. `entrypoint` must reference an already-
 * compiled .js / .mjs file (Claude Code Web/IDE compiles before pushing).
 * No build step runs on the agent-server host.
 */
const BindingNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/, "binding name must be SCREAMING_SNAKE_CASE");

export const DeploymentManifestSchema = z.object({
  name: z.string().min(1).max(64),
  entrypoint: z
    .string()
    .min(1)
    .refine((p) => p.endsWith(".js") || p.endsWith(".mjs"), {
      message: "entrypoint must be a pre-built .js or .mjs file (no build step runs)",
    }),
  compatibility_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "compatibility_date must be YYYY-MM-DD"),
  compatibility_flags: z.array(z.string()).optional(),
  static_assets: z
    .object({
      directory: z.string().min(1),
      run_worker_first: z.boolean().optional(),
    })
    .optional(),
  bindings: z
    .object({
      d1: z
        .array(
          z.object({
            name: BindingNameSchema,
            label: z.string().min(1).max(64),
          }),
        )
        .optional(),
      r2: z
        .array(
          z.object({
            name: BindingNameSchema,
            label: z.string().min(1).max(64),
          }),
        )
        .optional(),
      kv: z
        .array(
          z.object({
            name: BindingNameSchema,
          }),
        )
        .optional(),
    })
    .optional(),
});

export type DeploymentManifest = z.infer<typeof DeploymentManifestSchema>;
