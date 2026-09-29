# 本次修改文件

本次直接在现有 Astro 工程中完成专题组织与独立栏目清理。没有删除文章或图片；15 篇文章只修改 frontmatter，正文逐篇与修改前版本核对并保留。

## 关键实现

- `src/data/series.ts`：唯一专题配置与 SeriesId 类型。
- `src/lib/series.ts`：共享排序、草稿过滤、数量与更新时间统计。
- `src/content.config.ts`：系列 ID 校验与可选章节顺序。
- `src/components/SeriesCard.astro`：独立专题卡片，复用现有视觉变量。
- `src/pages/series/index.astro`、`src/pages/series/[series].astro`：总览和专题目录。
- `src/pages/articles/[...id].astro`、`src/layouts/ArticleLayout.astro`：系列内目录、当前文章与前后篇导航。
- `src/components/SiteHeader.astro`、首页、About、项目详情：更新栏目入口。
- `src/components/Experiment.astro`、`GrowthModel.astro`、`src/styles/experiments.css`：保留教学组件并让样式归属于组件。
- `tests/series.test.ts`、两个验证脚本、`package.json`：系列回归、死链接检查和官方类型检查。
- `docs/SERIES.md`、README 与设计文档：维护说明与当前信息架构。

`src/pages/labs/index.astro` 删除。`src/styles/labs.css` 删除，通用教学样式保留于 `src/styles/experiments.css`。Footer 与全局 SEO 无旧栏目项，无需改动。

`package-lock.json` 开始工作时已有未提交修改；在该版本上增加 Astro 官方检查工具与 TypeScript 的开发依赖，没有恢复到 Git 基线。其余 runtime 依赖与框架保持原配置。

## 完整文件清单

下列 M / D 分别表示修改 / 删除，未带前缀的是新增文件。

```text
M	.gitignore
M	README.md
M	docs/CHANGED_FILES.md
M	docs/DESIGN.md
M	package-lock.json
M	package.json
M	scripts/qa-browser.mjs
M	scripts/verify-build.mjs
M	src/components/ArticleList.astro
M	src/components/Experiment.astro
M	src/components/GrowthModel.astro
M	src/components/SiteHeader.astro
M	src/content.config.ts
M	src/content/articles/engineering/dbms-c-development-review/index.md
M	src/content/articles/engineering/dbms-c-series/01-project-origin/index.md
M	src/content/articles/engineering/dbms-c-series/02-file-and-page/index.md
M	src/content/articles/engineering/dbms-c-series/03-buffer-pool/index.md
M	src/content/articles/engineering/dbms-c-series/04-record-storage/index.md
M	src/content/articles/engineering/dbms-c-series/05-transaction/index.md
M	src/content/articles/engineering/dbms-c-series/06-log-and-recovery/index.md
M	src/content/articles/engineering/dbms-c-series/07-metadata-bootstrap/index.md
M	src/content/articles/engineering/dbms-c-series/08-sql-parser/index.md
M	src/content/articles/engineering/dbms-c-series/09-query-execution/index.md
M	src/content/articles/engineering/dbms-c-series/10-concurrency-control/index.md
M	src/content/articles/engineering/dbms-c-series/11-index-and-optimizer/index.md
M	src/content/articles/engineering/dbms-c-series/12-testing-and-retrospective/index.md
M	src/content/articles/engineering/dbms-c-series/index.md
M	src/content/articles/modeling/cumcm/2024-a-bench-dragon/index.md
M	src/data/projects.ts
M	src/data/taxonomy.ts
M	src/layouts/ArticleLayout.astro
M	src/pages/about/index.astro
M	src/pages/articles/[...id].astro
M	src/pages/index.astro
D	src/pages/labs/index.astro
M	src/pages/projects/[slug].astro
M	src/pages/series/[series].astro
M	src/pages/series/index.astro
M	src/styles/home.css
D	src/styles/labs.css
docs/SERIES.md
src/components/SeriesCard.astro
src/data/series.ts
src/lib/series.ts
src/styles/experiments.css
tests/series.test.ts
```
