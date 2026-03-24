# Milestone 02: Sketch-on-plane and Extrude

## Goal
Add a lightweight sketch system on construction planes and an Extrude feature that produces prismatic solids from closed planar profiles.

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

### Construction planes

**Purpose:** Provide reference planes for sketches and features.

**Primary user story:**

- As a user, I can sketch on the top face of a board or on the global XY plane.

**What to build:**

- World planes: XY, YZ, ZX
- Face plane creation: select a planar face and create a sketch plane attached to it
- Plane display: translucent quad + normal indicator

**Interfaces and data:**
- PlaneRef: {id, type: world|face, faceId?, transform}
- Plane basis: origin, normal, uAxis, vAxis

**Tool-level acceptance criteria:**
- Selecting a face and choosing Sketch creates a plane aligned to that face
- Plane remains attached through rebuild if face reference remains valid

### Sketch system v1 (light constraints)

**Purpose:** Create 2D profiles to drive extrusions and cuts.

**Primary user story:**

- As a user, I can draw a rectangle and type exact dimensions.

**What to build:**

- 2D entities: line segments, rectangle primitive (best first)
- Snapping: endpoints, midpoints, axis lock within sketch plane
- Dimensions: width/height for rectangles, optional line length
- Closed profile detection for extrusion

**Interfaces and data:**
- Sketch: {id, planeRef, entities[], constraints[], dimensions[]}
- RectangleEntity: {id, center/origin, width, height, rotation}
- Profile2D: derived closed loops in sketch coordinates

**Tool-level acceptance criteria:**
- A rectangle sketch produces one closed profile loop
- Editing dimensions updates geometry and keeps constraints consistent

### Extrude feature (add)

**Purpose:** Turn 2D profiles into prismatic solids.

**Primary user story:**

- As a user, I can extrude a rectangle into a board with exact thickness.

**What to build:**

- Parameters: sketch reference, distance, direction (plane normal), operation mode (new body for v1)
- Generate planar B-Rep for the resulting prism
- Assign stable IDs for side faces and cap faces

**Interfaces and data:**
- ExtrudeParams: {sketchId, distance, flip, mode:newBody}
- Output: BodyRef to generated body

**Tool-level acceptance criteria:**
- Extrude of a rectangle creates a closed, manifold solid with planar faces
- Changing sketch dims or extrude distance rebuilds the solid correctly

### 2D sketch editing UI

**Purpose:** Provide a usable sketch workflow in a 3D app.

**Primary user story:**

- As a user, I can enter sketch mode, draw, dimension, and exit back to 3D.

**What to build:**

- Mode switching: 3D mode vs Sketch mode
- Sketch camera: orthographic aligned to sketch plane
- HUD: show active dimensions and allow numeric input
- Constraint hints: axis lock, orthogonal indicator

**Interfaces and data:**
- SketchModeController: enter(planeRef), exit()
- Dimension input handler with unit-aware parsing

**Tool-level acceptance criteria:**
- Sketch mode is visually distinct and prevents accidental 3D transforms
- User can fully define a rectangle via two clicks + typed dimensions

## User stories for this milestone

- As a user, I can create a sketch on the global top plane and extrude it into a board.
- As a user, I can sketch on a face of an existing box so features follow that face.
- As a user, I can edit sketch dimensions later and the extrude updates downstream.

## Implementation steps

### Construction planes

- Implement world plane refs and UI to select them
- Implement face-based plane ref creation and storage as a feature or document entity
- Render plane preview with consistent scale independent of zoom

### Sketch data model

- Define sketch entities for rectangle and line segments
- Implement sketch coordinate system conversion to/from world
- Implement closed-loop extraction (start with rectangle-only)
- Implement dimension model and unit-aware numeric input parsing

### Sketch UI and interaction

- Implement Sketch mode camera (orthographic) aligned to plane basis
- Implement draw-rectangle tool (two corner picks)
- Implement dimension entry UX: type width/height, apply, show annotation
- Implement snapping within sketch plane: endpoints, orthogonal directions

### Extrude feature implementation

- Convert 2D profile to 3D prism by sweeping along plane normal
- Generate B-Rep: bottom cap, top cap, and side faces with consistent winding
- Validate B-Rep and refuse invalid inputs (distance <= 0)
- Render triangulation and selection proxy generation

### History and persistence

- Store sketches as feature-linked entities in the document
- Store extrude features referencing sketches by stable ids
- Ensure save/load round-trips sketches and extrudes correctly

## Acceptance criteria

- User can create a rectangle sketch on a plane and extrude it into a new solid body.
- Changing sketch dimensions rebuilds the extruded body with correct dimensions.
- Sketches can be attached to a selected face plane and remain aligned after rebuild when references are valid.

## Out of scope for this milestone

- Sketch constraint solver beyond lightweight orthogonal and dimension constraints.
- Extrude add-to-existing-body boolean merge (starts later; v1 can be new-body only).
- Arbitrary polygons; rectangle-first is acceptable for woodworking v1.

## Notes and risks

- Rectangle-first sketching is a major scope reducer and covers many woodworking parts.
- Make sketch entities parametric primitives rather than arbitrary polylines early; it makes rebuild stability easier.
