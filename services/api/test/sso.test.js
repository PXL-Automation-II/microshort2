import { describe, it, expect, vi } from 'vitest';
import { ALB_ARN_PATTERN, createAlbVerifier, createSsoHandler, parseAdminList, roleForEmail } from '../src/sso.js';
import { trustedProxyProblems } from '../src/env-checks.js';

const ALB_ARN = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/staging-microshort2/0123456789abcdef';

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  return res;
}

describe('admin list', () => {
  it('parses, trims and lower-cases the list', () => {
    expect(parseAdminList(' Admin@Example.test , ops@example.test,,')).toEqual(['admin@example.test', 'ops@example.test']);
  });
  it('maps listed addresses to admin regardless of case', () => {
    const admins = parseAdminList('admin@example.test');
    expect(roleForEmail('ADMIN@example.test', admins)).toBe('admin');
    expect(roleForEmail('someone@example.test', admins)).toBe('user');
  });
});

describe('configuration checks', () => {
  it('does nothing when the mode is off', () => {
    expect(trustedProxyProblems({ AUTH_TRUSTED_PROXY: '', AUTH_TRUSTED_PROXY_SIGNER: '', AUTH_TRUSTED_PROXY_ADMINS: '' })).toEqual([]);
  });
  it('requires a load balancer ARN and at least one admin in alb mode', () => {
    const problems = trustedProxyProblems({ AUTH_TRUSTED_PROXY: 'alb', AUTH_TRUSTED_PROXY_SIGNER: 'not-an-arn', AUTH_TRUSTED_PROXY_ADMINS: '' });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/AUTH_TRUSTED_PROXY_SIGNER/);
    expect(problems[1]).toMatch(/AUTH_TRUSTED_PROXY_ADMINS/);
  });
  it('rejects a non-address in the admin list', () => {
    const problems = trustedProxyProblems({ AUTH_TRUSTED_PROXY: 'alb', AUTH_TRUSTED_PROXY_SIGNER: ALB_ARN, AUTH_TRUSTED_PROXY_ADMINS: 'admin@example.test, nope' });
    expect(problems).toEqual([expect.stringMatching(/"nope"/)]);
  });
  it('accepts a well-formed setup', () => {
    expect(ALB_ARN_PATTERN.test(ALB_ARN)).toBe(true);
    expect(trustedProxyProblems({ AUTH_TRUSTED_PROXY: 'alb', AUTH_TRUSTED_PROXY_SIGNER: ALB_ARN, AUTH_TRUSTED_PROXY_ADMINS: 'admin@example.test' })).toEqual([]);
  });
});

describe('GET /auth/sso handler', () => {
  const base = { admins: ['admin@example.test'], bcryptCost: 4, signTokens: () => ({ token: 't', refreshToken: 'r' }) };

  it('answers 401 without the proxy header and counts the failure', async () => {
    const onFailure = vi.fn();
    const handler = createSsoHandler({ ...base, verifier: createAlbVerifier({ albArn: ALB_ARN }), onFailure });
    const res = fakeRes();
    await handler({ headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/no identity/i);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('answers 401 when the header is not a token the verifier accepts', async () => {
    const onFailure = vi.fn();
    const handler = createSsoHandler({ ...base, verifier: createAlbVerifier({ albArn: ALB_ARN }), onFailure });
    const res = fakeRes();
    await handler({ headers: { 'x-amzn-oidc-data': 'not.a.jwt' } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/could not be verified/i);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('answers 401 when the verified claims carry no e-mail address', async () => {
    const verifier = { verify: async () => ({ sub: 'abc' }) };
    const handler = createSsoHandler({ ...base, verifier });
    const res = fakeRes();
    await handler({ headers: { 'x-amzn-oidc-data': 'x' } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/e-mail/i);
  });
});
