import type { IncomingCommand, OutgoingMessage, GameInfo, RoundGame } from './types.js';
import type { GameTracker } from './game-tracker.js';
import type { FantasyTracker } from './fantasy-tracker.js';
import type { TriviaService } from './trivia-service.js';
import type { RosterTracker } from './roster-tracker.js';
import type { MessageComposer } from './message-composer.js';
import type { StatsPort } from '../ports/stats.port.js';
import type { TvSchedulePort, TvScheduleEntry } from '../ports/tv-schedule.port.js';
import type { Logger } from '../shared/logger.js';
import type { ThrottleManager } from './throttle-manager.js';

interface CommandRouterDeps {
  gameTracker: GameTracker;
  messageComposer: MessageComposer;
  stats: StatsPort;
  throttle: ThrottleManager;
  logger: Logger;
  seasonCode: string;
  competitionCode: string;
  startTime: number;
  fantasyTracker?: FantasyTracker;
  triviaService?: TriviaService;
  rosterTracker?: RosterTracker;
  tvSchedule?: TvSchedulePort;
}

type CommandFn = (cmd: IncomingCommand) => Promise<string>;

const MARKDOWN_COMMANDS = new Set(['help', 'start', 'games', 'roster']);

export class CommandRouter {
  private readonly commands = new Map<string, CommandFn>();
  private readonly deps: CommandRouterDeps;

  constructor(deps: CommandRouterDeps) {
    this.deps = deps;
    this.registerCommands();
  }

  async handle(cmd: IncomingCommand): Promise<OutgoingMessage | null> {
    const handler = this.commands.get(cmd.command);
    if (!handler) return null;

    this.deps.logger.info({ command: cmd.command, args: cmd.args, chatId: cmd.chatId }, 'Handling command');

    try {
      const text = await handler(cmd);
      const msg: OutgoingMessage = { chatId: cmd.chatId, text };
      if (MARKDOWN_COMMANDS.has(cmd.command)) {
        msg.parseMode = 'MarkdownV2';
      }
      return msg;
    } catch (err) {
      this.deps.logger.error({ command: cmd.command, error: String(err) }, 'Command handler error');
      return { chatId: cmd.chatId, text: '❌ Something went wrong. Please try again.' };
    }
  }

