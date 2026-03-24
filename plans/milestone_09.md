# Milestone 09: Woodworking outputs

## Goal
Add woodworking-focused outputs: orthographic drawing export, cut list CSV export, and basic material/grain metadata.

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

### Orthographic drawing export

**Purpose:** Generate shop-friendly views that match exact dimensions.

**Primary user story:**

- As a user, I can export top/front/side views as SVG or PDF for the shop.

**What to build:**

- View generation: project edges to 2D for each ortho direction
- Hidden line handling (v1: optional; can start with visible edges only)
- Dimension annotations: key lengths for selected bodies (basic set)
- Page layout: title block, scale, units

**Interfaces and data:**
- DrawingExportParams: {views[], pageSize, scale, units, includeDims}
- 2D vector output generator (SVG first, PDF later)

**Tool-level acceptance criteria:**
- Exported drawing measures correctly when imported into a vector tool

### Cut list export

**Purpose:** Produce a list of boards and panels with dimensions for planning.

**Primary user story:**

- As a user, I can export a CSV with each board’s length, width, thickness, and quantity.

**What to build:**

- Body tagging: mark a body as a Board with thickness axis and grain direction
- Compute bounding-box dimensions in board local frame
- Aggregation: identical parts grouped with quantity
- Export CSV with units and material tags

**Interfaces and data:**
- BoardTag: {material, thicknessAxis, grainAxis, label}
- CutListRow: {label, L, W, T, qty, material}

**Tool-level acceptance criteria:**
- Cut list updates after parameter edits and rebuilds

### Material and grain metadata

**Purpose:** Support woodworking-specific planning without full rendering materials.

**Primary user story:**

- As a user, I can mark a piece as plywood and set grain direction for reference.

**What to build:**

- Per-body metadata fields for material and grain
- Viewport glyph showing grain direction arrow
- Export includes material and grain fields

**Interfaces and data:**
- BodyMetadata: {material, grainDir, notes}

**Tool-level acceptance criteria:**
- Grain direction displays consistently across transforms and assembly context

## User stories for this milestone

- As a user, I can get printable drawings for reference measurements.
- As a user, I can generate a cut list that stays in sync with the model.
- As a user, I can tag materials and grain so the plan is shop-usable.

## Implementation steps

### 2D projection pipeline

- For each ortho view, compute camera basis and project 3D vertices to 2D
- Extract visible edges: start with all sharp edges; optionally cull edges whose adjacent faces are both backfacing
- Convert projected edges to SVG paths with stroke width independent of scale

### Dimensioning v1

- Implement simple dimension primitives: linear dimension with extension lines
- Dimension sources: body bounding box dims in each view, and optionally user-selected edges
- Render dimensions in SVG with text labels in chosen units

### Cut list system

- Implement board tagging UI and metadata storage
- Compute oriented bounding box dimensions using body transform and thicknessAxis
- Group identical parts within tolerance and produce qty
- Export CSV with header including units and date

### UI integration

- Export dialog: choose views, scale, units, file type
- Cut list export action with path selection
- Preview panel optional; not required for v1 if exports are correct

## Acceptance criteria

- Orthographic export produces correct 2D geometry at the specified scale and units.
- Cut list export produces stable, correct dimensions for tagged board bodies and quantities for duplicates.
- Material and grain metadata persist through save/load and appear in exports.

## Out of scope for this milestone

- Automatic nesting optimization for sheet goods.
- Photorealistic rendering and textured materials.
- Fully automatic dimensioning for arbitrary geometry.

## Notes and risks

- For woodworking, correctness and readability of drawings matter more than full hidden-line removal in v1.
