export interface Project {
  slug: string; name: string; kind: string; status: string; description: string; stack: string[];
  github?: string; background: string; architecture: string[]; architectureNote: string; features: string[]; journey: { title: string; text: string }[]; image?: string; imageAlt?: string; source: string;
}
export const projects: Project[] = [
  {
    slug: 'ai-native-dbms', name: 'AI-NATIVE-DBMS-C', kind: '01 / DATABASE RESEARCH', status: '持续构建',
    description: '从数据库内核出发，探索可计划、可解释、可度量的 AI 原生查询。',
    stack: ['C17', 'CMake', 'AI × Database'], github: 'https://github.com/yaohuayuan/AI-NATIVE-DBMS-C',
    background: '延续 DBMS_C 的系统实践，重新设计模块边界、内存所有权、错误处理与测试契约。研究目标是让模型调用成为查询执行链中的算子。',
    architecture: ['Core · error / memory / containers', 'DBMS baseline · storage / query（规划）', 'AI runtime · provider / operators（规划）', 'Experiments · cache / metrics（规划）'],
    architectureNote: '目标分层；当前开发阶段为 Core Containers，后续层仍在规划。',
    features: ['README 记录了 error、context、memory、arena 与基础容器的实现和测试。', 'rbt 已纳入测试；map 的本地验证与远端 CI 状态分开记录。', '当前程序为 minimal CLI/bootstrap；SQL、DBMS 和 AI runtime 尚非已交付功能。'],
    journey: [{ title: '从旧原型复盘', text: '以 DBMS_C 为参考，重新梳理 API、生命周期和模块依赖。' }, { title: '建立工程基础', text: '先推进错误处理、内存管理和基础容器，并建立跨平台测试链。' }, { title: '下一阶段', text: '完成容器与 byte_buffer 契约后，再进入 page/file 与存储格式。' }],
    source: '根据本地仓库 README 与项目概览整理；具体进度以仓库最新记录为准。本页未重新运行数据库测试。',
  },
  {
    slug: 'dbms-c', name: 'DBMS_C', kind: '02 / DATABASE KERNEL', status: '阶段归档',
    description: '用 C 语言走通从 SQL 解析到页面存储的完整学习路径。',
    stack: ['C', 'SQL', 'CMocka'], github: 'https://github.com/yaohuayuan/PhoenixDB',
    background: '本科毕业设计阶段的轻量化教学型数据库原型。通过亲手连接解析、计划、执行、事务与存储，理解一条 SQL 在系统内部的旅程。',
    architecture: ['SQL CLI → parse → plan', 'query / record / metadata / hash index', 'transaction → log / recovery', 'buffer · LRU → file / page'],
    architectureNote: '依据项目 README 和模块调用关系整理的概览，不代表每次查询都经过所有模块。',
    features: ['项目文档列出建表、插入、查询、条件与多表查询，以及更新、删除、视图和索引。', '事务提交与回滚、日志恢复支撑、LRU 页面替换及基础哈希索引。', '配有 SQL 演示脚本与 CMocka 单元测试，定位为教学原型。'],
    journey: [{ title: '建立存储基础', text: '围绕块、页、文件、缓冲区和日志组织底层模块。' }, { title: '连接 SQL 执行链', text: '将解析、查询计划、扫描执行和元数据串联为可演示流程。' }, { title: '沉淀与继续探索', text: '保留毕业设计文档与演示；后续研究在 AI-NATIVE-DBMS-C 中展开。' }],
    image: '/images/projects/dbms-architecture.png', imageAlt: 'DBMS_C 原项目文档中的系统总体分层结构图',
    source: '根据 DBMS_C README、模块调用关系图与原项目插图整理。GitHub 链接来自本地 Git 远端 PhoenixDB。本页未重新运行数据库测试。',
  },
  {
    slug: 'aster', name: 'Aster', kind: '03 / OPEN EXPLORATION', status: '筹备中',
    description: '为下一个值得探索的问题，保留一颗星的位置。',
    stack: ['Idea stage'], background: '一个刚刚开始的项目位置。目前尚未确定可公开的实现内容。',
    architecture: [], architectureNote: '架构将在项目方向明确后补充。',
    features: ['当前没有已发布功能。'], journey: [{ title: '起点', text: '先定义问题，再记录实验与设计取舍。' }],
    source: '当前状态由作者确认：项目基本为空。',
  },
];