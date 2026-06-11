import type { FastifyRequest } from 'fastify';
import type { DatabasePool } from '../../../packages/db/src/index.js';
import type { ProviderRuntimeController } from './provider-runtime.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  jti: string;
}

export interface AppContext {
  pool: DatabasePool;
  jwtSecret: string;
  redisUrl: string;
  appPublicUrl: string;
  webPublicUrl?: string;
  twitch?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  providerRuntime?: ProviderRuntimeController;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthenticatedUser;
}

export type CollaboratorRole = 'owner' | 'admin' | 'member';
