import { describe, expect, it } from "vitest";
import { resolveProposalTool } from "./resolve-proposal.js";
import { proposeChangeTool } from "./propose-change.js";
import { TOOL_APPROVAL_POLICIES, requiresHumanApproval } from "./permissions.js";

describe("tool permission policy", () => {
  it("classifies sensitive user-vault mutations as approval-gated", () => {
    expect(TOOL_APPROVAL_POLICIES.readVault).toBe("allow");
    expect(TOOL_APPROVAL_POLICIES.writeAgentArtifact).toBe("allow");
    expect(TOOL_APPROVAL_POLICIES.proposeUserNoteChange).toBe("allow");
    expect(TOOL_APPROVAL_POLICIES.persistMaintenanceReview).toBe("ask");
    expect(TOOL_APPROVAL_POLICIES.writeUserNote).toBe("ask");
    expect(TOOL_APPROVAL_POLICIES.moveUserFile).toBe("ask");
    expect(TOOL_APPROVAL_POLICIES.deleteUserFile).toBe("deny");
    expect(TOOL_APPROVAL_POLICIES.executeCommand).toBe("deny");
  });

  it("gates applying a proposal behind human approval, while proposing stays free", () => {
    // The unified apply path is the only way to mutate user notes, and it is
    // approval-gated; creating a proposal (writing to .agent) is not.
    expect(resolveProposalTool.requireApproval).toBe(requiresHumanApproval);
    expect(proposeChangeTool.requireApproval).not.toBe(requiresHumanApproval);
    expect(requiresHumanApproval()).toBe(true);
  });
});
