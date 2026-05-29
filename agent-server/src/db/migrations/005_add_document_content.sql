-- Add content column to documents table (needed for cloud sync)
ALTER TABLE documents ADD COLUMN content TEXT;
