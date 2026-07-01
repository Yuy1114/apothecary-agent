import path from "node:path";

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function relativeVaultPath(vaultPath: string, absolutePath: string): string {
  return toPosixPath(path.relative(vaultPath, absolutePath));
}
