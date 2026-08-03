import { expect, test } from "@playwright/test";
import { findStudentRelationshipGaps } from "../lib/schoolRelationshipGaps";

const students = [
  { id: "student-a", email: "a@example.com", display_name: "学生甲" },
  { id: "student-b", email: "b@example.com", display_name: "学生乙" },
  { id: "student-c", email: "c@example.com", display_name: "学生丙" },
];

test("分别识别未分配老师和未关联家长的学生", () => {
  const gaps = findStudentRelationshipGaps({
    students,
    assignments: [
      { student_user_id: "student-a" },
      { student_user_id: "student-b" },
    ],
    guardianAssignments: [
      { student_user_id: "student-a" },
      { student_user_id: "student-c" },
    ],
  });

  expect(gaps.withoutTeacher.map((student) => student.id)).toEqual(["student-c"]);
  expect(gaps.withoutGuardian.map((student) => student.id)).toEqual(["student-b"]);
});

test("重复关系不会影响判断，空学校没有待补充学生", () => {
  expect(findStudentRelationshipGaps({
    students: [students[0]],
    assignments: [
      { student_user_id: "student-a" },
      { student_user_id: "student-a" },
    ],
    guardianAssignments: [{ student_user_id: "student-a" }],
  })).toEqual({ withoutTeacher: [], withoutGuardian: [] });

  expect(findStudentRelationshipGaps({
    students: [],
    assignments: [],
    guardianAssignments: [],
  })).toEqual({ withoutTeacher: [], withoutGuardian: [] });
});
