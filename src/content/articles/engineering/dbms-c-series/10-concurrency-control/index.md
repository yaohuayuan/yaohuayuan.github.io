---
title: 有 S/X 锁，但还不是并发数据库：DBMS_C 的并发控制实验
description: 从 LockTable、ConcurrencyManager、TransactionManager 和命令行事务切换出发，复盘 DBMS_C 块级 S/X 锁的设计意图、忙等实现和没有闭合的并发语义。
date: 2026-09-28T10:00:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - concurrency-control
  - locking
series: dbms-c-from-zero
seriesOrder: 10
draft: false
---

在 [Transaction 篇](../05-transaction/) 里，我把锁概括成写入路径旁边的一条分支：读之前申请 S 锁，写之前申请 X 锁，事务结束时统一释放。继续把 `LockTable.c`、`ConcurrencyManager.c` 和 CLI 串起来后，我发现“代码里有 S/X 锁”和“系统能够正确执行并发事务”之间还隔着很多条件。

DBMS_C 的锁实现更适合被称为一次并发控制实验。它表达了共享、排他、升级和事务结束释放这些基本意图，但锁失败传播、等待方式、持有者身份、线程安全和命令行事务切换都没有闭合。我不应该因为文件名叫 `ConcurrencyManager`，就把这部分写成已经实现完整两阶段锁。

## 一张全局表怎样表示 S/X 锁

`ConcurrencyManager.c` 中有一个进程级静态指针：

```c
static LockTable *lockTable = NULL;
```

每个 Transaction 创建自己的 ConcurrencyManager，但所有 Manager 最终共享这一张 LockTable。它内部是 `map_int_t`，key 来自 `BlockID2CString(blockId)`，value 用一个整数同时表达锁类型和数量：

| value | 含义 |
| ---: | --- |
| `0` 或 key 不存在 | 没有锁 |
| 正整数 `n` | 有 `n` 个 S 锁 |
| 负数，实际使用 `-1` | 有 X 锁 |

这套编码很小，判断也直接：`value < 0` 就是 X 锁，`value > 1` 被视为“存在其他 S 锁”。但全局表只保存计数，不保存“哪些事务持有 S 锁”，X 锁也不保存 owner transaction id。后面的锁升级只能依赖当前事务自己的本地记录，加上全局总数来推断。

每个 ConcurrencyManager 还有一张私有 `map_str_t`：

```text
BlockID 字符串 → "S" 或 "X"
```

它解决两个问题：同一个事务再次读取同一块时不重复增加全局 S 计数；commit / rollback 时能够枚举自己碰过的块并统一释放。这不是锁表的副本，而是“当前事务认为自己持有哪些锁”的清单。

## 锁不是 Planner 主动申请的

锁请求藏在 [Transaction 门面](../05-transaction/) 的读写方法里：

```text
TransactionGetInt / GetString / Size
                  ↓
       ConcurrencyManagerSLock

TransactionSetInt / SetString / Append
                  ↓
       ConcurrencyManagerXLock
```

因此 TableScan 和 RecordPage 不需要知道锁类型。它们只要坚持从 Transaction 读写页面，就会经过并发管理器。`TransactionSize` 和 `TransactionAppend` 使用 block number 为 `-1` 的特殊 BlockID 表示文件尾，让读取文件长度和追加块也能围绕同一个逻辑资源申请 S/X 锁。

锁粒度是整个 BlockID，而不是 RID。两个事务即使修改同一页中的不同 slot，也会争用一个 X 锁；读取该页的任意字段也共享同一把 S 锁。对教学原型来说，这比行锁容易接进页式存储，但会制造大量本可避免的冲突。

## S 锁、X 锁和升级的真实路径

申请 S 锁时，ConcurrencyManager 先查本地 map。当前事务还没有记录该块，才调用全局 `LockTableSLock`，然后把本地类型写成 `"S"`。

申请 X 锁有三种情况：

1. 本地已经是 X，直接返回；
2. 本地是 S，调用 `LockTableUpgrade`；
3. 本地没有锁，调用 `LockTableXLock`。

