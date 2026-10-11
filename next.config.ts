import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is left off: almost every page depends on who is signed in,
  // and money pages must always show live figures.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["@node-rs/argon2", "nodemailer", "exceljs"],
  experimental: {
    // Receipt photos are shrunk in the browser first; PDFs can be up to 4 MB.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
