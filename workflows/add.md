# pensmith add

> Add a section or citation library entry.

<capability_check>
required:
  - AskUserQuestion
  - MCP library.read
  - MCP state.update
  - Zotero MCP

degrade_if_missing:
  - if no AskUserQuestion: read response from stdin
  - if no MCP / Zotero MCP: direct file ops on .paper/
</capability_check>

## Overview

(Phase 2 stub — Phase 3+ fills this in.)

## Steps

1. (stub)

## Outputs

- (stub)
