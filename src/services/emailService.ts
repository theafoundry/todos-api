import nodemailer, { type Transporter } from "nodemailer";
import { randomBytes } from "crypto";
import { config } from "../config";

export class EmailService {
  private transporter: Transporter | null;
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.baseUrl;

    if (!config.emailFeaturesEnabled) {
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: config.smtpHost || "smtp.ethereal.email",
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      dnsTimeout: 5_000,
      auth: {
        user: config.smtpUser || undefined,
        pass: config.smtpPass || undefined,
      },
    });
  }

  /**
   * Generate a random token
   */
  static generateToken(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Send email verification email
   */
  async sendVerificationEmail(email: string, token: string): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const verificationUrl = `${this.baseUrl}/auth/verify?token=${encodeURIComponent(token)}`;

    try {
      const info = await this.transporter.sendMail({
        from: config.smtpFrom || '"Planwren" <noreply@todoapp.com>',
        to: email,
        subject: "Verify your email address",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome to Planwren!</h2>
            <p>Planwren was previously called Todos. Account links continue to use the existing service domain.</p>
            <p>Please verify your email address by clicking the button below:</p>
            <p style="margin: 30px 0;">
              <a href="${verificationUrl}"
                 style="background-color: #667eea; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                Verify Email Address
              </a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 14px;">${verificationUrl}</p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              If you didn't create an account, please ignore this email.
            </p>
          </div>
        `,
      });

      console.log("Verification email sent:", info.messageId);
      if (process.env.NODE_ENV === "development") {
        console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
      }
    } catch (error) {
      console.error("Error sending verification email:", error);
      throw new Error("Failed to send verification email");
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const resetUrl = `${this.baseUrl}/auth?token=${encodeURIComponent(token)}`;

    try {
      const info = await this.transporter.sendMail({
        from: config.smtpFrom || '"Planwren" <noreply@todoapp.com>',
        to: email,
        subject: "Reset your password",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Request</h2>
            <p>Planwren was previously called Todos. Account links continue to use the existing service domain.</p>
            <p>You requested to reset your password. Click the button below to reset it:</p>
            <p style="margin: 30px 0;">
              <a href="${resetUrl}"
                 style="background-color: #667eea; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                Reset Password
              </a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 14px;">${resetUrl}</p>
            <p style="color: #ff4757; margin-top: 20px;">
              This link will expire in 1 hour.
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              If you didn't request a password reset, please ignore this email.
            </p>
          </div>
        `,
      });

      console.log("Password reset email sent:", info.messageId);
      if (process.env.NODE_ENV === "development") {
        console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
      }
    } catch (error) {
      console.error("Error sending password reset email:", error);
      throw new Error("Failed to send password reset email");
    }
  }

  /**
   * Send feedback submission confirmation
   */
  async sendFeedbackReceivedEmail(
    email: string,
    details: { title: string; type: string; id: string },
  ): Promise<void> {
    if (!this.transporter) return;

    const feedbackUrl = `${this.baseUrl}/feedback`;
    const typeLabel =
      details.type === "feature" ? "Feature request" : "Bug report";

    try {
      const info = await this.transporter.sendMail({
        from: config.smtpFrom || '"Planwren" <noreply@todoapp.com>',
        to: email,
        subject: "We received your feedback",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>We received your feedback</h2>
            <p>Thanks for taking the time to share this with us.</p>
            <table style="margin: 20px 0; border-collapse: collapse;">
              <tr><td style="padding: 4px 12px 4px 0; color: #666;">Type</td><td>${typeLabel}</td></tr>
              <tr><td style="padding: 4px 12px 4px 0; color: #666;">Title</td><td>${details.title}</td></tr>
              <tr><td style="padding: 4px 12px 4px 0; color: #666;">Reference</td><td style="font-family: monospace; font-size: 13px;">${details.id}</td></tr>
            </table>
            <p>You can track the status of your submissions anytime:</p>
            <p style="margin: 20px 0;">
              <a href="${feedbackUrl}"
                 style="background-color: #667eea; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                View your submissions
              </a>
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              You're receiving this because you submitted feedback on Planwren.
            </p>
          </div>
        `,
      });
      console.log("Feedback received email sent:", info.messageId);
    } catch (error) {
      console.error("Error sending feedback received email:", error);
    }
  }

  /**
   * Send a daily task reminder digest grouped by urgency.
   */
  async sendTaskReminderDigest(
    email: string,
    tasks: {
      overdue: Array<{ title: string; dueDate: string }>;
      dueToday: Array<{ title: string }>;
      dueTomorrow: Array<{ title: string }>;
    },
  ): Promise<number> {
    if (!this.transporter) return 0;

    const total =
      tasks.overdue.length + tasks.dueToday.length + tasks.dueTomorrow.length;
    if (total === 0) return 0;

    const renderList = (
      items: Array<{ title: string; dueDate?: string }>,
    ): string =>
      items
        .map(
          (t) =>
            `<li style="padding: 4px 0;">${t.title}${t.dueDate ? ` <span style="color:#ff4757;font-size:12px;">(due ${t.dueDate})</span>` : ""}</li>`,
        )
        .join("");

    let sectionsHtml = "";
    if (tasks.overdue.length > 0) {
      sectionsHtml += `
        <h3 style="color: #ff4757; margin: 16px 0 8px;">Overdue (${tasks.overdue.length})</h3>
        <ul style="margin: 0; padding-left: 20px;">${renderList(tasks.overdue)}</ul>
      `;
    }
    if (tasks.dueToday.length > 0) {
      sectionsHtml += `
        <h3 style="color: #333; margin: 16px 0 8px;">Due today (${tasks.dueToday.length})</h3>
        <ul style="margin: 0; padding-left: 20px;">${renderList(tasks.dueToday)}</ul>
      `;
    }
    if (tasks.dueTomorrow.length > 0) {
      sectionsHtml += `
        <h3 style="color: #666; margin: 16px 0 8px;">Due tomorrow (${tasks.dueTomorrow.length})</h3>
        <ul style="margin: 0; padding-left: 20px;">${renderList(tasks.dueTomorrow)}</ul>
      `;
    }

    try {
      const info = await this.transporter.sendMail({
        from: config.smtpFrom || '"Planwren" <noreply@todoapp.com>',
        to: email,
        subject: `${total} task${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} attention`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Your daily task reminder</h2>
            <p>Here's what needs your attention:</p>
            ${sectionsHtml}
            <p style="margin: 30px 0;">
              <a href="${this.baseUrl}"
                 style="background-color: #667eea; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                Open Planwren
              </a>
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              You're receiving this because task reminders are enabled for your account.
              Disable them in Settings &gt; Agent &gt; Action Policies.
            </p>
          </div>
        `,
      });
      console.log("Task reminder email sent:", info.messageId);
      return total;
    } catch (error) {
      console.error("Error sending task reminder email:", error);
      throw new Error("Failed to send task reminder email");
    }
  }

  /**
   * Send feedback status change notification
   */
  async sendFeedbackStatusEmail(
    email: string,
    details: {
      title: string;
      status: string;
      githubIssueUrl?: string | null;
      rejectionReason?: string | null;
      resolutionSummary?: string | null;
    },
  ): Promise<void> {
    if (!this.transporter) return;

    const feedbackUrl = `${this.baseUrl}/feedback`;
    const subjectMap: Record<string, string> = {
      triaged: "Your feedback is under review",
      promoted: "Your feedback is now tracked",
      rejected: "Update on your feedback",
      resolved: "Your feedback has been resolved",
    };
    const statusLabelMap: Record<string, string> = {
      triaged: "Under review",
      promoted: "Tracked",
      rejected: "Closed",
      resolved: "Resolved",
    };
    const subject = subjectMap[details.status] || "Update on your feedback";
    const statusLabel = statusLabelMap[details.status] || details.status;

    let extraHtml = "";
    if (details.status === "promoted" && details.githubIssueUrl) {
      extraHtml = `
        <p>We've created a public issue to track this:</p>
        <p><a href="${details.githubIssueUrl}" style="color: #667eea;">${details.githubIssueUrl}</a></p>
      `;
    }
    if (details.status === "rejected" && details.rejectionReason) {
      extraHtml = `
        <p style="color: #666;"><strong>Reason:</strong> ${details.rejectionReason}</p>
      `;
    }
    if (details.status === "resolved") {
      const summary = details.resolutionSummary
        ? `<p style="color: #333;">${details.resolutionSummary}</p>`
        : "";
      extraHtml = `
        <p>The issue has been fixed and deployed. Thank you for reporting it!</p>
        ${summary}
      `;
    }

    try {
      const info = await this.transporter.sendMail({
        from: config.smtpFrom || '"Planwren" <noreply@todoapp.com>',
        to: email,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>${subject}</h2>
            <table style="margin: 20px 0; border-collapse: collapse;">
              <tr><td style="padding: 4px 12px 4px 0; color: #666;">Title</td><td>${details.title}</td></tr>
              <tr><td style="padding: 4px 12px 4px 0; color: #666;">Status</td><td><strong>${statusLabel}</strong></td></tr>
            </table>
            ${extraHtml}
            <p style="margin: 24px 0;">
              <a href="${feedbackUrl}"
                 style="background-color: #667eea; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                View your submissions
              </a>
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              You're receiving this because you submitted feedback on Planwren.
            </p>
          </div>
        `,
      });
      console.log("Feedback status email sent:", info.messageId);
    } catch (error) {
      console.error("Error sending feedback status email:", error);
    }
  }
}
