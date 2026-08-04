export const categoryLabels = {
	algorithms: '算法',
	modeling: '数学建模',
	'electronics-control': '电赛与控制',
	research: '研究与论文复现',
	engineering: '工程与项目复现',
} as const satisfies Readonly<Record<string, string>>;

export const knowledgeSectionLabels = {
	'data-structure': '数据结构',
	architecture: '计算机组成原理',
	'operating-system': '操作系统',
	network: '计算机网络',
	dbms: 'DBMS',
	'ai-llm': 'AI / LLM',
	systems: 'Systems',
} as const satisfies Readonly<Record<string, string>>;

export const tagLabels = {
	markdown: 'Markdown',
	image: '图片',
	mathjax: 'MathJax',
	math: '数学',
	cumcm: '全国大学生数学建模竞赛',
	'archimedean-spiral': '阿基米德螺线（等距螺线）',
	'collision-model': '碰撞模型',
} as const satisfies Readonly<Record<string, string>>;

export const seriesLabels = {
	'site-testing': '站点功能测试',
	'cumcm-2024': 'CUMCM 2024',
} as const satisfies Readonly<Record<string, string>>;

export type CategorySlug = keyof typeof categoryLabels;
export type KnowledgeSectionSlug = keyof typeof knowledgeSectionLabels;
export type TagSlug = keyof typeof tagLabels;
export type SeriesSlug = keyof typeof seriesLabels;

function getLabel(labels: Readonly<Record<string, string>>, slug: string) {
	return labels[slug] ?? slug;
}

export const getCategoryLabel = (slug: string) => getLabel(categoryLabels, slug);
export const getKnowledgeSectionLabel = (slug: string) =>
	getLabel(knowledgeSectionLabels, slug);
export const getTagLabel = (slug: string) => getLabel(tagLabels, slug);
export const getSeriesLabel = (slug: string) => getLabel(seriesLabels, slug);