  private registerCommands(): void {
    this.commands.set('help', async () => {
      return this.deps.messageComposer.composeHelp();
    });

    this.commands.set('start', async () => {
      return this.deps.messageComposer.composeHelp();
    });

    this.commands.set('today', async () => {
      const games = await this.deps.stats.getTodaySchedule(
        this.deps.seasonCode,
        this.deps.competitionCode,
      );
      return this.deps.messageComposer.composeSchedule(
        games.map((g: GameInfo) => ({
          homeTeam: g.homeTeam.name,
          awayTeam: g.awayTeam.name,
          startTime: g.startTime,
          gameCode: g.gameCode,
        })),
      );
    });

    this.commands.set('game', async (cmd) => {
      const codeStr = cmd.args[0];
      if (!codeStr) return '⚠️ Usage: /game <game_code>\n\nUse /today to see game codes.';

      const gameCode = parseInt(codeStr, 10);
      if (isNaN(gameCode)) return '⚠️ Invalid game code. Use a number.';

      const tracked = await this.deps.gameTracker.startTracking(
        cmd.chatId,
        gameCode,
        this.deps.seasonCode,
      );
      this.deps.messageComposer.registerGame(gameCode, tracked.homeTeam, tracked.awayTeam);
      return `✅ Now tracking: ${tracked.homeTeam} vs ${tracked.awayTeam} (${gameCode})\n\nI'll post live updates here!`;
    });

    this.commands.set('stop', async (cmd) => {
      const codeStr = cmd.args[0];
      if (!codeStr) return '⚠️ Usage: /stop <game_code>';

      const gameCode = parseInt(codeStr, 10);
      if (isNaN(gameCode)) return '⚠️ Invalid game code.';

      const stopped = await this.deps.gameTracker.stopTracking(
        cmd.chatId,
        gameCode,
        this.deps.seasonCode,
      );
      return stopped
        ? `🛑 Stopped tracking game ${gameCode}.`
        : `⚠️ Game ${gameCode} is not being tracked.`;
    });

    this.commands.set('games', async () => {
      const schedule = await this.deps.stats.getCurrentRoundGames(
        this.deps.seasonCode,
        this.deps.competitionCode,
      );
      await this.enrichWithTvInfo(schedule.games);
      return this.deps.messageComposer.composeRoundGames(schedule);
    });

    this.commands.set('mute', async (cmd) => {
      const minutesStr = cmd.args[0] ?? '30';
      const minutes = parseInt(minutesStr, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
        return '⚠️ Usage: /mute <minutes> (1-1440)';
      }

      this.deps.throttle.mute(cmd.chatId, minutes);
      return `🔇 Updates muted for ${minutes} minutes. Critical events (game end) will still come through.`;
    });

    this.commands.set('unmute', async (cmd) => {
      this.deps.throttle.unmute(cmd.chatId);
      return '🔊 Updates resumed!';
    });

    this.commands.set('status', async (cmd) => {
      const games = await this.deps.gameTracker.getTrackedGames(cmd.chatId);
      const uptime = Date.now() - this.deps.startTime;
      return this.deps.messageComposer.composeStatus(games.length, uptime);
    });

    this.commands.set('fantasy', async () => {
      if (!this.deps.fantasyTracker) {
        return '🏗 Fantasy tracking is not configured. Set DUNKEST_BEARER_TOKEN to enable it.';
      }
      return this.deps.fantasyTracker.getOverview();
    });

    this.commands.set('trivia', async () => {
      if (!this.deps.triviaService) {
        return '🤷 Trivia not available.';
      }
      return this.deps.triviaService.getRandomTrivia();
    });

    this.commands.set('roster', async () => {
      if (!this.deps.rosterTracker || !this.deps.rosterTracker.isLoaded()) {
        return '📋 No fantasy rosters loaded.';
      }
      return this.deps.rosterTracker.getOverview();
    });
  }

  /** Enrich upcoming games with TV channel info from the TV schedule adapter. */
  private async enrichWithTvInfo(games: RoundGame[]): Promise<void> {
    if (!this.deps.tvSchedule) return;

    try {
      const tvEntries = await this.deps.tvSchedule.getEuroLeagueSchedule();
      if (tvEntries.length === 0) return;

      for (const game of games) {
        if (game.status === 'finished') continue;
        const matched = this.matchTvEntry(game, tvEntries);
        if (matched) {
          game.tvChannel = matched.channelShort;
        }
      }
    } catch (err) {
      this.deps.logger.warn({ error: String(err) }, 'TV schedule enrichment failed');
    }
  }

  private matchTvEntry(game: RoundGame, tvEntries: TvScheduleEntry[]): TvScheduleEntry | undefined {
    const homeLC = game.homeTeam.shortName.toLowerCase();
    const awayLC = game.awayTeam.shortName.toLowerCase();
    const homeName = game.homeTeam.name.toLowerCase();
    const awayName = game.awayTeam.name.toLowerCase();
    const homeCode = game.homeTeam.code.toLowerCase();
    const awayCode = game.awayTeam.code.toLowerCase();

    const gameDate = game.startTime.slice(0, 10); // "YYYY-MM-DD"

    return tvEntries.find((tv) => {
      // Date must match if both are available
      if (tv.date && gameDate && tv.date !== gameDate) return false;

      const titleLC = tv.title.toLowerCase();
      const matchesHome = titleLC.includes(homeLC) || titleLC.includes(homeName) || titleLC.includes(homeCode);
      const matchesAway = titleLC.includes(awayLC) || titleLC.includes(awayName) || titleLC.includes(awayCode);
      return matchesHome || matchesAway;
    });
  }
}
