import dotenv from 'dotenv';
import { resolve } from 'node:path';
import app from './app';
import { connectDB } from './config/db';

dotenv.config({ path: resolve(process.cwd(), 'backend/.env') });
dotenv.config();

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown startup error';
    console.error(`Backend startup failed: ${message}`);
    process.exit(1);
  }
}

start();