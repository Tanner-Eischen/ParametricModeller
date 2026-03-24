# Milestone 07: Vertex-level editing (guarded)

## Goal
Add sub-object selection and a guarded MoveVertex feature that preserves planar faces and maintains parametric rebuild.

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

### Vertex and edge selection v1

**Purpose:** Enable vertex-level operations in a controlled way.

**Primary user story:**

- As a user, I can select a corner vertex and see it highlighted.

**What to build:**

- Picking for vertices and edges with screen-space tolerance
- Selection priority rules: vertex over edge over face over body when in sub-object mode
- Highlight rendering and snapping targets from selected sub-objects

**Interfaces and data:**
- PickResult: includes entityType {vertex|edge|face|body} and id
- SelectionState: current sub-object mode and selected ids

**Tool-level acceptance criteria:**
- Selecting small vertices is possible without extreme zoom due to tolerance

### MoveVertex feature (guarded)

**Purpose:** Allow limited vertex edits while preserving planar faces and sharp edges.

**Primary user story:**

- As a user, I can move a corner vertex along Z by 0.5 in to create a sloped face when allowed.

**What to build:**

- Parameters: vertexRef, delta vector or target position, axis locks, numeric entry
- Planarity guard: adjacent faces must remain planar after move
- v1 policy: block if move would make any adjacent face non-planar
- Optional v2 policy: auto-split faces to preserve planarity

**Interfaces and data:**
- MoveVertexParams: {vertexRef, dx, dy, dz, lockAxisMask}
- PlanarityCheck: evaluate each adjacent face polygon after applying move

**Tool-level acceptance criteria:**
- Allowed moves rebuild consistently and remain manifold
- Disallowed moves are rejected with a reason listing the face(s) that would warp

### Constraint-aware gizmo for vertex edits

**Purpose:** Ensure vertex edits are precise and predictable.

**Primary user story:**

- As a user, I can move a vertex only along X and type an exact value.

**What to build:**

- Axis handles for X/Y/Z in world frame, plus optional local frame
- Snapping to grid and other vertices
- Preview and commit semantics consistent with push/pull

**Interfaces and data:**
- VertexGizmoController integrated with SnapSettings and Numeric parser

**Tool-level acceptance criteria:**
- Preview move is fast and does not permanently mutate the model until commit

## User stories for this milestone

- As a user, I can do small geometric tweaks at vertices when prismatic tools are insufficient.
- As a user, the app prevents vertex moves that would break flat faces.
- As a user, vertex edits are parametric and editable later.

## Implementation steps

### Sub-object selection expansion

- Add edge and vertex render proxies for picking (lines and points)
- Implement selection mode switching UI (Body, Face, Edge, Vertex)
- Implement selection precedence and multi-select

### Planarity enforcement

- For a candidate vertex move, compute updated polygons for adjacent faces
- Check if all vertices of each face remain coplanar within tolerance
- Define tolerance based on units (e.g., 1e-6 m internal) and expose as constant

### MoveVertex feature rebuild

- Implement feature that applies vertex translation in the B-Rep
- Update affected edges and faces, then revalidate manifoldness
- Reject if any face becomes non-planar or if body becomes invalid

### UI and feedback

- Show on-hover warnings when a drag would become invalid
- On rejection, show a message naming the violating faces and suggested axis locks
- Add parameter inspector for MoveVertex feature

## Acceptance criteria

- User can select vertices and edges with reasonable hit tolerance.
- User can perform a MoveVertex operation that is committed as a feature and remains editable.
- The tool blocks moves that would violate planarity and explains why.

## Out of scope for this milestone

- Automatic face splitting for invalid moves (optional later).
- General poly-modeling operations like bevel, inset on arbitrary topology.

## Notes and risks

- Vertex editing can destabilize references. Treat it as an advanced tool with strong guardrails and excellent feedback.
