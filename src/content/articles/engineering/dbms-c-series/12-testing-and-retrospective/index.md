---
title: 从“我的电脑能跑”到可复现构建：DBMS_C 的最后一公里
description: 回看 DBMS_C 的 CMake、CMocka、CTest、demo、仓库清理和 v1.0 发布过程，并总结如果重新实现一次数据库内核，我会优先改变哪些工程基础。
date: 2026-09-28T10:20:00+08:00
categories:
  - engineering
tags:
  - DBMS
  - C
  - testing
  - reproducible-builds
  - project-retrospective
series: dbms-c-from-zero
draft: false
---

DBMS_C 最早的“完成标准”很朴素：程序能编译，测试在我的电脑上通过，命令行能执行几条 SQL。直到准备 v1.0 归档，我才真正面对另一个问题：如果换到一份全新的 clone，离开 IDE 缓存、旧的数据库文件和本机编译产物，它还能不能从零构建并复现结果？

这不是给项目补一个漂亮 README，而是重新检查 CMake 引用了什么、哪些文件从未进入 Git、测试到底注册了多少、demo 覆盖了哪条链路、CI 是否执行正确命令，以及发布档案有没有把限制说清楚。

最后一公里没有增加新的数据库算法，却决定了前面十二篇描述的系统能不能被另一个人验证。

## 测试不是一次性写完的

Git 历史里，测试和功能基本是交错增长的。2024 年实现 File、Buffer、Transaction 和 Recovery 时已经有若干模块测试；2025 年 8 月重新整理仓库结构，引入 CMocka 测试与 GitHub Actions；2026 年 5 月为了配套教程，又集中补了 Lib、File、Log、Buffer、Transaction、Concurrency、Recovery、Record、Metadata、Parser、Plan 和 Update 的基础用例。

这个过程更像“实现一层，就为这一层补一个能重复触发的例子”，而不是先设计完整测试金字塔。优点是很多早期 bug 有了固定复现场景，例如 Buffer 对象共享和整数 rollback；不足是测试通常围绕当时刚完成的 happy path，模块之间的失败组合、并发竞争和崩溃注入没有同步建立。

到当前 CMake，测试按模块注册成 25 个可执行文件。每个可执行文件内部再由 CMocka 注册若干 case，CTest 只把整个可执行文件看作一个 test。因此“25 个测试”更准确的说法是：

- 25 个被 CMake 注册的 CTest / CMocka 测试套件；
- 这些套件源码中实际注册了 105 个 CMocka case；
- `test/` 下共有 26 个 `.c` 文件，其中 `test/DBMSTest.c` 没有被 CMake 注册。

本系列开始前的全新副本验证中，25/25 CTest 套件全部通过。v1.0 Release 报告也记录了相同的 Windows 11、MinGW-w64 GCC 15.2.0、CMake 环境结果。

这个数字比 README 中笼统的“25 个单元测试”更能反映结构，但仍然不能当作覆盖率。CTest 通过的是进程退出码；一个套件里有多少断言、是否覆盖失败路径，需要继续回到源码看。

## CMake 怎样把测试组织起来

顶层 `CMakeLists.txt` 把各模块源文件编成一个 `core` 静态库，`NewDBMS` 和所有测试可执行文件都链接它。测试注册被包装成宏：

```cmake
macro(add_cmocka_test TEST_NAME SOURCE_FILE)
    if(HAVE_CMOCKA)
        add_executable(${TEST_NAME} ${SOURCE_FILE})
        target_link_libraries(${TEST_NAME} PRIVATE core ${CMOCKA_LIBRARY})
        add_test(NAME ${TEST_NAME} COMMAND ${TEST_NAME})
    endif()
endmacro()
```

CMocka 1.1.0 的头文件、MinGW import library 和 DLL 放在仓库 `external/` 中。配置时只要这些固定路径存在，就注册测试；缺少任一库文件，构建仍可继续，但会显示 `Tests disabled`，最终得到一个没有测试的工程。

