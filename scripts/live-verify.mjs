#!/usr/bin/env node
// scripts/live-verify.mjs — the live lane for Pass 1 (Phase 20, D-20-33;
// VRFY-11, VRFY-12, VRFY-13, VRFY-15, VRFY-29).
//
//   npm run build
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run live:verify
//
// (`npm run live:verify` runs this script, then scripts/live-verify-quotes.mjs,
// the live lane for Pass 3's sources — VRFY-19.)
//
// Runs `pensmith verify 1` through the BUILT CLI (dist/bin/pensmith.js) on
// seeded sections against the REAL registrars — the default `npm test` never
// does (it replays the recordings `npm run cassettes:refresh` made from these
// same answers). One line per check:
//   PASS  <check>
//   FAIL  <check>: <why>          → the script exits 1
//   INCONCLUSIVE <check>: <why>   → an expected non-OK verdict (FABRICATED,
//                                   UNRESOLVABLE) was not observed because its
//                                   lookup got no answer; PASS never claims it.
//                                   With PENSMITH_LIVE_STRICT=1 the script exits 1
//   INFO  <line>                  → context (e.g. a lookup that got no answer)
//
// The checks:
//   - VRFY-11: every identifier of the acceptance list (a Crossref journal
//     article, monograph, edited volume and consortium paper, an arXiv DataCite
//     DOI, an arXiv id, an ISBN, a Zenodo DOI, a PMID, an upper-case DOI, an
//     mEDRA and a JaLC DOI, a book cited with its subtitle) is OK;
//     10.99999/fake.001 is FABRICATED;
//   - VRFY-12: an identifier-less entry of a real work is OK naming the DOI the
//     metadata search found; one of no work is UNRESOLVABLE;
//   - review round 2: consortium works cited as the journals print them
//     (LIGO/Virgo, CMS, ATLAS, GBD 2019) and identifier-less JMLR / NeurIPS /
//     ICLR works (arXiv, OpenAlex) verify OK;
//   - VRFY-29: every row of tests/fixtures/known-bad-citations.json is
//     FABRICATED and every row of tests/fixtures/known-mis-cited.json MIS-CITED;
//   - VRFY-15: the Wakefield paper is RETRACTED, in VERIFICATION.md and as the
//     stderr warning, and the section fails;
//   - VRFY-13 self-consistency: research runs live on a computer-science and a
//     medicine topic (the adapters and the research pass pensmith uses; the
//     evaluator as its contract stub keeps every candidate), every source the
//     outline could be offered is cited, and `verify 1` must block none of them
//     (0 false blocks).
// In the acceptance list, the round-2 works and the self-consistency sample, a
// row whose lookup got no answer (UNVERIFIABLE-NETWORK — a throttled or
// unreachable service, e.g. OpenAlex's keyless daily budget) is reported as
// INFO, not counted: it failed closed, and what it would have been is unknown.
// When such a row was expected to be FABRICATED or UNRESOLVABLE, that verdict
// is INCONCLUSIVE, and the PASS line names only the verdicts it observed
// (main-branch merge review, round 1: evidence for VRFY-12 must come from a
// run that produced the verdict).
//
// How it runs: the parent (plain node) checks the contact email and the build,
// then runs one CHILD (under `node --import tsx`, for the seeding helper and the
// research modules) with every mode variable removed (live, not a test
// context), PENSMITH_NO_LLM=1 (Pass 2 / Pass 4 and the research evaluator as
// their deterministic stubs — no model is asked) and a fresh, empty data dir,
// so the HTTP cache cannot answer for the network and the user's data dir is
// never touched. The contact email must be the project address (never a
// personal one): it is sent to Crossref, OpenAlex and Unpaywall only.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const CLI = path.join(REPO_ROOT, 'dist', 'bin', 'pensmith.js');