升级路径假设全局 S 计数中有一个属于自己。当计数为 1 时，可以把值改成 `-1`；大于 1 时说明还有其他事务读同一块，需要等待。这个思路能表达最简化的 S→X 升级，却无法指出另外的持有者是谁，也无法建立准确的等待关系。

更严重的是，直接申请 X 时用的冲突条件同样是 `value > 1`。如果当前事务此前没有 S 锁，而另一事务恰好持有唯一一个 S 锁，全局值为 1，`LockTableXLock` 会把它误认为可升级状态，直接覆盖成 `-1`。锁表没有 owner id，因此无法区分“唯一的 S 是我自己的”还是“它属于别人”。

## 等待其实是忙等

冲突代码没有条件变量、事件或 sleep：

```c
while (LockTableHasXLock(lockTable, blockId)
       && !LockTableWaitToLong(startTime)) {
    printf("This has X Lock\n");
}
```

`LockTableTime` 被定义为 1，时间来自秒级 `time(NULL)`，判断条件是经过时间严格大于 1 秒。等待期间线程不断查询 map 并打印文本，会持续占用 CPU 和终端 I/O；实际等待也可能因为秒级取整接近两秒。它是带时间上限的自旋，而不是可调度的锁等待队列。

全局 map 本身也没有互斥保护。如果真的让多个线程同时进入这些函数，对 map 的查询和更新就可能发生数据竞争。所以即便忙等循环的逻辑正确，当前容器访问也还不是线程安全的。

## 超时并没有阻止读写继续发生

这是重新读源码时最需要写清楚的问题。

`LockTableSLock` 超时后会把 Error 设置为 `Error_HasXLock`，但函数没有 return，随后仍计算旧值加一并写回 map。原值如果是 `-1`，加一后会变成 `0`，等于破坏了已有 X 锁。ConcurrencyManager 又完全不检查这个 Error，仍把自己的本地状态记成 S。

`LockTableXLock` 也会在等待超时后设置错误，却继续把全局值写成 `-1`。ConcurrencyManager 虽然只在 Error 为空时把本地状态记成 X，但 `TransactionSetInt` / `SetString` 的接口是 `void`，不会知道申请失败，仍会继续写 Buffer。

升级函数相对谨慎：失败时会 return，不改变全局锁和本地类型。然而 Transaction 同样不检查结果，接下来的日志和页面修改照常进行。

所以当前问题不只是“错误没有显示给 SQL 用户”。锁请求失败没有成为阻止访问的控制流，有些失败路径甚至会改坏全局锁值。这也是为什么不能仅根据 Transaction 中先调用 `XLock` 的顺序，就认为写入已经被可靠互斥。

## 解锁计数也有一个边界错误

`LockTableUnLock` 想在多个 S 持有者时把计数减一，否则删除 key：

```c
if (*val > 1) {
    map_set(locks, key, *val - 1);
}
map_remove(locks, key);
```

第二个 `map_remove` 没有放进 `else`。即使刚把 2 减成 1，函数仍立刻删除整条锁记录。一个事务释放 S 锁时，另一个事务的 S 锁也从全局表中消失。这一问题没有被现有测试触发，因为测试只覆盖单个 S 锁以及先释放 X、再由另一个 Manager 申请 S 的顺序场景。

## 为什么所有锁都留到事务结束

Transaction 的普通 get/set 操作不会释放锁。`TransactionCommit` 在恢复管理器完成提交后调用 `ConCurrencyManagerRelease`，`TransactionRollback` 在 undo 完成后做同样的事，然后才 unpin 全部 Buffer。

也就是说，设计意图是：事务访问过程中只获取或升级锁，不主动降级；提交或回滚时一次释放全部锁。这个形状接近“所有 S/X 锁都持有到事务结束”的 rigorous 2PL 思路，能够避免写入完成后过早放开页面。

但我只愿称它为“2PL 形状”而不是完整协议。两阶段的生命周期没有状态机约束，提交后的 Transaction 仍可被继续调用；锁冲突和计数存在上述错误；也没有真正的并发调度测试来证明隔离结果。设计方向和实现保证必须分开评价。

