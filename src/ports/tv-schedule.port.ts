export interface TvSchedulePort {
  getEuroLeagueSchedule(): Promise<TvScheduleEntry[]>;
}

export interface TvScheduleEntry {
  channelName: string;
  channelShort: string;
  date: string;       // "2026-03-04"
  time: string;       // "20:30"
  title: string;      // "Partizan - Dubai"
  isLive: boolean;
}
