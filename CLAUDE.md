# CLAUDE.md — ダイエット記録アプリ

このファイルは、これまでの相談で決めた方針を Claude Code（VSCode拡張）に引き継ぐためのものです。
リポジトリのルートに置いておくと、拡張機能が自動で読み込みます。

---

## プロジェクトの目的

自分専用のダイエット記録アプリを作る。主にスマホ1台から、体重や簡単なメモを毎日記録する。
記録したデータを失いたくないので、クラウドに自動でバックアップされる構成にする。

---

## 技術スタック

- **ホスティング**: GitHub Pages（静的サイト。HTML/CSS/JS を配信するだけ）
- **バックエンド / データベース**: Supabase（無料プラン）
- **フロントエンド**: プレーンな HTML / CSS / JavaScript を想定（ビルド不要でGitHub Pagesに向くため）。
  supabase-js は CDN 経由で読み込む想定。フレームワークは未確定なので、着手前にユーザーへ確認してよい。
- **開発環境**: VSCode + Claude Code 拡張

---

## これまでに決めた方針と、その理由

以下は相談済みで確定している内容。蒸し返さず前提として扱ってよい。

- **「同期」ではなく「バックアップ」が目的**。
  記録はスマホ1台からしか行わないため、複数端末間の同期は不要。
  必要なのは「データがクラウドにも保存されていて、端末を失っても消えない安心」。

- **localStorage 単体では不採用**。
  理由: (1) ブラウザのデータ削除で消えるリスク、(2) 同じChromeアカウントでも端末間で同期されない（localStorage は Chrome Sync の対象外）。
  ※ ただし「オフラインでも動く軽量キャッシュ」として localStorage を併用するのはアリ。その場合は Supabase を正（バックアップ先）とする。

- **「JSONファイルを自動で上書き保存」案は却下**。
  理由: ファイルを自動上書きするには File System Access API が必要だが、モバイルブラウザ（iOS Safari / Android Chrome）では未対応。スマホ運用と両立しない。

- **Supabase 無料プランを採用**。
  500MB DB / 月5万ユーザーまで無料で、個人のダイエット記録には十分すぎる容量。
  注意点: 7日間まったくアクセスがないとプロジェクトが一時停止する（毎日使うアプリなら問題なし）。無料プランに自動バックアップは無い。

---

## 現在の進捗

Supabase 側の初期設定（ステップ1〜3）はユーザーが実施済み、または実施中。

1. ✅ Supabase アカウント作成 + プロジェクト作成（Region: Northeast Asia / Tokyo）
2. ✅ テーブル `diet_records` 作成（下記スキーマ）+ Row Level Security 有効化
3. ✅ 接続情報を取得（Project URL と Publishable key を手元に用意）

---

## データベース構造

テーブル名: `diet_records`

```sql
create table diet_records (
  id bigint generated always as identity primary key,
  date date not null,        -- 記録日
  weight numeric,            -- 体重
  memo text,                 -- 自由メモ（食事内容などもここ）
  created_at timestamptz default now()
);

alter table diet_records enable row level security;
```

現状 RLS は有効だが**ポリシー未設定**のため、今は誰もアクセスできない安全な状態。
アクセスできる扉を付けるのはステップ5（下記）で行う。

---

## これからやること（次のステップ）

### ステップ4: アプリから Supabase につなぐ
- supabase-js クライアントを CDN から読み込んで初期化する。
- Project URL と Publishable key を使う（`sb_publishable_...` で始まる新方式のキー。旧 anon key は2026年末廃止予定なので使わない）。
- 体重・メモを `diet_records` に insert する保存機能と、記録一覧を表示する読み込み機能を作る。
- 保存例:
  ```js
  const { error } = await supabase
    .from("diet_records")
    .insert({ date: "2026-07-06", weight: 65.2, memo: "" });
  ```

### ステップ5: セキュリティ（ユーザー本人だけがアクセスできるようにする）
- **重要**: GitHub Pages はソースコードが完全公開される。Publishable key もページを見れば誰でも取得できる。
  そのため RLS ポリシーを適切に設定しないと、第三者がデータを読み書きできてしまう。
- 方針: Supabase Auth でユーザー本人がログインし、RLS ポリシーで「自分の行だけ」アクセス可能にする。
  - `diet_records` に `user_id`（auth.uid() を入れる列）を追加する想定。
  - insert/select/update/delete のポリシーを `auth.uid() = user_id` で絞る。
- 個人利用なので、ログイン方法はメール+パスワード、またはマジックリンクなどシンプルなものでよい。

---

## 重要な技術的注意点（守るべきこと）

- **Secret key（`sb_secret_...`）を絶対にクライアント側コードに書かない**。公開されると全データにアクセスされる。クライアントで使うのは Publishable key のみ。
- Publishable key と Project URL はコードに直書きしてよい（公開前提のキー）。ただし RLS の設定が甘いと意味がないので、RLS ポリシーは必ずレビューする。
- RLS ポリシーを設定するまでは、アプリからデータの読み書きはできない（今は正常にロックされている状態）。

---

## ユーザーについて

- Web開発の初学者。専門用語は噛み砕いた説明があると助かる。
- 一度に大量の情報より、ステップごとに進めてもらえる方が理解しやすい。
- エラーや画面の食い違いが出たら、その都度一緒に解決していくスタイルを希望。
