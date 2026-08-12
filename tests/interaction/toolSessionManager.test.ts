import { describe, expect, it, vi } from 'vitest';
import type { ToolSession } from '../../src/interaction/ToolSession';
import { ToolSessionManager } from '../../src/interaction/ToolSessionManager';

function session(id: string, commitResult: boolean | void = true): ToolSession {
  return {
    id,
    kind: id,
    phase: 'awaiting-input',
    start: vi.fn(),
    commit: vi.fn(() => commitResult),
    cancel: vi.fn(),
  };
}

describe('ToolSessionManager', () => {
  it('keeps sessions exclusive and cancels the old session when superseded', () => {
    const manager = new ToolSessionManager();
    const first = session('first');
    const second = session('second');
    const ended = vi.fn();
    manager.onSessionEnd(ended);

    manager.start(first);
    manager.start(second);

    expect(first.cancel).toHaveBeenCalledOnce();
    expect(manager.activeSession).toBe(second);
    expect(ended).toHaveBeenCalledWith({ session: first, reason: 'superseded' });
  });

  it('routes Enter to commit and Escape to cancel', () => {
    const manager = new ToolSessionManager();
    const committed = session('commit');
    manager.start(committed);

    expect(manager.routeKey('Enter')).toEqual({ handled: true, ended: true, reason: 'committed' });
    expect(committed.commit).toHaveBeenCalledOnce();
    expect(manager.activeSession).toBeNull();

    const cancelled = session('cancel');
    manager.start(cancelled);
    expect(manager.routeKey('Escape')).toEqual({ handled: true, ended: true, reason: 'cancelled' });
    expect(cancelled.cancel).toHaveBeenCalledOnce();
    expect(manager.activeSession).toBeNull();
  });

  it('keeps a session active when validation rejects commit', () => {
    const manager = new ToolSessionManager();
    const invalid = session('invalid', false);
    manager.start(invalid);

    expect(manager.commitActive()).toEqual({ handled: true, ended: false });
    expect(manager.activeSession).toBe(invalid);
  });
});
