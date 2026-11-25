// hooks/session-context.ts
//
// Builds the model context the SessionStart hook hands Claude when a session
// opens in a paper workspace. The next step comes from the router, the same
// decision `pensmith next` makes, so there is no second state source to drift.
// The text is a few sentences regardless of how many sections the paper has.

import { resolveNextAction, type RouterDecision } from '../bin/lib/router.js';
import { closeSessionLog } from '../bin/lib/session-log.js';

// The router takes the state lock; if a long-running pensmith command holds it,
// do not stall session start waiting for it.
const ROUTER_TIMEOUT_MS = 3000;

function safeSlug(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, '').slice(0, 60);
}

/** One sentence naming the next step and the command that runs it. */
export function describeNextStep(d: RouterDecision): string {
  switch (d.verb) {
    case 'new':
      return 'start the paper with intake (`pensmith new`)';
    case 'research':
      return 'find and screen sources (`pensmith research`)';
    case 'outline':
      return 'draft the outline, which the user must approve (`pensmith outline`)';
    case 'plan':
      return `plan section ${d.n} (${safeSlug(d.slug)}) (\`pensmith plan ${d.n}\`)`;
    case 'write':
      return `draft section ${d.n} (${safeSlug(d.slug)}) (\`pensmith write ${d.n}\`)`;
    case 'verify':
      return `verify the citations in section ${d.n} (${safeSlug(d.slug)}) (\`pensmith verify ${d.n}\`)`;
    case 'compile':
      return 'compile the verified sections into one draft (`pensmith compile`)';
    case 'done':
      return 'run the final audit and export, which the user must confirm (`pensmith done`)';
    case 'status':
      if (d.reason === 'done') return 'nothing: the paper is complete (`pensmith status` summarises it)';
      return d.section
        ? `look at section ${d.section.n} (${safeSlug(d.section.slug)}), which needs attention (\`pensmith status\`)`
        : 'look at the workspace, which needs attention (`pensmith status`)';
    case 'resume':
      return 'continue where the last session stopped (`pensmith next`)';
  }
}

async function nextStepWithin(projectDir: string, ms: number): Promise<RouterDecision | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([resolveNextAction(projectDir), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The additionalContext text for a session that opened in `projectDir`. */
export async function buildSessionContext(projectDir: string): Promise<string> {
  const decision = await nextStepWithin(projectDir, ROUTER_TIMEOUT_MS);
  try {
    await closeSessionLog();
  } catch {
    // Logging is best-effort here; never let it block session start.
  }
  const next = decision
    ? `Pensmith's next step is to ${describeNextStep(decision)}.`
    : 'Run `pensmith status` to see the next step.';
  return [
    'This project contains a pensmith academic-paper workspace (.paper/).',
    next,
    'When the user wants to work on the paper, use the pensmith skill: it runs the `pensmith` CLI and relays its approval questions.',
    'Change paper files through pensmith rather than editing .paper/ by hand, so citation verification stays valid.',
  ].join(' ');
}
