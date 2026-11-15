-- =====================================================================
--  Bring back something that was deleted in the CRM (kept for 90 days).
--  Run in Supabase > SQL Editor.
-- =====================================================================

-- STEP 1: see what was deleted recently (newest first)
select id, collection, key, data->>'name' as name, data->>'title' as title, deleted_at
from public.records_trash
order by deleted_at desc
limit 100;

-- STEP 2: restore ONE item: put its id number from step 1 below and run
-- insert into public.records (collection, key, ord, data)
-- select collection, key, extract(epoch from now()), data
-- from public.records_trash where id = 123
-- on conflict (collection, key) do update set data = excluded.data;

-- STEP 3: everyone refreshes the CRM page to see it again.
