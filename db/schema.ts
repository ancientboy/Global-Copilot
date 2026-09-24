import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const documents=sqliteTable('learning_documents',{userId:text('user_id').primaryKey(),payload:text('payload').notNull(),revision:integer('revision').notNull().default(0),updatedAt:text('updated_at').notNull()});
export const credentials=sqliteTable('ai_credentials',{userId:text('user_id').primaryKey(),provider:text('provider').notNull(),model:text('model').notNull(),ciphertext:text('ciphertext').notNull(),updatedAt:text('updated_at').notNull()});
export const requests=sqliteTable('ai_requests',{id:text('id').primaryKey(),userId:text('user_id').notNull(),createdAt:integer('created_at').notNull()},t=>[index('idx_ai_requests_user_time').on(t.userId,t.createdAt),index('idx_ai_requests_time').on(t.createdAt)]);
