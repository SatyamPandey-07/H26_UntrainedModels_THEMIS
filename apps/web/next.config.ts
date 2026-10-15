import type { NextConfig } from "next";

const config: NextConfig = {
  // Probot pulls in pino and Octokit plugins that should stay as Node modules on the server.
  serverExternalPackages: ["probot", "pino"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
};

export default config;
