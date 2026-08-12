# Parametric Solid Modeler

## Project Overview
A domain-specific 3D CAD modeler for woodworking, focused on planar B-Rep geometry with history-based parametric features. The application produces JSON-based scene files with feature trees.

## Technology Stack
- **Language:** TypeScript (strict mode)
- **3D Rendering:** Three.js
- **Build System:** Vite
- **Module System:** ESM
- **Testing:** Vitest

## Shared Constraints (ALL Milestones)
These constraints apply to every milestone and must never be violated:

1. **Planar/Prismatic Only:** Primary geometry is planar and prismatic: flat faces, sharp edges. No curved surfaces.
2. **History is Truth:** History-based, parametric rebuild is the source of truth.
3. **Direct Edits as Features:** "Direct edits" are implemented as features so they are editable and rebuildable.
4. **Fail-Closed:** v1 blocks risky operations rather than attempting heroic geometry repair.
5. **Triangles are View-Only:** Rendering uses triangulation or quad rendering as a view layer only. Do not treat triangles as the primary model.
6. **Deterministic Rebuild:** Every tool must have a deterministic rebuild outcome given the same inputs.

## Cross-Cutting Components (Built Progressively)
These components span multiple milestones. Earlier milestones implement stubs refined later:

- **Scene model:** documents, bodies, transforms, selection sets
- **Geometry core:** planar B-Rep entities and validation rules
- **Feature system:** feature definitions, parameter storage, rebuild pipeline, dependency graph
- **Reference system:** stable IDs and fallback matching, broken-reference reporting
- **View layer:** picking, gizmos, snapping, overlays (grid, dimensions), render mesh cache
- **Persistence:** JSON-based file format for scene + feature tree
- **Testing:** golden scenes and measurement-based invariants

## Project Structure
```
src/
  core/           # Document, IDs, logging
  geometry/       # Planar B-Rep entities, validation
  sketch/         # 2D sketch entities, profile extraction
  features/       # Feature definitions, rebuild pipeline
  ui/             # Panels, controls, event bus
  rendering/      # Three.js viewport, grid, overlays
  persistence/    # JSON serialization
```

## Milestone Index
See [plans/README_INDEX.md](plans/README_INDEX.md) for all milestones.

## Current Milestone
**Milestone 07:** Vertex-level Editing (Guarded) ✅ COMPLETE
See [plans/milestone_07.md](plans/milestone_07.md) for details.

---

## Milestone 07 Features Implemented

### Sub-object Types (`src/geometry/SubObjectTypes.ts`)
- **SubObjectType:** 'body' | 'face' | 'edge' | 'vertex' selection modes
- **VertexRef/EdgeRef/FaceRef/BodyRef:** Stable references across rebuilds
- **SubObjectSelection:** Selection set with mode and refs
- **getAdjacentFaceIds():** Get faces adjacent to a vertex
- **getFaceVertexIds():** Get vertices of a face
- **checkPlanarityPreservation():** Validate vertex moves preserve planar faces
- **computePlaneEquation():** Compute plane from 3 points
- Factory functions: createVertexRef, createEdgeRef, createFaceRef, createBodyRef

### Planarity Guard (`src/geometry/PlanarityGuard.ts`)
- **isPolygonPlanar():** Check if points lie on a plane within tolerance
- **distanceFromPlane():** Point-to-plane distance
- **PLANARITY_TOLERANCE:** 0.001mm default tolerance

### MoveVertex Feature (`src/features/vertex/`)
- **MOVE_VERTEX_FEATURE_TYPE:** 'moveVertex' feature type
- **MoveVertexParams:** vertexRef, translation, constrainAxis, constrainToPlane
- **validateMoveVertexParams():** Parameter validation
- **createMoveVertexFeature():** Feature factory
- **rebuildMoveVertex():** Rebuild handler with planarity checks
- Blocks moves that would break face planarity

### Sub-object Picking (`src/rendering/Picking.ts`)
- **SubObjectPickResult:** Extended pick result with entityType, vertexId, edgeId
- **pickVertex():** Screen-space vertex picking with tolerance
- **pickEdge():** Screen-space edge picking with tolerance
- Point-to-line-segment distance calculation

