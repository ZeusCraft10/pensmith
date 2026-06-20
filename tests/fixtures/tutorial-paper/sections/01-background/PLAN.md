---
section: 1
slug: background
title: Background
depends_on: []
assigned_sources: [smith2021, jones2019]
status: written
---

## Brief

The Background section establishes prior work on transformer attention scaling.
It draws on two assigned sources: smith2021 (sub-quadratic attention scaling)
and jones2019 (the long-context benchmark used to evaluate that scaling). This
fixture is the SECTION-stage provenance source for goal=both (post-section): a
`section.written` event carrying these `assigned_sources` drives the
section-level provenance render in tests/tutorial-provenance.test.ts.
