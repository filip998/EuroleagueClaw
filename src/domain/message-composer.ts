import type { GameEvent, TrackedGame, PlayByPlayEvent, RoundSchedule, RoundGame } from './types.js';
import type { RosterStats } from './roster-tracker.js';
import type { NewsEntry } from '../ports/news.port.js';
import { escapeMarkdownV2, bold, italic, SEPARATOR } from '../shared/markdown-v2.js';

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
    if (schedule.games.length === 0) return escapeMarkdownV2('📅 No games found for the current round.');

    const header = `🏀 ${bold(schedule.roundName)}\n${SEPARATOR}`;
    const gamesByDate = this.groupGamesByDate(schedule.games);

    const sections: string[] = [];
    for (const [dateLabel, games] of gamesByDate) {
      const lines = games.map((g) => this.formatGameLine(g));
      sections.push(`📆 ${bold(dateLabel)}\n\n${lines.join('\n')}`);
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

  private formatGameLine(game: RoundGame): string {
    if (game.status === 'finished') {
      return `✅ ${bold(game.homeTeam.shortName)} ${game.homeScore} ${escapeMarkdownV2('-')} ${game.awayScore} ${bold(game.awayTeam.shortName)}`;
    }

    const time = new Intl.DateTimeFormat('sr-Latn', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Belgrade',
      hour12: false,
    }).format(new Date(game.startTime));

    const tvTag = game.tvChannel ? ` · 📺 ${escapeMarkdownV2(game.tvChannel)}` : '';
    return `⏳ ${bold(game.homeTeam.shortName)} vs ${bold(game.awayTeam.shortName)}\n      🕐 ${escapeMarkdownV2(time)}${tvTag}`;
  }

  /** Format a game line for use inside a code block (no MarkdownV2 escaping). */
  private formatGameCodeBlock(game: RoundGame): string {
    const home = game.homeTeam.code.padEnd(4);
    const away = game.awayTeam.code.padEnd(4);

    if (game.status === 'finished') {
      const score = `${String(game.homeScore).padStart(3)}-${String(game.awayScore).padEnd(3)}`;
      const winnerCode = game.homeScore > game.awayScore ? game.homeTeam.code : game.awayTeam.code;
      return `✅ ${home} ${score} ${away} 🏆 ${winnerCode}`;
    }

    const time = new Intl.DateTimeFormat('sr-Latn', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Belgrade',
      hour12: false,
    }).format(new Date(game.startTime));

    return `  ${home} vs  ${away} ${time}`;
  }

  composeNews(entries: NewsEntry[], title: string): string {
    if (entries.length === 0) return escapeMarkdownV2('📰 No news available.');

    const header = `🗞 ${bold(title)}\n${SEPARATOR}`;
    const items = entries.slice(0, 10).map((entry) => {
      const emoji = entry.isInjury ? '🏥' : '📰';
      const name = bold(entry.playerName);
      const headline = escapeMarkdownV2(entry.headline || 'Update');
      const injuryTag = entry.injuryType ? `${escapeMarkdownV2(entry.injuryType)} · ` : '';
      const date = escapeMarkdownV2(entry.date);
      const meta = italic(`${injuryTag}${date}`);
      const truncated = entry.newsText.length > 100
        ? `${entry.newsText.slice(0, 100)}...`
        : entry.newsText;
      const body = escapeMarkdownV2(truncated);

      return `${emoji} ${name} — ${headline}\n  ${meta}\n  ${body}`;
    });

    return `${header}\n\n${items.join('\n\n')}`;
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
    const e = escapeMarkdownV2;
    const commands = [
      `▸ ${bold('/help')} ${e('— Show this message')}`,
      `▸ ${bold('/today')} ${e("— Today's schedule")}`,
      `▸ ${bold('/game <n>')} ${e('— Track a game')}`,
      `▸ ${bold('/trackall')} ${e("— Track all today's games")}`,
      `▸ ${bold('/stop <n>')} ${e('— Stop tracking')}`,
      `▸ ${bold('/games')} ${e('— Round schedule')}`,
      `▸ ${bold('/fantasy')} ${e('— Fantasy overview')}`,
      `▸ ${bold('/roster')} ${e('— Roster overview')}`,
      `▸ ${bold('/rostercheck')} ${e('— Roster debug status')}`,
      `▸ ${bold('/mute <m>')} ${e('— Silence updates')}`,
      `▸ ${bold('/unmute')} ${e('— Resume updates')}`,
      `▸ ${bold('/trivia')} ${e('— Random trivia')}`,
      `▸ ${bold('/rotowire')} ${e('— EuroLeague news')}`,
      `▸ ${bold('/status')} ${e('— Bot status')}`,
    ];

    return `🏀 ${bold('EuroleagueClaw')}\n${SEPARATOR}\n\n${commands.join('\n')}`;
  }

  composeStatus(trackedCount: number, uptime: number): string {
    const uptimeStr = this.formatDuration(uptime);
    return `🤖 EuroleagueClaw Status\n\n  ⏱ Uptime: ${uptimeStr}\n  📊 Tracking: ${trackedCount} game(s)`;
  }

  composeRosterMatch(event: PlayByPlayEvent, owners: string[]): string {
    const emoji = this.rosterEventEmoji(event.eventType);
    const ownerList = escapeMarkdownV2(owners.join(', '));
    return `${emoji} ${bold(event.playerName)} — ${escapeMarkdownV2(event.description)}\n📋 ${escapeMarkdownV2('On roster:')} ${ownerList}`;
  }

  composeRosterStatus(stats: RosterStats): string {
    const e = escapeMarkdownV2;
    const header = `🔍 ${bold('Roster Status')}\n${SEPARATOR}`;

    const statusEmoji = stats.loaded ? '✅' : '❌';
    const loadedText = stats.loaded ? 'Loaded' : 'Not loaded';
    const lines = [
      `${statusEmoji} ${bold('Status:')} ${e(loadedText)}`,
      `📊 ${bold('Players indexed:')} ${e(String(stats.playerCount))}`,
      `🏀 ${bold('Teams:')} ${e(String(stats.teamCount))}`,
      `📅 ${bold('Matchday:')} ${e(String(stats.roundNumber))}`,
    ];

    if (stats.lastLoadedAt) {
      const timeStr = stats.lastLoadedAt.toLocaleString('sr-Latn', { timeZone: 'Europe/Belgrade' });
      lines.push(`🕐 ${bold('Last loaded:')} ${e(timeStr)}`);
    } else {
      lines.push(`🕐 ${bold('Last loaded:')} ${e('Never')}`);
    }

    if (stats.loaded && stats.playerNames.length > 0) {
      lines.push('');
      lines.push(`📋 ${bold('Indexed players:')}`);
      const sorted = [...stats.playerNames].sort();
      for (const name of sorted) {
        lines.push(`  · ${e(name)}`);
      }
    }

    return `${header}\n\n${lines.join('\n')}`;
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
