-- diet_records に user_id 列を追加（ログインユーザーのIDを自動で入れる）
alter table diet_records
  add column user_id uuid references auth.users(id) default auth.uid();

-- 自分の行だけ見れる
create policy "select own records"
on diet_records for select
using (auth.uid() = user_id);

-- 自分の行として挿入できる
create policy "insert own records"
on diet_records for insert
with check (auth.uid() = user_id);

-- 自分の行だけ更新できる
create policy "update own records"
on diet_records for update
using (auth.uid() = user_id);

-- 自分の行だけ削除できる
create policy "delete own records"
on diet_records for delete
using (auth.uid() = user_id);
