export interface SeriesDefinition {
	title: string;
	description: string;
	order: number;
	sort: 'ordered' | 'newest';
}

// ID 是文章 frontmatter 与路由共用的唯一标识。
export const seriesDefinitions = {
	'math-modeling': { title: '数学建模', description: '记录数学建模竞赛、题目分析、建模方法、代码实现与论文思路。', order: 1, sort: 'newest' },
	'leetcode-daily': { title: 'LeetCode 每日一题', description: '每日算法训练与题解，记录解题思路、复杂度与实现取舍。', order: 2, sort: 'newest' },
	'leetcode-weekly': { title: 'LeetCode 周赛', description: '周赛题解与赛后复盘，从一次比赛中积累可复用的方法。', order: 3, sort: 'newest' },
	icpc: { title: 'ICPC / 算法竞赛', description: '算法竞赛训练、题目分析与比赛复盘。', order: 4, sort: 'newest' },
	'dbms-c-from-zero': { title: 'DBMS_C 开发系列', description: '从零实现 C 语言关系型数据库内核，沿着存储、事务与 SQL 执行链逐层理解系统。', order: 5, sort: 'ordered' },
	'ai-native-dbms': { title: 'AI-Native DBMS', description: '记录 AI 原生数据库的工程基础、内核设计与模型算子探索。', order: 6, sort: 'ordered' },
	'cs-notes': { title: '408 / CS 学习笔记', description: '串联数据结构、计算机组成、操作系统与网络的学习记录。', order: 7, sort: 'newest' },
	'site-testing': { title: '站点功能测试', description: '用于验证 Markdown、图片与数学公式阅读体验的现有文章。', order: 99, sort: 'newest' },
} as const satisfies Readonly<Record<string, SeriesDefinition>>;

export type SeriesId = keyof typeof seriesDefinitions;
export const seriesIds = Object.keys(seriesDefinitions) as [SeriesId, ...SeriesId[]];
export const getSeriesDefinition = (id: SeriesId): SeriesDefinition => seriesDefinitions[id];
export const getSeriesLabel = (id: SeriesId) => seriesDefinitions[id].title;
