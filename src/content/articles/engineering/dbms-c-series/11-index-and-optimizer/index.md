---
title: 写了哈希索引，却没有让查询用上它
description: 复盘 DBMS_C 的 100 桶 HashIndex、索引目录、统计估算和 BetterQueryPlanner，区分已经写出的局部算法与真正进入数据库主流程的系统能力。
date: 2026-09-28T10:10:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - hash-index
  - query-optimizer
series: dbms-c-from-zero
draft: false
---

DBMS_C 的目录里同时存在 `index/HashIndex.c`、`metadata/IndexInfo.c`、`BetterQueryPlanner.c` 和 `OptimizedProductPlan.c`。只看文件名，很容易总结成“项目实现了哈希索引和查询优化器”。

但我重新沿调用关系查了一遍，结论要保守得多：HashIndex 有一组可以手工调用的桶操作，`CREATE INDEX` 只写 `idxcat`；默认查询使用 [BasicQueryPlanner](../09-query-execution/)，不会取得 IndexInfo；BetterQueryPlanner 是没有接入且存在阻断性问题的实验代码；OptimizedProductPlan 目前只有空壳。

这一篇真正想复盘的是一个比哈希算法更重要的问题：一个源文件已经写出来，和整个系统真的依赖它，是两个不同的完成度。

## HashIndex 把每个桶做成一张表

当前常量 `HASH_INDEX_NUM_BUCKETS` 是 100。索引没有把 100 个 bucket 放在一个专用页格式中，而是把每个桶映射成一张普通表：

```text
bucket = ConstantHashCode(key) % 100
bucket table name = indexName + bucket
```

假设索引名是 `idx_student_id`，整数 key 42 会访问 `idx_student_id42.tbl`。桶表的 Layout 由 IndexInfo 构造，固定包含：

| 字段 | 含义 |
| --- | --- |
| `block INT` | 原表 RID 的块号 |
| `id INT` | 原表 RID 的 slot |
| `dataval` | 索引键，类型和被索引字段一致 |

这个设计复用了 TableScan、RecordPage 和 Transaction。索引项并不是特殊二进制结构，而是一条保存 `(key, RID)` 的普通记录。因此桶文件同样有页格式、Buffer、锁和日志路径。

`ConstantHashCode` 对整数直接返回值，对字符串使用一个从 5381 开始的滚动 hash。字符串 hash 先得到 unsigned，再转回 int；如果最高位被置位，结果可能成为负数，而 `% 100` 也可能得到负 bucket。代码没有统一把 bucket 归一化到 `0..99`。SQL Parser 当前又不接受负整数字面量，所以整数主路径不容易触发这一点，字符串键仍然存在这个边界。

## 查找其实是“先定位桶，再顺序扫描”

`HashBeforeFirst` 根据 key 选择桶文件，打开一个 TableScan，并保存当前搜索 Constant。`HashIndexNext` 顺序遍历这个桶，逐条比较 `dataval`：

```c
while (TableScanNext(hashIndex->scan)) {
    if (ConstantEquals(
            TableScanGetVal(hashIndex->scan, dataval),
            hashIndex->constant)) {
        return true;
    }
}
```

hash 冲突不会直接返回错误值，因为桶记录里仍保存完整 `dataval`。找到相等键后，`HashIndexGetDataRID` 读取 `block` 和 `id`，重新构造原表 RID。

插入也很直白：先选择桶，再 `TableScanInsert`，写入 RID 和 key。删除则扫描同一个桶，找到 key 和 RID 都匹配的记录，再调用 TableScanDelete。它没有唯一约束，同一 key 可以对应多个 RID，这符合普通非唯一索引的形状。

这段局部链路是存在的，但资源接口仍比较粗糙。HashIndex 保存调用者传入的 Constant 指针，不复制所有权；`HashIndexClose` 只关闭当前 TableScan，没有释放 HashIndex、索引名和其他对象，也没有把 scan 置空。`HashIndexGetDataRID` 每次分配一个 RID，删除循环没有释放它。

## `CREATE INDEX` 没有创建这 100 个桶

