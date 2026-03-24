# Milestone 06: Assembly-lite

## Goal
Introduce components and a minimal assembly constraint system to build woodworking assemblies from parametric parts.

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

### Components and grouping

**Purpose:** Model assemblies without losing part-level editability.

**Primary user story:**

- As a user, I can group the legs of a table and move them as one unit.

**What to build:**

- Component definition: a set of bodies with a local coordinate frame
- Instances: place a component multiple times with transforms
- Edit-in-place: open a component, edit its features, return to assembly context

**Interfaces and data:**
- Component: {id, name, localBodies[], featureSubtreeRootId}
- ComponentInstance: {id, componentId, transform}

**Tool-level acceptance criteria:**
- Moving a component instance does not mutate its internal geometry; it only changes instance transform

### Assembly constraints-lite

**Purpose:** Basic mating needed for woodworking assemblies without a full constraint solver.

**Primary user story:**

- As a user, I can make two board faces flush with a 0.125 in offset.

**What to build:**

- Constraint types: face flush (coplanar), face offset, axis align (optional)
- Solve approach: sequential constraint application with limited degrees of freedom
- Constraint visualization: show constraint glyphs and offsets

**Interfaces and data:**
- MateConstraint: {id, type, refA, refB, offset, lockAxes}
- Solver output: updated transforms for component instances

**Tool-level acceptance criteria:**
- Applying a flush mate results in predictable placement without jitter

### Transform tools for components

**Purpose:** Manipulate parts in assembly context with snapping.

**Primary user story:**

- As a user, I can slide a shelf component along one axis while keeping faces flush.

**What to build:**

- Translate/rotate gizmo applied to component instances
- Snap: grid and optional face-to-face alignment snap
- Constraint-aware dragging: respect locked axes

**Interfaces and data:**
- TransformOp: {targetInstanceId, deltaTransform}

**Tool-level acceptance criteria:**
- User can reposition assemblies without breaking component internal references

## User stories for this milestone

- As a user, I can build a cabinet from multiple boards and move subassemblies as components.
- As a user, I can set a face-flush constraint so parts align consistently.
- As a user, I can duplicate a component instance (e.g., legs) and keep edits linked.

## Implementation steps

### Component model

- Define component vs body distinction in the document model
- Implement create-component from selected bodies
- Implement component instance creation and transforms
- Implement edit-in-place mode to modify component feature subtree

### Constraint system (lite)

- Implement face reference selection for constraints (needs stable face refs)
- Implement flush mate: compute transform that makes plane normals opposite and planes coincident with offset
- Implement constraint application order and conflict handling (v1: last-wins with warning)

### UI and workflows

- Assembly panel listing components and constraints
- Constraint creation wizard: pick face A, pick face B, set offset
- Visualize constraints in viewport

## Acceptance criteria

- User can create components and place multiple instances of the same component.
- User can apply a flush mate constraint between two faces with an optional offset and get stable results.
- Component edits propagate to all instances after rebuild.

## Out of scope for this milestone

- Full constraint solver with cycles and robust degrees-of-freedom analysis.
- Motion simulation or kinematics.

## Notes and risks

- Keep constraints intentionally limited. Woodworking often needs flush, offset, and simple alignment only.
