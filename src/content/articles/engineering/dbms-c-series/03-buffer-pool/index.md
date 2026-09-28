---
title: 内存中只有八个页框：DBMS_C 的 Buffer Pool 实现与失误
description: 复盘 DBMS_C 的页框、pin/unpin、脏页刷新和替换策略，并从两次真实指针 bug 解释为什么 Buffer 必须保持对象身份。
date: 2026-09-27T21:30:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - buffer-pool
  - storage-engine
series: dbms-c-from-zero
draft: false
---

FileManager 已经能按块读写文件后，我面临的下一个问题是：难道每读一个字段，都要重新访问磁盘吗？

RecordPage 会反复读取同一个页面上的状态位和字段值，TableScan 也会在一页内遍历多个槽。如果这些操作全部直接落到 `fseek + fread`，上层虽然能工作，却没有数据库缓冲管理这一层真正要解决的问题。

DBMS_C 因此在 FileManager 上方放了一个很小的 Buffer Pool。主程序默认只创建 8 个 Buffer。数量小不是性能选择，而是为了让页面复用和替换更容易在测试中发生。

这部分代码也留下了项目里最值得复盘的两个 bug。它们都不是复杂算法错误，而是 C 中的对象身份和共享状态没有处理清楚。

## 一个 Buffer 需要保存什么

当前 Buffer 结构如下：

```c
typedef struct Buffer {
    FileManager *fileManager;
    LogManager *logManager;
    Page *page;
    BlockID *blockId;
    int pins;
    int txNum;
    int lsn;
    time_t lastUsed;
    int frame_id;
} Buffer;
```

`page` 是真正的页内容，`blockId` 说明这块内存当前对应哪个磁盘块。`pins` 表示有多少使用者正在持有它；`txNum` 和 `lsn` 用来判断页面是否被事务修改，以及刷新数据页前需要把哪条日志写出。

BufferManager 则保存一个 `CVector<Buffer *>`、总帧数、可用帧数和替换策略。`SimpleDBInit` 传入的默认容量是 8：

```c
simpleDB->bufferManager = BufferManagerInit(
    simpleDB->fileManager,
    simpleDB->logManager,
    BUFFER_SIZE,
    replacementPolicy
);
```

我没有让 Page 自己知道是否脏、属于哪个事务，因为同一个 Page 对象只是一段字节。页框的生命周期、磁盘身份和刷新状态都由 Buffer 管理，这样 File/Page 层仍然可以独立测试。

## pin 的真实含义

上层想访问某个 BlockID 时，不直接向 FileManager 要 Page，而是调用 `BufferManagerPin`。

当前 pin 流程分成两种情况：

1. 目标块已经在缓冲池里，直接返回同一个 Buffer，并把 pins 加一；
2. 目标块不在缓冲池，选择一个未固定帧，先处理它原来的页面，再绑定新块。

核心代码保留了这个顺序：

```c
Buffer *buffer = BufferManagerFindExistingBuffer(bm, blockId);
if (buffer != NULL) {
    if (buffer->pins == 0)
        bm->numAvailable--;
    BufferPin(buffer);
    return buffer;
}

buffer = BufferManagerChooseUnPinnedBuffer(bm);
BufferAssignToBlock(buffer, blockId);
bm->numAvailable--;
BufferPin(buffer);
```

对同一个块连续 pin 两次，返回的必须是同一个指针，pins 从 1 变成 2，但可用帧数只在第一次从 0 变成 1 时减少。`BufferManagerBasicTest` 专门用 `assert_ptr_equal(first, second)` 检查这一点。

unpin 并不立刻把页面写回磁盘。它只减少 pins；当计数从 1 变成 0，帧重新成为可用帧。事务层的 BufferList 会记录自己 pin 过哪些 BlockID，在提交或回滚结束后统一 unpin。

我选择 pin 计数而不是简单布尔值，是因为同一个事务或不同调用层可能重复持有同一页。只有最后一个使用者退出后，这个页框才可以被重新分配。

## 换入新块前为什么先 flush

一个未 pin 的 Buffer 仍然可能保存脏页。`BufferAssignToBlock` 在覆盖它的 BlockID 前先调用 `BufferFlush`：

```c
void BufferAssignToBlock(Buffer *buffer, BlockID *blockId) {
    BufferFlush(buffer);
    buffer->blockId = BlockIDInit(blockId->fileName, blockId->BlockID);
    FileManagerRead(buffer->fileManager, blockId, buffer->page);
    buffer->pins = 0;
}
```

