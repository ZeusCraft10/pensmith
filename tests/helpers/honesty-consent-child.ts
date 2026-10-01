// tests/helpers/honesty-consent-child.ts — a child process for
// tests/honesty-consent.test.ts (EXP-17): scores the same text twice for the
// paper at argv[2] with the V5 MockAgent answering GPTZero, so the parent can
// feed the `detector-consent` answer on stdin (PENSMITH_PROMPT_MODE=numbered,
// the test runner's stand-in for a terminal) and see it asked once and
// recorded. The parent sets PENSMITH_NETWORK_TESTS=1 and the key. Prints one
// JSON line on stderr: both score lines and the number of detector requests.

import { installMockAgent } from './local-servers/mock-agent.js';
import { honestyLine, measureHonesty } from '../../bin/lib/honesty.js';

const root = process.argv[2] ?? '';
const { agent, restore } = installMockAgent();
let requests = 0;
agent
  .get('https://api.gptzero.me')
  .intercept({ path: '/v2/predict/text', method: 'POST' })
  .reply(() => {
    requests += 1;
    return {
      statusCode: 200,
      data: JSON.stringify({ documents: [{ class_probabilities: { ai: 0.33 }, document_classification: 'MIXED' }] }),
      responseOptions: { headers: { 'content-type': 'application/json' } },
    };
  })
  .persist();
try {
  const first = await measureHonesty('A paper text to score.', { paperRoot: root });
  const second = await measureHonesty('A paper text to score.', { paperRoot: root });
  process.stderr.write(`${JSON.stringify({ first: honestyLine(first), second: honestyLine(second), requests })}\n`);
} finally {
  await restore();
}