[Metadata 篇](../07-metadata-bootstrap/) 已经介绍 `idxcat`。`IndexMgrCreateIndex` 的全部持久化动作，就是向目录插入：

```text
indexname | tablename | fieldname
```

它不扫描已有表，不创建 HashIndex，不调用 `HashIndexInsert`，也不会预先创建 100 个桶文件。桶文件只有在某段代码显式初始化 HashIndex 并调用 `HashBeforeFirst`、insert 或 lookup 时，才会通过 TableScan 懒创建。

这意味着对已有数据执行：

```sql
CREATE INDEX idx_student_id ON student(id);
```

当前结果只是 `idxcat` 多了一行。没有历史记录被回填到索引，也没有任何桶数据因此出现。

后续 INSERT、UPDATE、DELETE 也只操作原表。`BasicUpdatePlanner` 没有查询表的 IndexInfo，更没有在写表成功后调用 HashIndex 的 insert/delete。即使手工建立过桶记录，更新原表也会让它失去同步。

## 默认查询计划完全不看索引

`IndexMgrGetIndexInfo` 能扫描 `idxcat`，为指定表返回“字段名 → IndexInfo”的 map。IndexInfo 保存索引名、字段名、表 Schema、事务、StatInfo 和索引项 Layout，并提供访问块数、输出行数、distinct value 等估算接口。

但调用搜索显示，`MetadataManagerGetIndexInfo` 除测试外没有进入任何 Plan。默认 `SimpleDBInit` 注入的是 BasicQueryPlanner，而它只创建 TablePlan、ProductPlan、SelectPlan 和 ProjectPlan。系统里也没有 IndexSelectPlan 或 IndexJoinPlan。

所以当前 SELECT 不会因为 WHERE 中出现被索引字段而改变执行路径。它仍然打开 TableScan，从头到尾检查记录。这里不存在“优化器偶尔没选中索引”的问题，而是默认计划空间里根本没有索引扫描节点。

## HashIndex 测试也没有测试真实桶操作

现有 `HashIndexTest` 有两个用例。第一个手工 `malloc` 一个 HashIndex，给字段赋 NULL，再验证结构体值；第二个只检查 `HashIndexSearchCost` 的整数结果。测试文件自己也注明，因为初始化依赖其他组件，没有覆盖完整功能。

它没有调用 `HashIndexInit`、`HashBeforeFirst`、insert、next、get RID 或 delete，也没有重开数据库验证桶文件。因此测试全绿只说明结构定义和一个成本函数能运行，不能证明索引数据链路已经集成。

`HashIndexSearchCost(numblocks, rpb)` 实际直接返回 `numblocks / 100`，参数 `rpb` 没有参与计算。小于 100 个块时结果甚至是 0。它更像“平均分到 100 桶”的占位估算，而不是包含目录访问、桶溢出和扫描成本的模型。

## Statistics 提供的是稳定接口，不是真实分布

`StatManager` 通过 TableScan 计算每张表的记录数和块数，结果放在内存 map 中；超过 100 次获取后刷新全部统计。数据修改不会立即使缓存失效，[Metadata 篇](../07-metadata-bootstrap/) 已经记录了空表块数会被算成 0 等边界。

最关键的 distinct value 估计只有一行：

```c
return 1 + (si->numRecs / 3);
```

它不读字段，不区分字段名，也不采样数据。一个全是相同值的字段和一个完全唯一的字段，只要表行数相同，就会得到同样的 distinct estimate。

这个公式的真实含义不是“系统估计出每个值平均出现三次”，而是为 Plan 接口提供一个不为 0、会随行数增长的占位数字。IndexInfo 用 `rows / distinct` 估算等值查找的输出行数；TablePlan、SelectPlan 和 ProductPlan 也能调用类似接口。但估算公式存在，不代表估算已经足以支持可靠的成本决策。

## BetterQueryPlanner 尝试了什么

2026 年 3 月的 `Plan 优化理论完成版本` 提交加入 BetterQueryPlanner。它的目标比名称实际表达得更具体：

