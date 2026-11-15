-- =====================================================================
--  BEMO Operations OS: LEAD ACQUISITION
--  Run AFTER 1-setup.sql, in Supabase > SQL Editor > New query > Run.
--  Safe to run more than once.
--
--  How n8n talks to the CRM:
--    n8n calls the functions below through Supabase's REST API
--    (POST /rest/v1/rpc/<name>) with the public anon key PLUS a private
--    n8n key. Only the SHA-256 hash of that key is stored here.
--    The functions run with database rights, so n8n never needs the
--    service_role key, and nothing here is reachable without the key.
--
--  Leads, campaigns and the suppression list are stored as ordinary CRM
--  records (collections 'acqLeads', 'laCampaigns', 'laSuppression'), so
--  they appear in everyone's CRM instantly through the existing live sync.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- private tables (no policies = invisible to the app) ----------
create table if not exists public.la_secret (
  id int primary key default 1 check (id = 1),
  key_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.la_secret enable row level security;

create table if not exists public.la_seen (            -- duplicate webhook / retry protection
  req_id text primary key,
  at timestamptz not null default now(),
  result jsonb
);
alter table public.la_seen enable row level security;

create table if not exists public.la_rate (            -- simple rate limit per minute
  minute timestamptz primary key,
  hits int not null default 0
);
alter table public.la_rate enable row level security;

-- ---------- provider usage, enrichment history, errors (team can read) ----------
create table if not exists public.la_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,                 -- provider | error | run | sync | budget | compliance
  provider text,
  campaign_id text,
  lead_key text,
  request_type text,
  status text,                        -- ok | error | skipped | auth_failed | rate_limited
  credits numeric default 0,
  cost_zar numeric default 0,
  detail jsonb
);
create index if not exists la_events_at_idx on public.la_events (at desc);
create index if not exists la_events_provider_idx on public.la_events (provider, at desc);
alter table public.la_events enable row level security;
drop policy if exists "team reads lead events" on public.la_events;
create policy "team reads lead events" on public.la_events for select to authenticated using ((select public.is_team_member()));

create sequence if not exists public.la_lead_seq start 1001;

create index if not exists records_acq_dedupe_idx on public.records ((data->>'dedupeKey')) where collection = 'acqLeads';
create index if not exists records_acq_domain_idx on public.records ((data->'company'->>'domain')) where collection = 'acqLeads';
create index if not exists records_supp_value_idx on public.records ((data->>'value')) where collection = 'laSuppression';

-- =====================================================================
-- 1. Create (or rotate) the n8n key. Run ONCE in the SQL Editor:
--      select public.la_create_n8n_key();
--    Copy the result into n8n's "Settings (edit me)" node as CRM_N8N_KEY.
--    Running it again replaces the key (the old one stops working).
-- =====================================================================
create or replace function public.la_create_n8n_key()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare k text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.la_secret (id, key_hash) values (1, encode(extensions.digest(k, 'sha256'), 'hex'))
  on conflict (id) do update set key_hash = excluded.key_hash, created_at = now();
  return k;
end $$;
revoke all on function public.la_create_n8n_key() from public, anon, authenticated;

