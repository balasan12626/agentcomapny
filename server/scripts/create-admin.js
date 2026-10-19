// Bootstrap: create an organization and its first ORG_ADMIN.
// Usage: node scripts/create-admin.js <org-slug> "<Org Name>" <email>  (password read from ADMIN_PASSWORD env)
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Organization, User, Membership } from '../src/models/index.js';
import { hashPassword } from '../src/core/session.js';

const [slug, name, email] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!slug || !name || !email || !password || password.length < 12) {
  console.error('usage: ADMIN_PASSWORD=<12+ chars> node scripts/create-admin.js <org-slug> "<Org Name>" <email>');
  process.exit(1);
}
await connectDb();
const org = await Organization.findOneAndUpdate({ slug }, { $setOnInsert: { slug, name } }, { upsert: true, new: true });
const user = await User.findOneAndUpdate({ email }, { $setOnInsert: { email, passwordHash: hashPassword(password) } }, { upsert: true, new: true });
await Membership.updateOne({ organizationId: org._id, userId: user._id }, { $set: { role: 'ORG_ADMIN' } }, { upsert: true });
console.log(`org ${slug} admin ${email} ready`);
await mongoose.disconnect();
