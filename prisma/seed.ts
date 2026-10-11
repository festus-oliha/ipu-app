/**
 * First-run data: the Admin account, the 2026–2027 financial year with its
 * 12 months, and the union's rule settings. Safe to run more than once.
 *
 *   npx prisma db seed
 *
 * Reads ADMIN_PHONE, ADMIN_NAME and ADMIN_TEMP_PASSWORD from .env.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePhone } from "../src/lib/phone";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const FIRST_YEAR = 2026; // March 2026 – February 2027

const SETTINGS: Record<string, string> = {
  INTEREST_PER_1000: "25",
  INTEREST_DUE_DAY: "15",
  LOAN_LIMIT_MONTHS: "12",
  LOAN_MONTHS: "3,4,5,6,7,8,9,10,11,12",
  MAX_GUARANTEES: "2",
  DIVIDEND_MIN_MONTHS: "4",
  WARNING_PERIOD: "12-01..02-15",
  UNION_NAME: "Iyobor Progressive Union",
  UNION_ADDRESS: "198, Old Sapele Road, Benin City, Edo State, Nigeria",
  UNION_PHONE: "+2349076729480",
  UNION_EMAIL: "iyoborpu@gmail.com",
  BANK_NAME: "GT Bank",
  BANK_ACCOUNT: "0033550876",
};

async function main() {
  // Financial year and its 12 months
  const label = `${FIRST_YEAR}–${FIRST_YEAR + 1}`;
  const year = await db.financialYear.upsert({
    where: { label },
    update: {},
    create: {
      label,
      startDate: new Date(Date.UTC(FIRST_YEAR, 2, 1)),
      endDate: new Date(Date.UTC(FIRST_YEAR + 1, 2, 0)), // last day of February
    },
  });
  for (let i = 0; i < 12; i++) {
    const month = new Date(Date.UTC(FIRST_YEAR, 2 + i, 1));
    await db.period.upsert({
      where: { yearId_month: { yearId: year.id, month } },
      update: {},
      create: { yearId: year.id, month },
    });
  }

  // Rule settings, effective from the start of the year
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.setting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom: year.startDate } },
      update: {},
      create: { key, value, effectiveFrom: year.startDate },
    });
  }

  // Admin account
  const phone = normalizePhone(process.env.ADMIN_PHONE ?? "");
  const password = process.env.ADMIN_TEMP_PASSWORD ?? "";
  const fullName = process.env.ADMIN_NAME ?? "Festus Ozee";
  if (!phone) throw new Error("Set ADMIN_PHONE in .env (e.g. 08031234567).");
  if (password.length < 8) throw new Error("Set ADMIN_TEMP_PASSWORD in .env (at least 8 characters).");

  const existing = await db.user.findUnique({ where: { phone } });
  if (existing) {
    console.log(`Admin ${phone} already exists — left unchanged.`);
  } else {
    const user = await db.user.create({
      data: {
        phone,
        passwordHash: await hash(password),
        mustChangePassword: true,
        roles: { create: [{ role: "ADMIN" }, { role: "MEMBER" }] },
      },
    });
    const count = await db.member.count();
    await db.member.create({
      data: {
        memberNo: `IPU-${String(count + 1).padStart(4, "0")}`,
        fullName,
        phone,
        userId: user.id,
      },
    });
    await db.auditLog.create({ data: { userId: user.id, action: "seed.admin", table: "User", recordId: user.id } });
    console.log(`Admin ${phone} created. Sign in and change the temporary password.`);
  }

  console.log(`Financial year ${label} ready with 12 months.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
