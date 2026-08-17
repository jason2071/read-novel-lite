# Graph Report - .  (2026-08-17)

## Corpus Check
- Corpus is ~6,222 words - fits in a single context window. You may not need a graph.

## Summary
- 69 nodes · 107 edges · 10 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Reader Persistence
- Package Setup
- Novel Data Store
- Chapter Parsing
- Chapter Discovery
- Reader Client Logic
- Preference Architecture
- Web Server Routes
- File Access Safety
- Application Overview

## God Nodes (most connected - your core abstractions)
1. `chapterRefs()` - 8 edges
2. `resolveWithin()` - 7 edges
3. `chapterTitles()` - 7 edges
4. `splitTitleBody()` - 4 edges
5. `headingOf()` - 4 edges
6. `clampAll()` - 4 edges
7. `schedule()` - 4 edges
8. `listNovels()` - 4 edges
9. `novelProfile()` - 4 edges
10. `chapterText()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `chapterTitles()` --calls--> `headingOf()`  [EXTRACTED]
  lib/store.js → lib/chapter-text.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Reader Preference Persistence** — readme_reader_preferences, readme_reader_json, readme_localstorage [EXTRACTED 1.00]

## Communities (10 total, 0 thin omitted)

### Community 0 - "Reader Persistence"
Cohesion: 0.19
Nodes (12): clampAll(), DEFAULTS, FILE, flush(), init(), RANGES, savePrefs(), saveProgress() (+4 more)

### Community 1 - "Package Setup"
Cohesion: 0.18
Nodes (10): dependencies, ejs, express, description, name, private, scripts, start (+2 more)

### Community 2 - "Novel Data Store"
Cohesion: 0.38
Nodes (6): __dirname, listNovels(), novelProfile(), readJson(), refsCache, titleCache

### Community 3 - "Chapter Parsing"
Cohesion: 0.60
Nodes (5): headingOf(), NOTE_TAIL_RE, splitTitleBody(), stripTrailingNote(), TITLE_LINE_RE

### Community 4 - "Chapter Discovery"
Cohesion: 0.40
Nodes (6): chapterRefs(), chapterTitles(), mapLimit(), naturalCompare(), readHead(), searchChapters()

### Community 5 - "Reader Client Logic"
Cohesion: 0.53
Nodes (5): localPrefs(), post(), rememberLocally(), saveProgress(), scrollRatio()

### Community 6 - "Preference Architecture"
Cohesion: 0.40
Nodes (5): Browser localStorage, reader.json, Reader Preferences, Reading Position, Translator Project

### Community 7 - "Web Server Routes"
Cohesion: 0.40
Nodes (3): app, __dirname, PAGE_SIZES

### Community 8 - "File Access Safety"
Cohesion: 0.50
Nodes (4): chapterText(), resolveWithin(), safeName(), sizeOf()

### Community 9 - "Application Overview"
Cohesion: 0.50
Nodes (4): Chapter Metadata Cache, data Directory, Node, Express, and EJS Stack, Read Novel Web Application

## Knowledge Gaps
- **22 isolated node(s):** `FILE`, `RANGES`, `DEFAULTS`, `state`, `__dirname` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `splitTitleBody()` connect `Chapter Parsing` to `Web Server Routes`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `chapterRefs()` connect `Chapter Discovery` to `File Access Safety`, `Novel Data Store`, `Web Server Routes`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `FILE`, `RANGES`, `DEFAULTS` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._