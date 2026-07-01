export function nowIso(): string {
  return new Date().toISOString();
}

export function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
