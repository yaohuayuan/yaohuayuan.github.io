---
title: 数据库怎样认识自己的表：DBMS_C 的系统目录与自举
description: 从 tblcat、fldcat、viewcat 和 idxcat 的真实实现出发，复盘 DBMS_C 如何用普通表保存元数据，又如何解决第一次启动时“先认识自己”的问题。
date: 2026-09-28T09:30:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - metadata
  - system-catalog
series: dbms-c-from-zero
seriesOrder: 7
draft: false
---

做到 [RecordPage](../04-record-storage/) 和 [Transaction](../05-transaction/) 之后，我已经能把一组字段写进页面，但数据库还回答不了一个更基础的问题：`student` 表有哪些字段？每个字段在记录的哪个偏移？打开旧数据库时，又从哪里把这些信息找回来？

我最初容易把 Metadata 想成存储层之外的一张“配置表”。真正实现时才发现，它必须回到同一套存储链路：表结构也要持久化，而 DBMS_C 没有另一套专用格式。于是 `tblcat`、`fldcat`、`viewcat` 和 `idxcat` 最终都是普通表，也都通过 `TableScan → RecordPage → Transaction` 读写。

这样设计没有消除问题，只是把问题变得更明确：普通表需要 Layout 才能读取，Layout 又要从系统目录中读取。第一次创建数据库时，系统目录还不存在，数据库必须先用一小段写死在代码里的结构“认识自己”。这就是 DBMS_C 的 metadata bootstrap。

## 四张目录表保存了什么

`TableManagerInit` 先在内存中构造两套固定 Schema。当前字段定义如下：

| 目录表 | 字段 | 当前用途 |
| --- | --- | --- |
| `tblcat` | `tblname VARCHAR(16)`, `slotsize INT` | 保存表名和定长记录槽大小 |
| `fldcat` | `tblname VARCHAR(16)`, `fldname VARCHAR(16)`, `type INT`, `length INT`, `offset INT` | 保存每个字段的类型、长度和槽内偏移 |
| `viewcat` | `viewname VARCHAR(16)`, `viewdef VARCHAR(100)` | 保存视图名和 SQL 定义文本 |
| `idxcat` | `indexname VARCHAR(16)`, `tablename VARCHAR(16)`, `fieldname VARCHAR(16)` | 保存索引名、表名和字段名 |

这里没有序列化一个完整的 `Schema` 对象。创建用户表时，`TableManagerCreateTable` 先用 [上一篇记录存储文章](../04-record-storage/) 介绍的 `LayoutInit` 算出 slot size 和字段偏移，再向 `tblcat` 插入一行，向 `fldcat` 为每个字段各插入一行。

核心动作可以缩写成这样：

```c
Layout *layout = LayoutInit(schema);

TableScan *tcat = TableScanInit(tx, "tblcat", tm->tableCatalogLayout);
TableScanInsert(tcat);
TableScanSetString(tcat, "tblname", tableName);
TableScanSetInt(tcat, "slotsize", LayoutSlotSize(layout));

for (each field in schema) {
    TableScanInsert(fcat);
    TableScanSetString(fcat, "tblname", tableName);
    TableScanSetString(fcat, "fldname", fieldName);
    TableScanSetInt(fcat, "type", SchemaType(schema, fieldName));
    TableScanSetInt(fcat, "length", SchemaLength(schema, fieldName));
    TableScanSetInt(fcat, "offset", LayoutOffset(layout, fieldName));
}
```

这也是“系统目录本身也是表”的具体含义。目录行没有绕开事务直接写文件，没有单独的 catalog page 格式；它和用户记录一样占用固定槽，也同样经过缓冲池、日志和锁。

## 第一次启动怎样创建“自己”

`SimpleDBInit` 先建立 FileManager、LogManager 和 BufferManager，再创建一个事务，然后把 `FileManagerIsNew` 的结果交给 `MetadataMgrInit`。当目录是新建的，初始化顺序是：

```text
在 C 结构体中构造 tblcat / fldcat 的 Schema 与 Layout
                    ↓
用这两套内存 Layout 调用 TableManagerCreateTable
                    ↓
TableScan 第一次打开空的 .tbl 文件并格式化第 0 页
                    ↓
把 tblcat、fldcat 自己的描述写回两张目录表
                    ↓
创建 viewcat，扫描目录生成统计信息，再创建 idxcat
                    ↓
初始化 Planner，提交 bootstrap 事务
```

关键不是“目录表凭空出现”，而是 `TableManager` 暂时掌握了 `tblcat` 和 `fldcat` 的内存 Layout。它靠这两个最小先验打开空表；`TableScan` 发现文件长度为 0 时会追加并格式化第一页；随后系统目录的描述才成为普通记录。系统先认识两张最基础的表，才有能力继续认识其他表。

这个顺序还带来一个不那么明显的细节。`MetadataMgrInit` 依次创建 `TableManager`、`ViewManager`、`StatManager` 和 `IndexManager`。新数据库中，`StatManager` 第一次扫描 `tblcat` 时，`idxcat` 还没有创建，因此初始统计缓存里不会包含它；以后真的查询该表时只能按需计算。它不影响目前的主路径，却说明 bootstrap 的依赖顺序已经开始影响运行状态。

## 再次打开数据库时怎样重建 Layout

旧数据库启动时，`TableManager` 仍会在内存中构造 `tblcat` 和 `fldcat` 的固定 Layout，但不会重新插入目录记录。之后 `TableManagerGetLayout("student")` 做两次顺序扫描：

