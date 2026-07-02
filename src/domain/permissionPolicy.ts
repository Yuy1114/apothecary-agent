export const VAULT_PERMISSION_POLICY = {
  readVault: "allow",
  writeAgentArtifact: "allow",
  proposeUserNoteChange: "allow",
  persistMaintenanceReview: "ask",
  writeUserNote: "ask",
  moveUserFile: "ask",
  deleteUserFile: "deny",
  executeCommand: "deny",
} as const;

export type PermissionAction = keyof typeof VAULT_PERMISSION_POLICY;
export type PermissionDecision = (typeof VAULT_PERMISSION_POLICY)[PermissionAction];

export const PERMISSION_DECISION_MEANINGS = {
  allow: "Allowed without human approval.",
  ask: "Requires human approval before execution or persistence.",
  deny: "Not allowed for this agent runtime.",
} as const satisfies Record<PermissionDecision, string>;
