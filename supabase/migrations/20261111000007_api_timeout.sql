-- Supabase caps signed-in API requests at 8 s. Reset demo restores ~200k rows,
-- which takes longer; everything else in the app finishes in well under a second.
alter role authenticated set statement_timeout = '60s';
notify pgrst, 'reload config';
