-- =====================================================================
-- OPTIONAL: strict database isolation.
-- Creates one login role per service that can only touch its own schema
-- (+ append to platform.events). Run manually in the Supabase SQL editor
-- after replacing the passwords, then set <SCHEMA>_DATABASE_URL for each
-- service (e.g. TALENT_DATABASE_URL). Without this, services share
-- DATABASE_URL but still only query their own schema by convention.
-- =====================================================================
do $$
declare
  svc text;
  pw  text := 'CHANGE_ME_STRONG_PASSWORD';
begin
  foreach svc in array array['identity','jobs','talent','assessment','interview','offer','onboarding','notify'] loop
    if not exists (select 1 from pg_roles where rolname = 'svc_' || svc) then
      execute format('create role %I login password %L', 'svc_' || svc, pw);
    end if;
    execute format('grant usage on schema %I to %I', svc, 'svc_' || svc);
    execute format('grant select, insert, update, delete on all tables in schema %I to %I', svc, 'svc_' || svc);
    execute format('grant usage, select on all sequences in schema %I to %I', svc, 'svc_' || svc);
    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to %I', svc, 'svc_' || svc);
    execute format('grant usage on schema platform to %I', 'svc_' || svc);
    execute format('grant insert on platform.events to %I', 'svc_' || svc);
  end loop;
  -- notification-service serves the activity feed
  execute 'grant select on platform.events to svc_notify';
end $$;
