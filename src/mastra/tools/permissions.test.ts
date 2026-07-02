import { describe, expect, it } from "vitest";
import { ingestVaultTool } from "./ingest-vault.js";
import { moveVaultFileTool } from "./move-vault-file.js";
import { TOOL_APPROVAL_POLICIES, requiresHumanApproval } from "./permissions.js";

describe("tool permission policy", () => {
  it("classifies sensitive user-vault mutations as approval-gated", () => {
    expect(TOOL_APPROVAL_POLICIES.readVault).toBe("allow");
    expect(TOOL_APPROVAL_POLICIES.writeUserNote).toBe("ask");
    expect(TOOL_APPROVAL_POLICIES.moveUserFile).toBe("ask");
    expect(TOOL_APPROVAL_POLICIES.deleteUserFile).toBe("deny");
  });

  it("requires Mastra tool approval before writing or moving user vault content", () => {
    expect(moveVaultFileTool.requireApproval).toBe(requiresHumanApproval);
    expect(ingestVaultTool.requireApproval).toBe(requiresHumanApproval);
    expect(requiresHumanApproval()).toBe(true);
  });
});
