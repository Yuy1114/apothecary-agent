import path from "node:path";
import { Workspace, LocalFilesystem, LocalSandbox } from "@mastra/core/workspace";

const VAULT_PATH = path.resolve(process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault");

export const workspace = new Workspace({
  id: "apothecary-vault",
  name: "Apothecary Vault",
  filesystem: new LocalFilesystem({
    basePath: VAULT_PATH,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: VAULT_PATH,
  }),
});