/** The VRFY-11 acceptance list (PLAN §9), as a user's bibliography cites each work, and what Pass 1 must say. */
const VRFY11 = [
  ['lecun2015', 'OK', '@article{lecun2015, author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey}, title = {Deep learning}, journal = {Nature}, year = {2015}, doi = {10.1038/nature14539}}'],
  ['boyd2004', 'OK', '@book{boyd2004, author = {Boyd, Stephen and Vandenberghe, Lieven}, title = {Convex Optimization}, publisher = {Cambridge University Press}, year = {2004}, doi = {10.1017/CBO9780511804441}}'],
  ['vaswani2017', 'OK', '@misc{vaswani2017, author = {Vaswani, Ashish and Shazeer, Noam}, title = {Attention Is All You Need}, year = {2017}, doi = {10.48550/arXiv.1706.03762}}'],
  ['devlin2018', 'OK', '@misc{devlin2018, author = {Devlin, Jacob and Chang, Ming-Wei}, title = {BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding}, year = {2018}, eprint = {1810.04805}, archivePrefix = {arXiv}}'],
  ['kuhn1996', 'OK', '@book{kuhn1996, author = {Kuhn, Thomas S.}, title = {The Structure of Scientific Revolutions}, year = {1996}, isbn = {9780226458083}}'],
  ['montani2023', 'OK', '@misc{montani2023, author = {Montani, Ines and Honnibal, Matthew}, title = {explosion/spaCy: v3.7.2: Fixes for APIs and requirements}, publisher = {Zenodo}, year = {2023}, doi = {10.5281/zenodo.1212303}}'],
  ['mcmurray2019', 'OK', '@article{mcmurray2019, author = {McMurray JJV and Solomon SD}, title = {Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction}, journal = {N Engl J Med}, year = {2019}, pmid = {31535829}}'],
  ['navab2015', 'OK', '@book{navab2015, editor = {Navab, Nassir and Hornegger, Joachim and Wells, William M.}, title = {Medical Image Computing and Computer-Assisted Intervention -- MICCAI 2015}, publisher = {Springer}, year = {2015}, doi = {10.1007/978-3-319-24574-4}}'],
  ['encode2012', 'OK', '@article{encode2012, author = {{The ENCODE Project Consortium}}, title = {An integrated encyclopedia of DNA elements in the human genome}, journal = {Nature}, year = {2012}, doi = {10.1038/nature11247}}'],
  ['lecun2015upper', 'OK', '@article{lecun2015upper, author = {LeCun, Yann}, title = {Deep learning}, year = {2015}, doi = {10.1038/NATURE14539}}'],
  ['navajas2005', 'OK', '@article{navajas2005, author = {Navajas, Gonzalo}, title = {La historia y la literatura española postnacional}, journal = {Studi ispanici}, year = {2005}, doi = {10.1400/19806}}'],
  ['kitamoto1997', 'OK', '@thesis{kitamoto1997, author = {北本, 朝展}, title = {領域・空間情報を表現するグラフ構造を用いた類似画像検索}, school = {東京大学}, year = {1997}, doi = {10.11501/3140078}}'],
  ['hastie2009', 'OK', '@book{hastie2009, author = {Hastie, Trevor and Tibshirani, Robert and Friedman, Jerome}, title = {The Elements of Statistical Learning: Data Mining, Inference, and Prediction}, publisher = {Springer}, year = {2009}, doi = {10.1007/978-0-387-84858-7}}'],
  ['fake2024', 'FABRICATED', '@article{fake2024, author = {Smith, A.B.}, title = {Attention Mechanisms in Modern Transformer Architectures}, year = {2024}, doi = {10.99999/fake.001}}'],
  // VRFY-12: no identifier — the metadata search.
  ['lecun2015noid', 'OK', '@article{lecun2015noid, author = {LeCun, Yann and Bengio, Yoshua}, title = {Deep learning}, year = {2015}}'],
  ['nobody2017', 'UNRESOLVABLE', '@article{nobody2017, author = {Nobody, Ann}, title = {A Work That Was Never Published}, year = {2017}}'],
];

/**
 * Review round 2: consortium works cited as the journals print them (VRFY-13)
 * and identifier-less works no registrar holds a DOI for (VRFY-12: JMLR,
 * NeurIPS, ICLR — arXiv and OpenAlex find them). A row a throttled service
 * left UNVERIFIABLE-NETWORK is reported, not counted (OpenAlex's keyless
 * budget is shared per address).
 */
