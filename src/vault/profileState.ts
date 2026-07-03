import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";
import { nowIso } from "../utils/time.js";

/**
 * Tracks whether the standing knowledge profile is stale relative to the
 * semantic layer. The profile is a full-vault LLM pass, too heavy to regenerate
 * on every change, so instead any semantic change marks it dirty; a profile
 * refresh clears it. Lets consumers see when the profile may be out of date.
 */
export const ProfileRefreshStateSchema = z.object({
  dirty: z.boolean(),
  lastDirtyAt: z.string().optional(),
  lastRefreshAt: z.string().optional(),
});
export type ProfileRefreshState = z.infer<typeof ProfileRefreshStateSchema>;

const DEFAULT_STATE: ProfileRefreshState = { dirty: false };

function statePath(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).profileDir, "refresh-state.json");
}

export async function loadProfileRefreshState(vaultPath: string): Promise<ProfileRefreshState> {
  try {
    return ProfileRefreshStateSchema.parse(JSON.parse(await fs.readFile(statePath(vaultPath), "utf8")));
  } catch {
    return DEFAULT_STATE;
  }
}

async function saveProfileRefreshState(vaultPath: string, state: ProfileRefreshState): Promise<void> {
  const filePath = statePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

/** Flag the profile as stale after a semantic-layer change (best-effort). */
export async function markProfileDirty(vaultPath: string): Promise<void> {
  try {
    const state = await loadProfileRefreshState(vaultPath);
    await saveProfileRefreshState(vaultPath, { ...state, dirty: true, lastDirtyAt: nowIso() });
  } catch {
    // Never let profile bookkeeping break a semantic refresh.
  }
}

/** Clear the dirty flag once the profile has been regenerated. */
export async function clearProfileDirty(vaultPath: string): Promise<void> {
  const state = await loadProfileRefreshState(vaultPath);
  await saveProfileRefreshState(vaultPath, { ...state, dirty: false, lastRefreshAt: nowIso() });
}
