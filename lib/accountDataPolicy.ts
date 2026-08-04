export const ACCOUNT_DATA_POLICY_VERSION = "2026-08-03";
export const ACCOUNT_DELETION_AUDIT_RETENTION_MONTHS = 24;

export const accountDataRetention = {
  activeAccount: "账号存续期间，仅为提供服务、展示历史和履行安全责任而保存。用户可逐条删除自己的 SWEET 记录，也可随时注销账号。",
  accountDeletion: "注销确认后，账号及关联个人数据会立即删除；下载的数据副本不会由 YouthTempo 另行保存。",
  safetyAudit: "不含明文邮箱和用户编号的安全处理记录最多保存 24 个月，用于复核安全问题和确认删除已经完成，到期后清理。",
  backups: "备份副本的具体保存期限仍在确认，确认后会在本页公布。恢复服务时，已登记的删除要求仍会执行。",
} as const;
