import { describe, expect, it, vi } from 'vitest';
import { CommandDispatcher } from '../../src/interaction/CommandDispatcher';

describe('CommandDispatcher', () => {
  it('uses one can-execute gate for every dispatch path', () => {
    const dispatcher = new CommandDispatcher<{ enabled: boolean }>();
    const execute = vi.fn(() => 'created');
    dispatcher.register({
      id: 'create',
      canExecute: (context) => context.enabled,
      execute,
    });

    expect(dispatcher.dispatch('create', { enabled: false })).toEqual({ status: 'disabled' });
    expect(execute).not.toHaveBeenCalled();
    expect(dispatcher.dispatch('create', { enabled: true })).toEqual({
      status: 'executed',
      value: 'created',
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('reports unknown commands and unregisters only its own registration', () => {
    const dispatcher = new CommandDispatcher<void>();
    const unregister = dispatcher.register({ id: 'known', execute: () => undefined });

    expect(dispatcher.has('known')).toBe(true);
    unregister();
    expect(dispatcher.dispatch('known', undefined)).toEqual({ status: 'not-found' });
  });

  it('rejects duplicate command IDs', () => {
    const dispatcher = new CommandDispatcher<void>();
    dispatcher.register({ id: 'duplicate', execute: () => undefined });

    expect(() => dispatcher.register({ id: 'duplicate', execute: () => undefined }))
      .toThrow('Command already registered: duplicate');
  });
});
