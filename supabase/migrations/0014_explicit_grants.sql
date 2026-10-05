-- ============================================================================
-- 0014_explicit_grants.sql : Data API のロール（anon・authenticated・service_role）への権限を、明示的に付ける
--
-- これまでのマイグレーション（0001〜0013）は、Supabase の既定の「public に作った表・関数へ自動で権限を付ける」
-- （管理画面の Automatically expose new tables がオン）に頼っていた。オフのプロジェクトでは権限が付かず、
-- アプリから「permission denied」になる（Supabase 公式：Securing your API の Default privileges）。
--
-- この表は、0001〜0013 を「自動で公開」がオンの環境に適用したときに実際に付く権限を、そのまま書き出したもの
-- （supabase/runbook/acl-snapshot.sql で取得。ただし表は Data API が使う SELECT/INSERT/UPDATE/DELETE だけ）。
--   - オンの環境（いまの本番）：すでに同じ権限が付いているので、何も変わらない
--   - オフの環境（検証用 saiten-verify）：オンの環境と同じ権限になる
-- 0001〜0013 で外した権限（profiles の UPDATE は display_name・ui_lang の列だけ、authenticated の監査ログの更新・削除、
-- 通話を切るための資格情報の表、見回りの関数など）は、ここでも付けない。行の読み書きはこれまでどおり RLS で制限する。
-- 何度実行しても同じ結果になる（GRANT は付いていれば何もしない）。
-- ============================================================================
begin;

