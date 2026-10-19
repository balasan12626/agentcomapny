import mongoose from 'mongoose';
import { TASK_STATES } from '../core/taskStateMachine.js';
import { ROLES } from '../core/permissions.js';
import { FINDING_STATES } from '../core/bugBountyScope.js';
import { REQUEST_STATES, PLAN_STATES, WORK_ITEM_STATES, DELIVERABLE_STATES, BA_RECOMMENDATIONS, CEO_DECISIONS, PRIORITIES, FEATURE_PRIORITIES } from '../core/workflow.js';

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

export const Client = model('Client', new Schema({ organizationId: org, name: { type: String, required: true }, skillSlugs: { type: [String], default: [] } }, opts));

const projectSchema = new Schema({
  organizationId: org,
  clientId: { type: Id, ref: 'Client' },
  name: { type: String, required: true },
  skillSlugs: { type: [String], default: [] },
  workspace: { allowedRoots: [String], deniedPatterns: [String], deviceIds: [{ type: Id, ref: 'RegisteredDevice' }] },
  // Archived projects (e.g. old sandbox runs) keep their history but are
  // hidden from pickers and project lists by default.
  archivedAt: { type: Date, default: null },
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
  kind: { type: String, enum: ['EXECUTIVE', 'DEPARTMENT_HEAD', 'CORE_ROLE', 'SUBAGENT', null], default: null, index: true },
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
  // maxCostUsd = this agent's CFO-allocated share (hard per-run cap).
  agents: [{ slug: String, version: Number, maxCostUsd: Number }],
  projectSkills: [{ slug: String, version: Number, hash: String }],
  management: {
    departmentHeads: [{ slug: String, departmentSlug: String }],
    projectManager: { slug: String, departmentSlug: String },
  },
  plan: { stages: [[String]], edges: [{ from: String, to: String, artifact: String }] },
  // role: AGENT_RUN criterion owned by one agent's run; check: named AUTOMATED
  // verification the orchestrator evaluates (dependency_order, approvals).
  acceptanceCriteria: [{ id: String, description: String, verification: { type: String, enum: ['AGENT_RUN', 'AUTOMATED', 'HUMAN'], default: 'HUMAN' }, role: String, check: String, status: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING' }, evidence: String }],
  pendingApprovalIds: [{ type: Id, ref: 'Approval' }],
  budget: { maxTokens: Number, maxCostUsd: Number },
  usage,
  attempts: { type: Number, default: 0 },
  lastEventSeq: { type: Number, default: 0 },
  error: String,
  // Set when the stall sweeper (or a restarted worker) finds no worker moving
  // the task; `from` decides whether a restarted worker may resume it.
  stall: { from: String, at: Date, reason: String },
  cancelledAt: Date,
  // Per-agent chat: `kind:'chat'` tasks are a single specialist answering in a
  // thread; conversationId groups the thread and resumeSessionId continues the
  // agent's own Claude session so the chat keeps context across messages.
  kind: { type: String, enum: ['task', 'chat', 'workflow'], default: 'task' },
  conversationId: { type: String, index: true },
  resumeSessionId: String,
  // Workflow link: the WorkItem this execution attempt belongs to. Tasks from
  // before the workflow existed are marked legacy by the Phase 1 migration.
  workItemId: { type: Id, ref: 'WorkItem', index: true },
  legacy: { type: Boolean, default: false },
  // kind:'workflow' — one agent step of the delivery workflow (core/workflowSteps.js).
  // `outcome` is set once the worker validated and applied (or rejected) the output.
  workflow: {
    step: String, refId: String, requestId: { type: Id, ref: 'ClientRequest' }, agentSlug: String, attempt: Number,
    outcome: { type: String, enum: [null, 'APPLIED', 'INVALID', 'CANCELLED', 'SKIPPED'], default: null }, issues: [String], processedAt: Date,
  },
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

// Liveness of execution workers (platform-wide, not tenant data): each worker
// upserts its row every few seconds; the API reads it to report ONLINE/OFFLINE
// and to decide whether waiting tasks are stalled.
export const WorkerHeartbeat = model('WorkerHeartbeat', new Schema({
  workerId: { type: String, required: true, unique: true },
  host: String,
  pid: Number,
  startedAt: Date,
  lastSeenAt: { type: Date, required: true },
  concurrency: Number,
  activeJobs: Number,
}));

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

// ── IT-company delivery workflow (docs/PHASES.md, Phase 1) ───────────────
// Request → RequirementSpec (BA) → CeoDecision (human) → ProjectPlan (PM) →
// WorkItems (heads assign, specialists work, review + QA) → Deliverable.
// Every record is tenant- and client-scoped; statuses come from core/workflow.js
// and only change through services/workflow.js (history + audit).
const actorRef = { kind: { type: String, enum: ['user', 'agent', 'system'] }, id: String, role: String };
const historyEntry = new Schema({ from: String, status: String, by: actorRef, at: { type: Date, default: Date.now }, note: String }, { _id: false });
const clientScope = { type: Id, ref: 'Client', required: true, index: true };
const createdBy = { type: Id, ref: 'User' };

const clientRequestSchema = new Schema({
  organizationId: org,
  clientId: clientScope,
  projectId: { type: Id, ref: 'Project' },
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, required: true, maxlength: 20000 },
  attachments: [{ name: String, ref: String, sizeBytes: Number, _id: false }],
  submittedBy: actorRef,
  requestedPriority: { type: String, enum: PRIORITIES },
  desiredDeadline: Date,
  status: { type: String, enum: REQUEST_STATES, default: 'NEW', index: true },
  history: [historyEntry],
  currentSpecId: { type: Id, ref: 'RequirementSpec' },
  currentPlanId: { type: Id, ref: 'ProjectPlan' },
  // The CEO agent's advice for the human CEO (never the decision itself).
  ceoBrief: { summary: String, risks: [String], recommendedBudgetUSD: Number, recommendedPriority: String, recommendation: String, rationale: String, specVersion: Number, taskId: { type: Id, ref: 'Task' }, at: Date },
  // Simulated clients (docs/PHASES.md Part B) are always flagged as demo data.
  source: { type: String, enum: ['HUMAN', 'CLIENT_AGENT'], default: 'HUMAN' },
  isDemo: { type: Boolean, default: false, index: true },
  demoScenarioId: { type: Id, ref: 'DemoScenario' },
  createdBy,
}, opts);
clientRequestSchema.index({ organizationId: 1, clientId: 1, status: 1, createdAt: -1 });
export const ClientRequest = model('ClientRequest', clientRequestSchema);

const requirementSpecSchema = new Schema({
  organizationId: org,
  clientId: clientScope,
  requestId: { type: Id, ref: 'ClientRequest', required: true },
  version: { type: Number, required: true },
  hash: { type: String, required: true },
  summary: String,
  businessGoal: String,
  targetUsers: [String],
  scope: { inScope: [String], outOfScope: [String] },
  features: [{ id: String, title: String, description: String, priority: { type: String, enum: FEATURE_PRIORITIES }, _id: false }],
  acceptanceCriteria: [{ id: String, featureId: String, criterion: String, testMethod: String, _id: false }],
  clarifyingQuestions: [{ id: String, question: String, answer: String, answeredBy: actorRef, answeredAt: Date, _id: false }],
  risks: [String],
  assumptions: [String],
  estimate: { effortHours: Number, costUSD: Number, durationDays: Number, departmentsNeeded: [String] },
  baRecommendation: { type: String, enum: BA_RECOMMENDATIONS },
  baReason: String,
  writtenBy: actorRef,
  agentRunIds: [{ type: Id, ref: 'AgentRun' }],
  createdBy,
}, opts);
requirementSpecSchema.index({ organizationId: 1, requestId: 1, version: -1 }, { unique: true });
export const RequirementSpec = model('RequirementSpec', requirementSpecSchema);

export const CeoDecision = model('CeoDecision', new Schema({
  organizationId: org,
  clientId: clientScope,
  requestId: { type: Id, ref: 'ClientRequest', required: true, index: true },
  specId: { type: Id, ref: 'RequirementSpec', required: true },
  specVersion: { type: Number, required: true },
  // Bound to the exact spec content (core/workflow.js specHash).
  specHash: { type: String, required: true },
  decision: { type: String, enum: CEO_DECISIONS, required: true },
  approvedBudgetUSD: Number,
  priority: { type: String, enum: PRIORITIES },
  deadline: Date,
  notes: String,
  // Always a human user: the service never accepts an agent here.
  decidedBy: { type: Id, ref: 'User', required: true },
  decidedByRole: { type: String, required: true },
  decidedAt: { type: Date, default: Date.now },
  // The CEO agent's brief the human saw, if any (advice, never the decision).
  briefRunId: { type: Id, ref: 'AgentRun' },
}, opts));

const projectPlanSchema = new Schema({
  organizationId: org,
  clientId: clientScope,
  requestId: { type: Id, ref: 'ClientRequest', required: true, index: true },
  projectId: { type: Id, ref: 'Project', required: true },
  decisionId: { type: Id, ref: 'CeoDecision' },
  version: { type: Number, required: true },
  milestones: [{ id: String, title: String, dueDate: Date, _id: false }],
  tasks: [{ id: String, title: String, description: String, departmentSlug: String, requiredRole: String, dependsOn: [String], acceptanceCriteriaIds: [String], estimateHours: Number, budgetUSD: Number, milestoneId: String, _id: false }],
  status: { type: String, enum: PLAN_STATES, default: 'DRAFT' },
  history: [historyEntry],
  writtenBy: actorRef,
  agentRunIds: [{ type: Id, ref: 'AgentRun' }],
  createdBy,
}, opts);
projectPlanSchema.index({ organizationId: 1, requestId: 1, version: -1 }, { unique: true });
export const ProjectPlan = model('ProjectPlan', projectPlanSchema);

// WorkItem is the business record of one plan task; each execution attempt
// runs as an ordinary Task (queue/worker/orchestrator), linked via taskIds.
const workItemSchema = new Schema({
  organizationId: org,
  clientId: clientScope,
  projectId: { type: Id, ref: 'Project', required: true },
  requestId: { type: Id, ref: 'ClientRequest', required: true, index: true },
  planId: { type: Id, ref: 'ProjectPlan', required: true },
  planTaskId: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  departmentSlug: { type: String, required: true },
  requiredRole: String,
  dependsOn: [String],
  acceptanceCriteriaIds: [String],
  estimateHours: Number,
  budgetUSD: Number,
  assignedHead: String,
  assignedAgent: String,
  assignedBy: actorRef,
  assignedAt: Date,
  status: { type: String, enum: WORK_ITEM_STATES, default: 'PLANNED', index: true },
  blockedReason: { type: String, enum: [null, 'ATTEMPT_LIMIT', 'BUDGET_EXCEEDED', 'INVALID_OUTPUT', 'EXECUTION_ERROR', 'OTHER'], default: null },
  // Failed review/QA attempts; MAX_ATTEMPTS then BLOCKED + a human is notified.
  attempts: { type: Number, default: 0 },
  outputs: [{ type: { type: String, enum: ['file', 'text', 'link', 'test-report'] }, path: String, summary: String, _id: false }],
  evidence: [{ type: { type: String }, content: String, _id: false }],
  reviews: [{ reviewer: String, verdict: { type: String, enum: ['PASS', 'FAIL'] }, comments: [String], attempt: Number, at: { type: Date, default: Date.now }, _id: false }],
  qaResults: [{ qaAgent: String, verdict: { type: String, enum: ['PASS', 'FAIL'] }, criteriaResults: [{ criterionId: String, pass: Boolean, evidence: String, _id: false }], attempt: Number, at: { type: Date, default: Date.now }, _id: false }],
  history: [historyEntry],
  tokens: { type: Number, default: 0 },
  costUSD: { type: Number, default: 0 },
  agentRunIds: [{ type: Id, ref: 'AgentRun' }],
  taskIds: [{ type: Id, ref: 'Task' }],
  escalationApprovalId: { type: Id, ref: 'Approval' },
  createdBy,
}, opts);
workItemSchema.index({ organizationId: 1, planId: 1, planTaskId: 1 }, { unique: true });
workItemSchema.index({ organizationId: 1, clientId: 1, status: 1 });
export const WorkItem = model('WorkItem', workItemSchema);

export const Deliverable = model('Deliverable', new Schema({
  organizationId: org,
  clientId: clientScope,
  requestId: { type: Id, ref: 'ClientRequest', required: true, index: true },
  projectId: { type: Id, ref: 'Project', required: true },
  version: { type: Number, default: 1 },
  status: { type: String, enum: DELIVERABLE_STATES, default: 'DRAFT' },
  items: [{ workItemId: { type: Id, ref: 'WorkItem' }, title: String, outputs: [{ type: { type: String }, path: String, summary: String, _id: false }], _id: false }],
  summaryReport: String,
  ceoFinalApproval: { approved: Boolean, by: { type: Id, ref: 'User' }, role: String, at: Date, notes: String },
  deliveredAt: Date,
  clientAcknowledged: { type: Boolean, default: false },
  history: [historyEntry],
  createdBy,
}, opts));

export const ClientFeedback = model('ClientFeedback', new Schema({
  organizationId: org,
  clientId: clientScope,
  requestId: { type: Id, ref: 'ClientRequest', required: true, index: true },
  deliverableId: { type: Id, ref: 'Deliverable' },
  verdict: { type: String, enum: ['ACCEPT', 'CHANGES_REQUESTED'], required: true },
  comments: [String],
  by: actorRef,
  at: { type: Date, default: Date.now },
}, opts));
