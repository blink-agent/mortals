/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // /skill.md and /actions.md read from web/skills/ at request time; the
    // tracer cannot see through fs.readFile, so include the folder explicitly.
    outputFileTracingIncludes: {
      '/skill.md': ['./skills/**'],
      '/actions.md': ['./skills/**'],
    },
  },
};

export default nextConfig;
