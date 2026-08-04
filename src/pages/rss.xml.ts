import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async (context) => {
	if (!context.site) {
		throw new Error('Astro site must be configured to generate the RSS feed.');
	}

	const articles = (await getCollection('articles'))
		.filter((entry) => !entry.data.draft)
		.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

	return rss({
		title: '曜花缘的技术笔记',
		description: '计算机系统、数据库、AI、算法、数学建模与工程实践记录。',
		site: context.site,
		items: articles.map((entry) => ({
			title: entry.data.title,
			description: entry.data.description,
			pubDate: entry.data.date,
			link: `/articles/${entry.id}/`,
		})),
	});
};
