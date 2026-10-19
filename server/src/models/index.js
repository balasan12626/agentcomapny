import mongoose from 'mongoose';
import { TASK_STATES } from '../core/taskStateMachine.js';
import { ROLES } from '../core/permissions.js';
import { FINDING_STATES } from '../core/bugBountyScope.js';

const { Schema } = mongoose;
const Id = Schema.Types.ObjectId;
const opts = { timestamps: true };
// Every tenant-owned record carries organizationId; queries must include it.
const org = { type: Id, ref: 'Organization', required: true, index: true };
const usage = { inputTokens: Number, outputTokens: Number, cacheReadTokens: Number, cacheCreationTokens: Number, costUsd: Number, turns: Number };

function model(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

export const Organization = model('Organization', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9-]{2,64}$/ },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  budgets: { maxTokensPerTask: Number, maxCostUsdPerTask: Number, maxConcurrentTasks: { type: Number, default: 3 } },
}, opts));

export const User = model('User', new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: String,
  passwordHash: { type: String, select: false },
  platformRole: { type: String, enum: ['PLATFORM_OWNER', null], default: null },
}, opts));

const membershipSchema = new Schema({
  organizationId: org,
  userId: { type: Id, ref: 'User', required: true },
  role: { type: String, enum: ROLES, required: true },
  projectIds: [{ type: Id, ref: 'Project' }],
}, opts);
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
export const Membership = model('Membership', membershipSchema);

export const Client = model('Client', new Schema({ organizationId: org, name: { type: String, required: true } }, opts));

const projectSchema = new Schema({
  organizationId: org,
  clientId: { type: Id, ref: 'Client' },
  name: { type: String, required: true },
  workspace: { allowedRoots: [String], deniedPatterns: [String], deviceIds: [{ type: Id, ref: 'RegisteredDevice' }] },
}, opts);
projectSchema.index({ organizationId: 1, name: 1 }, { unique: true });
export const Project = model('Project', projectSchema);

export const RegisteredDevice = model('RegisteredDevice', new Schema({
  organizationId: org,
  name: String,
  credentialHash: { type: String, required: true, select: false }, // never the raw secret
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
  projectIds: [{ type: Id, ref: 'Project' }],
  lastHeartbeatAt: Date,
}, opts));

// Company org chart: departments (platform catalogue when organizationId=null).
const departmentSchema = new Schema({
  organizationId: { type: Id, ref: 'Organization', default: null, index: true },
  slug: { type: String, required: true, match: /^[a-z0-9-]{2,64}$/ },
  name: { type: String, required: true },
  head: { slug: String, title: String },
  order: { type: Number, default: 0 },
}, opts);
departmentSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
export const Department = model('Department', departmentSchema);

const agentSchema = new Schema({
  organizationId: { type: Id, ref: 'Organization', default: null, index: true }, // null = platform catalog
  slug: { type: String, required: true, match: /^[a-z0-9-]{2,64}$/ },
  name: { type: String, required: true },
  department: { type: String, required: true },
  type: { type: String, enum: ['SPECIALIST', 'COORDINATOR', 'REVIEWER', 'BACKGROUND_WORKER', 'EXECUTIVE'], default: 'SPECIALIST' },
  enabled: { type: Boolean, default: true },
  publishedVersion: Number,
  // Company hierarchy (optional; set for the organization.mjs catalogue).
  kind: { type: String, enum: ['EXECUTIVE', 'CORE_ROLE', 'SUBAGENT', null], default: null, index: true },
  departmentSlug: { type: String, default: null, index: true },
  headSlug: { type: String, default: null },       // department head this role reports to
  parentSlug: { type: String, default: null, index: true }, // sub-agent -> its core role
  subAgentSlugs: { type: [String], default: undefined }, // core role -> its two sub-agents
  coordinates: { type: [String], default: undefined },   // executive -> department head slugs
}, opts);
agentSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
export const Agent = model('Agent', agentSchema);

const agentVersionSchema = new Schema({
  agentId: { type: Id, ref: 'Agent', required: true },
  version: { type: Number, required: true },
  status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'RETIRED'], default: 'DRAFT' },
  instructions: { type: String, maxlength: 20000 },
  watches: [String],
  produces: [String],
  skills: [{ slug: String, version: Number }],
  allowedTools: [String],
  deniedTools: [String],
  allowedPaths: [String],
  excludedPaths: [String],
  limits: { timeoutMs: Number, maxRetries: Number, maxTurns: Number, maxTokens: Number, maxCostUsd: Number },
  approvalRequiredFor: [String],
  createdBy: { type: Id, ref: 'User' },
  hash: String,
}, opts);
agentVersionSchema.index({ agentId: 1, version: 1 }, { unique: true });
export const AgentVersion = model('AgentVersion', agentVersionSchema);

const skillSchema = new Schema({
  organizationId: { type: Id, ref: 'Organization', default: null, index: true },
  slug: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  activeVersion: Number,
}, opts);
skillSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
export const Skill = model('Skill', skillSchema);

