import { AuditLog } from '../models/index.js';
import { redactDeep } from '../core/redact.js';

export function audit({ organizationId, actor, action, target, requestId, details }) {
  return AuditLog.create({ organizationId, actor, action, target, requestId, details: redactDeep(details) });
}
