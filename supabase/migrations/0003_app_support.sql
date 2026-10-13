-- ============================================================================
-- 0003_app_support.sql : Next.js アプリ接続のための調整
--
--   1. 答案の状態（status）の自動判定を直す
--      0001 のトリガーは status が processing の答案をそのまま残すため、
--      saveGrading（processing で保存 → 設問を追加）の後も「採点中」のまま止まっていた。
--      progress = 100 なら採点完了とみなし、done / review / quality を判定する。
--   2. 分析ビューから白紙答案を除外する（白紙は 0 点として平均を下げてしまうため）
--   3. 弱点分析に必要なビューを追加する（クラス別の設問正答率・設問形式別・ミス傾向）
--   4. 「確認済みにする」を1回の呼び出しで行う関数
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 状態の自動判定
--   優先順位: 白紙 > 採点中（progress < 100）> 画質注意（未確認のあいだ）> 要確認 > 採点済
-- ----------------------------------------------------------------------------
create or replace function public.recalc_submission_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  sid := coalesce(new.submission_id, old.submission_id);
  update public.submissions s
     set total_score = coalesce((
           select sum(i.earned) from public.submission_items i where i.submission_id = sid
         ), 0),
         status = case
           when s.is_blank then 'blank'::public.submission_status
           when s.status in ('uploaded','processing') and s.progress < 100 then s.status
           when s.status = 'quality' and s.reviewed_at is null then 'quality'::public.submission_status
           when exists (select 1 from public.submission_items i
                         where i.submission_id = sid and i.need_review)
             then 'review'::public.submission_status
           else 'done'::public.submission_status
         end
   where s.id = sid;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. 既存の分析ビュー：白紙答案を除外（列は変えない）
-- ----------------------------------------------------------------------------
create or replace view public.v_unit_mastery
with (security_invoker = true) as
select
  s.school_id,
  s.test_id,
  s.class_id,
  q.unit,
  count(*)                                        as item_count,
  sum(i.earned)                                   as earned,
  sum(q.points)                                   as points,
  round(100.0 * sum(i.earned) / nullif(sum(q.points),0), 1) as rate
from public.submission_items i
join public.submissions s on s.id = i.submission_id
join public.questions   q on q.id = i.question_id
where s.deleted_at is null
  and s.status not in ('processing','uploaded','blank')
  and not s.is_blank
group by s.school_id, s.test_id, s.class_id, q.unit;

create or replace view public.v_question_stats
with (security_invoker = true) as
select
  s.school_id,
  s.test_id,
  q.id as question_id,
  q.label,
  q.unit,
  count(*)                                                as n,
  count(*) filter (where i.mark = '○')                    as correct_n,
  round(100.0 * count(*) filter (where i.mark = '○') / count(*), 1) as correct_rate,
  round(100.0 * sum(i.earned) / nullif(sum(q.points),0), 1)         as score_rate,
  q.no                                                    as qno
from public.submission_items i
join public.submissions s on s.id = i.submission_id
join public.questions   q on q.id = i.question_id
where s.deleted_at is null
  and s.status not in ('processing','uploaded','blank')
  and not s.is_blank
group by s.school_id, s.test_id, q.id, q.label, q.unit, q.no;

-- ----------------------------------------------------------------------------
-- 3. 追加ビュー
-- ----------------------------------------------------------------------------

-- 設問別の正答率（クラス別）。クラスで絞り込むときに使う。
create or replace view public.v_question_stats_by_class
with (security_invoker = true) as
select
  s.school_id,
  s.test_id,
  s.class_id,
  q.id as question_id,
  q.no as qno,
  q.label,
  q.unit,
  count(*)                                                as n,
  count(*) filter (where i.mark = '○')                    as correct_n,
  round(100.0 * count(*) filter (where i.mark = '○') / count(*), 1) as correct_rate,
  round(100.0 * sum(i.earned) / nullif(sum(q.points),0), 1)         as score_rate
from public.submission_items i
join public.submissions s on s.id = i.submission_id
join public.questions   q on q.id = i.question_id
where s.deleted_at is null
  and s.status not in ('processing','uploaded','blank')
  and not s.is_blank
group by s.school_id, s.test_id, s.class_id, q.id, q.no, q.label, q.unit;

-- 設問形式別の得点率（計算・選択・記述など）
create or replace view public.v_qtype_mastery
with (security_invoker = true) as
select
  s.school_id,
  s.test_id,
  s.class_id,
  q.qtype,
  count(*)                                        as item_count,
  sum(i.earned)                                   as earned,
  sum(q.points)                                   as points,
  round(100.0 * sum(i.earned) / nullif(sum(q.points),0), 1) as rate
from public.submission_items i
join public.submissions s on s.id = i.submission_id
join public.questions   q on q.id = i.question_id
where s.deleted_at is null
  and s.status not in ('processing','uploaded','blank')
  and not s.is_blank
group by s.school_id, s.test_id, s.class_id, q.qtype;

-- ミスの傾向（誤答理由ごとの件数）
create or replace view public.v_mistake_reasons
with (security_invoker = true) as
select
  s.school_id,
  s.test_id,
  s.class_id,
  i.reason,
  count(*) as n
from public.submission_items i
join public.submissions s on s.id = i.submission_id
where s.deleted_at is null
  and s.status not in ('processing','uploaded','blank')
  and not s.is_blank
  and i.reason <> ''
  and i.mark <> '○'
group by s.school_id, s.test_id, s.class_id, i.reason;

-- ----------------------------------------------------------------------------
-- 4. 確認済みにする
--   教員が答案全体を確認したことを記録し、要確認の印をすべて外す。
--   status は items のトリガーが判定し直す（画質注意も確認済みになれば外れる）。
--   security invoker なので、RLS によって自校の答案にしか効かない。
-- ----------------------------------------------------------------------------
create or replace function public.mark_submission_reviewed(p_submission_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.submissions
     set reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_submission_id;
  if not found then
    raise exception '答案が見つかりません（削除されたか、他校の答案です）'
      using errcode = 'P0002';
  end if;

  -- 全設問に触れてトリガーを動かす（要確認が1問もなくても status を判定し直すため）
  update public.submission_items
     set need_review = false, updated_at = now()
   where submission_id = p_submission_id;
end;
$$;

revoke execute on function public.mark_submission_reviewed(uuid) from public, anon;
grant  execute on function public.mark_submission_reviewed(uuid) to authenticated, service_role;
