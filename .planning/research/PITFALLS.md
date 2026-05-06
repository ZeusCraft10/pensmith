# Pitfalls Research

**Domain:** AI-assisted academic writing with citation verification (two-tier: Claude Code plugin + portable Node CLI)
**Researched:** 2026-05-06
**Confidence:** HIGH on verifier/HTTP/PDF/path categories (multi-source verified); MEDIUM on hook/MCP timing details (single-source from official docs); LOW on style-match dual-use guardrails (no ecosystem precedent — novel territory)

This file validates and extends PRD §14 NFRs. Where the PRD is right, this calls it out. Where it's incomplete or risky, this surfaces what's missing.

---

## Critical Pitfalls

### Pitfall 1: Verifier "grades its own homework" — LLM-only citation verification defaults to looks-legit-to-me

**What goes wrong:**
The same kind of model that hallucinates citations is asked whether the citation is real. It says "yes, this DOI looks well-formed and matches the format Crossref uses." The pipeline reports SUPPORTED, the paper ships with a fabricated DOI, the user submits it, the instructor catches it, the user blames the tool.

This is the core failure mode of every existing "AI citation checker" — they reduce verification to a prompt that asks the model to evaluate its own output. The model has no privileged channel to ground truth.

**Why it happens:**
- LLMs produce extremely plausible-looking DOIs (correct registrant prefix, conference-style suffix, real-author-real-year combinations).
- Verification prompts that say "is this real?" are pattern-matching surface plausibility, not querying a registry.
- Even Pass-2 claim-support evaluation, if the cited source is unavailable, falls back to "the abstract sounds related to this claim" reasoning.
- Confirmation bias: the model wrote it; the model evaluating it has the same prior.

