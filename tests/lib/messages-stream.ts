// tests/lib/messages-stream.ts — a Messages API answer as the server-sent
// events the Anthropic SDK reads (complete() always streams). Shared by the
// tests that answer for the provider: llm-generator, llm-transport and
// write-truncated.
//
// Not a test file (the runner collects only *.test.ts).

export type StreamBlock =
  | { type: 'thinking'; thinking: string }
  | { type: 'text'; text: string }
  | { type: 'fallback'; from: string; to: string };

export interface StreamSpec {
  model?: string;
  blocks: StreamBlock[];
  stopReason: string;
  stopDetails?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  iterations?: Array<Record<string, unknown>>;
}

/** `events` as server-sent events: an `event:` line and a JSON `data:` line each. */
export function sse(events: Array<Record<string, unknown> & { type: string }>): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** The stream of one answer: message_start, each block, message_delta (how it stopped, tokens used), message_stop. */
export function messageStream(s: StreamSpec): string {
  const events: Array<Record<string, unknown> & { type: string }> = [{
    type: 'message_start',
    message: {
      id: 'msg_test', type: 'message', role: 'assistant', model: s.model ?? 'claude-opus-5-5', content: [],
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: s.inputTokens ?? 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }];
  s.blocks.forEach((b, index) => {
    if (b.type === 'thinking') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (b.thinking) events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'c2ln' } });
    } else if (b.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: { model: b.from }, to: { model: b.to } } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: s.stopReason, stop_sequence: null, ...(s.stopDetails ? { stop_details: s.stopDetails } : {}) },
    usage: { output_tokens: s.outputTokens ?? 500, ...(s.iterations ? { iterations: s.iterations } : {}) },
  });
  events.push({ type: 'message_stop' });
  return sse(events);
}
