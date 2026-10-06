import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimitForTests,
  checkRateLimit,
  rateLimit,
  rateLimitResponse,
} from "./rate-limit";

const OPTS = { limit: 3, windowMs: 60_000 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("permits the first request and decrements remaining", () => {
    const result = checkRateLimit("user:1", OPTS);
    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      limit: 3,
    });
    expect(result.reset).toBeGreaterThan(Date.now());
  });

  it("permits exactly `limit` requests then rejects the next", () => {
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    const over = checkRateLimit("user:1", OPTS);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("keeps separate counters per key", () => {
    checkRateLimit("user:1", OPTS);
    checkRateLimit("user:1", OPTS);
    checkRateLimit("user:1", OPTS);
    // user:1 is at the cap, user:2 should still be unaffected.
    const other = checkRateLimit("user:2", OPTS);
    expect(other.success).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it("opens a fresh window after `windowMs` elapses", () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-05-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);
      __resetRateLimitForTests();

      checkRateLimit("user:1", OPTS);
      checkRateLimit("user:1", OPTS);
      checkRateLimit("user:1", OPTS);
      expect(checkRateLimit("user:1", OPTS).success).toBe(false);

      // Jump just past the window.
      vi.setSystemTime(t0 + OPTS.windowMs + 1);
      const refreshed = checkRateLimit("user:1", OPTS);
      expect(refreshed.success).toBe(true);
      expect(refreshed.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rateLimit (shared store)", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubRedis(count: number, pttl: number) {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ result: count }, { result: 1 }, { result: pttl }]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("falls back to the in-memory limiter when Redis is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await rateLimit("user:1", OPTS);
    await rateLimit("user:1", OPTS);
    await rateLimit("user:1", OPTS);
    expect((await rateLimit("user:1", OPTS)).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts in Redis with INCR + PEXPIRE NX + PTTL", async () => {
    const fetchMock = stubRedis(2, 30_000);
    const result = await rateLimit("user:1", OPTS);
    expect(result).toMatchObject({ success: true, remaining: 1, limit: 3 });
    expect(result.reset).toBeGreaterThan(Date.now() + 29_000);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://redis.example.com/pipeline");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual([
      ["INCR", "rl:user:1"],
      ["PEXPIRE", "rl:user:1", "60000", "NX"],
      ["PTTL", "rl:user:1"],
    ]);
  });

  it("rejects once the shared counter passes the limit", async () => {
    stubRedis(4, 10_000);
    const result = await rateLimit("user:1", OPTS);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("degrades to the in-memory limiter when Redis errors", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await rateLimit("user:1", OPTS);
    expect(result).toMatchObject({ success: true, remaining: 2 });
    spy.mockRestore();
  });
});

describe("rateLimitResponse", () => {
  it("returns a 429 with retry / X-RateLimit headers", async () => {
    const reset = Date.now() + 30_000;
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset,
      limit: 60,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/i);
  });

  it("clamps Retry-After to a minimum of 1 second", () => {
    // Reset already in the past — the ceiling math would otherwise give 0.
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset: Date.now() - 5_000,
      limit: 10,
    });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});

describe("RATE_LIMITS presets", () => {
  it("send and broadcast are budgeted per minute", async () => {
    __resetRateLimitForTests();
    // Importing here so the presets stay close to their assertions.
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.send.windowMs).toBe(60_000);
    expect(RATE_LIMITS.broadcast.windowMs).toBe(60_000);
  });

  it("the broadcast budget carries a campaign's per-batch call pattern", async () => {
    __resetRateLimitForTests();
    const { RATE_LIMITS } = await import("./rate-limit");
    // A campaign is NOT one call: the wizard posts a batch of 10
    // recipients roughly every 1–2 s, so it needs ~45+ calls of headroom
    // per minute. Sized below that, every batch past the cap comes back
    // 429 and its recipients are written off as failed (issue #472).
    expect(RATE_LIMITS.broadcast.limit).toBeGreaterThanOrEqual(45);
  });
});

afterEach(() => {
  __resetRateLimitForTests();
});
