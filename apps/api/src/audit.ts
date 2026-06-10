import type { DatabasePool } from '../../../packages/db/src/index.js';

export async function writeAuditLog(input: {
  pool: DatabasePool;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await input.pool.query(
    `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.requestId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
