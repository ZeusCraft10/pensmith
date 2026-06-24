# Phase 15: Foundation & Security Hardening - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 14 new/modified files across 6 independent HARD items
**Analogs found:** 14 / 14

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/lib/lock.ts` (modify stubFor) | utility | transform | `bin/lib/lock.ts` itself (existing stubFor:73-84) | self-modification |
| `bin/lib/compile.ts` (line 234 de-prefix) | utility | transform | `bin/lib/state.ts:112-113` (stateFile path.resolve convention) | role-match |
| `bin/lib/state.ts` / `bin/cli/add.ts` callers (lock resource cleanup) | utility | transform | `bin/lib/state.ts:112-113` (canonical pattern to align to) | role-match |
| `bin/lib/http.ts` (add checkSsrf + TokenBucket FIFO) | utility | request-response | `bin/lib/http.ts` itself (callOnce:495-516, TokenBucket:252-285) | self-modification |
| `bin/cli/add.ts` (replace false SSRF comment at :201-203) | route/CLI | request-response | `bin/cli/add.ts:254-266` (ask() approval gate pattern) | role-match |
| `bin/lib/pii.ts` (add deepRedactPii) | utility | transform | `bin/lib/pii.ts:336-366` (walkAndRedact — exact recursion model) | self-extension |
| `bin/lib/session-log.ts` (buildRecord:167-176 swap) | utility | transform | `bin/lib/session-log.ts:167-176` (buildRecord — the gap site) | self-modification |
| `bin/lib/pdf-text.ts` (byte cap + Promise.race timeout) | utility | file-I/O | `bin/lib/http.ts:530-548` (serverRetryDelay setTimeout pattern) | data-flow-match |
| `templates/prompts/claim-support.md` (fence untrusted fields) | config/prompt | transform | `templates/prompts/orphan-label.md` (same prompt structure) | exact |
| `templates/prompts/orphan-label.md` (fence untrusted fields) | config/prompt | transform | `templates/prompts/claim-support.md` (same prompt structure) | exact |
| `bin/lib/prompt-loader.ts` (WN-3 re-pin claim-support + orphan-label) | config | transform | `bin/lib/prompt-loader.ts:91-116` (EXPECTED_PROMPT_HASHES map — prior re-pins) | self-modification |
| `bin/lib/honesty.ts` (disclosure + consent gate + size cap) | service | request-response | `bin/cli/add.ts:254-266` (ask() consent gate), `bin/lib/honesty.ts:182-234` (scoreWithGptzero) | role-match + self-mod |
| `references/honesty-framing.md` (add disclosure copy) | config | transform | `references/honesty-framing.md` itself (locked framing structure) | self-modification |
| `bin/lib/budget.ts` (Semaphore audit + doc bare acquire/release) | utility | event-driven | `bin/lib/budget.ts:166-210` (Semaphore — already FIFO-correct) | self-audit |
| `.planning/SECURITY.md` (new — audit doc) | config/doc | — | per-phase `<threat_model>` blocks in existing PLAN.md files | structural-ref |
| `tests/lock-canonicalize.test.ts` (new) | test | — | `tests/lock.test.ts:59-80` (same-process serialization pattern) | exact |
| `tests/ssrf.test.ts` (new) | test | — | `tests/lock.test.ts` (fake-resolver injection pattern) | role-match |
| `tests/session-log-nested-pii.test.ts` (new) | test | — | `tests/pii.test.ts` (redactPii unit-test pattern) | role-match |
| `tests/pdf-text-bounds.test.ts` (new) | test | — | `tests/lock.test.ts` (error-message assertion pattern) | role-match |
| `tests/pass2-injection.test.ts` (new) | test | — | `tests/repo-files.test.ts:345-361` (hash-pin assertion pattern) | role-match |
| `tests/http-concurrency.test.ts` (new) | test | — | `tests/lock.test.ts:59-80` (concurrency serialization test) | exact |
| `tests/honesty.test.ts` (extend existing) | test | — | `tests/honesty.test.ts` (existing structure) | self-extension |
| `tests/repo-files.test.ts` (WN-3 re-pin hashes) | test | — | `tests/repo-files.test.ts:305-362` (PENDING_HASH_PINS array) | self-modification |

---

## Pattern Assignments

### HARD-01: `bin/lib/lock.ts` — canonicalize stubFor

**Analog:** `bin/lib/lock.ts:73-84` (current stubFor — the modification site)
**Also reference:** `bin/lib/state.ts:112-113` (stateFile — the canonical path.resolve convention)

**Current stubFor pattern** (`bin/lib/lock.ts:73-84`) — the site to modify:
```typescript
async function stubFor(resource: string): Promise<string> {
  const dir = pensmithLockDir();
  await fsp.mkdir(dir, { recursive: true });
  const hash = createHash('sha256').update(resource).digest('hex').slice(0, 12);
  const stub = path.join(dir, hash);
  // 'a' = O_WRONLY|O_CREAT|O_APPEND — create-if-missing without truncating.
  const fh = await fsp.open(stub, 'a');
  await fh.close();
  return stub;
}
```

**Canonical path.resolve convention to align to** (`bin/lib/state.ts:112-113`):
```typescript
function stateFile(paperRoot: string): string {
  return path.join(path.resolve(paperRoot), 'STATE.json');
}
```
State.ts comment (line 108-110): "Resolve the absolute path to STATE.json under `paperRoot`. Resolving up-front ensures the lock key (which is the file path) is identical across callers regardless of relative vs. absolute paperRoot input."

**Imports to add** (add to `bin/lib/lock.ts` existing imports at lines 36-40):
```typescript
import * as fs from 'node:fs';  // for fs.realpathSync.native (already has fsp, add sync)
```
Note: `path` and `fsp` already imported. Add `import * as fs from 'node:fs'` for `realpathSync.native`.

**Canonicalization insertion** — insert BEFORE `createHash` call at line 76:
```typescript
// HARD-01: Normalize before hashing so two callers targeting the same file via
// different path conventions (resolve vs join, symlinks on macOS /var→/private/var)
// always share the same stub → same lock.
let canonical = path.resolve(resource);
try {
  canonical = fs.realpathSync.native(canonical);
} catch {
  // File does not exist yet (lock acquired before creation) — path.resolve result is canonical.
}
if (process.platform === 'win32') {
  canonical = canonical.toLowerCase(); // NTFS is case-insensitive; case-fold for win32
}
const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
```

**Call-site cleanup** (`bin/lib/compile.ts:234`) — drop the `'compile:'` prefix:
```typescript
// BEFORE (line 234):
const lockResource = `compile:${join(paperDir(opts.paperRoot), '.compile.lock')}`;
// AFTER:
const lockResource = join(paperDir(opts.paperRoot), '.compile.lock');
```

**Test pattern** (`tests/lock.test.ts:59-80` — same-process serialization test to copy structure from):
```typescript
test('serialized within same process — second withLock waits for first', async () => {
  const r = 'test:serial:' + Date.now() + ':' + Math.random();
  // ... ordering / isLocked assertions ...
});
```

---

### HARD-02: `bin/lib/http.ts` — checkSsrf guard + add.ts false-comment fix

**Analog:** `bin/lib/http.ts:495-516` (callOnce — the injection site for checkSsrf)
**Also reference:** `bin/lib/http.ts:408-425` (CACHE_HEADER_ALLOWLIST — same allowlist pattern to mirror for scheme allowlist)

**callOnce (the injection site)** (`bin/lib/http.ts:495-516`):
```typescript
const callOnce = async (): Promise<HttpResponse> => {
  const reqInit: Parameters<typeof request>[1] = {
    method,
    headers,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  };
  if (opts.body !== undefined) {
    reqInit.body = opts.body;
  }
  const { statusCode, headers: rh, body } = await request(url, reqInit);
  // ...
};
```
`checkSsrf(url)` must be called BEFORE `request(url, reqInit)` inside `callOnce`. The guard is parameterized by `source === 'generic'` (or an explicit `opts.untrusted` flag) to avoid breaking internal trusted-host calls.

**Allowlist pattern to mirror** (`bin/lib/http.ts:408-417`):
```typescript
const CACHE_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
  'content-type',
  'etag',
  // ...
]);
```
Mirror as scheme allowlist: `const SSRF_ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:']);`

