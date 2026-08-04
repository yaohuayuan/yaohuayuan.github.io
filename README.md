# 曜花缘

基于 Astro 构建的个人技术站，内容涵盖计算机系统、数据库、AI、算法、数学建模与工程实践。

## 本地开发

```sh
npm install
npm run dev
```

在已有 lockfile 的干净环境中可以使用：

```sh
npm ci
```

## 生产构建

```sh
npm run build
```

构建结果输出到 `dist/`，并包含 Pagefind 搜索索引。

## 部署

GitHub Pages 由 GitHub Actions 自动构建并部署。
