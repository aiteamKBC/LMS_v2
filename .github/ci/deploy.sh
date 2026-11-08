#!/usr/bin/env bash
# Deploy steps for .github/workflows/deploy-aws.yml (one sub-command per step).
# Env from the workflow: AWS_REGION ECR_REPOSITORY ECS_CLUSTER IMAGE_TAG BUCKET
# DISTRIBUTION SITE_URL ALB_METRIC_ID COMMIT, and REGISTRY for "push".
#
# Exact rollback: the image that last passed a full deploy (health, smoke test
# and the post-deploy watch) carries the ECR tag "last-good". A failed deploy
# re-points the running tag ($IMAGE_TAG, what the task definitions use) at
# that exact manifest and restarts the services, and restores the index.html
# that was live before.
set -euo pipefail

STATE=.deploy-state
mkdir -p "$STATE"

manifest_of() { # tag -> manifest JSON (empty if the tag doesn't exist)
  aws ecr batch-get-image --repository-name "$ECR_REPOSITORY" --image-ids imageTag="$1" \
    --query 'images[0].imageManifest' --output text 2>/dev/null | grep -v '^None$' || true
}

tag_manifest() { # tag manifest-json; no error if the tag already points there
  local out
  if ! out=$(aws ecr put-image --repository-name "$ECR_REPOSITORY" --image-tag "$1" \
               --image-manifest "$2" 2>&1); then
    grep -q ImageAlreadyExistsException <<<"$out" || { echo "$out" >&2; return 1; }
  fi
}

services() {
  if [ ! -s "$STATE/services" ]; then
    aws ecs list-services --cluster "$ECS_CLUSTER" --query 'serviceArns[]' --output text \
      | tr '\t' '\n' | sed 's#.*/##' | sort > "$STATE/services"
  fi
  cat "$STATE/services"
}

restart_all() {
  for s in $(services); do
    aws ecs update-service --cluster "$ECS_CLUSTER" --service "$s" \
      --force-new-deployment --query 'service.serviceName' --output text
  done
}

wait_stable() {
  # The waiter checks every 15 s for 10 min; allow two rounds
  aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services $(services) \
    || aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services $(services)
  aws ecs describe-services --cluster "$ECS_CLUSTER" --services $(services) \
    --query 'services[].[serviceName,runningCount,deployments[0].rolloutState]' --output table
  local failed
  failed=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services $(services) \
    --query "services[?deployments[0].rolloutState=='FAILED'].serviceName" --output text)
  [ -z "$failed" ] || { echo "::error::Rollout failed for: $failed"; return 1; }
}

invalidate() {
  local id
  id=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" \
         --paths '/*' --query Invalidation.Id --output text)
  aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION" --id "$id"
}

metric() { # name stat -> one value for the window
  aws cloudwatch get-metric-data --start-time "$WSTART" --end-time "$WEND" \
    --metric-data-queries "[{\"Id\":\"m\",\"MetricStat\":{\"Metric\":{\"Namespace\":\"AWS/ApplicationELB\",\"MetricName\":\"$1\",\"Dimensions\":[{\"Name\":\"LoadBalancer\",\"Value\":\"$ALB_METRIC_ID\"}]},\"Period\":120,\"Stat\":\"$2\"}}]" \
    --query 'MetricDataResults[0].Values[0]' --output text | sed 's/^None$/0/'
}

