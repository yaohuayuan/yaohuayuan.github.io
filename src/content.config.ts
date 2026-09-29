import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { seriesIds } from './data/series';

const articles = defineCollection({
	loader: glob({
		pattern: '**/*.md',
		base: './src/content/articles',
	}),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		updated: z.coerce.date().optional(),
		categories: z.array(z.string()).default([]),
		tags: z.array(z.string()).default([]),
		series: z.enum(seriesIds).optional(),
		seriesOrder: z.number().int().nonnegative().optional(),
		draft: z.boolean().default(false),
	}).refine((data) => data.seriesOrder === undefined || data.series !== undefined, {
		message: 'seriesOrder 必须同时指定 series。',
		path: ['seriesOrder'],
	}),
});

const knowledge = defineCollection({
	loader: glob({
		pattern: '**/*.md',
		base: './src/content/knowledge',
	}),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		section: z.string(),
		updated: z.coerce.date().optional(),
		tags: z.array(z.string()).default([]),
		order: z.number().default(0),
		draft: z.boolean().default(false),
	}),
});

export const collections = { articles, knowledge };
