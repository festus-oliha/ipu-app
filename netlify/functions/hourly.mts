// Netlify scheduled function: once an hour it asks the app to run whatever
// jobs are due (reminders, guarantor reports, backup) and to send waiting SMS.
// Schedules run in UTC; the app itself works out the date in Lagos.
const hourly = async () => {
  const site = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.log("URL or CRON_SECRET missing; skipping.");
    return;
  }
  const res = await fetch(`${site}/api/jobs`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  console.log(res.status, await res.text());
};

export default hourly;

export const config = { schedule: "@hourly" };
