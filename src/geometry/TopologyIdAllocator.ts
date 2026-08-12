export type TopologyEntityKind = 'body' | 'plane' | 'face' | 'edge' | 'vertex' | 'profile';

function encodePart(value: string | number): string {
  // encodeURIComponent leaves '~' untouched, so escape it before using '~' as
  // the percent marker. This keeps "a:b" distinct from the literal "a~3Ab".
  return encodeURIComponent(String(value)).replace(/~/g, '%7E').replace(/%/g, '~');
}

/** Create a stable topology ID from semantic, rebuild-stable inputs. */
export function createTopologyId(
  namespace: string,
  kind: TopologyEntityKind,
  stableKey: string | number
): string {
  if (!namespace.trim()) throw new Error('Topology namespace is required');
  if (String(stableKey).length === 0) throw new Error('Topology stable key is required');
  return `${encodePart(namespace)}:${kind}:${encodePart(stableKey)}`;
}

/**
 * Allocates topology IDs deterministically within a feature/body namespace.
 * Reusing a semantic key returns the same ID; callers must use a distinct key
 * when two entities have different identities.
 */
export class TopologyIdAllocator {
  constructor(readonly namespace: string) {
    if (!namespace.trim()) throw new Error('Topology namespace is required');
  }

  allocate(kind: TopologyEntityKind, stableKey: string | number): string {
    return createTopologyId(this.namespace, kind, stableKey);
  }

  body(key: string | number): string { return this.allocate('body', key); }
  plane(key: string | number): string { return this.allocate('plane', key); }
  face(key: string | number): string { return this.allocate('face', key); }
  edge(key: string | number): string { return this.allocate('edge', key); }
  vertex(key: string | number): string { return this.allocate('vertex', key); }
  profile(key: string | number): string { return this.allocate('profile', key); }
}

export function createTopologyIdAllocator(namespace: string): TopologyIdAllocator {
  return new TopologyIdAllocator(namespace);
}
