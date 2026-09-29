---
title: 不做完整 SQL：我为 DBMS_C 写的 Lexer 与 Parser
description: 复盘 DBMS_C 如何把有限 SQL 拆成 Token、QueryData 和 CommandData，以及为了先接通数据库主链路而主动留下的语法、错误处理与字段限定问题。
date: 2026-09-28T09:40:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - SQL
  - parser
series: dbms-c-from-zero
seriesOrder: 8
draft: false
---

写 DBMS_C 时，我没有把目标定成“实现 SQL 标准”。如果一开始就处理聚合、子查询、NULL、JOIN 语法、优先级和类型推导，这个项目很可能长期停在 Parser，后面的 Plan、Scan、Transaction 和 Page 永远接不起来。

我当时真正需要的是一门够用的输入语言：能建表，能写入和修改记录，也能把投影、表名和筛选条件交给执行层。这个范围不大，却刚好能让一条命令从字符串一路走到磁盘。Parser 模块因此不是通用 SQL 编译器，而是 DBMS_C 内部对象的构造入口。

## 先把字符流切成 Token

最底层的 `StreamTokenizer` 先跳过空白、`--` 行注释和 `/* ... */` 块注释，再产生几种简单 token：

- 以字母或下划线开头的 WORD，后续允许字母、数字和下划线；
- 只由数字组成的 NUMBER；
- 用单引号包围的 STRING；
- 单字符符号，以及合并识别的 `>=`、`<=`、`!=`、`<>`。

`Lexer` 在其上提供两组函数。`LexerMatchId`、`LexerMatchKeyword` 只看当前 token 是否匹配；`LexerEatId`、`LexerEatKeyword` 在确认后推进到下一个 token。关键字用不区分大小写的比较，因此 `SELECT` 和 `select` 都能进入同一路径。

例如这条仓库 demo 中同类型的多表查询：

```sql
SELECT name, course, grade
FROM student, score
WHERE id = sid;
```

会依次得到 `SELECT`、三个字段名、`FROM`、两个表名、`WHERE`、两个字段名和等号。Lexer 不理解“name 是投影字段”或“id = sid 是条件”，它只负责把边界切开；语义结构由 Parser 决定。

这个简单实现有真实限制。NUMBER 不包含符号，所以 `-1` 会被拆成 `-` 和 `1`，当前文法不能把它当作负整数。字符串扫描能越过 SQL 中表示单引号的 `''`，但不会把双单引号反解码为单个字符。整数 token 内部保存为 `long long`，`LexerEatInt` 最后直接转为 `int`，也没有做范围检查。

## Parser 是一组手写递归下降函数

查询入口 `ParserQuery` 的控制流基本就是当前文法本身：

```text
query      := SELECT fields FROM tables [WHERE predicate]
fields     := * | field [, field ...]
tables     := id [, id ...]
predicate  := term [AND predicate]
term       := expression compare-op expression
expression := integer | string | field | table.field
```

代码没有先生成通用 AST，再做多轮 lowering。`ParserQuery` 直接构造 `QueryData`，其中保存三个部分：投影字段链表、FROM 表名链表和一个 `Predicate`。`Predicate` 持有若干 `Term`，`Term` 持有左右两个 `Expression` 和比较操作符；`Expression` 则是常量或字段引用。

AND 用递归解析：读完一个 term 后，如果看到 `AND`，继续解析剩余 predicate。没有 OR、NOT 和括号，也没有 SQL 三值逻辑。比较操作符当前支持 `=`、`!=`、`<>`、`<`、`<=`、`>`、`>=`；但 `ParserTerm` 取得当前操作符后会直接推进 token，没有对 `OP_UNKNOWN` 做完整拒绝，错误可能被拖到执行期。

我喜欢这套表示的一点，是它恰好对应后面的 Scan 接口。`TermIsSatisfied` 在当前 Scan 上求左右表达式，再比较两个 Constant；`PredicateIsSatisfied` 逐项检查 term。它没有多余的编译阶段，调试时可以直接从 WHERE 结构追到每一行记录。不过这也是它难以继续扩展优先级、函数调用和复杂表达式的原因。

## SELECT 与更新命令最后变成什么

查询只产生 `QueryData`；会修改数据库的语句则产生 `CommandData` 联合体。当前映射如下：

| SQL | Parser 产物 | 保存的主要内容 |
| --- | --- | --- |
| `SELECT` | `QueryData` | 字段、表、Predicate |
| `INSERT` | `InsertData` | 表名、字段链表、常量链表 |
| `DELETE` | `DeleteData` | 表名、Predicate |
| `UPDATE` | `ModifyData` | 表名、一个目标字段、Expression、Predicate |
| `CREATE TABLE` | `CreateTableData` | 表名、Schema |
| `CREATE VIEW` | `CreateViewData` | 视图名、QueryData |
| `CREATE INDEX` | `CreateIndexData` | 索引名、表名、字段名 |

