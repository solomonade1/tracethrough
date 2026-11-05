import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { checkExpectation, interpretAuthenticode, verifySigning } from './verify-signing.mjs';

const { signingPlan } = createRequire(import.meta.url)('../apps/desktop/signing.cjs') as {
  signingPlan(env: Record<string, string | undefined>): { windows: boolean; mac: boolean; notarize: boolean };
};

describe('signingPlan', () => {
  it('is entirely unsigned without credentials, including blank values', () => {
    expect(signingPlan({})).toEqual({ windows: false, mac: false, notarize: false });
    expect(signingPlan({ CSC_LINK: '', CSC_KEY_PASSWORD: '  ', WIN_CSC_LINK: '' })).toEqual({ windows: false, mac: false, notarize: false });
  });

  it('needs both the certificate and its password', () => {
    expect(signingPlan({ WIN_CSC_LINK: 'x' }).windows).toBe(false);
    expect(signingPlan({ WIN_CSC_LINK: 'x', WIN_CSC_KEY_PASSWORD: 'y' }).windows).toBe(true);
    expect(signingPlan({ CSC_LINK: 'x' }).mac).toBe(false);
    expect(signingPlan({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y' }).mac).toBe(true);
  });

  it('only notarizes a signed app, with a complete set of Apple credentials', () => {
    const apple = { APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' };
    expect(signingPlan(apple).notarize).toBe(false);
    expect(signingPlan({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y', APPLE_ID: 'a' }).notarize).toBe(false);
    expect(signingPlan({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y', ...apple }).notarize).toBe(true);
    expect(signingPlan({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y', APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' }).notarize).toBe(true);
  });
});

describe('verify-signing', () => {
  it('maps Authenticode statuses, treating anything but Valid/NotSigned as invalid', () => {
    expect(interpretAuthenticode('Valid\r\n').status).toBe('signed');
    expect(interpretAuthenticode('NotSigned').status).toBe('unsigned');
    expect(interpretAuthenticode('HashMismatch').status).toBe('invalid');
    expect(interpretAuthenticode('').status).toBe('invalid');
  });

  it('never calls an AppImage signed', () => {
    expect(verifySigning('linux', 'x.AppImage').status).toBe('unsigned');
  });

  it('fails an expectation that is not met, and always fails an invalid signature', () => {
    const signed = { status: 'signed', notarized: false, detail: 'd' } as const;
    expect(checkExpectation(signed, { expect: 'signed' })).toEqual([]);
    expect(checkExpectation(signed, { expect: 'signed', expectNotarized: true })).toHaveLength(1);
    expect(checkExpectation({ ...signed, status: 'unsigned' }, { expect: 'signed' })).toHaveLength(1);
    expect(checkExpectation({ ...signed, status: 'invalid' }, {})).toHaveLength(1);
    expect(checkExpectation({ ...signed, status: 'unsigned' }, {})).toEqual([]);
  });
});
