import type { TvSchedulePort, TvScheduleEntry } from '../../ports/tv-schedule.port.js';
import type { Logger } from '../../shared/logger.js';

const ARENA_SPORT_URL = 'https://www.tvarenasport.com/tv-scheme';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const CHANNEL_SHORT_MAP: Record<string, string> = {
  'arena premium 1': 'ASP1',
  'arena premium 2': 'ASP2',
  'arena premium 3': 'ASP3',
  'arena sport 1': 'AS1',
  'arena sport 2': 'AS2',
  'arena sport 3': 'AS3',
  'arena sport 4': 'AS4',
  'arena sport 5': 'AS5',
};

// Keywords that indicate EuroLeague content
const EUROLEAGUE_KEYWORDS = [
  'evroliga', 'euroleague', 'euro league',
];

// Known EuroLeague team name fragments (Serbian/international)
const TEAM_FRAGMENTS = [
  'partizan', 'zvezda', 'crvena zvezda',
  'barselona', 'barcelona', 'barca',
  'real madrid', 'real',
  'fenerbahce', 'fenerbahče',
  'olympiacos', 'olympiakos', 'olimpijakos',
  'panathinaikos', 'panatinaikos',
  'maccabi', 'makabi',
  'efes', 'anadolu',
  'milano', 'milan', 'olimpija milano',
  'alba', 'alba berlin',
  'bayern', 'bajern',
  'baskonia',
  'monaco', 'monako',
  'virtus', 'bologna',
  'zalgiris', 'žalgiris',
  'asvel', 'villerban',
  'ldkl', 'lyon',
  'paris',
];

