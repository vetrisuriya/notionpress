-- Run once (npm run migrate, or paste into your database's SQL editor). Safe to run again.

create table if not exists users (
  id serial primary key,
  notion_user_id text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists notion_connections (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  workspace_id text not null,
  workspace_name text,
  bot_id text,
  access_token_enc text not null,          -- AES-256-GCM encrypted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id)
);

create table if not exists github_installations (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  account_type text,
  created_at timestamptz not null default now(),
  unique (user_id, installation_id)
);

create table if not exists sync_configs (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  notion_connection_id integer not null references notion_connections(id) on delete cascade,
  github_installation_id integer not null references github_installations(id) on delete cascade,
  notion_root_page_id text not null,
  notion_root_title text not null,
  repo_full_name text not null,
  branch text not null,
  target_dir text not null default '',
  frequency text not null default 'manual',   -- manual | hourly | daily
  export_type text not null default 'html',   -- html | markdown
  status text not null default 'idle',        -- idle | queued | running | ok | failed
  last_message text,
  last_run_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists synced_pages (
  id serial primary key,
  sync_config_id integer not null references sync_configs(id) on delete cascade,
  notion_page_id text not null,               -- 32 hex characters, no dashes
  path text not null,                         -- relative to the target folder
  content_hash text not null,
  notion_last_edited text,
  unique (sync_config_id, notion_page_id)
);

create table if not exists synced_assets (
  id serial primary key,
  sync_config_id integer not null references sync_configs(id) on delete cascade,
  block_id text not null,
  path text not null,
  content_hash text not null,
  unique (sync_config_id, block_id)
);

alter table sync_configs add column if not exists export_type text not null default 'html';
