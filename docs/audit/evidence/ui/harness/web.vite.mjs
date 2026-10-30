export default {
  root: new URL("../../../../../apps/web", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") },
  server: { host: "127.0.0.1", port: 5287, strictPort: true, hmr: false, proxy: { "/v1": "http://127.0.0.1:3157" } },
};