**Imports to add** (at top of `bin/lib/http.ts`):
```typescript
import { lookup as dnsLookup } from 'node:dns/promises';
```

**False comment to replace** (`bin/cli/add.ts:201`):
```typescript
// BEFORE (false claim):
// URL path — D-06 chokepoint, NEVER raw fetch (T-08-04-02 SSRF mitigation).
// AFTER:
// URL path — D-06 chokepoint routes through http.ts checkSsrf (T-08-04-02).
// checkSsrf resolves the hostname via DNS and blocks RFC1918/loopback/link-local.
```

**Offline test pattern** — injectable resolver via `fakeResolve` parameter (see `tests/lock.test.ts` for the general pattern of injecting test-only dependencies into library functions).

---

### HARD-03: `bin/lib/pii.ts` — add deepRedactPii + `bin/lib/session-log.ts` buildRecord fix

**Analog:** `bin/lib/pii.ts:336-366` (walkAndRedact — exact recursion structure to mirror)

**walkAndRedact (the model to mirror)** (`bin/lib/pii.ts:336-366`):
```typescript
function walkAndRedact(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) walkAndRedact(item);
    return;
  }
  if (!isPlainObject(node)) return;

  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    const val = node[key];
    if (SENSITIVE.has(lower)) {
      if (typeof val === 'string') {
        const redacted = redactPii(val);
        node[key] = redacted !== val ? redacted : '[REDACTED]';
      } else {
        node[key] = '[REDACTED]';
      }
      continue;
    }
    if (Array.isArray(val) || isPlainObject(val)) {
      walkAndRedact(val);
    }
  }
}
```

