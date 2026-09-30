// tests/sources/europepmc.test.ts — Europe PMC open-access full text (Phase 20,
// VRFY-19, D-20-18): the recorded answer parses into the article's ids, title,
// authors, year and plain text (reference list and citation markers out); the
// three-way outcome — found | not-found (HTTP 404) | failed (no usable answer,
// never "not found"); a plain request (no contact email, no key); offline, an
// unrecorded PMCID is the typed fixture miss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullTextXmlUrl, jatsToArticle, lookupFullText, normPmcid } from '../../bin/lib/sources/europepmc.js';
import { recorded, assertOfflineMiss } from './recorded.js';
import { liveLane, uniq } from './three-way.js';

const PMCID = 'PMC13598034';

test('VRFY-19: the recorded Europe PMC full text (a BMC letter) — ids, title, authors, year and the article text', async () => {
  const [entry] = recorded('europepmc', 'pmc13598034');
  assert.equal(entry!.path, '/europepmc/webservices/rest/PMC13598034/fullTextXML');
  const r = await lookupFullText(PMCID);
  assert.equal(r.kind, 'found');
  if (r.kind !== 'found') return;
  const a = r.article;
  assert.deepEqual(a.ids, { doi: '10.1186/s43044-026-00785-w', pmid: '42771069', pmcid: PMCID });
  assert.equal(a.title, 'Sex disparities in STEMI care: pre-hospital delay and acute heart failure');
  assert.deepEqual(a.authors.slice(0, 3), ['Dziewierz, Artur', 'Zdzierak, Barbara', 'Rakowski, Tomasz']);
  assert.equal(a.year, 2026);
  assert.match(a.text, /^Sex disparities in STEMI care/);
  assert.match(a.text, /We commend Shaheen and colleagues for their important contribution to the literature on sex disparities/);
  assert.match(a.text, /One of the most clinically actionable findings is the longer pre-hospital delay among women\./);
  assert.equal(r.url, fullTextXmlUrl(PMCID));
});

test('VRFY-19: JATS to text — the reference list and citation markers are not the article\'s words; contributors of another role are not authors', () => {
  const xml = [
    '<?xml version="1.0"?><article><front><article-meta>',
    '<article-id pub-id-type="pmc">1234</article-id><article-id pub-id-type="doi">10.5555/ABC</article-id><article-id pub-id-type="pmid">99</article-id>',
    '<title-group><article-title>A <italic>Title</italic> &amp; more</article-title></title-group>',
    '<contrib-group><contrib contrib-type="author"><name><surname>Doe</surname><given-names>Jane</given-names></name></contrib>',
    '<contrib contrib-type="editor"><name><surname>Editor</surname><given-names>Ed</given-names></name></contrib>',
    '<contrib contrib-type="author"><collab>The Consortium</collab></contrib></contrib-group>',
    '<pub-date pub-type="epub"><day>1</day><month>2</month><year>2021</year></pub-date>',
    '<abstract><p>An abstract sentence.</p></abstract></article-meta></front>',
    '<body><sec><title>Intro</title><p>Shown before<xref ref-type="bibr" rid="b1">1</xref>, the effect holds &#x2014; mostly.</p>',
    '<p>Formula <inline-formula><tex-math>\\alpha</tex-math></inline-formula> here.</p></sec></body>',
    '<back><ack><p>We thank everyone.</p></ack><ref-list><ref><mixed-citation>A cited paper title nobody quotes.</mixed-citation></ref></ref-list></back></article>',
  ].join('');
  const a = jatsToArticle(xml);
  assert.deepEqual(a.ids, { doi: '10.5555/abc', pmid: '99', pmcid: 'PMC1234' });
  assert.equal(a.title, 'A Title & more');
  assert.deepEqual(a.authors, ['Doe, Jane', 'The Consortium']);
  assert.equal(a.year, 2021);
  assert.match(a.text, /An abstract sentence\./);
  assert.match(a.text, /Shown before, the effect holds — mostly\./);
  assert.match(a.text, /We thank everyone\./);
  assert.doesNotMatch(a.text, /cited paper title|\\alpha/);
  assert.equal(normPmcid('pmcid: 1234'), 'PMC1234');
  assert.equal(normPmcid('PMC0042'), 'PMC0042');
  assert.equal(normPmcid('10.5555/x'), null);
  assert.equal(fullTextXmlUrl('PMC7'), 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7/fullTextXML');
});

test('VRFY-19: Europe PMC\'s three-way answer — 404 not-found, a non-JATS 200 or a 503 failed (never "not found"); a plain User-Agent', async () => {
  await liveLane(async (agent) => {
    const agents: string[] = [];
    const id = (n: number): string => `PMC${n}`;
    const base = 900000000 + Math.floor(Math.random() * 1e6);
    const at = (n: number): string => `/europepmc/webservices/rest/${id(n)}/fullTextXML`;
    agent.get('https://www.ebi.ac.uk').intercept({ path: at(base), method: 'GET' }).reply(404, '<error>not found</error>', { headers: { 'content-type': 'application/xml' } });
    agent
      .get('https://www.ebi.ac.uk')
      .intercept({
        path: at(base + 1),
        method: 'GET',
        headers: (h: Record<string, string>) => {
          agents.push(h['user-agent'] ?? '');
          return true;
        },
      })
      .reply(200, `<html><body>Service notice ${uniq('m')}</body></html>`, { headers: { 'content-type': 'text/html' } });
    agent.get('https://www.ebi.ac.uk').intercept({ path: at(base + 2), method: 'GET' }).reply(503, 'busy').persist();

    const missing = await lookupFullText(id(base));
    assert.equal(missing.kind, 'not-found');
    assert.match(missing.kind === 'not-found' ? missing.reason : '', /HTTP 404 \(Europe PMC has no open-access full text of PMC\d+\)/);
    const html = await lookupFullText(id(base + 1));
    assert.deepEqual(html.kind === 'failed' ? [html.kind, html.status] : [html.kind], ['failed', 200]);
    assert.match(html.kind === 'failed' ? html.reason : '', /^response is not a Europe PMC answer \(no JATS <article>\)$/);
    const busy = await lookupFullText(id(base + 2));
    assert.equal(busy.kind, 'failed');
    assert.ok(agents.every((ua) => /^pensmith\/\S+$/.test(ua)) && agents.length > 0, 'no contact email, no key');
    assert.deepEqual(await lookupFullText('not a pmcid'), { kind: 'not-found', reason: 'not a PMCID: "not a pmcid"' });
  });
});

test('RUN-03: offline, an unrecorded PMCID is the typed fixture miss — never another recording', async () => {
  await assertOfflineMiss(() => lookupFullText('PMC1'), 'lookupFullText miss');
});