顺序不能反过来。如果先覆盖 blockId，再 flush，旧页面就会被写到新块的位置；如果直接读入新页，旧的脏内容则会消失。

当前实现会复制一份新的 BlockID，但没有在重新绑定前销毁旧 BlockID，因此重复换页会泄漏这部分内存。这是 C 层面一个很常见的问题：复制对象可以避免调用者稍后释放原参数，却同时要求页框负责释放自己的旧身份。

## 脏页怎样与日志配合

事务修改页面后，不直接调用 FileManagerWrite，而是记录修改者和 LSN：

```c
void BufferSetModified(Buffer *buffer, int txNum, int lsn) {
    buffer->txNum = txNum;
    if (lsn >= 0)
        buffer->lsn = lsn;
}
```

`txNum >= 0` 在当前代码中同时承担 dirty 标记。刷新时，如果页面有合法 LSN，先要求 LogManager 把对应日志刷出，再写数据页：

```c
if (buffer->lsn >= 0)
    LogManagerFlushLSN(buffer->logManager, buffer->lsn);

FileManagerWrite(buffer->fileManager, buffer->blockId, buffer->page);
buffer->txNum = -1;
```

这是 WAL 在 DBMS_C 中最关键的一条约束：保护某次修改的日志必须先于数据页持久化。Buffer 不理解日志内容，只保存 LSN 并维持刷新顺序；旧值究竟怎样序列化，会在下一篇事务与恢复文章中继续讨论。

`BufferManagerFlushAll(bm, txNum)` 会遍历所有页框，只刷新最后修改事务号等于目标事务的 Buffer。因此提交事务时不需要知道每个数据页的文件偏移，BufferManager 可以按事务号完成筛选。

这个设计也比较粗糙。如果多个事务先后修改同一页，单个 `txNum` 无法表达更复杂的页面版本或并发关系。当前命令行主要按单事务顺序执行，所以这个限制没有在主路径里爆发出来。

## 第一个 bug：BufferList 保存了 Buffer 副本

2024 年 11 月 13 日的一条提交说明直接记录了问题：

> BufferList 中得到的东西进行修改后，BufferManager 中不能看到。

最初 BufferList 使用的 Map 把 `Buffer` 结构体按值保存。调用 `map_set(..., *buffer)` 时，页框被完整复制。之后事务从 BufferList 取到的是副本，而 BufferManager 的 vector 中保存的是另一个对象。

这会造成一种很难从接口表面发现的状态分裂：事务已经修改 Page 并设置 txNum，BufferManager 在 FlushAll 时看到的原页框却仍然是干净的。

后续修改引入了一个只保存指针的包装结构：

```c
typedef struct BufferTEMP {
    Buffer *buffer;
} BufferTEMP;

BufferTEMP *entry = BufferTEMPInit();
entry->buffer = buffer;
map_set(bufferList->buffers, key, *entry);
```

虽然 `BufferTEMP` 仍被按值放进 Map，但被复制的只是指针。事务和 BufferManager 因此重新指向同一个 Buffer。

今天看，这个包装显得有些绕，Map 如果直接支持指针值会更自然。但这次 bug 让我明确了一件事：Buffer Pool 中的页框具有身份，同一个磁盘块在池中不能悄悄出现两份彼此无关的状态。

## 第二个 bug：Buffer 创建了自己的管理器

早期 `BufferInit` 并没有直接保存外部传入的 FileManager 和 LogManager，而是重新初始化了一套：

```c
buffer->fileManager = FileManagerInit(
    fileManager->dbDirectoryName,
    fileManager->blockSize
);
buffer->logManager = LogManagerInit(
    logManager->fileManager,
    logManager->logFile
);
```

这看起来像是让每个 Buffer 自包含，实际上破坏了系统共享状态。新的 LogManager 有自己的 `latestLSN`、当前日志块和日志页；新的 FileManager 也有自己的文件句柄缓存。事务写日志使用一个实例，页框刷新却可能查询另一个实例。

2024 年 11 月 14 日的修复只有两行：

```c
buffer->fileManager = fileManager;
buffer->logManager = logManager;
```

提交说明也很明确：“问题在 Buffer 中 FileManager 和 LogManager 重新新建，其实应该直接赋值。”

这个问题与前一个 bug 本质相同：我当时还没有清楚区分“对象拥有自己的数据”和“对象引用系统共享服务”。Buffer 拥有 Page，却只应该引用唯一的文件与日志管理器。

## 2026 年加入 LRU 后，替换真的生效了吗

2026 年 2 月的一次提交为 buffer 模块加入 `ReplacementPolicy`、LRU 双向链表和哈希表。策略接口包含四个操作：

