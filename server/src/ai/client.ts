import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../logger';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.ai.apiKey) return null;
  if (!client) client = new Anthropic({ apiKey: config.ai.apiKey });
  return client;
}

export const aiConfigured = (): boolean => !!config.ai.apiKey;

/**
 * One grounded, non-streaming completion. `context` is the ONLY source of facts Claude is allowed to use —
 * the system prompt instructs it never to invent numbers — and every caller degrades to a deterministic,
 * rule-based answer when this returns null (no key configured, user hasn't opted in, or the call failed).
 */
export async function askGrounded(opts: { system: string; question: string; context: unknown; maxTokens?: number }): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const response = await c.messages.create({
      model: config.ai.model,
      max_tokens: opts.maxTokens ?? 700,
      output_config: { effort: 'low' },
      system: opts.system,
      messages: [{ role: 'user', content: `DATA (JSON, the only facts you may use):\n${JSON.stringify(opts.context)}\n\nQUESTION:\n${opts.question}` }],
    });
    if (response.stop_reason === 'refusal') {
      logger.warn({ category: response.stop_details?.category }, 'AI assistant request was refused');
      return null;
    }
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    return text?.trim() || null;
  } catch (e) {
    logger.error({ err: e }, 'AI request failed');
    return null;
  }
}
