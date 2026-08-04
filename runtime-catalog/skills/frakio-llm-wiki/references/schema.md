# Vault Schema

## Structure

Project vaults use `FRAKIO.md`; personal vaults use `资料库说明.md`. Both use `index.md`, `log.md`, `收件箱/`, `来源/`, `知识/`, `规则/`, and `.frakio/`.

Knowledge pages live under `知识/实体/`, `知识/概念/`, `知识/比较/`, or `知识/查询/`. Existing Obsidian vaults may retain legacy locations; do not move them only for conformance.

## Frontmatter

```yaml
---
title: Page Title
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: entity | concept | comparison | query | summary
tags: [approved-tag]
sources: [来源/网页/source.md]
confidence: high | medium | low
contested: false
contradictions: []
---
```

Use tags already defined by the vault rules. Propose a rule update before introducing a new tag. Update the `updated` date whenever page content changes.

## Page quality

Prefer one owner page per notable entity or concept. Comparison pages state dimensions and synthesis. Query pages capture durable, non-trivial answers. Pages over 200 lines should be split with reciprocal links.

The index lists every knowledge page with a one-line summary. Human-readable activity belongs in `log.md`; Runtime operation history remains authoritative for rollback.
