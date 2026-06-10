import type { FastifyRequest } from 'fastify';
import type { DatabasePool } from '../../../packages/db/src/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  jti: string;
}

export interface AppContext {
  pool: DatabasePool;
  jwtSecret: string;
  redisUrl: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthenticatedUser;
}

export type CollaboratorRole = 'owner' | 'admin' | 'member';
