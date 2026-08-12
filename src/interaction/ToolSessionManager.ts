import type { ToolIntent, ToolSession, ToolSessionEndEvent, ToolSessionEndReason } from './ToolSession';

export type ToolSessionRouteResult =
  | { handled: false }
  | { handled: true; ended: false }
  | { handled: true; ended: true; reason: ToolSessionEndReason };

/** Owns the one active interactive tool and its universal commit/cancel contract. */
export class ToolSessionManager {
  private active: ToolSession | null = null;
  private readonly endListeners = new Set<(event: ToolSessionEndEvent) => void>();

  get activeSession(): ToolSession | null {
    return this.active;
  }

  start(session: ToolSession): void {
    if (this.active === session) {
      return;
    }
    if (this.active) {
      this.endActive('superseded');
    }

    this.active = session;
    try {
      session.start?.();
    } catch (error) {
      this.active = null;
      throw error;
    }
  }

  commitActive(): ToolSessionRouteResult {
    const session = this.active;
    if (!session) {
      return { handled: false };
    }

    const committed = session.commit();
    if (committed === false) {
      return { handled: true, ended: false };
    }

    this.finish(session, 'committed');
    return { handled: true, ended: true, reason: 'committed' };
  }

  cancelActive(reason: 'cancelled' | 'superseded' = 'cancelled'): ToolSessionRouteResult {
    if (!this.active) {
      return { handled: false };
    }

    this.endActive(reason);
    return { handled: true, ended: true, reason };
  }

  routeIntent(intent: ToolIntent): ToolSessionRouteResult {
    if (!this.active) {
      return { handled: false };
    }
    if (intent.type === 'commit') {
      return this.commitActive();
    }
    if (intent.type === 'cancel') {
      return this.cancelActive();
    }

    return this.active.handleIntent?.(intent)
      ? { handled: true, ended: false }
      : { handled: false };
  }

  routeKey(key: string): ToolSessionRouteResult {
    if (key === 'Enter') {
      return this.routeIntent({ type: 'commit' });
    }
    if (key === 'Escape') {
      return this.routeIntent({ type: 'cancel' });
    }
    return { handled: false };
  }

  onSessionEnd(listener: (event: ToolSessionEndEvent) => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  private endActive(reason: 'cancelled' | 'superseded'): void {
    const session = this.active;
    if (!session) {
      return;
    }

    try {
      session.cancel();
    } finally {
      this.finish(session, reason);
    }
  }

  private finish(session: ToolSession, reason: ToolSessionEndReason): void {
    if (this.active === session) {
      this.active = null;
    }
    for (const listener of this.endListeners) {
      listener({ session, reason });
    }
  }
}
