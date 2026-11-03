import { describe, expect, it } from 'vitest';
import { formatTraceparent, newTraceContext, parseTraceparent } from '../src/index.ts';

describe('trace context', () => {
  it('round-trips a generated context', () => {
    const ctx = newTraceContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(parseTraceparent(formatTraceparent(ctx))).toEqual(ctx);
  });

  it.each([
    undefined,
    '',
    'garbage',
    '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', // unknown version
    '00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01', // uppercase
    '00-00000000000000000000000000000000-00f067aa0ba902b7-01', // zero trace id
    '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01', // zero span id
    '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra',
  ])('rejects %j', (h) => {
    expect(parseTraceparent(h)).toBeUndefined();
  });

  it('accepts the spec example and array-valued headers', () => {
    const h = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    expect(parseTraceparent([h])).toEqual({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' });
  });
});
