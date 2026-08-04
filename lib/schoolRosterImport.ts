export const rosterImportRoles = ["学生", "支持老师", "家长"] as const;

export type RosterImportRole = (typeof rosterImportRoles)[number];

export type RosterImportRow = {
  rowNumber: number;
  name: string;
  email: string;
  role: RosterImportRole;
  teacherEmail: string;
  guardianEmail: string;
};

export type RosterImportResult = {
  rows: RosterImportRow[];
  errors: string[];
};

const headerAliases = {
  name: ["姓名", "name"],
  email: ["邮箱", "email"],
  role: ["身份", "角色", "role"],
  teacherEmail: ["老师邮箱", "负责老师邮箱", "teacher_email"],
  guardianEmail: ["家长邮箱", "guardian_email", "parent_email"],
} as const;

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return { cells, closed: !quoted };
}

function headerIndex(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header.trim().toLowerCase()));
}

function normalizeRole(value: string): RosterImportRole | null {
  const normalized = value.trim().toLowerCase();
  if (["学生", "student"].includes(normalized)) return "学生";
  if (["支持老师", "老师", "teacher", "school_support"].includes(normalized)) return "支持老师";
  if (["家长", "监护人", "parent", "guardian"].includes(normalized)) return "家长";
  return null;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseSchoolRosterCsv(source: string, limit = 100): RosterImportResult {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return { rows: [], errors: ["文件是空的。"] };

  const lines = normalized.split("\n").filter((line) => line.trim());
  const header = parseCsvLine(lines[0]);
  if (!header.closed) return { rows: [], errors: ["表头里有未闭合的英文双引号。"] };

  const headers = header.cells.map((cell) => cell.trim().toLowerCase());
  const indexes = {
    name: headerIndex(headers, headerAliases.name),
    email: headerIndex(headers, headerAliases.email),
    role: headerIndex(headers, headerAliases.role),
    teacherEmail: headerIndex(headers, headerAliases.teacherEmail),
    guardianEmail: headerIndex(headers, headerAliases.guardianEmail),
  };
  const missingHeaders = [
    indexes.name < 0 ? "姓名" : "",
    indexes.email < 0 ? "邮箱" : "",
    indexes.role < 0 ? "身份" : "",
  ].filter(Boolean);
  if (missingHeaders.length) {
    return { rows: [], errors: [`缺少必填表头：${missingHeaders.join("、")}。`] };
  }

  if (lines.length - 1 > limit) {
    return { rows: [], errors: [`一次最多导入 ${limit} 人，请拆成多个文件。`] };
  }

  const rows: RosterImportRow[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();

  lines.slice(1).forEach((line, offset) => {
    const rowNumber = offset + 2;
    const parsed = parseCsvLine(line);
    if (!parsed.closed) {
      errors.push(`第 ${rowNumber} 行有未闭合的英文双引号。`);
      return;
    }
    const cell = (index: number) => index < 0 ? "" : (parsed.cells[index] || "").trim();
    const name = cell(indexes.name);
    const email = cell(indexes.email).toLowerCase();
    const role = normalizeRole(cell(indexes.role));
    const teacherEmail = cell(indexes.teacherEmail).toLowerCase();
    const guardianEmail = cell(indexes.guardianEmail).toLowerCase();

    if (!name) errors.push(`第 ${rowNumber} 行缺少姓名。`);
    if (name.length > 50) errors.push(`第 ${rowNumber} 行姓名超过 50 个字符。`);
    if (!validEmail(email)) errors.push(`第 ${rowNumber} 行邮箱格式不正确。`);
    if (!role) errors.push(`第 ${rowNumber} 行身份只能填写学生、支持老师或家长。`);
    if (seenEmails.has(email)) errors.push(`第 ${rowNumber} 行邮箱与文件中前面的成员重复。`);
    if (teacherEmail && !validEmail(teacherEmail)) errors.push(`第 ${rowNumber} 行老师邮箱格式不正确。`);
    if (guardianEmail && !validEmail(guardianEmail)) errors.push(`第 ${rowNumber} 行家长邮箱格式不正确。`);
    if (role && role !== "学生" && (teacherEmail || guardianEmail)) {
      errors.push(`第 ${rowNumber} 行只有学生可以填写老师或家长邮箱。`);
    }
    if (!name || name.length > 50 || !validEmail(email) || !role) return;

    seenEmails.add(email);
    rows.push({ rowNumber, name, email, role, teacherEmail, guardianEmail });
  });

  return { rows, errors: Array.from(new Set(errors)) };
}

export function rosterImportTemplate() {
  return [
    "姓名,邮箱,身份,老师邮箱,家长邮箱",
    "王老师,teacher@example.com,支持老师,,",
    "李女士,parent@example.com,家长,,",
    "小林,student@example.com,学生,teacher@example.com,parent@example.com",
  ].join("\n");
}
