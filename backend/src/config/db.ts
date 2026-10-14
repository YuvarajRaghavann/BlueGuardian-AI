import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error('MONGODB_URI is missing. Set it in backend/.env before starting the backend.');
  }
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme.');
  }

  try {
    await mongoose.connect(uri);
  } catch {
    throw new Error('MongoDB connection failed. Check the URI, credentials, network access, and Atlas IP allowlist.');
  }
  console.log('MongoDB connected');
}