const ROUND2 = [
  ['ligo2016', 'OK', '@article{ligo2016, author = {{LIGO Scientific Collaboration and Virgo Collaboration}}, title = {Observation of Gravitational Waves from a Binary Black Hole Merger}, journal = {Physical Review Letters}, year = {2016}, doi = {10.1103/PhysRevLett.116.061102}}'],
  ['cms2012', 'OK', '@article{cms2012, author = {{CMS Collaboration}}, title = {Observation of a new boson at a mass of 125 GeV with the CMS experiment at the LHC}, journal = {Physics Letters B}, year = {2012}, doi = {10.1016/j.physletb.2012.08.021}}'],
  ['atlas2012', 'OK', '@article{atlas2012, author = {{ATLAS Collaboration}}, title = {Observation of a new particle in the search for the Standard Model Higgs boson with the ATLAS detector at the LHC}, journal = {Physics Letters B}, year = {2012}, doi = {10.1016/j.physletb.2012.08.020}}'],
  ['gbd2020', 'OK', '@article{gbd2020, author = {{GBD 2019 Diseases and Injuries Collaborators}}, title = {Global burden of 369 diseases and injuries in 204 countries and territories, 1990--2019: a systematic analysis for the Global Burden of Disease Study 2019}, journal = {The Lancet}, year = {2020}, doi = {10.1016/S0140-6736(20)30925-9}}'],
  ['vaswani_noid', 'OK', '@inproceedings{vaswani_noid, author = {Vaswani, Ashish and Shazeer, Noam}, title = {Attention Is All You Need}, booktitle = {Advances in Neural Information Processing Systems}, year = {2017}}'],
  ['kingma_noid', 'OK', '@inproceedings{kingma_noid, author = {Kingma, Diederik P. and Ba, Jimmy}, title = {Adam: A Method for Stochastic Optimization}, booktitle = {International Conference on Learning Representations}, year = {2015}}'],
  ['maaten_noid', 'OK', '@article{maaten_noid, author = {van der Maaten, Laurens and Hinton, Geoffrey}, title = {Visualizing Data using t-SNE}, journal = {Journal of Machine Learning Research}, year = {2008}}'],
  ['srivastava_noid', 'OK', '@article{srivastava_noid, author = {Srivastava, Nitish and Hinton, Geoffrey}, title = {Dropout: A Simple Way to Prevent Neural Networks from Overfitting}, journal = {Journal of Machine Learning Research}, year = {2014}}'],
];

/** The CS and medicine self-consistency topics (the audit's FU3-1 sample; PLAN VRFY-13). */
const SELF_CONSISTENCY = [
  {
    name: 'computer science',
    discipline: 'computer-science',
    topic: 'attention mechanisms in transformer neural networks',
    queries: ['attention mechanisms in transformer neural networks', 'self-attention for sequence modeling'],
  },
  {
    name: 'medicine',
    discipline: 'biology',
    topic: 'social media use and adolescent depression',
    queries: ['social media use and adolescent depression', 'screen time and depressive symptoms in adolescents'],
  },
];

// ---------------------------------------------------------------------------
// Child: the checks (`verify` through the built dist/ CLI)
// ---------------------------------------------------------------------------

function bibOf(entry) {
  const authors = (entry.authors ?? []).join(' and ');
  return `@article{${entry.citekey},\n  author = {${authors}},\n  title = {${entry.title}},\n  year = {${entry.year}},\n  doi = {${entry.doi}},\n}\n`;
}

/**
 * A project with one written section citing `keys` (every key once) and, when
 * `bibText` is given, the bibliography a user wrote by hand
 * (tests/helpers/live-verify-seed.ts — test infrastructure; the shipped
 * program writes STATE.json and CITATIONS.bib only through state.ts and
 * library.ts).
 */
async function seedPaper(work, name, keys, bibText) {
  const { seedVerifyPaper } = await import(pathToFileURL(path.join(REPO_ROOT, 'tests', 'helpers', 'live-verify-seed.ts')).href);
  const root = path.join(work, name);
  const dir = seedVerifyPaper(root, keys, bibText);
  return { root, dir };
}

