import type { NextConfig } from "next";

/** Posts that were renamed: old slug -> new slug. Keeps shared links working. */
const RENAMED_POSTS: Record<string, string> = {
  mentiforce01: "python-internals-for-llms",
  mentiforce02: "neural-network-fundamentals",
  mentiforce03: "transformer-architecture-principles",
  mentiforce04: "transformer-inference-optimization",
  mentiforce05: "vllm-inference-engine-design",
  mentiforce06: "batching-llm-requests",
  "mit-distributed%20systems%20-%20lecture1": "distributed-systems-mapreduce",
};

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      ...Object.entries(RENAMED_POSTS).map(([from, to]) => ({
        source: `/blog/${from}`,
        destination: `/blog/${to}`,
        permanent: true,
      })),
      // The old placeholder "Good reads" page now lives inside the Second brain page. Temporary (307) while it is a beta,
      // so withdrawing the beta does not leave a permanent redirect cached in browsers.
      { source: "/reads", destination: "/second-brain#good-reads", permanent: false },
    ];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
