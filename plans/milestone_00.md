# Milestone 00: Project skeleton and rendering

## Goal
Create a reliable app shell with a 3D viewport, camera controls, basic selection, and file save/load scaffolding.

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

### Application shell

**Purpose:** Boot the app, initialize core services, and provide a stable runtime loop.

**Primary user story:**

- As a user, I can open the app and immediately see a responsive 3D viewport with a grid.

**What to build:**

- Project structure (modules/packages) and build pipeline
- Main window layout: viewport, left panel (feature tree placeholder), bottom status bar
- Central event bus (or equivalent) for UI, selection, rebuild notifications

**Interfaces and data:**
- AppConfig: units, grid settings, snapping defaults
- Service registry: GeometryService, RenderService, PersistenceService (stubs allowed)

**Tool-level acceptance criteria:**
- Cold start to first frame under 2 seconds on a typical dev machine
- No crashes when resizing window or toggling panels

### Viewport renderer

**Purpose:** Render grid, axes, and simple debug primitives; later milestones render bodies.

**Primary user story:**

- As a user, I can orbit/pan/zoom smoothly and always understand orientation and scale.

**What to build:**

- Camera controls: orbit, pan, zoom, fit-to-view
- Grid rendering: major/minor lines, unit scaling (inch/mm)
- Axes triad and origin indicator
- Frame timing overlay (optional) for development

**Interfaces and data:**
- CameraState: position, target, up, fov/ortho size, projection mode
- RenderLayer: grid, overlays, bodies (future), selection highlight (future)

**Tool-level acceptance criteria:**
- Orbit does not drift, gimbal, or invert unexpectedly
- Grid spacing reflects units and zoom level in a stable way
- Fit-to-view centers the current scene bounds (even if empty bounds is a default)

### Selection and picking v0

**Purpose:** Select bodies as whole objects and show highlight.

**Primary user story:**

- As a user, I can click an object in the viewport and see it selected.

**What to build:**

- Raycast-based picking against render proxies (simple bounds initially)
- Selection model: active selection set, multi-select with modifier key
- Highlight rendering for selected objects

**Interfaces and data:**
- SelectionState: selected body IDs, active ID
- PickResult: entity type (body), id, hit point, normal

**Tool-level acceptance criteria:**
- Click selects the expected object even when objects overlap in screen space (nearest hit)
- Selection persists across camera moves

### Document model + persistence v0

**Purpose:** Save and load a scene with placeholder feature data.

**Primary user story:**

- As a user, I can save my work and reopen it later without losing anything.

**What to build:**

- Document: scene graph root, list of bodies, transforms, metadata
- JSON schema for document (versioned)
- Save As, Open, New

**Interfaces and data:**
- DocumentSchema v0: {version, units, bodies[], features[] (empty for now)}
- Serializer: serialize(document) and deserialize(json) with schema version gating

**Tool-level acceptance criteria:**
- Save then load yields identical document state (hash compare on JSON canonical form)
- Schema version is present and rejects unknown major versions cleanly

## User stories for this milestone

- As a user, I can start a new design file and see an empty scene with a grid and axes.
- As a user, I can control the camera to inspect designs from any angle.
- As a user, I can save a file and reopen it with the same settings and selection state reset safely.

## Implementation steps

### Scaffold the codebase

- Create module boundaries: core (document, ids), geometry (stubs), features (stubs), ui, rendering, persistence
- Define a global ID strategy (UUIDs or monotonic IDs per document) and implement helpers
- Add a simple logging facility with levels and timestamps

### Viewport and controls

- Implement camera state + input mapping (mouse buttons and scroll)
- Render grid in world space with configurable spacing and fade with zoom
- Add axes/origin overlay
- Implement fit-to-view using current scene AABB (use default AABB for empty scene)

### Picking and selection

- Implement ray generation from camera through mouse position
- Implement body proxy bounds (AABB) and ray-AABB intersection
- Implement selection state + UI wiring (click selects, shift adds)
- Render selection highlight (outline or tint)

### Persistence

- Define JSON schema v0 and write serializer/deserializer
- Implement Save, Save As, Open actions
- Add error handling for invalid JSON and version mismatch

## Acceptance criteria

- App opens to a stable viewport with grid, axes, and functioning orbit/pan/zoom.
- Selection works for placeholder objects (future: bodies) using bounds-based picking.
- Save and load round-trip a document without schema loss; version field is enforced.

## Out of scope for this milestone

- Creating actual solids (starts in Milestone 1).
- Sub-object selection (faces/edges/vertices).
- Feature rebuild pipeline (starts in Milestone 1 and 2).

## Notes and risks

- Make projection mode (perspective vs orthographic) a toggle, even if orthographic is the default for woodworking later.
- Keep UI flexible; avoid hard-coding panel layouts that will block feature tree integration.
