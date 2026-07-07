alter table user_settings
  add column if not exists goal_weight numeric,
  add column if not exists goal_date date;
