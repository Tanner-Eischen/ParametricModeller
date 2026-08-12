import type { CommandId } from './CommandDispatcher';
import { CommandDispatcher, type CommandDispatchResult } from './CommandDispatcher';
import type { ToolSessionRouteResult } from './ToolSessionManager';
import { ToolSessionManager } from './ToolSessionManager';

export interface KeyboardBinding<TContext = void> {
  commandId: CommandId;
  key: string;
  primary?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  allowInEditable?: boolean;
  when?: (context: TContext) => boolean;
}

export interface KeyboardEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | null;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export type KeyboardRouteResult =
  | { handled: false }
  | { handled: true; source: 'tool'; result: ToolSessionRouteResult }
  | { handled: true; source: 'command'; result: CommandDispatchResult };

function keysEqual(left: string, right: string): boolean {
  return left.length === 1 && right.length === 1
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const candidate = target as { tagName?: string; isContentEditable?: boolean };
  const tagName = candidate.tagName?.toLocaleLowerCase();
  return candidate.isContentEditable === true || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

/** Routes universal tool intents before ordinary application shortcuts. */
export class KeyboardRouter<TContext = void> {
  private readonly bindings: KeyboardBinding<TContext>[] = [];

  constructor(
    private readonly sessions: ToolSessionManager,
    private readonly commands: CommandDispatcher<TContext>
  ) {}

  register(binding: KeyboardBinding<TContext>): () => void {
    this.bindings.push(binding);
    return () => {
      const index = this.bindings.indexOf(binding);
      if (index >= 0) {
        this.bindings.splice(index, 1);
      }
    };
  }

  route(event: KeyboardEventLike, context: TContext): KeyboardRouteResult {
    if (!event.repeat && (event.key === 'Enter' || event.key === 'Escape')) {
      const toolResult = this.sessions.routeKey(event.key);
      if (toolResult.handled) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return { handled: true, source: 'tool', result: toolResult };
      }
    }

    const binding = this.bindings.find((candidate) => this.matches(candidate, event, context));
    if (!binding) {
      return { handled: false };
    }

    event.preventDefault?.();
    const result = this.commands.dispatch(binding.commandId, context);
    if (result.status === 'not-found') {
      return { handled: false };
    }
    return { handled: true, source: 'command', result };
  }

  private matches(
    binding: KeyboardBinding<TContext>,
    event: KeyboardEventLike,
    context: TContext
  ): boolean {
    if (!keysEqual(binding.key, event.key) || binding.when?.(context) === false) {
      return false;
    }
    if (isEditableTarget(event.target) && !binding.allowInEditable) {
      return false;
    }

    const ctrl = event.ctrlKey === true;
    const meta = event.metaKey === true;
    if (binding.primary) {
      if (!ctrl && !meta) {
        return false;
      }
    } else if (ctrl !== (binding.ctrl ?? false) || meta !== (binding.meta ?? false)) {
      return false;
    }

    return (
      (event.altKey === true) === (binding.alt ?? false) &&
      (binding.shift === undefined || (event.shiftKey === true) === binding.shift)
    );
  }
}
