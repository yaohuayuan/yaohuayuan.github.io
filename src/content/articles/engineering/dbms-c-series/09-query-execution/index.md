---
title: 一条 SELECT 如何走到磁盘：Plan、Scan 与执行链
description: 沿一条真实多表查询追踪 DBMS_C 的 Parser、BasicQueryPlanner、Plan Tree、Scan 游标与物理存储路径，并辨认基础计划器和实验优化代码之间的边界。
date: 2026-09-28T09:50:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - query-execution
  - query-planner
series: dbms-c-from-zero
seriesOrder: 9
draft: false
---

前八篇文章分别拆开了页面、记录、事务、元数据和 Parser。这一篇要把它们重新接起来。我选择的不是概念上的 `SELECT`，而是一条 DBMS_C 现有语法确实能够执行的查询：

```sql
SELECT name, course, grade
FROM student, score
WHERE id = sid;
```

假设 `student` 含有 `id`、`name`，`score` 含有 `sid`、`course`、`grade`。这条语句要求系统枚举两个表的组合，用 `id = sid` 留下匹配记录，再只暴露三个投影字段。它刚好经过 `ProductPlan`、`SelectPlan` 和 `ProjectPlan`，能看清 DBMS_C 当前查询执行器做了什么，也能看清它没有做什么。

## 从 SQL 到 QueryData

[Parser 篇](../08-sql-parser/) 已经说明，Lexer 和 Parser 不生成一棵通用 SQL AST。这条语句会直接成为一个 `QueryData`：

```text
fields:    [name, course, grade]
tables:    [student, score]
predicate: id = sid
```

命令行把 `QueryData` 交给 `PlannerCreateQueryPlan`。`Planner` 自己只是一个门面，真正被 `SimpleDBInit` 注入的是 `BasicQueryPlanner`：

```c
simpleDB->planer = PlannerInit(
    BasicQueryPlannerInit(simpleDB->metadataMgr),
    BasicUpdatePlannerInit(simpleDB->metadataMgr)
);
```

这行装配代码很重要。仓库中确实存在 `BetterQueryPlanner`，也写了按统计信息尝试连接顺序的代码，但生产初始化没有创建它。当前默认行为必须以 Basic 版本为准，不能把未接入的实验代码描述成已经启用的查询优化器。

## BasicQueryPlanner 怎样拼出计划树

基础计划器按 FROM 中的顺序处理表名。对每一项，它先向 MetadataManager 查询是否存在同名 View；不是视图就创建 `TablePlan`，是视图则取回 SQL 定义、重新 Parser，并递归创建子计划。

本例的两个普通表先形成两个 TablePlan，再按出现顺序组合成 ProductPlan。最后在整个 Product 外套 SelectPlan，再套 ProjectPlan：

```text
ProjectPlan [name, course, grade]
└─ SelectPlan [id = sid]
   └─ ProductPlan
      ├─ TablePlan [student]
      └─ TablePlan [score]
```

注意 Select 不在任意一个表下面。BasicQueryPlanner 没有分析谓词属于哪张表，也没有做谓词下推；所有组合先由 Product 产生，再由 Select 判断。这种结构很适合验证模块组合，却也是多表数据稍大就会慢下来的根本原因。

多表计划还是一棵按 FROM 顺序构造的左深树。三个表 `a, b, c` 会先得到 `Product(a, b)`，再与 `c` 做 Product。代码不会比较其他连接顺序，也不会选择 hash join、merge join 或 index join。

## 为什么 Plan 和 Scan 要分开

这是我实现查询层时最有收获的一处边界。

Plan 描述“准备怎样执行”。它可以回答输出 Schema、估计访问块数、估计记录数和字段 distinct value，也能通过 `open` 创建游标；Plan 自身不保存“当前读到第几行”的状态。

Scan 才是一次执行中的可变游标。它提供 `beforeFirst`、`next`、`getInt`、`getString`、`getVal`、`hasField` 等统一函数指针。对同一个 Plan 多次 open，可以得到彼此独立的扫描状态。

四个核心节点的分工很直接：

| Plan | 规划阶段保存什么 | open 后创建什么 |
| --- | --- | --- |
| `TablePlan` | 表名、Layout、StatInfo | `TableScan` |
| `ProductPlan` | 左右子计划和合并 Schema | `ProductScan` |
| `SelectPlan` | 子计划和 Predicate | `SelectScan` |
| `ProjectPlan` | 子计划和目标字段 | `ProjectScan` |

