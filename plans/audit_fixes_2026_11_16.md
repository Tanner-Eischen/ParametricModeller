# November audit fixes

Scope: implement the correctness findings from [the audit](audit_2026_11_16.md), locally. No browser/platform UI, deployment, push, or commit. Optional product features from the audit's later-improvements list are outside this repair scope.

## Behavior changes

| Area | Result |
|---|---|
| New / Open / Recent | Shared Save / Discard / Cancel guard. Discard preserves an outgoing recovery snapshot; recovery failure blocks replacement. Cancel does not mutate history or previews. |
| Async save | Captures document epoch and history revision. Newer edits remain dirty; stale completion cannot alter another document. Concurrent requests for the same document share one save; a previous document's write must finish before another starts. |
| Exit | Dirty documents request native unload confirmation even if recovery fails. Recovery does not mark a document saved. |
| Imported document structure | Validate before replacing the current document; malformed transforms and other invalid containers are rejected. Unknown feature types and unresolved references remain available to normal rebuild diagnostics. |
| Manufacturing orientation | Shared controller follows exact historical placement/rotation/mirror transforms, circular occurrences, and component source revisions. Rigid placements retain board-local dimensions and grain orientation. |
| Hole / curved Fillet | Commands disabled with reasons. Persisted operations return explicit unsupported diagnostics, rather than successful empty/duplicated geometry. Suppressing an unsupported feature permits rebuild. Planar chamfer remains available through woodworking joints. |
| Circular Pattern | Exact body source, authored pivot, distinct full-circle placements, defined partial/symmetric spacing, finite bounded inputs, feature/occurrence topology IDs, preview/commit/cancel and editable parameters. |
| Assembly mates | Reconstructed from current feature outputs on every rebuild. Solved transforms/statuses publish transactionally; broken/conflicting/unsatisfied mates fail closed. Existing axis locks are respected. |
| Component history | Selected feature outputs account for consumed bodies, so a join does not resurrect its input as extra material. Explicit components of earlier history retain their authored snapshots. |
| Exports | Registered STL, STEP, and 3MF commands export visible solids from freshly validated history. Active previews cannot export. All physical coordinates use millimeters. |
| Cut lists / shop drawings | Revalidate current geometry before preparing manufacturing output. Cut-list download rejects changes made to the document or history after its review opened. |

## Export contract

- STL: ASCII triangles from the shared hole-aware triangulator; multiple visible bodies are supported.
- 3MF: binary OPC ZIP package, shared mesh vertices, build items, units, and valid escaped metadata.
- STEP: AP203 faceted B-Rep with planar polygon boundaries, including holes, separate solids, and explicit millimeter units.
- Invalid or incomplete shells are rejected; export never silently omits a failed face.
- Exporters load on demand. No new production dependencies were added.
- Independent STEP validation instructions are in [tests/export/README.md](../tests/export/README.md). This is CLI validation, not platform UI inspection.

## Regression coverage

Tests exercise actual App command/preview/history methods with rendering boundaries mocked, plus the pure lifecycle controller, real history/autosave dependencies, geometry handlers, assembly reconstruction, metadata propagation, and independent mesh readers. Delayed I/O tests cover edits, undo, history truncation, document switching, save cancellation, and concurrent requests. UI component tests use jsdom without opening a browser.

The export suite covers boxes, concave prisms, through-holes, rotated solids, multiple bodies, malformed geometry, metadata escaping, and units. Five STEP fixtures were also read by an isolated OpenCascade installation, checking B-Rep validity, solid counts, bounds, and volume.

## Verification

The original November 16 local checks passed:

- `npm run lint` — passed with zero warnings.
- `npm run build` — TypeScript and Vite production build passed. Vite retains its non-fatal warning for chunks larger than 500 kB.
- `npm run test:coverage -- --silent` — **147 test files, 1,292 tests passed**. This includes the Node performance tests.
- Coverage: **78.25% branches**, **83.68% functions**, **69.68% lines/statements**. The branch gate remains **78%**; no thresholds were lowered.
- `git diff --check` — passed.
- Independent OpenCascade readback — all five STEP fixtures passed validity, solid-count, bounds, and volume checks.

The baseline was 1,105 passing tests with a failed 77.74% branch gate. The final result adds 187 regression tests. Full local coverage output is in `%TEMP%/modelling-audit-fixes-final-20261116.log`, with the generated summary in `coverage/coverage-summary.json`.

### November 17 integration before commit

Integrated the four newer `origin/main` commits through `903f6db`, preserving the editable frame example and portable scene import/download flows. The frame example loader now shares the unsaved-work guard; direct per-instance world-space manufacturing metadata remains authoritative. Harnesses exercise the combined lifecycle and controller APIs without removing existing assertions.

The upstream toolchain had independently migrated to Vitest/coverage-v8 5.0.5 and documented new same-source coverage floors in [coverage migration](../release/COVERAGE_MIGRATION.md). Those floors and the upstream dependency lock are preserved; the old reporter's percentages above are historical, not directly comparable to this run.

- Lint, TypeScript, and production build passed.
- **156 files and 1,361 tests passed** under Vitest 5.
- Coverage passed: **55.42% branches**, **66.70% functions**, **67.41% lines**, **66.22% statements** against the upstream floors of 51.8%, 63.5%, 63.6%, and 62.5% respectively.
- Test workers are capped at four after concurrent unrestricted runs encountered worker-start timeouts on the developer machine. No coverage exclusions or thresholds were changed to accommodate the fixes.
- STEP fixture generation also passed using the upstream `tsx` runner.
- Full coverage output: `%TEMP%/modelling-prepush-coverage-bounded-20261117.log`.

Browser/e2e tests, real native file dialogs, deployed behavior, and native installer acceptance are unverified because browser access was not authorized. Web packaging remains a static web distribution, not a desktop installer.

## Implementation boundaries

- Curved surfaces, a new drilling kernel, and new product features were not introduced.
- Authored versus constraint-derived axis locks are not separated by a new schema. A mate that would require moving a locked axis fails with a diagnostic.
- `App.ts` still coordinates the workspace. Only the document lifecycle and manufacturing metadata responsibilities were extracted during these fixes; no broad UI refactor was attempted.
- Temporary probes must not be removed from a test tree while a full-suite discovery/run is active. Retained regression tests replace the audit's temporary probes.