内置依赖让已验证的 Windows 环境不需要额外安装 CMocka，这是 v1.0 能复现的重要条件。它也把平台限制写进了构建：库文件是 Windows/MinGW 形式，CI 因此只运行 Windows job。项目设置了 C11，但“使用 C11”不等于当前构建已经跨平台。

CMake 还有一个方便但不够干净的决定：所有 runtime target 都输出到 `${PROJECT_SOURCE_DIR}/bin`。即使使用 `cmake -S . -B build` 做 out-of-source build，可执行文件和 DLL 仍会写回源码目录的 `bin/`。`.gitignore` 已屏蔽它，但更理想的做法是把产物完全留在 build tree，再通过 install/package 步骤生成发布目录。

## 测试全绿具体证明了哪些主路径

当前基础套件能验证：

- Page 和 FileManager 的整数、字符串、块追加与重开读取；
- Buffer pin/unpin、命中同一页、脏页 flush 和复用未固定帧；
- Transaction 初始化、页框计数、整数 commit 持久化；
- SETINT 日志驱动的显式 rollback；
- Schema、Layout、RID、RecordPage 与跨层 TableScan；
- Parser 的七类主要命令数据；
- Metadata 的建表、视图定义和索引目录读取；
- BasicQueryPlanner 的 Table → Select → Project 和查询结果；
- UpdatePlanner 的建表、插入、修改、删除、视图和索引元数据。

前面各篇也反复记录了它没有证明的内容：LRU 没有真正决定 Buffer 受害页；SETSTRING rollback 缺少同等级持久化验证；并发测试是单线程顺序调用；HashIndex 测试没有执行桶 insert/lookup/delete；启动恢复、循环 View、空表 Product 和 Parser 错误路径都没有系统覆盖。

测试的价值不是替项目宣布“正确”，而是把已经验证的边界固定下来。25/25 的含义应当是“这些 105 个 case 在该工具链下可重复通过”，不是“数据库的 25 项能力全部完成”。

## demo.sql 验证的是完整链路，不是单个函数

`demo/demo.sql` 有 30 行，设计成逐条复制到命令行。它依次执行：

```text
CREATE TABLE student → INSERT 三行 → 全表与条件 SELECT
CREATE TABLE score   → INSERT 两行 → 多表条件查询
UPDATE → SELECT 验证
DELETE → SELECT 验证
CREATE VIEW → 从视图 SELECT
CREATE INDEX → commit
```

与单元测试相比，demo 的价值是让一次真实输入穿过 Parser、Planner、Scan、Metadata、RecordPage、Transaction、Buffer 和 File。多表查询 `student, score WHERE id = sid` 也是 [执行链文章](../09-query-execution/) 追踪的真实语句。

系列总审计中，我实际运行过这份 demo：建表、插入、查询、多表过滤、更新、删除、简单视图和显式提交都能走通。但其中 `CREATE INDEX` 成功只代表 [idxcat 登记](../11-index-and-optimizer/)，不能把 demo 最后一行解释成索引查询已经验证。视图示例也没有 WHERE，避开了 QueryData 序列化缺陷。

demo 适合做 smoke test，却还不是自动回归测试。它没有预期输出文件，注释也要求人工逐条输入；运行目录中残留旧的 `Show2` 数据库还会影响再次执行 CREATE TABLE 的结果。更进一步的做法应当是每次创建临时数据库、批量输入脚本并比较确定输出。

## “能运行”为什么不等于“能复现”

v1.0 整理前，仓库曾经同时存在几类典型问题：

