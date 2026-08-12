export interface PointerSample {
  pointerId: number;
  x: number;
  y: number;
  button: number;
  buttons: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type PointerGestureKind =
  | 'press'
  | 'move'
  | 'drag-start'
  | 'drag'
  | 'drag-end'
  | 'release'
  | 'click'
  | 'cancel';

export interface PointerGesture {
  kind: PointerGestureKind;
  start: PointerSample;
  current: PointerSample;
  deltaX: number;
  deltaY: number;
  distance: number;
}

export interface PointerClaimant {
  claim: (press: PointerGesture) => boolean;
  handle: (gesture: PointerGesture) => void;
}

export interface PointerGestureRouterOptions {
  dragThreshold?: number;
  tool?: PointerClaimant | null;
  navigation?: PointerClaimant | null;
  selection?: ((gesture: PointerGesture) => void) | null;
}

export type PointerRouteResult =
  | { handled: false }
  | { handled: true; owner: 'tool' | 'navigation' | 'selection' | 'suppressed' };

interface ActivePointer {
  start: PointerSample;
  current: PointerSample;
  owner: 'tool' | 'navigation' | null;
  dragging: boolean;
}

/** Arbitrates one pointer sequence so drawing, navigation, and selection cannot overlap. */
export class PointerGestureRouter {
  private readonly dragThreshold: number;
  private tool: PointerClaimant | null;
  private navigation: PointerClaimant | null;
  private selection: ((gesture: PointerGesture) => void) | null;
  private active: ActivePointer | null = null;
  private suppressNextClick = false;

  constructor(options: PointerGestureRouterOptions = {}) {
    this.dragThreshold = options.dragThreshold ?? 4;
    this.tool = options.tool ?? null;
    this.navigation = options.navigation ?? null;
    this.selection = options.selection ?? null;
  }

  setToolClaimant(tool: PointerClaimant | null): void {
    this.tool = tool;
  }

  setNavigationClaimant(navigation: PointerClaimant | null): void {
    this.navigation = navigation;
  }

  setSelectionHandler(selection: ((gesture: PointerGesture) => void) | null): void {
    this.selection = selection;
  }

  pointerDown(sample: PointerSample): PointerRouteResult {
    if (this.active) {
      return { handled: false };
    }

    const press = this.createGesture('press', sample, sample);
    const owner = this.tool?.claim(press) ? 'tool' : null;
    this.active = { start: sample, current: sample, owner, dragging: false };
    if (owner === 'tool') {
      this.tool?.handle(press);
      return { handled: true, owner: 'tool' };
    }
    return { handled: false };
  }

  pointerMove(sample: PointerSample): PointerRouteResult {
    const active = this.getActive(sample.pointerId);
    if (!active) {
      return { handled: false };
    }

    active.current = sample;
    const distance = this.distance(active.start, sample);
    if (!active.dragging && distance >= this.dragThreshold) {
      active.dragging = true;
      if (!active.owner) {
        const press = this.createGesture('press', active.start, active.start);
        if (this.navigation?.claim(press)) {
          active.owner = 'navigation';
        }
      }
      this.owner(active)?.handle(this.createGesture('drag-start', active.start, sample));
    }

    const owner = this.owner(active);
    if (!owner) {
      return active.dragging ? { handled: true, owner: 'suppressed' } : { handled: false };
    }

    owner.handle(this.createGesture(active.dragging ? 'drag' : 'move', active.start, sample));
    return { handled: true, owner: active.owner! };
  }

  pointerUp(sample: PointerSample): PointerRouteResult {
    const active = this.getActive(sample.pointerId);
    if (!active) {
      return { handled: false };
    }

    // Pointer capture and browser navigation controls can occasionally consume
    // the intermediate move that crosses our threshold. The release still has
    // the complete start/end displacement, so use it as the final authority
    // before allowing the sequence to fall through to selection.
    const dragged = active.dragging || this.distance(active.start, sample) >= this.dragThreshold;
    const gesture = this.createGesture(dragged ? 'drag-end' : 'release', active.start, sample);
    const ownerName = active.owner;
    const owner = this.owner(active);
    this.active = null;

    if (dragged) {
      this.suppressNextClick = true;
    }
    if (owner && ownerName) {
      owner.handle(gesture);
      return { handled: true, owner: ownerName };
    }
    if (dragged) {
      return { handled: true, owner: 'suppressed' };
    }

    if (this.selection) {
      this.selection(this.createGesture('click', active.start, sample));
      return { handled: true, owner: 'selection' };
    }
    return { handled: false };
  }

  pointerCancel(sample: PointerSample): PointerRouteResult {
    const active = this.getActive(sample.pointerId);
    if (!active) {
      return { handled: false };
    }

    const ownerName = active.owner;
    const owner = this.owner(active);
    this.active = null;
    if (owner && ownerName) {
      owner.handle(this.createGesture('cancel', active.start, sample));
      return { handled: true, owner: ownerName };
    }
    return { handled: false };
  }

  /** Consume the browser click synthesized after a completed drag. */
  consumePostDragClickSuppression(): boolean {
    if (!this.suppressNextClick) {
      return false;
    }
    this.suppressNextClick = false;
    return true;
  }

  private getActive(pointerId: number): ActivePointer | null {
    return this.active?.start.pointerId === pointerId ? this.active : null;
  }

  private owner(active: ActivePointer): PointerClaimant | null {
    return active.owner === 'tool' ? this.tool : active.owner === 'navigation' ? this.navigation : null;
  }

  private createGesture(kind: PointerGestureKind, start: PointerSample, current: PointerSample): PointerGesture {
    const deltaX = current.x - start.x;
    const deltaY = current.y - start.y;
    return { kind, start, current, deltaX, deltaY, distance: Math.hypot(deltaX, deltaY) };
  }

  private distance(start: PointerSample, current: PointerSample): number {
    return Math.hypot(current.x - start.x, current.y - start.y);
  }
}
