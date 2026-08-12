import { describe, expect, it, vi } from 'vitest';
import { PreviewTransaction } from '../../src/interaction/PreviewTransaction';

interface Snapshot {
  features: Array<{ id: string; distance: number }>;
}

describe('PreviewTransaction', () => {
  it('restores a byte-equivalent baseline after previews mutate authoritative state', () => {
    let document: Snapshot = { features: [{ id: 'extrude-1', distance: 2 }] };
    const serialize = (snapshot: Snapshot) => JSON.stringify(snapshot);
    const transaction = new PreviewTransaction<Snapshot, number>({
      capture: () => structuredClone(document),
      serialize,
      applyPreview: (distance) => {
        document.features[0]!.distance = distance;
      },
      restore: (snapshot) => {
        document = structuredClone(snapshot);
      },
    });

    transaction.preview(8);
    expect(document.features[0]!.distance).toBe(8);
    expect(transaction.cancel()).toMatchObject({ byteEquivalent: true });
    expect(serialize(document)).toBe('{"features":[{"id":"extrude-1","distance":2}]}');
  });

  it('commits once and cannot be reused after ending', () => {
    const commit = vi.fn();
    const snapshot: Snapshot = { features: [] };
    const transaction = new PreviewTransaction<Snapshot>({
      capture: () => snapshot,
      serialize: JSON.stringify,
      applyPreview: () => undefined,
      restore: () => undefined,
      commit,
    });

    transaction.commit('Extrude');
    expect(commit).toHaveBeenCalledWith('Extrude');
    expect(transaction.state).toBe('committed');
    expect(() => transaction.commit('Again')).toThrow('already committed');
  });

  it('reports a restore implementation that is not byte-equivalent', () => {
    let snapshot: Snapshot = { features: [{ id: 'a', distance: 1 }] };
    const transaction = new PreviewTransaction<Snapshot, number>({
      capture: () => structuredClone(snapshot),
      serialize: JSON.stringify,
      applyPreview: (distance) => {
        snapshot.features[0]!.distance = distance;
      },
      restore: () => {
        snapshot = { features: [] };
      },
    });

    transaction.preview(3);
    expect(transaction.cancel().byteEquivalent).toBe(false);
  });
});
