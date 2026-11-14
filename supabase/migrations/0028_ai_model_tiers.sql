-- 高速は Haiku、標準は Sonnet に限定し、過去の範囲外の設定は既定に戻す。
begin;

update public.ai_settings
set model_fast = null
where model_fast !~ '^claude-haiku-[0-9]+(-[0-9]{1,2})?(-[0-9]{8})?$';

update public.ai_settings
set model_standard = null
where model_standard !~ '^claude-sonnet-[0-9]+(-[0-9]{1,2})?(-[0-9]{8})?$';

alter table public.ai_settings
  add constraint ai_settings_fast_tier
    check (model_fast ~ '^claude-haiku-[0-9]+(-[0-9]{1,2})?(-[0-9]{8})?$'),
  add constraint ai_settings_standard_tier
    check (model_standard ~ '^claude-sonnet-[0-9]+(-[0-9]{1,2})?(-[0-9]{8})?$');

commit;
