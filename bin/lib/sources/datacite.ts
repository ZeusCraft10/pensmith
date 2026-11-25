// bin/lib/sources/datacite.ts — DataCite REST API, for DOIs Crossref does not hold.
//
// Endpoint: GET https://api.datacite.org/dois/<doi>
//
// DataCite registers every arXiv DOI (10.48550/arXiv.*), Zenodo, figshare and
// Dryad, and most dataset and software DOIs. Pass 1 asks it after Crossref
// answers 404. No key or contact address is needed.

import { askRegistry, isGone, nameFromDisplay, yearOf, type Lookup, type WorkName, type WorkRecord } from './work-record.js';

const BASE = 'https://api.datacite.org';

interface DataciteCreator {
  name?: string;
  nameType?: string;
  givenName?: string;
  familyName?: string;
}

interface DataciteTitle {
  title?: string;
  titleType?: string;
}

interface DataciteAttributes {
  doi?: string;
  titles?: DataciteTitle[];
  creators?: DataciteCreator[];
  publicationYear?: number | string;
  container?: { title?: string };
  types?: { resourceTypeGeneral?: string; citeproc?: string };
  dates?: Array<{ date?: string; dateType?: string }>;
}

function creatorName(c: DataciteCreator): WorkName | null {
  const family = c.familyName?.trim();
  const given = c.givenName?.trim();
  const name = c.name?.trim();
  if (c.nameType === 'Organizational') return name ? { literal: name } : null;
  if (family) return given ? { family, given } : { family };
  // A personal name with no parts: "Family, Given" when it has a comma.
  return name ? nameFromDisplay(name) : null;
}

function toRecord(a: DataciteAttributes, raw: unknown): WorkRecord | null {
  const titles = a.titles ?? [];
  const main = titles.find((t) => !t.titleType && t.title?.trim())?.title?.trim() ?? titles[0]?.title?.trim();
  if (!main) return null;
  const subtitle = titles.find((t) => t.titleType === 'Subtitle')?.title?.trim();
  const alt = titles
    .filter((t) => (t.titleType === 'AlternativeTitle' || t.titleType === 'TranslatedTitle') && t.title?.trim())
    .map((t) => t.title!.trim());
  const years = [yearOf(a.publicationYear), ...(a.dates ?? []).filter((d) => d.dateType === 'Issued').map((d) => yearOf(d.date))]
    .filter((y): y is number => y !== undefined);
  const rec: WorkRecord = {
    registry: 'DataCite',
    title: main,
    authors: (a.creators ?? []).map(creatorName).filter((n): n is WorkName => n !== null),
    years: [...new Set(years)],
    venues: a.container?.title?.trim() ? [a.container.title.trim()] : [],
    journalArticle: a.types?.resourceTypeGeneral === 'JournalArticle',
    raw,
  };
  if (a.doi) rec.doi = a.doi;
  if (subtitle) rec.subtitle = subtitle;
  if (alt.length > 0) rec.altTitles = alt;
  return rec;
}

/** Ask DataCite for `doi`: found, not_found (404) or unavailable. */
export async function lookupDoi(doi: string): Promise<Lookup> {
  const url = `${BASE}/dois/${encodeURIComponent(doi)}`;
  return askRegistry('DataCite', url, { source: 'datacite', headers: { accept: 'application/vnd.api+json' } }, (res) => {
    if (isGone(res.status)) return { kind: 'not_found', registry: 'DataCite', authoritative: true };
    if (res.status !== 200) return null;
    const body = JSON.parse(res.body) as { data?: { attributes?: DataciteAttributes } };
    const record = body.data?.attributes ? toRecord(body.data.attributes, body.data) : null;
    return record ? { kind: 'found', registry: 'DataCite', record } : null;
  });
}
