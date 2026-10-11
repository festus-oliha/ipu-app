import { runJobs } from "@/lib/jobs";

/**
 * Called every hour by the Netlify scheduled function (netlify/functions/hourly.mts)
 * with the shared CRON_SECRET. Not reachable without it.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Not allowed.", { status: 401 });
  }
  // Tests only: run the jobs as if it were another day. Never set JOBS_TEST_DATES on the live site.
  const asOf = new URL(req.url).searchParams.get("date");
  const result = await runJobs(process.env.JOBS_TEST_DATES === "1" && asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  return Response.json(result);
}
