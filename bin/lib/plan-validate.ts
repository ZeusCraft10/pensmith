// bin/lib/plan-validate.ts — the section-planner validator (GRND-13, FEED-04,
// D-18-23).
//
// The planner's reply is first checked for SHAPE by its zod contract
// (llm-contracts.ts SectionPlannerSchema). This module checks what the schema
// cannot:
//   - the echoed identity — `section`, `slug` and `depends_on` — equals the
//     OUTLINE row (the roadmap is authoritative);
//   - `assigned_sources` ⊆ the section's allowed set (its current PLAN.md
//     `assigned_sources`: the outline allocation plus `plan --research` /
//     `add --remap` additions) and ⊆ LIBRARY.json — an invented or foreign
//     citekey is named, never silently dropped;
//   - every claim's sources ⊆ `assigned_sources`;
//   - every paragraph's claim numbers name a claim.
// Every violation is reported at once for the one corrective turn (plan.ts).
// The same validator backs the Tier-1 plan submission tool (PLUG-07). PURE.

export interface PlannerOutput {
  readonly frontmatter: {
    readonly section: number;
    readonly slug: string;
    readonly depends_on: readonly string[];
    readonly assigned_sources: readonly string[];
  };
  readonly claims: ReadonlyArray<{ readonly claim: string; readonly sources: readonly string[] }>;
  readonly structure: ReadonlyArray<{ readonly paragraph: number; readonly claims: readonly number[] }>;
}

export interface PlanValidationInput {
  readonly plan: PlannerOutput;
  /** The section as OUTLINE.md (else its stub) declares it. */
  readonly section: { readonly n: number; readonly slug: string; readonly depends_on: readonly string[] };
  /** The section's allowed set (its current PLAN.md `assigned_sources`). */
  readonly allowed: readonly string[];
  /** The citekeys LIBRARY.json holds. */
  readonly libraryCitekeys: ReadonlySet<string>;
}

export type PlanIssueCode =
  | 'section-mismatch'
  | 'slug-mismatch'
  | 'depends-on-mismatch'
  | 'foreign-citekey'
  | 'claim-source-unassigned'
  | 'structure-claim-unknown';

export interface PlanIssue {
  readonly code: PlanIssueCode;
  readonly message: string;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

function list(xs: readonly string[]): string {
  return xs.length > 0 ? xs.join(', ') : '(none)';
}

/** Every rule the planner output breaks (empty when it is valid). */
export function validatePlan(input: PlanValidationInput): PlanIssue[] {
  const { plan, section } = input;
  const issues: PlanIssue[] = [];
  const fm = plan.frontmatter;
  if (fm.section !== section.n) {
    issues.push({ code: 'section-mismatch', message: `frontmatter.section is ${fm.section}, but this is section ${section.n}` });
  }
  if (fm.slug !== section.slug) {
    issues.push({ code: 'slug-mismatch', message: `frontmatter.slug is "${fm.slug}", but this section's slug is "${section.slug}"` });
  }
  if (!sameSet(fm.depends_on, section.depends_on)) {
    issues.push({
      code: 'depends-on-mismatch',
      message: `frontmatter.depends_on is [${list(fm.depends_on)}], but the outline says [${list(section.depends_on)}]`,
    });
  }

  const allowed = new Set(input.allowed);
  const foreign = [...new Set(fm.assigned_sources)].filter((k) => !allowed.has(k) || !input.libraryCitekeys.has(k));
  if (foreign.length > 0) {
    issues.push({
      code: 'foreign-citekey',
      message: `assigned_sources has citekeys that are not this section's sources: ${foreign.join(', ')} (allowed: ${list([...allowed].filter((k) => input.libraryCitekeys.has(k)))})`,
    });
  }

  const assigned = new Set(fm.assigned_sources);
  const unassigned = new Map<string, number[]>();
  plan.claims.forEach((c, i) => {
    for (const k of c.sources) {
      if (!assigned.has(k)) unassigned.set(k, [...(unassigned.get(k) ?? []), i + 1]);
    }
  });
  for (const [k, where] of unassigned) {
    issues.push({ code: 'claim-source-unassigned', message: `claim ${where.join(', ')} cites "${k}", which is not in assigned_sources` });
  }

  const count = plan.claims.length;
  const bad = new Set<number>();
  for (const p of plan.structure) for (const c of p.claims) if (c < 1 || c > count) bad.add(c);
  if (bad.size > 0) {
    issues.push({ code: 'structure-claim-unknown', message: `structure names claim(s) ${[...bad].sort((a, b) => a - b).join(', ')}, but there are ${count} claim(s)` });
  }
  return issues;
}

/** The issues as one line. */
export function formatPlanIssues(issues: readonly PlanIssue[]): string {
  return issues.map((i) => i.message).join('; ');
}

/** The corrective turn after a semantic failure (GRND-13: one, quoting every error). */
export function planCorrection(issues: readonly PlanIssue[]): string {
  return (
    `Your plan breaks these rules: ${issues.map((i, n) => `(${n + 1}) ${i.message}`).join(' ')} ` +
    'Reply again with the complete corrected plan as ONE JSON object in the same format. Copy section, slug ' +
    'and depends_on exactly from the section block, and use only citekeys from the sources block.'
  );
}