### UI Components (`src/ui/`)
- **SubObjectSelectionPanel.ts:** Mode switching (Body/Face/Edge/Vertex buttons)
- **PropertyInspector.ts:** MoveVertex parameter rendering (vertex ref, translation, axis constraint)
- **FeatureTreePanel.ts:** moveVertex icon (✥)
- **KeyboardShortcutsPanel.ts:** V shortcut for vertex selection, Shift+V for MoveVertex

### Keyboard Shortcuts (New)
| Shortcut | Action |
|----------|--------|
| V | Toggle vertex selection mode |
| Shift+V | Add MoveVertex from selected vertex |

### Validation Rules
| Check | Error Code |
|-------|------------|
| Missing vertex ref | MISSING_VERTEX_REF |
| Missing feature/body/vertex ID | MISSING_FEATURE_ID/BODY_ID/VERTEX_ID |
| Missing translation | MISSING_TRANSLATION |
| Invalid translation array | INVALID_TRANSLATION |
| Conflicting constraints | INVALID_CONSTRAINT |
| Invalid constraint axis | INVALID_CONSTRAINT_AXIS |
| Body not found | BODY_NOT_FOUND |
| Vertex not found | VERTEX_NOT_FOUND |
| Non-planar move | PLANARITY_VIOLATION |

### Test Coverage
- `tests/geometry/planarityGuard.test.ts`: 15 tests
- `tests/geometry/subObjectUtils.test.ts`: 12 tests
- `tests/features/moveVertexFeature.test.ts`: 17 tests
- **Total: 493 tests passing** (including all prior milestones)

---

## Milestone 06 Features Implemented

### Assembly Types (`src/assembly/AssemblyTypes.ts`)
- **Component:** Reusable group of features with featureIds and bodyIds
- **ComponentInstance:** Places a component with 4x4 transform, lockedAxes, grounded state
- **MateConstraint:** Flush/offset mates between instance faces
- **InstanceFaceRef:** Reference to a face on a component instance
- Factory functions: createComponent, createComponentInstance, createMateConstraint

### Component Feature (`src/assembly/CreateComponentFeature.ts`)
- **CREATE_COMPONENT_FEATURE_TYPE:** Organizational feature for grouping features
- **rebuildCreateComponent():** Returns empty bodies (component is organizational)
- Validates component name and feature IDs

### Component Rebuilder (`src/assembly/ComponentRebuilder.ts`)
- **createInstanceBody():** Creates transformed copy of a body with new topology IDs
- **rebuildWithComponents():** Rebuilds features and creates instance bodies
- Applies instance transforms to body geometry

### Constraint System (`src/assembly/constraints/`)
- **MateConstraint.ts:** Validation for flush/offset constraint parameters
- **FlushMateSolver.ts:** Computes transform to make faces coplanar with anti-parallel normals
- **ConstraintSolver.ts:** Sequential constraint solver (v1: first instance grounded)
- solveConstraints() updates instance transforms based on constraints

### UI Components (`src/ui/`)
- **AssemblyPanel.ts:** Lists components, instances, and constraints
- **ConstraintCreationController.ts:** Step-by-step constraint creation workflow
- **InstanceTransformGizmo.ts:** THREE.TransformControls for instance transforms
- **ConstraintVisualization.ts:** Viewport glyphs showing constraint status (green/red)

### UI Updates
- **PropertyInspector.ts:** CreateComponent parameter rendering
- **FeatureTreePanel.ts:** Icons for createComponent (📦) and addInstance (📍)
- **KeyboardShortcutsPanel.ts:** Added Shift+G and I shortcuts

### Keyboard Shortcuts (New)
| Shortcut | Action |
|----------|--------|
| Shift+G | Group selected features into component |
| I | Add instance of selected component |

### Validation Rules
| Check | Error Code |
|-------|------------|
| Missing refA/ refB | MISSING_REF_A/B |
| Invalid constraint type | INVALID_TYPE |
| Same instance | SAME_INSTANCE |
| Invalid offset | INVALID_OFFSET |

### Test Coverage
- `tests/assembly/assemblyTypes.test.ts`: 19 tests
- `tests/assembly/constraintSolver.test.ts`: 17 tests
- **Total: 450 tests passing** (including all prior milestones)

---

## Milestone 05 Features Implemented

