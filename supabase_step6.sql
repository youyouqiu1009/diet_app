-- カロリー記録（1日に複数回、プラス/マイナス両方）
create table calorie_records (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) default auth.uid() not null,
  recorded_at timestamptz not null default now(),
  amount integer not null,  -- 正=摂取, 負=消費(運動など)
  memo text,
  created_at timestamptz default now()
);

alter table calorie_records enable row level security;

create policy "select own calorie records" on calorie_records
  for select using (auth.uid() = user_id);
create policy "insert own calorie records" on calorie_records
  for insert with check (auth.uid() = user_id);
create policy "update own calorie records" on calorie_records
  for update using (auth.uid() = user_id);
create policy "delete own calorie records" on calorie_records
  for delete using (auth.uid() = user_id);

-- ユーザー設定（基礎代謝・基準体重・kcal/kg定数）
create table user_settings (
  user_id uuid primary key references auth.users(id) default auth.uid(),
  basal_metabolic_rate numeric,
  baseline_weight numeric,
  baseline_date date,
  kcal_per_kg numeric not null default 7200,
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;

create policy "select own settings" on user_settings
  for select using (auth.uid() = user_id);
create policy "insert own settings" on user_settings
  for insert with check (auth.uid() = user_id);
create policy "update own settings" on user_settings
  for update using (auth.uid() = user_id);
