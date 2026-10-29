// Startup checks that env.js runs and the unit tests import on their own
// (env.js itself exits the process when required variables are missing).

const ALB_ARN = /^arn:aws:elasticloadbalancing:[a-z0-9-]+:\d{12}:loadbalancer\/app\/[^/]+\/[0-9a-f]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Single sign-on through a trusted proxy: only checked when the mode is on.
export function trustedProxyProblems({ AUTH_TRUSTED_PROXY, AUTH_TRUSTED_PROXY_SIGNER, AUTH_TRUSTED_PROXY_ADMINS }) {
  if (AUTH_TRUSTED_PROXY !== 'alb') return [];
  const out = [];
  if (!ALB_ARN.test(AUTH_TRUSTED_PROXY_SIGNER)) {
    out.push('AUTH_TRUSTED_PROXY_SIGNER must be the ARN of an application load balancer (arn:aws:elasticloadbalancing:<region>:<account>:loadbalancer/app/<name>/<id>) when AUTH_TRUSTED_PROXY=alb');
  }
  const admins = AUTH_TRUSTED_PROXY_ADMINS.split(',').map(s => s.trim()).filter(Boolean);
  if (admins.length === 0) {
    out.push('AUTH_TRUSTED_PROXY_ADMINS must list at least one e-mail address when AUTH_TRUSTED_PROXY=alb');
  }
  for (const a of admins) {
    if (!EMAIL.test(a)) out.push(`AUTH_TRUSTED_PROXY_ADMINS entry "${a}" is not an e-mail address`);
  }
  return out;
}
