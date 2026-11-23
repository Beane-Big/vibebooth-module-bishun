import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import moduleIcon from "./vite-icon";

// 开发和部署使用同一个页面前缀。
export default defineConfig({
  base: "/apps/bishun/",
  plugins: [react(), moduleIcon()],
});
