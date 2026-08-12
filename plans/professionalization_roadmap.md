# Professionalization Roadmap

## Goal

Raise the application from a capable planar CAD prototype to professional interaction quality for deterministic, history-based woodworking models.

The roadmap intentionally keeps the existing planar/prismatic scope. Curved faces and a general-purpose industrial solid kernel remain out of scope unless the project constraints change.

## Delivery principles

- History remains the source of truth.
- Every modeling command previews before it commits.
- Enter commits and Escape cancels every tool session.
- Canceling a tool leaves the document unchanged.
- Rebuilding identical history produces identical geometry and topology IDs.
- Invalid geometry fails closed and preserves the last valid result.
- Core workflows must be discoverable without knowing keyboard shortcuts.
- Each phase adds automated verification before expanding feature breadth.

## Phase 0: Baseline and safety

### Outcome

Add linting, a single local verification command, browser workflow tests, canonical geometry hashing, golden scenes, and continuous integration.

### Acceptance criteria

- Lint, type checking, build, unit tests, coverage, golden tests, and browser smoke tests pass.
- At least five canonical user workflows are covered in a real browser.
- A repository-local commit gate rejects lint, type-check, build, or unit-test failures; CI additionally gates coverage and browser workflows.
- Canonical geometry output is independent of map insertion order.
- CI uses the same commands developers use locally.

## Phase 1: Rebuild integrity

### Outcome

Introduce typed feature outputs and references, live sketch resolution, deterministic topology allocation, a validated dependency graph, and a centralized tolerance policy.

### Dependencies

- Phase 0 characterization and determinism tests.

### Acceptance criteria

- Editing a sketch updates dependent extrude and cut features.
- Ten identical rebuilds produce identical geometry hashes and topology IDs.
- Missing references and dependency cycles produce actionable diagnostics.
- Suppressing or deleting a feature cannot silently retarget downstream features.

## Phase 2: Interaction foundation

### Outcome

Replace overlapping tool-mode booleans and duplicated keyboard routing with a command dispatcher, explicit tool sessions, preview transactions, pointer gesture arbitration, hover/preselection, and shared numeric input.

### Dependencies

- Phase 1 typed references for stable selection targets.

### Acceptance criteria

- Enter commits and Escape cancels every interactive command.
- Canceling leaves a byte-equivalent document snapshot.
- Orbit, pan, drawing, and selection gestures do not conflict.
- Undo and redo restore geometry, feature state, and selection consistently.
- Distance fields accept decimal, fractional-inch, metric, relative, and expression input.

## Phase 3: Professional sketching

### Outcome

Provide camera-projected sketch geometry, shared endpoints, inference snapping, driving dimensions, geometric constraints, editable handles, trim/extend/project tools, center rectangles, and regular polygons.

### Dependencies

- Phase 2 tool sessions and numeric input.
- Phase 1 deterministic sketch/profile references.

### Acceptance criteria

- Rectangle, L-shaped, and U-shaped profiles can be drawn and fully dimensioned in the canvas.
- Horizontal, vertical, coincident, parallel, perpendicular, equal, and fixed constraints are supported.
- Open, branching, self-intersecting, and over-constrained profiles are explained inline.
- Profile extraction and selection remain stable when unrelated sketch entities are added.
- Sketch interaction preview remains responsive under the agreed performance budget.

## Phase 4: Solid and transform workflows

### Outcome

Deliver preview-first Extrude, Cut, and Push/Pull commands; restricted planar boolean difference and union; Move/Copy triads; and manipulator-based Pattern and Mirror commands.

### Dependencies

- Phase 3 stable profile regions.
- Oriented planar loops, holes, strict shell validation, and concave triangulation.

### Acceptance criteria

- Extrude supports New, Add, and Cut operations.
- Extrude supports one-sided, symmetric, distance, up-to-face, and through-all extents where the planar kernel can resolve them safely.
- Ctrl+D enters copy placement with a triad and exact numeric displacement.
- Pattern and Mirror use explicit sources and viewport previews.
- Each accepted command creates one undoable feature; cancellation creates none.
- Invalid topology never replaces the last valid body.

## Phase 5: Workspace and history

**Status:** Complete (2026-07-13)

### Outcome

Separate the model browser from contextual properties, focus the toolbar on active work, add a command palette and view cube, and expand history operations.

### Dependencies

- Phase 2 command and tool-session infrastructure.

### Acceptance criteria

- The active command and its parameters remain visible without scrolling through unrelated panels.
- Features can be renamed, suppressed, resumed, inspected for dependencies, and rolled back safely.
- Body/component visibility and lock state are available from the model browser.
- Named orthographic and isometric views are directly accessible.
- Core workflows are usable by pointer and keyboard.

### Delivered

- Dedicated model browser with feature, body, component, and instance hierarchies.
- Undoable rename, visibility, and lock operations; fail-closed suppression/resume; dependency inspection; and confirmed rollback by suppressing later history.
- Sticky contextual task controls with the universal Enter/Escape contract.
- Ranked Ctrl+K command palette and compact toolbar access to common commands.
- Accessible view cube with six orthographic views and an isometric view.
- Unit and real-browser coverage for the Phase 5 workspace workflows.

## Phase 6: Woodworking and release

### Outcome

Add measurement tools, material and grain metadata, cut-list exports, orthographic drawings, schema migrations, recovery verification, packaging, and enforced performance budgets.

### Dependencies

- Stable references and geometry from Phases 1-4.
- Workspace integration from Phase 5.

### Acceptance criteria

- Exported measurements match model geometry within the central tolerance policy.
- Cut-list grouping remains stable through rebuild, duplication, and save/load.
- Old-schema fixtures migrate without loss.
- Forced-crash recovery stays within the agreed data-loss window.
- The named 200-box Playwright Chromium workload meets enforced end-to-end rebuild/load, real RenderMeshCache reuse, real vertex-picking, and 60-frame viewport budgets under Desktop Chrome 1280x720 emulation in the CI worker.

### Delivered

- Tolerance-aware board measurement with persistent material, grain, thickness-axis, part-label, and notes metadata.
- Viewport grain-direction arrows that follow rotated bodies and component instances.
- Deterministic cut-list grouping and RFC 4180 CSV export, including inherited metadata for copies and patterns.
- Physical-scale front, top, and right SVG shop drawings with dimensions and a title block.
- Ordered lossless schema migration from 0.1.x to 0.2.0 with future-version rejection and migration diagnostics.
- Rolling autosave recovery that skips corrupted newest snapshots, retains failed writes for retry, and verifies the bounded crash window.
- Per-feature rebuild instrumentation plus enforced Node budgets and one attached browser report covering end-to-end rebuild/load, actual render-cache hits/misses, actual application vertex picking under load, and 60 rendered frames for the named 200-box workload.
- Reproducible static-web release archives with manifests and SHA-256 checksums.

## Canonical Phase 0 workflows

1. Create a box and edit its dimensions.
2. Create a world-plane sketch, draw a rectangle, exit sketch mode, and extrude it.
3. Duplicate a body and edit the duplicate translation.
4. Undo and redo a modeling command.
5. Change selection mode and open the discoverability/help surface.

## Required verification gates

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:coverage`
- `npm run test:e2e`
- `npm run check`

Performance tests may run on a scheduled CI job once a stable reference environment is defined, but correctness and workflow smoke tests must run for every change.
