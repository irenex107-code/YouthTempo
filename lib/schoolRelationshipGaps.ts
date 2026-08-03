type Student = {
  id: string;
  email: string;
  display_name: string;
};

type StudentAssignment = {
  student_user_id: string;
};

type SchoolRelationships = {
  students: Student[];
  assignments: StudentAssignment[];
  guardianAssignments: StudentAssignment[];
};

export function findStudentRelationshipGaps(directory: SchoolRelationships) {
  const studentsWithTeacher = new Set(
    directory.assignments.map((assignment) => assignment.student_user_id),
  );
  const studentsWithGuardian = new Set(
    directory.guardianAssignments.map((assignment) => assignment.student_user_id),
  );

  return {
    withoutTeacher: directory.students.filter((student) => !studentsWithTeacher.has(student.id)),
    withoutGuardian: directory.students.filter((student) => !studentsWithGuardian.has(student.id)),
  };
}
