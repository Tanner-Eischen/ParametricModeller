# Tool-Workflow Improvements + Progressive App.ts Reduction

Unifies two threads of work into one plan:
- **A. Tool-workflow improvements** — make the interactive modeling tools solid
  (copy/duplicate independence, then the other tool-session flows).
- **B. Progressive App.ts reduction** — keep shrinking the 9,000-line god class
  incrementally, behavior-preserving, folded into normal work.

Status legend: 🚧 in progress · ⏳ pending · ✅ done

---

## A. Tool-workflow improvements

Goal: every interactive command previews cleanly, commits with feedback
(`Added …`), and cancels to a byte-equivalent document; the universal
Enter/Escape contract holds across all tools. Source of truth = the e2e suite.

### A1. Copy / Duplicate independence — 🚧 re-attempt

**Why:** Duplicate (key D / `addDuplicate`) currently commits a *dependent*
`moveCopy` feature whose rebuild re-reads its source (`rebuildMoveCopy`
mode='copy' → `translateBody(source, …, ${source.id}_${feature.id}_copy)`,
`refsIn=[sourceFeatureId]`). So deleting the original makes the copy vanish, and
the copy isn't an independent edit target. A commit (`8556a8c`) tried to fix this
and was **reverted** (`2afb304`) with three regressions:

1. deleting the original still removed the copy,
2. editing a copy's dimensions spawned a spurious extra box,
3. no commit feedback.

**Root cause of the regressions (preliminary):** the reverted attempt did the
conversion *at commit time* (`convertCopyPreviewToBake` swapped the moveCopy
preview feature for a new box/bakeBody inline in `commitFeaturePreview`). That
swap raced the `PreviewTransaction` + the no-history `rebuildAll` that validates
the preview, swapping `featurePreviewFeatureId` mid-commit — so the body-id /
scene-object accounting and the status emit broke. Confirm this in the rebuild
path (`App.ts` `commitFeaturePreview` ~5605, `rebuildAll` ~6632 scene clear +
`syncDocumentBodies`) before coding.

**Re-attempt strategy — convert at PREVIEW START (creation), not at commit.**
Make the copy independent by construction so the commit path stays unchanged:

- A copy of a **box** → at `addDuplicateFeature` time, create a new independent
  box feature (deep-clone source box params, origin offset by the displacement;
  empty `refsIn`) instead of a moveCopy-copy. The copy remains width/depth/height
  editable like the original.
- A copy of any **other** source → snapshot the source geometry into a
  `BakeBody` (the `BAKE_BODY_FEATURE_TYPE` primitive from `5865224`) at creation
  time; empty `refsIn`. Editable via tools; survives source deletion.
- The drag-to-place preview UX is unchanged: the translation triad still drives a
  live displacement; the displacement is folded into the box origin / baked
  geometry when the preview feature is created, and refined on drag.

Because the feature created at preview start is *already* the independent one,
`commitFeaturePreview` needs **no commit-time swap** — so regressions #2 (clone
residue) and #3 (feedback) disappear by construction, and #1 (delete-survives)
holds because `refsIn` is empty and rebuild never re-reads the source.

**Test plan:** the current contract (`tests/e2e/modeling-workflows.spec.ts`
~1376–1466: `previews and commits an exact body copy`, `Escape cancels…`,
`transform previews avoid rebuilds…`, `Enter commits the exact displacement…`)
expects `moveCopy` count 1 for a box copy. Decide as part of A1:
- keep the copy as a `moveCopy` feature with empty `refsIn` (existing assertions
  unchanged, independence added as new assertions), or
- switch box copies to a new independent box feature (update those 4 tests to
  assert the box-feature copy, mirroring what `8556a8c` did to the 2 tests).

Recommendation: produce the independent feature at creation AND treat the box
copy as a new box feature — then verify all four existing copy tests still pass
(updated where needed) and ADD new tests: *delete original → copy survives*,
*edit copy dims → only the copy changes (no extra body)*, *commit emits
`Added Copy N`*. Cancel-byte-equivalence and no-rebuild-on-drag must still hold.

**Unit tests to add:** driver behavior lives at the feature level; add
`tests/features/` coverage for the independent copy feature (box-clone origin
correctness, bake snapshot independence, empty `refsIn`).

### A2. Other tool-session flows — ⏳

Smoke-test and finish each against the universal Enter/Escape +
preview-then-commit contract. `20f0eab` already fixed the rotate commit path
(`refreshRotateBodyExperience` no longer rebinds the gizmo mid-session). Cover:

- **Rotate Body** — verify the `20f0eab` fix holds; Enter commits, Escape cancels
  byte-equivalent, no second session spawned on first ring drag.