`SelectPlan` 和 `ProjectPlan` 基本不复制数据。它们打开子计划后包一层 Scan：SelectScan 的 `next` 不断推进子游标，直到 Predicate 满足；ProjectScan 只限制哪些字段对上层可见。组合这些小节点，比为每种 SQL 形状写一套循环更容易定位执行问题。

## Open 之后，笛卡尔积真的发生了

执行端调用根 Plan 的 `open`，包装顺序与计划树对应：

```text
ProjectScan
└─ SelectScan
   └─ ProductScan
      ├─ TableScan [student.tbl]
      └─ TableScan [score.tbl]
```

`ProductScan` 是嵌套循环。`beforeFirst` 把两个子 Scan 复位并让左侧先走到第一条；每次 `next` 优先推进右侧。右侧结束后，它再次 `beforeFirst`，然后推进左侧一条。于是每个 student 行都会和所有 score 行组合。

`SelectScan` 对每一对组合求值 `id = sid`。字段读取先问左 Scan 是否拥有该字段，没有再问右 Scan。只有等式成立，ProjectScan 才把 `name`、`course`、`grade` 暴露给调用者。

这里没有隐藏的 join 算法：ProductPlan 本质就是笛卡尔积，WHERE 只是后置过滤。Plan 的 `blocksAccessed`、`recordsOutput` 等函数虽然能给出粗略估计，BasicQueryPlanner 并没有用这些估计搜索更优计划。

## 一个字段怎样最终读到页面字节

执行链继续下沉时，抽象层会逐步变具体：

```text
ProjectScan.getVal("name")
        ↓
SelectScan / ProductScan 转发到拥有字段的一侧
        ↓
TableScan.getVal("name")
        ↓
RecordPage.getString(slot, "name")
        ↓
Transaction.getString(block, slotOffset + fieldOffset)
        ↓
BufferList / BufferManager pin 对应块
        ↓
Buffer 内的 Page 读取字节
        ↓
缓存未命中时 FileManager.read 从 student.tbl 读块
```

因此“一条 SELECT 走到磁盘”并不意味着每次字段访问都调用 `fread`。TableScan 通过事务固定当前块，BufferManager 命中时直接读内存 Page；只有换入页面才由 FileManager 读取文件。跨到下一块时，TableScan 关闭当前 RecordPage、unpin 旧块，再 pin 新块。这些存储细节已经分别在 [File / Page](../02-file-and-page/)、[Buffer Pool](../03-buffer-pool/) 和 [Record Storage](../04-record-storage/) 中展开。

## `SELECT *` 是规划阶段展开的

Parser 遇到 `*` 时不会立即列出字段，因为那时还没有从元数据拿到表 Schema。BasicQueryPlanner 先构造 Table/Product 和 Select，再取得当前 Plan 的合并 Schema，用 `SchemaGetAllFields` 替换 QueryData 中的字段列表，最后创建 ProjectPlan。

这能让单表和多表的 `*` 复用同一路径，但重复字段名处理得很简单。ProductPlan 合并 Schema 时跳过已存在的同名字段，ProductScan 取值也优先左侧。结合 [Parser 篇](../08-sql-parser/) 中没有贯穿执行层的表限定名，多表同名列既可能被折叠，也无法可靠区分。

## INSERT、UPDATE、DELETE 为什么走另一条路径

SELECT 生成可被调用者迭代的 Plan；更新语句需要立即产生副作用，所以 `PlannerExecuteUpdate` 把 `CommandData` 分派给 `BasicUpdatePlanner`。

- INSERT 打开目标表的 TablePlan，调用 `TableScanInsert` 找到空槽，再逐字段 `setVal`；
- DELETE 构造 `TablePlan → SelectPlan`，遍历匹配行并调用 Scan 的 `delete`；
- UPDATE 同样先筛选记录，对每行求新 Expression，再 `setVal`；
- CREATE TABLE / VIEW / INDEX 直接委托 MetadataManager。

这些写操作最终仍经过 [Transaction](../05-transaction/) 和 [Undo Log](../06-log-and-recovery/)，但它们不需要返回一个可供上层读取的 ProjectScan，因此 QueryPlanner 和 UpdatePlanner 被拆开。

