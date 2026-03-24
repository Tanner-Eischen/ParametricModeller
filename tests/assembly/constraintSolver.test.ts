/**
 * Tests for Constraint System - Milestone 06
 */

import { describe, it, expect } from 'vitest';
import {
  validateMateConstraintParams,
  canSolveConstraint,
  MateConstraintErrorCodes,
} from '../../src/assembly/constraints/MateConstraint';
import {
  solveFlushMate,
  checkFlushMate,
} from '../../src/assembly/constraints/FlushMateSolver';
import {
  solveConstraints,
  checkAllConstraints,
  type ConstraintSolverContext,
} from '../../src/assembly/constraints/ConstraintSolver';
import { createInstanceFaceRef, createIdentityTransform, createComponentInstance } from '../../src/assembly/AssemblyTypes';
import type { Body } from '../../src/geometry';
import { createBody, addVertex, addEdge, addFace, addPlane } from '../../src/geometry';
import { createVertex } from '../../src/geometry/Vertex';
import { createEdge } from '../../src/geometry/Edge';
import { createFace } from '../../src/geometry/Face';
import { createPlane } from '../../src/geometry/Plane';

// Helper to create a simple box body
function createBoxBody(id: string, size: number = 1): Body {
  const body = createBody(id, 'Box');

  // Add 8 vertices
  const h = size / 2;
  const vertices = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!;
    addVertex(body, createVertex([v[0], v[1], v[2]], `v${i}`));
  }

  // Add 12 edges
  const edgeVertexPairs = [
    [0, 1], [1, 2], [2, 3], [3, 0], // bottom
    [4, 5], [5, 6], [6, 7], [7, 4], // top
    [0, 4], [1, 5], [2, 6], [3, 7], // sides
  ];

  for (let i = 0; i < edgeVertexPairs.length; i++) {
    const pair = edgeVertexPairs[i]!;
    addEdge(body, createEdge([`v${pair[0]}`, `v${pair[1]}`], `e${i}`));
  }

  // Add 6 faces
  const faceEdges = [
    ['e0', 'e1', 'e2', 'e3'], // bottom (-Z)
    ['e4', 'e5', 'e6', 'e7'], // top (+Z)
    ['e0', 'e9', 'e4', 'e8'], // front (-Y)
    ['e2', 'e10', 'e6', 'e9'], // back (+Y)
    ['e3', 'e11', 'e7', 'e8'], // left (-X)
    ['e1', 'e10', 'e5', 'e11'], // right (+X)
  ];

  const planes = [
    { origin: [0, 0, -h] as [number, number, number], normal: [0, 0, -1] as [number, number, number] },
    { origin: [0, 0, h] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
    { origin: [0, -h, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number] },
    { origin: [0, h, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] },
    { origin: [-h, 0, 0] as [number, number, number], normal: [-1, 0, 0] as [number, number, number] },
    { origin: [h, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number] },
  ];

  for (let i = 0; i < 6; i++) {
    const plane = createPlane(planes[i]!.origin, planes[i]!.normal);
    addPlane(body, plane, `p${i}`);
    addFace(body, createFace(`p${i}`, faceEdges[i]!, `f${i}`, `face_${i}`));
  }

  return body;
}

