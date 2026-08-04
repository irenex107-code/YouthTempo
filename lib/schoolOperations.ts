type Person = { id: string };

export type OperationsDirectory = {
  school_id: string;
  leaders: Person[];
  teachers: Person[];
  students: Person[];
  guardians: Person[];
  assignments: Array<{ student_user_id: string }>;
  guardianAssignments: Array<{ student_user_id: string }>;
};

export type OperationsTrend = {
  school_id: string;
  school_name: string;
  student_count: number;
  record_count: number;
  active_student_count: number;
};

export type SchoolOperationsRow = {
  schoolId: string;
  schoolName: string;
  students: number;
  teachers: number;
  guardians: number;
  activeStudents: number;
  records: number;
  participationRate: number;
  teacherCoverage: number;
  guardianCoverage: number;
  attentionCount: number;
  readiness: "待建档" | "补关系" | "开始使用" | "稳定试点";
};

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

export function buildSchoolOperations(input: {
  directories: OperationsDirectory[];
  trends: OperationsTrend[];
  attentionQueue: Array<{ school_id: string }>;
}) {
  const rows: SchoolOperationsRow[] = input.trends.map((trend) => {
    const directory = input.directories.find((item) => item.school_id === trend.school_id);
    const students = directory?.students || [];
    const studentIds = new Set(students.map((student) => student.id));
    const studentsWithTeacher = new Set(
      (directory?.assignments || [])
        .map((assignment) => assignment.student_user_id)
        .filter((id) => studentIds.has(id)),
    ).size;
    const studentsWithGuardian = new Set(
      (directory?.guardianAssignments || [])
        .map((assignment) => assignment.student_user_id)
        .filter((id) => studentIds.has(id)),
    ).size;
    const participationRate = percentage(trend.active_student_count, trend.student_count);
    const teacherCoverage = percentage(studentsWithTeacher, students.length);
    const guardianCoverage = percentage(studentsWithGuardian, students.length);
    const readiness: SchoolOperationsRow["readiness"] = !students.length
      ? "待建档"
      : teacherCoverage < 100 || guardianCoverage < 100
        ? "补关系"
        : participationRate < 50
          ? "开始使用"
          : "稳定试点";

    return {
      schoolId: trend.school_id,
      schoolName: trend.school_name,
      students: trend.student_count,
      teachers: directory?.teachers.length || 0,
      guardians: directory?.guardians.length || 0,
      activeStudents: trend.active_student_count,
      records: trend.record_count,
      participationRate,
      teacherCoverage,
      guardianCoverage,
      attentionCount: input.attentionQueue.filter((item) => item.school_id === trend.school_id).length,
      readiness,
    };
  });

  const totals = rows.reduce(
    (total, row) => ({
      schools: total.schools + 1,
      students: total.students + row.students,
      activeStudents: total.activeStudents + row.activeStudents,
      records: total.records + row.records,
      attentionCount: total.attentionCount + row.attentionCount,
    }),
    { schools: 0, students: 0, activeStudents: 0, records: 0, attentionCount: 0 },
  );

  return {
    rows,
    totals: {
      ...totals,
      participationRate: percentage(totals.activeStudents, totals.students),
      stableSchools: rows.filter((row) => row.readiness === "稳定试点").length,
    },
  };
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function schoolOperationsCsv(rows: SchoolOperationsRow[]) {
  return [
    ["学校", "阶段", "学生", "老师", "家长", "近4周参与学生", "参与率", "SWEET记录", "老师关系覆盖", "家长关系覆盖", "待了解人数"],
    ...rows.map((row) => [
      row.schoolName,
      row.readiness,
      row.students,
      row.teachers,
      row.guardians,
      row.activeStudents,
      `${row.participationRate}%`,
      row.records,
      `${row.teacherCoverage}%`,
      `${row.guardianCoverage}%`,
      row.attentionCount,
    ]),
  ].map((row) => row.map(csvCell).join(",")).join("\n");
}