-- internal: check key + rate limit (600 calls / minute)
create or replace function public.la_check(p_key text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare h text; m timestamptz := date_trunc('minute', now()); n int;
begin
  select key_hash into h from public.la_secret where id = 1;
  if h is null or p_key is null or length(p_key) < 32 or encode(extensions.digest(p_key, 'sha256'), 'hex') <> h then
    perform pg_sleep(0.5);
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  insert into public.la_rate (minute, hits) values (m, 1)
  on conflict (minute) do update set hits = public.la_rate.hits + 1 returning hits into n;
  if n > 600 then raise exception 'rate_limited' using errcode = '54000'; end if;
  delete from public.la_rate where minute < now() - interval '1 hour';
end $$;
revoke all on function public.la_check(text) from public, anon, authenticated;

-- =====================================================================
-- 2. What should n8n do now?  Settings, due campaigns, leads awaiting
--    approved enrichment, and the suppression list.
-- =====================================================================
create or replace function public.la_pull(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg jsonb; camps jsonb; enr jsonb; supp jsonb;
begin
  perform public.la_check(p_key);
  select data into cfg from public.records where collection = '_settings' and key = 'leadAcq';
  select coalesce(jsonb_agg(data), '[]') into camps from public.records
   where collection = 'laCampaigns'
     and coalesce(data->>'status', '') = 'Active'
     and (coalesce((data->>'runRequested')::boolean, false)
          or data->>'lastRun' is null
          or (data->>'lastRun')::timestamptz < now() - make_interval(hours => greatest(1, coalesce((data->>'everyHours')::int, 24))));
  select coalesce(jsonb_agg(data), '[]') into enr from (
    select data from public.records where collection = 'acqLeads' and coalesce((data->>'enrichRequested')::boolean, false) limit 25) x;
  select coalesce(jsonb_agg(data->>'value'), '[]') into supp from public.records where collection = 'laSuppression';
  return jsonb_build_object('config', coalesce(cfg, '{}'), 'campaigns', camps, 'enrich', enr, 'suppression', supp, 'now', now());
end $$;

-- Which of these businesses do we already have?  (full record, so n8n can merge without losing data)
create or replace function public.la_known(p_key text, p_keys text[], p_domains text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.la_check(p_key);
  select coalesce(jsonb_object_agg(coalesce(data->>'dedupeKey', key), data), '{}') into r from public.records
   where collection = 'acqLeads'
     and ((data->>'dedupeKey') = any(p_keys) or (data->'company'->>'domain') = any(p_domains));
  return r;
end $$;

-- =====================================================================
-- 3. Create or update one lead.  Enforces, server-side:
--    - duplicate request protection (p_req_id)
--    - de-duplication by dedupeKey, domain or company phone
--    - the global suppression list (opted-out businesses never come back)
--    - CRM-owned fields (review, transfer, notes, consent) are never
--      overwritten by the automation
-- =====================================================================
create or replace function public.la_save_lead(p_key text, p_req_id text, p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  seen jsonb; dk text; dom text; ph text; old record; newdata jsonb; k text; res jsonb;
  supp text[]; contacts jsonb;
begin
  perform public.la_check(p_key);
  if p_req_id is null or length(p_req_id) < 8 then raise exception 'p_req_id required'; end if;
  select result into seen from public.la_seen where req_id = p_req_id;
  if seen is not null then return seen || jsonb_build_object('duplicate_request', true); end if;

  if p_lead is null or coalesce(p_lead->'company'->>'name', '') = '' then raise exception 'company name required'; end if;
  if length(p_lead::text) > 200000 then raise exception 'lead too large'; end if;
  dk  := p_lead->>'dedupeKey';
  dom := nullif(p_lead->'company'->>'domain', '');
  ph  := nullif(p_lead->'company'->'phone'->>'e164', '');
  if dk is null then raise exception 'dedupeKey required'; end if;

  select array_agg(data->>'value') into supp from public.records where collection = 'laSuppression';
  supp := coalesce(supp, '{}');

  -- company-level suppression: never (re)introduce
  if ('domain:' || coalesce(dom, '-')) = any(supp) or ('phone:' || coalesce(ph, '-')) = any(supp)
     or ('name:' || coalesce(p_lead->>'nameKey', '-')) = any(supp) then
    res := jsonb_build_object('status', 'suppressed');
    insert into public.la_seen (req_id, result) values (p_req_id, res);
    insert into public.la_events (kind, status, detail) values ('compliance', 'suppressed', jsonb_build_object('dedupeKey', dk));
    return res;
  end if;

  select key, data into old from public.records
   where collection = 'acqLeads'
     and ((data->>'dedupeKey') = dk or (dom is not null and data->'company'->>'domain' = dom)
          or (ph is not null and data->'company'->'phone'->>'e164' = ph))
   order by (data->>'dedupeKey') = dk desc limit 1;

  -- contact-level suppression and consent fields always win
  select coalesce(jsonb_agg(
           n.c
           || case when ('email:' || lower(coalesce(n.c->>'email', '-'))) = any(supp) then jsonb_build_object('dnc', true, 'permission', 'Do not contact') else '{}'::jsonb end
           || case when o.c is not null then
                jsonb_strip_nulls(jsonb_build_object('permission', o.c->'permission', 'optOut', o.c->'optOut', 'dnc', o.c->'dnc',
                                        'consent', o.c->'consent', 'consentRequest', o.c->'consentRequest', 'optoutToken', o.c->'optoutToken',
                                        'crmContactRef', o.c->'crmContactRef'))
              else '{}'::jsonb end
         ), '[]')
    into contacts
    from jsonb_array_elements(coalesce(p_lead->'contacts', '[]')) n(c)
    left join lateral (select oc from jsonb_array_elements(coalesce(old.data->'contacts', '[]')) oc
                        where oc->>'id' = n.c->>'id' or (oc->>'email' is not null and lower(oc->>'email') = lower(n.c->>'email')) limit 1) o(c) on true;

  if old.key is not null then
    -- facts are refreshed; review status, transfer, notes and consent stay exactly as the CRM set them
    newdata := p_lead
      || jsonb_build_object('id', old.key, 'contacts', contacts, 'createdAt', old.data->'createdAt', 'updatedAt', now(),
                            'enrichRequested', false)
      || jsonb_strip_nulls(jsonb_build_object('review', old.data->'review', 'transfer', old.data->'transfer', 'notes', old.data->'notes',
                            'conversations', old.data->'conversations', 'meetings', old.data->'meetings', 'consentLog', old.data->'consentLog',
                            'campaignId', old.data->'campaignId'));
    -- keep contacts the CRM has that the new data no longer lists
    newdata := jsonb_set(newdata, '{contacts}', (newdata->'contacts') || coalesce((
      select jsonb_agg(oc) from jsonb_array_elements(coalesce(old.data->'contacts', '[]')) oc
       where not exists (select 1 from jsonb_array_elements(newdata->'contacts') nc where nc->>'id' = oc->>'id'
                         or (nc->>'email' is not null and lower(nc->>'email') = lower(oc->>'email')))), '[]'));
    update public.records set data = newdata, client_id = 'n8n' where collection = 'acqLeads' and key = old.key;
    res := jsonb_build_object('status', 'updated', 'id', old.key);
  else
    k := 'AQ-' || nextval('public.la_lead_seq');
    newdata := p_lead || jsonb_build_object('id', k, 'contacts', contacts, 'createdAt', now(), 'updatedAt', now(),
                                             'review', jsonb_build_object('status', 'New'));
    insert into public.records (collection, key, ord, data, client_id)
    values ('acqLeads', k, extract(epoch from now()), newdata, 'n8n');
    res := jsonb_build_object('status', 'created', 'id', k);
  end if;
  insert into public.la_seen (req_id, result) values (p_req_id, res);
  delete from public.la_seen where at < now() - interval '30 days';
  return res;
end $$;

-- =====================================================================
-- 4. Logging, campaign bookkeeping, usage, reports, notifications
-- =====================================================================
create or replace function public.la_log(p_key text, p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.la_check(p_key);
  insert into public.la_events (kind, provider, campaign_id, lead_key, request_type, status, credits, cost_zar, detail)
  select left(coalesce(e->>'kind', 'provider'), 20), left(e->>'provider', 40), left(e->>'campaignId', 40), left(e->>'leadKey', 200),
         left(e->>'requestType', 60), left(e->>'status', 30), coalesce((e->>'credits')::numeric, 0), coalesce((e->>'costZar')::numeric, 0),
         case when e ? 'detail' then e->'detail' else null end
    from jsonb_array_elements(coalesce(p_events, '[]')) e
   limit 2000;
  get diagnostics n = row_count;
  delete from public.la_events where at < now() - interval '400 days';
  return n;
end $$;

create or replace function public.la_campaign_done(p_key text, p_campaign text, p_stats jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.la_check(p_key);
  update public.records
     set data = data || jsonb_build_object('lastRun', now(), 'runRequested', false, 'lastStats', p_stats,
                                           'cursor', coalesce(p_stats->'cursor', data->'cursor'),
                                           'totalFound', coalesce((data->>'totalFound')::int, 0) + coalesce((p_stats->>'created')::int, 0)),
         client_id = 'n8n'
   where collection = 'laCampaigns' and key = p_campaign;
end $$;

create or replace function public.la_usage_json()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(provider, u), '{}') from (
    select provider, jsonb_build_object(
      'today', count(*) filter (where at >= date_trunc('day', now())),
      'month', count(*) filter (where at >= date_trunc('month', now())),
      'creditsToday', coalesce(sum(credits) filter (where at >= date_trunc('day', now())), 0),
      'creditsMonth', coalesce(sum(credits) filter (where at >= date_trunc('month', now())), 0),
      'costMonth', coalesce(sum(cost_zar) filter (where at >= date_trunc('month', now())), 0),
      'lastOk', max(at) filter (where status = 'ok'),
      'lastError', (array_agg(coalesce(detail->>'message', status) order by at desc) filter (where status not in ('ok', 'skipped')))[1],
      'lastErrorAt', max(at) filter (where status not in ('ok', 'skipped')),
      'remaining', (array_agg(detail->'remaining' order by at desc) filter (where detail ? 'remaining'))[1]) u
    from public.la_events where kind = 'provider' and provider is not null and at >= date_trunc('month', now())
    group by provider) x;
$$;
revoke all on function public.la_usage_json() from public, anon, authenticated;

create or replace function public.la_usage(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin perform public.la_check(p_key); return public.la_usage_json(); end $$;

-- For the CRM screen (signed-in team members only)
create or replace function public.la_provider_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_member() then raise exception 'not allowed'; end if;
  return jsonb_build_object('usage', public.la_usage_json(),
    'recent', (select coalesce(jsonb_agg(row_to_json(e)), '[]') from (
                 select at, kind, provider, campaign_id, lead_key, request_type, status, credits, cost_zar, detail->>'message' as message
                   from public.la_events order by at desc limit 80) e));
end $$;
revoke all on function public.la_provider_stats() from public, anon;
grant execute on function public.la_provider_stats() to authenticated;

create or replace function public.la_daily_stats(p_key text, p_day date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d0 timestamptz := p_day::timestamptz; d1 timestamptz := (p_day + 1)::timestamptz; r jsonb;
begin
  perform public.la_check(p_key);
  with l as (select data from public.records where collection = 'acqLeads'),
       t as (select data from l where (data->>'createdAt')::timestamptz >= d0 and (data->>'createdAt')::timestamptz < d1),
       u as (select data from l where (data->>'updatedAt')::timestamptz >= d0 and (data->>'updatedAt')::timestamptz < d1)
  select jsonb_build_object(
    'day', p_day,
    'discovered', (select count(*) from t),
    'updated', (select count(*) from u),
    'verified', (select count(*) from u where data->'verification'->>'status' = 'Verified business'),
    'enriched', (select count(*) from u where data->'enrichment'->>'status' = 'Enriched'),
    'highPriority', (select count(*) from u where (data->'score'->>'total')::int >= 85),
    'withDecisionMaker', (select count(*) from u where exists (select 1 from jsonb_array_elements(coalesce(data->'contacts','[]')) c where coalesce(c->>'name','') <> '')),
    'withVerifiedEmail', (select count(*) from u where exists (select 1 from jsonb_array_elements(coalesce(data->'contacts','[]')) c where c->>'emailStatus' in ('valid','verified'))),
    'withVerifiedPhone', (select count(*) from u where data->'company'->'phone'->>'status' like 'Verified%'
                             or exists (select 1 from jsonb_array_elements(coalesce(data->'contacts','[]')) c, jsonb_array_elements(coalesce(c->'phones','[]')) p where p->>'status' like 'Verified%')),
    'noWebsite', (select count(*) from u where data->'website'->>'status' = 'NO WEBSITE FOUND'),
    'automationOpportunities', (select count(*) from u where (data->'score'->'breakdown'->>'automation')::int >= 14),
    'awaitingReview', (select count(*) from l where data->'review'->>'status' = 'New'),
    'failedRequests', (select count(*) from public.la_events where at >= d0 and at < d1 and status in ('error','auth_failed','rate_limited')),
    'credits', (select coalesce(sum(credits),0) from public.la_events where at >= d0 and at < d1),
    'costZar', (select coalesce(sum(cost_zar),0) from public.la_events where at >= d0 and at < d1),
    'byProvider', (select coalesce(jsonb_object_agg(provider, n), '{}') from (select provider, count(*) n from public.la_events where at >= d0 and at < d1 and provider is not null group by provider) x)
  ) into r;
  return r;
end $$;

-- In-CRM notification (shows in everyone's bell, or one person's)
create or replace function public.la_notify(p_key text, p_text text, p_link text default 'leads', p_for text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k text := 'N-LA' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS');
begin
  perform public.la_check(p_key);
  insert into public.records (collection, key, ord, data, client_id)
  values ('notifications', k, -extract(epoch from now()),
          jsonb_build_object('id', k, 'type', 'enquiry', 'text', left(p_text, 400), 'at', to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD"T"HH24:MI'),
                             'read', false, 'link', p_link, 'for', p_for), 'n8n')
  on conflict do nothing;
end $$;

-- Opt-out link handler (called by the n8n opt-out webhook). Adds every
-- address and number of that contact to the permanent suppression list.
create or replace function public.la_optout(p_key text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; c jsonb; v text; n int := 0;
begin
  perform public.la_check(p_key);
  if p_token is null or length(p_token) < 16 then return jsonb_build_object('status', 'invalid'); end if;
  select key, data into r from public.records
   where collection = 'acqLeads' and exists (select 1 from jsonb_array_elements(coalesce(data->'contacts','[]')) x where x->>'optoutToken' = p_token) limit 1;
  if r.key is null then return jsonb_build_object('status', 'not_found'); end if;
  select x into c from jsonb_array_elements(r.data->'contacts') x where x->>'optoutToken' = p_token;
  for v in select unnest(array_remove(array[ case when c->>'email' is not null then 'email:' || lower(c->>'email') end ], null))
           union select 'phone:' || (p->>'e164') from jsonb_array_elements(coalesce(c->'phones','[]')) p where p->>'e164' is not null
  loop
    insert into public.records (collection, key, ord, data, client_id)
    values ('laSuppression', 'SUP-' || md5(v), extract(epoch from now()),
            jsonb_build_object('id', 'SUP-' || md5(v), 'value', v, 'reason', 'Opted out via link', 'at', now(), 'leadId', r.key), 'n8n')
    on conflict (collection, key) do nothing;
    n := n + 1;
  end loop;
  update public.records set data = jsonb_set(data, '{contacts}', (
      select jsonb_agg(case when x->>'optoutToken' = p_token then x || jsonb_build_object('optOut', true, 'permission', 'Opted out', 'optOutAt', now()) else x end)
        from jsonb_array_elements(data->'contacts') x)) || jsonb_build_object('updatedAt', now()), client_id = 'n8n'
   where collection = 'acqLeads' and key = r.key;
  insert into public.la_events (kind, status, lead_key, detail) values ('compliance', 'opted_out', r.key, jsonb_build_object('entries', n));
  return jsonb_build_object('status', 'opted_out', 'company', r.data->'company'->>'name');
end $$;

-- ---------- who may call what ----------
revoke all on function public.la_pull(text) from public;
revoke all on function public.la_known(text, text[], text[]) from public;
revoke all on function public.la_save_lead(text, text, jsonb) from public;
revoke all on function public.la_log(text, jsonb) from public;
revoke all on function public.la_campaign_done(text, text, jsonb) from public;
revoke all on function public.la_usage(text) from public;
revoke all on function public.la_daily_stats(text, date) from public;
revoke all on function public.la_notify(text, text, text, text) from public;
revoke all on function public.la_optout(text, text) from public;
grant execute on function public.la_pull(text), public.la_known(text, text[], text[]), public.la_save_lead(text, text, jsonb),
  public.la_log(text, jsonb), public.la_campaign_done(text, text, jsonb), public.la_usage(text), public.la_daily_stats(text, date),
  public.la_notify(text, text, text, text), public.la_optout(text, text) to anon, authenticated;

-- Done. Next: select public.la_create_n8n_key();