### Transform Utilities (`src/geometry/TransformUtils.ts`)
- **translateBody():** Create translated copy with offset vector
- **mirrorBody():** Create mirrored copy across a plane (reflects vertices, reverses face edge order)
- **transformVertexPositions():** Apply 4x4 transform matrix to body
- ID mapping for vertices, edges, faces with deterministic instance IDs

### Linear Pattern Feature (`src/features/pattern/LinearPatternFeature.ts`)
- **LinearPatternParams:** sourceFeatureId, count, spacing, direction, symmetric
- **rebuildLinearPattern():** Creates N-1 translated instances (source not included)
- Instance IDs: `{sourceBodyId}_lp_{index}`
- Symmetric mode: patterns on both sides of source

### Mirror Feature (`src/features/pattern/MirrorFeature.ts`)
- **MirrorParams:** sourceFeatureId, planeRef (world or face-based)
- **rebuildMirror():** Creates mirrored instance with flipped normals
- Instance IDs: `{sourceBodyId}_mirror`
- Face boundary edges reversed to flip normals

### UI Updates (`src/ui/`)
- **PropertyInspector.ts:** LinearPattern (count, spacing, direction, symmetric) and Mirror (plane reference)
- **FeatureTreePanel.ts:** Icons for linearPattern (≡) and mirror (⇆)
- **KeyboardShortcutsPanel.ts:** Added L and M shortcuts

### Keyboard Shortcuts (New)
| Shortcut | Action |
|----------|--------|
| L | Add Linear Pattern from last body |
| M | Add Mirror from last body |

### Validation Rules
| Check | Error Code |
|-------|------------|
| Missing source feature | MISSING_SOURCE_FEATURE |
| Invalid count (<2) | INVALID_COUNT |
| Invalid spacing (<=0) | INVALID_SPACING |
| Zero direction vector | INVALID_DIRECTION |
| Source not found | SOURCE_NOT_FOUND |
| Missing plane reference | MISSING_PLANE_REF |

### Test Coverage
- `tests/geometry/transformUtils.test.ts`: 15 tests
- `tests/features/linearPatternFeature.test.ts`: 20 tests
- `tests/features/mirrorFeature.test.ts`: 15 tests
- **Total: 414 tests passing** (including all prior milestones)

---

## Milestone 04 Features Implemented

### ExtrudeCut Feature (`src/features/cut/`)
- **ExtrudeCutFeature.ts:** Subtractive extrusion from sketches
- Parameters: targetBodyRef, sketchId, profileIndex, mode, distance, flip
- Modes: 'distance' (pocket) or 'through' (through-all cut)
- Dependency resolution: refsIn points to target body feature and sketch
- BodyRef pattern for stable body references

### Cut Builder (`src/geometry/CutBuilder.ts`)
- **validateCutOperation():** Pre-check profile bounds, depth validity
- **computeThroughCutDepth():** Raycast to find exit face for through mode
- **performCut():** Execute subtractive operation on cloned body
- v1 Simplifications: rectangular profiles only, planar face cuts only

### UI Updates (`src/ui/`)
- **PropertyInspector.ts:** ExtrudeCut parameter rendering with mode selector
- **FeatureTreePanel.ts:** Icon for extrudeCut (⬇)
- **KeyboardShortcutsPanel.ts:** Added C shortcut for cut

### Keyboard Shortcuts (New)
| Shortcut | Action |
|----------|--------|
| C | Add Cut feature from last sketch |

### Validation Rules
| Check | Error Code |
|-------|------------|
| Missing target body ref | MISSING_TARGET_BODY |
| Missing sketch ID | MISSING_SKETCH_ID |
| Invalid distance | INVALID_DISTANCE |
| Target body not found | TARGET_BODY_NOT_FOUND |
| Profile out of bounds | PROFILE_OUT_OF_BOUNDS |
| No exit face for through | NO_EXIT_FACE |

### Test Coverage
- `tests/features/extrudeCutFeature.test.ts`: 26 tests
- `tests/geometry/cutBuilder.test.ts`: 15 tests
- **Total: 365 tests passing** (including all prior milestones)

---

## Milestone 02 Features Implemented

