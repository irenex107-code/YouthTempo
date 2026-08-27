import nodemailer from "nodemailer";

export type DutyAlertDeliveryStatus = "sent" | "failed" | "not_configured";

export type DutyAlertKind = "student_request" | "safety_review";

type DutyAlertInput = {
  messageId: string;
  createdAt: string;
  kind: DutyAlertKind;
};

type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
  dashboardUrl: string;
};

const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;

function cleanEnvironmentValue(value: string | undefined) {
  return value?.trim() || "";
}

export function isPilotDutyEnabled() {
  return cleanEnvironmentValue(process.env.PILOT_DUTY_ENABLED).toLowerCase() === "true";
}

function smtpConfiguration(): SmtpConfiguration | null {
  if (!isPilotDutyEnabled()) return null;

  const host = cleanEnvironmentValue(process.env.PILOT_DUTY_SMTP_HOST);
  const port = Number(cleanEnvironmentValue(process.env.PILOT_DUTY_SMTP_PORT));
  const user = cleanEnvironmentValue(process.env.PILOT_DUTY_SMTP_USER);
  const pass = cleanEnvironmentValue(process.env.PILOT_DUTY_SMTP_PASSWORD);
  const from = cleanEnvironmentValue(process.env.PILOT_DUTY_SMTP_FROM);
  const to = cleanEnvironmentValue(process.env.PILOT_DUTY_ALERT_TO);
  const dashboardUrl = cleanEnvironmentValue(process.env.PILOT_DUTY_DASHBOARD_URL)
    || "https://youthtempo.com/admin#message-duty";

  if (
    !host
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || !user
    || !pass
    || !emailPattern.test(from)
    || !emailPattern.test(to)
  ) return null;

  try {
    const parsedUrl = new URL(dashboardUrl);
    const isLocal = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
    if (parsedUrl.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && isLocal)) return null;
  } catch {
    return null;
  }

  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    from,
    to,
    dashboardUrl,
  };
}

export function isPilotDutyEmailConfigured() {
  return smtpConfiguration() !== null;
}

export function buildPilotDutyAlertText(input: DutyAlertInput, dashboardUrl: string) {
  const kind = input.kind === "safety_review" ? "高风险内容待复核" : "学生主动请求联系";
  return [
    "YouthTempo 试点值班提醒",
    "",
    `提醒类型：${kind}`,
    `事件编号：${input.messageId}`,
    `提交时间：${input.createdAt}`,
    "",
    "邮件不包含学生姓名、邮箱或留言正文。请登录受权限保护的值班后台查看并处理：",
    dashboardUrl,
    "",
    "此提醒不是紧急服务替代方案，请按已确认的试点值班流程处理。",
  ].join("\n");
}

export async function sendPilotDutyAlert(input: DutyAlertInput): Promise<DutyAlertDeliveryStatus> {
  const configuration = smtpConfiguration();
  if (!configuration) return "not_configured";

  try {
    const transporter = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      requireTLS: !configuration.secure,
      auth: {
        user: configuration.user,
        pass: configuration.pass,
      },
      connectionTimeout: 4_000,
      greetingTimeout: 4_000,
      socketTimeout: 6_000,
    });
    await transporter.sendMail({
      from: configuration.from,
      to: configuration.to,
      subject: input.kind === "safety_review"
        ? "[YouthTempo] 高优先级值班提醒"
        : "[YouthTempo] 新的学生联系请求",
      text: buildPilotDutyAlertText(input, configuration.dashboardUrl),
    });
    return "sent";
  } catch {
    return "failed";
  }
}
