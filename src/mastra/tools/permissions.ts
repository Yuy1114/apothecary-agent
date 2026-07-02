export const TOOL_APPROVAL_POLICIES = {
  readVault: "allow",
  writeAgentArtifact: "allow",
  proposeUserNoteChange: "allow",
  writeUserNote: "ask",
  moveUserFile: "ask",
  deleteUserFile: "deny",
  executeCommand: "deny",
} as const;

export function requiresHumanApproval(): true {
  return true;
}
