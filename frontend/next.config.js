const withPWA = require("next-pwa")({
  dest: "public",
  disable: true
});

module.exports = withPWA({
  reactStrictMode: true,
  experimental: {
    typedRoutes: false
  }
});