### Sketch Module (`src/sketch/`)
- **SketchTypes.ts:** Core sketch interfaces (PlaneRef, SketchEntity, RectangleEntity, Sketch, Profile2D)
- **ProfileExtractor.ts:** Closed loop detection, profile extraction from rectangles
- Factory functions for creating plane refs, rectangles, sketches, dimensions
- Serialization/deserialization for sketch data

### Construction Plane (`src/geometry/ConstructionPlane.ts`)
- World planes (XY, XZ, YZ) with optional offset
- Face-based planes (reference to face of existing body)
- Coordinate transforms: `sketchToWorld()`, `worldToSketch()`
- Plane utilities: offset, flip, equivalence checking

### Sketch Feature (`src/features/sketch/`)
- **SketchFeature.ts:** Feature storing 2D sketch entities
- Parameters: planeRef, entities (rectangles), dimensions
- Rebuild: Returns empty bodies (sketch is data-only, used by extrude)
- Entity management: add, update, dimension constraints

### Extrude Feature (`src/features/extrude/`)
- **ExtrudeFeature.ts:** Converts 2D profiles to 3D prismatic solids
- **PrismBuilder.ts:** B-Rep generation from 2D profiles
- Parameters: sketchId, profileIndex, distance, flip, mode
- Dependency resolution: refsIn points to sketch feature
- Deterministic topology IDs: bottom, top, side_0, side_1, etc.

### UI Updates (`src/ui/`)
- **SketchModeController.ts:** Mode management for sketch editing
- **PropertyInspector.ts:** Updated for sketch and extrude parameters
- **FeatureTreePanel.ts:** Icons for sketch (✎) and extrude (↑)
- New event bus events: sketch:enter, sketch:exit, sketch:entity:add, etc.

### Keyboard Shortcuts (New)
| Shortcut | Action |
|----------|--------|
| S | Add Sketch feature (with default rectangle) |
| E | Add Extrude feature from last sketch |
| Escape | Exit sketch mode / clear selection |

### Test Coverage
- `tests/sketch/sketchTypes.test.ts`: 25 tests
- `tests/sketch/profileExtractor.test.ts`: 17 tests
- `tests/geometry/constructionPlane.test.ts`: 20 tests
- `tests/features/sketchFeature.test.ts`: 14 tests
- `tests/features/extrudeFeature.test.ts`: 18 tests
- `tests/features/prismBuilder.test.ts`: 16 tests
- **Total: 217 tests passing** (including 103 from M01)

---

## Milestone 01 Features Implemented

### Geometry Core (`src/geometry/`)
- **Plane.ts:** Orthonormal basis (origin, normal, uAxis, vAxis) with projection utilities
- **Vertex.ts:** Point entity with position and edge references
- **Edge.ts:** Line segment with vertex references and face adjacency (1-2 faces for manifold)
- **Face.ts:** Planar face with boundary loops and stable naming
- **Body.ts:** Solid body containing vertices, edges, faces, and planes
- **Validation.ts:** Manifold validation, consistency checks, duplicate detection
- **Triangulator.ts:** Fan triangulation for convex planar faces, wireframe generation

### Feature System (`src/features/`)
- **FeatureRecord.ts:** Feature data schema with parameters, refsIn, refsOut, suppressed
- **RebuildContext.ts:** Context for rebuild operations tracking created bodies
- **RebuildEngine.ts:** Executes feature rebuilds in order with error handling
- **Diagnostics.ts:** Structured errors and warnings with severity levels
- **primitives/BoxFeature.ts:** Box primitive with deterministic topology IDs

### Rendering (`src/rendering/`)
- **RenderMeshCache.ts:** B-Rep to Three.js mesh conversion with caching

### UI (`src/ui/`)
- **FeatureTreePanel.ts:** Feature list with selection and type icons
- **PropertyInspector.ts:** Parameter editing for box dimensions and origin
- **DiagnosticsPanel.ts:** Failed features display with error messages

### Box Primitive Feature
- **Parameters:** width, depth, height, anchorMode ('corner'|'center'), origin
- **Topology:** 8 vertices, 12 edges, 6 faces with stable IDs (+X, -X, +Y, -Y, +Z, -Z)
- **Validation:** Dimensions must be > 0

### Keyboard Shortcuts (From M01)
| Shortcut | Action |
|----------|--------|
| B | Add Box feature |
| Ctrl+Enter | Apply parameter changes |
