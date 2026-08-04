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
			filter: (page) => new URL(page).pathname !== '/search/',
		}),
	],
	markdown: {
		processor: unified({
			remarkPlugins: [remarkMath],
			rehypePlugins: [rehypeMathjax],
		}),
	},
});
