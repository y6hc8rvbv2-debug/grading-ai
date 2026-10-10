-- ============================================================================
-- 0009_mark_positions.sql : 原本に重ねる赤ペン（○×△）の位置を、先生が動かして保存する
--
-- 赤ペンの位置は、画面が答案画像の解答欄の枠と採点AIの位置から決める（保存しない）。
-- 先生がドラッグで動かした位置だけを、答案・設問ごとにこの表へ保存する。
--   - 判定・得点・コメント・要確認（submission_items）には触れない。成績・合計点・状態は変わらない
--   - 「位置を元に戻す」は行を削除する（自動で決めた位置に戻る）
--   - x・y はマークの中心の、ページの幅・高さに対する割合。右の余白に置いたときは x が 1 を超える
--   - school_id は答案から決める（他校の答案には付けられない）
--   - 答案を取り込み直したとき（同じテスト・同じ生徒の答案を置き換えて uploaded_at が変わったとき）は、
--     画像が変わるので、動かした位置を消す（AI で採点し直しただけなら残す）
-- 既存のテーブル・データは変更しない。
-- ============================================================================

-- 途中で失敗したら何も変わらないよう、1つのトランザクションで実行する（docs/DB-RUNBOOK.md）
begin;

create table public.mark_positions (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  qno            integer not null check (qno >= 1),
  page           smallint not null check (page between 1 and 10),
  x              real not null check (x >= 0 and x <= 1.4),
  y              real not null check (y >= 0 and y <= 1),
  updated_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at     timestamptz not null default now(),
  unique (submission_id, qno)
);

-- 学校は答案から決め、更新者・更新日時を付ける（他校の答案・見えない答案には付けられない）
create or replace function public.mark_positions_fill()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school uuid;
begin
  select s.school_id into v_school from public.submissions s where s.id = new.submission_id;
  if v_school is null then
    raise exception '答案が見つかりません（削除済みか、他校の答案です）' using errcode = 'P0002';
  end if;
  new.school_id := v_school;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.submission_id <> old.submission_id or new.qno <> old.qno) then
    raise exception '答案・設問は変更できません' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger mark_positions_fill
  before insert or update on public.mark_positions
  for each row execute function public.mark_positions_fill();

-- 答案を取り込み直したら、前の画像に合わせて動かした位置を消す
create or replace function public.mark_positions_clear_on_reupload()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.uploaded_at is distinct from old.uploaded_at then
    delete from public.mark_positions where submission_id = new.id;
  end if;
  return new;
end $$;

create trigger submissions_clear_mark_positions
  after update of uploaded_at on public.submissions
  for each row execute function public.mark_positions_clear_on_reupload();

alter table public.mark_positions enable row level security;

create policy mark_positions_select on public.mark_positions
  for select to authenticated
  using (school_id = public.current_school_id());
create policy mark_positions_insert on public.mark_positions
  for insert to authenticated
  with check (school_id = public.current_school_id());
create policy mark_positions_update on public.mark_positions
  for update to authenticated
  using (school_id = public.current_school_id())
  with check (school_id = public.current_school_id());
-- 「位置を元に戻す」は教員も行う
create policy mark_positions_delete on public.mark_positions
  for delete to authenticated
  using (school_id = public.current_school_id());

commit;
