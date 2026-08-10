#!/usr/bin/env bash
# =============================================================================
# env-init.sh — tạo state bucket cho remote state (chạy 1 lần khi setup platform)
#   Usage: env-init.sh [BUCKET]
# =============================================================================
set -euo pipefail

BUCKET="${1:-iac-platform-state-790400775134}"
REGION="${AWS_REGION:-ap-southeast-1}"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "✅ Bucket $BUCKET đã tồn tại."
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  aws s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled >/dev/null
  aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
  echo "✅ Đã tạo $BUCKET (versioning + encryption)"
fi