**isPlainObject guard (reuse as-is)** (`bin/lib/pii.ts:308-312`):
```typescript
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
```

**Gap site in buildRecord** (`bin/lib/session-log.ts:167-176`) — the loop to REPLACE:
```typescript
// CURRENT (only top-level strings):
for (const k of Object.keys(safe)) {
  const v = safe[k];
  if (typeof v === 'string') {
    safe[k] = redactPii(v);
  }
}
```

**Replacement** (`bin/lib/session-log.ts:167-176`) — use the new `deepRedactPii`:
```typescript
// AFTER: recurse into all string leaves (HARD-03)
for (const k of Object.keys(safe)) {
  safe[k] = deepRedactPii(safe[k]);
}
```
`deepRedactPii` must be exported from `pii.ts` and imported in `session-log.ts` alongside the existing `redactPii` import at line 29.

**deepClone pattern to reuse for null-prototype containers** (`bin/lib/pii.ts:318-332`):
```typescript
function deepClone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepClone);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(v)) {
      out[k] = deepClone(v[k]);
    }
    return out;
  }
  return v;
}
```
`deepRedactPii` follows the same null-prototype container pattern (`Object.create(null)`) for proto-pollution defense.

---

### HARD-04b: `bin/lib/pdf-text.ts` — byte cap + wall-clock timeout

**Analog:** `bin/lib/http.ts:530-536` (serverRetryDelay setTimeout pattern — same Promise + setTimeout shape)

**setTimeout-based delay pattern in http.ts** (`bin/lib/http.ts:530-536`):
```typescript
if (serverRetryDelay > 0) {
  const delay = serverRetryDelay;
  serverRetryDelay = 0;
  await new Promise<void>((r) => setTimeout(r, delay));
}
```

**Current call site without cap or timeout** (`bin/lib/pdf-text.ts:87-105`):
```typescript
async function parseWithRetry(input: Buffer): Promise<PdfParseResult> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return (await pdfParse(Buffer.from(input))) as PdfParseResult;  // line 93 — no cap, no timeout
    } catch (err: unknown) {
      // ...
    }
  }
  throw lastErr;
}
```

