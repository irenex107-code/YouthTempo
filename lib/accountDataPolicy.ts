export const ACCOUNT_DATA_POLICY_VERSION = "2026-08-03";
export const ACCOUNT_DELETION_AUDIT_RETENTION_MONTHS = 24;

export const accountDataRetention = {
  activeAccount: "账号存续期间，仅为提供服务、展示历史和履行安全责任而保存。用户可逐条删除自己的 SWEET 记录，也可随时注销账号。",
  accountDeletion: "注销确认后，生产数据库中的账号及关联个人数据立即删除；导出文件由浏览器直接下载，服务器不保存副本。",
  safetyAudit: "社区审核动作和不含明文邮箱、用户编号的最小注销审计最多保存 24 个月，用于安全复核和证明删除已经执行，到期清理。",
  backups: "灾难恢复副本中的删除到期规则将在数据库备份与恢复演练完成后核验并公布；恢复时必须重新执行已登记的删除要求。",
} as const;
