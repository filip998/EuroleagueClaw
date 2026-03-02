export interface NewsPort {
  getLatestNews(): Promise<NewsEntry[]>;
  getInjuryNews(): Promise<NewsEntry[]>;
  setCacheTtl?(ttlMs: number): void;
}

export interface NewsEntry {
  playerName: string;
  headline: string;
  date: string;
  position: string;      // "G", "F", "C"
  injuryType?: string;    // "Knee", "Illness", etc. (only for injuries)
  newsText: string;       // The actual news paragraph
  isInjury: boolean;
}
