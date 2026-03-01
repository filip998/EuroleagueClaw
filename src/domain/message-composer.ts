import type { GameEvent, TrackedGame, PlayByPlayEvent, RoundSchedule, RoundGame } from './types.js';

export class MessageComposer {
  private teamNames = new Map<string, { home: string; away: string }>();

  /** Register team names for a tracked game so messages use real names */
  registerGame(gameCode: number, homeTeam: string, awayTeam: string): void {
    this.teamNames.set(String(gameCode), { home: homeTeam, away: awayTeam });
  }

  compose(event: GameEvent): string {
    const teams = this.teamNames.get(String(event.gameCode));
    const home = teams?.home ?? 'Home';
    const away = teams?.away ?? 'Away';

    switch (event.type) {
      case 'game_start':
        return this.gameStart(event.homeTeam.name, event.awayTeam.name);
      case 'game_end':
        return this.gameEnd(home, away, event.homeScore, event.awayScore);
      case 'quarter_start':
        return this.quarterStart(event.quarter, home, away, event.homeScore, event.awayScore);
      case 'quarter_end':
        return this.quarterEnd(event.quarter, home, away, event.homeScore, event.awayScore);
      case 'score_change':
        return this.scoreChange(
          home, away,
          event.homeScore, event.awayScore,
          event.quarter, event.clock,
          event.description,
        );
      case 'lead_change':
        return this.leadChange(
          home, away,
          event.homeScore, event.awayScore,
          event.leadMargin, event.quarter, event.clock,
          event.leadingTeamCode === 'home' ? home : away,
        );
      case 'big_run':
        return this.bigRun(
          home, away,
          event.homeScore, event.awayScore,
          event.run,
          event.teamCode === 'home' ? home : away,
          event.quarter, event.clock,
        );
      default: {
        const _exhaustive: never = event;
        return `🏀 Game update`;
      }
    }
  }

  composeRoundGames(schedule: RoundSchedule): string {
    if (schedule.games.length === 0) return '📅 No games found for the current round.';

    const header = `🏀 ${schedule.roundName}`;
    const gamesByDate = this.groupGamesByDate(schedule.games);

    const sections: string[] = [];
    for (const [dateLabel, games] of gamesByDate) {
      const lines = games.map((g) => this.formatRoundGame(g));
      sections.push(`📆 ${dateLabel}\n${lines.join('\n')}`);
    }

    return `${header}\n\n${sections.join('\n\n')}`;
  }

  private groupGamesByDate(games: RoundGame[]): [string, RoundGame[]][] {
    const groups = new Map<string, RoundGame[]>();
    const fmt = new Intl.DateTimeFormat('sr-Latn', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Belgrade',
    });

    for (const game of games) {
      const dateKey = fmt.format(new Date(game.startTime));
      const list = groups.get(dateKey) ?? [];
      list.push(game);
      groups.set(dateKey, list);
    }

