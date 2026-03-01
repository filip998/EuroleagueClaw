import type { GameEvent, GameInfo, TrackedGame, LiveScore, PlayByPlayEvent } from './types.js';
import type { StatsPort } from '../ports/stats.port.js';
import type { StoragePort } from '../ports/storage.port.js';
import type { Logger } from '../shared/logger.js';

interface RunState {
  teamCode: string;
  points: number;
  opponentPoints: number;
}

export class GameTracker {
  private pollingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private runTracker = new Map<string, RunState>();

  get trackedGameCount(): number {
    return this.pollingTimers.size;
  }

  constructor(
    private readonly stats: StatsPort,
    private readonly storage: StoragePort,
    private readonly logger: Logger,
    private readonly pollIntervalMs: number,
    private readonly onEvent: (chatId: string, event: GameEvent) => Promise<void>,
    private readonly onPlayByPlay?: (chatId: string, events: PlayByPlayEvent[]) => Promise<void>,
  ) {}

  async startTracking(chatId: string, gameCode: number, seasonCode: string): Promise<TrackedGame> {
    const id = `${seasonCode}-${gameCode}`;
    const existing = await this.storage.getTrackedGame(id);
    if (existing && existing.trackedByChatId === chatId) {
      return existing;
    }

    let gameInfo: GameInfo | undefined;
    try {
      const schedule = await this.stats.getTodaySchedule(seasonCode, '');
      gameInfo = schedule.find((g) => g.gameCode === gameCode);
    } catch {
      this.logger.warn({ gameCode }, 'Could not fetch schedule for game info');
    }

    const tracked: Omit<TrackedGame, 'createdAt' | 'updatedAt'> = {
      id,
      gameCode,
      seasonCode,
      homeTeam: gameInfo?.homeTeam.name ?? 'Home',
      awayTeam: gameInfo?.awayTeam.name ?? 'Away',
      status: 'scheduled',
      lastScoreHome: 0,
      lastScoreAway: 0,
      lastQuarter: 0,
      lastEventId: null,
      trackedByChatId: chatId,
    };

    await this.storage.addTrackedGame(tracked);
    this.startPolling(id);

    const result = await this.storage.getTrackedGame(id);
    return result!;
  }

  async stopTracking(chatId: string, gameCode: number, seasonCode: string): Promise<boolean> {
    const id = `${seasonCode}-${gameCode}`;
    const game = await this.storage.getTrackedGame(id);
    if (!game || game.trackedByChatId !== chatId) return false;

    this.stopPolling(id);
    await this.storage.removeTrackedGame(id);
    return true;
  }

  async getTrackedGames(chatId: string): Promise<TrackedGame[]> {
    return this.storage.getTrackedGamesByChat(chatId);
  }

  /** Resume polling for all active tracked games (called on startup) */
  async resumeAll(): Promise<void> {
    const games = await this.storage.getAllTrackedGames();
    for (const game of games) {
      if (game.status !== 'finished') {
        this.startPolling(game.id);
      }
    }
    this.logger.info({ count: games.length }, 'Resumed tracking for active games');
  }

  stopAll(): void {
    for (const [id] of this.pollingTimers) {
      this.stopPolling(id);
    }
  }

  private startPolling(gameId: string): void {
    if (this.pollingTimers.has(gameId)) return;

    const timer = setInterval(() => {
      this.pollGame(gameId).catch((err) => {
        this.logger.error({ gameId, error: String(err) }, 'Error polling game');
      });
    }, this.pollIntervalMs);

    this.pollingTimers.set(gameId, timer);
    this.logger.info({ gameId, intervalMs: this.pollIntervalMs }, 'Started polling game');

    // Do an immediate first poll
    this.pollGame(gameId).catch((err) => {
      this.logger.error({ gameId, error: String(err) }, 'Error on initial poll');
    });
  }

  private stopPolling(gameId: string): void {
    const timer = this.pollingTimers.get(gameId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(gameId);
      this.logger.info({ gameId }, 'Stopped polling game');
    }
  }

