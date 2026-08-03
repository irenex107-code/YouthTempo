#!/usr/bin/env bash
set -euo pipefail

production_ref="saqkzfsmabsgbwdvuras"
backup_dir="${1:-}"

if [[ -z "$backup_dir" || ! -d "$backup_dir" ]]; then
  echo "用法：RESTORE_TARGET_DB_URL=... pnpm db:restore:drill -- backups/<UTC 时间>" >&2
  exit 1
fi
if [[ -z "${RESTORE_TARGET_DB_URL:-}" ]]; then
  echo "缺少 RESTORE_TARGET_DB_URL；目标必须是专用的空白隔离数据库。" >&2
  exit 1
fi
if [[ "$RESTORE_TARGET_DB_URL" == *"$production_ref"* ]]; then
  echo "拒绝操作：恢复演练目标指向 YouthTempo 正式 Supabase。" >&2
  exit 1
fi
if [[ "${ALLOW_EMPTY_RESTORE_TARGET:-}" != "I_HAVE_VERIFIED_THIS_IS_DISPOSABLE" ]]; then
  echo "请先核对目标为空白、可丢弃数据库，再设置 ALLOW_EMPTY_RESTORE_TARGET=I_HAVE_VERIFIED_THIS_IS_DISPOSABLE。" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "缺少 psql；请先安装与目标 PostgreSQL 兼容的客户端。" >&2
  exit 1
fi

for file in roles.sql schema.sql data.sql SHA256SUMS; do
  if [[ ! -f "$backup_dir/$file" ]]; then
    echo "备份不完整：缺少 $file" >&2
    exit 1
  fi
done

(
  cd "$backup_dir"
  shasum -a 256 -c SHA256SUMS
)

psql "$RESTORE_TARGET_DB_URL" --set ON_ERROR_STOP=on --single-transaction --file "$backup_dir/roles.sql"
psql "$RESTORE_TARGET_DB_URL" --set ON_ERROR_STOP=on --single-transaction --file "$backup_dir/schema.sql"
psql "$RESTORE_TARGET_DB_URL" --set ON_ERROR_STOP=on --single-transaction --file "$backup_dir/data.sql"

psql "$RESTORE_TARGET_DB_URL" --set ON_ERROR_STOP=on --tuples-only --command \
  "select 'schools=' || count(*) from public.schools union all select 'profiles=' || count(*) from public.profiles union all select 'sweet_records=' || count(*) from public.sweet_records;"

echo "隔离恢复命令已完成。仍需按 docs/DATABASE_RECOVERY.md 验证登录、RLS、注销重放和应用冒烟流程。"