这种拆分也暴露了索引尚未接入的事实。INSERT、UPDATE 和 DELETE 不会维护 HashIndex；CREATE INDEX 只登记 [idxcat 元数据](../07-metadata-bootstrap/)。即使手工存在索引桶，默认计划器也不会选它。

## View 怎样递归进入计划

当 FROM 项不是普通表而是 View，BasicQueryPlanner 从 `viewcat` 取出 SQL，调用 Parser 得到新的 QueryData，再递归调用自己。返回的子 Plan 被当作一个表源参与 Product。

这个做法没有单独实现 ViewScan，也没有物化中间表，简单且符合当前项目规模。但它依赖视图 SQL 能被可靠序列化，并且没有循环检测。自引用视图或互相引用的两个视图会无限递归；复杂谓词还会遇到上一篇提到的 `QueryDataToString` 缺陷。

## DBTrace 能看到哪一段

2026 年 5 月加入的 DBTrace 让我终于不用只靠断点猜执行结构。开启 `trace on` 后，查询路径可以打印：

```text
QueryData: fields / tables / predicate
Plan Tree: Project → Select → Product → Table
Scan Chain: ProjectScan → SelectScan → ProductScan → TableScan
```

更新路径还会打印 Planner 分派、记录操作和事务提交等高层事件。它很适合确认“Parser 产物有没有进入预期节点”以及“Open 后包装顺序是否正确”。

但 Trace 目前不是逐行执行分析器。它不会输出每一次 Predicate 求值、Buffer 命中/未命中、页号和 slot、锁等待或日志记录内容；部分更新消息也是静态的阶段说明，并非从最底层事件采集。再加上 Predicate 的字符串格式函数本身存在比较符和 AND 丢失问题，Trace 中显示的条件也不一定是原 SQL 的无损表示。

## 当前实现中还没有收口的地方

除了没有成熟优化器、谓词下推和 join 算法选择，重新核对代码还看到几处更具体的问题：

- `BetterQueryPlanner` 未被默认入口实例化，而且它依赖的 `ExpressionGetTableName` 当前不能正确返回 Parser 保存的表名；即使手工接入，也要先修这条接口。
- `ProductScanBeforeFirst` 会尝试把左侧推进到第一条，却忽略失败结果。左表为空而右表非空时，后续 `next` 仍可能推进右侧，形成左游标无有效记录的异常状态。
- 重名字段按“左侧优先”处理，不等于实现了限定字段和歧义检查。
- View 递归没有环检测，Update Planner 也缺少字段/值数量等完整校验。
- 多个 Plan/Scan 的销毁与子对象所有权不够统一，主流程能跑通不代表所有错误分支都释放资源。
- TablePlan 会取得统计信息，但 BasicQueryPlanner 并不据此优化；distinct value 又只是 `1 + records / 3` 的固定估计。

现有 `PlanScanBasicTest` 验证了 Table → Select → Project 和结果读取，Update 测试覆盖 create、insert、modify、delete，以及 view/index 元数据。仓库 demo 能跑多表查询。这些测试证明主链路可执行，却没有覆盖空表 Product、同名列、循环视图、不同连接顺序或大数据量代价。

## 一条 SQL 帮我看见了什么

最初写这些模块时，我把 Planner 理解为“把 SQL 换成几个结构体”。把完整调用链重新走一遍后，我更在意的是 Plan 和 Scan 之间的分界，以及每一层只承诺什么：Parser 保存用户意图，Plan 组合执行结构，Scan 保存游标状态，TableScan 把逻辑字段映射到记录，事务和缓冲池再把访问落到页面。

DBMS_C 的执行链已经足够让我从 SQL 追到磁盘，但它选择的是最直接的路径：FROM 顺序、笛卡尔积、整体过滤、最后投影。没有必要把它包装成查询优化器；恰恰是这棵简单计划树，让我第一次能准确指出优化应该发生在哪里，也能分辨“仓库中有一段优化代码”和“默认系统真的在使用它”之间的差别。

[上一篇：我为 DBMS_C 写的 Lexer 与 Parser](../08-sql-parser/) · [下一篇：DBMS_C 的并发控制实验](../10-concurrency-control/) · [返回系列导读](../)
