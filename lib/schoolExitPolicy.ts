export const SCHOOL_EXIT_POLICY_VERSION = "2026-08-03";

export const schoolExitRules = {
  access: "退出生效后，学校负责人、老师和其他学校角色立即失去该学校空间、学生记录和支持关系的访问权限。",
  personalData: "学生、家长和老师的个人账号不会因学校退出而删除；个人可继续查看、导出或注销自己的账号与数据。",
  relationships: "学校成员、师生关系、亲子关系和未完成邀请会解除；个人 SWEET 记录、留言和知情同意记录会移除学校归属。",
  schoolNotes: "仅为学校协作产生的跟进笔记在退出时删除；学校退出的最小审计最多保存 24 个月。",
} as const;
