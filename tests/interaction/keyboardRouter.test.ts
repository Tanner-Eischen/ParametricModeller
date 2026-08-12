import { describe, expect, it, vi } from 'vitest';
import { CommandDispatcher } from '../../src/interaction/CommandDispatcher';
import { KeyboardRouter } from '../../src/interaction/KeyboardRouter';
import type { ToolSession } from '../../src/interaction/ToolSession';
import { ToolSessionManager } from '../../src/interaction/ToolSessionManager';

function createSession(): ToolSession {
  return {
    id: 'drawing',
    kind: 'drawing',
    phase: 'previewing',
    commit: vi.fn(() => true),
    cancel: vi.fn(),
  };
}

describe('KeyboardRouter', () => {
  it('gives Enter and Escape to the active tool even from an input', () => {
    const sessions = new ToolSessionManager();
    const commands = new CommandDispatcher<void>();
    const router = new KeyboardRouter(sessions, commands);
    const active = createSession();
    const preventDefault = vi.fn();
    sessions.start(active);

    const result = router.route({
      key: 'Escape',
      target: { tagName: 'INPUT' } as unknown as EventTarget,
      preventDefault,
    }, undefined);

    expect(result.handled).toBe(true);
    expect(active.cancel).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('dispatches registered shortcuts and ignores ordinary shortcuts in editable fields', () => {
    const sessions = new ToolSessionManager();
    const commands = new CommandDispatcher<{ count: number }>();
    const execute = vi.fn();
    commands.register({ id: 'box', execute });
    const router = new KeyboardRouter(sessions, commands);
    router.register({ commandId: 'box', key: 'b' });

    expect(router.route({ key: 'B' }, { count: 1 }).handled).toBe(true);
    expect(execute).toHaveBeenCalledWith({ count: 1 });
    expect(router.route({
      key: 'b',
      target: { tagName: 'textarea' } as unknown as EventTarget,
    }, { count: 2 })).toEqual({ handled: false });
  });

  it('supports Ctrl on Windows and Meta on macOS through primary bindings', () => {
    const sessions = new ToolSessionManager();
    const commands = new CommandDispatcher<void>();
    const execute = vi.fn();
    commands.register({ id: 'save', execute });
    const router = new KeyboardRouter(sessions, commands);
    router.register({ commandId: 'save', key: 's', primary: true, allowInEditable: true });

    router.route({ key: 's', ctrlKey: true }, undefined);
    router.route({ key: 's', metaKey: true }, undefined);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
