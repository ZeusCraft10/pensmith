// tests/lib/redo-generator.ts — the scripted model for re-doing one section
// (tests/section-isolation.test.ts), loaded into the CLI process with
// `node --import`.
//
// plan assigns the works the outline gives the section; write drafts one
// sentence citing the first work the drafter is shown; revise removes the
// citation the verifier flagged. Nothing else is expected.
//
// Not a test file (the runner collects only *.test.ts).

import { installScriptedModel, worksShown } from './scripted-model.js';

installScriptedModel((req, step) => {
  if (step === 'plan') {
    // The planner is shown the section as JSON, with the outline's sources for it.
    const m = /"outline_sources":(\[[^\]]*\])/.exec(req.system);
    if (!m) throw new Error('redo: the plan request shows no outline_sources');
    const keys = JSON.parse(m[1]!) as string[];
    return {
      assigned_sources: keys,
      claims: [{ claim: 'What the cited work reports.', sources: keys }],
      brief: 'Summarise what the cited work reports, for a general academic reader, in a few careful sentences that cite only the assigned sources.',
      voice: 'plain',
    };
  }
  if (step === 'revise') {
    const flagged = /^- Citekey: (\S+)$/m.exec(req.messages.map((m) => m.content).join('\n'))?.[1];
    if (!flagged) throw new Error('redo: the revise request names no flagged citation');
    return {
      action: 'remove',
      flagged_citekey: flagged,
      replacement_citekey: null,
      rationale: 'No registry holds this DOI, so the citation is removed.',
      patch: { before_excerpt: `[@${flagged}]`, after_excerpt: '' },
    };
  }
  if (step === 'write') {
    const [key] = worksShown(req).keys();
    if (!key) throw new Error('redo: the drafter was shown no work');
    return { draft: `This section rests on one work [@${key}].\n`, gaps: [] };
  }
  return undefined;
});
