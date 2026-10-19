// Phase 1 migration (docs/PHASES.md): introduce the delivery-workflow
// collections without touching how existing tasks run.
//   • creates the new collections' indexes
//   • marks every pre-workflow Task (no workItemId) as `legacy: true`, so the
//     old task pages keep working and new workflow views can tell them apart
// Nothing is deleted. `apply:false` only reports. Reversible: `revert(backup)`
// restores each task's previous `legacy` value from the backup taken on apply.
import { Task, AuditLog, ClientRequest, RequirementSpec, CeoDecision, ProjectPlan, WorkItem, Deliverable, ClientFeedback } from '../../models/index.js';

export const MIGRATION_ID = 'workflow-v1';
const NEW_MODELS = [ClientRequest, RequirementSpec, CeoDecision, ProjectPlan, WorkItem, Deliverable, ClientFeedback];
const actor = { kind: 'system', id: `migration:${MIGRATION_ID}` };

// `writeBackup(backup)` runs BEFORE any write; if it throws, nothing changes.
export async function migrateWorkflowV1({ apply = false, now = new Date(), writeBackup } = {}) {
  const candidates = await Task.find({ workItemId: null, legacy: { $ne: true } }).select('_id organizationId legacy').lean();
  const report = { migration: MIGRATION_ID, apply, tasksToMarkLegacy: candidates.length, collections: NEW_MODELS.map((m) => m.collection.collectionName) };
  if (!apply) return report;
  const backup = { migration: MIGRATION_ID, at: now.toISOString(), tasks: candidates.map((t) => ({ _id: String(t._id), legacy: t.legacy ?? null })) };
  const backupRef = writeBackup ? await writeBackup(backup) : null;
  for (const m of NEW_MODELS) await m.createIndexes();
  const res = candidates.length ? await Task.updateMany({ _id: { $in: candidates.map((t) => t._id) }, workItemId: null }, { $set: { legacy: true } }) : { modifiedCount: 0 };
  const orgs = [...new Set(candidates.map((t) => String(t.organizationId)))];
  for (const organizationId of orgs) {
    await AuditLog.create({ organizationId, actor, action: 'migration.apply', target: MIGRATION_ID, details: { tasksMarkedLegacy: candidates.filter((t) => String(t.organizationId) === organizationId).length } });
  }
  if (!orgs.length) await AuditLog.create({ actor, action: 'migration.apply', target: MIGRATION_ID, details: { tasksMarkedLegacy: 0 } });
  return { ...report, tasksMarkedLegacy: res.modifiedCount || 0, backup, backupRef };
}

export async function revertWorkflowV1(backup) {
  if (backup?.migration !== MIGRATION_ID || !Array.isArray(backup.tasks)) throw new Error(`not a ${MIGRATION_ID} backup`);
  let restored = 0;
  for (const t of backup.tasks) {
    const res = await Task.updateOne({ _id: t._id }, t.legacy === null ? { $unset: { legacy: '' } } : { $set: { legacy: t.legacy } });
    restored += res.modifiedCount || 0;
  }
  await AuditLog.create({ actor, action: 'migration.revert', target: MIGRATION_ID, details: { tasksRestored: restored } });
  return { restored };
}
