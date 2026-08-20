-- Supabase Cron: the every-minute heartbeat behind "time to head over".
--
-- Run this AFTER migration 0012 and after deploying, because it needs the
-- live URL and the CRON_SECRET that the deployed app will check against.
--
-- WHY NOT VERCEL CRON: on the Hobby plan the minimum interval is once per day
-- and the scheduling precision is +/-59 minutes; a `*/1 * * * *` expression
-- fails deployment outright. A ten-minute-before-ready nudge cannot be built
-- on that. pg_cron runs inside Postgres and is not gated by plan tier.
--
-- Replace <CRON_SECRET> with the value from your Vercel environment.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'golden-city-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://ordergoldencity.vercel.app/api/cron',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <CRON_SECRET>'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);

-- Useful afterwards:
--   select * from cron.job;                                    -- is it scheduled
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select cron.unschedule('golden-city-minute');              -- turn it off