- **Push/Pull** — preview isolate, signed distance, source hidden during preview,
  Escape restores, Enter commits as `offsetFace` with feedback.
- **Mirror / Linear Pattern** — previews avoid rebuilds; Enter commits the exact
  params; Escape removes the preview feature and restores the document.
- **Move Vertex** — guarded planarity; independent-body semantics for the baked
  edit; Enter/Escape contract.
- **Miter Cut** — requires an explicit face; split/trim + single/threeWay;
  commit-disabled-on-invalid; undo removes; Escape restores byte-equivalent.

For each, prefer the e2e as the spec; if a flow is e2e-green it's done.

### A3. e2e harness/app-state failures (separate, but block verification) — ⏳

Three e2e failures predate this work and were confirmed this session:
- modeling `starts calm`: the hidden contextual sections (Diagnostics/Woodworking/
  Sketch/Recent/Assembly, created with `hidden:true`) make the run-collapsed toggle
  list unfindable.
- responsive `first run`: `welcomeOverlay.setVisible(false)` runs unconditionally
  in `refreshUiChrome`, so the Quick-Start overlay never shows on first run.
- wood-joint spec: its `openCleanModeler` doesn't seed toolbar-expansion
  localStorage (the `73241fe` fix only touched the modeling spec).

Triage each as app-fix vs harness-fix. These gate e2e verification of A1/A2, so
resolve before trusting the e2e green for the tool work.

---

## B. Progressive App.ts reduction

Goal: keep shrinking `src/App.ts` (currently 9,189 lines) incrementally,
behavior-preserving, one cohesive concern per commit, each behind a green
`npm run check` gate. Seeded this session: `src/app/PanelChrome.ts`,
`src/app/GizmoManager.ts`, and `src/app/ModelBrowserController.ts` (✅, ~235
lines moved, 1099 tests green).

**Approach — opportunistic, not big-bang:** when work touches a pending cluster,
extract it (or its touched part) into `src/app/<X>.ts` as the same-or-prereq
commit. Risk gate: low-coupling clusters are fair game any time; cross-cutting
rewires of shared mutable state get dedicated, gated sessions.

**Extraction contract (matches PanelChrome/GizmoManager/ModelBrowserController):**
a `class` taking injected deps in its constructor (getter callbacks for read
context, action callbacks + setters for the few shared-mutable writes); holds no
App state of its own; instantiates as a field-init singleton
(`private x = new X({ …callbacks… })`); moves code only.

**Remaining clusters, lowest-coupling first:**
1. **Woodworking/measurement/export** (~App.ts 1718–2545) — ⏳ — self-contained;
   owns its scratch fields + transient model metadata; reads via ~10 helpers.
   Caveat: `getWoodworkingUnit`/`formatLengthInput` are shared (~30 call sites in
   the context-task cluster) — extract to a small `src/app/` units helper or
   inject. Target `src/app/WoodworkingController.ts`.
2. **Command/keyboard registry** (~App.ts 1149–1493) — ⏳ — mechanically cleanest
   (zero shared-state write beyond the two registries it owns) but widest ctor
   (~40 triggers + ~10 getters). Target `src/app/CommandRegistry.ts`.
3. **Context-task + preview-session helpers** (~App.ts 2547–3438 + 5440–5665) — ⏳
   — the connective hub; writes `this.features` directly, runs the only non-core
   `PreviewTransaction`, invokes `rebuildAll`. **Dedicated session, last.** This
   is exactly the cluster A1's copy conversion touches — so A1 should land first
   and simplify (or be folded into) this extraction.

---

## How A and B interleave

A1 (copy independence) touches the moveCopy creation path + `commitFeaturePreview`
+ the preview machinery — i.e. cluster #3's territory. Plan A1 to land first
and, in doing so, tidy that path; the full cluster-#3 extraction then follows as
a dedicated session. Woodworking/command extractions can proceed opportunistically
any time unrelated work touches them.

## Verification (every step)

- `npm run check` (lint + typecheck + build + 1099 unit tests) must stay green.
- `npm run test:e2e` after tool-flow changes (A1/A2) — baseline is the 3 failures
  in A3; fix A3 first or explicitly confirm no new regressions beyond them.
- Prefer the e2e suite as the spec for tool behavior; add unit tests for
  feature-level mechanics.

## Baseline captured this session
- typecheck clean, `npm test` 1099 pass, lint clean.
- ModelBrowserController extracted; `npm run check` green.
- e2e: 3 pre-existing failures (see A3); full suite otherwise not yet re-run
  post-ModelBrowserController extraction.
