import { Agent } from "@mastra/core/agent";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * The vision transformer, built from configuration rather than hardcoded: which
 * model reads images is a provider-and-cost decision that is made outside the
 * code, and it must be changeable without a release.
 *
 * `APOTHECARY_VISION_MODEL` alone (e.g. `openai/gpt-4o-mini`) goes through
 * Mastra's model router. Adding `APOTHECARY_VISION_BASE_URL` points it at any
 * OpenAI-compatible endpoint instead — which is how the embedding endpoint is
 * already configured, so an aggregator that serves both needs one more key and
 * nothing else.
 *
 * Returns null when unconfigured; that is a normal state, not an error.
 */

export type VisionConfig = { apiKey?: string; baseUrl?: string; model?: string };

export function visionConfig(env: NodeJS.ProcessEnv = process.env): VisionConfig {
  return {
    apiKey: env.APOTHECARY_VISION_API_KEY || env.OPENAI_API_KEY || undefined,
    baseUrl: env.APOTHECARY_VISION_BASE_URL || undefined,
    model: env.APOTHECARY_VISION_MODEL || undefined,
  };
}

/** A model id is the minimum; a custom endpoint additionally needs its key. */
export function visionConfigured(config: VisionConfig = visionConfig()): boolean {
  if (!config.model) return false;
  return config.baseUrl ? Boolean(config.apiKey) : true;
}

const INSTRUCTIONS =
  "You look at ONE image from a personal knowledge vault's inbox and report what it is, so an archivist agent " +
  "can decide where to file it. Be concrete and faithful — never guess at content you cannot see. " +
  "Write `description` in ENGLISH (it is agent-internal understanding). Transcribe `text` VERBATIM in its " +
  "original language, including code, UI labels and handwriting; leave it empty when the image has no text. " +
  "`suggestedName` is a short, human-readable filename stem in the image's own language, with no extension and " +
  "no date prefix — leave it empty rather than inventing something generic like 'image' or 'screenshot'. " +
  "If the image shows a document, receipt, form or ID, say so plainly: those are archival originals and are " +
  "filed differently from notes.";

let cached: { signature: string; agent: Agent } | null = null;

export function imageDescriberAgent(config: VisionConfig = visionConfig()): Agent | null {
  if (!visionConfigured(config)) return null;

  // Rebuild when configuration changes (a key added in settings, a model swap)
  // instead of serving a stale client for the life of the process.
  const signature = `${config.baseUrl ?? ""}|${config.model}|${config.apiKey ? "keyed" : "routed"}`;
  if (cached?.signature === signature) return cached.agent;

  const model = config.baseUrl
    ? createOpenAICompatible({
        name: "apothecary-vision",
        baseURL: config.baseUrl,
        apiKey: config.apiKey!,
      })(config.model!)
    : config.model!;

  const agent = new Agent({
    id: "image-describer",
    name: "Image Describer",
    description: "Reads one inbox image and reports what it is, for a filing decision.",
    instructions: INSTRUCTIONS,
    model,
  });
  cached = { signature, agent };
  return agent;
}
