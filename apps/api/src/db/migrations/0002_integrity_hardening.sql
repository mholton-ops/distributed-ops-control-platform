alter table sync_batch add column if not exists deduplicated_event_count integer not null default 0;
alter table sync_batch add column if not exists request_hash varchar(64);
update sync_batch
set request_hash = encode(digest(id::text, 'sha256'), 'hex')
where request_hash is null;
alter table sync_batch alter column request_hash set not null;

alter table event_log add column if not exists event_hash varchar(64);
update event_log
set event_hash = encode(digest(id::text, 'sha256'), 'hex')
where event_hash is null;
alter table event_log alter column event_hash set not null;

alter table alert add column if not exists fingerprint varchar(64);
update alert
set fingerprint = encode(digest(id::text, 'sha256'), 'hex')
where fingerprint is null;
alter table alert alter column fingerprint set not null;
create unique index if not exists alert_fingerprint_unq on alert(fingerprint);
alter table alert add column if not exists last_detected_at timestamptz not null default now();
alter table alert add column if not exists occurrence_count integer not null default 1;
alter table alert add column if not exists acknowledged_by varchar(96);
alter table alert add column if not exists acknowledged_at timestamptz;

alter table reconciliation_case add column if not exists version integer not null default 1;

create table if not exists sync_batch_event_attempt (
  id uuid primary key,
  sync_batch_id uuid not null references sync_batch(id),
  event_index integer not null,
  source_site_event_id varchar(128) not null,
  event_hash varchar(64) not null,
  disposition varchar(24) not null,
  event_id uuid references event_log(id),
  error_code varchar(64),
  error_message varchar(500),
  attempted_at timestamptz not null default now(),
  constraint sync_batch_event_attempt_index_nonnegative check (event_index >= 0),
  constraint sync_batch_event_attempt_disposition_check check (disposition in ('accepted', 'deduplicated', 'rejected'))
);

create index if not exists idx_sync_batch_event_attempt_batch
  on sync_batch_event_attempt(sync_batch_id, event_index);
create index if not exists idx_sync_batch_event_attempt_source
  on sync_batch_event_attempt(source_site_event_id);
create unique index if not exists reconciliation_case_one_open_per_alert_unq
  on reconciliation_case(alert_id) where alert_id is not null and status = 'open';

alter table sync_batch drop constraint if exists sync_batch_counts_nonnegative;
alter table sync_batch add constraint sync_batch_counts_nonnegative check (
  queued_event_count >= 0 and accepted_event_count >= 0 and
  rejected_event_count >= 0 and deduplicated_event_count >= 0
);
alter table sync_batch drop constraint if exists sync_batch_status_check;
update sync_batch set status = 'processing' where status = 'started';
alter table sync_batch add constraint sync_batch_status_check
  check (status in ('processing', 'completed', 'partial', 'failed'));

alter table alert drop constraint if exists alert_occurrence_count_positive;
alter table alert add constraint alert_occurrence_count_positive check (occurrence_count > 0);
alter table alert drop constraint if exists alert_status_check;
alter table alert add constraint alert_status_check
  check (status in ('open', 'acknowledged', 'resolved'));

create or replace function reject_event_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'event_log is append-only';
end;
$$;

drop trigger if exists event_log_append_only on event_log;
create trigger event_log_append_only
before update or delete on event_log
for each row execute function reject_event_log_mutation();
