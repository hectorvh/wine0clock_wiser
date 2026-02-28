alter table public.wine_logs
  add column if not exists image_bucket text,
  add column if not exists image_path text,
  add column if not exists image_mime text,
  add column if not exists image_size integer,
  add column if not exists image_sha256 text,
  add column if not exists image_uploaded_at timestamptz default now();

alter table public.wine_logs
  alter column image_bucket set default 'wine_labels';

update public.wine_logs
set image_bucket = 'wine_labels'
where image_bucket is null or image_bucket = 'wine-labels';
