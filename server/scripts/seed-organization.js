// Seeds the canonical company hierarchy (catalog/organization.mjs) into MongoDB
// as the platform catalogue (organizationId=null): 10 departments, 50 core
// roles, 100 sub-agents and the Founder/CEO. Idempotent: upserts agents and
// departments; creates a new PUBLISHED AgentVersion only when the hash changes.
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Agent, AgentVersion, Department } from '../src/models/index.js';
import { payloadHash } from '../src/core/canonical.js';
import { departments, departmentHeads, coreRoles, subAgents, workflowRoles, allAgents } from '../../catalog/organization.mjs';

const TOOLSETS = { readonly: ['Read', 'Grep', 'Glob'], review: ['Read', 'Grep', 'Glob', 'Bash'], build: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'] };

await connectDb();

// Departments
let d = 0;
for (const [i, dep] of departments.entries()) {
  await Department.findOneAndUpdate(
    { organizationId: null, slug: dep.slug },
    { $set: { name: dep.name, head: dep.head, order: i } },
    { upsert: true, new: true });
  d += 1;
}

// Agents (executive + core roles + sub-agents)
let created = 0, bumped = 0;
for (const a of allAgents()) {
  const agent = await Agent.findOneAndUpdate(
    { organizationId: null, slug: a.slug },
    { $set: {
      name: a.name, department: a.department, type: a.type, kind: a.kind,
      departmentSlug: a.departmentSlug ?? null, headSlug: a.headSlug ?? null,
      parentSlug: a.coreRoleSlug ?? null, subAgentSlugs: a.subAgentSlugs,
      coordinates: a.coordinates, enabled: a.enabled !== false,
    } },
    { upsert: true, new: true });
  if (agent.$isNew || agent.wasNew) created += 1;

  const body = {
    instructions: [
      a.mission,
      ...(a.responsibilities?.length ? [`Responsibilities:\n${a.responsibilities.map((item) => `- ${item}`).join('\n')}`] : []),
      ...(a.never?.length ? [`Never:\n${a.never.map((item) => `- ${item}`).join('\n')}`] : []),
    ].join('\n\n'),
    watches: a.inputs || [],
    produces: (a.outputs || []).map((o) => (typeof o === 'string' ? o : o.artifact)),
    skills: (a.skills || []).map((slug) => ({ slug })),
    allowedTools: TOOLSETS[a.tools] || TOOLSETS.readonly,
  };
  const hash = payloadHash(body);
  const latest = await AgentVersion.findOne({ agentId: agent._id }).sort({ version: -1 });
  if (latest?.hash === hash) continue;
  const version = (latest?.version || 0) + 1;
  await AgentVersion.create({ agentId: agent._id, version, status: 'PUBLISHED', hash, ...body });
  await Agent.updateOne({ _id: agent._id }, { publishedVersion: version });
  bumped += 1;
}

const total = 1 + departmentHeads.length + coreRoles.length + subAgents.length;
console.log(`organization seeded: ${d} departments, ${total} agents (${departmentHeads.length} department heads, ${coreRoles.length} core roles, ${subAgents.length} sub-agents, 1 executive) + ${workflowRoles.length} workflow role(s) (${workflowRoles.map((r) => r.slug).join(', ')}); versions written/bumped: ${bumped}`);
await mongoose.disconnect();