**extractPdfText entry point** (`bin/lib/pdf-text.ts:126-134`):
```typescript
export async function extractPdfText(buf: Buffer | Uint8Array): Promise<string> {
  if (!(buf instanceof Uint8Array) && !Buffer.isBuffer(buf)) {
    throw new TypeError('extractPdfText: input must be Buffer or Uint8Array ...');
  }
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  try {
    const result = await parseWithRetry(input);
```
Byte cap check goes BEFORE `parseWithRetry(input)` call; timeout wraps the `parseWithRetry` call as `Promise.race`.

**setImmediate delay pattern to copy** (`bin/lib/pdf-text.ts:100` — existing inter-attempt delay in parseWithRetry):
```typescript
await new Promise<void>((resolve) => setImmediate(resolve));
```
Timeout Promise follows this same `new Promise<never>((_, rej) => setTimeout(...))` idiom.

---

### HARD-04c: `templates/prompts/claim-support.md` and `orphan-label.md` — prompt injection fencing

**Analog:** `templates/prompts/orphan-label.md` / `templates/prompts/claim-support.md` (sibling prompts — same frontmatter + role + inputs + constraints + output structure)

**Current claim-support.md inputs section** (`templates/prompts/claim-support.md:15-20`) — the fields to fence:
```markdown
## Inputs
- `{{citekey}}` — the citation key the claim sentence references.
- `{{claim_sentence}}` — the exact sentence in the draft that carries the citation.
- `{{source_title}}` — the title of the cited source.
- `{{source_authors}}` — the author list of the cited source.
- `{{source_abstract}}` — the abstract (or available metadata text) of the cited source.
```
`{{claim_sentence}}` and `{{source_abstract}}` are the untrusted fields requiring fencing.

**Current orphan-label.md inputs section** (`templates/prompts/orphan-label.md:16-18`) — the fields to fence:
```markdown
## Inputs
- `{{sentence}}` — the single AMBIGUOUS sentence to classify.
- `{{paragraph_context}}` — the surrounding paragraph the sentence appears in.
```
Both `{{sentence}}` and `{{paragraph_context}}` are untrusted draft text requiring fencing.

**WN-3 re-pin protocol** (`tests/repo-files.test.ts:332-333`, `bin/lib/prompt-loader.ts:117-120`) — the EXACT two locations to update in the same commit:

Location 1 — `tests/repo-files.test.ts:332-333`:
```typescript
{ slug: 'claim-support', path: 'templates/prompts/claim-support.md', decision: 'Phase 5 D-12', hash: 'ceec7601dfeaf30117091aa788d9463c01b6ca9d3a9da4b47fb0f91983c82217' },
{ slug: 'orphan-label',  path: 'templates/prompts/orphan-label.md',  decision: 'Phase 5 D-12', hash: 'f8b385f3869691f4a419f35987d8b9a93018f28714519b36713fd7c2c0b829fc' },
```

Location 2 — `bin/lib/prompt-loader.ts:117-120`:
```typescript
'claim-support':       'ceec7601dfeaf30117091aa788d9463c01b6ca9d3a9da4b47fb0f91983c82217',
'orphan-label':        'f8b385f3869691f4a419f35987d8b9a93018f28714519b36713fd7c2c0b829fc',
```
Both locations carry IDENTICAL current hashes. After editing the prompt files, regenerate both and update both locations atomically in one commit. Regeneration command template:
```bash
node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('templates/prompts/claim-support.md')).digest('hex'))"
```

**Hash-pin loop enforcement** (`tests/repo-files.test.ts:345-361`):
```typescript
for (const pin of PENDING_HASH_PINS) {
  const isSentinel = pin.hash.startsWith('__PENDING_HASH_');
  test(`hash-pin: ${pin.path} (${pin.decision})`, { skip: isSentinel }, () => {
    const bytes = readFileSync(pin.path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      hash,
      pin.hash,
      `${pin.path} drifted from locked SHA-256. If the edit was intentional, update PENDING_HASH_PINS hash to ${hash} AND the matching entry in bin/lib/prompt-loader.ts EXPECTED_PROMPT_HASHES in the same commit (D-12 single-source rule).`,
    );
  });
}
```
The test fails (not skips) for non-sentinel entries. Missing the re-pin in either location = RED CI.

