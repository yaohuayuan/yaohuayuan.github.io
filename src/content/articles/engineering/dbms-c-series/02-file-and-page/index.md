---
title: 第一块数据怎样落盘：BlockID、Page 与 FileManager
description: 从 DBMS_C 的真实文件读写路径出发，复盘固定大小块、页内字节布局、文件句柄缓存，以及一次为了让回滚结果可见而补上的 fflush。
date: 2026-09-27T21:20:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - storage-engine
  - page-storage
series: dbms-c-from-zero
seriesOrder: 2
draft: false
---

写 DBMS_C 时，我最先需要解决的并不是 SQL，而是一个更笨的问题：怎样把内存中的一个整数写到文件里，再从同一个位置读回来？

如果这一步没有稳定的接口，后面的记录页、缓冲池和事务都只能直接操作 `FILE *`。那样也能做出演示，但每一层都会重复处理文件偏移、字节长度和错误情况，数据库的模块边界很快就会消失。

所以 DBMS_C 的存储底座最终被拆成三个对象：`BlockID` 回答“哪一个文件的第几块”，`Page` 回答“页内某个偏移是什么值”，`FileManager` 负责在磁盘块和内存页之间搬运字节。

这三个对象都很小，却决定了项目其余部分怎样看待数据。

## 为什么从固定大小块开始

DBMS_C 默认块大小是 4096 字节。FileManager 不理解表、字段和记录，只知道一个文件可以被切成连续的固定大小块：

```text
文件偏移 = blockSize × blockNumber
```

当前代码中的 BlockID 只保存文件名和块号：

```c
typedef struct BlockID {
    CString *fileName;
    int BlockID;
} BlockID;
```

这里没有全局页号，也没有把数据库中的所有页面放进一个大文件。TableScan 会把表名扩展成 `tableName.tbl`，系统目录则对应 `tblcat.tbl`、`fldcat.tbl` 等文件。日志也使用自己的文件。

我选择这种组织方式，主要是为了让物理位置足够直观。调试时看到 `student.tbl: 2`，就知道正在访问学生表的第三个块；追加一个块，也只是把文件长度从 `n × blockSize` 扩展到 `(n + 1) × blockSize`。

这个设计牺牲了统一空间管理。真实数据库通常还要考虑表空间、页面回收、空闲页映射和文件增长策略，而 DBMS_C 只是让每张表独立增长。对于第一次实现存储层，这个简化让我能先把“逻辑记录最终落到哪一段字节”解释清楚。

## Page 不是记录，它只是一段字节

`Page` 本身几乎没有状态：

```c
typedef struct Page {
    ByteBuffer *buffer;
} Page;
```

真正保存数据的是 `ByteBuffer`。它包含字节数组、当前位置、容量和 limit。Page 只是把常用操作包装成 `PageGetInt`、`PageSetInt`、`PageGetString` 和 `PageSetString`。

整数没有直接通过 `memcpy` 写入，而是被显式拆成四个字节：

```c
buffer->data[buffer->position++] = data & 255;
buffer->data[buffer->position++] = (data >> 8) & 255;
buffer->data[buffer->position++] = (data >> 16) & 255;
buffer->data[buffer->position++] = (data >> 24) & 255;
```

读取时再按相反方式组合。因此当前磁盘格式实际采用低字节在前的顺序。这样做的好处是文件格式不直接依赖编译器怎样布置一个 `int`；坏处是我必须自己保证移位、类型宽度和符号行为正确。

这一层暴露了很典型的 C 问题。接口上层使用 `int`，底层实现使用 `int32_t`，代码默认二者都是四字节；读取最高字节时又把 `uint8_t` 转成有符号 `int32_t` 后左移 24 位，可移植性并没有被系统测试。当前 Windows + MinGW 环境可以工作，但文件里没有字节序标识、格式版本或校验和，换平台时不能只看“C 代码能编译”。

## 为什么字符串前面要保存长度

Page 中的字符串格式是：

```text
+--------------------+-----------------------+
| 4-byte length      | length bytes content  |
+--------------------+-----------------------+
```

写入代码先放长度，再放字符内容：

```c
void PageSetString(Page *p, int position, const CString *cs) {
    int length = (int)cs->length;
    p->buffer->position = position;
    bufferPutInt(p->buffer, length);
    bufferPutBytes(p->buffer, (uint8_t *)cs->data, length);
}
```

我没有把结尾的 `\0` 写进页面。读取时先取长度，分配 `length + 1` 字节，在内存中补上终止符，再构造 CString。

这为后面的 Layout 提供了一个简单规则：`VARCHAR(n)` 在记录槽中最多占 `n + 4` 字节。它仍然是定长槽，只是槽内字符串使用长度前缀表示实际内容。

这里也留下了一个实际的内存泄漏。`PageGetString` 先 `malloc` 一个临时 `char *`，随后 `CStringCreateFromCStr` 会复制内容，但函数返回前没有释放这个临时数组。数据库短时间演示时很难看见，长时间扫描字符串字段时却会持续积累。

另一个问题是错误值被吞掉。ByteBuffer 的 put/get 函数会返回 `BYTEBUFFER_ERROR_BOUNDS`，但 Page 接口通常忽略返回值。一次越界写不会被事务层明确感知，调用者可能继续使用没有完整写入的页面。这也是当前错误处理还没有贯穿各层的例子。

## FileManager 怎样找到文件

