export type DirectoryDef = {
  description: string;
  keywords?: string[];
};

export type VaultStructure = {
  directories: Record<string, DirectoryDef>;
  // Source-prefix → canonical-prefix. Used to canonicalize alias directories
  // (e.g. "notes/programming/dsa/" → "notes/programming/Data Structures & Algorithms/").
  aliases: Record<string, string>;
};
