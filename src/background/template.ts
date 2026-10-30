export function renderTemplate(
  template: string,
  context: Record<string, string | string[]>
): string {
  return template.replace(/\{\{\s*(json\s+)?([a-zA-Z0-9_]+)\s*\}\}/g, (_, asJson, key) => {
    const value = context[key];
    if (asJson) return JSON.stringify(value ?? "");
    return Array.isArray(value) ? value.join("\n") : String(value ?? "");
  });
}
