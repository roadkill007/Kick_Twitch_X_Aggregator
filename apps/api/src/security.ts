import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type * as Bcrypt from 'bcryptjs';
import type * as JsonWebToken from 'jsonwebtoken';
import type { AuthenticatedUser } from './types.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs') as typeof Bcrypt;
const jwt = require('jsonwebtoken') as typeof JsonWebToken;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function signJwt(input: { userId: string; email: string; jwtSecret: string; expiresInSeconds?: number }) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: input.userId, email: input.email },
    input.jwtSecret,
    { jwtid: jti, expiresIn: input.expiresInSeconds ?? 604800 },
  );
  return { token, jti };
}

export function verifyJwt(token: string, jwtSecret: string): AuthenticatedUser {
  const payload = jwt.verify(token, jwtSecret) as JsonWebToken.JwtPayload;
  if (!payload.sub || !payload.email || !payload.jti) {
    throw new Error('Invalid token payload');
  }
  return { id: String(payload.sub), email: String(payload.email), jti: String(payload.jti) };
}
