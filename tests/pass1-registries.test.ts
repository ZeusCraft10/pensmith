// tests/pass1-registries.test.ts — Pass 1 asks the registry that holds each
// identifier, and only a definite "no such work" from all of them is FABRICATED.
//
// Pass 1 used to ask Crossref alone and map every non-200 to FABRICATED. arXiv
// DOIs (10.48550/arXiv.*) and Zenodo DOIs are registered with DataCite, JaLC
// DOIs with JaLC, so Crossref answers 404 for them, and a rate limit or outage
// answered nothing at all: each read as "DOI did not resolve via Crossref",
// FABRICATED, for a real paper.
//
// Every case runs the real `pensmith verify` on a one-section paper. The
// registry answers are real recordings (tests/fixtures/cassettes), except the
// 429/503 case, which is synthetic under the 10.0000 test prefix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface Verified { status: number | null; verification: string; planStatus: unknown; out: string }

/** A one-section paper citing every key of `bib`, verified by the real CLI. */
function verify(bib: string): Promise<Verified> {
  const keys = [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);
  const root = mkdtempSync(join(tmpdir(), 'pensmith-pass1-reg-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(sec, 'PLAN.md'), `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [${keys.join(', ')}]\n---\n# Intro\n`);
  writeFileSync(join(sec, 'DRAFT.md'), `# Intro\n\n${keys.map((k) => `A claim rests on this work [@${k}].`).join(' ')}\n`);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  const env = isolatedCliEnv({ PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: undefined }, 'pensmith-pass1-reg-home-');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, 'verify', '1', '--slug', 'intro'], { cwd: root, env });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (status) => {
      resolve({
        status,
        out,
        verification: readFileSync(join(sec, 'VERIFICATION.md'), 'utf8'),
        planStatus: parseFrontmatter(readFileSync(join(sec, 'PLAN.md'), 'utf8')).frontmatter['status'],
      });
    });
  });
}

function row(v: Verified, key: string): string {
  const line = v.verification.split('\n').find((l) => l.startsWith(`- ${key}: `));
  assert.ok(line, `no Pass-1 row for ${key}\n${v.verification}`);
  return line;
}

const ATTENTION =
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n' +
  '  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},\n' +
  '  year = {2017},\n  doi = {10.48550/arXiv.1706.03762}\n}\n';

const MATPLOTLIB =
  '@software{matplotlib,\n  title = {Matplotlib: Visualization with Python},\n' +
  '  author = {{The Matplotlib Development Team}},\n  year = {2026},\n  doi = {10.5281/zenodo.592536}\n}\n';

const JALC =
  '@article{namekawa2016,\n' +
  '  title = {起業者の情報行動からみた公共図書館のビジネス支援サービス : ある自治体のビジネス相談会の事例に基づく分析},\n' +
  '  author = {滑川, 貴之},\n  year = {2016},\n  journal = {日本図書館情報学会誌},\n  doi = {10.20651/jslis.62.1_1}\n}\n';

const FABRICATED =
  '@article{ghost2024,\n  title = {Room-temperature superconductivity in a ternary hydride at ambient pressure},\n' +
  '  author = {Ghost, Casper},\n  year = {2024},\n  journal = {Nature},\n  doi = {10.1038/s41586-024-99999-x}\n}\n';

const REGISTRY_DOWN =
  '@article{outage2020,\n  title = {A Paper Checked During an Outage},\n  author = {Roe, Jane},\n' +
  '  year = {2020},\n  doi = {10.0000/pensmith-registry-down}\n}\n';

const UNRECORDED =
  '@article{engel2007,\n  title = {Evidence for wavelike energy transfer through quantum coherence in photosynthetic systems},\n' +
  '  author = {Engel, Gregory S.},\n  doi = {10.1038/nature05678},\n  year = {2007}\n}\n';

test('verify: an arXiv DOI (DataCite, Crossref 404) is OK, not FABRICATED', async () => {
  const v = await verify(ATTENTION);
  assert.match(row(v, 'vaswani2017'), /\*\*OK\*\* .*DataCite record for DOI 10\.48550\/arXiv\.1706\.03762/);
  assert.match(v.verification, /^Status: verified$/m, v.verification);
  assert.equal(v.status, 0, v.out);
  assert.equal(v.planStatus, 'verified');
});

test('verify: a Zenodo DOI (DataCite) with a corporate author is OK', async () => {
  const v = await verify(MATPLOTLIB);
  assert.match(row(v, 'matplotlib'), /\*\*OK\*\* .*DataCite record/);
  assert.equal(v.status, 0, v.out);
});

test('verify: a JaLC DOI neither Crossref nor DataCite holds is found through doi.org and is OK', async () => {
  const v = await verify(JALC);
  assert.match(row(v, 'namekawa2016'), /\*\*OK\*\* .*doi\.org record/);
  assert.equal(v.status, 0, v.out);
});

test('verify: a DOI no agency registered is FABRICATED, and the reason names every registry asked', async () => {
  const v = await verify(FABRICATED);
  const r = row(v, 'ghost2024');
  assert.match(r, /\*\*FABRICATED\*\*/);
  assert.match(r, /Crossref, DataCite and doi\.org/);
  assert.match(v.verification, /^Status: failed$/m);
  assert.equal(v.status, 2, v.out);
  assert.equal(v.planStatus, 'failed');
});

test('verify: 429 and 503 from the registries are UNRESOLVED (blocking), never FABRICATED', async () => {
  const v = await verify(REGISTRY_DOWN);
  const r = row(v, 'outage2020');
  assert.match(r, /\*\*UNRESOLVED\*\*/);
  assert.match(r, /HTTP 429/);
  assert.match(r, /HTTP 503/);
  assert.match(r, /re-run verify/);
  assert.doesNotMatch(v.verification, /FABRICATED/);
  assert.match(v.verification, /^Status: failed$/m, 'an unchecked citation still blocks');
  assert.equal(v.status, 2, v.out);
});

test('verify: a registry request that gets no answer at all is UNRESOLVED, not FABRICATED', async () => {
  // No recording exists for this DOI: the cassette layer fails the request the
  // way a dropped connection would.
  const v = await verify(UNRECORDED);
  const r = row(v, 'engel2007');
  assert.match(r, /\*\*UNRESOLVED\*\*/);
  assert.doesNotMatch(v.verification, /FABRICATED/);
  assert.equal(v.status, 2, v.out);
});

test('verify: in one section, only the invented DOI is FABRICATED', async () => {
  const v = await verify([ATTENTION, MATPLOTLIB, FABRICATED, REGISTRY_DOWN].join('\n'));
  assert.match(row(v, 'vaswani2017'), /\*\*OK\*\*/);
  assert.match(row(v, 'matplotlib'), /\*\*OK\*\*/);
  assert.match(row(v, 'ghost2024'), /\*\*FABRICATED\*\*/);
  assert.match(row(v, 'outage2020'), /\*\*UNRESOLVED\*\*/);
  assert.equal(v.verification.match(/\*\*FABRICATED\*\*/g)?.length, 1);
  assert.equal(v.status, 2, v.out);
});
