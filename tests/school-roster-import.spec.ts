import { expect, test } from "@playwright/test";
import { parseSchoolRosterCsv, rosterImportTemplate } from "../lib/schoolRosterImport";

test("批量名单模板可解析学生、老师、家长和负责关系", () => {
  const result = parseSchoolRosterCsv(rosterImportTemplate());

  expect(result.errors).toEqual([]);
  expect(result.rows).toHaveLength(3);
  expect(result.rows[2]).toMatchObject({
    name: "小林",
    email: "student@example.com",
    role: "学生",
    teacherEmail: "teacher@example.com",
    guardianEmail: "parent@example.com",
  });
});

test("支持中英文表头、BOM、引号和 Windows 换行", () => {
  const result = parseSchoolRosterCsv(
    '\uFEFFname,email,role,teacher_email,parent_email\r\n"小,林",student@example.com,student,teacher@example.com,parent@example.com',
  );

  expect(result.errors).toEqual([]);
  expect(result.rows[0]).toMatchObject({ name: "小,林", role: "学生" });
});

test("在写入前集中提示重复、身份和邮箱问题", () => {
  const result = parseSchoolRosterCsv([
    "姓名,邮箱,身份,老师邮箱,家长邮箱",
    "小林,bad-email,学生,,",
    "王老师,teacher@example.com,医生,,",
    "另一位,teacher@example.com,家长,,",
    "重复,teacher@example.com,家长,,",
  ].join("\n"));

  expect(result.errors.join(" ")).toContain("第 2 行邮箱格式不正确");
  expect(result.errors.join(" ")).toContain("第 3 行身份只能填写");
  expect(result.errors.join(" ")).toContain("第 5 行邮箱与文件中前面的成员重复");
});

test("限制单次人数并拒绝缺少必填表头的文件", () => {
  expect(parseSchoolRosterCsv("邮箱,身份\na@example.com,学生").errors[0]).toContain("姓名");

  const tooMany = [
    "姓名,邮箱,身份",
    ...Array.from({ length: 101 }, (_, index) => `学生${index},student${index}@example.com,学生`),
  ].join("\n");
  expect(parseSchoolRosterCsv(tooMany).errors[0]).toContain("最多导入 100 人");
});