1. 扫描 `tblcat`，找到 `student` 的 `slotsize`；
2. 扫描 `fldcat`，收集所有属于 `student` 的字段、类型、长度和 offset；
3. 用读出的 Schema、offset map 和 slot size 构造新的 `Layout`。

这条路径让我真正理解了元数据和数据并不是两个世界。重新打开数据库时，字段 offset 不是再次猜测或重新排列，而是从当初持久化的 `fldcat` 记录中恢复。与此同时，当前实现也没有 Layout 缓存：每次 `GetLayout` 都会重新扫描目录表。表少时足够直观，表多以后会成为确定的额外开销。

`SimpleDBInit` 在旧目录上会打印 `recovering existing database`，但这里的“recovering”只是打开已有目录并重建元数据环境，[日志篇](../06-log-and-recovery/) 已经说明它没有触发崩溃恢复。

## View：目录中只有一段 SQL

`ViewManagerCreateView` 向 `viewcat` 写入 `viewname` 和 `viewdef`。它没有生成物化结果，也没有为视图建立新的数据文件。查询规划器发现 FROM 项是视图后，取回定义文本，重新交给 Parser，再递归创建 Plan。

这让视图实现很轻，也复用了已有查询链路。但定义是由 `QueryDataToString` 重新拼接的 SQL，而不是直接保存用户输入；当前表达式序列化对比较符、字符串引号和多个 AND 条件处理并不完整。也就是说，简单视图能工作，复杂谓词可能在“保存—重新解析”之间变形。这个问题会在 [Parser 篇](../08-sql-parser/) 继续展开。

视图名限制为 16 字节，定义字段限制为 100 字节，代码没有在写入前做可靠的长度拒绝，也没有检测重复名称和循环引用。`v1` 引用 `v2`、`v2` 再引用 `v1` 时，递归规划没有终止条件。

## Index：目前保存的是登记信息

`IndexManagerCreateIndex` 当前只向 `idxcat` 插入三项字符串：索引名、表名、字段名。`IndexManagerGetIndexInfo` 可以据此取得表 Layout 和统计信息，并构造索引记录的 Layout；但默认的 `BasicQueryPlanner` 不读取这些信息，INSERT、UPDATE、DELETE 也不会维护索引桶。

所以 `CREATE INDEX idx_score ON score(id)` 在当前 DBMS_C 中证明的是“索引元数据已经登记”，不是“查询已经能使用并保持这个索引”。仓库里的 Metadata 测试也只验证能从目录重建 `IndexInfo`。把这层边界写清楚，比看到 `IndexManager` 就声称索引系统完成更重要。

## StatManager 不是持久化统计系统

`StatManagerInit` 会扫描 `tblcat`，再逐表打开 `TableScan` 统计记录数和块数。结果只保存在内存 map 中；重启数据库后重新扫描，不会写回系统目录。

它对 distinct value 的估计也很直接：无论字段中实际是什么值，都返回 `1 + numRecords / 3`。缓存命中超过 100 次后，下一次调用会刷新整张统计表；新创建而尚未进入缓存的表则按需扫描。数据变更不会立即让缓存失效。

还有一个边界值得记录：块数是在遍历记录时用当前 RID 的 block number 加一计算的。一个已经分配了物理页但没有记录的空表，会得到 0 blocks。这些数字够基础代价接口使用，却不能称作成熟的统计信息系统。

## 实现过程中暴露的工程问题

元数据模块在 2024 年 11 月先加入 Table、View 和统计管理，2024 年 12 月的“最终版本”提交才补上 IndexManager 和统一的 MetadataManager。这个历史也解释了为什么当前代码更像逐层拼起来的功能集合，而不是从一开始就设计好的 catalog 内核。

重新读代码后，我确认了几处还没有收口的问题：

- `CREATE TABLE` 没有检查重名。重复创建会继续向 `tblcat`、`fldcat` 追加记录；重建时第一个 slot size 和全部同名字段行可能混在一起。
- 查询不存在的表时，`TableManagerGetLayout` 仍可能返回 slot size 为 `-1` 的 Layout，而不是明确错误。
- 表名、字段名和视图定义都依赖固定长度 `VARCHAR`，上层没有完整的长度校验，超长输入不只是显示被截断的问题，还可能破坏记录槽边界。
- 多处临时 Schema、Layout、RID 和 map 重建缺少清晰的所有权协议；`MetadataMgrFree` 有声明但没有实现，资源释放并没有闭环。
- 使用自定义 block size / buffer size 的 `SimpleDBInit` 分支只创建文件、日志和缓冲管理器，没有初始化 metadata 和 planner。这条接口能得到一个底层对象，却不能像默认入口一样执行 SQL。

## 现在回头看 bootstrap

我当时选择把系统目录做成普通表，是因为它让项目复用了已经完成的 RecordPage、TableScan 和 Transaction，不需要再维护一种 catalog 专用文件格式。代价是启动顺序、固定的目录 Schema 和依赖关系必须非常小心。

DBMS_C 的自举并不神秘：两份硬编码的最小 Layout 打开两张空表，再把系统自己的描述写进去。它也远非工业实现——没有版本迁移、目录约束、缓存一致性和完整错误处理。但这段代码让我第一次从实现上看到，Metadata 不是贴在数据库外面的说明书；它也是需要落盘、扫描、加锁并在事务中提交的数据。

[上一篇：Undo 日志与恢复机制复盘](../06-log-and-recovery/) · [下一篇：我为 DBMS_C 写的 Lexer 与 Parser](../08-sql-parser/) · [返回系列导读](../)