**Pass-2 interpolation site** (`bin/lib/verify/pass2.ts:237-243`):
```typescript
const prompt = interpolate(promptTemplate, {
  citekey: pair.citekey,
  claim_sentence: pair.claimSentence,      // untrusted draft text
  source_abstract: abstract,               // untrusted source abstract
  source_title: normalizeTitle(bibEntry?.title),
  source_authors: normalizeAuthors(bibEntry?.author),
});
```
No code change here — fencing goes in the template text only.

**Pass-4 interpolation site** (`bin/lib/verify/pass4.ts:430-432`):
```typescript
const prompt = interpolate(promptTemplate, {
  sentence: claim.sentence,               // untrusted draft text
  paragraph_context: paraText.slice(0, 500), // untrusted draft text
});
```
No code change here — fencing goes in the template text only.

---

### HARD-04a: `.planning/SECURITY.md` — milestone security audit

**Analog:** The per-phase `<threat_model>` blocks in existing PLAN.md files (e.g. `01-08-PLAN.md`) provide the input content. The audit document shape is new (no existing SECURITY.md).

**Threat model reference locations** (from RESEARCH.md):
- `bin/lib/pii.ts:1-18` — T-01-06, T-01-07, T-01-08, T-01-REDOS-01
- `bin/lib/lock.ts:1-35` — D-26, D-40, T-01-INFO-03
- `bin/lib/http.ts:1-50` — ARCH-12, ARCH-13, D-06, D-23, D-24, D-30

**Enforcing test locations per threat** (for PROVEN/UNPROVEN table):
- SSRF: `tests/ssrf.test.ts` (new, HARD-02)
- PII/key leak: `tests/pii.test.ts` + `tests/session-log.test.ts` / `tests/session-log-nested-pii.test.ts`
- Lock races: `tests/lock-canonicalize.test.ts` (new, HARD-01) + `tests/lock.test.ts`
- Prompt injection: `tests/pass2-injection.test.ts` (new, HARD-04c)
- Zero-trace: `tests/repo-files.test.ts` zero-trace fixtures (lines 212-236)
- pdf-parse bounds: `tests/pdf-text-bounds.test.ts` (new, HARD-04b)
- Key never logged: `tests/honesty.test.ts` (extended, HARD-05)
- Supply-chain / prompt drift: `tests/repo-files.test.ts` WN-3 pins (lines 305-361)

---

### HARD-05: `bin/lib/honesty.ts` — GPTZero disclosure + consent gate + size cap

**Analog:** `bin/cli/add.ts:254-266` (ask() consent gate pattern — exact structure to copy)

**ask() consent gate pattern** (`bin/cli/add.ts:254-266`):
```typescript
let doRemap = args.remap === true;
if (!doRemap && args.yolo !== true) {
  const answer = await ask({
    id: 'add-remap',
    kind: 'confirm',
    label: 'Source added. Remap sections to reference it?',
    default: false,
  });
  doRemap = answer.kind === 'confirm' ? answer.value : false;
}
```
For HARD-05: `args.yolo` equivalent is an options flag passed into `scoreWithGptzero`; non-TTY should silently decline (return null) rather than exit-3, since honesty score is advisory.

**scoreWithGptzero — the modification site** (`bin/lib/honesty.ts:182-234`):
```typescript
async function scoreWithGptzero(text: string): Promise<HonestyScore | null> {
  const apiKey = process.env['GPTZERO_API_KEY'];
  if (!apiKey) {
    process.stdout.write('pensmith: GPTZero API key not set — honesty score skipped.\n');
    return null;
  }
  if (isOfflineMode()) {
    return parseGptzeroResponse(offlineGptzeroResponse());
  }
  // Live branch:
  try {
    await assertBudget(...);
    const resp = await httpFetch(GPTZERO_URL, {
      method: 'POST',
      source: 'generic',
      noCache: true,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ document: text }),  // ← no size cap, no disclosure
    });
    // ...
  } catch { return null; }
}
```
Three additions before the `httpFetch` call:
1. Disclosure stdout write (always shown)
2. `ask()` consent gate (skipped in `--yolo` mode; silently decline in non-TTY rather than exit-3)
3. Size cap: `Buffer.byteLength(text, 'utf8') > GPTZERO_MAX_BYTES` → truncate