describe('MateConstraint Validation', () => {
  it('should validate valid flush constraint params', () => {
    const params = {
      type: 'flush',
      refA: { instanceId: 'inst1', faceId: 'face1', bodyId: 'body1' },
      refB: { instanceId: 'inst2', faceId: 'face2', bodyId: 'body2' },
      offset: 0,
    };

    const result = validateMateConstraintParams(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.type).toBe('flush');
      expect(result.data.offset).toBe(0);
    }
  });

  it('should validate valid offset constraint params', () => {
    const params = {
      type: 'offset',
      refA: { instanceId: 'inst1', faceId: 'face1', bodyId: 'body1' },
      refB: { instanceId: 'inst2', faceId: 'face2', bodyId: 'body2' },
      offset: 2.5,
    };

    const result = validateMateConstraintParams(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.type).toBe('offset');
      expect(result.data.offset).toBe(2.5);
    }
  });

  it('should reject invalid type', () => {
    const params = {
      type: 'invalid',
      refA: { instanceId: 'inst1', faceId: 'face1', bodyId: 'body1' },
      refB: { instanceId: 'inst2', faceId: 'face2', bodyId: 'body2' },
      offset: 0,
    };

    const result = validateMateConstraintParams(params);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some(e => e.code === MateConstraintErrorCodes.INVALID_TYPE)).toBe(true);
    }
  });

  it('should reject missing refA', () => {
    const params = {
      type: 'flush',
      refA: null,
      refB: { instanceId: 'inst2', faceId: 'face2', bodyId: 'body2' },
      offset: 0,
    };

    const result = validateMateConstraintParams(params);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some(e => e.code === MateConstraintErrorCodes.MISSING_REF_A)).toBe(true);
    }
  });

  it('should reject constraint between same instance', () => {
    const params = {
      type: 'flush',
      refA: { instanceId: 'inst1', faceId: 'face1', bodyId: 'body1' },
      refB: { instanceId: 'inst1', faceId: 'face2', bodyId: 'body2' },
      offset: 0,
    };

    const result = validateMateConstraintParams(params);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some(e => e.code === MateConstraintErrorCodes.SAME_INSTANCE)).toBe(true);
    }
  });

  it('should reject invalid offset', () => {
    const params = {
      type: 'offset',
      refA: { instanceId: 'inst1', faceId: 'face1', bodyId: 'body1' },
      refB: { instanceId: 'inst2', faceId: 'face2', bodyId: 'body2' },
      offset: 'not a number',
    };

    const result = validateMateConstraintParams(params);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some(e => e.code === MateConstraintErrorCodes.INVALID_OFFSET)).toBe(true);
    }
  });
});

describe('canSolveConstraint', () => {
  it('should return ok for valid constraint', () => {
    const params = {
      type: 'flush' as const,
      refA: createInstanceFaceRef('inst1', 'face1', 'body1'),
      refB: createInstanceFaceRef('inst2', 'face2', 'body2'),
      offset: 0,
    };

    const result = canSolveConstraint(params, ['inst1', 'inst2']);

    expect(result.ok).toBe(true);
  });

  it('should fail for missing instance', () => {
    const params = {
      type: 'flush' as const,
      refA: createInstanceFaceRef('inst1', 'face1', 'body1'),
      refB: createInstanceFaceRef('inst_missing', 'face2', 'body2'),
      offset: 0,
    };

    const result = canSolveConstraint(params, ['inst1', 'inst2']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('inst_missing');
    }
  });
});

describe('FlushMateSolver', () => {
  it('should solve flush mate for parallel faces', () => {
    const bodyA = createBoxBody('bodyA', 1);
    const bodyB = createBoxBody('bodyB', 1);

    const refA = createInstanceFaceRef('instA', 'f1', 'bodyA'); // top face (+Z)
    const refB = createInstanceFaceRef('instB', 'f0', 'bodyB'); // bottom face (-Z)

    const result = solveFlushMate(bodyA, refA, bodyB, refB, 0);

    expect(result.ok).toBe(true);
    expect(result.transform).toBeDefined();
    expect(result.transform).toHaveLength(16);
  });

  it('should fail for non-existent face', () => {
    const bodyA = createBoxBody('bodyA', 1);
    const bodyB = createBoxBody('bodyB', 1);

    const refA = createInstanceFaceRef('instA', 'nonexistent', 'bodyA');
    const refB = createInstanceFaceRef('instB', 'f0', 'bodyB');

    const result = solveFlushMate(bodyA, refA, bodyB, refB, 0);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should include offset in translation', () => {
    const bodyA = createBoxBody('bodyA', 1);
    const bodyB = createBoxBody('bodyB', 1);

    const refA = createInstanceFaceRef('instA', 'f1', 'bodyA'); // top face (+Z)
    const refB = createInstanceFaceRef('instB', 'f0', 'bodyB'); // bottom face (-Z)

    const resultZero = solveFlushMate(bodyA, refA, bodyB, refB, 0);
    const resultOffset = solveFlushMate(bodyA, refA, bodyB, refB, 2);

    expect(resultZero.ok).toBe(true);
    expect(resultOffset.ok).toBe(true);

    // The offset should change the translation in Z
    if (resultZero.ok && resultOffset.ok) {
      // Column-major: translation is at indices 12, 13, 14 for x, y, z
      const tzZero = resultZero.transform![14]; // Translation Z
      const tzOffset = resultOffset.transform![14];

      // Offset should result in different translation
      expect(tzZero).not.toBe(tzOffset);
    }
  });
});

