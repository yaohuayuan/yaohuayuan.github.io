---
title: 一条记录在页面里长什么样：Schema、Layout 与 RecordPage
description: 从 DBMS_C 的 Schema、Layout、RecordPage 和 TableScan 出发，拆开一条记录怎样变成固定槽中的字节，以及这种简单布局带来的空间浪费和边界问题。
date: 2026-09-28T09:00:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - record-storage
  - storage-engine
series: dbms-c-from-zero
seriesOrder: 4
draft: false
---

前两篇已经把磁盘块、Page 和 Buffer Pool 接了起来，但那几层并不知道“学生编号”或“姓名”是什么。对 FileManager 来说，4096 字节只是 4096 个字节；对 Buffer 来说，它们只是一个需要 pin、可能变脏、最后还要写回的页面。

真正把字段变成页内偏移的是 record 模块。这里没有复杂的 slotted page，也没有记录头、变长区和碎片整理。DBMS_C 选择的是一条更容易第一次做通的路线：Schema 保存字段定义，Layout 提前算好每个字段的位置，RecordPage 把页面等分成固定大小的槽，TableScan 再把多个页面串成一张表。

这套设计简单到一张纸就能画完，也正因为简单，它把我当时回避掉的问题暴露得很清楚。

## Schema 先保存“有哪些字段”

`Schema` 同时维护字段链表和字段信息 Map：

```c
typedef struct Schema {
    FieldNode *fields;
    map_FileInfo_t *MapFileInfo;
} Schema;
```

链表保留字段加入的顺序，Map 则把字段名映射到 `FileInfo { type, length }`。`SchemaAddIntField` 固定登记类型 `INTEGER` 和长度 4；`SchemaAddStringField` 登记 `VARCHAR` 与声明长度。

之所以保留两份结构，是因为后面有两类访问。一类需要按定义顺序遍历字段来计算布局，另一类需要按名字查询类型和长度。只用 Map 会让字段顺序依赖容器实现；只用链表又会让每次 `SchemaType` 都线性查找。

需要注意的是，`Schema.h` 的枚举列出了 BIT、BIGINT、DOUBLE、DATE 等很多类型，但当前记录主路径实际只为整数和字符串提供了布局及读写分支。枚举里有一个名字，不等于存储层已经支持这种类型。

Git 历史里，Schema 在 2024 年 10 月 31 日先以“完成还未测试”的状态提交，Layout 在同一天完成测试版本。这很符合当时的开发顺序：先把“字段列表”做出来，再解决“字段到底放在哪”。后来的 CMocka 用例才补上字段类型、长度和存在性检查。

## Layout 把逻辑字段变成偏移

`LayoutInit` 从 `sizeof(int)` 开始安排第一个字段：

```c
int pos = sizeof(int);
FieldNode *fieldNode = schema->fields;

while (fieldNode != NULL) {
    map_set(layout->offsets,
            CStringGetPtr(fieldNode->fileName), pos);
    pos += LayoutLengthInBytes(schema, fieldNode->fileName);
    fieldNode = fieldNode->next;
}

layout->SlotSize = pos;
```

开头空出的 4 字节不是字段，而是记录状态位。整数占 `sizeof(int)`；字符串占声明长度再加 4 字节，因为 Page 层使用“长度前缀 + 内容”的格式。

以测试中的结构为例：

```sql
id   INT
name VARCHAR(20)
```

一个槽的真实布局是：

```text
slot 起点
  +0   ~ +3   状态位：EMPTY / USED
  +4   ~ +7   id
  +8   ~ +11  name 的实际长度
  +12  ~ +31  name 预留的 20 字节内容区

SlotSize = 4 + 4 + (4 + 20) = 32 bytes
```

`VARCHAR(20)` 因此并没有让记录长度随字符串变化。写入 `"a"` 和写入 `"abcdefghijklmnopqrst"` 都占用 24 字节，只是长度前缀分别为 1 和 20。这里的“变长”只存在于字段编码中，不存在于槽大小中。

我当时选择固定槽，原因不是它更先进，而是它把地址计算变成了一个乘法和一个加法：

```text
字段物理位置 = slot × SlotSize + LayoutOffset(field)
```

这样不需要槽目录，不需要移动记录，也不需要处理更新后记录变大。代价则是短字符串浪费空间，长字符串不能自然扩展。

## RecordPage 不拥有 Page，它通过 Transaction 访问

`RecordPage` 只保存事务、BlockID 和 Layout：

```c
typedef struct RecordPage {
    Transaction *transaction;
    BlockID *blockId;
    Layout *layout;
} RecordPage;
```

初始化时它会让 Transaction pin 目标块。读取整数时，RecordPage 先算偏移，再把请求交给事务：

```c
int fldPos = RecordPageOffset(recordPage, slot)
           + LayoutOffset(recordPage->layout, fldName);

return TransactionGetInt(
    recordPage->transaction,
    recordPage->blockId,
    fldPos
);
```

这意味着记录层不会绕过锁、日志和 Buffer Pool 直接读 Page。`RecordSetInt`、`RecordSetString` 也调用 `TransactionSet*`，而且把 `okToLog` 设为 true。一次普通 UPDATE 最终会记录旧值、修改 Buffer 并把页框标脏。

只有 `RecordPageFormat` 是例外。新页面格式化时，它把每个槽标为 EMPTY，把整数清零、字符串设为空串，并传入 `okToLog = false`。新追加的空页没有需要回到的旧业务值，为初始化每个字段生成 undo 日志只会制造大量无用记录。

## slot 为什么只需要一个状态位

RecordPage 定义了两个状态：

```c
typedef enum RecordPageCode {
    RECORD_PAGE_EMPTY,
    RECORD_PAGE_USED
} RecordCode;
```