- CMake 已经引用 `CList`、`DBError` 和对应测试，但这些文件没有进入版本管理；
- `bin/` 中的 `.tbl` 数据库页和构建产物被跟踪，容易把本机运行状态带给别人；
- 文件名中残留空格，`TranstionTest` 拼写与 CMake、文档引用不一致；
- build 目录、IDE 配置、旧 zip、LaTeX 中间文件和临时测试输入没有统一忽略；
- Windows 行尾转换与批量格式化产生大量噪音，甚至破坏过中文注释结构；
- 一份本机已有的依赖或未跟踪源码，会让“原目录构建成功”掩盖“clone 后缺文件”。

这些问题大多不影响当前 shell 里已有的可执行文件，却会让陌生环境在 configure、compile、link 或运行阶段失败。数据库文件被误提交尤其危险：新用户可能打开的不是一个新库，而是我上一次测试留下的 catalog 和日志。

因此真正的复现检查必须从空目录开始：clone、configure、build、ctest，再运行最小 SQL。只在长期使用的工作目录里重新 build，不足以发现 Git 没有收录某个源文件。

## v1.0 封仓实际整理了什么

2026 年 9 月 27 日的 `1ed9980 release: prepare v1.0 archive` 涉及 140 个文件，提交统计为 `+2804 / -1491`。它不是一次数据库功能重写，主要做了四类整理：

1. 把 CMake 和文档已经引用、却遗漏在 Git 外的 12 个源码、测试、脚本和 demo 文件纳入版本管理；
2. 解除 `bin/Show/*.tbl` 等运行产物跟踪，补全 `.gitignore`；
3. 修正带空格文件名和 `TranstionTest` 拼写，删除已被 CList 取代的旧 List；
4. 恢复批量处理破坏的中文注释，并用 `.gitattributes` 固化源码与脚本行尾。

封仓报告记录了就地构建和全新 clone 构建都成功，25/25 CTest 通过，工作区无未跟踪文件。随后 `930c7bd` 整理 README、Release Notes、MIT License、贡献说明、Issue/PR 模板和 CI；`0014674` 加入最终发布报告。当前本地 `main`、`origin/main` 和 v1.0 所指向的最终提交保持一致。

这里最值得保留的不是“改了 140 个文件”的数字，而是发布原则：归档阶段不趁机重写核心业务逻辑。大量变化来自把真实依赖、文档和构建边界变得可见，已知的恢复、并发和索引缺口则明确写进 Release Notes。

## CI 整理：只保留当前能兑现的环境

早期 workflow 同时有无法通过的 Linux job，以及引用错误产物路径的自动 Release 步骤。v1.0 把它收缩为 Windows + MinGW：在 main push、pull request 和 `v*` tag 上 checkout，安装 MinGW/CMake，配置、构建并执行 CTest。

这不是放弃可移植性，而是让 CI 先反映项目真实支持面。当前源码和内置 CMocka 二进制主要验证在 Windows/MinGW，保留一个必然失败的 Linux 徽章不会让项目更跨平台。Linux 支持应当在替换平台依赖、调整第三方库和补充真实验证后再加入。

CI 仍有进一步空间：依赖安装没有缓存，未做 sanitizer、覆盖率和多编译器矩阵，也没有自动运行 demo。它现在承担的是最小承诺——一份新 checkout 可以完成 configure、build 和 25 个测试套件。

## README、Release Notes、教程和博客各自记录什么

准备公开归档时，我逐渐意识到文档不是越多越好，而是要避免互相冒充：

- README 负责让第一次打开仓库的人快速知道定位、构建命令和已知限制；
- Release Notes 记录 v1.0 新增、修复、验证环境和没有完成的能力；
- release report 保存一次可审计的清理范围、提交和复现结果；
- 13 章教程按模块解释接口，并绑定相应测试；
- 这个博客系列记录当时为什么这样做、错误怎样出现，以及现在重新看有哪些边界。

例如 README 只需要说 `CREATE INDEX` 目前登记元数据；[上一篇](../11-index-and-optimizer/) 才适合继续分析桶文件何时创建、BetterQueryPlanner 为什么没有接入。文档层次分开以后，项目档案既能快速使用，也不会丢掉失败过程。

