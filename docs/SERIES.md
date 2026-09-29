# Series 维护指南

博客继续使用现有 Astro Content Collections 和普通 Markdown。Articles 是全部文章的时间流；Series 是长期专题的阅读组织；Projects 是工程档案。Knowledge 保持原有知识库语义。

## 数据模型

`src/data/series.ts` 是唯一专题配置来源：对象键为 ID，每个专题包含 `title`、`description`、`order`、`sort`。

- `order`：总览卡片顺序。
- `sort: 'ordered'`：按 `seriesOrder` 升序，未编号文章排在已编号文章后，再按发布时间升序；相同顺序按日期、ID 稳定排序。
- `sort: 'newest'`：按发布时间倒序，相同日期按 ID 稳定排序。
- 数量与最近更新时间由 `src/lib/series.ts` 计算，仅包含 `draft: false` 的文章。更新时间取所有文章 `date` 和 `updated` 中的最大值。
- 配置中没有文章的专题仍有有效入口，显示 0 篇和空状态，不虚构更新时间。

`src/content.config.ts` 从配置键生成合法 ID 枚举。未知专题 ID、负数或非整数顺序、缺少 `series` 的 `seriesOrder` 会导致内容校验失败。文章不必指定系列。

## 新增专题

在 `src/data/series.ts` 的 `seriesDefinitions` 中添加一项即可：

```ts
'new-topic': {
  title: '新专题',
  description: '简短说明这个专题关注的问题。',
  order: 8,
  sort: 'newest',
},
```

总览、专题路由和类型自动更新，不需要添加页面文件。若与工程项目有关，可在 `src/data/projects.ts` 对应项目的 `series` 中引用此 ID；关联不会把专题转换为项目。

## 新文章加入专题

维持原有一文一目录：`src/content/articles/**/index.md`。在原 frontmatter 中补充：

```yaml
series: math-modeling
```

有明确阅读顺序的开发文章使用：

```yaml
series: dbms-c-from-zero
seriesOrder: 3
```

`seriesOrder: 0` 用于导读。其余编号自行维护；新增文章不必修改页面或计数。修订文章可设置 `updated`。静态站点在下一次构建后自动更新专题目录、卡片数量、更新时间和前后篇导航。

## 本次接入的内容

- DBMS_C 系列导读：保留原 ID `dbms-c-from-zero`，设置 `seriesOrder: 0`。
- DBMS_C 的 01～12 篇：设置对应章节顺序。
- 独立的《DBMS_C 开发记录》：正文明确复盘同一工程，接入同一系列并放在章节之后（`seriesOrder: 13`），作为补充复盘。共 14 篇已发布文章。
- 《2024 年全国大学生数学建模竞赛 A 题：板凳龙》：从 `cumcm-2024` 归入 `math-modeling`，继续保持 `draft: true`，生产站点不公开正文、不计入数量与更新时间。
- 两篇原有站点测试文章：保留 `site-testing` 及原公开状态，未修改正文。
- 尚未发现可明确归类的 LeetCode、ICPC、AI-Native DBMS、408 文章，仅登记专题，不把现有知识笔记或项目介绍自动当成文章。

## 路由

- `/articles/`：所有已发布文章，保留原分类、标签、RSS 和归档。
- `/series/`：专题卡片总览。
- `/series/math-modeling/`
- `/series/leetcode-daily/`
- `/series/leetcode-weekly/`
- `/series/icpc/`
- `/series/dbms-c-from-zero/`
- `/series/ai-native-dbms/`
- `/series/cs-notes/`
- `/series/site-testing/`
- `/articles/{原文章 ID}/`：全部文章 URL 保持原状。

数学建模原 `cumcm-2024` 没有已发布文章，因此旧生产构建没有生成公开系列路由。现在专题入口统一为 `/series/math-modeling/`。

导航通过品牌回到首页，主要入口为 Articles、Series、Knowledge、Projects、About。主页展示已有文章的专题卡片。文章详情提供完整专题入口、可展开的系列目录、当前文章标记以及按同一规则计算的上一篇/下一篇。

## 栏目清理与保留

旧独立交互栏目页与其专用导航样式删除；首页、顶栏、About 站点地图、项目详情与验收脚本同步更新。Footer、全局 SEO 与 RSS 没有旧栏目配置，无需改动。

`Experiment.astro`、`GrowthModel.astro` 和 `src/lib/experiments.ts` 保留为教学代码；组件各自导入 `src/styles/experiments.css`，不依赖独立栏目页面，也不会生成任何公开栏目路由。原有文章和图片全部保留。

## 验证

```powershell
npm test
npm run check
npm run build
node scripts/verify-build.mjs
```

测试覆盖显式章节顺序、按时间倒序、草稿隔离、自动统计与空专题。构建验证检查全部页面 metadata、站内绝对/相对资源链接、sitemap、草稿隔离和旧栏目残留。

可选浏览器回归脚本 `scripts/qa-browser.mjs` 已调整为系列总览、详情、当前文章与前后篇导航；输出默认在忽略目录 `.qa/series/`。它的 Playwright 环境按 README 配置，属于测试工具而非网站运行依赖。

## 建议作者确认

1. 板凳龙何时解除草稿状态。
2. 两篇功能测试文章是否继续公开；当前保持原发布状态。
3. 独立开发复盘排在 DBMS_C 第 12 篇之后是否符合你的阅读安排，可只改 `seriesOrder` 调整。
4. 暂无文章的专题名称与描述可随实际写作计划调整。

本次实测结果（2026-09-29）：`npm test` 11 项通过；`npm run check` 检查 48 个文件，0 errors / 0 warnings / 0 hints；生产构建 69 个 HTML 页面，Pagefind 索引 17 篇内容；构建验证通过 1813 处站内链接与资源检查。使用内置浏览器检查 9 个相关页面 × 360 / 768 / 1440 像素 × 亮暗两种主题，共 54 项布局检查，未发现横向溢出、损坏图片或旧栏目入口；系列目录、当前文章标记、上一篇/下一篇和主题持久化均通过，浏览器没有 error / warn 日志。可选 Playwright 脚本只做了语法检查，本次 UI 验收实际通过内置浏览器完成。未提交、推送或部署。