/** `pensmith verify 1 --yolo` through the built CLI; the Pass-1 verdict per key. */
function verifySection(root, dir) {
  const r = spawnSync(process.execPath, [CLI, 'verify', '1', '--yolo'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const vPath = path.join(dir, 'VERIFICATION.md');
  const md = existsSync(vPath) ? readFileSync(vPath, 'utf8') : '';
  const rows = new Map();
  for (const line of md.split(/\r?\n/)) {
    // `- key: **VERDICT** — …` (and a table row `| key | **VERDICT** | …`).
    const m = /^(?:-\s+(\S+?):|\|\s*(\S+?)\s*\|)\s*\*\*([A-Z][A-Z_-]*)\*\*(.*)$/.exec(line);
    if (m && !rows.has(m[1] ?? m[2])) rows.set(m[1] ?? m[2], { verdict: m[3], line: line.trim() });
  }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', md, rows };
}

async function runChild(work) {
  const results = { pass: 0, fail: 0, inconclusive: 0 };
  const line = (tag, name, why) => process.stdout.write(`${tag.padEnd(5)} ${name}${why ? `: ${why}` : ''}\n`);
  const inconclusive = (name, why) => {
    results.inconclusive += 1;
    line('INCONCLUSIVE', name, why);
  };
  const pass = (name) => {
    results.pass += 1;
    line('PASS', name);
  };
  const fail = (name, why) => {
    results.fail += 1;
    line('FAIL', name, why);
  };
  const expectRows = (name, v, expected) => {
    const wrong = [];
    for (const [key, want] of expected) {
      const got = v.rows.get(key);
      if (got?.verdict !== want) wrong.push(`${key}: expected ${want}, got ${got ? got.line : 'no row'}`);
    }
    if (wrong.length === 0) pass(name);
    else fail(name, `${wrong.length} wrong — ${wrong.join(' | ')}`);
  };

  // --- VRFY-11 / VRFY-12 / VRFY-13 rows ---
  {
    const keys = VRFY11.map(([k]) => k);
    const { root, dir } = await seedPaper(work, 'vrfy11', keys, `${VRFY11.map(([, , bib]) => bib).join('\n')}\n`);
    const v = verifySection(root, dir);
    // A lookup that got no answer (a throttled service — e.g. OpenAlex's keyless
    // daily budget for the metadata search) is reported, not counted: the row
    // is correctly UNVERIFIABLE-NETWORK, and what it would have been is unknown.
    const counted = [];
    for (const [key, want] of VRFY11) {
      const got = v.rows.get(key);
      if (got?.verdict === 'UNVERIFIABLE-NETWORK' && want !== 'UNVERIFIABLE-NETWORK') {
        line('INFO', `VRFY-11 ${key} not counted (no answer)`, got.line);
        // An expected refusal that never happened is not evidence of one.
        if (!want.startsWith('OK')) inconclusive(`VRFY-11 / VRFY-12: ${key} ${want}`, `not observed — its lookup got no answer (${got.line})`);
      } else counted.push([key, want]);
    }
    const NON_OK_LABEL = { fake2024: 'fake DOI FABRICATED', nobody2017: 'unknown work UNRESOLVABLE' };
    const observed = counted.filter(([, want]) => !want.startsWith('OK')).map(([key, want]) => NON_OK_LABEL[key] ?? `${key} ${want}`);
    expectRows(`VRFY-11 / VRFY-12: the acceptance list verifies at each registrar${observed.length > 0 ? ` (${observed.join(', ')})` : ''}`, v, counted);
    const noid = v.rows.get('lecun2015noid');
    if (noid && !/metadata search matched DOI 10\.1038\/nature14539/.test(noid.line)) fail('VRFY-12: the metadata-search row names the DOI it found', noid.line);
    else if (noid) pass('VRFY-12: the metadata-search row names the DOI it found');
  }

  // --- Review round 2: consortium works and identifier-less works ---
  {
    const { root, dir } = await seedPaper(work, 'round2', ROUND2.map(([k]) => k), `${ROUND2.map(([, , bib]) => bib).join('\n')}\n`);
    const v = verifySection(root, dir);
    const counted = [];
    for (const [key, want] of ROUND2) {
      const got = v.rows.get(key);
      if (got?.verdict === 'UNVERIFIABLE-NETWORK') line('INFO', `round 2 ${key} not counted (no answer)`, got.line);
      else counted.push([key, want]);
    }
    expectRows('VRFY-12 / VRFY-13 (review round 2): consortium works and identifier-less JMLR / NeurIPS / ICLR works verify OK', v, counted);
  }

  // --- VRFY-29 controls ---
  {
    const bad = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'known-bad-citations.json'), 'utf8'));
    const { root, dir } = await seedPaper(work, 'known-bad', bad.map((r) => r.citekey), bad.map(bibOf).join('\n'));
    expectRows(`VRFY-29: the ${bad.length} known-bad citations are FABRICATED`, verifySection(root, dir), bad.map((r) => [r.citekey, 'FABRICATED']));
  }
  {
    const mis = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'known-mis-cited.json'), 'utf8'));
    const { root, dir } = await seedPaper(work, 'known-mis-cited', mis.map((r) => r.citekey), mis.map(bibOf).join('\n'));
    expectRows(`VRFY-29: the ${mis.length} known mis-citations are MIS-CITED`, verifySection(root, dir), mis.map((r) => [r.citekey, 'MIS-CITED']));
  }

  // --- VRFY-15: Wakefield ---
  {
    const bib = '@article{wakefield1998,\n  author = {Wakefield, AJ and Murch, SH and Anthony, A},\n  title = {Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children},\n  journal = {The Lancet},\n  year = {1998},\n  doi = {10.1016/S0140-6736(97)11096-0},\n}\n';
    const { root, dir } = await seedPaper(work, 'wakefield', ['wakefield1998'], bib);
    const v = verifySection(root, dir);
    const row = v.rows.get('wakefield1998');
    const problems = [];
    if (row?.verdict !== 'RETRACTED') problems.push(`row ${row ? row.line : 'missing'}`);
    if (!/^pensmith verify: RETRACTED — wakefield1998: /m.test(v.stderr)) problems.push('no stderr warning');
    if (!/^Status: failed$/m.test(v.md)) problems.push('the section is not failed');
    if (v.status !== 4) problems.push(`exit ${v.status} (expected 4)`);
    if (problems.length === 0) pass('VRFY-15: the Wakefield paper is RETRACTED (VERIFICATION.md, stderr warning, section failed, exit 4)');
    else fail('VRFY-15: the Wakefield paper is RETRACTED', problems.join('; '));
  }

  // --- VRFY-13: research-to-verify self-consistency ---
  const lib = (rel) => import(pathToFileURL(path.join(REPO_ROOT, 'bin', 'lib', ...rel.split('/'))).href);
  const research = await lib('research-orchestrator.js');
  const { sourcePolicyFrom } = await lib('source-policy.js');
  const { crossCheckRetractions } = await lib('sources/retraction-cross-check.js');
  const { upsertSources, loadLibrary } = await lib('library.js');
  const { verifierBlindSpot } = await lib('source-context.js');
  for (const t of SELF_CONSISTENCY) {
    const name = `VRFY-13: ${t.name} self-consistency — verify blocks none of the sources research found`;
    try {
      const registry = research.researchRegistry();
      const plan = research.researchAdapterPlan({ registry, byPreference: true, discipline: t.discipline });
      const r = await research.runResearchPass({
        queries: t.queries,
        plan,
        registry,
        policy: sourcePolicyFrom(undefined),
        topic: t.topic,
        discipline: t.discipline,
        scope: t.topic,
        warn: (w) => line('INFO', `${t.name} research`, w),
      });
      const kept = r.kept.map((i) => i.candidate);
      line('INFO', `${t.name} research`, `${r.distinct} distinct candidate(s), ${kept.length} kept; ${r.adapters.map((a) => `${a.adapter} ${a.count} (${a.status})`).join(', ')}`);
      await crossCheckRetractions(kept);
      const root = path.join(work, `self-${t.discipline}`);
      mkdirSync(path.join(root, '.paper'), { recursive: true });
      await upsertSources(root, kept, { provenance: 'research' });
      const bibText = readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
      const inBib = new Set([...bibText.matchAll(/^@\w+\{([^,\s]+),/gm)].map((m) => m[1]));
      const entries = (await loadLibrary(root)).entries;
      // What the outline could be offered (D-18-37), and is in the bib.
      const cited = entries.filter((e) => inBib.has(e.citekey) && verifierBlindSpot(e, false) === null).map((e) => e.citekey);
      if (cited.length === 0) {
        fail(name, 'research found no citable source (see the INFO lines)');
        continue;
      }
      const { dir } = await seedPaper(work, `self-${t.discipline}`, cited, null);
      const v = verifySection(root, dir);
      const counts = new Map();
      const falseBlocks = [];
      for (const k of cited) {
        const row = v.rows.get(k);
        const verdict = row?.verdict ?? 'MISSING';
        counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
        if (verdict === 'UNVERIFIABLE-NETWORK') line('INFO', `${t.name} not measured`, row.line);
        else if (verdict !== 'OK' && verdict !== 'OK-BYO') falseBlocks.push(row ? row.line : `${k}: no row`);
      }
      line('INFO', `${t.name} verdicts`, [...counts].map(([k, n]) => `${k} ${n}`).join(', '));
      const measured = cited.length - (counts.get('UNVERIFIABLE-NETWORK') ?? 0);
      if (falseBlocks.length > 0) fail(name, `${falseBlocks.length} of ${cited.length} blocked — ${falseBlocks.join(' | ')}`);
      else if (measured === 0) fail(name, 'no citation could be checked (every lookup went unanswered)');
      else pass(`${name} (0 of ${measured} blocked)`);
    } catch (e) {
      fail(name, e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  }

  process.stdout.write(`live-verify: ${results.pass} passed, ${results.fail} failed, ${results.inconclusive} inconclusive\n`);
  if (results.fail > 0) return 1;
  return results.inconclusive > 0 && process.env.PENSMITH_LIVE_STRICT === '1' ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------

function runParent() {
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
  if (!email) {
    process.stderr.write(
      'live-verify: set PENSMITH_CONTACT_EMAIL to the project address (PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org) — ' +
        'Crossref, OpenAlex and Unpaywall ask for a contact.\n',
    );
    return 2;
  }
  if (!existsSync(CLI)) {
    process.stderr.write('live-verify: dist/bin/pensmith.js is missing — run `npm run build` first.\n');
    return 2;
  }
  const work = mkdtempSync(path.join(tmpdir(), 'pensmith-live-verify-'));
  const dataDir = path.join(work, 'data');
  mkdirSync(dataDir, { recursive: true });
  const env = { ...process.env };
  for (const k of [
    'NODE_TEST_CONTEXT', 'PENSMITH_TEST', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN', 'PENSMITH_NETWORK_TESTS',
    'PENSMITH_PAPER_ROOT', 'PENSMITH_RECORD_CASSETTES', 'PENSMITH_TEST_DATA_DIR',
  ]) delete env[k];
  // No model is asked: Pass 2 / Pass 4 and the research evaluator run as their stubs.
  env.PENSMITH_NO_LLM = '1';
  // A fresh, empty data dir: the HTTP cache cannot answer for the network.
  env.XDG_DATA_HOME = dataDir;
  env.LOCALAPPDATA = dataDir;
  env.HOME = dataDir;
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), __filename, '--child', '--work', work], { cwd: work, env, stdio: 'inherit' });
  if (process.env.PENSMITH_LIVE_KEEP === '1') process.stdout.write(`live-verify: kept ${work}\n`);
  else rmSync(work, { recursive: true, force: true });
  return r.status ?? 1;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  if (process.argv.includes('--child')) {
    const work = process.argv[process.argv.indexOf('--work') + 1];
    runChild(work).then(
      (code) => process.exit(code),
      (e) => {
        process.stderr.write(`live-verify: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
        process.exit(1);
      },
    );
  } else {
    process.exit(runParent());
  }
}
