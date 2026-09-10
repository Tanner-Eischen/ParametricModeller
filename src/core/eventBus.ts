type EventHandler<T = unknown> = (event: T) => void;

// Forward declarations for event types (to avoid circular imports)
interface FeatureRecordLike {
  id: string;
  type: string;
  name: string;
  parameters: Record<string, unknown>;
  suppressed: boolean;
}

interface DiagnosticLike {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  featureId?: string;
  entityId?: string;
}

// Sketch-related types for events
interface PlaneRefLike {
  id: string;
  type: 'world' | 'face';
  worldPlane?: 'xy' | 'xz' | 'yz';
  offset?: number;
  faceId?: string;
  bodyId?: string;
  featureId?: string;
}

interface SketchEntityLike {
  id: string;
  type: string;
}

interface EventMap {
  'selection:change': { selectedIds: Set<string>; addedIds: Set<string>; removedIds: Set<string> };
  'document:dirty': { isDirty: boolean };
  'document:save': { path?: string };
  'document:load': { path?: string };
  'document:loaded': { features: FeatureRecordLike[] };
  'camera:move': { position: [number, number, number]; target: [number, number, number] };
  'camera:projection': { type: 'perspective' | 'orthographic' };
  'object:add': { id: string; type: string };
  'object:remove': { id: string };
  'object:transform': { id: string; matrix: number[] };
  'feature:add': { id: string; type: string };
  'feature:added': { feature: FeatureRecordLike };
  'feature:removed': { featureId: string };
  'feature:selected': { featureId: string };
  'feature:create-box': {
    parameters: {
      width: number;
      depth: number;
      height: number;
      anchorMode: 'corner' | 'center';
      origin: [number, number, number];
    };
  };
  'feature:update': { featureId: string; parameters: Record<string, unknown> };
  'feature:rebuild': { featureId: string; success: boolean };
  'feature:diagnostics': { diagnostics: DiagnosticLike[] };
  'rebuild:start': { totalFeatures: number };
  'rebuild:complete': { diagnostics: DiagnosticLike[] };
  'rebuild:failed': { diagnostics: DiagnosticLike[] };
  'ui:status': { message: string; announce?: boolean };
  'ui:toast': { message: string; type: 'info' | 'warning' | 'error' | 'success' };
  'ui:property-inspector': { feature: FeatureRecordLike };
  'ui:property-inspector:clear': {};
  // Sketch mode events (Milestone 02)
  'sketch:enter': { planeRef: PlaneRefLike; sketchId: string };
  'sketch:exit': { sketchId: string };
  'sketch:entity:add': { sketchId: string; entity: SketchEntityLike };
  'sketch:entity:update': { sketchId: string; entityId: string; changes: Partial<SketchEntityLike> };
  'sketch:dimension:update': { sketchId: string; dimensionId: string; value: number };
  'sketch:mode:changed': { isActive: boolean; sketchId?: string };
  // Face selection events (Milestone 02 UX)
  'face:selected': { faceId: string; bodyId: string };
  'face:mode:changed': { isActive: boolean };
  'face:deselected': { faceId: string; bodyId: string };
  // Push/Pull events (Milestone 03)
  'pushpull:enter': { faceRef: { faceId: string; bodyId: string; featureId: string } };
  'pushpull:update': { faceRef: { faceId: string; bodyId: string; featureId: string }; delta: number };
  'pushpull:commit': { faceRef: { faceId: string; bodyId: string; featureId: string }; distance: number };
  'pushpull:cancel': { faceRef?: { faceId: string; bodyId: string; featureId: string } };
  // Assembly events (Milestone 06)
  'component:created': { componentId: string; name: string };
  'component:deleted': { componentId: string };
  'instance:added': { instanceId: string; componentId: string };
  'instance:removed': { instanceId: string };
  'instance:transformed': { instanceId: string; transform: number[] };
  'constraint:added': { constraintId: string; type: string };
  'constraint:removed': { constraintId: string };
  'constraint:solved': { constraintId: string; satisfied: boolean };
  'edit:enter-component': { componentId: string };
  'edit:exit-component': {};
}

class EventBus {
  private handlers: Map<keyof EventMap, Set<EventHandler<unknown>>> = new Map();

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const handlers = this.handlers.get(event)!;
    handlers.add(handler as EventHandler<unknown>);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler<unknown>);
    };
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
  }

  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const wrappedHandler: EventHandler<EventMap[K]> = (data) => {
      this.off(event, wrappedHandler);
      handler(data);
    };
    this.on(event, wrappedHandler);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    handlers.delete(handler as EventHandler<unknown>);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();
export type { EventMap, FeatureRecordLike, DiagnosticLike };