    return [...groups.entries()];
  }

  private formatRoundGame(game: RoundGame): string {
    if (game.status === 'finished') {
      const winner = game.homeScore > game.awayScore ? game.homeTeam.shortName : game.awayTeam.shortName;
      return `  ✅ ${game.homeTeam.shortName} ${game.homeScore} - ${game.awayScore} ${game.awayTeam.shortName}  🏆 ${winner}`;
    }

    const time = new Intl.DateTimeFormat('sr-Latn', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Belgrade',
      hour12: false,
    }).format(new Date(game.startTime));

    return `  ⏳ ${game.homeTeam.shortName} vs ${game.awayTeam.shortName}  🕐 ${time}`;
  }

  composeSchedule(games: Array<{ homeTeam: string; awayTeam: string; startTime: string; gameCode: number }>): string {
    if (games.length === 0) return '📅 No EuroLeague games scheduled for today.';

    const lines = games.map((g) => {
      const time = new Date(g.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return `  ${time} — ${g.homeTeam} vs ${g.awayTeam} (${g.gameCode})`;
    });

    return `📅 Today's EuroLeague Games:\n\n${lines.join('\n')}`;
  }

  composeTrackedGames(games: TrackedGame[]): string {
    if (games.length === 0) return '📋 No games currently being tracked.';

    const lines = games.map((g) => {
      const statusEmoji = g.status === 'live' ? '🔴' : g.status === 'finished' ? '✅' : '⏳';
      return `  ${statusEmoji} ${g.homeTeam} ${g.lastScoreHome} · ${g.lastScoreAway} ${g.awayTeam} (${g.gameCode})`;
    });

    return `📋 Tracked Games:\n\n${lines.join('\n')}`;
  }

  composeHelp(): string {
    return [
      '🏀 EuroleagueClaw — Commands:\n',
      '/help — Show this message',
      '/today — Today\'s EuroLeague schedule',
      '/game <code> — Start tracking a game',
      '/stop <code> — Stop tracking a game',
      '/games — Current round schedule & results',
      '/fantasy — Fantasy league overview',
      '/roster — Fantasy roster overview',
      '/mute <minutes> — Silence updates',
      '/unmute — Resume updates',
      '/trivia — Random trivia question',
      '/status — Bot status',
    ].join('\n');
  }

  composeStatus(trackedCount: number, uptime: number): string {
    const uptimeStr = this.formatDuration(uptime);
    return `🤖 EuroleagueClaw Status\n\n  ⏱ Uptime: ${uptimeStr}\n  📊 Tracking: ${trackedCount} game(s)`;
  }

  composeRosterMatch(event: PlayByPlayEvent, owners: string[]): string {
    const emoji = this.rosterEventEmoji(event.eventType);
    const ownerList = owners.join(', ');
    return `${emoji} ${event.playerName} — ${event.description}\n📋 On roster: ${ownerList}`;
  }

  private rosterEventEmoji(eventType: string): string {
    switch (eventType) {
      case 'two_pointer_made':
      case 'three_pointer_made':
      case 'free_throw_made':
        return '🏀';
      case 'assist':
        return '🎯';
      case 'steal':
        return '🔥';
      case 'block':
        return '🛡️';
      default:
        return '📊';
    }
  }

  private gameStart(home: string, away: string): string {
    return `🏀 Game Starting!\n\n${home} vs ${away}\n\nLet's go! 🔥`;
  }

  private gameEnd(home: string, away: string, homeScore: number, awayScore: number): string {
    const winner = homeScore > awayScore ? home : away;
    return `🏆 FINAL\n\n${home} ${homeScore} · ${awayScore} ${away}\n\n🎉 ${winner} wins!`;
  }

  private quarterStart(quarter: number, home: string, away: string, homeScore: number, awayScore: number): string {
    const qName = this.quarterName(quarter);
    return `📢 ${qName} Starting\n\n${home} ${homeScore} · ${awayScore} ${away}`;
  }

  private quarterEnd(quarter: number, home: string, away: string, homeScore: number, awayScore: number): string {
    const qName = this.quarterName(quarter);
    return `📢 End of ${qName}\n\n${home} ${homeScore} · ${awayScore} ${away}`;
  }

  private scoreChange(
    home: string, away: string,
    homeScore: number, awayScore: number,
    quarter: number, clock: string,
    description: string,
  ): string {
    const qName = this.quarterName(quarter);
    return `🏀 ${qName} ${clock} — ${home} ${homeScore} · ${awayScore} ${away}\n📊 ${description}`;
  }

  private leadChange(
    home: string, away: string,
    homeScore: number, awayScore: number,
    margin: number, quarter: number, clock: string,
    leadingTeam: string,
  ): string {
    const qName = this.quarterName(quarter);
    return `🔄 Lead Change! ${qName} ${clock}\n\n${home} ${homeScore} · ${awayScore} ${away}\n${leadingTeam} leads by ${margin}`;
  }

  private bigRun(
    home: string, away: string,
    homeScore: number, awayScore: number,
    run: string, runningTeam: string,
    quarter: number, clock: string,
  ): string {
    const qName = this.quarterName(quarter);
    return `🔥 ${runningTeam} on a ${run} run! ${qName} ${clock}\n\n${home} ${homeScore} · ${awayScore} ${away}`;
  }

  private quarterName(quarter: number): string {
    if (quarter <= 4) return `Q${quarter}`;
    return `OT${quarter - 4}`;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