const LIVE_KEYWORDS = ['uživo', 'uzivo', 'live', 'prenos'];

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export class ArenaSportAdapter implements TvSchedulePort {
  private cache: { data: TvScheduleEntry[]; fetchedAt: number } | null = null;

  constructor(private readonly logger: Logger) {}

  async getEuroLeagueSchedule(): Promise<TvScheduleEntry[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.data;
    }

    try {
      const html = await this.fetchPage();
      const entries = this.parseSchedule(html);
      const euroEntries = entries.filter((e) => this.isEuroLeague(e));
      this.cache = { data: euroEntries, fetchedAt: Date.now() };
      this.logger.info({ count: euroEntries.length }, 'Arena Sport TV schedule loaded');
      return euroEntries;
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Failed to fetch Arena Sport TV schedule');
      return this.cache?.data ?? [];
    }
  }

  private async fetchPage(): Promise<string> {
    const response = await fetch(ARENA_SPORT_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'sr,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Arena Sport returned ${response.status}`);
    }

    return response.text();
  }

  /** Try extracting window.TV_SCHEMES JSON first, fall back to HTML parsing. */
  parseSchedule(html: string): TvScheduleEntry[] {
    const fromJson = this.tryExtractTvSchemes(html);
    if (fromJson.length > 0) return fromJson;
    return this.parseHtml(html);
  }

  private tryExtractTvSchemes(html: string): TvScheduleEntry[] {
    // window.TV_SCHEMES is an object keyed by channel name
    const match = html.match(/window\.TV_SCHEMES\s*=\s*(\{[\s\S]*?\});/);
    if (!match) return [];

    try {
      const raw = JSON.parse(match[1]) as Record<string, TvSchemeChannel>;
      const entries: TvScheduleEntry[] = [];

      for (const [channelName, channelData] of Object.entries(raw)) {
        if (!channelData || typeof channelData !== 'object') continue;
        const days = channelData.days;
        if (!days || typeof days !== 'object') continue;

        for (const [dateStr, dayData] of Object.entries(days)) {
          if (!dayData || typeof dayData !== 'object') continue;
          const emisije = (dayData as Record<string, unknown>).emisije;
          if (!Array.isArray(emisije)) continue;

          for (const em of emisije) {
            if (!em || typeof em !== 'object') continue;
            const entry = em as TvSchemeEmisija;
            const content = (entry.content ?? '').trim();
            const time = (entry.time ?? '').trim();
            const category = (entry.category ?? '').toLowerCase();
            const description = (entry.description ?? '').toLowerCase();
            const isLive = description === 'uzivo' || description === 'uživo';

            if (!content || !time) continue;
            // Pre-filter: only include entries with EVROLIGA category
            // or whose title matches EuroLeague team names
            const isEuroCategory = category === 'evroliga';

            entries.push({
              channelName: channelName.trim(),
              channelShort: this.resolveChannelShort(channelName.trim()),
              date: dateStr,
              time: time.slice(0, 5),
              title: isEuroCategory ? `[EVROLIGA] ${content}` : content,
              isLive,
            });
          }
        }
      }

      return entries;
    } catch {
      this.logger.debug('Failed to parse window.TV_SCHEMES JSON');
      return [];
    }
  }

  /** Parse schedule entries from DOM-like HTML structure. */
  private parseHtml(html: string): TvScheduleEntry[] {
    const entries: TvScheduleEntry[] = [];

    // Strategy: find channel blocks and their program items
    // Arena Sport typically uses a per-channel structure with program rows
    // Pattern: channel header followed by time/title rows

    // Extract channel sections - look for channel name headings
    const channelSections = html.split(/(?=<(?:div|section|h[234])[^>]*class="[^"]*channel[^"]*")/gi);

    // If structured channel sections found, parse each
    if (channelSections.length > 1) {
      for (const section of channelSections) {
        const channelEntries = this.parseChannelSection(section);
        entries.push(...channelEntries);
      }
      if (entries.length > 0) return entries;
    }

    // Fallback: scan entire HTML for program-entry patterns
    // Look for patterns like: time + channel + title in table rows or divs
    const programPattern = /<(?:tr|div|li)[^>]*>[\s\S]*?(\d{1,2}[:.]\d{2})[\s\S]*?(arena\s+(?:premium|sport)\s+\d)/gi;
    let programMatch: RegExpExecArray | null;
    while ((programMatch = programPattern.exec(html)) !== null) {
      const block = programMatch[0];
      const time = programMatch[1].replace('.', ':');
      const channelName = programMatch[2];
      const titleMatch = block.match(/(?:title|name|program)[^>]*>([^<]+)/i)
        ?? block.match(/>([A-ZĆČŽŠĐa-zćčžšđ][\w\s\-–:.]+)</);
      if (titleMatch) {
        entries.push({
          channelName: channelName.trim(),
          channelShort: this.resolveChannelShort(channelName),
          date: '',
          time,
          title: this.stripTags(titleMatch[1]).trim(),
          isLive: this.detectLive(block, ''),
        });
      }
    }

    // Another common pattern: date headers with program listings
    if (entries.length === 0) {
      entries.push(...this.parseGenericProgramBlocks(html));
    }

    return entries;
  }

  private parseChannelSection(section: string): TvScheduleEntry[] {
    const entries: TvScheduleEntry[] = [];

    // Extract channel name
    const channelMatch = section.match(/(?:arena\s+(?:premium|sport)\s+\d+)/i);
    if (!channelMatch) return [];
    const channelName = channelMatch[0].trim();

    // Find date context if present
    const dateMatch = section.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    let date = '';
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      date = `${year}-${month}-${day}`;
    }

    // Extract program entries: time + title
    const timePattern = /(\d{1,2}[:.]\d{2})\s*(?:<[^>]*>)*\s*([^<\n]{3,})/g;
    let match: RegExpExecArray | null;
    while ((match = timePattern.exec(section)) !== null) {
      const time = match[1].replace('.', ':');
      const title = this.stripTags(match[2]).trim();
      if (title.length < 3) continue;

      entries.push({
        channelName,
        channelShort: this.resolveChannelShort(channelName),
        date,
        time,
        title,
        isLive: this.detectLive(title, ''),
      });
    }

    return entries;
  }

  private parseGenericProgramBlocks(html: string): TvScheduleEntry[] {
    const entries: TvScheduleEntry[] = [];

    // Look for any time + text blocks near "arena" channel mentions
    // Pattern: date block followed by channel + time + title
    const blockPattern = /(\d{1,2}[./]\d{1,2}[./]\d{2,4})[\s\S]*?(arena\s+(?:premium|sport)\s+\d+)[\s\S]*?(\d{1,2}[:.]\d{2})[\s\S]*?(?:>)([^<]{3,})/gi;
    let match: RegExpExecArray | null;
    while ((match = blockPattern.exec(html)) !== null) {
      const date = this.normalizeDate(match[1]);
      const channelName = match[2].trim();
      const time = match[3].replace('.', ':');
      const title = this.stripTags(match[4]).trim();

      entries.push({
        channelName,
        channelShort: this.resolveChannelShort(channelName),
        date,
        time,
        title,
        isLive: this.detectLive(title, ''),
      });
    }

    return entries;
  }

  private resolveChannelShort(channelName: string): string {
    const key = channelName.toLowerCase().trim();
    return CHANNEL_SHORT_MAP[key] ?? channelName.replace(/\s+/g, '').toUpperCase().slice(0, 6);
  }

  private normalizeDate(dateStr: string): string {
    if (!dateStr) return '';
    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
    // DD.MM.YYYY or DD/MM/YYYY
    const m = dateStr.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const month = m[2].padStart(2, '0');
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${year}-${month}-${day}`;
    }
    return dateStr;
  }

  private detectLive(text: string, category: string): boolean {
    const combined = `${text} ${category}`.toLowerCase();
    return LIVE_KEYWORDS.some((kw) => combined.includes(kw));
  }

  private isEuroLeague(entry: TvScheduleEntry): boolean {
    const text = entry.title.toLowerCase();
    // Check explicit EuroLeague keywords
    if (EUROLEAGUE_KEYWORDS.some((kw) => text.includes(kw))) return true;
    // Check if title mentions known team names (at least 2 for a matchup)
    const matchedTeams = TEAM_FRAGMENTS.filter((f) => text.includes(f));
    return matchedTeams.length >= 1;
  }

  private stripTags(text: string): string {
    return text.replace(/<[^>]*>/g, '');
  }
}

// ─── Raw JSON shape from window.TV_SCHEMES ───

interface TvSchemeChannel {
  days?: Record<string, { emisije?: TvSchemeEmisija[] }>;
  channel_image?: string;
}

interface TvSchemeEmisija {
  content?: string;
  time?: string;
  category?: string;
  sport?: string;
  description?: string;
}
