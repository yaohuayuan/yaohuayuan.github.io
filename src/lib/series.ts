import type { CollectionEntry } from 'astro:content';
import { getSeriesDefinition, seriesIds, type SeriesId } from '../data/series.ts';

type Article = CollectionEntry<'articles'>;

export function getSeriesArticles(entries: Article[], id: SeriesId): Article[] {
	const definition = getSeriesDefinition(id);
	return entries
		.filter((entry) => !entry.data.draft && entry.data.series === id)
		.sort((a, b) => {
			if (definition.sort === 'ordered') {
				const order = (a.data.seriesOrder ?? Infinity) - (b.data.seriesOrder ?? Infinity);
				if (order && !Number.isNaN(order)) return order;
				return a.data.date.valueOf() - b.data.date.valueOf() || a.id.localeCompare(b.id);
			}
			return b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id);
		});
}

export function getSeriesSummary(entries: Article[], id: SeriesId) {
	const articles = getSeriesArticles(entries, id);
	const latest = articles.reduce<number | undefined>((value, entry) => {
		const timestamp = Math.max(entry.data.date.valueOf(), entry.data.updated?.valueOf() ?? 0);
		return value === undefined ? timestamp : Math.max(value, timestamp);
	}, undefined);
	return { id, ...getSeriesDefinition(id), articles, count: articles.length, updated: latest === undefined ? undefined : new Date(latest) };
}

export function getSeriesSummaries(entries: Article[]) {
	return seriesIds.map((id) => getSeriesSummary(entries, id)).sort((a, b) => a.order - b.order);
}

export type SeriesSummary = ReturnType<typeof getSeriesSummary>;
