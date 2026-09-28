// tests/byo-text.test.ts — SRC-15 (D-19-21, S-17): a bring-your-own PDF's
// text is read only through byoText, which re-hashes the PDF first. An edited
// PDF, a forged `.paper/sources/<citekey>.txt` or a poisoned cache never makes
// BYO text available.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestByoPdf } from '../bin/lib/byo-ingest.js';
import { byoText, byoTextCacheDir, resolveByoFile, sha256Hex } from '../bin/lib/byo-text.js';
import { loadLibrary, type LibraryEntry } from '../bin/lib/library.js';

const BYO = fileURLToPath(new URL('./fixtures/byo/', import.meta.url));

function paper(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-byotext-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

/** Ingest the arXiv-layout fixture (identified offline through the recorded arXiv answer). */
async function ingested(): Promise<{ root: string; entry: LibraryEntry }> {
  const root = paper();
  const o = await ingestByoPdf(root, path.join(BYO, 'attention-arxiv-layout.pdf'));
  assert.equal(o.status, 'added', JSON.stringify(o));
  const entry = (await loadLibrary(root)).entries[0]!;
  assert.ok(entry.byo);
  return { root, entry };
}

test('SRC-15: byoText serves the verified text, from the data-dir cache when its hash matches', async () => {
  const { root, entry } = await ingested();
  const r = await byoText(root, entry);
  assert.equal(r.available, true);
  assert.ok(r.available && r.fromCache, 'ingest cached the text under the PDF sha256');
  assert.ok(r.available && /Attention Is All You Need/.test(r.text));
  assert.equal(sha256Hex(r.available ? r.text : ''), entry.byo!.text_sha256);
  assert.ok(fs.existsSync(path.join(byoTextCacheDir(), `${entry.byo!.sha256}.txt`)), 'the cache lives in the data dir, outside the paper');
});

test('SRC-15: a poisoned cache is ignored — the PDF is re-extracted and must hash to text_sha256', async () => {
  const { root, entry } = await ingested();
  fs.writeFileSync(path.join(byoTextCacheDir(), `${entry.byo!.sha256}.txt`), 'Forged text that the PDF does not contain.');
  const r = await byoText(root, entry);
  assert.equal(r.available, true);
  assert.ok(r.available && !r.fromCache);
  assert.doesNotMatch(r.available ? r.text : '', /Forged/);
});

test('S-17: an edited PDF makes the text unavailable ("PDF changed since ingest")', async () => {
  const { root, entry } = await ingested();
  const file = resolveByoFile(root, entry.byo!.file)!;
  fs.appendFileSync(file, '\n% edited after ingest\n');
  const r = await byoText(root, entry);
  assert.equal(r.available, false);
  assert.match(r.available ? '' : r.reason, /PDF changed since ingest/);
});

test('S-17: a forged .paper/sources/<citekey>.txt is never read', async () => {
  const { root, entry } = await ingested();
  const forged = path.join(root, '.paper', 'sources', `${entry.citekey}.txt`);
  fs.writeFileSync(forged, 'The Transformer was invented in 1850 by a committee of horses.');
  // with the PDF intact the real text is served, never the .txt
  const ok = await byoText(root, entry);
  assert.ok(ok.available && !/horses/.test(ok.text));
  // with the PDF gone, nothing is available — the .txt does not stand in for it
  fs.rmSync(resolveByoFile(root, entry.byo!.file)!);
  const gone = await byoText(root, entry);
  assert.equal(gone.available, false);
  assert.match(gone.available ? '' : gone.reason, /is missing/);
});

test('S-17: a recorded path outside .paper/sources/ and an entry without a PDF are unavailable', async () => {
  const { root, entry } = await ingested();
  const outside = await byoText(root, { citekey: entry.citekey, byo: { ...entry.byo!, file: '../../etc/passwd' } });
  assert.equal(outside.available, false);
  assert.match(outside.available ? '' : outside.reason, /outside \.paper\/sources/);
  const none = await byoText(root, { citekey: 'x2020', byo: null });
  assert.equal(none.available, false);
  assert.equal(resolveByoFile(root, 'sources'), null, 'the sources folder itself is not a PDF');
});

test('SRC-15: an image-only PDF records no text hash and has no BYO text', async () => {
  const root = paper();
  const o = await ingestByoPdf(root, path.join(BYO, 'image-only.pdf'));
  assert.equal(o.status, 'added');
  const entry = (await loadLibrary(root)).entries[0]!;
  assert.equal(entry.hydrated, false);
  assert.equal(entry.byo!.text_sha256, null);
  const r = await byoText(root, entry);
  assert.equal(r.available, false);
  assert.match(r.available ? '' : r.reason, /no extractable text/);
});
