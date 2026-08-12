import { describe, expect, it, vi } from 'vitest';
import { PreviewTransaction } from '../../src/interaction/PreviewTransaction';
import type { ToolSession } from '../../src/interaction/ToolSession';
import { ToolSessionManager } from '../../src/interaction/ToolSessionManager';

type ToolKind = 'push-pull' | 'move-vertex' | 'rotate-body' | 'constraint';

describe.each<ToolKind>([
  'push-pull',
  'move-vertex',
  'rotate-body',
  'constraint',
])('%s ToolSession contract', (kind) => {
  it('commits exactly once through Enter', () => {
    const manager = new ToolSessionManager();
    const commit = vi.fn(() => true);
    const session: ToolSession = {
      id: `${kind}-1`,
      kind,
      phase: 'previewing',
      commit,
      cancel: vi.fn(),
    };
    manager.start(session);

    expect(manager.routeKey('Enter').handled).toBe(true);
    expect(manager.routeKey('Enter').handled).toBe(false);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('restores a byte-identical baseline through Escape', () => {
    let document = { feature: kind, value: 0 };
    const transaction = new PreviewTransaction<typeof document, number>({
      capture: () => structuredClone(document),
      serialize: JSON.stringify,
      applyPreview: (value) => {
        document.value = value;
      },
      restore: (snapshot) => {
        document = structuredClone(snapshot);
      },
    });
    const baseline = JSON.stringify(document);
    transaction.preview(12);

    const manager = new ToolSessionManager();
    manager.start({
      id: `${kind}-1`,
      kind,
      phase: 'previewing',
      commit: () => true,
      cancel: () => {
        expect(transaction.cancel().byteEquivalent).toBe(true);
      },
    });
    manager.routeKey('Escape');

    expect(JSON.stringify(document)).toBe(baseline);
  });
});
