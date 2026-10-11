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
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
