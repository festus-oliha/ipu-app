import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations use Supabase's SESSION pooler (DIRECT_URL); the running app uses
    // the TRANSACTION pooler (DATABASE_URL, see src/lib/db.ts).
    // Optional here so "npm install" (which runs "prisma generate") works before .env exists.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