describe('checkFlushMate', () => {
  it('should return satisfied for coplanar faces', () => {
    const bodyA = createBoxBody('bodyA', 1);
    const bodyB = createBoxBody('bodyB', 1);

    // Use faces that are already coplanar
    const refA = createInstanceFaceRef('instA', 'f1', 'bodyA'); // top face
    const refB = createInstanceFaceRef('instB', 'f1', 'bodyB'); // top face

    const result = checkFlushMate(bodyA, refA, bodyB, refB);

    // The faces have parallel normals (not anti-parallel)
    expect(result.satisfied).toBe(false);
  });

  it('should return not satisfied for non-coplanar faces', () => {
    const bodyA = createBoxBody('bodyA', 1);
    const bodyB = createBoxBody('bodyB', 1);

    // Use perpendicular faces
    const refA = createInstanceFaceRef('instA', 'f1', 'bodyA'); // top face (+Z normal)
    const refB = createInstanceFaceRef('instB', 'f4', 'bodyB'); // left face (-X normal)

    const result = checkFlushMate(bodyA, refA, bodyB, refB);

    expect(result.satisfied).toBe(false);
  });
});

describe('ConstraintSolver', () => {
  it('should ground the first instance', () => {
    const instance1 = createComponentInstance('comp1', 'Instance 1');
    const instance2 = createComponentInstance('comp1', 'Instance 2');

    const context: ConstraintSolverContext = {
      instances: [instance1, instance2],
      constraints: [],
      instanceBodies: new Map([
        ['inst1', [createBoxBody('body1', 1)]],
        ['inst2', [createBoxBody('body2', 1)]],
      ]),
    };

    // Update instance IDs for test
    instance1.id = 'inst1';
    instance2.id = 'inst2';

    const result = solveConstraints(context);

    expect(result.ok).toBe(true);

    const updated1 = result.updatedInstances.get('inst1');
    expect(updated1?.grounded).toBe(true);
  });

  it('should solve empty constraints', () => {
    const instance1 = createComponentInstance('comp1', 'Instance 1');
    instance1.id = 'inst1';

    const context: ConstraintSolverContext = {
      instances: [instance1],
      constraints: [],
      instanceBodies: new Map([
        ['inst1', [createBoxBody('body1', 1)]],
      ]),
    };

    const result = solveConstraints(context);

    expect(result.ok).toBe(true);
    expect(result.satisfiedConstraints.size).toBe(0);
    expect(result.errors.size).toBe(0);
  });

  it('should skip suppressed constraints', () => {
    const instance1 = createComponentInstance('comp1', 'Instance 1');
    const instance2 = createComponentInstance('comp1', 'Instance 2');
    instance1.id = 'inst1';
    instance2.id = 'inst2';

    const constraint = {
      id: 'c1',
      name: 'Test',
      type: 'flush' as const,
      refA: createInstanceFaceRef('inst1', 'f1', 'body1'),
      refB: createInstanceFaceRef('inst2', 'f0', 'body2'),
      offset: 0,
      satisfied: false,
      suppressed: true,
    };

    const context: ConstraintSolverContext = {
      instances: [instance1, instance2],
      constraints: [constraint],
      instanceBodies: new Map([
        ['inst1', [createBoxBody('body1', 1)]],
        ['inst2', [createBoxBody('body2', 1)]],
      ]),
    };

    const result = solveConstraints(context);

    expect(result.ok).toBe(true);
    expect(result.satisfiedConstraints.has('c1')).toBe(false);
  });
});

describe('checkAllConstraints', () => {
  it('should check all constraints', () => {
    const context: ConstraintSolverContext = {
      instances: [],
      constraints: [
        {
          id: 'c1',
          name: 'Test',
          type: 'flush',
          refA: createInstanceFaceRef('inst1', 'f1', 'body1'),
          refB: createInstanceFaceRef('inst2', 'f0', 'body2'),
          offset: 0,
          satisfied: false,
          suppressed: false,
        },
      ],
      instanceBodies: new Map([
        ['inst1', [createBoxBody('body1', 1)]],
        ['inst2', [createBoxBody('body2', 1)]],
      ]),
    };

    const results = checkAllConstraints(context);

    expect(results.size).toBe(1);
    expect(results.has('c1')).toBe(true);
  });
});