FileManager 保存数据库目录、块大小、新库标记和一个文件句柄 Map：

```c
typedef struct FileManager {
    CString *dbDirectoryName;
    DIR *dbDirectory;
    int blockSize;
    bool isNew;
    CMap cMap;
} FileManager;
```

初始化时，它尝试打开数据库目录。目录不存在就创建，并把 `isNew` 设为 true。这个标记之后会影响元数据层：新库需要创建系统目录表，旧库则直接读取已有目录。

第一次访问文件时，`FileManagerGetFile` 先尝试 `rb+`，不存在则使用 `wb+` 创建，再把 `FILE *` 缓存在 Map 中。后续对同一文件的访问复用这个句柄。这样可以避免每次页读写都重新打开文件，也让 FileManager 成为整个数据库共享的文件状态入口。

读取一个块时，代码先检查目标偏移是否超过文件尾：

```c
long target = (long)fm->blockSize * blockId->BlockID;
fseek(file, 0, SEEK_END);
long fileSize = ftell(file);

if (target >= fileSize) {
    memset(page->buffer->data, 0, fm->blockSize);
    return;
}
```

不存在的块不会返回错误，而是得到一个全零页；短读也会把剩余区域补零。这让上层更容易把新块当成空页处理，但同时隐藏了“不存在的块”和“合法的零页面”之间的差异。

## 追加块为什么先写一整页零

`FileManagerAppend` 用当前文件长度计算新块号，再写入一个完整的零缓冲区：

```c
int newBlockNumber = FileManagerLength(fm, filename);
char *zeroPage = calloc(1, fm->blockSize);
BlockID *block = BlockIDInit(filename, newBlockNumber);

fseek(file, (long)newBlockNumber * fm->blockSize, SEEK_SET);
fwrite(zeroPage, 1, fm->blockSize, file);
fflush(file);
```

这样做以后，文件长度永远是块大小的整数倍，`FileManagerLength` 只要计算 `ftell(file) / blockSize`。TableScan 需要新记录页时，可以直接把返回的 BlockID 交给 RecordPage 格式化。

它没有维护空闲块列表，也不会收缩文件。删除记录只会让记录槽变空，不会把磁盘块交还给操作系统。对教学原型来说，这让追加逻辑足够简单；对长期运行的数据库来说，空间回收会成为必须补上的一层。

## 一次与 ROLLBACK 有关的文件问题

Git 历史中，2024 年 11 月 13 日有一条提交说明：“通过测试对文件进行修改，目前来说 Rollback 还存在一定问题。”这次修改里，FileManager 的写入顺序被调整，并在 `fwrite` 后增加了 `fflush`。

当时调试恢复代码时，事务把页面写回文件，测试紧接着又通过同一进程读取并比较结果。如果只写入 C 标准库的用户态缓冲区，观察到的状态可能和预期的持久化时机不一致。增加 `fflush` 后，测试中的写后读变得稳定，也更容易判断问题究竟在日志撤销还是文件刷新。

这并不等于实现了工业级持久化。`fflush` 只要求把 C 库缓冲交给操作系统，没有调用 `fsync` 或 Windows 对应的强制落盘接口。断电语义、磁盘缓存和写入顺序仍然没有被保证。项目当前能验证的是进程内和正常退出下的读写，不是掉电恢复。

早期 FileManager 还分别维护过数据和类型信息，提交 diff 中能看到 `File_Data` 与 `File_Type` 两个文件句柄。当前版本已经简化为一个原始字节页：类型解释由 Schema 和 Layout 负责，FileManager 不再知道某几个字节代表整数还是字符串。这个变化让层次更清楚，也减少了文件层与记录层的重复信息。

## 测试真正验证了什么

`FileManagerBasicTest` 注册了五个用例：

- 在同一 Page 中按偏移写入并读回整数；
- 写入并读回带长度前缀的字符串；
- 比较 BlockID，并检查 `fileName: blockNumber` 字符串格式；
- 把整数和字符串写入文件块，再用另一个 Page 读回；
- 连续追加两个块，确认块号和文件长度递增。

这些测试覆盖了当前存储层最重要的闭环，但没有覆盖损坏文件、负块号、超长路径、写入失败、并发访问和跨字节序读取。测试使用 400 字节块，是为了让用例更轻；主程序使用的仍是 4096 字节。

## 当前实现的边界

重新阅读这一层后，我认为主要问题不在算法，而在接口契约还不够严格：

- Page 没有把 ByteBuffer 越界错误返回给调用者；
- PageGetString 存在临时内存泄漏，字符串长度也缺少上限校验；
- 文件路径使用固定 512 字节数组，超长路径会被截断；
- 文件格式没有版本、校验和和字节序说明；
- FileManager 中预留过读写锁，但当前锁调用仍被注释；
- `fflush` 不等于物理持久化，崩溃与断电语义没有验证；
- FileManagerDestroy 关闭了文件和目录，却没有完整释放 FileManager 自身及所有字段。

尽管如此，BlockID、Page 和 FileManager 仍然完成了我当时最需要的事情：把上层的记录操作收敛成“对某个文件块中的某段字节进行读写”。下一层 Buffer Pool 可以在不理解表结构的情况下缓存这些页面，也可以在替换页框时把它们原样写回。

[上一篇：DBMS_C 是怎样开始的](../01-project-origin/) · [下一篇：内存中只有八个页框](../03-buffer-pool/) · [返回系列导读](../)

