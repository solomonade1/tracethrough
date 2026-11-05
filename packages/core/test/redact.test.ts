import { describe, expect, it } from 'vitest';
import { DEFAULT_REDACTION_POLICY, MASK, createRedactor } from '../src/index.ts';

const r = createRedactor();
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('headers', () => {
  it('masks auth and cookie headers but keeps useful structure', () => {
    const { value, redacted } = r.headers({
      Authorization: 'Bearer abc.def.ghi-secret',
      cookie: 'sid=s3cr3t; theme=dark',
      'set-cookie': 'sid=s3cr3t; Path=/; HttpOnly\nlang=en; Path=/',
      'X-Api-Key': 'k-123',
      'x-custom-session-id': 'abc',
      'content-type': 'application/json',
    });
    expect(redacted).toBe(true);
    expect(value).toEqual({
      Authorization: `Bearer ${MASK}`,
      cookie: `sid=${MASK}; theme=${MASK}`,
      'set-cookie': `sid=${MASK}; Path=/; HttpOnly\nlang=${MASK}; Path=/`,
      'X-Api-Key': MASK,
      'x-custom-session-id': MASK,
      'content-type': 'application/json',
    });
  });

  it('scrubs JWTs in otherwise innocent headers', () => {
    const { value } = r.headers({ 'x-forwarded-thing': `v=${JWT}` });
    expect(value['x-forwarded-thing']).toBe(`v=${MASK}`);
  });

  it('reports no redaction for clean headers', () => {
    expect(r.headers({ accept: '*/*' }).redacted).toBe(false);
  });
});

describe('url', () => {
  it('masks sensitive query keys, userinfo and fragment tokens', () => {
    const { value, redacted } = r.url(
      'https://user:pw@api.example.com/v1/items?page=2&api_key=xyz&Access_Token=t#access_token=abc&state=1',
    );
    expect(redacted).toBe(true);
    expect(value).toBe(
      `https://${MASK}@api.example.com/v1/items?page=2&api_key=${MASK}&Access_Token=${MASK}#access_token=${MASK}&state=1`,
    );
  });

  it('masks OAuth code and percent-encoded keys', () => {
    expect(r.url('https://x.test/cb?code=abc&pass%77ord=1').value).toBe(
      `https://x.test/cb?code=${MASK}&pass%77ord=${MASK}`,
    );
  });

  it('scrubs JWTs in path segments', () => {
    expect(r.url(`https://x.test/reset/${JWT}`).value).toBe(`https://x.test/reset/${MASK}`);
  });

  it('leaves clean URLs untouched', () => {
    const u = 'https://example.com/a/b?q=hello%20world&page=1';
    expect(r.url(u)).toEqual({ value: u, redacted: false });
  });

  it('does not throw on invalid URLs', () => {
    expect(r.url('not a url').value).toBe('not a url');
  });
});

describe('body', () => {
  it('masks sensitive JSON keys at any depth, including whole sub-objects', () => {
    const input = JSON.stringify({
      user: { name: 'Ada', password: 'hunter2', profile: { ssn: '1' } },
      session: { id: 'x', expires: 1 },
      items: [{ cardNumber: '4111', label: 'ok' }],
      note: `token is ${JWT}`,
      author: 'kept',
    });
    const { value, redacted } = r.body(input, 'application/json');
    expect(redacted).toBe(true);
    expect(JSON.parse(value)).toEqual({
      user: { name: 'Ada', password: MASK, profile: { ssn: MASK } },
      session: MASK,
      items: [{ cardNumber: MASK, label: 'ok' }],
      note: `token is ${MASK}`,
      author: 'kept',
    });
  });

  it('applies configured JSON paths with wildcards', () => {
    const custom = createRedactor({
      ...DEFAULT_REDACTION_POLICY,
      jsonPaths: ['customers.*.email'],
    });
    const { value } = custom.body(
      JSON.stringify({ customers: [{ email: 'a@x.test', plan: 'pro' }], email: 'top@x.test' }),
      'application/json',
    );
    expect(JSON.parse(value)).toEqual({ customers: [{ email: MASK, plan: 'pro' }], email: 'top@x.test' });
  });

  it('redacts truncated JSON including an unterminated trailing secret', () => {
    const { value } = r.body('{"ok":true,"apiKey":"abc","nested":{"password":"hun', 'application/json');
    expect(value).not.toContain('abc');
    expect(value).not.toContain('hun');
    expect(value).toContain(`"apiKey":"${MASK}"`);
  });

  it('redacts form-urlencoded bodies', () => {
    expect(r.body('username=ada&password=hunter2', 'application/x-www-form-urlencoded').value).toBe(
      `username=ada&password=${MASK}`,
    );
  });

  it('masks secrets assigned in inline scripts and embedded URLs', () => {
    const js = `const cfg = { apiKey: "k1", "client_secret": 'k2', name: "kept" }; let token = \`k3\`; fetch('/x?access_token=k4&page=1');`;
    const { value, redacted } = r.body(js, 'application/javascript');
    expect(redacted).toBe(true);
    expect(value).toBe(
      `const cfg = { apiKey: "${MASK}", "client_secret": '${MASK}', name: "kept" }; let token = \`${MASK}\`; fetch('/x?access_token=${MASK}&page=1');`,
    );
  });

  it('masks CSRF tokens in HTML inputs and meta tags', () => {
    const html =
      '<meta name="csrf-token" content="abc123"><input type="hidden" name="authenticity_token" value="zzz"><input name="q" value="hi">';
    const { value } = r.body(html, 'text/html');
    expect(value).toBe(
      `<meta name="csrf-token" content="${MASK}"><input type="hidden" name="authenticity_token" value="${MASK}"><input name="q" value="hi">`,
    );
  });
});

describe('masking off', () => {
  const off = createRedactor(false);

  it('keeps headers, URLs and bodies exactly as captured', () => {
    expect(off.masking).toBe(false);
    expect(r.masking).toBe(true);
    const headers = { authorization: `Bearer ${JWT}`, cookie: 'sid=s3cr3t', 'x-api-key': 'k' };
    expect(off.headers(headers)).toEqual({ value: headers, redacted: false });
    expect(off.url('https://u:p@example.test/a?token=t#access_token=x')).toEqual({
      value: 'https://u:p@example.test/a?token=t#access_token=x',
      redacted: false,
    });
    // Not re-serialized either: formatting is kept.
    const json = '{ "password": "hunter2",\n  "n": 1 }';
    expect(off.body(json, 'application/json')).toEqual({ value: json, redacted: false });
  });
});
