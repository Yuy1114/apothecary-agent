import { VAULT_PERMISSION_POLICY } from "../../domain/permissionPolicy.js";

export const TOOL_APPROVAL_POLICIES = VAULT_PERMISSION_POLICY;

export function requiresHumanApproval(): true {
  return true;
}
