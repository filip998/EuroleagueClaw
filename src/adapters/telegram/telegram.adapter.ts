import { Bot } from 'grammy';
import type { ChatPort, CommandHandler } from '../../ports/chat.port.js';
import type { IncomingCommand, OutgoingMessage } from '../../domain/types.js';
import type { Logger } from '../../shared/logger.js';

export class TelegramAdapter implements ChatPort {
  readonly platform = 'telegram';
  private bot: Bot;
  private allowedChatIds: Set<string>;

  constructor(
    token: string,
    allowedChatIds: string[],
    private readonly logger: Logger,
  ) {
    this.bot = new Bot(token);
    this.allowedChatIds = new Set(allowedChatIds);
  }

  async start(onCommand: CommandHandler): Promise<void> {
    // Register command handler for all text messages starting with /
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      if (!text.startsWith('/')) return;

      const chatId = String(ctx.chat.id);

      // Access control: only respond in allowed chats (if configured)
      if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) {
        this.logger.warn({ chatId }, 'Ignoring message from unauthorized chat');
        return;
      }

      const parts = text.split(/\s+/);
      const rawCommand = parts[0]!.slice(1); // remove leading /
      // Handle Telegram's @botname suffix on commands
      const command = rawCommand.split('@')[0]!.toLowerCase();
      const args = parts.slice(1);

      const senderName =
        ctx.from?.first_name ??
        ctx.from?.username ??
        'Unknown';

      const incomingCommand: IncomingCommand = {
        chatId,
        command,
        args,
        senderName,
      };

      try {
        await onCommand(incomingCommand);
      } catch (err) {
        this.logger.error({ error: String(err), command }, 'Error handling command');
      }
    });

    // Error handler
    this.bot.catch((err) => {
      this.logger.error({ error: String(err.error) }, 'Grammy bot error');
    });

    this.logger.info('Starting Telegram bot (long-polling)...');
    this.bot.start();
  }

  async stop(): Promise<void> {
    this.bot.stop();
    this.logger.info('Telegram bot stopped');
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    try {
      await this.bot.api.sendMessage(message.chatId, message.text, {
        parse_mode: message.parseMode,
      });
    } catch (err) {
      this.logger.error(
        { chatId: message.chatId, error: String(err) },
        'Failed to send Telegram message',
      );
      throw err;
    }
  }
}
