export type ToolSessionPhase = 'awaiting-input' | 'previewing' | 'committing';

export type ToolIntent =
  | { type: 'commit' }
  | { type: 'cancel' }
  | { type: 'command'; command: string };

export interface ToolSession {
  readonly id: string;
  readonly kind: string;
  readonly phase: ToolSessionPhase;
  start?: () => void;
  commit: () => boolean | void;
  cancel: () => void;
  handleIntent?: (intent: ToolIntent) => boolean;
}

export type ToolSessionEndReason = 'committed' | 'cancelled' | 'superseded';

export interface ToolSessionEndEvent {
  session: ToolSession;
  reason: ToolSessionEndReason;
}
