export interface PreviewTransactionAdapter<TSnapshot, TPreview = TSnapshot> {
  capture: () => TSnapshot;
  restore: (snapshot: TSnapshot) => void;
  applyPreview: (preview: TPreview) => boolean | void;
  serialize: (snapshot: TSnapshot) => string;
  commit?: (label: string) => void;
}

export type PreviewTransactionState = 'active' | 'committed' | 'cancelled';

export interface PreviewCancelResult {
  byteEquivalent: boolean;
  before: string;
  after: string;
}

function cloneSnapshot<T>(snapshot: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot);
  }
  return JSON.parse(JSON.stringify(snapshot)) as T;
}

/**
 * Captures an immutable baseline before previews touch authoritative state.
 * Cancellation restores that baseline and reports exact serialized equivalence.
 */
export class PreviewTransaction<TSnapshot, TPreview = TSnapshot> {
  private readonly adapter: PreviewTransactionAdapter<TSnapshot, TPreview>;
  private readonly baselineSnapshot: TSnapshot;
  private readonly baselineBytes: string;
  private transactionState: PreviewTransactionState = 'active';

  constructor(adapter: PreviewTransactionAdapter<TSnapshot, TPreview>) {
    this.adapter = adapter;
    this.baselineSnapshot = cloneSnapshot(adapter.capture());
    this.baselineBytes = adapter.serialize(this.baselineSnapshot);
  }

  get state(): PreviewTransactionState {
    return this.transactionState;
  }

  get baseline(): TSnapshot {
    return cloneSnapshot(this.baselineSnapshot);
  }

  preview(value: TPreview): boolean {
    this.assertActive();
    return this.adapter.applyPreview(value) !== false;
  }

  commit(label: string): void {
    this.assertActive();
    this.adapter.commit?.(label);
    this.transactionState = 'committed';
  }

  cancel(): PreviewCancelResult {
    this.assertActive();
    this.adapter.restore(cloneSnapshot(this.baselineSnapshot));
    const after = this.adapter.serialize(this.adapter.capture());
    this.transactionState = 'cancelled';
    return {
      byteEquivalent: after === this.baselineBytes,
      before: this.baselineBytes,
      after,
    };
  }

  private assertActive(): void {
    if (this.transactionState !== 'active') {
      throw new Error(`Preview transaction is already ${this.transactionState}`);
    }
  }
}
