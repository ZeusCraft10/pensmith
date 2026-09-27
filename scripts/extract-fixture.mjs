#!/usr/bin/env node
// scripts/extract-fixture.mjs — turn a SESSION.log into a mock-LLM fixture (RUN-17, D-17-30).
//
//   node scripts/extract-fixture.mjs .paper/SESSION.log > fx.json
//   npm run mock-llm -- --port 18080 --fixture fx.json
//
// Output: { "version": 1, "slugs": { "<slug>": [ { request_sha256, model, text,
// data, stop_reason, input_tokens, output_tokens }, … ] } } — one entry per
// kind:"llm" record, in log order. The mock serves an entry whose
// request_sha256 matches the incoming request body, else the next unused one.
// Records spilled to sessions/<run_id>/<seq>.json (> 256 KiB) are read from
// their spill file. Records written with `[logging] session_bodies =
// "redacted"` keep no bodies and are skipped (reported on stderr).
//
// Plain Node (no build step, no dependencies). tests/replay.test.ts asserts the
// output equals bin/lib/replay.ts buildFixture() for the same log.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  process.stderr.write('usage: node scripts/extract-fixture.mjs <path/to/SESSION.log>\n');
  process.exit(2);
}

let text;
try {
  text = readFileSync(file, 'utf8');
} catch (e) {
  process.stderr.write(`extract-fixture: cannot read ${file}: ${e.message}\n`);
  process.exit(1);
}

const base = path.dirname(path.resolve(file));
const slugs = {};
let skipped = 0;
for (const line of text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    continue;
  }
  if (rec.kind !== 'llm' || typeof rec.id !== 'string' || typeof rec.slug !== 'string') continue;
  if (rec.truncated === true && typeof rec.spilled_to === 'string') {
    try {
      rec = JSON.parse(readFileSync(path.join(base, ...rec.spilled_to.split('/')), 'utf8'));
    } catch {
      /* keep the summary; it is skipped below */
    }
  }
  const replayable = rec.session_bodies !== 'redacted'
    && rec.truncated !== true
    && typeof rec.request_sha256 === 'string'
    && rec.response && typeof rec.response.text === 'string';
  if (!replayable) {
    skipped += 1;
    continue;
  }
  const entry = { request_sha256: rec.request_sha256, text: rec.response.text };
  if (rec.served_model ?? rec.model) entry.model = rec.served_model ?? rec.model;
  if (rec.response.data !== undefined) entry.data = rec.response.data;
  if (rec.stop_reason) entry.stop_reason = rec.stop_reason;
  if (typeof rec.input_tokens === 'number') entry.input_tokens = rec.input_tokens;
  if (typeof rec.output_tokens === 'number') entry.output_tokens = rec.output_tokens;
  (slugs[rec.slug] ??= []).push(entry);
}

if (skipped > 0) process.stderr.write(`extract-fixture: skipped ${skipped} record(s) without stored bodies\n`);
process.stdout.write(JSON.stringify({ version: 1, slugs }, null, 2) + '\n');