1. 根据 Expression 中的表名，把单表谓词提前包进对应 TablePlan；
2. 把跨表条件收集为 join terms；
3. 先选估计输出行数最小的基表；
4. 每轮用 `leftBlocks + leftRows × rightBlocks + output` 估算下一个 Product；
5. 贪心选择成本最小的连接顺序，最后再套连接 Predicate 和 Project。

这是谓词下推和 join order 的实验，不是索引优化器。代码从未调用 IndexManager，创建的仍然是 ProductPlan，也没有真正的 join 算法选择。

更重要的是，它没有接入 `SimpleDBInit`，也没有独立测试。默认路径始终使用 BasicQueryPlanner。

## 手工接入 BetterQueryPlanner 也还不能直接工作

[上一篇查询执行文章](../09-query-execution/) 已经指出 `ExpressionGetTableName` 没有返回 Parser 单独保存的 `expr->tableName`，而是在 fldname 中重新寻找点号。因而表名分类通常得到 NULL。

这次继续看循环，我又确认了一个更直接的问题：

```c
while (termHead) {
    CString *t1 = ExpressionGetTableName(term->lhs);
    CString *t2 = ExpressionGetTableName(term->rhs);

    if (t1 == NULL && t2 == NULL) {
        continue;
    }
    /* ... */
    termHead = termHead->next;
}
```

`continue` 之前没有推进 `termHead`。常见的无表名前缀谓词，例如 `WHERE id = sid`，会一直处理同一个 Term，形成死循环。由于 ExpressionGetTableName 本身的接口断裂，即便 SQL 写了限定字段也可能走进这里。

BetterQueryPlanner 还没有像 BasicQueryPlanner 那样展开 `SELECT *`。因此“把初始化函数从 Basic 换成 Better”并不是启用优化器的完整方案，至少要先修正表达式表名、循环推进、星号投影和测试覆盖。

## OptimizedProductPlan 目前是空文件

`OptimizedProductPlan.c` 只有 include，文件大小 80 字节；对应头文件只有 include guard，没有结构体和函数声明。CMake 把它编进 core，不代表里面已经有算法。

真正存在的连接重排实验全部写在 BetterQueryPlanner 中，最后仍然生成普通 ProductPlan。项目没有一个可执行的 OptimizedProductPlan 节点。

## 把完成度拆开以后

当前实现可以分成四层：

| 层次 | 当前状态 |
| --- | --- |
| HashIndex 局部 API | 有 100 桶、key 比较、RID insert/delete/lookup 代码 |
| 索引元数据 | `CREATE INDEX` 能写入并重新读取 `idxcat` |
| 数据维护 | 没有回填，也没有 INSERT/UPDATE/DELETE 自动同步 |
| 查询使用 | 默认 Planner 不读取索引，Better Planner 同样没有索引节点 |

统计与优化也类似：StatManager 能提供行数、块数和占位 distinct 估算；BetterQueryPlanner 有贪心连接顺序的代码；但默认系统仍执行固定的笛卡尔积加过滤，实验计划器还有会死循环的路径，OptimizedProductPlan 尚未开始。

## 现在回头看，“接入”才是更难的一半

当时写 HashIndex 时，我把注意力放在 `hash(key) → bucket → RID` 这条局部算法上。它确实让我理解索引项为什么必须指回原表记录，也让我复用了已经完成的 TableScan。但数据库功能不是若干独立源文件的集合。

真正让索引成为系统能力，还需要 CREATE 时回填数据、所有写路径维护一致性、事务回滚同时撤销索引变化、Planner 生成索引 Scan、统计信息支持成本比较，并用端到端测试证明重启后仍正确。任何一段缺失，都可能得到“代码能单独调用，SQL 永远不会使用”的状态。

如果继续实现，我会先补一个真实的 HashIndex 集成测试和写路径维护，再设计 IndexSelectPlan，最后才讨论成本优化。先让系统正确依赖它，再让它更快。这是这部分未完成代码给我的最直接教训。

[上一篇：DBMS_C 的并发控制实验](../10-concurrency-control/) · [下一篇：从能跑到可复现构建](../12-testing-and-retrospective/) · [返回系列导读](../)
