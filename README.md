# 曜花缘 · YaoHuaYuan

一个围绕计算机系统、数据库、AI、算法与数学建模逐步生长的个人技术档案馆。保留 Astro、TypeScript、Markdown Content Collections 与 GitHub Pages 的静态站点架构。

## 运行

Node.js >= 22.12（本轮在 Node 24 验证）。

```powershell
cd D:\Sites\yaohuayuan\blog-source
npm ci
npm run dev
```

生产预览（包含 Pagefind 搜索）：

```powershell
npm run build
npm run preview -- --host 127.0.0.1
```

若 Astro 7 将开发服务放入后台，可用 `npm run astro -- dev status` 查看状态，`npm run astro -- dev stop` 停止本工程开发服务。

## 内容与维护

- **Articles**：`src/content/articles/**/index.md`，时间流文章。保留原有分类、标签、系列、RSS 与归档。
- **Knowledge**：`src/content/knowledge/**/index.md`，长期知识。学习路径与领域映射在 `src/data/knowledge.ts`。
- **Projects**：`src/data/projects.ts` 集中维护介绍、背景、架构、功能、过程、插图与 GitHub。详情页自动生成。
- **Labs**：`src/components/Experiment.astro` 提供统一步骤播放器；纯算法在 `src/lib/experiments.ts`；`GrowthModel.astro` 提供参数曲线。
- **主题**：`src/styles/global.css` 定义浅色与暗色语义变量。首次访问跟随系统，手动选择保存在本机。
- **阅读**：文章与知识布局共享目录、阅读进度、代码复制与图片放大；数学公式仍由构建期 MathJax 渲染。
- **SEO**：`BaseLayout.astro` 管理 canonical、Open Graph、Twitter、JSON-LD。分享图位于 `public/social-card.png`，SVG 源文件同目录。

现有文章、图片及 frontmatter 未改动。板凳龙文章仍为 `draft: true`，开发环境可查看，生产站点、RSS 与搜索不发布它。当前可发布内容仍包含原有站点测试文章，未虚构新文章。

新增知识笔记需要使用现有 `section`：`data-structure`、`architecture`、`operating-system`、`network`、`systems`、`dbms`、`ai-llm`，或新增的领域分组 `algorithms`、`modeling`、`engineering`。

## 验证

```powershell
npm test
npm run build
node scripts/verify-build.mjs
```

浏览器验收脚本 `scripts/qa-browser.mjs` 使用 Playwright 和本机 Edge，不属于站点运行依赖。通过 `PLAYWRIGHT_MODULE` 指向已安装 Playwright 的 ESM 入口（Windows 请使用 file URL），或在单独的测试环境安装 Playwright；可用 `PLAYWRIGHT_CHANNEL` 切换浏览器。先启动生产预览再运行：

```powershell
node scripts/qa-browser.mjs
```

可设置 `QA_URL` 与 `QA_OUTPUT`。验证覆盖 360 / 768 / 1440 像素布局、SEO、损坏图片、主题持久化、实验步骤、数学公式、复制、大图与搜索。手机检查为浏览器视口模拟，未替代实体手机测试。

## 部署

沿用现有 GitHub Actions → GitHub Pages 工作流。站点地址为 `https://yaohuayuan.github.io`，使用根路径；如未来改成仓库子路径部署，应统一处理 Astro base 与各页面资源链接。本轮没有提交、推送或发布。

设计来源、文件清单、验证结果及后续内容建议见 [设计交付说明](docs/DESIGN.md)。