/* ---------------------------------------------------------------- 表・ビュー */
grant select, insert, update, delete on table public.audit_logs to anon;
grant select, insert on table public.audit_logs to authenticated;
grant select, insert, update, delete on table public.audit_logs to service_role;
grant select, insert, update, delete on table public.classes to anon;
grant select, insert, update, delete on table public.classes to authenticated;
grant select, insert, update, delete on table public.classes to service_role;
grant select, insert, update, delete on table public.grading_jobs to anon;
grant select, insert, update, delete on table public.grading_jobs to authenticated;
grant select, insert, update, delete on table public.grading_jobs to service_role;
grant select, insert, update, delete on table public.grading_stages to anon;
grant select, insert, update, delete on table public.grading_stages to authenticated;
grant select, insert, update, delete on table public.grading_stages to service_role;
grant select, insert, update, delete on table public.intake_scans to anon;
grant select, insert, update, delete on table public.intake_scans to authenticated;
grant select, insert, update, delete on table public.intake_scans to service_role;
grant select, insert, update, delete on table public.mark_positions to anon;
grant select, insert, update, delete on table public.mark_positions to authenticated;
grant select, insert, update, delete on table public.mark_positions to service_role;
grant select, insert, update, delete on table public.model_answer_sets to anon;
grant select, insert, update, delete on table public.model_answer_sets to authenticated;
grant select, insert, update, delete on table public.model_answer_sets to service_role;
grant select, insert, update, delete on table public.model_compare_results to anon;
grant select, insert, update, delete on table public.model_compare_results to authenticated;
grant select, insert, update, delete on table public.model_compare_results to service_role;
grant select, insert, update, delete on table public.model_compare_runs to anon;
grant select, insert, update, delete on table public.model_compare_runs to authenticated;
grant select, insert, update, delete on table public.model_compare_runs to service_role;
grant select, insert, delete on table public.profiles to anon;
grant select, insert, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.questions to anon;
grant select, insert, update, delete on table public.questions to authenticated;
grant select, insert, update, delete on table public.questions to service_role;
grant select, insert, update, delete on table public.result_release_history to anon;
grant select, insert, update, delete on table public.result_release_history to authenticated;
grant select, insert, update, delete on table public.result_release_history to service_role;
grant select, insert, update, delete on table public.result_releases to anon;
grant select, insert, update, delete on table public.result_releases to authenticated;
grant select, insert, update, delete on table public.result_releases to service_role;
grant select, insert, update, delete on table public.rubrics to anon;
grant select, insert, update, delete on table public.rubrics to authenticated;
grant select, insert, update, delete on table public.rubrics to service_role;
grant select, insert, update, delete on table public.schools to anon;
grant select, insert, update, delete on table public.schools to authenticated;
grant select, insert, update, delete on table public.schools to service_role;
grant select, insert, update, delete on table public.student_accounts to anon;
grant select, insert, update, delete on table public.student_accounts to authenticated;
grant select, insert, update, delete on table public.student_accounts to service_role;
grant select, insert, update, delete on table public.student_inbox to anon;
grant select, insert, update, delete on table public.student_inbox to authenticated;
grant select, insert, update, delete on table public.student_inbox to service_role;
grant select, insert, update, delete on table public.students to anon;
grant select, insert, update, delete on table public.students to authenticated;
grant select, insert, update, delete on table public.students to service_role;
grant select, insert, update, delete on table public.submission_items to anon;
grant select, insert, update, delete on table public.submission_items to authenticated;
grant select, insert, update, delete on table public.submission_items to service_role;
grant select, insert, update, delete on table public.submission_links to anon;
grant select, insert, update, delete on table public.submission_links to authenticated;
grant select, insert, update, delete on table public.submission_links to service_role;
grant select, insert, update, delete on table public.submissions to anon;
grant select, insert, update, delete on table public.submissions to authenticated;
grant select, insert, update, delete on table public.submissions to service_role;
grant select, insert, update, delete on table public.test_imports to anon;
grant select, insert, update, delete on table public.test_imports to authenticated;
grant select, insert, update, delete on table public.test_imports to service_role;
grant select, insert, update, delete on table public.tests to anon;
grant select, insert, update, delete on table public.tests to authenticated;
grant select, insert, update, delete on table public.tests to service_role;
grant select, insert, update, delete on table public.tutor_call_secrets to service_role;
grant select, insert, update, delete on table public.tutor_consents to anon;
grant select, insert, update, delete on table public.tutor_consents to authenticated;
grant select, insert, update, delete on table public.tutor_consents to service_role;
grant select, insert, update, delete on table public.tutor_credentials to anon;
grant select, insert, update, delete on table public.tutor_credentials to authenticated;
grant select, insert, update, delete on table public.tutor_credentials to service_role;
grant select, insert, update, delete on table public.tutor_progress to anon;
grant select, insert, update, delete on table public.tutor_progress to authenticated;
grant select, insert, update, delete on table public.tutor_progress to service_role;
grant select, insert, update, delete on table public.tutor_reflections to anon;
grant select, insert, update, delete on table public.tutor_reflections to authenticated;
grant select, insert, update, delete on table public.tutor_reflections to service_role;
grant select, insert, update, delete on table public.tutor_sessions to anon;
grant select, insert, update, delete on table public.tutor_sessions to authenticated;
grant select, insert, update, delete on table public.tutor_sessions to service_role;
grant select, insert, update, delete on table public.tutor_sweeper to service_role;
grant select, insert, update, delete on table public.tutor_transcripts to anon;
grant select, insert, update, delete on table public.tutor_transcripts to authenticated;
grant select, insert, update, delete on table public.tutor_transcripts to service_role;
grant select, insert, update, delete on table public.v_mistake_reasons to anon;
grant select, insert, update, delete on table public.v_mistake_reasons to authenticated;
grant select, insert, update, delete on table public.v_mistake_reasons to service_role;
grant select, insert, update, delete on table public.v_qtype_mastery to anon;
grant select, insert, update, delete on table public.v_qtype_mastery to authenticated;
grant select, insert, update, delete on table public.v_qtype_mastery to service_role;
grant select, insert, update, delete on table public.v_question_stats to anon;
grant select, insert, update, delete on table public.v_question_stats to authenticated;
grant select, insert, update, delete on table public.v_question_stats to service_role;
grant select, insert, update, delete on table public.v_question_stats_by_class to anon;
grant select, insert, update, delete on table public.v_question_stats_by_class to authenticated;
grant select, insert, update, delete on table public.v_question_stats_by_class to service_role;
grant select, insert, update, delete on table public.v_unit_mastery to anon;
grant select, insert, update, delete on table public.v_unit_mastery to authenticated;
grant select, insert, update, delete on table public.v_unit_mastery to service_role;

/* ---------------------------------------------------------------- 列ごとの権限 */
grant update (display_name) on table public.profiles to authenticated;
grant update (ui_lang) on table public.profiles to authenticated;

/* ---------------------------------------------------------------- 連番 */
grant select, update, usage on sequence public.audit_logs_id_seq to anon;
grant select, update, usage on sequence public.audit_logs_id_seq to authenticated;
grant select, update, usage on sequence public.audit_logs_id_seq to service_role;

