import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from './config.js';
export const sql = postgres(config.DATABASE_URL, { max: 10 });
// Drizzle changes driver serializers; use an independent client for typed queries.
export const drizzleClient = postgres(config.DATABASE_URL, { max: 2 });
export const db = drizzle(drizzleClient);
