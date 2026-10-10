-- ============================================================================
-- 0004_ai_grading.sql : 採点AIの結果を保存する
--
-- app/api/grade/route.ts（サーバー側）が、ログイン中の教員の権限で呼ぶ。
-- security invoker なので RLS が効き、自校の答案にしか書き込めない。
--
--   - 答案の状態・画質・白紙判定の更新と、設問ごとの結果の保存を1つのトランザクションで行う
--   - 設問ID は AI の出力を信じず、答案のテストと設問番号（qno）から DB 側で決める
--   - 得点は 0〜配点 に丸める（AI やアプリの不具合で配点を超えないための最終防衛）
--   - 合計点と status は既存のトリガー（recalc_submission_total）が決める
-- ============================================================================

-- 途中で失敗したら何も変わらないよう、1つのトランザクションで実行する（docs/DB-RUNBOOK.md）
begin;

create or replace function public.save_ai_grading(
  p_submission_id uuid,
  p_quality       jsonb,
  p_items         jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school uuid;
  v_test   uuid;
  v_blank  boolean;
  v_n      integer;
begin
  select s.school_id, s.test_id into v_school, v_test
    from public.submissions s
   where s.id = p_submission_id and s.deleted_at is null;
  if not found then
    raise exception '答案が見つかりません（削除されたか、他校の答案です）'
      using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '採点結果が空です。もう一度AI採点を実行してください'
      using errcode = '22023';
  end if;

  -- 全設問が無記入なら白紙答案
  select bool_and(coalesce((x->>'is_blank')::boolean, false))
    into v_blank
    from jsonb_array_elements(p_items) x;

  update public.submissions
     set quality     = coalesce(p_quality, '{}'::jsonb),
         is_blank    = v_blank,
         status      = case
                         when v_blank then 'blank'::public.submission_status
                         when coalesce((p_quality->>'ok')::boolean, true) then 'processing'::public.submission_status
                         else 'quality'::public.submission_status
                       end,
         progress    = 100,
         edited      = false,
         reviewed_by = null,
         reviewed_at = null
   where id = p_submission_id;

  insert into public.submission_items as i (
    school_id, submission_id, question_id, qno, detected, confidence, mark, earned,
    is_blank, need_review, reason, comment, bbox, ai_raw, updated_at
  )
  select v_school, p_submission_id, q.id, q.no,
         coalesce(x.detected, ''),
         least(greatest(coalesce(x.confidence, 0), 0), 1),
         coalesce(x.mark, '-')::public.mark_type,
         least(greatest(coalesce(x.earned, 0), 0), q.points),
         coalesce(x.is_blank, false),
         coalesce(x.need_review, true),
         coalesce(x.reason, ''),
         coalesce(x.comment, ''),
         x.bbox,
         x.ai_raw,
         now()
    from jsonb_to_recordset(p_items) as x(
           qno smallint, detected text, confidence numeric, mark text, earned integer,
           is_blank boolean, need_review boolean, reason text, comment text,
           bbox jsonb, ai_raw jsonb)
    join public.questions q on q.test_id = v_test and q.no = x.qno
  on conflict (submission_id, qno) do update
     set question_id = excluded.question_id,
         detected    = excluded.detected,
         confidence  = excluded.confidence,
         mark        = excluded.mark,
         earned      = excluded.earned,
         is_blank    = excluded.is_blank,
         need_review = excluded.need_review,
         reason      = excluded.reason,
         comment     = excluded.comment,
         bbox        = excluded.bbox,
         ai_raw      = excluded.ai_raw,
         updated_at  = excluded.updated_at;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'このテストの設問番号と一致する採点結果がありません。テストの設問を確認してください'
      using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.save_ai_grading(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.save_ai_grading(uuid, jsonb, jsonb) to authenticated, service_role;

commit;
