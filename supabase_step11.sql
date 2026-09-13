-- Supabase の SQL Editor で実行する。既存の履歴は理論体重の達成として残す。
alter table public.goal_achievements
  add column if not exists achievement_type text not null default 'theoretical'
    check (achievement_type in ('theoretical', 'actual')),
  add column if not exists actual_weight numeric,
  alter column theoretical_weight drop not null;
