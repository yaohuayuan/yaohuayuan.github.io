import type { SeriesId } from './series';

export interface Project {
  slug: string; name: string; kind: string; status: string; description: string; stack: string[];
  github?: string; background: string; architecture: string[]; architectureNote: string; features: string[]; journey: { title: string; text: string }[]; image?: string; imageAlt?: string; series?: SeriesId; seriesNote?: string; source: string;
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
    slug: 'dbms-c', name: 'DBMS_C', kind: '02 / DATABASE KERNEL', status: 'v1.0 归档',
    description: '用 C 语言从零实现的教学型关系数据库原型：从 SQL 解析到页面存储打通一条可运行、可测试的主链路。',
    stack: ['C11', 'CMake', 'CMocka'], github: 'https://github.com/yaohuayuan/DBMS_C',
    series: 'dbms-c-from-zero', seriesNote: '从系列导读到存储、事务与执行链，按数据库内核的依赖顺序逐层展开。',
    background: '本科毕业设计阶段的轻量化教学型数据库原型。它不做网络层、权限体系和工业级恢复，只把「一条 SQL 怎样变成某个页面上的几组字节」这条主链路完整走通，让每个数据库核心机制都能对应到一段可读、可运行的源码。',
    architecture: ['SQL CLI → parse → plan', 'query / record / metadata / hash index（元数据）', 'transaction → log / recovery', 'buffer · LRU → file / page'],
    architectureNote: '依据项目 README 和模块调用关系整理的概览；index、BetterQueryPlanner 与恢复入口已有代码，但未接入默认查询路径。',
    features: ['支持 CREATE TABLE、INSERT、SELECT（投影与条件）、多表查询、UPDATE / DELETE、视图与索引元数据，以及显式 commit / rollback。', '块级 S/X 锁、undo 日志与 WAL 刷盘顺序、缓冲池与 LRU 替换接口，页面为 4096 字节、默认 8 个页框。', '25 个 CMocka 测试套件（CTest）与 demo SQL 演示脚本；v1.0 归档时在全新 clone 中复现构建与测试。'],
    journey: [{ title: '建立存储基础', text: '围绕块、页、文件、缓冲区和日志组织底层模块。' }, { title: '连接 SQL 执行链', text: '将解析、查询计划、扫描执行和元数据串联为可演示流程。' }, { title: '归档与复盘', text: '整理 13 章教程、可复现构建与 12 篇开发系列；后续研究在 AI-NATIVE-DBMS-C 中展开。' }],
    image: '/images/projects/dbms-architecture.png', imageAlt: 'DBMS_C 原项目文档中的系统总体分层结构图',
    source: '根据 DBMS_C 仓库的 README、RELEASE_NOTES 与模块调用关系整理，远端仓库为 yaohuayuan/DBMS_C。本页未重新运行数据库测试。',
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
