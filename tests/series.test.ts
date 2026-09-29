import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollectionEntry } from 'astro:content';
import { getSeriesArticles, getSeriesSummary } from '../src/lib/series.ts';
import type { SeriesId } from '../src/data/series.ts';

function article(id: string, series: SeriesId, options: { order?: number; date?: string; updated?: string; draft?: boolean } = {}): CollectionEntry<'articles'> {
	return {
		id, collection: 'articles',
		data: { title: id, description: id, categories: [], tags: [], series, seriesOrder: options.order, date: new Date(options.date ?? '2026-09-01'), updated: options.updated ? new Date(options.updated) : undefined, draft: options.draft ?? false },
	};
}

test('chapter order overrides dates; unnumbered articles follow numbered chapters', () => {
	const entries = [article('review', 'dbms-c-from-zero'), article('two', 'dbms-c-from-zero', { order: 2, date: '2026-08-01' }), article('intro', 'dbms-c-from-zero', { order: 0 }), article('one', 'dbms-c-from-zero', { order: 1, date: '2026-09-29' })];
	assert.deepEqual(getSeriesArticles(entries, 'dbms-c-from-zero').map(entry => entry.id), ['intro', 'one', 'two', 'review']);
});

test('time series follow descending publication date, with stable ties', () => {
	const entries = [article('old', 'leetcode-daily', { date: '2026-09-01', order: 0 }), article('b', 'leetcode-daily', { date: '2026-09-29' }), article('a', 'leetcode-daily', { date: '2026-09-29' })];
	assert.deepEqual(getSeriesArticles(entries, 'leetcode-daily').map(entry => entry.id), ['a', 'b', 'old']);
});

test('drafts and other series do not affect count, update time or navigation', () => {
	const entries = [article('published', 'math-modeling'), article('draft', 'math-modeling', { draft: true, updated: '2026-09-29' }), article('other', 'leetcode-daily', { date: '2026-09-29' })];
	const summary = getSeriesSummary(entries, 'math-modeling');
	assert.equal(summary.count, 1);
	assert.equal(summary.updated?.toISOString().slice(0, 10), '2026-09-01');
	assert.deepEqual(summary.articles.map(entry => entry.id), ['published']);
});

test('last update uses the latest publication or revision across the series', () => {
	const entries = [article('revised', 'math-modeling', { updated: '2026-09-28' }), article('new', 'math-modeling', { date: '2026-09-29', updated: '2026-08-01' })];
	assert.equal(getSeriesSummary(entries, 'math-modeling').updated?.toISOString().slice(0, 10), '2026-09-29');
});

test('empty series have an honest empty state and no invented update date', () => {
	const summary = getSeriesSummary([], 'icpc');
	assert.equal(summary.count, 0);
	assert.equal(summary.updated, undefined);
	assert.deepEqual(summary.articles, []);
});