**Disclosure from locked framing file — load pattern** (`bin/lib/honesty.ts` loadFramingNote pattern to extend):
The new GPTZero-specific disclosure line must be added to `references/honesty-framing.md` (NOT inlined in code), then rendered at call time.

**WN-3 re-pin for honesty-framing.md** (`tests/repo-files.test.ts:204-210`):
```typescript
test('references/honesty-framing.md hash-pin (Phase 6 DONE-04 LOCKED)', () => {
  const bytes = readFileSync('references/honesty-framing.md');
  const hash = createHash('sha256').update(bytes).digest('hex');
  // Regenerate: node -e "..."
  const PINNED = '549bdecbfc0f167aa17fc542146fcdfa58117686a7a9ab2cb58e0db633fa3b0b';
  assert.equal(hash, PINNED, `references/honesty-framing.md drifted ...`);
});
```
This is a STANDALONE pin test (not in PENDING_HASH_PINS loop). After editing `references/honesty-framing.md`, update `PINNED` constant at line 208 in the same commit.

**Non-TTY divergence from add.ts pattern:** the add.ts gate exits-3 in non-TTY; honesty.ts must silently return null in non-TTY (advisory score, never blocking). Check `process.stdout.isTTY` before calling `ask()`.

---

### HARD-06: `bin/lib/http.ts` TokenBucket — FIFO waiter queue

**Analog:** `bin/lib/budget.ts:166-210` (Semaphore — already FIFO-correct with explicit waiter queue)

**Semaphore FIFO pattern (the model to copy)** (`bin/lib/budget.ts:166-210`):
```typescript
export class Semaphore {
  private max: number;
  private current = 0;
  private waiters: Array<() => void> = [];   // ← explicit FIFO queue

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current += 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.current += 1;
        resolve();
      });
    });
  }

  release(): void {
    if (this.current === 0) {
      throw new Error('Semaphore.release called more times than acquire');
    }
    this.current -= 1;
    const next = this.waiters.shift();  // ← FIFO: oldest waiter first
    if (next) next();
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }  // ← try/finally: no slot leak on exception
  }
}
```

**Current TokenBucket FIFO gap** (`bin/lib/http.ts:269-284`):
```typescript
async acquire(): Promise<void> {
  for (;;) {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillPerSec) * 1000);
    await new Promise<void>((r) => {
      setTimeout(r, Math.max(1, waitMs));  // ← all waiters race (non-FIFO)
    });
  }
}
```

**Key differences from Semaphore to apply:**
- Add `private waiters: Array<() => void> = []` field
- Add `private timerPending = false` flag (one timer at a time — prevents the race described in RESEARCH Pitfall 7)
- `acquire()`: fast-path when tokens available AND no waiters; else push to queue and trigger `_scheduleGrant()` only if no timer pending
- `_scheduleGrant()`: one setTimeout, on fire → `this.waiters.shift()` grants FIFO slot → if more waiters remain, recurse

**refill() method to preserve as-is** (`bin/lib/http.ts:262-268`):
```typescript
private refill(): void {
  const now = Date.now();
  const elapsedSec = (now - this.lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
  this.lastRefillMs = now;
}
```
`refill()` is unchanged; only `acquire()` is replaced and `_scheduleGrant()` is added.

---

## Shared Patterns

### Approval Gate (ask() consent pattern)
**Source:** `bin/cli/add.ts:258-266`
**Apply to:** HARD-05 (`honesty.ts` GPTZero consent gate)
```typescript
const answer = await ask({
  id: 'add-remap',
  kind: 'confirm',
  label: 'Source added. Remap sections to reference it?',
  default: false,
});
// answer.kind === 'confirm' ? answer.value : false
```
Import: `import { ask } from './prompts.js'` (already used in add.ts).