case "${1:?sub-command}" in
  push)
    REPO="$REGISTRY/$ECR_REPOSITORY"
    gunzip -c image.tar.gz | docker load
    # First run: whatever runs now becomes last-good
    if [ -z "$(manifest_of last-good)" ]; then
      current=$(manifest_of "$IMAGE_TAG")
      [ -z "$current" ] || tag_manifest last-good "$current"
    fi
    docker tag lms-backend:ci "$REPO:$COMMIT"
    docker tag lms-backend:ci "$REPO:$IMAGE_TAG"
    docker push -q "$REPO:$COMMIT"
    docker push -q "$REPO:$IMAGE_TAG"
    echo "pushed" > "$STATE/pushed"
    ;;

  roll)
    restart_all
    ;;

  wait)
    wait_stable
    ;;

  frontend)
    # Keep the live page so a rollback can restore it; old bundles are never
    # deleted, so that page keeps working
    aws s3 cp "s3://$BUCKET/index.html" "$STATE/previous-index.html" --only-show-errors || true
    aws s3 sync out "s3://$BUCKET" --only-show-errors \
      --exclude "*.html" --cache-control "public,max-age=31536000,immutable"
    aws s3 sync out "s3://$BUCKET" --only-show-errors \
      --exclude "*" --include "*.html" --cache-control "no-cache"
    echo "uploaded" > "$STATE/frontend"
    invalidate
    ;;

  smoke)
    fail=0
    check() { # path allowed-status-regex
      local code
      code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$SITE_URL$1" || echo 000)
      echo "$1 -> $code"
      [[ "$code" =~ $2 ]] || { echo "::error::$1 returned $code"; fail=1; }
    }
    check "/" '^200$'
    check "/health/" '^200$'
    check "/learner/home" '^200$'             # React route (CloudFront function)
    check "/login_api/me/" '^(200|401|403)$'  # Django answers, not a 5xx
    check "/learner_api/" '^(200|401|403|404)$'
    exit $fail
    ;;

  watch)
    # Every minute for WATCH_MINUTES (default 5), look at the last 2 complete
    # minutes on the load balancer. Two bad checks in a row fail the deploy:
    #   5xx >= 10 and > 5% of requests, or average response time > 3 s
    bad=0
    for i in $(seq 1 "${WATCH_MINUTES:-5}"); do
      sleep 60
      WEND=$(date -u -d '-1 min' +%Y-%m-%dT%H:%M:00Z)
      WSTART=$(date -u -d '-3 min' +%Y-%m-%dT%H:%M:00Z)
      req=$(metric RequestCount Sum)
      t5=$(metric HTTPCode_Target_5XX_Count Sum)
      e5=$(metric HTTPCode_ELB_5XX_Count Sum)
      rt=$(metric TargetResponseTime Average)
      verdict=$(python3 - "$req" "$t5" "$e5" "$rt" <<'PY'
import sys
req, t5, e5, rt = (float(x or 0) for x in sys.argv[1:])
errors = t5 + e5
bad = (errors >= 10 and errors > 0.05 * max(req, 1)) or rt > 3.0
print(f"{'BAD' if bad else 'ok'} requests={req:.0f} 5xx={errors:.0f} avg_response={rt:.2f}s")
PY
)
      echo "minute $i: $verdict"
      if [[ "$verdict" == BAD* ]]; then bad=$((bad + 1)); else bad=0; fi
      if [ "$bad" -ge 2 ]; then
        echo "::error::Errors or response time stayed high after the deploy"
        exit 1
      fi
    done
    ;;

  mark-good)
    tag_manifest last-good "$(manifest_of "$IMAGE_TAG")"
    echo "last-good = $COMMIT"
    ;;

  rollback)
    if [ -f "$STATE/pushed" ]; then
      good=$(manifest_of last-good)
      if [ -z "$good" ]; then
        echo "::error::No last-good image to roll back to"; exit 1
      fi
      tag_manifest "$IMAGE_TAG" "$good"
      restart_all
      wait_stable
      echo "::warning::Backend rolled back to the last-good image"
    fi
    if [ -f "$STATE/frontend" ] && [ -s "$STATE/previous-index.html" ]; then
      aws s3 cp "$STATE/previous-index.html" "s3://$BUCKET/index.html" \
        --cache-control "no-cache" --only-show-errors
      invalidate
      echo "::warning::Frontend page restored to the previous version"
    fi
    ;;

  *)
    echo "unknown sub-command $1" >&2; exit 2
    ;;
esac
