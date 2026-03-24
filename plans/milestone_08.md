# Milestone 08: Robust references and topology naming

## Goal
Stabilize feature references across rebuilds using predictable topology IDs, signature fallback matching, and actionable diagnostics.

## Shared constraints for all milestones
- Primary geometry is planar and prismatic: flat faces, sharp edges.
- History-based, parametric rebuild is the source of truth.
- “Direct edits” are implemented as features (so they are editable and rebuildable).
- v1 blocks risky operations rather than attempting heroic geometry repair.
- Rendering uses triangulation or quad rendering as a view layer only. Do not treat triangles as the primary model.
- Every tool must have a deterministic rebuild outcome given the same inputs.

## Cross-cutting components (built progressively)
These components appear across multiple milestones. Earlier milestones can implement stubs that get refined later.
- Scene model: documents, bodies, transforms, selection sets.
- Geometry core: planar B-Rep entities and validation rules.
- Feature system: feature definitions, parameter storage, rebuild pipeline, dependency graph.
- Reference system: stable IDs and fallback matching, broken-reference reporting.
- View layer: picking, gizmos, snapping, overlays (grid, dimensions), render mesh cache.
- Persistence: JSON-based file format for scene + feature tree.
- Testing: golden scenes and measurement-based invariants.


## Tools and software components to build

### Stable topology IDs and mapping propagation

**Purpose:** Keep downstream features attached to the intended faces/edges after rebuilds.

**Primary user story:**

- As a user, I can change the size of a board and my pocket cut stays on the same face.

**What to build:**

- ID strategy: each feature assigns IDs to its output entities in a predictable scheme
- Propagation: when a feature transforms or patterns entities, map IDs deterministically
- Fallback matching: geometric signature matching if an ID is missing

**Interfaces and data:**
- TopoId: {featureId, localId}
- Signature: plane normal + centroid + area for faces; direction + length + adjacent face signatures for edges

**Tool-level acceptance criteria:**
- Common upstream edits do not break downstream references in typical woodworking scenes

### Reference resolver and diagnostics panel

**Purpose:** Detect and explain broken references rather than silently failing.

**Primary user story:**

- As a user, I can see exactly which feature broke and what reference is missing.

**What to build:**

- Resolver: for each feature input ref, attempt by ID then by signature
- If unresolved: mark feature as broken and stop rebuild downstream or skip feature with warning (choose policy)
- UI: diagnostics list; click to navigate to failing feature and highlight candidate geometry

**Interfaces and data:**
- ResolveResult: {status, resolvedEntityId?, candidates[]}
- Diagnostic: {severity, featureId, message, refs[]}

**Tool-level acceptance criteria:**
- Broken references are visible and actionable; user can identify the issue quickly

### Rebuild determinism tests

**Purpose:** Prevent reference drift and nondeterministic rebuilds as complexity grows.

**Primary user story:**

- As a developer, I can run tests to ensure edits do not randomly break models.

**What to build:**

- Golden scenes: saved design files with expected measurements
- Hashing: canonicalize output geometry to compare across rebuilds
- Reference stability tests: edit upstream params and verify downstream refs remain attached

**Interfaces and data:**
- Test harness: load file, apply param change, rebuild, measure invariants

**Tool-level acceptance criteria:**
- CI or local test run reliably catches reference regressions

## User stories for this milestone

- As a user, downstream features remain attached after I edit earlier dimensions.
- As a user, if something breaks, I know what and can fix it.
- As a developer, I have automated tests for rebuild stability and determinism.

## Implementation steps

### ID scheme formalization

- Define how each feature assigns face/edge/vertex IDs (Box, Extrude, OffsetFace, Cut, Pattern, Mirror)
- Implement ID propagation rules for transforms and instancing
- Add ID serialization to file format

### Signature-based fallback matching

- Implement face signatures and edge signatures with tolerances
- Implement candidate search within a body using signatures
- Add tie-break rules (closest centroid, best normal alignment, largest overlap)

### Diagnostics and UI

- Implement rebuild pipeline that produces resolve diagnostics
- Create diagnostics panel with filter and navigation
- Add viewport highlighting of unresolved refs and candidates

### Test harness

- Create a folder of golden scenes and expected invariants
- Implement measurement helpers (bbox dims, face count, volumes optional)
- Add regression tests for common edits (resize box, change extrude depth, edit sketch dims)

## Acceptance criteria

- Common edits do not break downstream features in representative woodworking projects.
- When references break, the UI reports the failing feature and missing reference and suggests candidates.
- Automated tests exist for determinism and reference stability.

## Out of scope for this milestone

- Full industrial-strength topological naming across arbitrary boolean operations.
- Automatic repair of broken references without user involvement.

## Notes and risks

- Topology naming is a known hard problem. The woodworking constraint set makes a pragmatic solution viable.