const skillVersionSchema = new Schema({
  skillId: { type: Id, ref: 'Skill', required: true },
  version: { type: Number, required: true },
  status: { type: String, enum: ['DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'DISABLED'], default: 'DRAFT' },
  content: { type: String, required: true },
  allowedTools: [String],
  quarantinedFiles: [String],
  hash: { type: String, required: true },
  source: { origin: String, license: String },
  createdBy: { type: Id, ref: 'User' },
  reviewedBy: { type: Id, ref: 'User' },
  rationale: String,
}, opts);
skillVersionSchema.index({ skillId: 1, version: 1 }, { unique: true });
export const SkillVersion = model('SkillVersion', skillVersionSchema);

const taskSchema = new Schema({
  organizationId: org,
  projectId: { type: Id, ref: 'Project', required: true },
  createdBy: { type: Id, ref: 'User', required: true },
  idempotencyKey: { type: String, required: true },
  instruction: { type: String, required: true, maxlength: 20000 },
  mode: { type: String, enum: ['QUICK', 'STANDARD', 'DEEP', 'PARALLEL', 'SCHEDULED'], default: 'STANDARD' },
  status: { type: String, enum: TASK_STATES, default: 'QUEUED', index: true },
  agents: [{ slug: String, version: Number }],
  plan: { stages: [[String]], edges: [{ from: String, to: String, artifact: String }] },
  acceptanceCriteria: [{ id: String, description: String, status: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING' }, evidence: String }],
  pendingApprovalIds: [{ type: Id, ref: 'Approval' }],
  budget: { maxTokens: Number, maxCostUsd: Number },
  usage,
  attempts: { type: Number, default: 0 },
  lastEventSeq: { type: Number, default: 0 },
  error: String,
}, opts);
taskSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });
taskSchema.index({ organizationId: 1, projectId: 1, status: 1, createdAt: -1 });
export const Task = model('Task', taskSchema);

const agentRunSchema = new Schema({
  organizationId: org,
  taskId: { type: Id, ref: 'Task', required: true, index: true },
  agentSlug: String,
  agentVersion: Number,
  stage: Number,
  status: { type: String, enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'AWAITING_APPROVAL'], default: 'QUEUED' },
  claudeSessionId: String,
  startedAt: Date,
  finishedAt: Date,
  usage,
  summary: String,
  error: String,
}, opts);
export const AgentRun = model('AgentRun', agentRunSchema);

const taskEventSchema = new Schema({
  organizationId: org,
  taskId: { type: Id, ref: 'Task', required: true },
  seq: { type: Number, required: true },
  agentRunId: { type: Id, ref: 'AgentRun' },
  kind: { type: String, required: true },
  data: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });
taskEventSchema.index({ taskId: 1, seq: 1 }, { unique: true });
// Retention: high-volume events expire after 30 days (configurable via migration).
taskEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
export const TaskEvent = model('TaskEvent', taskEventSchema);

export const Approval = model('Approval', new Schema({
  organizationId: org,
  taskId: { type: Id, ref: 'Task' },
  action: { type: String, required: true },
  target: { type: String, required: true },
  payloadHash: { type: String, required: true },
  requestedBy: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED', 'INVALIDATED'], default: 'PENDING', index: true },
  expiresAt: { type: Date, required: true },
  decidedBy: String,
  decidedAt: Date,
  consumedAt: Date,
}, opts));

export const UsageRecord = model('UsageRecord', new Schema({
  organizationId: org,
  taskId: { type: Id, ref: 'Task', index: true },
  agentRunId: { type: Id, ref: 'AgentRun' },
  source: { type: String, enum: ['claude-code'], default: 'claude-code' },
  usage,
}, opts));

export const Artifact = model('Artifact', new Schema({
  organizationId: org,
  taskId: { type: Id, ref: 'Task', index: true },
  kind: { type: String, enum: ['DIFF', 'REPORT', 'TEST_RESULT', 'LOG', 'FILE'] },
  storageRef: String, // object/file storage key — never inline large blobs
  sizeBytes: Number,
  sha256: String,
}, opts));

export const AuditLog = model('AuditLog', new Schema({
  organizationId: { type: Id, ref: 'Organization', index: true },
  actor: { kind: String, id: String },
  action: { type: String, required: true },
  target: String,
  requestId: String,
  details: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } }));

const scopeSchema = new Schema({
  organizationId: org,
  programName: String,
  programOwner: String,
  authorizedAssets: [String],
  excludedAssets: [String],
  permittedTests: [String],
  excludedTests: [String],
  windowStart: Date,
  windowEnd: Date,
  rateLimitPerMin: Number,
  dataHandling: String,
  stopConditions: String,
  escalationContact: String,
}, opts);
export const BugBountyScope = model('BugBountyScope', scopeSchema);

export const SecurityFinding = model('SecurityFinding', new Schema({
  organizationId: org,
  scopeId: { type: Id, ref: 'BugBountyScope', required: true },
  asset: { type: String, required: true },
  title: String,
  severity: { type: String, enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  severityRationale: String,
  confidence: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'] },
  status: { type: String, enum: FINDING_STATES, default: 'DISCOVERED' },
  evidenceRefs: [String],
  impact: String,
  remediation: String,
  ownerId: { type: Id, ref: 'User' },
  retestResult: String,
}, opts));
