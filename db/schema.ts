import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const entries=sqliteTable('entries',{id:text('id').primaryKey(),payload:text('payload').notNull(),status:text('status').notNull().default('Draft'),version:integer('version').notNull().default(1),deleted:integer('deleted').notNull().default(0),updatedAt:text('updated_at').notNull()});
