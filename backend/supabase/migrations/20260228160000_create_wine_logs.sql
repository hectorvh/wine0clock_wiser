create extension if not exists postgis;

do $$
begin
  -- If a legacy wine_logs table exists (old schema with dedupe/manual jsonb layout),
  -- rebuild it so the flattened column layout can be created cleanly.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wine_logs'
      and column_name = 'dedupe_key'
  ) then
    drop table public.wine_logs cascade;
  end if;
end $$;

create table if not exists public.wine_logs (
  id bigserial primary key,
  user_id text not null,
  request_query_mode text,
  request_query_lang text,
  request_file_name text,
  request_file_size integer,
  request_file_type text,
  request_file_base64 text,
  response_mode text,
  response_wine_full_name text,
  response_wine_producer text,
  response_wine_winery text,
  response_wine_winery_description text,
  response_wine_region_name text,
  response_wine_country text,
  response_wine_wine_type text,
  response_wine_vintage text,
  response_wine_grape_variety text,
  response_wine_average_price_usd integer,
  response_wine_region_display text,
  response_wine_region_key text,
  response_wine_wfs_nam_display text,
  response_wine_wfs_nam_key text,
  response_sensory_aroma text,
  response_sensory_tasting_notes text,
  response_sensory_food_pairing text,
  response_serving_temp_min_c double precision,
  response_serving_temp_max_c double precision,
  response_serving_decanting_minutes integer,
  response_ratings_avg_rating double precision,
  response_ratings_reviews integer,
  response_ratings_source text,
  response_debug_confidence double precision,
  response_debug_selected_id text,
  response_debug_errors text,
  response_region_match_api_region_display text,
  response_region_match_api_region_key text,
  response_region_match_matched_feature_count integer,
  response_region_match_wfs_matches text,
  manual_brand text,
  manual_producer text,
  manual_year integer,
  manual_region text,
  manual_country text,
  manual_wine_type text,
  manual_is_german boolean,
  manual_city text,
  manual_score double precision,
  manual_notes text,
  manual_lat double precision,
  manual_lng double precision,
  manual_image_path text,
  manual_image_data_url text,
  manual_timestamp timestamptz,
  error_text text,
  geom geometry(MultiPolygon, 4326) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_wine_logs_geom on public.wine_logs using gist (geom);
create index if not exists idx_wine_logs_user_id on public.wine_logs (user_id);
create index if not exists idx_wine_logs_origin_region_key on public.wine_logs (response_wine_region_key);

create or replace function public.insert_wine_log_from_feature(
  p_user_id text,
  p_request jsonb,
  p_response jsonb,
  p_manual jsonb,
  p_error text,
  p_geom_json jsonb
)
returns table (id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_geom geometry(MultiPolygon, 4326);
begin
  if p_geom_json is null then
    v_geom := 'MULTIPOLYGON EMPTY'::geometry(MultiPolygon, 4326);
  else
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geom_json::text), 4326);
    if geometrytype(v_geom) = 'POLYGON' then
      v_geom := ST_Multi(v_geom);
    end if;
  end if;

  return query
  insert into public.wine_logs (
    user_id,
    request_query_mode,
    request_query_lang,
    request_file_name,
    request_file_size,
    request_file_type,
    request_file_base64,
    response_mode,
    response_wine_full_name,
    response_wine_producer,
    response_wine_winery,
    response_wine_winery_description,
    response_wine_region_name,
    response_wine_country,
    response_wine_wine_type,
    response_wine_vintage,
    response_wine_grape_variety,
    response_wine_average_price_usd,
    response_wine_region_display,
    response_wine_region_key,
    response_wine_wfs_nam_display,
    response_wine_wfs_nam_key,
    response_sensory_aroma,
    response_sensory_tasting_notes,
    response_sensory_food_pairing,
    response_serving_temp_min_c,
    response_serving_temp_max_c,
    response_serving_decanting_minutes,
    response_ratings_avg_rating,
    response_ratings_reviews,
    response_ratings_source,
    response_debug_confidence,
    response_debug_selected_id,
    response_debug_errors,
    response_region_match_api_region_display,
    response_region_match_api_region_key,
    response_region_match_matched_feature_count,
    response_region_match_wfs_matches,
    manual_brand,
    manual_producer,
    manual_year,
    manual_region,
    manual_country,
    manual_wine_type,
    manual_is_german,
    manual_city,
    manual_score,
    manual_notes,
    manual_lat,
    manual_lng,
    manual_image_path,
    manual_image_data_url,
    manual_timestamp,
    error_text,
    geom
  )
  values (
    coalesce(p_user_id, 'unknown'),
    p_request -> 'query' ->> 'mode',
    p_request -> 'query' ->> 'lang',
    p_request -> 'file' ->> 'name',
    nullif(p_request -> 'file' ->> 'size', '')::integer,
    p_request -> 'file' ->> 'type',
    p_request ->> 'file_base64',
    p_response ->> 'mode',
    p_response -> 'wine' ->> 'full_name',
    p_response -> 'wine' ->> 'producer',
    p_response -> 'wine' ->> 'winery',
    p_response -> 'wine' ->> 'winery_description',
    p_response -> 'wine' ->> 'region_name',
    p_response -> 'wine' ->> 'country',
    p_response -> 'wine' ->> 'wine_type',
    p_response -> 'wine' ->> 'vintage',
    p_response -> 'wine' ->> 'grape_variety',
    nullif(p_response -> 'wine' ->> 'average_price_usd', '')::integer,
    p_response -> 'wine' ->> 'region_display',
    p_response -> 'wine' ->> 'region_key',
    p_response -> 'wine' ->> 'wfs_nam_display',
    p_response -> 'wine' ->> 'wfs_nam_key',
    p_response -> 'sensory' ->> 'aroma',
    p_response -> 'sensory' ->> 'tasting_notes',
    p_response -> 'sensory' ->> 'food_pairing',
    nullif(p_response -> 'serving' ->> 'temp_min_c', '')::double precision,
    nullif(p_response -> 'serving' ->> 'temp_max_c', '')::double precision,
    nullif(p_response -> 'serving' ->> 'decanting_minutes', '')::integer,
    nullif(p_response -> 'ratings' ->> 'avg_rating', '')::double precision,
    nullif(p_response -> 'ratings' ->> 'reviews', '')::integer,
    p_response -> 'ratings' ->> 'source',
    nullif(p_response -> 'debug' ->> 'confidence', '')::double precision,
    p_response -> 'debug' ->> 'selected_id',
    coalesce((p_response -> 'debug' -> 'errors')::text, '[]'),
    p_response -> 'region_match' ->> 'api_region_display',
    p_response -> 'region_match' ->> 'api_region_key',
    nullif(p_response -> 'region_match' ->> 'matched_feature_count', '')::integer,
    coalesce((p_response -> 'region_match' -> 'wfs_matches')::text, '[]'),
    p_manual ->> 'brand',
    p_manual ->> 'producer',
    nullif(p_manual ->> 'year', '')::integer,
    p_manual ->> 'region',
    p_manual ->> 'country',
    p_manual ->> 'wine_type',
    case
      when lower(coalesce(p_manual ->> 'is_german', '')) in ('true', 't', '1') then true
      when lower(coalesce(p_manual ->> 'is_german', '')) in ('false', 'f', '0') then false
      else null
    end,
    p_manual ->> 'city',
    nullif(p_manual ->> 'score', '')::double precision,
    p_manual ->> 'notes',
    nullif(p_manual ->> 'lat', '')::double precision,
    nullif(p_manual ->> 'lng', '')::double precision,
    p_manual ->> 'image_path',
    p_manual ->> 'image_data_url',
    nullif(p_manual ->> 'timestamp', '')::timestamptz,
    p_error,
    v_geom
  )
  returning wine_logs.id;
