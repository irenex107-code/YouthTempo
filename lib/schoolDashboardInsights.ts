import {
  latestSweetRecordsPerUserDay,
  sweetRecordCalendarDayNumber,
} from "@/lib/sweetRecordDays";

export type InsightRecord = {
  user_id: string;
  school_id: string;
  created_at: string;
};

export type InsightTeacher = {
  school_id: string;
  teacher_user_id: string;
  teacher_name: string;
  student_ids: string[];
};

export type InsightSchool = {
  school_id: string;
  school_name: string;
  student_count: number;
};

export type ParticipationStudent = {
  school_id: string;
  school_name: string;
  user_id: string;
  student_name: string;
  student_email: string;
};

export type StudentParticipationStat = ParticipationStudent & {
  record_count: number;
  total_record_days: number;
  last_7_active_days: number;
  last_28_active_days: number;
  current_streak_days: number;
  longest_streak_days: number;
  latest_record_at: string | null;
};

const dayMs = 24 * 60 * 60 * 1000;

function longestConsecutiveRun(days: number[]) {
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  days.forEach((day) => {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  });
  return longest;
}

export function buildStudentParticipationStats(
  records: InsightRecord[],
  students: ParticipationStudent[],
  now = new Date(),
  timeZone = "Asia/Shanghai",
): StudentParticipationStat[] {
  const today = sweetRecordCalendarDayNumber(now, timeZone);
  if (today === null) return [];

  return students.map((student) => {
    const studentRecords = latestSweetRecordsPerUserDay(
      records.filter((record) => record.school_id === student.school_id && record.user_id === student.user_id),
      timeZone,
    )
      .map((record) => ({ ...record, day: sweetRecordCalendarDayNumber(record.created_at, timeZone) }))
      .filter((record): record is InsightRecord & { day: number } => record.day !== null && record.day <= today)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
    const days = Array.from(new Set(studentRecords.map((record) => record.day))).sort((a, b) => a - b);
    const daySet = new Set(days);
    const latestDay = days.at(-1) ?? null;
    let currentStreakDays = 0;
    if (latestDay !== null && latestDay >= today - 1) {
      for (let day = latestDay; daySet.has(day); day -= 1) currentStreakDays += 1;
    }

    return {
      ...student,
      record_count: days.length,
      total_record_days: days.length,
      last_7_active_days: days.filter((day) => day >= today - 6).length,
      last_28_active_days: days.filter((day) => day >= today - 27).length,
      current_streak_days: currentStreakDays,
      longest_streak_days: longestConsecutiveRun(days),
      latest_record_at: studentRecords[0]?.created_at || null,
    };
  });
}

function recordsInRange(records: InsightRecord[], start: number, end: number) {
  return records.filter((record) => {
    const createdAt = new Date(record.created_at).getTime();
    return createdAt >= start && createdAt < end;
  });
}

function uniqueStudents(records: InsightRecord[]) {
  return new Set(records.map((record) => record.user_id)).size;
}

export function buildTeacherWeeklySummaries(
  records: InsightRecord[],
  teachers: InsightTeacher[],
  attentionStudentIds: string[],
  now = new Date(),
) {
  const end = now.getTime();
  const currentStart = end - 7 * dayMs;
  const previousStart = end - 14 * dayMs;
  const attentionSet = new Set(attentionStudentIds);

  return teachers.map((teacher) => {
    const studentSet = new Set(teacher.student_ids);
    const teacherRecords = latestSweetRecordsPerUserDay(
      records.filter(
        (record) => record.school_id === teacher.school_id && studentSet.has(record.user_id),
      ),
    );
    const currentRecords = recordsInRange(teacherRecords, currentStart, end);
    const previousRecords = recordsInRange(teacherRecords, previousStart, currentStart);
    const latestRecordAt = teacherRecords.reduce<string | null>(
      (latest, record) => !latest || record.created_at > latest ? record.created_at : latest,
      null,
    );

    return {
      school_id: teacher.school_id,
      teacher_user_id: teacher.teacher_user_id,
      teacher_name: teacher.teacher_name,
      student_count: teacher.student_ids.length,
      current_record_count: currentRecords.length,
      previous_record_count: previousRecords.length,
      record_change: currentRecords.length - previousRecords.length,
      active_student_count: uniqueStudents(currentRecords),
      attention_student_count: teacher.student_ids.filter((id) => attentionSet.has(id)).length,
      latest_record_at: latestRecordAt,
      period_start: new Date(currentStart).toISOString(),
      period_end: now.toISOString(),
    };
  });
}

export function buildSchoolMonthlyTrends(
  records: InsightRecord[],
  schools: InsightSchool[],
  now = new Date(),
) {
  const end = now.getTime();

  return schools.map((school) => {
    const schoolRecords = latestSweetRecordsPerUserDay(
      records.filter((record) => record.school_id === school.school_id),
    );
    const weeks = Array.from({ length: 4 }, (_, index) => {
      const weekEnd = end - (3 - index) * 7 * dayMs;
      const weekStart = weekEnd - 7 * dayMs;
      const weekRecords = recordsInRange(schoolRecords, weekStart, weekEnd);
      return {
        label: index === 3 ? "本周" : `前 ${3 - index} 周`,
        start: new Date(weekStart).toISOString(),
        end: new Date(weekEnd).toISOString(),
        record_count: weekRecords.length,
        active_student_count: uniqueStudents(weekRecords),
      };
    });
    const monthRecords = recordsInRange(schoolRecords, end - 28 * dayMs, end);

    return {
      school_id: school.school_id,
      school_name: school.school_name,
      student_count: school.student_count,
      record_count: monthRecords.length,
      active_student_count: uniqueStudents(monthRecords),
      weeks,
      period_start: new Date(end - 28 * dayMs).toISOString(),
      period_end: now.toISOString(),
    };
  });
}
