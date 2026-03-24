# Milestone 03: Push/Pull as a feature

## Goal
Add face selection and a push/pull tool that creates an editable OffsetFace feature with snapping and numeric input.

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

### Sub-object selection: faces v1

**Purpose:** Select planar faces to drive push/pull and face-based features.

**Primary user story:**

- As a user, I can click a face of a board and see it highlighted.

**What to build:**

- Picking against face triangles for accurate hit testing
- Face highlight rendering and display of face normal indicator
- Selection context: body + face id

**Interfaces and data:**
- PickResult: includes faceId and barycentric hit point
- SelectionState: active face selection separate from body selection

**Tool-level acceptance criteria:**
- Clicking near an edge selects the correct face reliably
- Selected face highlight updates on rebuild if face reference remains valid

### Push/Pull tool implemented as OffsetFace feature

**Purpose:** Direct modeling feel while remaining parametric and rebuildable.

**Primary user story:**

- As a user, I can select a face and type +0.75 in to extend the board.

**What to build:**

- Tool UX: select face, drag gizmo along normal, type distance, apply
- Feature creation: OffsetFace(feature) references a face and a distance
- Geometry op: for prismatic solids, offset a planar face and extend side faces
- Guardrails: block operations that would invert volume or self-intersect

**Interfaces and data:**
- OffsetFaceParams: {faceRef, distance, mode: addMaterial}
- Rebuild uses faceRef to locate target face on current body

**Tool-level acceptance criteria:**
- Offsetting a box face by a positive distance increases overall dimension exactly
- Editing offset distance rebuilds the body without losing manifoldness

### Snapping and numeric input v1

**Purpose:** Enable precise orthogonal edits that match woodworking expectations.

**Primary user story:**

- As a user, I can drag a face and have it snap to 1/16 in increments.

**What to build:**

- Grid snap: configurable step size (e.g., 1/16 in, 1 mm)
- Axis lock: constrain movement to X/Y/Z or face normal
- Angle snap for rotations (0/90/45) for later assembly tools
- Numeric entry for distances and offsets in the status bar or HUD

**Interfaces and data:**
- SnapSettings: gridStep, enableGridSnap, enableAxisLock
- Numeric parser: supports units suffix (in, mm) and fractions (1/16) if desired

**Tool-level acceptance criteria:**
- Dragging a face respects active snap settings
- Typed values override drag values deterministically

### Transform gizmo v1

**Purpose:** Provide consistent direct manipulation for bodies and faces.

**Primary user story:**

- As a user, I can move a body along an axis with a familiar handle.

**What to build:**

- Translate gizmo for bodies (existing) and face-normal handle for push/pull
- Visual feedback: delta readout in chosen units
- Cancel and apply behaviors are consistent across tools

**Interfaces and data:**
- GizmoController: begin(entity), update(delta), commit(), cancel()

**Tool-level acceptance criteria:**
- Commit creates a feature (for face edits) or updates transform (for bodies)
- Cancel returns to previous state without residue

## User stories for this milestone

- As a user, I can select a face and push/pull it to change part dimensions.
- As a user, I can type an exact offset distance rather than eyeballing.
- As a user, push/pull edits show up in the feature tree and can be edited later.

## Implementation steps

### Face picking and highlighting

- Expose face triangulation per body for picking
- Return faceId in pick results and update selection state
- Render face highlight overlay and optional normal arrow

### OffsetFace feature geometry

- Given a planar face and distance, compute the offset plane
- Update affected side faces by extending or shrinking their boundary loops
- Maintain adjacency: reuse existing side faces when possible; create new edges if necessary
- Run validation; if invalid, fail feature with a clear message

### Tool UX for push/pull

- Implement push/pull mode with a face-normal handle
- Support drag to preview and numeric input to set exact distance
- On commit, create OffsetFace feature and rebuild

### Snapping and numeric entry

- Implement global snap settings and toggles
- Implement numeric parsing for distances with unit conversion
- Integrate snapping into gizmo delta generation

## Acceptance criteria

- User can select a planar face and apply a push/pull offset that rebuilds as a parametric feature.
- Snapping and numeric entry are integrated and reliable for orthogonal edits.
- Invalid offsets are blocked with a clear reason and no corruption of prior geometry.

## Out of scope for this milestone

- Edge and vertex selection (later milestone).
- Offsetting faces that produce complex topology changes (v1 blocks).
- Through-all, up-to-face, and other advanced extent modes.

## Notes and risks

- OffsetFace is the workhorse for woodworking style direct edits; invest in guardrails and clear errors.
- Treat direct edits as feature creation, not in-place mutation, to keep rebuild coherent.
