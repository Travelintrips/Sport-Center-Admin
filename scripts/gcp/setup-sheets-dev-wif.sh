#!/usr/bin/env bash
# Run from authenticated Google Cloud Shell. No private key generation.
set -euo pipefail
PROJECT='sport-center-506306'
REPO='Travelintrips/Sport-Center-Admin'
POOL='sport-center-github-dev'
PROVIDER='github-actions'
SA_NAME='sport-center-sheets-dev-runner'
SECRET='GOOGLE_SERVICE_ACCOUNT_JSON'
BRANCH='refs/heads/feature/sheets-payment-events-safe-foundation-20261028'

gcloud config set project "$PROJECT" 1>/dev/null
ACCOUNT="$(gcloud auth list --filter='status:ACTIVE' --format='value(account)' | head -1)"
if [[ -z "$ACCOUNT" ]]; then echo 'ERROR: Authenticate Cloud Shell to the intended GCP project first.' >&2; exit 1; fi
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT" --display-name='Sport Center Sheets DEV GitHub runner'
fi
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --project="$PROJECT" --display-name='Sport Center GitHub DEV'
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
    --display-name='Sport Center GitHub Actions' \
    --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' \
    --attribute-condition="assertion.repository == '${REPO}' && assertion.ref == '${BRANCH}'"
fi
MEMBER="principalSet://iam.googleapis.com/projects/${NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT" \
  --member="$MEMBER" --role='roles/iam.workloadIdentityUser' >/dev/null
gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" \
  --member="serviceAccount:${SA}" --role='roles/secretmanager.secretAccessor' >/dev/null
printf '\nSET THESE TWO REPOSITORY ACTIONS SECRETS (identifiers, not private keys):\n'
printf 'SPORT_CENTER_DEV_WIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' "$NUMBER" "$POOL" "$PROVIDER"
printf 'SPORT_CENTER_DEV_WIF_SERVICE_ACCOUNT=%s\n' "$SA"
printf '\nNo service-account key was generated or accessed.\n'
