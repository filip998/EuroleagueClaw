import type {
  IncomingCommand,
  OutgoingMessage,
} from '../domain/types.js';

/** Callback invoked when a command is received from a chat platform */
export type CommandHandler = (command: IncomingCommand) => Promise<void>;

/**
 * Port for chat platform communication.
 * Adapters: Telegram, Viber, WhatsApp, etc.
 */
export interface ChatPort {
  /** Start listening for incoming messages/commands */
  start(onCommand: CommandHandler): Promise<void>;

  /** Stop listening */
  stop(): Promise<void>;

  /** Send a message to a chat */
  sendMessage(message: OutgoingMessage): Promise<void>;

  /** Get the platform name (e.g., 'telegram', 'viber') */
  readonly platform: string;
}
