import { describe, it, expect, beforeEach } from 'bun:test';
import { CircuitBreaker } from '../../../packages/ai/dist/harness/kernel/guard/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      windowMs: 60_000,
      tripThreshold: 0.3,
      cooldownMs: 5_000,
      halfOpenProbeCount: 1,
    });
  });

  describe('closed state', () => {
    it('starts in closed state', () => {
      expect(cb.getState()).toBe('closed');
      expect(cb.isAllowed()).toBe(true);
    });

    it('stays closed when success rate is high', () => {
      for (let i = 0; i < 10; i++) cb.recordResult(false);
      expect(cb.getState()).toBe('closed');
    });

    it('trips to open when tripped ratio exceeds threshold', () => {
      // 3 tripped out of 5 = 60% >= 30% threshold
      cb.recordResult(false);
      cb.recordResult(false);
      cb.recordResult(true);
      cb.recordResult(true);
      cb.recordResult(true);
      expect(cb.getState()).toBe('open');
      expect(cb.isAllowed()).toBe(false);
    });

    it('does not trip with fewer than 3 records', () => {
      cb.recordResult(true);
      cb.recordResult(true);
      expect(cb.getState()).toBe('closed');
    });
  });

  describe('open state', () => {
    function tripBreaker() {
      cb.recordResult(true);
      cb.recordResult(true);
      cb.recordResult(true);
    }

    it('rejects all requests when open', () => {
      tripBreaker();
      expect(cb.isAllowed()).toBe(false);
    });

    it('returns retryAfterMs > 0 when open', () => {
      tripBreaker();
      expect(cb.getRetryAfterMs()).toBeGreaterThan(0);
      expect(cb.getRetryAfterMs()).toBeLessThanOrEqual(5000);
    });

    it('transitions to half-open after cooldown', async () => {
      // Use a very short cooldown
      const fast = new CircuitBreaker({ windowMs: 60_000, tripThreshold: 0.3, cooldownMs: 50, halfOpenProbeCount: 1 });
      fast.recordResult(true);
      fast.recordResult(true);
      fast.recordResult(true);
      expect(fast.getState()).toBe('open');

      await new Promise(r => setTimeout(r, 80));
      expect(fast.getState()).toBe('half-open');
    });
  });

  describe('half-open state', () => {
    let fast: CircuitBreaker;

    beforeEach(async () => {
      fast = new CircuitBreaker({ windowMs: 60_000, tripThreshold: 0.3, cooldownMs: 50, halfOpenProbeCount: 1 });
      fast.recordResult(true);
      fast.recordResult(true);
      fast.recordResult(true);
      await new Promise(r => setTimeout(r, 80));
    });

    it('allows limited probe requests', () => {
      expect(fast.getState()).toBe('half-open');
      expect(fast.isAllowed()).toBe(true);  // first probe allowed
      expect(fast.isAllowed()).toBe(false); // second rejected
    });

    it('closes on successful probe', () => {
      fast.isAllowed(); // consume probe
      fast.recordResult(false); // success
      expect(fast.getState()).toBe('closed');
      expect(fast.isAllowed()).toBe(true);
    });

    it('reopens on failed probe', () => {
      fast.isAllowed(); // consume probe
      fast.recordResult(true); // failure
      expect(fast.getState()).toBe('open');
    });
  });

  describe('reset', () => {
    it('resets to closed state', () => {
      cb.recordResult(true);
      cb.recordResult(true);
      cb.recordResult(true);
      expect(cb.getState()).toBe('open');
      cb.reset();
      expect(cb.getState()).toBe('closed');
      expect(cb.isAllowed()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      // Record 5 results with 1 tripped = 20% < 30% threshold.
      // The tripped record must come after enough successes so the ratio
      // never reaches the threshold during any intermediate recordResult call.
      // After records [F, F, F, T, F]: at record 4 ratio is 1/4=25% < 30%, stays closed.
      cb.recordResult(false);
      cb.recordResult(false);
      cb.recordResult(false);
      cb.recordResult(true);
      cb.recordResult(false);
      const stats = cb.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.windowSize).toBe(5);
      expect(stats.trippedCount).toBe(1);
      expect(stats.trippedRatio).toBeCloseTo(1 / 5);
    });
  });
});
