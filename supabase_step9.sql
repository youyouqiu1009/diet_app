alter table user_settings
  add column if not exists activity_factor numeric not null default 1.2;
