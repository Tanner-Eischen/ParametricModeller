import { describe, expect, it, vi, type Mock } from 'vitest';
import type { PointerClaimant, PointerSample } from '../../src/interaction/PointerGestureRouter';
import { PointerGestureRouter } from '../../src/interaction/PointerGestureRouter';

function pointer(x: number, y: number, pointerId = 1): PointerSample {
  return { pointerId, x, y, button: 0, buttons: 1 };
}

type MockClaimant = PointerClaimant & {
  claim: Mock<PointerClaimant['claim']>;
  handle: Mock<PointerClaimant['handle']>;
};

function claimant(claims: boolean): MockClaimant {
  return {
    claim: vi.fn<PointerClaimant['claim']>(() => claims),
    handle: vi.fn<PointerClaimant['handle']>(),
  };
}

describe('PointerGestureRouter', () => {
  it('routes a stationary pointer sequence to selection', () => {
    const selection = vi.fn();
    const navigation = claimant(true);
    const router = new PointerGestureRouter({ selection, navigation, dragThreshold: 4 });

    router.pointerDown(pointer(10, 10));
    expect(router.pointerUp(pointer(12, 11))).toEqual({ handled: true, owner: 'selection' });

    expect(selection).toHaveBeenCalledOnce();
    expect(selection.mock.calls[0]![0].kind).toBe('click');
    expect(navigation.handle).not.toHaveBeenCalled();
  });

  it('gives an active tool first claim and never falls through to navigation or selection', () => {
    const tool = claimant(true);
    const navigation = claimant(true);
    const selection = vi.fn();
    const router = new PointerGestureRouter({ tool, navigation, selection, dragThreshold: 4 });

    router.pointerDown(pointer(0, 0));
    router.pointerMove(pointer(10, 0));
    router.pointerUp(pointer(12, 0));

    expect(tool.handle.mock.calls.map(([gesture]) => gesture.kind)).toEqual([
      'press',
      'drag-start',
      'drag',
      'drag-end',
    ]);
    expect(navigation.claim).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
  });

  it('routes a drag to navigation and suppresses its synthesized click exactly once', () => {
    const navigation = claimant(true);
    const selection = vi.fn();
    const router = new PointerGestureRouter({ navigation, selection, dragThreshold: 4 });

    router.pointerDown(pointer(0, 0));
    router.pointerMove(pointer(8, 0));
    router.pointerUp(pointer(9, 0));

    expect(navigation.handle.mock.calls.map(([gesture]) => gesture.kind)).toEqual([
      'drag-start',
      'drag',
      'drag-end',
    ]);
    expect(selection).not.toHaveBeenCalled();
    expect(router.consumePostDragClickSuppression()).toBe(true);
    expect(router.consumePostDragClickSuppression()).toBe(false);
  });

  it('suppresses selection when pointer capture hides intermediate drag moves', () => {
    const selection = vi.fn();
    const router = new PointerGestureRouter({ selection, dragThreshold: 4 });

    router.pointerDown(pointer(10, 10));
    expect(router.pointerUp(pointer(40, 25))).toEqual({ handled: true, owner: 'suppressed' });

    expect(selection).not.toHaveBeenCalled();
    expect(router.consumePostDragClickSuppression()).toBe(true);
  });

  it('ignores events from a second pointer while one gesture is active', () => {
    const selection = vi.fn();
    const router = new PointerGestureRouter({ selection });
    router.pointerDown(pointer(0, 0, 1));

    expect(router.pointerMove(pointer(10, 0, 2))).toEqual({ handled: false });
    expect(router.pointerUp(pointer(10, 0, 2))).toEqual({ handled: false });
    expect(selection).not.toHaveBeenCalled();
  });
});
