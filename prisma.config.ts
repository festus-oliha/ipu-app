import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Optional here so "npm install" (which runs "prisma generate") works before
    // .env exists. Migrate, seed and the app itself still need DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
