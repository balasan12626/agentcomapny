// Seeds the platform agent catalog (organizationId=null) from catalog/*.json.
// Idempotent: upserts agents; creates a new PUBLISHED version only when the
// definition hash changes. No tenant data or metrics are seeded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Agent, AgentVersion } from '../src/models/index.js';
import { payloadHash } from '../src/core/canonical.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog/agents.json'), 'utf8'));
const departments = JSON.parse(fs.readFileSync(path.join(root, 'catalog/departments.json'), 'utf8'));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

const defs = [...catalog.agents];
for (const [department, names] of Object.entries(departments)) {
  if (department.startsWith('$')) continue;
  for (const name of names) {
    const slug = slugify(name);
    if (!defs.some((d) => d.slug === slug)) defs.push({ slug, name, department, type: 'SPECIALIST', tools: 'readonly', mission: `${name} for ${department}.`, watches: ['UserRequirement'], produces: [`${slug}-report`], skills: [] });
  }
}

await connectDb();
for (const d of defs) {
  const agent = await Agent.findOneAndUpdate({ organizationId: null, slug: d.slug }, { $set: { name: d.name, department: d.department, type: d.type } }, { upsert: true, new: true });
  const body = { instructions: fs.existsSync(path.join(root, `.claude/agents/${d.slug}.md`)) ? fs.readFileSync(path.join(root, `.claude/agents/${d.slug}.md`), 'utf8') : d.mission, watches: d.watches, produces: d.produces, skills: d.skills.map((slug) => ({ slug })), allowedTools: catalog.toolsets[d.tools] };
  const hash = payloadHash(body);
  const latest = await AgentVersion.findOne({ agentId: agent._id }).sort({ version: -1 });
  if (latest?.hash === hash) continue;
  const version = (latest?.version || 0) + 1;
  await AgentVersion.create({ agentId: agent._id, version, status: 'PUBLISHED', hash, ...body });
  await Agent.updateOne({ _id: agent._id }, { publishedVersion: version });
}
console.log(`catalog seeded: ${defs.length} agents`);
await mongoose.disconnect();
