import type { DatabasePool } from '../../../packages/db/src/index.js';
import type { CollaboratorRole } from './types.js';

export async function getActiveCollaborator(pool: DatabasePool, sharedSessionId: string, userId: string) {
  const result = await pool.query<{ id: string; role: CollaboratorRole }>(
    `SELECT id, role FROM collaborators
     WHERE shared_session_id = $1 AND user_id = $2 AND status = 'active'
     LIMIT 1`,
    [sharedSessionId, userId],
  );
  return result.rows[0] ?? null;
}

export async function requireSessionAccess(pool: DatabasePool, sharedSessionId: string, userId: string) {
  const collaborator = await getActiveCollaborator(pool, sharedSessionId, userId);
  if (!collaborator) throw new Error('Forbidden');
  return collaborator;
}

export async function requireSessionManager(pool: DatabasePool, sharedSessionId: string, userId: string) {
  const collaborator = await requireSessionAccess(pool, sharedSessionId, userId);
  if (!['owner', 'admin'].includes(collaborator.role)) throw new Error('Forbidden');
  return collaborator;
}