/* ---------------------------------------------------------------- 関数（EXECUTE） */
grant execute on function public.audit_chain() to public, anon, authenticated, service_role;
grant execute on function public.bind_student_account(p_student uuid, p_email text) to authenticated, service_role;
grant execute on function public.current_role_is(target user_role) to public, anon, authenticated, service_role;
grant execute on function public.current_school_id() to public, anon, authenticated, service_role;
grant execute on function public.current_student_id() to authenticated, service_role;
grant execute on function public.current_student_school() to authenticated, service_role;
grant execute on function public.end_tutor_session(p_id uuid, p_reason text, p_seconds integer, p_usage jsonb) to authenticated, service_role;
grant execute on function public.expire_stale_grading_jobs(p_submission_id uuid, p_minutes integer) to authenticated, service_role;
grant execute on function public.fail_grading_job(p_job_id uuid, p_error text) to authenticated, service_role;
grant execute on function public.finish_grading_job(p_job_id uuid, p_stage text, p_quality jsonb, p_items jsonb, p_needs_review boolean, p_decision jsonb) to authenticated, service_role;
grant execute on function public.grading_guard() to public, anon, authenticated, service_role;
grant execute on function public.grading_touch_job() to public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to public, anon, authenticated, service_role;
grant execute on function public.heartbeat_tutor_session(p_id uuid, p_seconds integer) to authenticated, service_role;
grant execute on function public.invalidate_result_review() to public, anon, authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.mark_inbox_read(p_id uuid) to authenticated, service_role;
grant execute on function public.mark_positions_clear_on_reupload() to public, anon, authenticated, service_role;
grant execute on function public.mark_positions_fill() to public, anon, authenticated, service_role;
grant execute on function public.mark_submission_reviewed(p_submission_id uuid) to authenticated, service_role;
grant execute on function public.model_compare_guard() to public, anon, authenticated, service_role;
grant execute on function public.publish_class_results(p_test uuid, p_class uuid) to authenticated, service_role;
grant execute on function public.publish_submission_result(p_submission uuid) to authenticated, service_role;
grant execute on function public.purge_expired_submissions() to service_role;
grant execute on function public.recalc_submission_total() to public, anon, authenticated, service_role;
grant execute on function public.remove_test(p_test_id uuid) to authenticated, service_role;
grant execute on function public.restore_test(p_test_id uuid) to authenticated, service_role;
grant execute on function public.result_releases_after() to public, anon, authenticated, service_role;
grant execute on function public.result_releases_enrich() to public, anon, authenticated, service_role;
grant execute on function public.save_ai_grading(p_submission_id uuid, p_quality jsonb, p_items jsonb) to authenticated, service_role;
grant execute on function public.set_tutor_call(p_id uuid, p_call text, p_secret text) to authenticated, service_role;
grant execute on function public.set_tutor_settings(p_enabled boolean, p_session_minutes integer, p_daily_minutes integer, p_class_ids uuid[]) to authenticated, service_role;
grant execute on function public.start_tutor_session(p_release uuid, p_qno integer, p_mode text, p_model text) to authenticated, service_role;
grant execute on function public.test_imports_guard() to public, anon, authenticated, service_role;
grant execute on function public.tests_protect_delete() to public, anon, authenticated, service_role;
grant execute on function public.tutor_call_secret(p_id uuid) to authenticated, service_role;
grant execute on function public.tutor_consent_revoked() to public, anon, authenticated, service_role;
grant execute on function public.tutor_hangup_result(p_id uuid, p_ok boolean, p_error text) to authenticated, service_role;
grant execute on function public.tutor_hangup_result_internal(p_id uuid, p_ok boolean, p_error text, p_by text) to service_role;
grant execute on function public.tutor_log(p_action text) to authenticated, service_role;
grant execute on function public.tutor_shared_with_teacher(p_student uuid) to authenticated, service_role;
grant execute on function public.tutor_status() to authenticated, service_role;
grant execute on function public.tutor_sweep_due(p_feature_off boolean, p_stale_seconds integer, p_limit integer) to service_role;
grant execute on function public.tutor_sweep_ping(p_url text) to service_role;
grant execute on function public.tutor_sweep_record(p_id uuid, p_ok boolean, p_error text) to service_role;
grant execute on function public.tutor_sweeper_ok() to authenticated, service_role;
grant execute on function public.tutor_sweeper_status() to authenticated, service_role;
grant execute on function public.verify_audit_chain(p_school_id uuid) to public, anon, authenticated, service_role;

commit;
