import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { AlbJwtVerifier } from 'aws-jwt-verify';
import { isValidEmail } from './utils.js';

// Single sign-on through a trusted reverse proxy (contract section 4a).
//
// Mode "alb": an AWS Application Load Balancer with an authenticate action
// has already sent the user through the identity provider. It forwards the
// user claims as a signed JWT in the x-amzn-oidc-data header. The api
// verifies that JWT (signature against the regional ELB public key, signer
// equal to the configured load balancer ARN, expiry) with AWS's own library,
// then finds or creates the user by e-mail and issues its normal token pair.
//
// This module imports neither env.js nor db.js (the database query is passed
// in), so the unit tests can exercise it without a configured environment.

export const ALB_ARN_PATTERN = /^arn:aws:elasticloadbalancing:[a-z0-9-]+:\d{12}:loadbalancer\/app\/[^/]+\/[0-9a-f]+$/;

export function parseAdminList(value) {
  return value
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function roleForEmail(email, admins) {
  return admins.includes(email.toLowerCase()) ? 'admin' : 'user';
}

export function createAlbVerifier({ albArn, jwksUri }) {
  // issuer and clientId are null on purpose: the pinned load balancer ARN
  // already decides which identity provider configuration is trusted.
  return AlbJwtVerifier.create({ albArn, issuer: null, clientId: null, ...(jwksUri ? { jwksUri } : {}) });
}

// Finds the user for a verified identity or creates it. A user created this
// way gets an unusable random password hash: the password login stays
// closed for SSO accounts. An existing user listed as admin is promoted;
// nobody is demoted here, the list only adds.
export async function upsertSsoUser({ email, admins, bcryptCost, query }) {
  const role = roleForEmail(email, admins);
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), bcryptCost);
  const { rows: [user] } = await query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
     ON CONFLICT (lower(email)) DO UPDATE
       SET role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE users.role END
     RETURNING id, email, role`,
    [email, passwordHash, role], 'sso_user_upsert',
  );
  return user;
}

// Express handler factory for GET /auth/sso.
export function createSsoHandler({ verifier, admins, bcryptCost, query, signTokens, onFailure, log }) {
  return async (req, res) => {
    const data = req.headers['x-amzn-oidc-data'];
    if (typeof data !== 'string' || !data) {
      onFailure?.();
      return res.status(401).json({ error: 'No identity from the trusted proxy' });
    }
    let claims;
    try {
      claims = await verifier.verify(data);
    } catch (err) {
      onFailure?.();
      (log ?? req.log)?.warn({ reason: err.message }, 'rejected proxy identity');
      return res.status(401).json({ error: 'Identity from the trusted proxy could not be verified' });
    }
    const email = typeof claims.email === 'string' ? claims.email.trim() : '';
    if (!isValidEmail(email)) {
      onFailure?.();
      return res.status(401).json({ error: 'Identity from the trusted proxy has no e-mail address' });
    }
    const user = await upsertSsoUser({ email, admins, bcryptCost, query });
    res.json({ ...signTokens(user), userId: user.id, role: user.role, email: user.email });
  };
}