end;
$$;

create or replace function public.get_wine_logs_feature_collection()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::jsonb,
          'properties', jsonb_build_object(
            'user_id', user_id,
            'request', jsonb_build_object(
              'query', jsonb_build_object(
                'mode', request_query_mode,
                'lang', request_query_lang
              ),
              'file', jsonb_build_object(
                'name', request_file_name,
                'size', request_file_size,
                'type', request_file_type
              ),
              'file_base64', request_file_base64
            ),
            'response', jsonb_build_object(
              'mode', response_mode,
              'wine', jsonb_build_object(
                'full_name', response_wine_full_name,
                'producer', response_wine_producer,
                'winery', response_wine_winery,
                'winery_description', response_wine_winery_description,
                'region_name', response_wine_region_name,
                'country', response_wine_country,
                'wine_type', response_wine_wine_type,
                'vintage', response_wine_vintage,
                'grape_variety', response_wine_grape_variety,
                'average_price_usd', response_wine_average_price_usd,
                'region_display', response_wine_region_display,
                'region_key', response_wine_region_key,
                'wfs_nam_display', response_wine_wfs_nam_display,
                'wfs_nam_key', response_wine_wfs_nam_key
              ),
              'sensory', jsonb_build_object(
                'aroma', response_sensory_aroma,
                'tasting_notes', response_sensory_tasting_notes,
                'food_pairing', response_sensory_food_pairing
              ),
              'serving', jsonb_build_object(
                'temp_min_c', response_serving_temp_min_c,
                'temp_max_c', response_serving_temp_max_c,
                'decanting_minutes', response_serving_decanting_minutes
              ),
              'ratings', jsonb_build_object(
                'avg_rating', response_ratings_avg_rating,
                'reviews', response_ratings_reviews,
                'source', response_ratings_source
              ),
              'debug', jsonb_build_object(
                'confidence', response_debug_confidence,
                'selected_id', response_debug_selected_id,
                'errors', coalesce(response_debug_errors, '[]')::jsonb
              ),
              'region_match', jsonb_build_object(
                'api_region_display', response_region_match_api_region_display,
                'api_region_key', response_region_match_api_region_key,
                'matched_feature_count', response_region_match_matched_feature_count,
                'wfs_matches', coalesce(response_region_match_wfs_matches, '[]')::jsonb
              )
            ),
            'error', error_text,
            'manual', jsonb_build_object(
              'brand', manual_brand,
              'producer', manual_producer,
              'year', manual_year,
              'region', manual_region,
              'country', manual_country,
              'wine_type', manual_wine_type,
              'is_german', manual_is_german,
              'city', manual_city,
              'score', manual_score,
              'notes', manual_notes,
              'lat', manual_lat,
              'lng', manual_lng,
              'image_path', manual_image_path,
              'image_data_url', manual_image_data_url,
              'timestamp', manual_timestamp
            ),
            'created_at', created_at
          )
        )
      ),
      '[]'::jsonb
    )
  )
  from public.wine_logs;
$$;

alter table public.wine_logs enable row level security;

drop policy if exists wine_logs_select_authenticated on public.wine_logs;
drop policy if exists wine_logs_insert_service_role on public.wine_logs;
drop policy if exists wine_logs_update_service_role on public.wine_logs;
drop policy if exists wine_logs_delete_service_role on public.wine_logs;

create policy wine_logs_select_authenticated
on public.wine_logs
for select
to authenticated
using (true);

create policy wine_logs_insert_service_role
on public.wine_logs
for insert
to service_role
with check (true);

create policy wine_logs_update_service_role
on public.wine_logs
for update
to service_role
using (true)
with check (true);

create policy wine_logs_delete_service_role
on public.wine_logs
for delete
to service_role
using (true);

revoke all on function public.insert_wine_log_from_feature(text, jsonb, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.insert_wine_log_from_feature(text, jsonb, jsonb, jsonb, text, jsonb) to service_role;

revoke all on function public.get_wine_logs_feature_collection() from public, anon;
grant execute on function public.get_wine_logs_feature_collection() to service_role;