### WN-3 Re-Pin Protocol
**Source:** `tests/repo-files.test.ts:288-362` + `bin/lib/prompt-loader.ts:91-120`
**Apply to:** HARD-04c (claim-support + orphan-label) and HARD-05 (honesty-framing.md standalone pin)
- Prompt hashes: update BOTH `PENDING_HASH_PINS` in `tests/repo-files.test.ts` AND `EXPECTED_PROMPT_HASHES` in `bin/lib/prompt-loader.ts` in the SAME commit
- Framing hash: update `PINNED` constant directly in `tests/repo-files.test.ts:208` (standalone test, not PENDING_HASH_PINS loop)
- Regeneration command: `node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('<path>')).digest('hex'))"`

### Advisory-Never-Throws Error Handling
**Source:** `bin/lib/honesty.ts:229-233`
**Apply to:** HARD-04c (pass2/pass4 remain advisory), HARD-05 (scoreWithGptzero stays advisory)
```typescript
} catch {
  // Transport / budget / parse error → clean null skip (advisory-never-throws).
  return null;
}
```

### isPlainObject Guard (proto-pollution defense)
**Source:** `bin/lib/pii.ts:308-312`
**Apply to:** HARD-03 (`deepRedactPii` reuses `isPlainObject` without redefinition)
```typescript
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
```
`deepRedactPii` must be added to the SAME `pii.ts` file so it shares `isPlainObject` and `redactPii` directly.

### null-prototype output container (proto-pollution defense)
**Source:** `bin/lib/pii.ts:321-328` (deepClone)
**Apply to:** HARD-03 (deepRedactPii output objects)
```typescript
const out: Record<string, unknown> = Object.create(null);
for (const k of Object.keys(node)) {
  out[k] = deepRedactPii((node as Record<string, unknown>)[k]);
}
return out;
```

### Process-Platform Win32 Case-Fold Guard
**Source:** `bin/lib/lock.ts` header comment referencing the macOS `/var→/private/var` hazard (CI HOOK-04 fix)
**Apply to:** HARD-01 (stubFor canonicalization)
```typescript
if (process.platform === 'win32') {
  canonical = canonical.toLowerCase();
}
```

### try/finally lock release
**Source:** `bin/lib/lock.ts:187-204` (withLock try/finally)
**Apply to:** HARD-06 (bare acquire()/release() callers must wrap in try/finally per Semaphore.withLock model)
```typescript
export async function withLock<T>(...): Promise<T> {
  const releaseFn = await tryAcquire(resource, opts);
  try {
    return await fn();
  } finally {
    await releaseFn().catch(() => { /* swallow unlock errors */ });
  }
}
```

---

## No Analog Found

No files in this phase are entirely without analog. All patterns have direct counterparts in the existing codebase. The only structurally new file is:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/SECURITY.md` | doc/audit | — | No existing SECURITY.md in the repo; content is derived from per-phase `<threat_model>` blocks which do not have a document-level analog |

---

## Critical Ordering Constraints

These must be respected in the plan's wave design (extracted from RESEARCH.md):

| Constraint | Files | Reason |
|------------|-------|--------|
| HARD-01 must land before tests that exercise the lock system | lock.ts → lock-canonicalize.test.ts | Canonicalization in stubFor is the prerequisite for the two-convention test |
| WN-3 re-pin must land in the SAME commit as prompt file edits | claim-support.md + orphan-label.md → repo-files.test.ts + prompt-loader.ts | CI fails on hash drift immediately; no grace period |
| WN-3 re-pin for honesty-framing.md must land in SAME commit | honesty-framing.md → repo-files.test.ts:208 PINNED constant | Standalone pin test, not in PENDING_HASH_PINS loop |
| deepRedactPii export must precede session-log.ts import | pii.ts → session-log.ts | session-log.ts imports `deepRedactPii` from pii.ts |
| SECURITY.md is authored LAST | all HARD-01..06 implementations | It marks each threat PROVEN against its enforcing test — tests must exist first |

---

## Metadata

**Analog search scope:** `bin/lib/`, `bin/cli/`, `tests/`, `templates/prompts/`, `references/`
**Files scanned:** 20 source files read directly
**Pattern extraction date:** 2026-06-24
