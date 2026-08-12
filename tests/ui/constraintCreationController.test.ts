/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createComponentInstance,
  createIdentityTransform,
} from '../../src/assembly/AssemblyTypes';
import { eventBus } from '../../src/core';
import { ConstraintCreationController } from '../../src/ui/ConstraintCreationController';

describe('ConstraintCreationController numeric offsets', () => {
  afterEach(() => {
    eventBus.clear();
    vi.unstubAllGlobals();
  });

  it('resolves a relative offset against the current pending offset', () => {
    const instanceA = createComponentInstance('component', 'A', createIdentityTransform());
    const instanceB = createComponentInstance('component', 'B', createIdentityTransform());
    const onConstraintCreated = vi.fn();
    vi.stubGlobal('prompt', vi.fn(() => '+1/8'));
    const controller = new ConstraintCreationController({
      instances: () => [instanceA, instanceB],
      resolveInstanceIdForBody: (bodyId) => bodyId === 'body-a'
        ? instanceA.id
        : bodyId === 'body-b' ? instanceB.id : null,
      onConstraintCreated,
    });

    expect(controller.startOffsetConstraint()).toBe(true);
    eventBus.emit('face:selected', { faceId: 'face-a', bodyId: 'body-a' });
    eventBus.emit('face:selected', { faceId: 'face-b', bodyId: 'body-b' });
    expect(controller.getMode()).toBe('ready');
    expect(controller.commit()).toBe(true);

    expect(onConstraintCreated).toHaveBeenCalledWith(expect.objectContaining({
      type: 'offset',
      offset: 1.125,
    }));
    controller.dispose();
  });
});
