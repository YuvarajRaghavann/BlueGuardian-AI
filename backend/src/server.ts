import dotenv from 'dotenv';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import type { Server } from 'node:http';
import app from './app';
import { connectDB } from './config/db';

// Supports running from either the repository root or the backend directory.
dotenv.config({ path: resolve(process.cwd(), 'backend/.env') });
dotenv.config();

const portValue = process.env.PORT ?? '4000';
const PORT = Number(portValue);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

let server: Server | undefined;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down BlueGuardian backend.`);

  try {
    if (server) {
      await new Promise<void>((resolveClose, rejectClose) => {
        server!.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
    await mongoose.disconnect();
    process.exit(0);
  } catch {
    console.error('Backend shutdown did not complete cleanly.');
    process.exit(1);
  }
}

async function start() {
  try {
    await connectDB();
    server = app.listen(PORT, () => {
      console.log(`Backend running on port ${PORT}`);
    });
    server.on('error', (error) => {
      console.error(`Backend listener failed: ${error.name}`);
      process.exit(1);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown startup error';
    console.error(`Backend startup failed: ${message}`);
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

void start();