  private async pollGame(gameId: string): Promise<void> {
    const game = await this.storage.getTrackedGame(gameId);
    if (!game) {
      this.stopPolling(gameId);
      return;
    }

    try {
      const liveScore = await this.stats.getLiveScore(game.gameCode, game.seasonCode);
      const events = this.detectEvents(game, liveScore);

      await this.storage.updateTrackedGame(gameId, {
        status: liveScore.status,
        lastScoreHome: liveScore.homeScore,
        lastScoreAway: liveScore.awayScore,
        lastQuarter: liveScore.quarter,
      });

      for (const event of events) {
        await this.onEvent(game.trackedByChatId, event);
      }

      // Poll play-by-play for live games
      if (liveScore.status === 'live' && this.onPlayByPlay) {
        try {
          const pbpEvents = await this.stats.getPlayByPlay(
            game.gameCode,
            game.seasonCode,
            game.lastEventId,
          );

          if (pbpEvents.length > 0) {
            const lastEvent = pbpEvents[pbpEvents.length - 1];
            await this.storage.updateTrackedGame(gameId, {
              lastEventId: lastEvent.eventId,
            });
            await this.onPlayByPlay(game.trackedByChatId, pbpEvents);
          }
        } catch (err) {
          this.logger.warn({ gameId, error: String(err) }, 'PBP poll failed');
        }
      }

      if (liveScore.status === 'finished') {
        this.stopPolling(gameId);
      }
    } catch (err) {
      this.logger.warn({ gameId, error: String(err) }, 'Poll failed, will retry next interval');
    }
  }

  /** Detect significant events by comparing previous state to new live score */
  detectEvents(game: TrackedGame, liveScore: LiveScore): GameEvent[] {
    const events: GameEvent[] = [];

    // Game just started
    if (game.status === 'scheduled' && liveScore.status === 'live') {
      events.push({
        type: 'game_start',
        gameCode: game.gameCode,
        homeTeam: { code: '', name: game.homeTeam, shortName: game.homeTeam },
        awayTeam: { code: '', name: game.awayTeam, shortName: game.awayTeam },
      });
    }

    // Quarter transition
    if (liveScore.quarter > game.lastQuarter && game.lastQuarter > 0) {
      events.push({
        type: 'quarter_end',
        gameCode: game.gameCode,
        quarter: game.lastQuarter,
        homeScore: liveScore.homeScore,
        awayScore: liveScore.awayScore,
      });
    }

    if (liveScore.quarter > game.lastQuarter) {
      events.push({
        type: 'quarter_start',
        gameCode: game.gameCode,
        quarter: liveScore.quarter,
        homeScore: liveScore.homeScore,
        awayScore: liveScore.awayScore,
      });
    }

    // Score change
    const scoreDiff =
      (liveScore.homeScore + liveScore.awayScore) -
      (game.lastScoreHome + game.lastScoreAway);
    if (scoreDiff > 0) {
      const homeScored = liveScore.homeScore > game.lastScoreHome;
      const points = homeScored
        ? liveScore.homeScore - game.lastScoreHome
        : liveScore.awayScore - game.lastScoreAway;

      events.push({
        type: 'score_change',
        gameCode: game.gameCode,
        homeScore: liveScore.homeScore,
        awayScore: liveScore.awayScore,
        quarter: liveScore.quarter,
        clock: liveScore.clock,
        scoringTeamCode: homeScored ? 'home' : 'away',
        playerName: '',
        points,
        description: `${homeScored ? game.homeTeam : game.awayTeam} scores ${points}`,
      });

      // Big run detection
      const scoringTeam = homeScored ? 'home' : 'away';
      const run = this.runTracker.get(game.id);
      if (!run || run.teamCode !== scoringTeam) {
        this.runTracker.set(game.id, { teamCode: scoringTeam, points, opponentPoints: 0 });
      } else {
        run.points += points;
        if (run.points >= 8 && run.opponentPoints === 0) {
          events.push({
            type: 'big_run',
            gameCode: game.gameCode,
            teamCode: scoringTeam,
            run: `${run.points}-0`,
            homeScore: liveScore.homeScore,
            awayScore: liveScore.awayScore,
            quarter: liveScore.quarter,
            clock: liveScore.clock,
          });
        }
      }
    }

    // Lead change detection
    const prevLead = game.lastScoreHome - game.lastScoreAway;
    const newLead = liveScore.homeScore - liveScore.awayScore;
    if (prevLead !== 0 && newLead !== 0 && Math.sign(prevLead) !== Math.sign(newLead)) {
      const leadMargin = Math.abs(newLead);
      events.push({
        type: 'lead_change',
        gameCode: game.gameCode,
        leadingTeamCode: newLead > 0 ? 'home' : 'away',
        leadMargin,
        homeScore: liveScore.homeScore,
        awayScore: liveScore.awayScore,
        quarter: liveScore.quarter,
        clock: liveScore.clock,
      });
    }

    // Game ended
    if (game.status === 'live' && liveScore.status === 'finished') {
      events.push({
        type: 'game_end',
        gameCode: game.gameCode,
        homeScore: liveScore.homeScore,
        awayScore: liveScore.awayScore,
        winnerCode: liveScore.homeScore > liveScore.awayScore ? 'home' : 'away',
      });
    }

    return events;
  }
}
