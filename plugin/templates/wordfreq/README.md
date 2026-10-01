# Word-frequency tiers (plagiarism check, EXP-19)

`scowl-tiers.txt` ranks English words by how common they are, so the
plagiarism check (`bin/lib/plagiarism.ts`) can pick the most distinctive
phrases of a paper to search for: a phrase made of rare words is more likely to
find a copied source than one made of common words.

- **Source:** SCOWL (Spell Checker Oriented Word Lists) by Kevin Atkinson and
  contributors, size levels 10, 20, 35, 40 and 50 (`english-words-10` …
  `english-words-50`), as packaged in the npm package `wordlist-english@1.2.1`.
  A word's tier is the smallest SCOWL size level that contains it (10 = the most
  common words); a word in none of them counts as rarest.
- **Processing:** lowercase alphabetic entries only, each word once, under the
  most common tier it belongs to (`@10` … `@50` mark the tiers).
- **Licence:** SCOWL's permissive terms — use, copying, modification,
  distribution and sale are permitted provided the copyright and permission
  notices are kept. They are in `COPYRIGHT-SCOWL.txt` in this folder, which must
  ship with the list. These terms are compatible with pensmith's AGPL-3.0
  licence. The README's credits name SCOWL.
