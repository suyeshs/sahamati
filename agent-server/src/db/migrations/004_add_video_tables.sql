-- Video generation tables

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  aspect_ratio TEXT NOT NULL,
  resolution TEXT NOT NULL,
  duration INTEGER NOT NULL,
  file_path TEXT,
  thumbnail_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  error TEXT,
  parent_video_id TEXT,
  metadata TEXT,
  FOREIGN KEY (parent_video_id) REFERENCES videos(id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  operation_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  error TEXT,
  FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id);

-- Generation logs for real-time progress display
CREATE TABLE IF NOT EXISTS generation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL DEFAULT 'info',
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE INDEX IF NOT EXISTS idx_generation_logs_video_id ON generation_logs(video_id);

-- Character profiles for consistency across multi-scene videos
CREATE TABLE IF NOT EXISTS character_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  gender TEXT,
  age_range TEXT,
  ethnicity TEXT,
  clothing TEXT,
  hair TEXT,
  distinguishing_features TEXT,
  series_id TEXT,
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_character_profiles_name ON character_profiles(name);

-- Video series for campaigns
CREATE TABLE IF NOT EXISTS video_series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  character_id TEXT,
  total_videos INTEGER DEFAULT 0,
  branding_defaults TEXT,
  transition_defaults TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (character_id) REFERENCES character_profiles(id)
);

CREATE TABLE IF NOT EXISTS video_series_items (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (series_id) REFERENCES video_series(id),
  FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE INDEX IF NOT EXISTS idx_video_series_items_series_id ON video_series_items(series_id);