## DeadlockDetector 是一座没有接上的桥

`DeadlockDetector.c` 实现了等待边链表和三色 DFS。`AddWaitForEdge` 能记录 `fromTx → toTx`，`DetectDeadlock` 在固定大小 1024 的颜色数组上寻找环，`RemoveWaitForEdges` 能删除等待边。

但 LockTable 不知道锁 owner，ConcurrencyManager 也没有 transaction id 参数；整个锁请求路径没有创建 DeadlockDetector、添加等待边或调用 `DetectDeadlock`。全仓库调用搜索显示，这些函数只在自身文件中出现。

因此它是独立算法代码，不是当前锁管理器的一部分。系统实际采用的是忙等加超时，而且超时错误没有可靠阻止上层操作。源码中存在“死锁检测器”不等于系统能检测并解除死锁。

## CLI 看似能切事务，`switch` 实际没有切换

`TransactionManager` 用事务号字符串到 `Transaction *` 的 map 保存进程内事务。CLI 启动时登记初始事务，`start_new_transaction` 会新建事务并把当前变量指向它；commit 和 rollback 结束后也会创建一个新事务。

`switch` 分支却只是调用：

```c
TransactionManagerSwitch(transactionManager, txnId);
```

返回的 `Transaction *` 没有赋给当前 `transaction` 变量。函数会打印“Switched”，后续 SQL 却仍使用原事务。这是一个明确的接口调用遗漏，不是隔离级别问题。此外，找不到事务时的日志用 `%d` 输出 `char *txnId`，格式也不匹配。

TransactionManager 会一直保留已经 commit / rollback 的事务，没有删除和释放；程序退出只提交当前事务，之前通过 `start_new_transaction` 留下的其他 running 事务也不会由 CLI 统一结束。`TransactionManagerCommit` 和 `Rollback` 虽有“遍历全部事务”的函数，但 main 没有调用它们。

## 测试证明了什么，又没有证明什么

当前 `ConcurrencyBasicTest` 有 4 个 CMocka 用例：单独申请并释放 S、单独申请并释放 X、检查本地 S/X 记录，以及释放 X 后由第二个 Manager 取得 S。所有调用都发生在一个线程中，而且按不会冲突的顺序执行。

它没有覆盖：

- 两个事务同时持有 S 后只释放其中一个；
- 一个事务持有 S、另一个直接申请 X；
- X 锁冲突超时后的全局锁值；
- S→X 升级冲突；
- 多线程对全局 map 的竞争；
- 死锁检测与牺牲事务选择；
- CLI `switch` 后 SQL 是否使用目标事务。

仓库没有注册 DeadlockDetector 测试。因而 25/25 CTest 全绿与“并发正确”并不矛盾：这些高风险路径根本不在测试范围内。

## 现在回头看这次并发实验

2024 年 11 月最早提交 ConcurrencyManager 时，我选择整数计数和事务本地 map，是为了在不引入复杂调度器的情况下先让每次页访问经过 S/X 锁。这个取舍让 [SQL 到页面](../09-query-execution/) 的主链路具备了锁的位置，也让我能观察锁升级和事务结束释放应该发生在哪里。

真正的问题是接口没有让失败成为一等结果。若重新设计，我会先让全局锁表保存持有者集合和等待队列，让 acquire 返回必须处理的状态，并用互斥量和条件变量保护锁表；Transaction 收到失败后必须停止页面访问。之后才是超时、死锁检测、隔离级别和更细粒度的锁。

这部分代码让我学到的不是“我实现了两阶段锁”，而是相反：只写出 S/X 两个名字远远不够。所有权、等待、失败传播、释放计数和可并发测试，缺一项都可能让锁看起来存在，却无法真正保护数据。

[上一篇：Plan、Scan 与执行链](../09-query-execution/) · [下一篇：写了哈希索引，却没有让查询用上它](../11-index-and-optimizer/) · [返回系列导读](../)
