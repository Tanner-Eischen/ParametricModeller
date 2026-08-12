export type CommandId = string;

export interface CommandDefinition<TContext = void> {
  id: CommandId;
  execute: (context: TContext) => unknown;
  canExecute?: (context: TContext) => boolean;
}

export type CommandDispatchResult =
  | { status: 'executed'; value: unknown }
  | { status: 'disabled' }
  | { status: 'not-found' };

/**
 * Single execution path for commands invoked by toolbars, menus, and shortcuts.
 */
export class CommandDispatcher<TContext = void> {
  private readonly commands = new Map<CommandId, CommandDefinition<TContext>>();

  register(command: CommandDefinition<TContext>): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`);
    }

    this.commands.set(command.id, command);
    return () => {
      if (this.commands.get(command.id) === command) {
        this.commands.delete(command.id);
      }
    };
  }

  has(id: CommandId): boolean {
    return this.commands.has(id);
  }

  canExecute(id: CommandId, context: TContext): boolean {
    const command = this.commands.get(id);
    return command ? (command.canExecute?.(context) ?? true) : false;
  }

  dispatch(id: CommandId, context: TContext): CommandDispatchResult {
    const command = this.commands.get(id);
    if (!command) {
      return { status: 'not-found' };
    }
    if (!(command.canExecute?.(context) ?? true)) {
      return { status: 'disabled' };
    }

    return { status: 'executed', value: command.execute(context) };
  }
}