字段类型也只开放 `INT` 和 `VARCHAR(n)`。UPDATE 一次只能给一个字段赋值；INSERT 的字段和值分别保存，Parser 没有验证两条链表长度一致。后面的 `BasicUpdatePlanner` 按字段迭代并解引用 value 节点，因此值少于字段时可能直接访问空指针，值多时多余值又会被忽略。这不是 SQL 语义取舍，而是输入验证缺失。

顶层更新解析同样偏乐观：匹配不到 INSERT、DELETE、UPDATE 时就转入 CREATE 分支，未知命令最终通常在某个 `EatKeyword` 中结束进程。解析完一条合法前缀后也没有统一检查 EOF，因此尾部多余 token 未必被拒绝。

## 为什么主动只做这个子集

2024 年的代码先有 Lexer 雏形，完整 Parser 和 QueryData/CommandData 主链路在 2025 年 8 月进入仓库，之后才陆续补比较符、限定字段和 `SELECT *`。这个顺序很符合项目当时的目标：先让 `CREATE → INSERT → SELECT → UPDATE → DELETE` 全部能抵达存储层，再补足演示真正需要的语法。

这个选择帮助我控制了范围。逗号分隔的多表 FROM 已经足以构造 ProductPlan；WHERE 中的字段比较足以从笛卡尔积中过滤连接结果；视图只要能保存 QueryData 并重新解析，就能验证元数据到 Planner 的递归链路。少写一套 JOIN 语法并没有阻碍我理解当前执行器，反而让我更早遇到跨层问题。

代价也同样清楚：这套语法不能被介绍成“支持 SQL”。它支持的是为了 DBMS_C 主路径挑选出来的一组语句形状。

## 表限定字段只完成了一半

Parser 的 `Expression` 能识别 `student.id`，把表名和字段名分开保存；但这条信息没有贯穿后续系统。

首先，SELECT 列表使用的 `ParserField` 只读取一个标识符，不接受 `table.field`。其次，`ExpressionEvaluate` 最终仍只按字段名向 Scan 取值，没有利用保存的 table name。`ProductScan` 遇到两边都有同名字段时优先取左侧字段，因此限定名并不能真正解决歧义。

还有一个更直接的接口断裂：`ExpressionGetTableName` 没有返回 `expr->tableName`，而是尝试在单独保存的 `fldname` 中再次寻找点号。Parser 已经把点号拆掉，所以这个函数通常得到 NULL。未接入默认启动路径的 `BetterQueryPlanner` 正好依赖它来判断谓词属于哪张表，这会让那套谓词分类失效。

字段别名、表别名和显式 JOIN 都没有实现。这些不是漏写在 README 的功能，而是当前表达式和 Scan 接口还没有闭合的地方。

## 最粗糙的部分是错误传播

几乎所有 `LexerEat*` 在不匹配时都是：打印一条错误，然后 `exit(1)`。这对最初的命令行实验很直接，却让 Parser 无法把“第几行、第几列、期望什么”返回给调用者，也无法在一个长期运行的服务中只取消当前语句。Lexer 只在初始化遇到非法 token 时打印错误，错误对象、同步点和恢复策略都不存在。

这类写法也让测试更偏向 happy path。当前 Parse 测试覆盖 SELECT、INSERT、UPDATE、DELETE、CREATE TABLE/VIEW/INDEX 等有效输入，但没有系统覆盖缺失逗号、未闭合字符串、字段/值数量不一致和尾部垃圾 token。

## 保存视图时暴露出的序列化问题

[上一篇](../07-metadata-bootstrap/) 提到，视图目录保存的不是用户原始 SQL，而是 `QueryDataToString` 的结果。重新读这组 `ToString` 函数后，我发现它们并不是 Parser 的可靠逆过程：

- `TermToString` 无论原操作符是什么，都拼成 `left=right`；
- `PredicateToString` 把多个 term 直接相连，没有补 `AND`；
- 字符串 Constant 输出时没有重新加 SQL 单引号。

因此一个包含 `grade >= 60 AND course = 'db'` 的视图定义，写入 `viewcat` 后可能已经无法表达原查询。现有 View 测试使用的是简单、无 WHERE 的查询，所以没有捕获这个缺陷。这也是我不愿把“视图已实现”简化成一个勾选项的原因：单次解析成功和语句可以持久化后再次解析，是两件不同的事。

## 现在怎样评价这套 Parser

它最大的价值不是文法有多完整，而是给后面的 Planner 提供了稳定而足够小的数据结构。借助它，我能把一条真实 SQL 追踪成 QueryData、Plan 树和 Scan 链，而不必先完成一门庞大的语言。

但范围小不应该成为粗糙错误处理的借口。字段限定信息丢失、Command 参数未校验和视图序列化不对称，都是现在应当优先补的接口问题。若继续开发，我会先让 Parser 返回可传播的错误结果，为 token 加位置，并让 QueryData 的序列化具备往返测试；扩展更多 SQL 语法反而排在它们之后。

[上一篇：DBMS_C 的系统目录与自举](../07-metadata-bootstrap/) · [下一篇：Plan、Scan 与执行链](../09-query-execution/) · [返回系列导读](../)
