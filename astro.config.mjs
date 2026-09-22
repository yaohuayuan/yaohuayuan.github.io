// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import rehypeMathjax from 'rehype-mathjax';
import remarkMath from 'remark-math';

// https://astro.build/config
export default defineConfig({
	site: 'https://yaohuayuan.github.io',
	integrations: [
		sitemap({
			filter: (page) => !['/search/', '/404/', '/404.html'].includes(new URL(page).pathname),
		}),
	],
	markdown: {
		shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
		processor: unified({
			remarkPlugins: [remarkMath],
			rehypePlugins: [rehypeMathjax],
		}),
	},
});
