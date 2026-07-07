alter table user_settings
  drop column if exists basal_metabolic_rate,
  add column if not exists gender text,       -- 'male' | 'female'
  add column if not exists birth_date date,
  add column if not exists height_cm numeric;