**How to avoid:**
1. **Pass 1 must be deterministic, not LLM-judged.** A real HTTP fetch against `api.crossref.org/works/<doi>` (or arXiv / PubMed) is the source of truth. 404 → FABRICATED, full stop. No LLM in this loop. PRD §14 is correct on this; do not soften it.
2. **DOI existence is necessary but not sufficient.** Real DOIs get attached to wrong claims constantly (an LLM cites a real Smith 2019 paper for a claim Smith 2019 doesn't make). Pass 1 must also fuzzy-match cited authors/title/year against the canonical metadata returned by Crossref. PRD §14 already requires this — guard against any future "simplification" that drops it.
3. **Calibrate Pass 2 prompts toward UNCLEAR.** When the cited paper's abstract is all that's available, the verifier should say UNCLEAR, not SUPPORTED. PRD §7.7 specifies this; the prompt-wording phase needs to test it on adversarial fixtures.
4. **Use a different model class for verification than for drafting where feasible** (e.g., a smaller deterministic model, or at minimum a fresh context window with no access to the prompt that produced the draft). Reduces shared-prior bias.
5. **Test against fabricated fixtures, not just real-world inputs.** PRD §14 requires `tests/fixtures/known-bad-citations.json` with 10+ fabricated DOIs flagged 10/10. This is the only meaningful regression gate.

**Warning signs:**
- Verifier passes a citation but no HTTP request was made (check `.paper/SESSION.log`).
- Pass 2 verdicts skew SUPPORTED at >80% on fixtures known to contain fabricated mappings.
- Test suite uses only real citations — no adversarial fabricated set.
- "Verification" output reads like a summary of the citation rather than a check against canonical metadata.

**Phase to address:** Foundation (DOI normalization + HTTP client deterministic core), Verify (Pass 1 + Pass 2 + Pass 3 implementation), Testing (the 10/10 fabricated fixtures gate ships in v0.1.0)

---

### Pitfall 2: DOI normalization is wider than people think — and the wide cases bite

**What goes wrong:**
Two citation strings that refer to the same paper compare unequal, so the verifier either re-fetches needlessly (cost) or, worse, treats them as different citations and reports inconsistent verification verdicts across the same paper. Or — the inverse — strings that look the same map to different DOIs because of trailing punctuation or angle brackets, and the verifier fetches the wrong record.

Concrete cases pensmith will see in the wild:
- `10.1145/Foo` vs `10.1145/foo` — DOI names are ASCII-case-insensitive per the DOI handbook, but real-world citations mix case wildly. ([DOI Handbook §case-insensitivity](https://www.doi.org/doi-handbook/HTML/case-insensitivity.html))
- `https://doi.org/10.1145/foo`, `http://dx.doi.org/10.1145/foo`, `doi:10.1145/foo`, plain `10.1145/foo` — all the same DOI.
- `10.1145/foo.` (trailing period from the citation sentence), `10.1145/foo,` (trailing comma), `10.1145/foo)` (caught by parenthetical citation extraction).
- Angle-bracketed: `<https://doi.org/10.1145/foo>`.
- DOIs with non-ASCII characters: case folding does *not* apply outside ASCII per the DOI handbook — `10.123/ABÇ` is a different DOI than `10.123/abç`. Easy to over-normalize.
- arXiv: old format `cs.CL/0501001` vs new `0501.0001` vs versioned `2401.12345v3` vs URL `https://arxiv.org/abs/2401.12345`.
- PubMed: PMID (`12345678`) vs PMCID (`PMC1234567`) — different namespaces, often confused.

**Why it happens:**
- Naive `s.toLowerCase()` plus URL-prefix-strip looks like it covers the cases. It misses non-ASCII pitfalls and citation-string punctuation.
- Developers test only on the 5 DOI shapes they thought of, miss the 10 that show up in real bibliographies.
- DOI registries themselves disagree on display case — Crossref documents lean uppercase historically, DataCite recommends lowercase display. There is no canonical case for display, only for comparison.

**How to avoid:**
1. **Single chokepoint.** All DOI / arXiv / PMID reads and writes go through `bin/lib/doi.js`. PRD §14 requires this — enforce with a lint that bans `/^10\./` regex anywhere except `doi.js`.
2. **Normalize for comparison, preserve original for display.** Store both `doi_canonical` (lowercase, no prefix) and `doi_as_cited` (raw from the user's draft) on every citation record. Verification compares canonical; reports show as-cited.
3. **Apply ASCII-only case folding.** Match the DOI handbook spec exactly: lowercase ASCII A–Z, leave non-ASCII alone. Document this in `bin/lib/doi.js` with a link to the handbook.
4. **Strip these prefixes (in order):** `<`, `https://doi.org/`, `http://doi.org/`, `https://dx.doi.org/`, `http://dx.doi.org/`, `doi:`, `DOI:`, `urn:doi:`. Then strip these trailing characters: `>`, `.`, `,`, `;`, `)`, `]`, whitespace.
5. **Separate normalizers for arXiv and PMID.** Don't reuse the DOI normalizer. arXiv has its own old/new format issue and a versioning suffix. PMID is a bare integer; PMCID is `PMC` + integer. They are distinct namespaces — refuse to fall through.
6. **Round-trip property test.** For every fixture in `tests/fixtures/known-good-citations.json`, run `normalize(format(normalize(x)))` and assert idempotence. This catches over-normalization (e.g., accidentally uppercasing non-ASCII).

**Warning signs:**
- Test fixtures all use lowercase ASCII DOIs (no real-world variety).
- HTTP cache shows the same DOI fetched multiple times under different keys.
- A user reports "the verifier flagged my real citation as FABRICATED" — likely a normalization miss.
- Code outside `bin/lib/doi.js` references DOIs by string without going through the normalizer.

**Phase to address:** Foundation (`bin/lib/doi.js` + cassette tests), Verify (Pass 1 uses canonical form for fetch + comparison)

---

### Pitfall 3: Quote drift — paraphrased text presented as a direct quote escapes verification because of PDF artifacts

**What goes wrong:**
The user's draft contains `"...attention is all you need..."` in quotation marks. The verifier fetches the OA PDF, extracts text, searches for that string, doesn't find it, marks NOT_FOUND. The user pushes back: "but the quote is right there on page 3!" — and they're right. The quote is in the PDF; pdf-parse's text extraction inserted a soft hyphen, decomposed an `fi` ligature into ` `, joined hyphenated line breaks wrong, or used straight quotes when the paper used curly quotes.

The inverse failure is worse: a PASS verdict on a quote that was actually paraphrased, because the verifier's fuzzy match is too loose.

**Why it happens:**
PDF text extraction has structural artifacts that defeat naive substring search:
- **Ligatures.** `fi`, `fl`, `ff`, `ffi`, `ffl` are sometimes single glyphs rendered as ` ` or `ﬁ` etc. depending on the font/encoding. ([compdf — PDF text extraction issues](https://www.compdf.com/blog/what-is-so-hard-about-pdf-text-extraction))
- **Hyphenated line breaks.** "benchmark" at end of line becomes `bench-\nmark`. Naive extraction yields `bench-mark` or `benchmark` depending on the library. ([Freiburg dehyphenation guide](https://ad-wiki.informatik.uni-freiburg.de/teaching/BachelorAndMasterProjectsAndTheses/DehyphenationAndGuessingLigatures))
- **Soft hyphens.** Invisible U+00AD characters get embedded in text and break exact-match search. ([Zotero forum — soft hyphen in extractions](https://forums.zotero.org/discussion/111357/extracted-pdf-highlights-include-soft-hyphen-u-00ad))
- **Smart vs straight quotes.** `"`/`"` (U+201C/U+201D) vs `"` (U+0022). Em-dash vs hyphen. Ellipsis as `…` (U+2026) vs `...`.
- **Column flow.** Two-column papers extracted in wrong reading order — sentence fragments spliced together.
- **Non-Latin scripts.** Greek letters in formulas, names with diacritics (`Müller` vs `Muller`, `Pérez` vs `Perez`).
- **Page breaks mid-sentence.** Headers/footers/page numbers inserted into the middle of quotable text.

**How to avoid:**
1. **Normalize both sides before comparison.** Apply the same transformation to the user's quote and the extracted text:
   - NFKC Unicode normalization
   - Smart-quotes → straight quotes (`"` `"` `'` `'` → `"` `'`)
   - En/em-dashes → hyphens for matching purposes (preserve original for display)
   - Ellipsis variants `…` ↔ `...`
   - Strip soft hyphens (U+00AD) entirely
   - Decompose known ligatures (`ﬁ` → `fi`, `ﬂ` → `fl`, etc.)
   - Collapse runs of whitespace to single spaces
   - Join `word-\nword` → `wordword` (de-hyphenation across line breaks; case-sensitive heuristic on whether the joined form is a real word)
2. **Tiered match.** Try exact match on normalized text first (PASS). Then fuzzy match — Levenshtein ratio ≥ 0.95 over a sliding window of the quote length (FUZZY_MATCH, with diff shown). Only NOT_FOUND if both fail.
3. **Show the diff on FUZZY_MATCH.** The user needs to see what changed (a missing comma, a "the" → "a") to judge whether to accept. Do not silently auto-PASS fuzzy matches.
4. **Respect the threshold.** A 0.95-ratio match on a 5-word quote is meaningless (one wrong word out of five is still a 0.80 ratio). Require minimum quote length (e.g., 10 words) for fuzzy matching; below that, exact-only.
5. **Never silently rewrite the user's quote.** If we found a near-match in the source and want to suggest the canonical form, surface it as a recommendation, not an autocorrection. This is the user's prose.
6. **Test fixtures must include real PDF artifacts.** `tests/fixtures/known-bad-quotes.json` should have at least one of each: ligature, hyphenated line break, smart quote, ellipsis variant, diacritic. PRD §14 specifies 10+ NOT_FOUND fixtures — at least half should exercise these artifact categories, not just outright paraphrases.

**Warning signs:**
- Pass 3 NOT_FOUND rate spikes when ingesting a particular publisher's PDFs (likely a font/ligature class issue).
- Users report PASS verdicts on quotes they later discover were paraphrased.
- Quote-verify code path doesn't normalize Unicode (search for `NFKC` in the codebase).
- Test fixtures use clean text-extracted strings, not real PDF outputs.

**Phase to address:** Foundation (PDF parsing library choice — PRD §17 open question), Verify (Pass 3 implementation), Testing (artifact-bearing fixtures in v0.1.0)

---

### Pitfall 4: State corruption — atomic write done wrong, lock files race, OneDrive eats the file

**What goes wrong:**
- Process crashes mid-write to `STATE.md`. Next session reads a half-written file, corrupted JSON/YAML, can't parse, refuses to start. User loses session.
- Two `/pensmith` sessions in the same paper folder both decide they hold the lock (PID-only check, no timestamp) and trample each other's section drafts.
- A stale lock from a crashed session blocks every subsequent run for hours until the user finds the lock file and deletes it manually.
- File rename is atomic on POSIX but **not on Windows when a sync client like OneDrive is watching the directory** — OneDrive can see the `.tmp` file mid-rename and create `STATE-fedora-safeBackup-0001.md`-style backup copies, leaving the project with three competing state files. ([abraunegg/onedrive #3439](https://github.com/abraunegg/onedrive/issues/3439))
- This project itself lives in `OneDrive - Roanoke College/Documents/Github/pensmith` — meaning during development, every state file write the developer makes is being raced against OneDrive.

**Why it happens:**
- "Atomic write" is shorthand. The actual recipe is: write to `tmp` → fsync the file → rename to final → fsync the directory. Skipping the directory fsync means the rename can survive a crash but the file content can be empty.
- Lock files often store only a PID, with no timestamp or hostname. PID reuse on long-uptime systems makes this unsafe; cross-machine sync (OneDrive again) makes it nonsensical.
- "Stale lock auto-clear" is implemented as "older than X seconds" but X is shorter than the longest legitimate operation (Pass-2 verification on a section can take 90+ seconds), so legitimate sessions get killed.
- Sync clients are not directory-aware about atomic rename — they sync files in whatever order they see filesystem events.

**How to avoid:**
1. **Atomic write recipe (in `bin/lib/state.js`):** `write tmp` → `fsync(tmp)` → `rename(tmp, final)` → `fsync(dir)`. Test by power-cycling mid-write in a fixture.
2. **Lock file content:** PID + start ISO timestamp + hostname + (optional) a heartbeat timestamp updated every 30s. Stale-lock policy: heartbeat older than 5× the heartbeat interval AND PID not running on this host → lock is dead.
3. **Lock file location must be local-only.** Put it in a path that is *not* synced — under `~/.pensmith/locks/<project-hash>.lock` (platform data dir per PRD §14), not inside `.paper/`. This sidesteps OneDrive entirely for the lock.
4. **Detect OneDrive/iCloud/Dropbox sync at intake** (probe `.paper/`'s ancestors for known sync-folder markers). When detected, surface a doctor-level warning and consider a `.paper/` location override (`pensmith_data_dir` config) that points outside the sync folder while keeping the paper artifacts (PROJECT.md, DRAFT.md, exports) inside it. Critical: this project's own dev folder is in OneDrive — the team will hit this immediately.
5. **Add `.paper/` to a sync-exclude pattern by default** where the OS supports per-folder exclusion (Windows OneDrive supports this via Files On-Demand and explicit exclusion; macOS iCloud doesn't). Document the manual fallback.
6. **Never trust `existsSync` for lock acquisition.** Use `O_EXCL | O_CREAT` open semantics where the runtime exposes them; on Windows, `fs.open` with `wx` flag.
7. **Two processes in the same `.paper/` is a refuse, not a merge.** "Two pensmith instances detected" → second one prints lock holder info and exits.

**Warning signs:**
- `STATE.md` parse errors after crashes.
- `.paper/` directory contains files like `STATE-fedora-safeBackup-0001.md` or `~$STATE.md` (sync-client artifacts).
- Users on Windows report "pensmith says another session is running but I don't have one" — sync of the lock file from another machine.
- Lock acquisition uses `if (!exists) write`; that's a TOCTOU race.

**Phase to address:** Foundation (state.js + lock.js + paths.js); doctor health check for sync-folder detection in v0.1.0

---

### Pitfall 5: Schema migration regrets — adding `schema_version` later is painful; not handling old HANDOFF.json after `/compact` is worse

**What goes wrong:**
v0.1.0 ships without `schema_version`. v0.2.0 adds a field to `HANDOFF.json` (e.g., section dependency graph). User upgrades, runs `/compact` mid-session, SessionStart hook reads the old HANDOFF.json, can't find the new field, either crashes or silently misinterprets old data as new. User loses 3 hours of section work.

The inverse failure: schema is versioned but migrations are read-time only and accidentally run against `STATE.md` files mid-write (during another process's atomic rename), corrupting them.

**Why it happens:**
- "We can add it later" is true for the field but not for the migration path. Once shipped without versioning, every read site has to handle "no version present" specially forever.
- Migration-on-read can race with concurrent writes if not bracketed by the lock.
- HANDOFF.json is special: it's written by PreCompact (under time pressure, see Pitfall 14) and read by SessionStart (immediately after a context reset). If the schema bumps between those two events (impossible in normal use, possible across a `npm update` mid-session), reads fail.

**How to avoid:**
1. **Day-one schema versioning.** Every state file (`config.toml`, `STATE.md`, `HANDOFF.json`, `sections/*/PLAN.md`, `sections/*/VERIFICATION.md`) has a `schema_version: 1` field on day one. PRD §14 mandates this — do not defer.
2. **Empty migrations directory in v0.1.0.** `bin/lib/migrations/1-to-2.js` doesn't exist yet; the directory exists with a README explaining the contract. This keeps the discipline live before you have something to migrate.
3. **Migrate on read, in-memory only.** Reading an old version → migrate to current in memory → use. Never write the migrated form back without a lock and without user acknowledgement (a banner: "Pensmith is updating your project files from schema v1 → v2. Backup written to `.paper/.backup-pre-v2/`").
4. **Refuse forward-incompatible reads.** If `schema_version > current`, refuse to load. "This project was created with a newer pensmith. Upgrade pensmith or open in the matching version." Better than silent data loss.
5. **HANDOFF.json carries the schema version of the producing process**, not just of the file format. SessionStart hook compares both — if pensmith was upgraded mid-/compact, the resume path can warn and fall back to a coarser checkpoint.
6. **Tag every state file with `produced_by_pensmith_version`.** Useful in bug reports.

**Warning signs:**
- Code paths that read state files contain `if (!data.schema_version) treatAsV0()` — ship-blocker; should be unreachable in v0.1.0.
- No automated test that round-trips a v1 file through a v1→v2 migrator.
- Migration code writes back to disk without acquiring the lock first.

**Phase to address:** Foundation (schema versioning across all state files; migrations directory with README; refuse-forward-incompat read behavior); explicitly tested in `tests/migrations.test.js` per PRD §14

---

### Pitfall 6: Cost overruns — uncapped LLM loops, runaway parallel subagents, retry storms

**What goes wrong:**
- Verifier hits an UNCLEAR verdict on a citation, retries with a more elaborate prompt, gets UNCLEAR again, retries again. No retry cap. $40 burned on one section.
- Tier 1 wave scheduler spawns 12 parallel section writers, each pulling 5 OA full-texts, each running 8-claim Pass 2 — instantaneous $20 spike, no abort.
- HTTP retry on transient errors uses exponential backoff but no overall budget — a 2-hour Crossref outage means hundreds of retries per DOI, all billed if the LLM is asked to "summarize what we tried."
- A user with `--yolo` runs `done` on a 15-section paper, hits some bad luck, gets billed $80 in 4 minutes, no abort.

**Why it happens:**
- Cost meters are per-step but no global cap aborts.
- Retries assume eventual success; nobody designs the "give up" path.
- Parallel = fast = expensive; the architecture that makes Tier 1 desirable is the same one that explodes the bill.
- LLM calls aren't traced to a budget owner; one runaway subagent isn't visible until token counts are reconciled at the end.

**How to avoid:**
1. **Hard cap, default $5/session, abort + confirm to extend.** PRD §14 already requires this — verify the abort happens *before* the call, not after billing. Pre-flight token estimate vs remaining budget.
2. **Per-step budgets, not just session.** Verifier Pass 2 has its own cap (e.g., $0.50/section). If a section exhausts its budget, mark UNCLEAR and surface to user instead of looping.
3. **Retry caps everywhere.** Max 3 attempts per LLM call. After 3 UNCLEARs, escalate to user, do not auto-retry.
4. **Parallel subagent fan-out cap.** Wave size ≤ N (configurable, default 5). User can override via `--max-parallel`.
5. **Cost meter visible during execution**, not just in `/pensmith status`. Live updating banner during long sections. Users report runaway costs always cite "I didn't notice until it was over."
6. **`--estimate` is mandatory before `--yolo`.** Refuse `--yolo` if estimate exceeds 50% of cap.
7. **Distinguish HTTP retries (free) from LLM retries (expensive)** in the budget code. They share retry/backoff infrastructure; budgeting must be separated.

**Warning signs:**
- A session log shows the same prompt sent 5+ times with no human in the loop.
- Token counts in `.paper/SESSION.log` for a single section exceed 5× the section's word count × 4 (rough drafting ratio).
- `/pensmith status` shows cost cap hit but the session continued.
- Tests don't simulate budget exhaustion.

**Phase to address:** Foundation (`bin/lib/budget.js` + `bin/lib/runtime.js` integration), every workflow that calls LLMs (per-step caps), tier-contract tests must include a budget-exhaustion fixture

---

### Pitfall 7: HTTP client gotchas — banned User-Agents, thundering herd retries, cache key collisions

**What goes wrong:**
- Crossref bans the polite-pool IP after the User-Agent header lacks a `mailto:` and the request rate exceeds 50 req/s. User reports "everything stopped verifying." Pensmith retries → still banned → feedback loop. ([Crossref REST API auth docs](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/))
- Exponential backoff without jitter: when Crossref returns a 429 mid-wave, all 5 parallel verifier subagents back off the same amount, retry simultaneously, get 429 again. Thundering herd.
- HTTP cache key is `url` only; two requests with different `Accept` headers or different `mailto` parameters return cached wrong response.
- 503 from arXiv ignored — arXiv requires 1 req per 3 seconds and bans tighter; cassette tests pass, live runs fail. ([arXiv API user manual](https://info.arxiv.org/help/api/user-manual.html))
- OpenAlex deprecated email-only polite pool: API key required from ~Mar 2026 (Feb 13, 2026 announcement). Code that depends on `mailto=` in URL stops working. ([OpenAlex rate limits & auth](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication))

**Why it happens:**
- Defaults are easy; correct behavior under load is not the default.
- Test cassettes hide rate-limit behavior — every cassette is 200 OK.
- Polite-pool conventions are documented but not in any one place; developers read Crossref's docs but not arXiv's.
- API contracts change (OpenAlex adding API keys is a 2026 change after PRD was written).

**How to avoid:**
1. **All HTTP through `bin/lib/http.js`.** PRD §14 mandates this; enforce by linting against `fetch`/`http`/`https`/`undici` outside this module.
2. **Polite User-Agent format**, baked in:
   `pensmith/<version> (+https://github.com/.../pensmith; mailto:<PENSMITH_CONTACT_EMAIL>)`.
   Refuse to start without `PENSMITH_CONTACT_EMAIL` set; doctor command checks this.
3. **Per-source rate limits, not one global limit:**
   - Crossref: 50 req/s public/polite ([Crossref blog — rate limit changes](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/))
   - OpenAlex: 15,000/hour polite, 100,000/day cap; **API key required from 2026** — surface in doctor; add `OPENALEX_API_KEY` config slot now even if unused initially
   - arXiv: 1 req per 3 seconds, single connection ([arXiv API user manual](https://info.arxiv.org/help/api/user-manual.html))
   - PubMed E-utilities: 3 req/s without API key, 10 req/s with
4. **Honor Retry-After, X-Rate-Limit-Limit, X-Rate-Limit-Interval headers.** Crossref publishes these — read them, don't guess.
5. **Backoff = base × 2^attempt + random jitter** (full jitter recommended, not "equal jitter"). `delay = random(0, base × 2^attempt)`. PRD §14 names "exponential with jitter" — make sure the implementation actually has the random component.
6. **Cache key = `(method, url, sorted relevant headers, body hash)`.** Not just URL. Document which headers count.
7. **Ban-recovery state.** If a 429 storm repeats N times within M minutes, circuit-break the source for K minutes and surface to the user. Better than retrying into a longer ban.
8. **Cassette tests must include 429, 503, and Retry-After fixtures.** Not just happy-path 200s.

**Warning signs:**
- HTTP module exposes raw `fetch`; other modules call it directly.
- All cassettes are 200 OK.
- No test exercises Retry-After.
- `OPENALEX_API_KEY` not in config.toml schema (will be required in production by mid-2026).

**Phase to address:** Foundation (`bin/lib/http.js`); ecosystem (`/pensmith doctor` checks per-source rate-limit headroom); per-source clients in research phase

---

### Pitfall 8: Cross-platform path landmines — Windows MAX_PATH, sync clients, AppData vs ~/.pensmith

**What goes wrong:**
- Windows path length: `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\.paper\sections\03b-validity-threats\VERIFICATION.md` = ~140 chars before the project path + section name expansion. Some operations (long subagent context dumps) generate filenames that push past the 260-char `MAX_PATH` limit, fail mysteriously on Windows. Long path support exists since Windows 10 1607 but requires opt-in registry/manifest.
- Case sensitivity: `Sections/03-Methods/PLAN.md` and `sections/03-methods/plan.md` are the same file on macOS/Windows default and different files on Linux. A test passes on macOS, fails in CI on Linux.
- The user's machine *right now* has the project under `OneDrive - Roanoke College`, with a space and a hyphen — both legal but landmine-prone in shell scripts that don't quote paths.
- `~/.pensmith` on macOS/Linux vs `%APPDATA%\Pensmith\` on Windows vs `$XDG_DATA_HOME/pensmith` on Linux when the user has set XDG variables. PRD §14 specifies all three; if `paths.js` falls back to `os.homedir() + '/.pensmith'` on a Windows machine where `%APPDATA%` is on a different drive, you've broken the user's library index.
- File watchers (chokidar etc.) on case-insensitive filesystems double-fire events for case-permuted paths.

**Why it happens:**
- Devs build and test on one OS, ship to all three. Path bugs are platform-specific.
- `path.join` is necessary but not sufficient — it doesn't handle case, length, or sync-folder detection.
- "I'll just use ~" works until %APPDATA% isn't %USERPROFILE%/AppData/Roaming.

**How to avoid:**
1. **Path resolution through `bin/lib/paths.js`.** PRD §14 mandates this; lint against direct `os.homedir()` use.
2. **Use the platform conventions exactly:**
   - Windows: `%APPDATA%\Pensmith\` (for `~/.pensmith` equivalent), respect `%LOCALAPPDATA%` for caches
   - macOS: `~/Library/Application Support/Pensmith/`
   - Linux: `$XDG_DATA_HOME/pensmith` (default `~/.local/share/pensmith`); cache in `$XDG_CACHE_HOME/pensmith`
3. **Always quote paths in shell-out calls.** Spaces in OneDrive paths break `pdf-parse → pymupdf` shell-out if not quoted.
4. **Section folder names: lowercase, ASCII, hyphen-separated.** Never rely on case to differentiate `01-Intro` from `01-intro`. Slugify aggressively.
5. **Detect long paths proactively.** On Windows, if `cwd().length + max-section-suffix > 240`, warn at intake. Suggest moving the project closer to the drive root.
6. **Detect sync folders at intake.** OneDrive (`OneDrive - <Org>`, `OneDrive`), iCloud (`Library/Mobile Documents/com~apple~CloudDocs`), Dropbox (`Dropbox`), Google Drive (`Google Drive`, `My Drive`). Surface a warning + `--data-dir` override.
7. **`/pensmith doctor` checks** all of: data-dir writable, long-path-tolerant, no sync-folder collision with `.paper/locks/`, free disk space > 100MB.
8. **CI runs on linux-x64, macos-arm64, windows-x64.** Tests that touch the filesystem must pass on all three.

**Warning signs:**
- Code uses `path.join('~', '.pensmith')` (literal tilde — doesn't expand on Windows).
- Tests skip on Windows.
- File-not-found errors that vanish when the project is moved closer to drive root.
- Filename collisions reported by users on Linux.

**Phase to address:** Foundation (`bin/lib/paths.js`); doctor checks across all three platforms; CI matrix in v0.1.0

---

### Pitfall 9: Two-tier drift — capability blocks rot, MCP-only assumptions leak, parallel/sequential mismatches

**What goes wrong:**
- A workflow body adds a step that uses `Task` tool for parallel verification, with no `<capability_check>` block. Tier 1 runs it; Tier 2 errors out with "Task tool not available."
- `<capability_check>` blocks exist but get out of date — Tier 1 path uses MCP for state, Tier 2 path uses files, but a new state field was added only to the MCP path. `tests/tier-contract.test.js` doesn't catch it because the test fixture exercises both tiers but only inspects the final output, not the intermediate state.
- An agent prompt assumes `AskUserQuestion` is available; Tier 2's stdin fallback rephrases the same prompt as a flat-text question and the user's stdin response is routed to the wrong field.
- Tier 1 wave scheduling writes sections in parallel and merges; Tier 2 writes sequentially and depends on each section's verification before starting the next. A workflow body that's "the same" semantically may produce subtly different sections because Tier 1's section 4 saw section 2's draft as context but Tier 2's section 4 saw section 2's verified draft.
- Same model for both tiers is not guaranteed — Tier 2 against Ollama produces lower-quality prose. Tests that gate on prose similarity are flaky. PRD §15 explicitly accepts "lower prose quality" for Tier 2 — codify what's actually being tested in tier-contract tests.

**Why it happens:**
- Two-tier is a discipline, not a default. Every new feature has a Tier-1 happy path that "works on my machine" and the Tier-2 path is an afterthought.
- Capability checks are inline markdown — easy to forget to update.
- Tests check final outputs, miss intermediate drift.
- Tier 1 has tools (Task, MCP, AskUserQuestion) that don't have clean Tier 2 analogs; the temptation is to either skip the feature in Tier 2 or fake the tool.

**How to avoid:**
1. **`tier-contract.test.js` is a hard gate.** PRD §14 mandates this. Run it on every commit. If it red, no merge.
2. **Test what's checkable, accept what's not.** Final outputs (verification verdicts, citation lists, section structure) are checkable for equivalence. Prose is not — assert prose passes a much weaker check (length within ±20%, citation count exact, no FABRICATED).
3. **Capability check schema.** Don't just write `<capability_check>` blocks freeform. Define a JSON schema for what capabilities exist (`task_parallel`, `mcp_state`, `ask_user_question`, `pandoc`, `zotero_mcp`, `humanizer_skill`) and machine-validate that every workflow body declares which it uses. Lint catches missing declarations.
4. **Single shared state representation.** Both tiers must read/write `.paper/` files. MCP in Tier 1 is a *cache* over the filesystem, not a parallel state store. After every MCP write, the file must reflect the same data. Tests verify this invariant.
5. **stdin fallback uses the same prompt structure as AskUserQuestion.** Don't rephrase. JSON-structured question objects, rendered to stdin as numbered options.
6. **Wave scheduling produces the same section content regardless of order.** Section drafter's prompt should not include "previous sections you've written" as context — that's how parallel/sequential drift creeps in. Section drafters see only their own PLAN.md and mapped sources. PRD §7.6 already specifies this — protect it.
7. **Tier 2 ships a `--simulate-tier-1` mode for debugging.** Useful for diff-bug-reports.

**Warning signs:**
- A new feature PR touches only `mcp/server.js` or only `bin/pensmith-cli.js`.
- Capability blocks have rotted: `<capability_check name="task_parallel">` exists but the workflow uses Task elsewhere without checking.
- `tier-contract.test.js` passes but the two tiers' outputs differ on a hand-run smoke test.
- An agent prompt mentions a tool name (`AskUserQuestion`).

**Phase to address:** Foundation (capability schema + tier-contract test framework); every workflow phase enforces it; CI red on drift

---

### Pitfall 10: Section-as-phase invariant violations — cross-section coupling, smoothing corruption, renumbering chaos

**What goes wrong:**
- The "section drafter sees only its mapped sources" rule (PRD §7.6) gets violated when a developer adds "for context, here are the previous sections" to the section writer's prompt. Suddenly section 4's draft depends on section 3's prose; redoing section 3 invalidates section 4 silently.
- Cross-section smoothing in compile (§7.8) rewrites the last paragraph of section N and the first paragraph of section N+1. Bug: smoothing accidentally drops a citation that was load-bearing for the section's verification (the section now has 0 citations to source X but PLAN.md still says it does). Section appears verified but isn't anymore; verification is stale.
- Cross-section claim consistency check (§7.8) decides section 2 and section 4 contradict each other and "fixes" section 4. This re-edits the verified draft. Verification should re-run on the affected section; it doesn't. Verified citations now don't support the modified claim.
- Section renumbering: user inserts a section between 3 and 4. PRD §17 recommends stable numbering with `03b-foo/`. But the developer implemented "renumber the rest" — sections 4-7 are now 5-8; HANDOFF.json references stale numbers; resume points to a section that no longer exists at that path.
- Two parallel section writers in the same wave both want to update OUTLINE.md to reflect their final word counts. Last write wins; one wave's update is silently lost.

**Why it happens:**
- Section isolation is a discipline maintained by directory layout — but prompt engineering can re-couple them invisibly.
- "Helpful" features (smoothing, consistency checks, renumbering) are exactly the features that violate isolation.
- Renumbering feels cleaner aesthetically; stable numbering with `03b-` looks ugly to engineers who think in arrays.

**How to avoid:**
1. **Section drafter prompt has a hard contract.** Inputs: `PLAN.md` (this section), mapped sources (this section), STYLE.json (if enabled), section-level voice hint (if set). Nothing else. Lint the agent's input map.
2. **Smoothing pass writes to a separate file, not back to `sections/<N>/DRAFT.md`.** `.paper/DRAFT.md` is the smoothed assembly; sections retain their pre-smooth prose. Verification still runs against the section files, which are immutable post-verify. If smoothing changes a paragraph's citation, the smoothing pass *fails the compile*, doesn't ship.
3. **Compile is read-only on `sections/<N>/DRAFT.md`.** No exception.
4. **Cross-section consistency check produces flags, not edits.** When sections 2 and 4 contradict, surface to user. User picks which to revise. Then a normal `plan <N> --revise` → `write <N>` → `verify <N>` cycle runs on the chosen section. Compile re-runs.
5. **Stable numbering with letter suffixes.** `01-intro`, `02-background`, `03-methods`, `03b-validity-threats`, `04-results`. PRD §17 recommends this — accept the recommendation, do not renumber. Sort order is alpha-numeric on the prefix, which works as long as no section-prefix is `>99`.
6. **Section-folder writes during a wave use file locking.** OUTLINE.md updates are serialized through the project lock, even when multiple sections are being written in parallel.
7. **Verification staleness check.** Every section has a `verified_against_draft_hash`. Compile checks each section's draft hash matches the hash at verification time. Mismatch → re-verify.

**Warning signs:**
- Section drafter prompt template references "previous sections" or "the paper so far."
- After compile, `sections/<N>/DRAFT.md` differs from `.paper/DRAFT.md`'s extracted section N.
- Cross-section consistency check writes to section files.
- HANDOFF.json points to a section number that no longer exists at the expected path.
- User says "I redid section 3 and now section 4 looks weird."

**Phase to address:** Foundation (section folder layout + numbering policy); Compile (read-only contract on section files; smoothing + consistency check produce flags only); Verify (verified_against_draft_hash)

---

## Moderate Pitfalls

### Pitfall 11: Plagiarism check — DuckDuckGo HTML scraping false positives, UA bans, n-gram size

**What goes wrong:**
- Distinctive phrase extraction picks "the central limit theorem states that" as distinctive (it's not — it's a textbook convention). Searches the web, finds 50,000 hits, reports plagiarism. User loses trust.
- DuckDuckGo HTML endpoint detects a scraping pattern, bans the IP, returns CAPTCHA pages indefinitely. Pensmith retries, escalates to ban.
- N-gram size 3 → too short, every common phrase matches. N-gram size 12 → too long, paraphrased plagiarism slips by.
- A real plagiarized paragraph appears in 0 web hits because the source is paywalled or PDF-only and DDG doesn't index it. False negative; user assumes pensmith confirmed they're clean.

**How to avoid:**
1. **N-gram tunable, default 6–8 words.** Tied to discipline preset (technical fields tolerate longer technical phrases without flagging).
2. **TF-IDF or rarity score before flagging.** Don't search every n-gram — rank by rarity (use a frequency model from a large corpus; ship a tiny one) and only search the top-K (e.g., K=20).
3. **Idiom/convention exclusion list.** "the central limit theorem states that," "as is well known," section-header conventions, citation-style conventions ("according to Smith 2019"). Curated per discipline preset.
4. **Polite UA + jittered request rate.** DuckDuckGo HTML has no formal API; assume strict. 1 req per 5 seconds, no parallelism.
5. **Honest framing in the report.** "Free distinctive-phrase check found 0 hits in DuckDuckGo's index. This is a basic check; paywalled sources and many PDFs are not searchable. Run an institutional plagiarism check before submitting." PRD §3 disclaimer is a reasonable basis.
6. **Disable in `--dry-run` / cassette mode.** DDG can't be cassetted reliably (HTML changes).
7. **Make `--no-plagiarism-check` a first-class option** that doesn't degrade other guarantees.

**Phase to address:** Done (export pipeline)

---

### Pitfall 12: AI-detection / honesty score — score volatility, free-tier limits, framing creep

**What goes wrong:**
- GPTZero's free tier rate-limits (~5 docs/day in some accounts). User runs `done` twice in a row, second run fails silently or returns null.
- Same text scored on Monday: 41% AI. Re-scored Tuesday: 67% AI. Models change. Users panic, redo the humanize pass, score goes back down. False signal.
- Project framing drifts. v0.1.0 says "honesty score." v0.2 README starts using "% chance of detection." v0.3 marketing says "passes detection." This is the path *every* AI-writing tool walks; resist it deliberately.
- Multiple backends produce wildly different scores for the same text. User runs GPTZero (38%), then Originality (74%). Which is right? Neither — both are noisy.

**How to avoid:**
1. **Cache scores per text hash.** Same text = same score within a session. Don't re-call.
2. **Show score with uncertainty.** "GPTZero rates this 41% AI-generated (this score reflects prose patterns and varies between runs and detector versions; treat as a rough signal, not a verdict)."
3. **Score is informational, never a gate.** No `--require-score-below` flag. Compile and export do not check it.
4. **Framing is locked in copy.** README, intake disclaimer, score output all use "improves prose, not evades detection." Add a CONTRIBUTING.md rule: "score-related copy changes require maintainer review." PRD §14 calls this non-negotiable — make sure code review enforces it.
5. **Backend disagreement is visible.** If user has multiple backends configured, show all. Don't pick a "winner."
6. **Free-tier graceful failure.** Rate-limit hit → skip the score, print a clear note, do not block export.

**Warning signs:**
- Score-related code path can block export.
- Marketing copy starts using "evade," "undetectable," "pass."
- User-facing copy doesn't mention score variance.

**Phase to address:** Done (humanizer + honesty integration)

---

### Pitfall 13: Source policy & tier classification — "peer-reviewed" is fuzzy, OpenAlex tiering is unreliable, preprint vs published mismatch

**What goes wrong:**
- OpenAlex tags a paper as "peer-reviewed" because it appears in a journal Crossref tracks; turns out it's an editorial or letter, not a peer-reviewed research article. User cited an editorial as a primary source.
- A user cites the arXiv version of a paper that was later revised in the published journal version. The arXiv claims X; the journal says revised-X. Verifier passes (arXiv DOI exists, claim is in arXiv text), but the citation is now subtly wrong.
- "Peer-reviewed" filter excludes preprints and books, both of which are legitimate in many disciplines (CS conferences are arguably more rigorous than many journals; books are primary in History/Philosophy).
- A predatory journal (paid pseudo-peer-review) gets through. OpenAlex's source-quality tagging isn't auditable.

**How to avoid:**
1. **Tier classification via multiple signals**, not just venue: (a) DOI registrant, (b) OpenAlex `type`, (c) Crossref `subtype`, (d) journal indexed in DOAJ / Scopus / Web of Science (configurable lookup), (e) retraction status from Retraction Watch.
2. **Preprint↔published version linking.** When a Crossref record has a `relation.is-preprint-of` pointer, surface both versions to the user. Default to the published version.
3. **Discipline-aware policy.** Per preset: which tiers are acceptable. PRD §8 already has discipline presets — extend with explicit allowed-tiers list.
4. **Predatory-journal flag.** Maintain a known-predatory-publisher list (Beall's List successors); soft-warn at intake.
5. **Books require ISBN, not DOI.** Crossref does books inconsistently. Have a separate book ingestion path.
6. **Document `peer_reviewed_only` semantics in config.toml comments.** What it includes, what it excludes.

**Warning signs:**
- Tier classification is a single field from a single API.
- arXiv-only verification when a journal version exists.
- A preset's source preference is "OpenAlex only."

**Phase to address:** Research (source evaluator + tier classification logic)

---

### Pitfall 14: Resume hooks / `/compact` timing — PreCompact hook budget tighter than expected

**What goes wrong:**
- PreCompact fires; pensmith starts writing HANDOFF.json (section-granular state for 7 sections, each with current verification position). Hook hits its 60s default timeout. HANDOFF.json is half-written. SessionStart on resume reads it and parses junk → resume fails → user loses session.
- PostToolUse mid-session checkpoint at "≤1/min" still races with a long Task tool call that's holding state in memory but hasn't flushed. Checkpoint reflects pre-Task state; resume picks up from before the call started.
- SessionStart hook tries to auto-resume but the user is in a different cwd than the paper folder; resume runs against the wrong project.

PRD comment in the prompt said "PreCompact gets max 30s" — actual default is 60s, configurable per-hook ([Claude Code hooks reference](https://code.claude.com/docs/en/hooks)). Real budget is more generous than feared, but the failure mode is real.

**How to avoid:**
1. **HANDOFF.json write is atomic and bounded.** Pre-compute the JSON in memory, single `writeFileSync` on the temp file, rename. Should be <100ms even for 50 sections.
2. **HANDOFF.json content is small.** It's pointers, not state. Section number, position-within-section ('plan' / 'write' / 'verify' / which pass), pointer to last fully-written file. The actual section content lives in `sections/<N>/`. PRD §14 says "section-granular" — make sure that means *granular* (small) not "full state of every section."
3. **Configure the PreCompact hook timeout to 10s explicitly.** Defensive: if 10s isn't enough, the design is wrong, not the timeout.
4. **PostToolUse checkpoint is throttled and asynchronous.** Don't block tool returns on checkpoint flush; checkpoints are best-effort.
5. **SessionStart hook checks `cwd` matches stored project root.** If not, prompt before resuming. "You're in a different folder; resume <project>?"
6. **Test the hooks against a real /compact event in CI** (Claude Code hooks support test mode).

**Warning signs:**
- HANDOFF.json contains anything larger than 5KB.
- PreCompact hook duration logs near or over 5s.
- Resume picks up from a state earlier than expected (checkpoint race).

**Phase to address:** Foundation (HANDOFF.json schema + checkpoint infra); Tier 1 hooks shipped in v0.1.0

---

### Pitfall 15: Concurrent session edge cases beyond the lock

**What goes wrong:**
- User starts a wave of 5 parallel section writers in Tier 1. Network drops mid-Pass-2 verification on section 3. The 4 other sections complete and write `verified`. Section 3 is in an inconsistent state (DRAFT.md exists, VERIFICATION.md half-written). User runs `/pensmith` again; tool sees 4 verified sections and section 3 in "writing" state, doesn't know to redo verify.
- Two `/pensmith` sessions in the same paper — even with the lock — can be unintentionally launched if the user has Claude Code open and runs the Tier-2 CLI in a terminal. Lock catches it; error message must be clear.

**How to avoid:**
1. **Sections track `state ∈ {planned, writing, written, verifying, verified, failed}`** with timestamps. Restart sees `verifying` from a dead session → resume verification. Sees `writing` → restart write. Sees `failed` → user prompted.
2. **Network failures during waves abort the affected section, not the wave.** Other sections complete; the affected one is marked `failed` with the error logged in `.paper/SESSION.log`. Next `/pensmith` resumes it.
3. **Lock error message** lists holder PID, hostname, start time, and the file to delete if you're sure no other session is running.

**Phase to address:** Foundation (state.js + lock.js); resume logic in every workflow

---

### Pitfall 16: Style-match dual-use — README disclosure is necessary but insufficient

**What goes wrong:**
- A user uploads someone else's writing samples (a friend's, an instructor's, a published author's) and runs style-match. Output mimics that voice. Pensmith has no way to detect this; the README disclaimer doesn't prevent it.
- Same primitive used for legitimate thesis consistency is used for institution-violating impersonation. Indistinguishable from inputs alone.
- A future maintainer markets style-match as "matches your voice perfectly so detectors won't flag it." Drift toward evasion-positioning.

**How to avoid:**
1. **Voice profile is opt-in at intake**, prompt warns specifically: "Use only your own writing samples. Do not submit work in another person's voice without their consent."
2. **Voice profile is per-paper, not global.** No cached profile that can be reused across projects without re-acknowledging.
3. **Voice profile fingerprint is stored in `.paper/STYLE.json`** with a SHA hash of the input samples. If the same sample-set appears across N papers in the library, surface a prompt: "These samples are also used in <other paper>. Continue?"
4. **No "match this published author" preset.** Templates that name external authors are out of scope.
5. **CONTRIBUTING.md rule:** style-match feature copy changes require maintainer review. Same as honesty-score framing.
6. **Audit trail.** `.paper/SESSION.log` records when style-match was enabled and what samples were profiled.
7. **Honest framing on output.** "Style-matched to your samples; this does not change verifiability of citations or claims."

This is novel territory — there's no industry precedent for guardrails on this exact dual-use. Treat the above as v0.1.0 minimum; revisit at milestone review.

**Phase to address:** Intake (style opt-in flow); Done (audit log surface)

---

### Pitfall 17: Educator mode noise in the happy path

**What goes wrong:**
- "Goal: producing a draft" is the default, but the workflow body has educator-mode prose woven through every step. Either it leaks into draft mode (clutter) or it's gated by `if (educator_mode)` blocks repeated everywhere (forks the workflow).
- Two-tier interaction: Tier 1's educator mode might use rich AskUserQuestion explainers; Tier 2 prints a wall of stdin text.

**How to avoid:**
1. **Educator output is a separate concern.** Workflow bodies emit structured events ("planned section 3 with sources X, Y, Z because..."). The educator wrapper subscribes to events and renders explainers. Draft mode subscribes to nothing and emits nothing extra.
2. **No `if (educator_mode)` blocks in workflow bodies.** Keep them mode-agnostic.
3. **Test draft-mode and educator-mode against the same fixtures.** Outputs must differ only in the educator commentary, never in the workflow's actual decisions.

**Phase to address:** Foundation (workflow event model); educator mode as overlay

---

### Pitfall 18: Test coverage gaps — cassettes pass while live is broken; live tests are flaky; gating loses coverage

**What goes wrong:**
- All tests use `tests/fixtures/http-cassettes/`. CI green forever. Crossref API contract changes (or moves OpenAlex polite-pool sunset). Cassettes still pass. Production breaks for users immediately.
- Live tests gated behind `PENSMITH_NETWORK_TESTS=1`. Run only manually. Cassettes drift from reality silently.
- Tier-contract tests pass on fixtures but neither tier has been run against a real LLM provider in CI.

**How to avoid:**
1. **Cassette refresh job.** Weekly CI run with `PENSMITH_NETWORK_TESTS=1` that re-records cassettes against a small fixture set; surface diffs as PRs. Catches contract changes within 7 days.
2. **Schema tests.** Cassette tests assert the *shape* of API responses (Zod/JSON Schema), not just exact-match playback. Shape mismatch on a future cassette refresh = early signal.
3. **Smoke tests run weekly with a real LLM** against the cheapest model the runtime supports. Tiny fixture, sanity-check end-to-end.
4. **Doctor command runs the smoke test on demand.** Users can self-diagnose without running the full suite.
5. **Coverage report includes "live-network-only" coverage separately.** Visible in CI, so gaps are obvious.

**Phase to address:** Testing (cassette refresh job + schema tests + weekly smoke); doctor command in v0.1.0

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip `schema_version` field on a new state file ("we'll add it later") | One less line per file | Every reader gets a "missing version" branch forever; migrations become guesswork | Never |
| Inline `fetch()` outside `bin/lib/http.js` for "just one quick call" | Saves one import | Misses cache, retries, polite UA, rate-limit; eventually causes a Crossref ban | Never |
| Direct `path.join(os.homedir(), '.pensmith')` outside `paths.js` | Skips abstraction overhead | Breaks on Windows AppData; XDG envs ignored on Linux | Never |
| Test only happy-path 200 OK in cassettes | Tests are simple and fast | Production-only failures on 429/503/Retry-After | Only if you commit to weekly cassette refresh + 429 fixture coverage in v0.2 |
| LLM-only Pass 1 verification (no HTTP fetch) | Faster, no rate-limit concerns | Verifier grades its own homework; FABRICATED escapes | Never |
| Drop author/title fuzzy match from Pass 1 ("DOI is enough") | Simpler, fewer LLM calls | Real DOIs attached to wrong claims escape | Never (PRD §14 mandate) |
| Renumber sections on insert/delete | Tidy directory listings | HANDOFF.json points to ghosts after `/compact` resume; user-facing breakage | Never (use stable `03b-` suffixes) |
| Section drafter sees "previous sections for context" | Better narrative cohesion | Re-doing section 3 silently invalidates section 4 | Never (smoothing is a separate, post-verify step) |
| Cache HTTP responses by URL only | Simple cache key | Different `Accept`/`mailto` returns cached wrong response | Never |
| Hook HANDOFF.json contains full section content | Resume is "complete" | Write exceeds hook timeout, file is truncated, resume fails | Never (HANDOFF.json is pointers; content lives in section folders) |
| Skip the OneDrive/sync-folder warning ("most users won't be in one") | One less doctor check | This very project's dev folder is in OneDrive — devs hit it first | Never |
| LLM-judged quote verification | Handles paraphrases automatically | Cannot distinguish "verified quote" from "plausibly worded quote" | Never; quotes are deterministic against OA full text |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Crossref REST API | UA without `mailto:`; >50 req/s; ignoring X-Rate-Limit-* headers | UA `pensmith/<v> (+url; mailto:env)`, ≤50 req/s, honor headers, polite pool ([docs](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)) |
| OpenAlex | Relying on email-only polite pool past Mar 2026 sunset | Add `OPENALEX_API_KEY` config slot now; auth header support in `http.js` ([rate-limits docs](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication)) |
| arXiv API | Treating as Crossref-style; >1 req/3s | 1 req per 3 seconds, single connection, descriptive UA ([user manual](https://info.arxiv.org/help/api/user-manual.html)) |
| PubMed E-utilities | No API key + parallelism | 3 req/s without key, 10 with; use `tool=` and `email=` params |
| Unpaywall | Missing `email=` param | `email=<PENSMITH_CONTACT_EMAIL>` required parameter, not just polite |
| GPTZero | Submitting work to certify; treating score as deterministic | Honesty-display only; cache by hash; surface variance |
| DuckDuckGo HTML | Parallel scraping, fast UA pattern | Sequential, jittered; expect bans; degrade gracefully |
| Retraction Watch | Polling per citation | Bulk-pull DOI list when feasible; cache 24h |
| Zotero MCP | Assuming installed = authenticated | Check auth status, not just presence (PRD §11 already specifies) |
| Pandoc | Assume installed; no fallback | Ecosystem probe in `CAPABILITIES.json`; markdown-based docx fallback |
| Humanizer skill (user's local) | Hard-fail if absent | Skip with note (PRD §7.10 specifies; preserve) |
| pdf-parse / pymupdf | Treating extracted text as ground truth | Normalize ligatures, soft hyphens, smart quotes before any matching |
| GROBID | Network-mandatory; assume always available | Local installation optional; fallback to regex/heuristic metadata extractor |
| Claude Code Task tool | Used in workflow body without `<capability_check>` | Wrap; sequential fallback in Tier 2 |
| Claude Code AskUserQuestion | Same as above; no stdin equivalent in Tier 2 | stdin fallback uses same JSON question schema |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Verifier with no per-citation budget | Single section costs $5+ | Per-section + per-step budget caps | At first paper with 10+ citations per section |
| Wave size = "all sections in parallel" | $20 instantaneous spike | `--max-parallel` cap, default 5 | Papers >7 sections |
| Re-fetch identical DOI across sections | Long verify times, rate limits | HTTP cache TTL 24h for DOIs | Papers with citations reused across sections |
| Quote-verify downloads same OA PDF per quote | Slow Pass 3, bandwidth | Per-source PDF cache, fetched once | Sections with multiple quotes from same source |
| Style-match featurizes samples on every section | Slow per-section write | Profile cached in `.paper/STYLE.json`, computed once | Long papers, many sections |
| Cross-section consistency check is O(N²) | Compile gets slow on long papers | Batch claim extraction once, then pairwise compare claim summaries | >10 sections |
| Session log grows unbounded | Disk full on long projects | Rotate at fixed size; archive `.paper/SESSION.<n>.log.gz` | Projects open >1 month |

---

## Security & Integrity Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API keys logged in `.paper/SESSION.log` | Key leakage on bug-report sharing | Redact known-key env vars from session log on write |
| `--show-prompts` includes auth headers | Same | Same redaction; show-prompts is post-redaction |
| BYO PDF contents leaked to OpenAlex | Privacy violation per PRD §9 | Only title sent for hydration; document in PRIVACY.md; test |
| PII redaction toggled but redaction misses (e.g., student IDs in non-standard format) | Identifiable info reaches LLM provider | Conservative redaction patterns; opt-in (default-off per PRD); print a "PII redaction is best-effort" notice |
| Lock file in OneDrive sync syncs to other machines | Phantom locks | Lock file in platform local-only dir, not `.paper/` |
| Past-writing samples uploaded to a non-local LLM | Voice fingerprint exposed | Featurization runs against the configured LLM (could be local Ollama for privacy); document; do not embed externally without consent |
| Verification "passes" but verifier never made network calls | Silent fabrication acceptance | Doctor: assert verifier session log shows N HTTP calls per N citations |
| Plagiarism check sends draft text to DDG | Draft-content exposure | Send only distinctive n-grams, not full text; document in PRIVACY.md |
| Exported docx leaks pensmith metadata | Violates PRD §7.9 explicit user choice | Pandoc invocation strips metadata; test asserts zero `pensmith` strings in `.docx` ZIP entries |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| FABRICATED block shows DOI, no remediation | User stuck, doesn't know how to fix | Show DOI, what was searched, what was found; suggest "use `/pensmith add <real-doi>` and remap" |
| Cost cap aborts mid-section without saving partial work | Lost effort | Always flush section state before abort prompt; user resumes from partial draft |
| Approval gates show 100-line outline as a wall of text | User skims, approves blindly | Section-by-section approval option; diff view on revision |
| `/pensmith status` doesn't show *why* a section is stuck | User runs verify in a loop | Status shows last error, last attempted action, suggested next command |
| Resume from /compact silently picks a section different from where the user thought they were | Confusion, lost trust | Resume prints "resuming section 3 (`write` step) — was this the right place?" with confirmation |
| Educator-mode explanations appear in draft mode | Clutter | Strict mode separation; events vs prose (Pitfall 17) |
| OneDrive corruption error reads as "unknown file error" | Mystery bug, support load | Detect sync-folder pattern in error path; suggest data-dir override |
| `--yolo` flag default-on by accident in a scripted invocation | Approval gates skipped, surprise export | Refuse `--yolo` if estimate exceeds 50% of cap; require explicit `--yolo` in CI scripts; never inherit from env var |

---

## "Looks Done But Isn't" Checklist

- [ ] **Verifier:** Citation comes back PASS — but did `.paper/SESSION.log` show an HTTP call to Crossref/arXiv? If not, Pass 1 was bypassed.
- [ ] **DOI normalization:** Tested with `10.1145/Foo`, `doi:10.1145/foo`, `https://doi.org/10.1145/foo.`, and `<https://doi.org/10.1145/foo>`? All produce the same canonical form? Round-trip idempotent?
- [ ] **Quote verify:** Tested against a quote with an `fi` ligature, a soft hyphen, smart quotes, and a hyphenated line break in the source PDF?
- [ ] **State writes:** Crash-tested by killing the process during a write to `STATE.md`? Resume reads cleanly?
- [ ] **Lock file:** PID-only or PID+timestamp+hostname+heartbeat? Located outside sync folders?
- [ ] **OneDrive detection:** Doctor warns when `.paper/` is inside a OneDrive folder?
- [ ] **Schema version:** Every state file (`STATE.md`, `config.toml`, `HANDOFF.json`, `sections/<N>/*.md`) has `schema_version: 1`?
- [ ] **Cost cap:** Pre-flight estimate vs cap, abort *before* the call, not after billing? Verified with a fixture?
- [ ] **HTTP UA:** `mailto:` present? Per-source rate limit honored? Retry-After respected? Jitter actually random?
- [ ] **Two tiers:** `tier-contract.test.js` exercises every workflow body, including new ones added since v0.1.0? Failure is a merge block?
- [ ] **Section isolation:** Section drafter prompt template inspected — no "previous sections" or "paper so far" context leaks?
- [ ] **Smoothing:** Compile reads section files, doesn't write to them? `.paper/DRAFT.md` is the only smoothed artifact?
- [ ] **Section state:** Section folder has `state` field reflecting `planned/writing/written/verifying/verified/failed`?
- [ ] **Honesty score:** Score is informational — no code path uses it as a gate?
- [ ] **Style-match:** Profile fingerprint stored; cross-paper sample reuse surfaced?
- [ ] **Export:** `.docx` ZIP entries grep-clean for "pensmith" / metadata stamps?
- [ ] **Doctor:** Runs the actual end-to-end fixture, including a simulated 429 from Crossref?
- [ ] **PreCompact hook:** HANDOFF.json write completes in <100ms on a 50-section paper?

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| FABRICATED found post-export | LOW — verifier should have caught it; the fact it didn't is the bug | Reproduce in fixture, add to `known-bad-citations.json`, fix verifier, re-verify all sections |
| `STATE.md` corrupted | LOW–MEDIUM | Reconstruct from `sections/*/` folders + `OUTLINE.md`; section state is the source of truth, top-level state is a cache |
| HANDOFF.json corrupted post-/compact | MEDIUM | Fall back to last per-section checkpoint in `sections/<N>/`; user re-acks current section |
| OneDrive duplicated state files (`STATE-fedora-safeBackup-0001.md`) | MEDIUM | Doctor detects pattern, prompts user to pick canonical, archive the rest |
| Lock file held by dead session | LOW | Lock with heartbeat — auto-clear after 5× heartbeat interval if PID gone |
| Schema migration midway corrupts a project | HIGH | Migration writes to `.paper/.backup-pre-v<N>/` first; restore from backup; report bug |
| Cost cap hit, partial section written | LOW | Section state shows `writing` with partial DRAFT.md; resume picks up |
| Crossref ban | MEDIUM | Circuit-breaker for K minutes; if persists, surface to user, suggest API-key registration |
| Two-tier drift discovered post-release | HIGH | Hot-fix the workflow; re-run tier-contract test on all examples; CHANGELOG note |
| Quote verifier false negative (real quote marked NOT_FOUND due to extraction artifact) | LOW | Fixture-add the artifact, fix normalizer, re-verify section |
| Section renumbering accidentally shipped | HIGH | Rollback recipe: restore section folder names from git; HANDOFF migrations |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| #1 Verifier grading own homework | Foundation + Verify | `known-bad-citations.json` 10/10 FABRICATED gate |
| #2 DOI normalization gotchas | Foundation | Round-trip property test; cassette fixtures with mixed-case, prefixed, punctuated DOIs |
| #3 Quote drift / PDF artifacts | Foundation (PDF lib) + Verify (Pass 3) | `known-bad-quotes.json` 10/10 NOT_FOUND with at least 5 artifact-bearing fixtures |
| #4 State corruption / locks / OneDrive | Foundation | Crash-write test; OneDrive simulator; doctor flags sync-folder |
| #5 Schema migration regrets | Foundation | All state files v1 day-one; refuse-forward-incompat test |
| #6 Cost overruns | Foundation (budget) + every workflow | Budget-exhaustion fixture in tier-contract test |
| #7 HTTP client gotchas | Foundation (`http.js`) + Ecosystem (doctor) | 429/503/Retry-After cassettes; per-source rate-limit headroom check |
| #8 Cross-platform paths | Foundation (`paths.js`) | CI matrix linux/macos/windows; long-path test on Windows |
| #9 Two-tier drift | Foundation (capability schema) + Testing | `tier-contract.test.js` red-blocks merges |
| #10 Section-as-phase invariant | Foundation (layout) + Compile (read-only) + Verify (draft hash) | Section-isolation test: redo section 3, hash sections 1/2/4/5 unchanged |
| #11 Plagiarism check noise | Done | Convention-phrase exclusion list test; rate-limit DDG fixture |
| #12 Honesty score framing | Done + Documentation | Lint forbidden phrases ("evade", "undetectable", "pass detection") in copy |
| #13 Source policy / tiering | Research | Tier-classification multi-signal test; predatory-journal fixture |
| #14 Hook timing | Foundation (HANDOFF schema) + Tier 1 hooks | HANDOFF write <100ms test on 50-section fixture |
| #15 Concurrency edge cases | Foundation (state machine) | Network-drop-mid-wave fixture; lock-conflict E2E |
| #16 Style-match dual use | Intake (opt-in flow) + Done (audit) | Sample-reuse-across-papers detection test; copy-lint for evasion phrasing |
| #17 Educator mode noise | Foundation (event model) | Draft-vs-educator output diff test (workflow decisions identical) |
| #18 Test coverage gaps | Testing (CI infrastructure) | Weekly cassette refresh job; schema-shape assertions; weekly live smoke |

---

## Reconciliation with PRD §14 NFRs

PRD §14 already names most of these mitigations. This research validates and extends:

**Validated (PRD got it right; protect these):**
- Section-as-phase as load-bearing ✓ (#10)
- Two-tier source-of-truth + tier-contract testing ✓ (#9)
- Deterministic DOI normalization in `bin/lib/doi.js` ✓ (#2)
- Author/title verification as part of Pass 1 ✓ (#1)
- Atomic state writes ✓ (#4 — but add OneDrive detection)
- Concurrent-run lock ✓ (#4 — but lock file outside sync folders)
- Schema versioning from day one ✓ (#5)
- Cross-platform paths via `bin/lib/paths.js` ✓ (#8)
- Hard cost cap ✓ (#6 — but add per-step caps)
- HTTP cache + backoff with jitter ✓ (#7 — but verify jitter is actually random)
- Cassette tests gated by `PENSMITH_NETWORK_TESTS` ✓ (#18 — but add weekly refresh)
- Verifier blocks compile and export ✓ (#1)
- No exported-document trace ✓ (UX table — verify with grep)
- Honest framing on detection ✓ (#12)
- `/pensmith doctor` ships v0.1.0 ✓

**Extensions / sharpenings this research adds:**
- DOI normalization: ASCII-only case folding (non-ASCII bites you), trailing-punctuation stripping, separate normalizers for arXiv/PMID, single chokepoint enforced by lint
- Quote verify: explicit Unicode normalization recipe (NFKC, smart→straight, soft-hyphen strip, ligature decomposition); tiered match with FUZZY_MATCH visibility; minimum-length gate on fuzzy
- State files: lock file location outside `.paper/` (sync-folder safety); heartbeat on locks; OneDrive/iCloud/Dropbox detection at intake
- HTTP: per-source rate limits (Crossref 50/s, arXiv 1/3s, PubMed 3/s), OpenAlex API-key sunset preparation, X-Rate-Limit-Limit header honoring, full-jitter recommendation
- Schema migrations: refuse-forward-incompat reads, in-memory migration with backup before write-back
- Cost: per-step budgets (not just session), retry caps everywhere, parallelism cap
- Section invariants: smoothing as read-only on section files, verified_against_draft_hash, stable numbering with letter suffixes (PRD §17 recommendation accepted)
- Hooks: actual PreCompact timeout is 60s default (not 30s as feared); HANDOFF.json must stay small (<5KB) and be pointers, not content
- Style-match: per-paper profile + sample fingerprint; cross-paper reuse detection; CONTRIBUTING rule for copy review
- Honesty score: never a gate; cache per text hash; show variance disclaimer
- Tests: schema-shape assertions on cassettes; weekly cassette refresh CI; weekly live smoke

**Not in PRD §14 but should be considered:**
- Sync-folder (OneDrive/iCloud/Dropbox) detection at intake + doctor — this project's own dev folder is in OneDrive; will hit this immediately
- API-key support for OpenAlex (sunset of email-only polite pool announced Feb 13, 2026)
- Per-step cost budgets in addition to session cap
- Section state machine (`planned/writing/written/verifying/verified/failed`) for resume correctness
- `verified_against_draft_hash` to detect compile-time staleness
- Educator-mode-as-overlay event model (avoids workflow forking)

---

## Sources

- [Crossref REST API access & authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) — polite pool, mailto requirement, X-Rate-Limit headers, 50 req/s
- [Crossref blog — REST API rate limit changes (Dec 2025)](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/)
- [DOI Handbook — Case Insensitivity](https://www.doi.org/doi-handbook/HTML/case-insensitivity.html) — ASCII-only case folding spec
- [DataCite DOI Display Guidelines](https://support.datacite.org/docs/datacite-doi-display-guidelines) — display lowercase recommendation
- [greenelab/scihub#9 — Investigate DOI casing and uniqueness](https://github.com/greenelab/scihub/issues/9) — no canonical case; convert for analysis
- [OpenAlex — Authentication & Pricing](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication) — polite pool 15k/hr, 100k/day; API-key sunset
- [OpenAlex users group — API keys required from Feb 13](https://groups.google.com/g/openalex-users/c/rI1GIAySpVQ) — polite-pool sunset notice
- [arXiv API User's Manual](https://info.arxiv.org/help/api/user-manual.html) — 1 req per 3s, single connection, descriptive UA
- [arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html)
- [Compdf — What's so hard about PDF text extraction](https://www.compdf.com/blog/what-is-so-hard-about-pdf-text-extraction) — ligatures, hyphenation, Type-3 fonts
- [Freiburg — Merging hyphenated words & guessing ligatures](https://ad-wiki.informatik.uni-freiburg.de/teaching/BachelorAndMasterProjectsAndTheses/DehyphenationAndGuessingLigatures)
- [Zotero forums — extracted PDF highlights include soft hyphen U+00AD](https://forums.zotero.org/discussion/111357/extracted-pdf-highlights-include-soft-hyphen-u-00ad)
- [TextToolDB — Fix broken line breaks and weird formatting from PDFs](https://texttooldb.com/productivity/fix-broken-line-breaks-formatting-from-pdfs/)
- [abraunegg/onedrive#3439 — atomic save creates safebackup conflicts](https://github.com/abraunegg/onedrive/issues/3439)
- [Microsoft Tech Community — OneDrive is corrupting my Git repositories](https://techcommunity.microsoft.com/discussions/onedriveforbusiness/onedrive-is-corrupting-my-git-repositories/3898283)
- [dustinbriles.com — OneDrive and git, don't do it](https://dustinbriles.com/onedrive-and-git-dont-do-it/)
- [Hacker News — OneDrive doesn't support dotfiles, can't sync git repos](https://news.ycombinator.com/item?id=17733659)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — 60s default timeout, configurable per-hook
- [anthropics/claude-code#5615 — Complete timeout configuration](https://github.com/anthropics/claude-code/issues/5615)
- Project context: `.planning/PROJECT.md`, `PRD.md` (especially §14 NFRs and §17 open questions)

---
*Pitfalls research for: pensmith (AI-assisted academic writing with citation verification, two-tier plugin+CLI)*
*Researched: 2026-05-06*
