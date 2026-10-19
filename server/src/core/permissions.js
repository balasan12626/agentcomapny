// Server-side role → permission map. Hiding a button is not authorization.

export const ROLES = Object.freeze(['PLATFORM_OWNER', 'ORG_ADMIN', 'PROJECT_MANAGER', 'AGENT_OPERATOR', 'REVIEWER', 'VIEWER']);

const P = {
  read: 'read',
  manageOrg: 'org:manage',
  manageProjects: 'project:manage',
  manageAgents: 'agent:manage',
  manageSkills: 'skill:manage',
  execute: 'task:execute',
  approve: 'approval:decide',
  audit: 'audit:read',
  manageDevices: 'device:manage',
};
export const PERMISSIONS = Object.freeze(P);

const ROLE_PERMISSIONS = {
  PLATFORM_OWNER: Object.values(P),
  ORG_ADMIN: Object.values(P),
  PROJECT_MANAGER: [P.read, P.manageProjects, P.execute, P.approve, P.audit],
  AGENT_OPERATOR: [P.read, P.execute],
  REVIEWER: [P.read, P.approve, P.audit],
  VIEWER: [P.read],
};

export function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

// membership: { organizationId, role, projectIds?: [] } (empty/absent = all org projects)
export function authorize(membership, { permission, organizationId, projectId }) {
  if (!membership) return { allowed: false, reason: 'not a member' };
  if (String(membership.organizationId) !== String(organizationId)) return { allowed: false, reason: 'cross-tenant access denied' };
  if (!hasPermission(membership.role, permission)) return { allowed: false, reason: `role ${membership.role} lacks ${permission}` };
  const scoped = membership.projectIds && membership.projectIds.length > 0;
  if (projectId && scoped && !membership.projectIds.map(String).includes(String(projectId))) {
    return { allowed: false, reason: 'project access denied' };
  }
  return { allowed: true };
}
