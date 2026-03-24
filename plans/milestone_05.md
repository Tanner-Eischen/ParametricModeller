# Milestone 05: Patterning

## Goal
Add linear pattern and mirror tools suitable for woodworking repetition, with instance selection and stable references.

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

### Linear pattern feature

**Purpose:** Replicate features for shelves, slats, holes, dados, and hardware patterns.

**Primary user story:**

- As a user, I can pattern a pocket cut 5 times at 2 in spacing along X.

**What to build:**

- Pattern source: a feature instance (recommended) or selected faces (later)
- Parameters: count, spacing, direction (axis or vector), symmetric option
- Rebuild strategy: instantiate N copies as dependent features or as a single feature that generates N outputs

**Interfaces and data:**
- PatternParams: {sourceFeatureId, count, spacing, direction, symmetric}
- Reference mapping: each instance should have traceable IDs for downstream selection

**Tool-level acceptance criteria:**
- Changing source feature updates all instances
- Changing count or spacing rebuilds without leaving orphaned geometry

### Mirror feature

**Purpose:** Create symmetric parts and repeated joinery quickly.

**Primary user story:**

- As a user, I can mirror a cut across the center plane of a board.

**What to build:**

- Mirror plane: world plane or face plane
- Mirror source: feature(s) or body(s)
- For feature mirroring: generate mirrored feature parameters (e.g., flip direction)

**Interfaces and data:**
- MirrorParams: {sourceFeatureId or bodyId, planeRef}

**Tool-level acceptance criteria:**
- Mirrored instances remain aligned as upstream geometry changes

### Instance selection and labeling

**Purpose:** Make patterned features selectable and understandable.

**Primary user story:**

- As a user, I can click the 3rd pocket in a pattern and see which instance it is.

**What to build:**

- Stable instance indexing (0..N-1) and displayed label
- Selection highlights show instance id and source feature

**Interfaces and data:**
- InstanceRef: {patternFeatureId, index, localRefs}

**Tool-level acceptance criteria:**
- Selecting an instance shows its index and lets user edit the parent pattern feature

## User stories for this milestone

- As a user, I can create a shelf pin hole pattern or pocket pattern quickly.
- As a user, I can mirror joinery so left and right parts remain symmetric.
- As a user, I can edit the base cut and have all copies update.

## Implementation steps

### Decide patterning model

- Prefer feature-instancing over geometry-copying to keep references stable
- Define how patterned features appear in the tree (collapsed node with instances)

### Implement linear pattern

- Create pattern feature that references a source feature id and generates N transforms
- During rebuild, evaluate source feature once and clone its resulting operation with transforms or offsets
- Assign stable IDs per instance based on (patternId, index, sourceLocalId)

### Implement mirror

- Implement geometric mirror transform in plane coordinates
- Mirror feature parameters consistently (distance sign flips, plane normal flips as needed)
- Assign stable mirrored IDs based on source mapping

### UI and selection

- Expose pattern and mirror tools in UI with numeric inputs
- Enable selecting an instance and surfacing pattern feature parameters for editing
- Add preview ghost instances before commit

## Acceptance criteria

- User can linear-pattern a cut feature with editable count, spacing, and direction.
- User can mirror a feature or body across a plane and maintain symmetry after edits.
- Pattern instances are selectable and traceable back to their source feature.

## Out of scope for this milestone

- Circular patterns.
- Patterns along arbitrary curves.
- Suppressing individual instances (optional later).

## Notes and risks

- Pattern features amplify topology naming issues; ensure instance IDs are stable and do not reorder unexpectedly.
