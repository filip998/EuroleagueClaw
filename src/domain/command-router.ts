import type { IncomingCommand, OutgoingMessage, GameInfo, RoundGame, BoxScore } from './types.js';
import type { GameTracker } from './game-tracker.js';
import type { FantasyTracker } from './fantasy-tracker.js';
import type { TriviaService } from './trivia-service.js';
import type { RosterTracker } from './roster-tracker.js';
import type { MessageComposer } from './message-composer.js';
import type { StatsPort } from '../ports/stats.port.js';
import type { FantasyPort } from '../ports/fantasy.port.js';
import type { TvSchedulePort, TvScheduleEntry } from '../ports/tv-schedule.port.js';
import type { NewsPort } from '../ports/news.port.js';
import type { Logger } from '../shared/logger.js';
import type { ThrottleManager } from './throttle-manager.js';
import { escapeMarkdownV2 } from '../shared/markdown-v2.js';

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
  fantasyPort?: FantasyPort;
  fantasyTeamIds?: string[];
  tvSchedule?: TvSchedulePort;
  news?: NewsPort;
}

type CommandFn = (cmd: IncomingCommand) => Promise<string>;

const MARKDOWN_COMMANDS = new Set(['help', 'start', 'games', 'roster', 'rostercheck', 'rotowire', 'pir']);

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

    this.commands.set('trackall', async (cmd) => {
      const games = await this.deps.stats.getTodaySchedule(
        this.deps.seasonCode,
        this.deps.competitionCode,
      );

      if (games.length === 0) return '📭 No EuroLeague games scheduled for today.';

      const results: string[] = [];
      for (const g of games) {
        try {
          const tracked = await this.deps.gameTracker.startTracking(
            cmd.chatId,
            g.gameCode,
            this.deps.seasonCode,
          );
          this.deps.messageComposer.registerGame(g.gameCode, tracked.homeTeam, tracked.awayTeam);
          results.push(`✅ ${tracked.homeTeam} vs ${tracked.awayTeam} (${g.gameCode})`);
        } catch (err) {
          this.deps.logger.warn({ gameCode: g.gameCode, error: String(err) }, 'Failed to track game');
          results.push(`❌ ${g.homeTeam.name} vs ${g.awayTeam.name} (${g.gameCode}) — failed`);
        }
      }

      return `🏀 Tracking all today's games:\n\n${results.join('\n')}\n\nI'll post live updates here!`;
    });

    this.commands.set('stopall', async (cmd) => {
      const games = await this.deps.gameTracker.getTrackedGames(cmd.chatId);
      const activeGames = games.filter(g => g.status !== 'finished');

      if (activeGames.length === 0) return '📭 No games currently being tracked.';

      const results: string[] = [];
      for (const g of activeGames) {
        const stopped = await this.deps.gameTracker.stopTracking(
          cmd.chatId,
          g.gameCode,
          g.seasonCode,
        );
        if (stopped) {
          results.push(`🛑 ${g.homeTeam} vs ${g.awayTeam} (${g.gameCode})`);
        }
      }

      // Also clean up finished games from storage
      const finishedGames = games.filter(g => g.status === 'finished');
      for (const g of finishedGames) {
        await this.deps.gameTracker.stopTracking(cmd.chatId, g.gameCode, g.seasonCode);
      }

      return `🛑 Stopped tracking all games:\n\n${results.join('\n')}`;
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
      const activeGames = games.filter(g => g.status !== 'finished');
      const uptime = Date.now() - this.deps.startTime;
      return this.deps.messageComposer.composeStatus(activeGames.length, uptime);
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
      if (!this.deps.rosterTracker) {
        return '📋 No fantasy rosters loaded.';
      }

      // Fetch live roster data from the Dunkest API if configured
      if (this.deps.fantasyPort && this.deps.fantasyTeamIds && this.deps.fantasyTeamIds.length > 0) {
        try {
          const result = await this.deps.fantasyPort.getRosters(this.deps.fantasyTeamIds);
          if (result.rosters.length > 0) {
            this.deps.rosterTracker.loadRosters(result.rosters, result.matchdayNumber);
          }
        } catch (err) {
          this.deps.logger.warn({ error: String(err) }, 'Live roster fetch failed, using cached data');
        }
      }

      if (!this.deps.rosterTracker.isLoaded()) {
        return '📋 No fantasy rosters loaded.';
      }
      return this.deps.rosterTracker.getOverview();
    });

    this.commands.set('rostercheck', async () => {
      if (!this.deps.rosterTracker) {
        return escapeMarkdownV2('📋 Roster tracking is not configured.');
      }

      return this.deps.messageComposer.composeRosterStatus(this.deps.rosterTracker.getStats());
    });

    this.commands.set('track', async (cmd) => {
      if (!this.deps.rosterTracker) {
        return '📋 Roster tracking is not configured.';
      }

      const query = cmd.args.join(' ').trim();
      if (!query) return '⚠️ Usage: /track <player name>\n\nExample: /track nwora';

      const result = this.deps.rosterTracker.addCustomPlayer(cmd.chatId, query);

      if ('matched' in result) {
        return `✅ Now tracking ${result.matched} — ⭐ Tracked`;
      }
      if ('suggestions' in result) {
        const list = result.suggestions.map(s => `  · ${s}`).join('\n');
        return `🔍 Did you mean?\n\n${list}\n\nTry again with a more specific name.`;
      }
      return '❌ Player not found. Make sure a game with this player is being tracked first.';
    });

    this.commands.set('untrack', async (cmd) => {
      if (!this.deps.rosterTracker) {
        return '📋 Roster tracking is not configured.';
      }

      const query = cmd.args.join(' ').trim();
      if (!query) return '⚠️ Usage: /untrack <player name>';

      const removed = this.deps.rosterTracker.removeCustomPlayer(cmd.chatId, query);
      return removed
        ? `🛑 Stopped tracking ${removed}.`
        : `⚠️ No custom-tracked player matching "${query}".`;
    });

    this.commands.set('tracked', async (cmd) => {
      if (!this.deps.rosterTracker) {
        return '📋 Roster tracking is not configured.';
      }

      const players = this.deps.rosterTracker.getCustomPlayers(cmd.chatId);
      if (players.length === 0) return '📋 No custom-tracked players. Use /track <name> to add one.';

      const list = players.map(p => `  ⭐ ${p}`).join('\n');
      return `📋 Custom-tracked players:\n\n${list}`;
    });

    this.commands.set('pir', async (cmd) => {
      const games = await this.deps.gameTracker.getTrackedGames(cmd.chatId);
      const activeGames = games.filter(g => g.status !== 'finished');

      if (activeGames.length === 0) {
        return '📊 No active games being tracked. Use /game or /trackall first.';
      }

      const query = cmd.args.join(' ').trim().toLowerCase();

      const boxScoreResults: Array<{ boxScore: BoxScore; home: string; away: string; quarter?: number; clock?: string }> = [];

      for (const game of activeGames) {
        try {
          const boxScore = await this.deps.stats.getBoxScore(game.gameCode, game.seasonCode);
          if (!boxScore) continue;

          if (query) {
            // Filter to specific player
            const filtered: BoxScore = {
              gameCode: boxScore.gameCode,
              teams: boxScore.teams.map(team => ({
                ...team,
                players: team.players.filter(p =>
                  p.playerName.toLowerCase().includes(query),
                ),
              })).filter(team => team.players.length > 0),
            };
            if (filtered.teams.length > 0) {
              boxScoreResults.push({ boxScore: filtered, home: game.homeTeam, away: game.awayTeam });
            }
          } else {
            boxScoreResults.push({ boxScore, home: game.homeTeam, away: game.awayTeam });
          }
        } catch (err) {
          this.deps.logger.warn({ gameCode: game.gameCode, error: String(err) }, 'Failed to fetch box score');
        }
      }

      if (boxScoreResults.length === 0) {
        return query
          ? `📊 No player matching "${cmd.args.join(' ')}" found in active games.`
          : '📊 No box score data available for tracked games.';
      }

      return this.deps.messageComposer.composeBoxScore(boxScoreResults);
    });

    this.commands.set('rotowire', async (cmd) => {
      if (!this.deps.news) {
        return '🏗 RotoWire news is not configured.';
      }

      const isInjuries = cmd.args[0]?.toLowerCase() === 'injuries';

      try {
        const entries = isInjuries
          ? await this.deps.news.getInjuryNews()
          : await this.deps.news.getLatestNews();

        const title = isInjuries ? 'EuroLeague Injury News' : 'EuroLeague News';
        return this.deps.messageComposer.composeNews(entries, title);
      } catch {
        return '❌ Failed to fetch RotoWire news. Please try again later.';
      }
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
    const gameDate = game.startTime.slice(0, 10);

    const homeNames = this.teamNameVariants(game.homeTeam);
    const awayNames = this.teamNameVariants(game.awayTeam);

    return tvEntries.find((tv) => {
      if (tv.date && gameDate && tv.date !== gameDate) return false;

      const titleLC = tv.title.toLowerCase();
      const matchesHome = homeNames.some((n) => titleLC.includes(n));
      const matchesAway = awayNames.some((n) => titleLC.includes(n));
      return matchesHome && matchesAway;
    });
  }

  /** Generate name variants for fuzzy TV matching (lowercase). */
  private teamNameVariants(team: { code: string; name: string; shortName: string }): string[] {
    const variants = new Set<string>();
    const short = team.shortName.toLowerCase().trim();
    const full = team.name.toLowerCase().trim();

    if (short.length > 2) variants.add(short);
    if (full.length > 2) variants.add(full);

    // Add individual words longer than 3 chars (catches "Efes" from "Anadolu Efes")
    for (const word of `${short} ${full}`.split(/\s+/)) {
      if (word.length > 3) variants.add(word);
    }

    return [...variants];
  }
}
