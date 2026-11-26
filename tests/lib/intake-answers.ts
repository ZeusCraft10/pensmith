// tests/lib/intake-answers.ts — a full set of intake answers, for tests that
// run `pensmith new` to get a paper started rather than to test the questions.
//
// Not a test file (the runner collects only *.test.ts).

export const INTAKE_ANSWERS = {
  topic: 'attention mechanisms in transformer networks',
  discipline: 'computer-science',
  length_words: 2000,
  citation_style: 'ieee',
  audience: 'a graduate seminar',
  counterargument: 'optional',
} as const;

/** INTAKE_ANSWERS as the --answers argument. */
export const INTAKE_ANSWERS_JSON = JSON.stringify(INTAKE_ANSWERS);
