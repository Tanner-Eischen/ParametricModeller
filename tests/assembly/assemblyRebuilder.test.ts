import { describe, expect, it } from 'vitest';
import { rebuildAssembly } from '../../src/assembly/AssemblyRebuilder';
import {
  createComponent,
  createComponentInstance,
  createInstanceFaceRef,
  createMateConstraint,
  createTranslationTransform,
} from '../../src/assembly/AssemblyTypes';
import { createInstanceBodyWithLineage } from '../../src/assembly/ComponentRebuilder';
import { checkAllConstraints } from '../../src/assembly/constraints/ConstraintSolver';
import {
  createBoxFeature,
  createRebuildEngine,
  rebuildBox,
} from '../../src/features';

function fixture(height = 1) {
  const first = createBoxFeature({ width: 2, depth: 2, height, origin: [0, 0, 0] });
  const second = createBoxFeature({ width: 2, depth: 2, height: 1, origin: [0, 0, 0] });
  first.id = 'first';
  second.id = 'second';
  const engine = createRebuildEngine();
  engine.registerHandler('box', rebuildBox);
  const base = engine.rebuild([first, second]);
  if (!base.ok) throw new Error(base.error);
  const components = [createComponent('First', [first.id]), createComponent('Second', [second.id])];
  components[0]!.id = 'component-a';
  components[1]!.id = 'component-b';
  const instances = components.map((component, index) => {
    const instance = createComponentInstance(component.id, component.name, createTranslationTransform(0, 0, index));
    instance.id = `instance-${index}`;
    instance.grounded = index === 0;
    return instance;
  });
  const references = instances.map((instance, index) => {
    const source = base.bodiesByFeature.get(index === 0 ? first.id : second.id)![0]!;
    const clone = createInstanceBodyWithLineage(source, instance.id, instance.transform);
    const face = [...source.faces.values()].find((candidate) => candidate.name === (index === 0 ? '+Z' : '-Z'))!;
    return createInstanceFaceRef(instance.id, clone.lineage.faceIds.get(face.id)!, clone.body.id);
  });
  const constraint = createMateConstraint('flush', references[0]!, references[1]!);
  constraint.id = 'mate';
  // Persisted flags are intentionally stale; reconstruction must establish truth.
  constraint.satisfied = true;
  constraint.status = 'satisfied';
  return { base, components, instances, constraints: [constraint] };
}

describe('transactional assembly rebuild', () => {
  it('resolves a mate after editing the grounded component source dimension', () => {
    const input = fixture(3);
    const before = structuredClone(input);
    const result = rebuildAssembly(input.base, input.components, input.instances, input.constraints);
    expect(result.ok).toBe(true);
    expect(result.instances[1]!.transform[14]).toBeCloseTo(3);
    expect(result.constraints[0]!.status).toBe('satisfied');
    expect(checkAllConstraints({
      instances: result.instances,
      constraints: result.constraints,
      instanceBodies: result.instanceBodies,
    }).get('mate')?.satisfied).toBe(true);
    expect(input).toEqual(before);
  });

  it('fails closed on a missing face even when persisted status says satisfied', () => {
    const input = fixture();
    input.constraints[0]!.refB.faceId = 'deleted-face';
    const before = structuredClone(input);
    const result = rebuildAssembly(input.base, input.components, input.instances, input.constraints);
    expect(result.ok).toBe(false);
    expect(result.bodies).toEqual([]);
    expect(result.instanceBodies.size).toBe(0);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ASSEMBLY_CONSTRAINT_BROKEN', entityId: 'mate' }),
    ]));
    expect(result.instances).toEqual(before.instances);
    expect(result.constraints).toEqual(before.constraints);
    expect(input).toEqual(before);
  });

  it('marks active mates broken when their component cannot be reconstructed', () => {
    const input = fixture();
    const result = rebuildAssembly(input.base, [], input.instances, input.constraints);
    expect(result.ok).toBe(false);
    expect(result.bodies).toEqual([]);
    expect(result.constraintStatuses.get('mate')?.state).toBe('broken');
    expect(result.constraints[0]!.satisfied).toBe(true);
    expect(input.constraints[0]!.satisfied).toBe(true);
  });

  it('reconstructs stale serialized transforms and constraint flags on load', () => {
    const input = fixture();
    const persisted = JSON.parse(JSON.stringify({
      components: input.components,
      instances: input.instances,
      constraints: input.constraints,
    }));
    persisted.instances[1].transform[14] = 7;
    persisted.constraints[0].satisfied = false;
    persisted.constraints[0].status = 'broken';
    persisted.constraints[0].errorMessage = 'Stale message';
    const result = rebuildAssembly(input.base, persisted.components, persisted.instances, persisted.constraints);
    expect(result.ok).toBe(true);
    expect(result.instances[1]!.transform[14]).toBeCloseTo(1);
    expect(result.constraints[0]!.satisfied).toBe(true);
    expect(result.constraints[0]!.errorMessage).toBeUndefined();
    expect(persisted.instances[1].transform[14]).toBe(7);
  });

  it('produces identical solved state and geometry across repeated rebuilds', () => {
    const input = fixture(3);
    const first = rebuildAssembly(input.base, input.components, input.instances, input.constraints);
    expect(first.ok).toBe(true);
    for (let run = 0; run < 3; run++) {
      const next = rebuildAssembly(input.base, input.components, first.instances, first.constraints);
      expect(next.ok).toBe(true);
      expect(next.instances).toEqual(first.instances);
      expect(next.constraints).toEqual(first.constraints);
      expect(next.bodies).toEqual(first.bodies);
      expect(next.topologyLineageByInstanceBodyId).toEqual(first.topologyLineageByInstanceBodyId);
    }
  });

  it('preserves explicit axis locks and the last valid input when a resize conflicts', () => {
    const input = fixture(3);
    input.instances[1]!.lockedAxes.translateZ = true;
    const before = structuredClone(input);
    const result = rebuildAssembly(input.base, input.components, input.instances, input.constraints);
    expect(result.ok).toBe(false);
    expect(result.bodies).toEqual([]);
    expect(result.instances).toEqual(before.instances);
    expect(result.constraintStatuses.get('mate')?.state).toBe('conflicting');
    expect(input).toEqual(before);
  });

  it('rejects unsatisfied validate-only mates instead of moving them', () => {
    const input = fixture(3);
    input.constraints[0]!.driving = false;
    const result = rebuildAssembly(input.base, input.components, input.instances, input.constraints);
    expect(result.ok).toBe(false);
    expect(result.instances).toEqual(input.instances);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ASSEMBLY_CONSTRAINT_UNSATISFIED' }),
    ]));
  });

  it('ignores suppressed broken mates while retaining their authored data', () => {
    const input = fixture();
    input.constraints[0]!.suppressed = true;
    input.constraints[0]!.refB.faceId = 'deleted-face';
    const result = rebuildAssembly(input.base, input.components, input.instances, input.constraints);
    expect(result.ok).toBe(true);
    expect(result.constraints).toEqual(input.constraints);
    expect(result.constraintStatuses.size).toBe(0);
  });
});
