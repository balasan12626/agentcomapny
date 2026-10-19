import { Client, Skill, SkillVersion } from '../models/index.js';

const MAX_PROJECT_SKILLS = 5;
const MAX_PROJECT_SKILL_BYTES = 64 * 1024;

export async function resolveProjectSkillRefs(organizationId, skillSlugs = []) {
  const slugs = [...new Set(skillSlugs)];
  if (slugs.length > MAX_PROJECT_SKILLS) throw Object.assign(new Error(`a project can use at most ${MAX_PROJECT_SKILLS} skills`), { status: 400 });
  const refs = [];
  let totalBytes = 0;
  for (const slug of slugs) {
    const skill = await Skill.findOne({ organizationId, slug, enabled: true }).lean()
      || await Skill.findOne({ organizationId: null, slug, enabled: true }).lean();
    if (!skill?.activeVersion) throw Object.assign(new Error(`approved skill unavailable: ${slug}`), { status: 409, code: 'PROJECT_SKILL_UNAVAILABLE' });
    const version = await SkillVersion.findOne({ skillId: skill._id, version: skill.activeVersion, status: 'APPROVED' }).lean();
    if (!version) throw Object.assign(new Error(`approved skill unavailable: ${slug}`), { status: 409, code: 'PROJECT_SKILL_UNAVAILABLE' });
    totalBytes += Buffer.byteLength(version.content, 'utf8');
    if (totalBytes > MAX_PROJECT_SKILL_BYTES) throw Object.assign(new Error('combined project skill content exceeds 64 KB'), { status: 400 });
    refs.push({ slug, version: version.version, hash: version.hash });
  }
  return refs;
}

export async function loadProjectSkillInstructions(organizationId, refs = []) {
  const instructions = [];
  for (const ref of refs) {
    const skill = await Skill.findOne({ organizationId, slug: ref.slug, enabled: true }).lean()
      || await Skill.findOne({ organizationId: null, slug: ref.slug, enabled: true }).lean();
    const version = skill && await SkillVersion.findOne({ skillId: skill._id, version: ref.version, hash: ref.hash, status: 'APPROVED' }).lean();
    if (!version) throw Object.assign(new Error(`approved project skill version is no longer available: ${ref.slug}@${ref.version}`), { status: 409, code: 'PROJECT_SKILL_UNAVAILABLE' });
    instructions.push(`Approved project skill ${ref.slug}@${ref.version}:\n${version.content}`);
  }
  return instructions.join('\n\n');
}

export async function resolveSkillsForProject(organizationId, project) {
  const client = project.clientId
    ? await Client.findOne({ _id: project.clientId, organizationId }).select('skillSlugs').lean()
    : null;
  return resolveProjectSkillRefs(organizationId, [...new Set([...(client?.skillSlugs || []), ...(project.skillSlugs || [])])]);
}