`test/README.md` 也提醒我文档必须与构建系统交叉验证。它仍列出若干当前目录中不存在或未注册的测试文件，并提到 TPS benchmark；真正决定 CTest 内容的是顶层 CMake。未来应当从 CMake 生成测试清单，或让文档检查进入 CI，避免清单继续漂移。

## 如果重新写一次，我会优先改变什么

### 1. 先定义对象所有权

Buffer、Layout、Schema、CString、RID、Plan 和 Scan 之间有大量裸指针。很多 bug 和泄漏并非算法错误，而是不清楚谁创建、谁借用、谁释放。我会为每个公开接口标记 owned / borrowed，统一 destroy 规则，并用 sanitizer 或 Valgrind 类工具持续检查，而不是等到模块拼接时再猜。

### 2. 让错误成为返回值，而不是打印后继续

Parser 的 `exit(1)`、LockTable 设置 Error 后继续授锁、Buffer 获取失败后的空指针，都说明错误路径没有成为系统设计的一部分。我会统一 result/error 类型，让每一层只能显式处理或继续向上传递，CLI 最终决定回滚当前语句还是结束会话。

### 3. 先把 Buffer 替换策略真正接入

LRU 数据结构存在，但 BufferManager 仍线性选择第一个未固定页框。我会先写可观察的 replacement policy 接口和确定性访问序列测试，再添加 LRU，而不是让策略对象只停留在代码目录里。

### 4. 把恢复目标从显式 rollback 扩展到故障注入

当前 undo 日志能支撑部分显式回滚，启动路径却不自动恢复。我会先定义 WAL 的持久化点和 pageLSN，引入进程中断后的重启测试，再考虑 checkpoint、redo/undo 和 CLR。恢复功能必须由“在哪个写入点崩溃”来验证。

### 5. 让索引先保持正确，再谈优化

CREATE INDEX 应扫描旧数据回填，所有写路径必须在同一事务中维护索引，rollback 也要恢复索引项。完成这些端到端不变量后，再加入 IndexSelectPlan 和成本比较。只写 HashIndex API 不足以成为 SQL 能力。

### 6. 收紧 Parser 和 Metadata 边界

我会为 token 保存位置，让 Parser 返回错误而不是退出；验证字段和值数量、字符串长度、重复表名和不存在对象；为系统目录增加唯一性约束和版本信息。View 定义还需要可靠的 AST 序列化或直接保存原始 SQL，并加入往返测试。

### 7. 用真实并发测试定义隔离

锁表需要持有者集合、等待队列、互斥保护和可处理的 acquire 结果。测试应使用多个线程执行读写冲突、升级、超时、死锁与 rollback，而不是只在单线程中顺序申请两把锁。到那时才能讨论隔离级别和两阶段锁保证。

## 这个项目最后留下了什么

DBMS_C 没有成为工业数据库，也没有完成最初能想到的每一个模块。它真正完成的是一条可以从 SQL 追到页面字节的教学主链路，以及一批足以暴露系统编程问题的真实代码：对象身份、资源所有权、日志顺序、目录自举、游标组合、锁失败和构建复现。

从 2024 年第一次提交，到 2026 年把 25 个套件、105 个 case、demo、教程和发布文档整理进 v1.0，这个项目的变化也反映了我的关注点：一开始只想让功能出现，后来开始问它是否被主流程使用、错误是否可观察、测试是否真的覆盖、别人能否从空目录重现。

现在回头看，我不会用“从零实现了完整数据库”概括它。更准确的说法是：我用 C 做完了一个数据库内核原型，亲手走过了其中若干关键路径，也留下了足够明确的未完成边界。对一个计算机学生来说，这些能被代码、提交和测试验证的过程，比功能列表更值得保留。

[上一篇：写了哈希索引，却没有让查询用上它](../11-index-and-optimizer/) · [返回系列导读](../)
