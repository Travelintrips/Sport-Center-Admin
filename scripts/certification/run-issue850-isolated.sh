#!/usr/bin/env bash
# Issue #850: disposable fixture tests only. Never connects to Supabase or X904.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
SQL="scripts/certification/issue850-operator-device-fixture.sql"
[[ -f "$SQL" ]] || { echo "MISSING_FIXTURE"; exit 2; }
command -v docker >/dev/null || { echo "DOCKER_REQUIRED"; exit 2; }
name="sc-issue850-cert-$RANDOM-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --rm --network none --name "$name" \
  -e POSTGRES_PASSWORD=ephemeral_local_only postgres:17-alpine >/dev/null
ready=0
for attempt in $(seq 1 45); do
  if docker exec -u postgres "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo "POSTGRES_FIXTURE_NOT_READY"; exit 1; }
created=0
for attempt in $(seq 1 45); do
  if docker exec -u postgres "$name" createdb -U postgres cert_source >/dev/null 2>&1; then created=1; break; fi
  sleep 1
done
[[ "$created" == 1 ]] || { echo "POSTGRES_NOT_ACCEPTING_DATABASE_CREATION"; exit 1; }
docker exec -i -u postgres "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d cert_source < "$SQL" >/dev/null
query() {
  docker exec -u postgres "$name" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d "$1" -c "$2"
}
assert_eq() {
  local got="$1" expected="$2" test="$3"
  if [[ "$got" != "$expected" ]]; then echo "FAIL $test got=$got expected=$expected"; exit 1; fi
  echo "PASS $test"
}
assert_eq "$(query cert_source 'SET ROLE cert_operator_a; SELECT count(*) FROM cert_multisite.bookings')" 1 "operator_A_own_bookings"
assert_eq "$(query cert_source 'SET ROLE cert_operator_b; SELECT count(*) FROM cert_multisite.bookings')" 1 "operator_B_own_bookings"
assert_eq "$(query cert_source 'SET ROLE cert_operator_a; SELECT count(*) FROM cert_multisite.payments WHERE operator_id=2')" 0 "operator_A_denied_B_payments"
assert_eq "$(query cert_source 'SET ROLE cert_operator_b; SELECT count(*) FROM cert_multisite.journal WHERE operator_id=1')" 0 "operator_B_denied_A_journal"
assert_eq "$(query cert_source "SET ROLE cert_operator_a; WITH u AS (UPDATE cert_multisite.device_commands SET state='acked' WHERE id=801 RETURNING id) SELECT count(*) FROM u")" 0 "cross_device_ACK_denied"
assert_eq "$(query cert_source "SET ROLE cert_operator_a; WITH u AS (UPDATE cert_multisite.device_commands SET state='acked' WHERE id=701 RETURNING id) SELECT count(*) FROM u")" 1 "own_device_ACK_allowed"
assert_eq "$(query cert_source "SET ROLE cert_operator_b; SELECT state FROM cert_multisite.device_commands WHERE id=801")" queued "other_device_unchanged"
if docker exec -u postgres "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d cert_source -c "SET ROLE cert_operator_a; INSERT INTO cert_multisite.payments VALUES (999,1,201,1)" >/dev/null 2>&1; then
  echo "FAIL cross_operator_payment_FK_accepted"; exit 1
fi
echo "PASS cross_operator_payment_FK_denied"
if docker exec -u postgres "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d cert_source -c "SET ROLE cert_operator_a; INSERT INTO cert_multisite.bookings VALUES (999,2,'FORBIDDEN')" >/dev/null 2>&1; then
  echo "FAIL cross_operator_RLS_insert_accepted"; exit 1
fi
echo "PASS cross_operator_RLS_insert_denied"
assert_eq "$(query cert_source "INSERT INTO cert_multisite.journal VALUES (999,1,'cert-payment-501',100000) ON CONFLICT(operator_id,event_key) DO NOTHING; SELECT count(*) FROM cert_multisite.journal WHERE operator_id=1")" 1 "journal_replay_idempotent"
# No PROD/DEV data is touched. Dump and restore this fixture to another isolated database.
docker exec -u postgres "$name" sh -c 'pg_dump -U postgres -d cert_source --format=custom --file=/tmp/cert_source.dump'
docker exec -u postgres "$name" createdb -U postgres cert_restored
docker exec -u postgres "$name" pg_restore -U postgres -d cert_restored --no-owner /tmp/cert_source.dump
for table in bookings payments devices device_commands journal; do
  source_sum="$(query cert_source "SELECT coalesce(md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)), '') FROM cert_multisite.$table t")"
  restored_sum="$(query cert_restored "SELECT coalesce(md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)), '') FROM cert_multisite.$table t")"
  assert_eq "$restored_sum" "$source_sum" "restore_checksum_$table"
done
assert_eq "$(query cert_restored 'SET ROLE cert_operator_b; SELECT count(*) FROM cert_multisite.bookings')" 1 "restored_RLS_B"
assert_eq "$(query cert_restored "SELECT count(*) FROM cert_multisite.device_commands WHERE operator_id=2 AND state='queued'")" 1 "restored_device_B_unchanged"
echo "PASS ISOLATED_OPERATOR_DEVICE_AND_RESTORE_FIXTURE"
echo "NOT_A_PRODUCTION_RELEASE_CERTIFICATE: real API/storage/2nd-device integration and real recovery still required"
