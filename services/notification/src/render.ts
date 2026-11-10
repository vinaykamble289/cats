import { env } from '@hireflow/shared';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function globals(): Record<string, unknown> {
  return { companyName: env.companyName, appUrl: env.appUrl, year: new Date().getFullYear() };
}

/**
 * Mustache-style rendering: `{{var}}` is HTML-escaped, `{{{var}}}` is inserted raw.
 * Pass escape=false for plain-text contexts such as subjects.
 */
export function renderTemplate(template: string, data: Record<string, unknown>, escape = true): string {
  const vars = { ...globals(), ...data };
  return template
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_m, key: string) => stringify(vars[key]))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => (escape ? escapeHtml(stringify(vars[key])) : stringify(vars[key])));
}

const BRAND = '#4f46e5';
const BUTTON_STYLE = `display:inline-block;background:${BRAND};color:#ffffff !important;text-decoration:none;font-weight:600;font-size:14px;line-height:20px;padding:12px 22px;border-radius:10px;`;

/** Email clients strip <style>: convert class="btn" anchors into inline-styled buttons and style plain paragraphs. */
function inlineStyles(html: string): string {
  return html
    .replace(/<a\b([^>]*?)\sclass=(["'])btn\2([^>]*)>/gi, (_m, before: string, _q: string, after: string) => `<a${before}${after} style="${BUTTON_STYLE}">`)
    .replace(/<p>/gi, '<p style="margin:0 0 14px 0;">')
    .replace(/<ul>/gi, '<ul style="margin:0 0 14px 0;padding-left:20px;">')
    .replace(/<a (?![^>]*style=)/gi, `<a style="color:${BRAND};" `);
}

/** Wraps rendered body HTML in a responsive, branded layout. */
export function wrapLayout(bodyHtml: string, subject: string): string {
  const company = escapeHtml(env.companyName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr>
          <td style="padding:0 4px 16px 4px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="background:${BRAND};color:#ffffff;font-weight:700;font-size:14px;width:32px;height:32px;text-align:center;border-radius:8px;">${company.charAt(0) || 'H'}</td>
              <td style="padding-left:10px;font-size:15px;font-weight:600;color:#18181b;">${company}</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:32px 28px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#3f3f46;">
            ${inlineStyles(bodyHtml)}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px;text-align:center;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#a1a1aa;">
            Sent by ${company} Talent Team · Please do not share links in this email - they are personal to you.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative for spam filters and text-only clients. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi, (_m, _q, href: string, text: string) => `${text.replace(/<[^>]+>/g, '')} (${href})`)
    .replace(/<(br|\/p|\/li|\/tr|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Realistic sample values for template previews. */
export function sampleData(): Record<string, unknown> {
  const link = `${env.appUrl}/portal/offer/sample-token`;
  return {
    candidateName: 'Priya Sharma',
    candidateEmail: 'priya.sharma@example.com',
    jobTitle: 'Senior Backend Engineer',
    designation: 'Senior Backend Engineer',
    reviewerName: 'Arjun Mehta',
    interviewerName: 'Arjun Mehta',
    vendorName: 'TrustVerify Services',
    count: 3,
    testTitle: 'Backend Engineering Assessment',
    roundName: 'Technical Interview',
    durationMin: 45,
    proctoringNote: 'This round is proctored: keep your webcam on, stay in full-screen and do not switch tabs.',
    scheduledAt: 'Mon, 16 Nov 2026, 11:00 AM IST',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    joiningDate: '1 December 2026',
    expiresAt: '20 Nov 2026',
    referenceNo: 'BGV-2026-0042',
    documentName: 'PAN card',
    reason: 'the image is blurry - please upload a clearer scan.',
    response: 'accepted',
    message: '“Looking forward to joining the team!”',
    documentsHtml: '<ul><li><a href="#">Government ID proof</a></li><li><a href="#">Education certificate</a></li></ul>',
    subject: 'A quick update on your application',
    bodyHtml: '<p>Hi Priya,</p><p>This is a sample custom message.</p>',
    link,
  };
}
