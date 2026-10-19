// Phase 1 workflow migration. DRY RUN by default.
//   npm run migrate:workflow -w server                     # report only
//   npm run migrate:workflow -w server -- --apply          # backup to .data-backups/, then apply
//   npm run migrate:workflow -w server -- --revert <file>  # undo using that backup
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { APP_ROOT } from '../src/services/workspaces.js';
import { migrateWorkflowV1, revertWorkflowV1 } from '../src/services/migrations/workflowV1.js';

const args = process.argv.slice(2);
await connectDb();
try {
  if (args.includes('--revert')) {
    const file = args[args.indexOf('--revert') + 1];
    if (!file) throw new Error('--revert needs the backup file path');
    const result = await revertWorkflowV1(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(`reverted: ${result.restored} task(s) restored from ${path.basename(file)}`);
  } else {
    const apply = args.includes('--apply');
    const writeBackup = (backup) => {
      const dir = path.join(APP_ROOT, '.data-backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `migrate-workflow-${backup.at.replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify(backup, null, 2));
      return file;
    };
    const result = await migrateWorkflowV1({ apply, writeBackup });
    console.log(`${apply ? '' : '(dry run) '}tasks to mark legacy: ${result.tasksToMarkLegacy}`);
    console.log(`collections: ${result.collections.join(', ')}`);
    if (apply) {
      console.log(`marked legacy: ${result.tasksMarkedLegacy}; backup written first: .data-backups/${path.basename(result.backupRef)}`);
    } else {
      console.log('Dry run only. Re-run with --apply (a backup is written first; undo with --revert <file>).');
    }
  }
} finally {
  await mongoose.disconnect();
}
