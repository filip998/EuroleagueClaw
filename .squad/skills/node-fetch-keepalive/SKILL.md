# SKILL: Node.js Fetch Keep-Alive with undici

## When to Use
Any Node 22+ adapter that polls an external API at intervals Γëñ 30 seconds. Without explicit keep-alive tuning, TLS handshakes dominate each request (~200-500ms overhead per cold connection).

## Pattern

```typescript
import { Agent } from 'undici';

// One agent per API host, created once in the adapter constructor
const agent = new Agent({
  keepAliveTimeout: 60_000,       // Keep sockets open 60s (default is 4s ΓÇö too short for 10s polling)
  keepAliveMaxTimeout: 600_000,   // Max 10 minutes
  connections: 4,                 // Per-origin socket pool
  pipelining: 1,                  // Safe default ΓÇö one in-flight request per socket
});

// Pass to every fetch call targeting this host
const response = await fetch(url, {
  dispatcher: agent,
  signal: AbortSignal.timeout(timeoutMs),
  headers: { Accept: 'application/json' },
});

// IMPORTANT: Close on shutdown to prevent socket leaks
agent.close();
```

## Key Rules
1. **One Agent per distinct host** ΓÇö e.g., separate agents for `api-live.euroleague.net` and `live.euroleague.net`
2. **`keepAliveTimeout` must exceed poll interval** ΓÇö If you poll every 10s, set keepAlive to at least 30s (3x)
3. **Add `undici` to `package.json`** ΓÇö Node 22 ships undici internally but doesn't expose `Agent` without explicit install
4. **Always close on shutdown** ΓÇö Prevents dangling sockets in long-running processes
5. **Warm-up requests** ΓÇö Fire a lightweight request (HEAD or dummy GET) when starting a polling loop to prime TLS before the first real tick

## Anti-Patterns
- Γ¥î Relying on Node's global dispatcher keepAlive (default 4s timeout ΓÇö too short for 10s+ polling)
- Γ¥î Creating a new Agent per request
- Γ¥î Using `http.Agent` with `fetch()` ΓÇö `fetch()` only accepts `undici.Dispatcher`-compatible objects
