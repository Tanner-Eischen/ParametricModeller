# Milestone 01: Parametric primitives

## Goal
Introduce the feature tree and planar B-Rep core; deliver a parametric Box feature with editable dimensions and persistent history.

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

### Feature system v1

**Purpose:** Represent the model as a feature tree and rebuild it deterministically.

**Primary user story:**

- As a user, I can edit a parameter and see the model update predictably.

**What to build:**

- Feature base type: id, type, parameters, input references, output references
- Rebuild engine: topological sort features, rebuild in order, produce bodies
- Dependency tracking: feature depends on prior features and referenced entities
- Failure model: feature can fail with structured error and leave prior geometry intact

**Interfaces and data:**
- FeatureRecord: {id, type, params, refsIn, refsOut}
- RebuildContext: provides access to referenced bodies/faces/planes and services
- RebuildResult: bodies[], diagnostics[]

**Tool-level acceptance criteria:**
- Rebuild is deterministic: same feature list and params yields same outputs hash
- Feature errors are surfaced to UI with feature id and message

### Planar B-Rep core v1

**Purpose:** Represent solids as planar faces and straight edges; no triangle mesh as source of truth.

**Primary user story:**

- As a user, I can create a box with exact dimensions and it stays watertight.

**What to build:**

- Core entities: Body, Face(Plane), Edge(Segment), Vertex(Point)
- Manifold validation: each edge has 1 or 2 adjacent faces, consistent winding
- Measurements: bounding box, volume (optional early), face areas

**Interfaces and data:**
- Body: {id, faces[], edges[], vertices[], transform}
- Plane: origin, normal, uAxis, vAxis (orthonormal basis)
- ValidationReport: errors[], warnings[]

**Tool-level acceptance criteria:**
- Generated bodies validate as closed, manifold solids
- Normals are consistent: outward face normals for a convex box

### Box primitive feature

**Purpose:** Create the base woodworking building block with exact parameters.

**Primary user story:**

- As a user, I can enter board thickness, width, and length and get a box that matches.

**What to build:**

- Parameters: width, depth, height, origin, orientation (aligned to world axes initially)
- Optional: centered vs corner-anchored creation mode
- Display: triangulate faces for rendering and cache per body

**Interfaces and data:**
- BoxParams: {w, d, h, anchorMode, transform}
- Generated topology IDs for faces/edges/vertices (for later references)

**Tool-level acceptance criteria:**
- Editing any dimension updates the box exactly without drift
- Box creation is stable under unit changes (inch/mm conversion rules defined)

### Feature tree UI v1

**Purpose:** Allow selecting and editing features and their parameters.

**Primary user story:**

- As a user, I can see my model history and change parameters without hunting.

**What to build:**

- Feature list panel with selection
- Property inspector for selected feature params
- Rebuild trigger on apply or on change (choose one; default apply for stability)

**Interfaces and data:**
- UI binds to FeatureRecord schema and emits parameter edits
- Diagnostic display linked to feature id

**Tool-level acceptance criteria:**
- Selecting a feature highlights its output body in viewport
- Invalid parameter values are blocked with clear inline error

## User stories for this milestone

- As a user, I can create a box and edit its dimensions using numeric input.
- As a user, I can see a feature tree and understand what created the current geometry.
- As a user, if a feature fails, I can see which feature failed and why.

## Implementation steps

### Build the feature framework

- Define FeatureRecord schema and versioning rules
- Implement rebuild order evaluation (linear order is fine for v1; add dependency graph later)
- Add structured diagnostics: errors with severity, feature id, and human-readable message
- Implement rebuild caching hooks (no caching needed yet, but define API)

### Implement planar B-Rep data structures

- Define vertex, edge, face data types with stable IDs
- Implement adjacency tables: edge->faces, face->edges, vertex->edges
- Implement validation checks for closed manifold solids
- Implement triangulation for planar faces for rendering (fan triangulation is sufficient for convex faces)

### Implement Box feature

- Generate 8 vertices, 12 edges, 6 faces with consistent winding
- Assign stable topology IDs for each face (e.g., +X, -X, +Y, -Y, +Z, -Z in box-local frame)
- Run validation and refuse to create if any dimension <= 0
- Generate render mesh and cache on body

### UI integration

- Add Add-Box action and insert feature into tree
- Implement parameter editing UI for BoxParams with unit-aware input
- Wire rebuild on apply and update viewport
- Add diagnostics panel that lists failed features

## Acceptance criteria

- User can create one or more box primitives and edit their dimensions with predictable rebuild results.
- The feature tree and parameter inspector are functional and persist via save/load.
- Bodies are represented as planar B-Rep entities and render correctly via triangulation.

## Out of scope for this milestone

- Sketching and extrude operations (Milestone 2).
- Sub-object selection (faces/edges/vertices) beyond selecting a whole body.
- Booleans and face merging between bodies.

## Notes and risks

- Invest early in stable topology IDs for primitives; it pays off later for referencing faces in push/pull and sketch-on-face workflows.
- Define unit conversion semantics: store in base units internally (recommended) and display in chosen units.
