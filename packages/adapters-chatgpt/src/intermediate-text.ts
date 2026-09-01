/** Tool/search status lines that appear before the real assistant answer. */
export function isIntermediateAssistantText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  return /^(Searching the web|Searching|Thinking|Working|Looking it up|Browsing|Reading sources?)\.?$/i.test(
    t,
  );
}
