import mongoose from 'mongoose';

export async function connectDb(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is required');
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    const host = uri.replace(/\/\/[^@/]*@/, '//').split('/')[2];
    console.error(`\n✖ Cannot reach MongoDB at ${host} (${err.message.split('\n')[0]}).\n  Start it with: docker compose up -d   — then check with: npm run doctor\n`);
    process.exit(1);
  }
  return mongoose.connection;
}
