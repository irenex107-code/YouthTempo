import { expect, test } from "@playwright/test";
import { buildSchoolOperations, schoolOperationsCsv } from "../lib/schoolOperations";

const operations = buildSchoolOperations({
  directories: [{
    school_id: "school-a",
    leaders: [{ id: "leader" }],
    teachers: [{ id: "teacher" }],
    students: [{ id: "student-a" }, { id: "student-b" }],
    guardians: [{ id: "guardian" }],
    assignments: [{ student_user_id: "student-a" }, { student_user_id: "student-b" }],
    guardianAssignments: [{ student_user_id: "student-a" }],
  }],
  trends: [{
    school_id: "school-a",
    school_name: "测试学校",
    student_count: 2,
    record_count: 5,
    active_student_count: 1,
  }],
  attentionQueue: [{ school_id: "school-a" }],
});

test("学校运营概览只汇总参与、关系覆盖和支持信号", () => {
  expect(operations.totals).toEqual({
    schools: 1,
    students: 2,
    activeStudents: 1,
    records: 5,
    attentionCount: 1,
    participationRate: 50,
    stableSchools: 0,
  });
  expect(operations.rows[0]).toMatchObject({
    participationRate: 50,
    teacherCoverage: 100,
    guardianCoverage: 50,
    readiness: "补关系",
  });
});

test("导出文件不包含学生标识，只包含学校汇总", () => {
  const csv = schoolOperationsCsv(operations.rows);
  expect(csv).toContain("测试学校,补关系,2,1,1,1,50%,5,100%,50%,1");
  expect(csv).not.toContain("student-a");
  expect(csv).not.toContain("leader");
});
