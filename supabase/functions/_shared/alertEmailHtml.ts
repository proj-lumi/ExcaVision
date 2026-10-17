// GENERATED FILE — do not edit by hand.
// Source: supabase/templates/alert.html
// Rebuild: node scripts/build-alert-email.mjs

export const ALERT_EMAIL_HTML = `<!--
  ExcaVision critical threshold alert.
  Where it is used: sent by the Resend HTTPS API from
  supabase/functions/_shared/push.ts → sendCriticalAlertEmail().

  This file is the SINGLE SOURCE for that email. The Edge Function cannot read
  files at runtime, so \`npm run build:alert-email\` (scripts/build-alert-email.mjs)
  compiles this template into supabase/functions/_shared/alertEmailHtml.ts.
  Edit this file, re-run the script, then redeploy \`node-telemetry\`.

  Runtime placeholders (replaced in push.ts, not by Supabase):
    {{logoUrl}}           ALERT_EMAIL_LOGO_URL
    {{fullName}}          customer profile full name
    {{siteName}}          site the unit belongs to
    {{unitName}}          monitoring unit that tripped
    {{observed}}          observed tilt in degrees, 2 decimals
    {{threshold}}         configured threshold in degrees, 2 decimals
    {{alertUrl}}          deep link into the customer PWA alerts page
-->
<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f9fb;color:#12161a;font-family:Inter,Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f9fb">
      <tr><td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e1e5">
          <tr><td style="padding:24px 32px;background:#f7f9fb;border-bottom:1px solid #d9e1e5">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td valign="middle" style="padding-right:12px"><img src="{{logoUrl}}" alt="ExcaVision" width="48" height="48" style="display:block"></td>
              <td valign="middle"><div style="font-size:24px;font-weight:600;letter-spacing:-0.03em;color:#12161a">ExcaVision</div></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:32px 24px;background:#ffffff">
            <div style="display:inline-block;padding:6px 10px;background:#fde8e7;color:#b42318;font-size:12px;font-weight:bold">CRITICAL ALERT</div>
            <h2 style="margin:20px 0 0;font-weight:600;color:#12161a">Movement threshold exceeded</h2>
            <p style="color:#425466">Hi {{fullName}}, a critical movement reading needs your attention.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;background:#f7f9fb">
              <tr><td style="padding:16px;color:#425466;font-size:14px;line-height:22px">Site<br><strong style="color:#12161a">{{siteName}}</strong></td><td style="padding:16px;color:#425466;font-size:14px;line-height:22px">Unit<br><strong style="color:#12161a">{{unitName}}</strong></td></tr>
              <tr><td style="padding:0 16px 16px;color:#425466;font-size:14px;line-height:22px">Observed<br><strong style="color:#b42318">{{observed}}°</strong></td><td style="padding:0 16px 16px;color:#425466;font-size:14px;line-height:22px">Threshold<br><strong style="color:#12161a">{{threshold}}°</strong></td></tr>
            </table>
            <p><a href="{{alertUrl}}" style="display:inline-block;padding:13px 20px;background:#ff7a22;color:#ffffff;text-decoration:none;font-weight:600">Review alert</a></p>
          </td></tr>
          <tr><td style="padding:20px 24px;background:#f3f6f6;font-size:12px;color:#617579">ExcaVision · Site movement monitoring</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
`;
