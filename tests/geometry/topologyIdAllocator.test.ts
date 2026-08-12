import { describe, expect, it } from 'vitest';
import {
  createTopologyId,
  createTopologyIdAllocator,
} from '../../src/geometry/TopologyIdAllocator';

describe('TopologyIdAllocator', () => {
  it('returns identical IDs for identical semantic inputs', () => {
    const runs = Array.from({ length: 10 }, () =>
      createTopologyIdAllocator('extrude-1').face('side:3')
    );
    expect(new Set(runs)).toEqual(new Set([runs[0]]));
  });

  it('separates entity kinds and namespaces', () => {
    expect(createTopologyId('a', 'face', 'top')).not.toBe(createTopologyId('a', 'edge', 'top'));
    expect(createTopologyId('a', 'face', 'top')).not.toBe(createTopologyId('b', 'face', 'top'));
  });

  it('escapes delimiter-bearing keys deterministically', () => {
    const id = createTopologyId('body:1', 'vertex', '+X/Y');
    expect(id).toBe(createTopologyId('body:1', 'vertex', '+X/Y'));
    expect(id).not.toContain('%');
    expect(createTopologyId('a:b', 'face', 'top')).not.toBe(
      createTopologyId('a~3Ab', 'face', 'top')
    );
  });
});
