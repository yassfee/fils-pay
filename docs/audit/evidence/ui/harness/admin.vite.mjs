export default {
  root: new URL("../../../../../apps/admin", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  define: {
    "import.meta.env.VITE_ADMIN_API_BASE_URL": JSON.stringify(""),
    "import.meta.env.VITE_WEB_BASE_URL": JSON.stringify("http://localhost:5287"),
  },
  server: { host: "127.0.0.1", port: 5288, strictPort: true, hmr: false, proxy: { "/v1": "http://127.0.0.1:3157" } },
};
