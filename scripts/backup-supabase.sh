#!/usr/bin/env bash
set -euo pipefail

umask 077

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "缺少 SUPABASE_DB_URL。请使用正式库的直连或 Session pooler 连接串，并只通过环境变量传入。" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Supabase CLI 导出依赖 Docker；请先启动 Docker Desktop。" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "缺少 pnpm，无法运行固定版本的 Supabase CLI。" >&2
  exit 1
fi

backup_root="${YOUTHTEMPO_BACKUP_DIR:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root%/}/${timestamp}"
mkdir -p "$backup_dir"

cli=(pnpm dlx supabase@2.53.6 db dump --db-url "$SUPABASE_DB_URL")
"${cli[@]}" --role-only --file "$backup_dir/roles.sql"
"${cli[@]}" --file "$backup_dir/schema.sql"
"${cli[@]}" --data-only --use-copy --file "$backup_dir/data.sql"

(
  cd "$backup_dir"
  shasum -a 256 roles.sql schema.sql data.sql > SHA256SUMS
)

cat > "$backup_dir/metadata.txt" <<EOF
created_at_utc=$timestamp
source_project_ref=saqkzfsmabsgbwdvuras
cli_version=2.53.6
format=roles-schema-data-sql
EOF

echo "备份完成：$backup_dir"
echo "下一步：加密后复制到项目目录之外的受控存储，并按 docs/DATABASE_RECOVERY.md 执行隔离恢复演练。"
