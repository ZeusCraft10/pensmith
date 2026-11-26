# Privacy

Pensmith is local-only software. There is no pensmith server, no account, and
no telemetry: no usage analytics, crash reports or remote logging. Your paper
lives in the `.paper/` folder of your project; the shared library index and
logs live in your user data folder.

What does leave your machine is listed below: requests to scholarly
registries, to the model provider you configure, and to the optional checks
you turn on. All of them go through one HTTP module (`bin/lib/http.ts`), which
refuses private, loopback and link-local addresses in links that come from a
registry or a page. The model endpoint you configure is used as you set it, so
a model server on your own machine works.

## Hosts pensmith contacts

| Host | When | What is sent |
| --- | --- | --- |
| `api.anthropic.com` | Intake clarifying questions, outline, section plans and drafts, the advisory verifier passes, and citation repair | The prompt for that step: your assignment and intake answers, the outline, the metadata of the sources assigned to the section, and the section draft. Needs `ANTHROPIC_API_KEY`. A `baseUrl` set for the provider in `runtime.json` replaces this host. |
| `api.openai.com` | The same steps, only if you configure the OpenAI-compatible provider instead | The same prompts. A `baseUrl` set for the provider (a server such as Ollama on your own machine) replaces this host. |
| `api.openalex.org` | Research, adding a source, checking citations, Pass 1's retraction cross-check for a cited DOI whose registry record does not show a retraction, and Pass 3, to find the open-access PDF of a quoted source | Search terms from your topic, titles and DOIs. |
| `api.crossref.org` | Research, adding a source, and Pass 1 of the verifier (every cited DOI) | DOIs and title searches. For a PDF you add that prints no DOI or arXiv ID of its own, the PDF's title line, never its text. |
| `api.datacite.org` | Pass 1, for a cited DOI Crossref does not hold (arXiv, Zenodo, figshare and other DataCite DOIs), or when Crossref could not be reached | That DOI. |
| `doi.org` | Pass 1, for a cited DOI neither Crossref nor DataCite holds, or when Crossref or DataCite could not be reached; and re-checking how fresh an earlier verification is | `GET https://doi.org/<doi>` asking for the work's citation metadata. doi.org redirects that request to the DOI's registration agency, and pensmith follows only to the agencies' metadata services: `api.crossref.org`, `data.crosscite.org` and `api.datacite.org` (DataCite), `japanlinkcenter.org` (JaLC) and `data.medra.org` (mEDRA). Freshness re-checks send `HEAD https://doi.org/<doi>`. DOIs written as `dx.doi.org` links are normalised to this host. |
| `export.arxiv.org` | Research, adding a source by its arXiv ID (or a PDF that prints one), and Pass 1 for a source cited by its arXiv ID | Search terms and arXiv IDs. At most one request every three seconds, as arXiv asks. |
| `eutils.ncbi.nlm.nih.gov` | Research (PubMed), and Pass 1 for a source cited by its PubMed ID | Search terms and PubMed IDs. |
| `openlibrary.org` | Pass 1, for a book cited by its ISBN | That ISBN. |
| `api.semanticscholar.org` | Research | Search terms, and your Semantic Scholar key if you set one. |
| `api.unpaywall.org` | Pass 3 of the verifier, to find open-access text for a quoted source when OpenAlex lists no PDF of it that can be read, only when `PENSMITH_CONTACT_EMAIL` is set | DOIs and your contact email (Unpaywall requires one). |
| Publisher and repository hosts | Pass 3 (the open-access PDF an OpenAlex or Unpaywall record points to, and the redirects it follows from there) and `pensmith add <url>` | A plain download request for that URL. Links to private or local addresses are refused. |
| `html.duckduckgo.com` | The plagiarism check during `pensmith done` | A few short distinctive phrases taken from your draft. |
| `api.gptzero.me` | The AI-likelihood score during `pensmith done`, only with `GPTZERO_API_KEY` set, after a consent prompt (in this alpha, `--yolo` also skips that prompt) | Your paper text, cut to 50 KB. |

When `PENSMITH_CONTACT_EMAIL` is set, requests to the scholarly registries
carry it in the `User-Agent` header, and requests to Crossref and OpenAlex
also carry it as a `mailto` parameter, as their polite-use policies ask.
Requests to the model provider do not. It is not stored or logged. When it is
not set, nothing identifying is sent.

Pensmith does not contact Zotero itself. It only reads your Claude Code
config to see whether a Zotero MCP server is set up there.

## Personal information

- Text you give pensmith (the assignment, your answers, your notes and drafts)
  is sent to the model provider as part of the prompts above.
- Intake has an opt-in `--pii-redact` flag. With it, personal details pensmith
  recognises (emails, phone numbers, ID numbers and similar) are redacted in
  the saved intake answers, and the unredacted answers are kept in
  `.paper/INTAKE.raw.local`, which the repository's `.gitignore` excludes.
  It is not a filter on every later prompt.
- The session log (`.paper/SESSION.log`) redacts API keys and the same
  personal-detail patterns before anything is written.
- API keys are read from environment variables. Pensmith never writes their
  values to disk or to logs; config files store only the variable names.

## The humanizer and the AI-likelihood score

The humanizer is a Claude Code skill you install yourself. In this alpha,
`pensmith done` does not run it. The AI-likelihood score is shown only for
your own information: it says nothing certain about what any detector will
decide, and pensmith does not try to change that outcome.

## Exported documents

Exported files carry no pensmith metadata, footer or fingerprint.
