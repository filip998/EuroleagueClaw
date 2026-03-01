// ─── Game & Score Types ────────────────────────────────────

export interface GameInfo {
  gameCode: number;
  seasonCode: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  status: GameStatus;
  startTime: string; // ISO datetime
  venue?: string;
}

export interface TeamInfo {
  code: string;
  name: string;
  shortName: string;
}

export type GameStatus = 'scheduled' | 'live' | 'finished' | 'postponed';

export interface LiveScore {
  gameCode: number;
  homeScore: number;
  awayScore: number;
  quarter: number;
  clock: string; // e.g. "5:32"
  status: GameStatus;
}

// ─── Play-by-Play Types ───────────────────────────────────

export interface PlayByPlayEvent {
  eventId: string;
  gameCode: number;
  quarter: number;
  clock: string;
  teamCode: string;
  playerName: string;
  eventType: PlayByPlayEventType;
  description: string;
  homeScore: number;
  awayScore: number;
}

export type PlayByPlayEventType =
  | 'two_pointer_made'
  | 'two_pointer_missed'
  | 'three_pointer_made'
  | 'three_pointer_missed'
  | 'free_throw_made'
  | 'free_throw_missed'
  | 'rebound'
  | 'assist'
  | 'steal'
  | 'block'
  | 'turnover'
  | 'foul'
  | 'timeout'
  | 'substitution'
  | 'quarter_start'
  | 'quarter_end'
  | 'game_start'
  | 'game_end'
  | 'unknown';

// ─── Domain Events (emitted by GameTracker) ───────────────

export type GameEvent =
  | ScoreChangeEvent
  | QuarterTransitionEvent
  | BigRunEvent
  | LeadChangeEvent
  | GameEndEvent
  | GameStartEvent;

export interface ScoreChangeEvent {
  type: 'score_change';
  gameCode: number;
  homeScore: number;
  awayScore: number;
  quarter: number;
  clock: string;
  scoringTeamCode: string;
  playerName: string;
  points: number; // 1, 2, or 3
  description: string;
}

export interface QuarterTransitionEvent {
  type: 'quarter_start' | 'quarter_end';
  gameCode: number;
  quarter: number;
  homeScore: number;
  awayScore: number;
}

export interface BigRunEvent {
  type: 'big_run';
  gameCode: number;
  teamCode: string;
  run: string; // e.g. "8-0"
  homeScore: number;
  awayScore: number;
  quarter: number;
  clock: string;
}

export interface LeadChangeEvent {
  type: 'lead_change';
  gameCode: number;
  leadingTeamCode: string;
  leadMargin: number;
  homeScore: number;
  awayScore: number;
  quarter: number;
  clock: string;
}

export interface GameStartEvent {
  type: 'game_start';
  gameCode: number;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
}

export interface GameEndEvent {
  type: 'game_end';
  gameCode: number;
  homeScore: number;
  awayScore: number;
  winnerCode: string;
}

// ─── Tracked Game State ───────────────────────────────────

export interface TrackedGame {
  id: string;
  gameCode: number;
  seasonCode: string;
  homeTeam: string;
  awayTeam: string;
  status: GameStatus;
  lastScoreHome: number;
  lastScoreAway: number;
  lastQuarter: number;
  lastEventId: string | null;
  trackedByChatId: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Chat Types ───────────────────────────────────────────

export interface ChatSubscription {
  chatId: string;
  chatPlatform: string;
  isActive: boolean;
  mutedUntil: string | null;
  fantasyEnabled: boolean;
  triviaEnabled: boolean;
  createdAt: string;
}

export interface IncomingCommand {
  chatId: string;
  command: string; // e.g. "game"
  args: string[];  // e.g. ["123"]
  senderName: string;
}

export interface OutgoingMessage {
  chatId: string;
  text: string;
  parseMode?: 'MarkdownV2' | 'HTML';
}

// ─── Fantasy Types ────────────────────────────────────────

export interface FantasyStandings {
  roundNumber: number;
  roundName: string;
  entries: FantasyEntry[];
}

export interface FantasyEntry {
  rank: number;
  teamName: string;
  ownerName: string;
  totalPoints: number;
  roundPoints: number;
}

// ─── Trivia Types ─────────────────────────────────────────

export interface TriviaQuestion {
  id: number;
  question: string;
  answer: string;
  category: string;
}

// ─── Fantasy Roster Types ─────────────────────────────

export interface FantasyRoster {
  ownerName: string;
  players: RosteredPlayer[];
}

export interface RosteredPlayer {
  playerName: string;
  teamCode: string;
  position?: string;
  isCaptain?: boolean;
  isOnFire?: boolean;
  opponentCode?: string;
  courtPosition?: number;
}

export interface RosterRound {
  roundNumber: number;
  rosters: FantasyRoster[];
}

export interface RosterFetchResult {
  matchdayNumber: number;
  rosters: FantasyRoster[];
}

// ─── Round Schedule Types ─────────────────────────────────

export interface RoundSchedule {
  roundNumber: number;
  roundName: string;
  games: RoundGame[];
}

export interface RoundGame {
  gameCode: number;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  status: GameStatus;
  startTime: string; // UTC ISO datetime
  homeScore: number;
  awayScore: number;
}

// ─── Event Priority ───────────────────────────────────────

export type EventPriority = 'critical' | 'high' | 'normal' | 'low';

export function getEventPriority(event: GameEvent): EventPriority {
  switch (event.type) {
    case 'game_start':
    case 'game_end':
    case 'quarter_start':
    case 'quarter_end':
      return 'critical';
    case 'lead_change':
    case 'big_run':
      return 'high';
    case 'score_change':
      return 'normal';
    default:
      return 'low';
  }
}