插入不是把记录内容追加到页尾，而是从当前位置之后线性寻找第一个 EMPTY 槽，然后把状态改成 USED。删除则只做相反操作：

```c
void RecordPageDelete(RecordPage *recordPage, int slot) {
    RecordPageSetFlag(recordPage, slot, RECORD_PAGE_EMPTY);
}
```

字段字节没有被擦除。之后扫描只寻找 USED，旧内容便在逻辑上不可见；再次插入到这个槽时，新值会覆盖需要更新的字段。

这种删除方式容易实现，也让 RID 保持稳定，但它没有“已删除但仍对旧事务可见”之类的版本状态。当前只有 EMPTY 和 USED，不能表达 MVCC 可见性，也没有墓碑清理过程。

页面能容纳多少槽同样没有单独的页头计数。`RecordPageIsValidSlot` 直接判断下一个槽末尾是否超过块大小：

```c
return RecordPageOffset(recordPage, slot + 1)
       <= recordPage->transaction->fileManager->blockSize;
```

4096 字节页配 32 字节槽，就能放 128 条记录；页尾不足一个完整槽的部分直接不用。

## RID 是物理位置，不是业务主键

`RID` 只有块号和槽号：

```c
typedef struct RID {
    int BlockNum;
    int Slot;
} RID;
```

它表示某个表文件中的 `(block, slot)`。`TableScanGetRID` 从当前 RecordPage 的块号和 `currentSlot` 构造 RID，索引模块也用 RID 指回记录位置。

RID 不包含文件名，因此它只有和具体表一起使用时才完整。删除后槽可以复用，所以旧 RID 也可能指向后来插入的另一条记录。当前实现没有 generation number 或稳定行 ID 来识别这种复用。

## TableScan 怎样跨槽和跨页

TableScan 初始化时把表名扩展为 `tableName.tbl`。文件为空就追加第一个块、创建 RecordPage 并格式化；文件已有内容就移动到块 0。

扫描从 `currentSlot = -1` 开始。`TableScanNext` 先在当前页寻找下一个 USED 槽。如果返回 -1，并且当前页不是最后一块，就 unpin 当前页、pin 下一块，再从 -1 继续找：

```text
TableScanNext
  └─ RecordPageNextAfter(currentSlot)
       └─ 当前页找 USED
            ├─ 找到：更新 currentSlot
            └─ 没找到：移动到下一 Block，再找一次
```

插入走的是镜像流程：先找 EMPTY，当前页满了就继续下一页；如果最后一页也满了，则调用 `TransactionAppend` 增加一个块，格式化后使用第一个空槽。

INSERT、DELETE、UPDATE 因此没有三套独立的物理写入逻辑：

- INSERT 找到 EMPTY，把状态改为 USED，再通过 `TableScanSet*` 写字段；
- DELETE 把当前槽状态改回 EMPTY；
- UPDATE 不移动记录，直接通过 `RecordSet*` 改当前槽中的字段。

这也是固定槽带来的直接好处：只要字段声明长度不变，UPDATE 不会改变后续记录的偏移，RID 也不需要更新。

## 实现时躲开的难题，后来都变成了限制

固定槽让第一版 RecordPage 很快能工作，但当前代码还有比空间浪费更具体的问题。

首先，字符串写入没有检查 `CString` 是否超过 `VARCHAR(n)` 的声明长度。Layout 只预留 `n + 4` 字节，PageSetString 却按实际字符串长度写入；超长值可能覆盖下一个字段甚至下一个槽，而不是返回“字符串过长”。

其次，删除不会清空内容，也没有页面级空闲槽计数。每次插入和扫描都可能线性检查状态位；页面没有压缩、碎片整理或空闲空间目录。虽然定长槽内部不会产生传统变长记录碎片，删除后的空间也只能作为完整槽复用，不能借给别的记录。

C 的所有权问题也很明显：

- `RecordPageGetString` 从 `TransactionGetString` 得到新建 CString，却只返回内部 `char *`，CString 本身失去释放入口；
- `RecordPageFormat` 为每个字符串槽创建空 CString，但没有销毁；
- TableScan 换块时 unpin 旧页，却没有释放旧 RecordPage 和 BlockID；
- `SchemaType`、`SchemaLength` 和 `LayoutOffset` 直接解引用 Map 查询结果，字段不存在时没有错误返回；
- 当前 `TableScanMoveToRid` 把 `TableScan *` 直接传给期望 `Scan *` 的 `TableScanClose`，接口改成统一 Scan 包装后这里没有同步改对。

测试覆盖了 Schema、Layout、RID、单页插入读取、删除槽复用以及 TableScan 的插入和扫描闭环，但没有覆盖超长 VARCHAR、多页大数据量、无效 RID、删除后 RID 复用和上述 MoveToRid 路径。

## 现在回头看这套布局

如果重新实现，我不会立刻跳到最复杂的变长页，而会先修正固定槽的契约：写入时强制校验字段长度，给所有查询接口返回明确错误，统一对象所有权，并给页头增加槽数量和空闲信息。等这些不变量有测试后，再考虑槽目录、变长记录区和页面整理。

当前 RecordPage 不是工业数据库的记录格式，但它完成了项目里很关键的一次转换：Schema 中的 `name VARCHAR(20)`，最终确实能被解释成某个 `.tbl` 文件、某个块、某个 32 字节槽中的一段字节。下一层 Transaction 则负责保证这段读写不会绕开 Buffer、锁和日志。

[上一篇：内存中只有八个页框](../03-buffer-pool/) · [下一篇：DBMS_C 的 Transaction 实现](../05-transaction/) · [返回系列导读](../)
