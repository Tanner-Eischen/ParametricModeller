# Milestone 04: Cut feature

## Goal
Deliver subtractive extrusion (pockets and through-cuts) driven by sketches on faces, with strong validity checks.

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

### ExtrudeCut feature

**Purpose:** Create pockets and through-cuts for joinery and hardware layouts.

**Primary user story:**

- As a user, I can sketch a rectangle on a face and cut a pocket 0.375 in deep.

**What to build:**

- Parameters: sketch reference, depth mode, distance, direction, flip
- Depth modes: fixed distance; through-body along normal (stop at exit)
- Output: modified target body (v1 supports single target body)

**Interfaces and data:**
- CutParams: {targetBodyRef, sketchId, mode:distance|through, distance?, flip}
- Rebuild requires stable mapping from sketch plane to target face plane

**Tool-level acceptance criteria:**
- Pocket cut yields planar side faces and a planar bottom face
- Through cut produces an opening with clean, manifold boundaries

### Sketch-on-face workflow

**Purpose:** Make cuts fast by sketching directly on selected faces.

**Primary user story:**

- As a user, I can select a face, hit Sketch, draw, then Cut without manual plane setup.

**What to build:**

- Context actions: Sketch on Face, Cut from Sketch
- Auto-create planeRef from face and attach sketch
- Auto-select the resulting sketch as input to ExtrudeCut

**Interfaces and data:**
- Command: BeginSketchOnSelectedFace
- Command: CreateCutFromActiveSketch

**Tool-level acceptance criteria:**
- End-to-end: select face -> sketch rectangle -> cut pocket, in under 30 seconds

### Solid validity checks for subtractive ops

**Purpose:** Prevent cuts that create impossible or corrupted solids.

**Primary user story:**

- As a user, the app prevents me from making a cut deeper than the part thickness when it would break the solid.

**What to build:**

- Compute intersection depth for through mode
- Detect when cut volume would fully delete the body or create non-manifold remnants
- Clear error messages and non-destructive failure behavior

**Interfaces and data:**
- Validation precheck: cut profile within face bounds or allow overhang with trimming rules (v1: require within face bounds)

**Tool-level acceptance criteria:**
- Invalid cuts are rejected with specific messages, not generic failure

## User stories for this milestone

- As a user, I can create a pocket for a hinge by sketching on a face and cutting to depth.
- As a user, I can create a through-hole pattern for screws by cutting through the body.
- As a user, if my sketch extends beyond the face, the tool tells me what to fix.

## Implementation steps

### Cut feature geometry (planar prismatic)

- Restrict v1 cut profiles to rectangles aligned within the face plane
- Compute cut prism by extruding sketch profile into the body
- Subtract by splitting faces and inserting new faces for the pocket walls and bottom
- Ensure internal faces are removed and final solid remains manifold

### Depth resolution

- For distance mode: use provided depth with sign based on face normal and flip
- For through mode: raycast from sketch plane along normal to find exit face intersection depth
- Clamp or reject if exit face cannot be found (open solid)

### UI workflow

- Add context command: Sketch on selected face
- Add tool button: Cut (creates ExtrudeCut from active sketch)
- Add preview: show translucent cut volume before commit

### Validation and errors

- Pre-check: cut depth <= part thickness for distance mode if it would exit (option: allow exit to create through cut; keep consistent rules)
- Pre-check: sketch loop is closed and planar
- On failure: return diagnostics referencing feature id and the invalid condition

## Acceptance criteria

- User can create a pocket cut and a through cut using sketch-on-face workflow.
- Resulting solids remain planar-faced and manifold, with sharp edges.
- The cut feature is editable in the feature tree and rebuilds correctly after upstream edits.

## Out of scope for this milestone

- Arbitrary polygon cuts and filleted pockets.
- Cutting across multiple bodies at once.
- General boolean subtraction on arbitrary solids.

## Notes and risks

- Subtractive ops are where topological naming starts to matter; track face IDs carefully for features created after cuts.
- Keep v1 profile types limited (rectangles) to avoid complex face splitting cases.
