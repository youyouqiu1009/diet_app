-- Supabase の SQL Editor で実行する（達成履歴の保存先を追加）。
create table if not exists public.goal_achievements (
  user_id uuid not null default auth.uid() references auth.users(id),
  goal_key text not null,
  baseline_date date not null,
  baseline_weight numeric not null,
  goal_weight numeric not null,
  goal_date date,
  achieved_date date not null,
  theoretical_weight numeric not null,
  created_at timestamptz not null default now(),
  primary key (user_id, goal_key)
);

alter table public.goal_achievements enable row level security;

drop policy if exists "select own achievements" on public.goal_achievements;
create policy "select own achievements" on public.goal_achievements
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own achievements" on public.goal_achievements;
create policy "insert own achievements" on public.goal_achievements
  for insert to authenticated with check (auth.uid() = user_id);

grant select, insert on public.goal_achievements to authenticated;
