-- Add visibility column to projects (private, internal, public)
ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