```c
record_access(frame_id);
evict();
remove(frame_id);
destroy();
```

LRUCore 能把访问过的 frame 移到链表头，从尾部查询最久未使用的 frame。单看数据结构，这是一套标准的 LRU 实现。

但重新沿着 BufferManager 主流程检查后，我发现它目前没有真正决定页面替换顺序。

`BufferManagerTryToPin` 在块未命中时，首先调用 `BufferManagerChooseUnPinnedBuffer`。这个函数从 frame 0 开始线性扫描，遇到第一个 pins 为 0 的 Buffer 就返回。只有线性扫描返回 NULL 时才调用 `policy->evict`；而扫描返回 NULL 意味着所有 frame 都仍被 pin，随后即使 LRU 返回 frame_id，代码也会因为它仍被 pin 而拒绝替换。

此外，当前代码在 pin 时执行 `record_access`，在 pins 降到 0 时反而调用 `remove`。这让 LRU 记录的是正在使用的 frame，而不是可淘汰集合。`LRUPolicyCreate` 接受 capacity 参数，但实现中也没有使用它。

所以更准确的描述是：项目实现了 LRU 数据结构和替换策略接口，BufferManager 目前仍按“第一个未 pin 帧”复用，LRU 没有成为有效的受害页选择器。

这类问题很适合用来提醒自己不要根据文件名判断功能。`buffer/LRU/` 目录存在、测试也创建了 LRUPolicy，都不能替代对调用路径的检查。

## 等待缓冲帧也只是一个实验实现

如果暂时没有可用页框，`BufferManagerPin` 会循环重试：

```c
long start = time(NULL);
while ((buffer = BufferManagerTryToPin(bm, blockId)) == NULL) {
    if (time(NULL) - start > MAX_TIME)
        return NULL;
    sleep(1);
}
```

最大等待时间是 10 秒，每次休眠 1 秒。这里没有条件变量，没有线程唤醒，也没有把“超时”包装成可传递到 SQL 层的错误。主程序如果拿到 NULL，很多上层路径也没有做好继续处理的准备。

BufferUnPin 同样直接执行 `pins--`，没有阻止重复 unpin 导致负数。`numAvailable` 是否正确完全依赖调用者遵守配对规则。这些约束在单线程演示中通常成立，在真正并发环境里则需要锁、原子操作和更严格的状态检查。

## 现有测试能证明到哪一步

Buffer 模块目前有两个 CTest 套件，共九个 CMocka 用例。比较有价值的断言包括：

- 初始化后可用帧数量等于容量；
- pin 后计数增加，最后一次 unpin 后重新可用；
- 对同一 BlockID 重复 pin 返回同一个 Buffer 指针；
- 标记脏页并 FlushAll 后，另一个 Page 能从文件中读回修改值；
- 两帧都被占用时，释放一帧后可以把它重新分配给第三个块。

但测试没有验证真正的 LRU 顺序，也没有覆盖 pins 下溢、10 秒超时、多个线程同时 pin、使用真实 LSN 的 WAL 顺序或 BufferManager 的完整销毁。较早的 BufferManagerTest 中，销毁测试环境甚至仍保留着“如果实现 destroy 函数，在这里调用”的 TODO。

因此测试能证明基础页框状态在当前顺序调用下工作，不能证明替换策略和并发语义已经完成。

## 如果现在重写这一层

我会保留 Buffer 与 BufferManager 的分层，但会先写清楚三组不变量：

1. 一个已缓存 BlockID 在池中至多对应一个 Buffer；
2. 只有 pins 为 0 的 frame 才能进入 replacer，pin 时从 replacer 移除，unpin 到 0 时加入；
3. 替换前必须按 WAL 规则刷新脏页，再释放旧 BlockID 并读入新页。

随后我会让 replacer 只管理可淘汰帧，而不是让 BufferManager 先线性选一个；给 pin/unpin 增加边界检查和同步；补齐统一 destroy；最后用确定的访问序列断言受害页确实是最久未使用的那一个。

当前 Buffer Pool 还达不到这些标准，但它确实让我第一次遇到了数据库内核中非常具体的问题：缓存的不是一份数据副本，而是具有共享身份、修改历史和持久化顺序的页框。一个错误的结构体拷贝，就足以让事务、日志和磁盘看到三个不同的世界。

[上一篇：第一块数据怎样落盘](../02-file-and-page/) · [下一篇：一条记录在页面里长什么样](../04-record-storage/) · [返回系列导读](../)

