# Milestone 10: Quality, performance, packaging

## Goal
Harden the application with tests, performance instrumentation, autosave, and distributable builds with schema migrations.

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

### Regression test suite for rebuild determinism

**Purpose:** Ensure feature rebuild remains stable as toolset grows.

**Primary user story:**

- As a developer, I can detect rebuild regressions before shipping.

**What to build:**

- Golden scenes with expected invariants and outputs
- Parameterized tests that apply edits and validate results
- Geometry hashing for stable comparisons

**Interfaces and data:**
- Test runner loads design files, applies scripted edits, rebuilds, asserts invariants

**Tool-level acceptance criteria:**
- Tests fail on nondeterministic rebuild or broken references

### Performance instrumentation and targets

**Purpose:** Maintain interactive editing and rebuild speed.

**Primary user story:**

- As a user, editing dimensions feels immediate even in larger projects.

**What to build:**

- Rebuild timing per feature and overall
- Triangulation cache hit rate metrics
- Picking acceleration structure metrics (BVH if used)

**Interfaces and data:**
- PerfReport: {featureTimes, totalTime, cacheStats}

**Tool-level acceptance criteria:**
- Representative 200-feature scene rebuilds under a defined target on dev hardware

### Autosave and crash recovery

**Purpose:** Prevent catastrophic data loss during iterative design.

**Primary user story:**

- As a user, if the app crashes, I can recover the latest autosave.

**What to build:**

- Autosave interval and rolling backups
- Recovery prompt on next launch
- Corruption handling: keep multiple snapshots

**Interfaces and data:**
- AutosaveManager: schedule, write snapshots, maintain manifest

**Tool-level acceptance criteria:**
- Autosave files are created and recovery works reliably after forced termination test

### Packaging and distribution

**Purpose:** Produce a usable build for real woodworking use.

**Primary user story:**

- As a user, I can install and run the tool without a dev environment.

**What to build:**

- Build pipeline for target platform(s)
- Versioning and migration of file schema
- Basic telemetry optional; keep off by default for privacy

**Interfaces and data:**
- Release artifacts with versioned installers and changelog

**Tool-level acceptance criteria:**
- User can install and open existing files from previous version without data loss

## User stories for this milestone

- As a user, the app stays responsive and does not lose data.
- As a developer, I can catch regressions in rebuild, references, and outputs.
- As a user, I can update the app and keep my project files working.

## Implementation steps

### Testing infrastructure

- Create measurement-based invariants for each golden scene
- Add scripted edit sequences to validate feature stability
- Integrate tests into the main build flow

### Performance work

- Add timers around feature rebuild and triangulation
- Implement caching strategy for unchanged features and unchanged faces
- Implement or tune picking acceleration (BVH) if selection becomes slow

### Reliability features

- Implement autosave snapshots and recovery UI
- Add safe-write semantics (write temp then rename) for save files
- Add corruption detection for JSON and recovery from last good snapshot

### Packaging and migrations

- Define semantic versioning and schema version migrations
- Write migration code for each schema update (v0 -> v1, etc)
- Create packaged builds and perform install/uninstall tests

## Acceptance criteria

- Automated test suite exists and covers rebuild determinism, reference stability, and export correctness.
- Performance instrumentation exists and meets defined rebuild and interaction targets in representative scenes.
- Autosave and recovery work under forced-crash test, and packaging produces installable builds with schema migrations.

## Out of scope for this milestone

- Advanced collaboration, cloud sync, or multi-user editing.
- Full plugin system.

## Notes and risks

- Do not delay tests until the end. Start golden scenes earlier, but formalize in this milestone.
