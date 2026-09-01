/** Build a single prompt that includes prior turns for targets without native continue APIs. */
export function buildPromptWithHistory(
  prompt: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  if (turns.length === 0) return prompt;
  const history = turns
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n');
  return `${history}\nUser: ${prompt}`;
}
