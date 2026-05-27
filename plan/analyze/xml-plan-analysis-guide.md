# SQL Server Execution Plan XML — Bức Tranh Tổng Quát Phân Tích

> **Nguồn tham khảo:** PerformanceMonitor (`ShowPlanParser.cs`, `PlanAnalyzer.cs`, `PlanModels.cs`) + mssql.ee/tools/sql-plan-parser.html  
> **Áp dụng cho:** SQL Server 2016+ (ShowPlan XML schema), tối ưu cho 2019 Enterprise Always On  

---

## 1. Cấu Trúc Tổng Quát của Plan XML

```
ShowPlanXML
└── BatchSequence
    └── Batch (1..n)
        └── Statements
            ├── StmtSimple          ← SELECT / INSERT / UPDATE / DELETE
            ├── StmtCond            ← IF/ELSE block
            ├── StmtCursor          ← Cursor operations
            └── StmtUseDb           ← USE database
                └── QueryPlan
                    ├── MemoryGrantInfo
                    ├── OptimizerHardwareDependentProperties
                    ├── OptimizerStatsUsage
                    ├── ParameterList
                    ├── WaitStats            ← Actual plan only
                    ├── QueryTimeStats       ← Actual plan only
                    ├── ThreadStat           ← Parallel actual plan
                    ├── MissingIndexes
                    ├── Warnings
                    ├── TraceFlags
                    └── RelOp (root operator)
                        └── [PhysicalOperator]
                            └── RelOp (children...)
```

---

## 2. Metadata Cấp Statement — Đọc Đầu Tiên

### 2.1 Thông tin cơ bản
| Attribute | Ý nghĩa | Chú ý |
|---|---|---|
| `StatementText` | SQL text (truncate tại ~3990 chars) | Kiểm tra truncation → dùng QueryHash để lấy full text |
| `StatementType` | SELECT / INSERT / UPDATE / DELETE / MERGE | |
| `StatementSubTreeCost` | Tổng estimated cost | < 1: không thể parallel; >= 5: heavy query |
| `StatementOptmLevel` | TRIVIAL / FULL / ... | TRIVIAL = optimizer không cố gắng tối ưu nhiều |
| `StatementOptmEarlyAbortReason` | Lý do dừng optimize sớm | `MemoryLimitExceeded` = plan suboptimal, cần đơn giản hoá query |
| `CardinalityEstimationModelVersion` | CE version (70/120/130/150) | CE 70 (compat level 80) = cardinality estimates kém hơn |
| `QueryHash` | Fingerprint của query text | Dùng để lookup trong plan cache / Query Store |
| `QueryPlanHash` | Fingerprint của plan shape | Same query, different plan = plan instability |

### 2.2 Parallelism
| Attribute | Ý nghĩa | Chú ý |
|---|---|---|
| `DegreeOfParallelism` | DOP thực tế | 0 hoặc 1 = serial plan |
| `NonParallelPlanReason` | Lý do không parallel | Xem bảng phân loại ở mục 6 |
| `EffectiveDegreeOfParallelism` | DOP sau DOP Feedback | SQL Server 2022+ |

### 2.3 Compilation
| Attribute | Ý nghĩa | Ngưỡng cảnh báo |
|---|---|---|
| `CompileTime` | Thời gian compile (ms) | > 1000ms: query phức tạp |
| `CompileCPU` | CPU để compile (ms) | > 1000ms → Warning; > 5000ms → Critical |
| `CompileMemory` | Bộ nhớ compile (KB) | Liên quan đến `MemoryLimitExceeded` |
| `CachedPlanSize` | Kích thước plan trong cache (KB) | Plan rất lớn = nhiều operators |

---

## 3. Memory Grant — Bộ Nhớ Cấp Cho Query

> Có ở **estimated và actual plan**. Actual plan có thêm `MaxUsedMemory`.

```
MemoryGrantInfo:
  SerialRequiredMemory   ← KB cần thiết tối thiểu (serial)
  SerialDesiredMemory    ← KB mong muốn (serial)
  RequiredMemory         ← KB cần (parallel)
  DesiredMemory          ← KB mong muốn (parallel)
  RequestedMemory        ← KB đã yêu cầu với Memory Broker
  GrantedMemory          ← KB được cấp thực tế
  MaxUsedMemory          ← KB đã dùng tối đa (actual plan)
  GrantWaitTime          ← ms chờ được cấp memory
  IsMemoryGrantFeedbackAdjusted ← SQL Server tự điều chỉnh (2019+)
```

### Các pattern cần phát hiện:
| Pattern | Điều kiện | Ý nghĩa |
|---|---|---|
| **Spill risk** | `MaxUsed >= Granted * 0.9` | Gần tràn → likely spill to TempDB |
| **Wasted grant** | `MaxUsed < Granted * 0.5` | Overestimate → tốn RAM server, giảm concurrency |
| **Memory pressure** | `Granted < Requested` | Server đang thiếu workspace memory |
| **Grant wait** | `GrantWaitTime > 0` | Query phải chờ → server memory pressure |
| **Large grant** | `Granted >= 1GB` | > 4GB → Critical; 1-4GB → Warning |
| **10x waste** | `Granted / MaxUsed >= 10` AND `Granted >= 1GB` | Excessive waste |

---

## 4. Wait Statistics — Actual Plan Only

```xml
<WaitStats>
  <Wait WaitType="PAGEIOLATCH_SH" WaitTimeMs="1234" WaitCount="56"/>
  <Wait WaitType="LCK_M_S" WaitTimeMs="800" WaitCount="3"/>
</WaitStats>
```

### Phân loại wait types quan trọng:
| Wait Type | Danh mục | Ý nghĩa & Hành động |
|---|---|---|
| `LCK_M_*` | **Blocking** | Lock contention — kiểm tra blocking sessions |
| `PAGEIOLATCH_SH/EX` | **Disk I/O** | Disk latency — cold cache hoặc thiếu index |
| `CXPACKET`, `CXCONSUMER` | **Parallelism** | Thread coordination — thường bình thường với CXCONSUMER |
| `SOS_SCHEDULER_YIELD` | **CPU** | CPU pressure — query đang tranh CPU |
| `RESOURCE_SEMAPHORE` | **Memory** | Waiting for memory grant |
| `ASYNC_IO_COMPLETION` | **I/O** | Async I/O completion waits |
| `WRITELOG` | **Log I/O** | Transaction log latency |

**Rule:** Nếu `ElapsedTime >> CpuTime` → phần lớn thời gian là waiting, không phải CPU work.

---

## 5. Query Time Stats — Actual Plan Only

```
QueryTimeStats:
  CpuTime     ← Tổng CPU ms (tất cả threads)
  ElapsedTime ← Wall clock ms
  UdfCpuTime     ← CPU trong scalar UDFs
  UdfElapsedTime ← Elapsed trong scalar UDFs
```

### Parallelism efficiency:
```
speedup    = CpuTime / ElapsedTime
efficiency = (speedup - 1) / (DOP - 1) * 100%
```
- `efficiency < 40%` → Ineffective parallelism
- `speedup < 0.5` → Parallel wait bottleneck (threads waiting, không làm việc)

---

## 6. Serial Plan — NonParallelPlanReason

Khi cost >= 1.0 nhưng plan không parallel, cần biết tại sao:

### Actionable (cần xử lý):
| Reason | Ý nghĩa |
|---|---|
| `MaxDOPSetToOne` | MAXDOP=1 (server/db/RG/hint) |
| `QueryHintNoParallelSet` | OPTION(MAXDOP 1) trong query |
| `TSQLUserDefinedFunctionsNotParallelizable` | Scalar T-SQL UDF → rewrite thành iTVF |
| `CLRUserDefinedFunctionRequiresDataAccess` | CLR UDF với data access |
| `CouldNotGenerateValidParallelPlan` | Scalar UDF, table variable, system functions |
| `TableVariableTransactionsDoNotSupportParallelNestedTransaction` | Table variable → đổi thành #temp |
| `UpdatingWritebackVariable` | Writeback variable |
| `DMLQueryReturnsOutputToClient` | DML + OUTPUT → client |

### Passive (không cần xử lý):
| Reason | Ý nghĩa |
|---|---|
| `EstimatedDOPIsOne` | Cost < CTFP — bình thường |
| `NoParallelPlansInDesktopOrExpressEdition` | Edition limitation |

---

## 7. Parameters — Parameter Sniffing

```
ParameterList > ColumnReference:
  Column                 ← Tên parameter (@param)
  ParameterDataType      ← Kiểu dữ liệu
  ParameterCompiledValue ← Giá trị lúc compile (sniffed)
  ParameterRuntimeValue  ← Giá trị thực tế lúc chạy (actual plan)
```

### Các vấn đề:
| Vấn đề | Điều kiện | Ý nghĩa |
|---|---|---|
| **Parameter sniffing mismatch** | `CompiledValue != RuntimeValue` | Plan được compile với giá trị khác → wrong plan |
| **Local variables** | `CompiledValue` rỗng | Optimizer dùng density estimate, không sniff được |
| **OPTIMIZE FOR UNKNOWN** | Có trong query text | Dùng average density → có thể suboptimal với skewed data |

---

## 8. Missing Indexes

```xml
<MissingIndexGroup Impact="78.5432">
  <MissingIndex Database="[db]" Schema="[dbo]" Table="[Orders]">
    <ColumnGroup Usage="EQUALITY">
      <Column Name="CustomerId"/>
    </ColumnGroup>
    <ColumnGroup Usage="INEQUALITY">
      <Column Name="OrderDate"/>
    </ColumnGroup>
    <ColumnGroup Usage="INCLUDE">
      <Column Name="Status"/>
      <Column Name="TotalAmount"/>
    </ColumnGroup>
  </MissingIndex>
</MissingIndexGroup>
```

### Đánh giá chất lượng gợi ý:
| Tiêu chí | Ngưỡng | Cảnh báo |
|---|---|---|
| Impact thấp | < 25% | Overhead maintenance > lợi ích |
| Wide INCLUDE | > 5 columns | "Kitchen sink" index — quá rộng |
| Wide key | > 4 key columns | Index size lớn, maintenance đắt |
| Duplicate suggestions | > 1 suggestion cùng bảng | Nên consolidate |

**DDL tự động:**
```sql
CREATE NONCLUSTERED INDEX [TableName_Col1_Col2_Col3]
ON [dbo].[TableName] ([Col1], [Col2])
INCLUDE ([Col3], [Col4]);
```

---

## 9. Statistics Usage

```xml
<OptimizerStatsUsage>
  <StatisticsInfo Database="[db]" Schema="[dbo]" Table="[Orders]"
    Statistics="[IX_Orders_Date]"
    ModificationCount="15234"
    SamplingPercent="30.5"
    LastUpdate="2024-01-15T08:30:00"/>
</OptimizerStatsUsage>
```

### Chú ý:
- **ModificationCount cao** + **LastUpdate cũ** → statistics stale → row estimates sai
- **SamplingPercent thấp** (< 20%) trên bảng lớn → estimates kém chính xác
- **LastUpdate = null** → statistics chưa từng được update

---

## 10. Operators — RelOp Node

### 10.1 Thông tin cơ bản mỗi node:
```
RelOp:
  NodeId                      ← ID duy nhất trong plan
  PhysicalOp                  ← Index Seek, Hash Match, Sort, ...
  LogicalOp                   ← Inner Join, Eager Spool, Top N Sort, ...
  EstimatedTotalSubtreeCost   ← Cost tích luỹ (bao gồm children)
  EstimateRows                ← Số rows optimizer dự đoán
  EstimateIO / EstimateCPU    ← Breakdown của cost
  EstimateRebinds/Rewinds     ← Cho correlated subquery
  AvgRowSize                  ← Kích thước trung bình 1 row (bytes)
  TableCardinality            ← Tổng rows trong bảng/index
  EstimateRowsWithoutRowGoal  ← Estimate trước khi áp dụng Row Goal
  Parallel                    ← true nếu operator chạy parallel
```

### 10.2 Actual plan runtime stats (RunTimeCountersPerThread):
```
Tổng hợp qua tất cả threads:
  ActualRows          ← Rows output thực tế
  ActualExecutions    ← Số lần operator được gọi
  ActualRowsRead      ← Rows đọc từ storage (scan)
  ActualRebinds       ← Cache misses (correlated)
  ActualRewinds       ← Cache hits (correlated)
  ActualElapsedMs     ← Wall time (max across threads)
  ActualCPUms         ← CPU time (sum across threads)
  ActualLogicalReads  ← Buffer pool page reads
  ActualPhysicalReads ← Disk reads (0 sau warmup = tốt)
  ActualReadAheads    ← Pre-fetched pages
  ActualScans         ← Số lần scan
  ActualSegmentReads/Skips ← Columnstore segment elimination
  UdfCpuTime/ElapsedTime   ← Thời gian trong scalar UDFs
```

---

## 11. Operator Categories & Warning Rules

### 11.1 Data Access Operators

#### Index Seek ✅ (Tốt)
- Dùng index với seek predicate
- Chi phí thấp, chỉ đọc rows cần thiết
- **Xem:** SeekPredicates (range conditions)

#### Index Scan / Table Scan ⚠️ (Cần kiểm tra)
- Đọc toàn bộ index/heap
- **Khi nào OK:** Bảng nhỏ, không có WHERE selective, hoặc fetch > ~20% rows
- **Khi nào vấn đề:** Có Predicate residual + bảng lớn → thiếu index

**Warnings cần phát hiện trên Scan:**
| Pattern | XML Signal | Cảnh báo |
|---|---|---|
| Residual predicate | `Predicate` element | Scan với filter sau — check index |
| Non-SARGable | `CONVERT_IMPLICIT` trong predicate | Kiểu dữ liệu không khớp → không dùng được index |
| Non-SARGable | `ISNULL`/`COALESCE` bọc column | Rewrite predicate |
| Non-SARGable | Leading wildcard LIKE `'%text'` | Full-text index nếu cần substring search |
| Non-SARGable | `CASE` expression trong predicate | Tách thành multiple WHERE clauses |
| Non-SARGable | Function call trên column | Move function sang parameter side |
| CE guess | EstimateRows ≈ 30%/10%/9% của TableCardinality | Optimizer guessing, không có statistics |
| Cardinality misestimate | EstimateRows >> ActualRows AND selectivity < 10% | Wrong plan choice (scan thay vì seek) |

#### Key Lookup ⚠️→🔴 (Cần giải quyết)
- SQL Server tìm row qua nonclustered index, rồi quay lại clustered index để lấy thêm columns
- **Giải pháp:** Thêm output columns vào INCLUDE list của nonclustered index
- **Khi Critical:** Cost > 20% tổng plan

#### RID Lookup ⚠️ (Cần giải quyết)
- Bảng là Heap (không có clustered index), lookup theo Row ID
- **Giải pháp:** Thêm clustered index vào bảng

### 11.2 Join Operators

#### Nested Loops
- **Tốt khi:** Outer side nhỏ (< vài nghìn rows), inner side có index seek
- **Vấn đề:** Inner side executed > 100,000 lần → nghiêm trọng
- **Root cause thường gặp:** Row estimate sai ở outer side → optimizer chọn NL sai
- **Xem:** ActualExecutions của inner child

#### Hash Match
- **Tốt khi:** Cả 2 sides lớn, không có index phù hợp
- **Vấn đề:** Memory grant lớn, có thể spill
- **Xem:** HashKeysBuild, HashKeysProbe, spill warnings

#### Merge Join
- **Tốt khi:** Cả 2 sides sorted trên join column
- **Vấn đề ManyToMany:** `ManyToMany="1"` → dùng TempDB worktable khi có duplicate values

#### Join OR Clause ⚠️
- Pattern: OR trong join predicate → SQL Server expand thành Concatenation của Constant Scans
- **Giải pháp:** Rewrite thành `UNION ALL`

### 11.3 Sort & Aggregate

#### Sort ⚠️
- Explicit sort = ORDER BY, GROUP BY, hoặc Merge Join cần sorted input
- **Vấn đề:** Sort > 20% cost, đặc biệt nếu spill
- **Giải pháp:** Index khớp với sort order

#### Top Above Scan ⚠️
- `TOP` + `ORDER BY` đang scan toàn bộ bảng rồi sort
- **Giải pháp:** Index trên ORDER BY columns

#### Hash Aggregate vs Stream Aggregate
- Hash Aggregate: cần memory, có thể spill
- Stream Aggregate: cần input sorted, không cần memory

### 11.4 Spool Operators

#### Eager Index Spool 🔴 (Critical)
- SQL Server tự build temporary index trong TempDB **mỗi lần execute**
- **Giải pháp:** Tạo permanent index theo gợi ý trong `SuggestedIndex`

#### Lazy Table Spool (Cache miss ratio)
- Caches results cho correlated subquery reuse
- **Vấn đề:** Rebinds >> Rewinds * 5 → cache không hiệu quả, tốn overhead

#### Row Count Spool 🔴
- Pattern `NOT IN` với nullable column
- **Giải pháp:** Dùng `NOT EXISTS` hoặc thêm `WHERE column IS NOT NULL`

### 11.5 Parallelism (Exchange)
- `Gather Streams`: merge output từ nhiều threads
- `Repartition Streams`: redistribute rows giữa threads
- `Broadcast`: copy rows đến tất cả threads

**Parallel Skew:** Một thread xử lý > 50% (DOP>2) hoặc > 80% (DOP=2) tổng rows → parallelism không hiệu quả

### 11.6 Filter Operator ⚠️
- Filter sau khi đã đọc data → rows bị discard muộn
- **Ideal:** Filter nên xảy ra tại storage layer (seek predicate hoặc residual trên scan)
- **Xem:** Số rows input vs output, logical reads bên dưới

---

## 12. Scalar UDF — Worst Case

**Scalar T-SQL UDF là một trong những performance anti-patterns nguy hiểm nhất:**

1. Chạy **1 lần/row** (row-by-row execution, không set-based)
2. **Ngăn parallelism** — toàn bộ query forced serial
3. Optimizer không thể "nhìn thấy" bên trong UDF → estimate 1 row

**Phát hiện:**
- `UserDefinedFunction` element trong plan operators
- `NonParallelPlanReason = "TSQLUserDefinedFunctionsNotParallelizable"`
- `UdfCpuTime > 0` trong RunTimeCounters

**Giải pháp theo thứ tự ưu tiên:**
1. Rewrite thành inline TVF (RETURNS TABLE AS RETURN SELECT...)
2. SQL Server 2019+: Scalar UDF Inlining tự động (kiểm tra `ContainsInlineScalarTsqlUdfs`)
3. Dump kết quả vào #temp table rồi JOIN

---

## 13. Row Estimate Mismatch — Nguyên Nhân Mọi Vấn Đề

Hầu hết performance problem đều bắt đầu từ **row estimate sai**:

```
ratio = ActualRows / (ActualExecutions || 1) / EstimateRows

ratio >= 10x  → Underestimate (nhiều rows hơn dự đoán) → plan không đủ memory/index
ratio <= 0.1x → Overestimate (ít rows hơn dự đoán) → wrong join type, wrong access method
```

### Khi nào estimate sai gây hại (cần warn):
- Node là Sort/Hash Match (memory allocation sai → spill)
- Node là inner side của Nested Loops (execution count sai)
- Node là root data access với cost > 50% của plan
- Scan với estimate >> actual + selectivity < 10% → optimizer chọn scan thay vì seek

### Nguyên nhân phổ biến:
| Nguyên nhân | Signal |
|---|---|
| Stale statistics | ModificationCount cao, LastUpdate cũ |
| Local variables | CompiledValue rỗng trong ParameterList |
| Implicit conversion | CONVERT_IMPLICIT trong predicate |
| Multi-predicate correlation | Optimizer assume independence |
| Skewed data distribution | Một giá trị chiếm % lớn |
| CTE / subquery | SQL Server không materialize → re-estimate từng lần |
| Table variable | Luôn estimate 1 row (pre-2017) hoặc 100 rows (2017+) |

---

## 14. Table Variable vs #Temp Table

| | Table Variable (@t) | Temp Table (#t) |
|---|---|---|
| Statistics | ❌ Không có column-level stats | ✅ Có, auto-update |
| Row estimate | ❌ Luôn 1 (pre-2017) / 100 (2017+) | ✅ Dựa trên data thực |
| Parallelism | ❌ DML bắt buộc serial | ✅ Có thể parallel |
| Spill to log | ❌ Không (ít I/O cho small tables) | ✅ Có (I/O overhead) |
| Scope | Function/procedure | Procedure + child calls |

**Rule:** Dùng #temp table khi table variable được JOIN hoặc có nhiều rows.

---

## 15. CTE — Common Table Expression

**CTE KHÔNG được materialize** — SQL Server re-execute mỗi lần reference:

```sql
WITH cte AS (SELECT ... FROM BigTable WHERE ...)
SELECT a.*, b.*
FROM cte a       -- Execute 1 lần
JOIN cte b ON ... -- Execute thêm 1 lần nữa!
```

**Giải pháp:** Dump CTE vào #temp table khi được reference > 1 lần.

---

## 16. Spill to TempDB — Critical Performance Issue

Xảy ra khi operator (Sort, Hash Match, Exchange) được cấp ít memory hơn cần thiết:

```xml
<SpillToTempDb SpillLevel="1" SpilledGroups="234"/>
```

| Loại Spill | Operator | Nguyên nhân |
|---|---|---|
| Sort Spill | Sort | Row estimate thấp → memory grant nhỏ |
| Hash Spill | Hash Match / Hash Aggregate | Probe side lớn hơn build side dự đoán |
| Exchange Spill | Parallelism | Thread producer nhanh hơn consumer |

**Severity dựa trên % elapsed time:**
- Spill chiếm > 50% elapsed → Critical
- Spill chiếm 10-50% elapsed → Warning

---

## 17. Row Goal — Optimizer Short-Circuit

```
EstimateRowsWithoutRowGoal > EstimateRows
```

Row Goal xảy ra khi có `TOP`, `EXISTS`, `IN`, `FAST N` — optimizer giả định query sẽ dừng sớm:

- **Nếu query thực sự dừng sớm** → Row Goal hoạt động đúng
- **Nếu query đọc hết data** → Plan bị suboptimal (chọn Nested Loops thay vì Hash Join)

---

## 18. Per-Thread Analysis (Actual Parallel Plans)

```
RunTimeCountersPerThread (Thread=0 là coordinator):
  Thread  ActualRows  ActualElapsedMs  ActualLogicalReads
  0       0           123              0
  1       450000      890              12345
  2       450050      892              12367
  3       12           891              123      ← Skewed!
```

**Parallel Skew:** Thread 3 chỉ xử lý 12 rows trong khi các thread khác xử lý 450K → parallelism không giúp nhiều.

**Nguyên nhân:** Uneven data distribution trên partition key hoặc hash bucket.

---

## 19. Parameter Sensitive Plan (PSP) — SQL Server 2022

```xml
<Dispatcher>
  <ParameterSensitivePredicate LowBoundary="0" HighBoundary="1000">
    <Predicate>...</Predicate>
  </ParameterSensitivePredicate>
</Dispatcher>
```

SQL Server 2022 tự động tạo nhiều plan cho cùng 1 query với range khác nhau → giảm parameter sniffing issues.

---

## 20. Checklist Phân Tích Plan — Thứ Tự Ưu Tiên

### Bước 1: Statement Overview
- [ ] Total cost > 5? DOP bao nhiêu?
- [ ] Có `NonParallelPlanReason`? → Xem mục 6
- [ ] `CompileCPUMs` > 1000ms? → Query quá phức tạp
- [ ] `StatementOptmEarlyAbortReason = MemoryLimitExceeded`? → Critical

### Bước 2: Missing Indexes
- [ ] Impact > 50%? → Tạo ngay
- [ ] Nhiều suggestions cùng bảng? → Consolidate
- [ ] Include columns > 5? → Evaluate

### Bước 3: Warnings từ Plan XML
- [ ] Implicit conversion (đặc biệt Seek Blocked)?
- [ ] Spill to TempDB?
- [ ] No Join Predicate (cross join)?
- [ ] Memory grant warning?

### Bước 4: Top Operators
- [ ] Operator nào chiếm > 30% cost / elapsed?
- [ ] Scan thay vì Seek? → Residual predicate? Non-SARGable?
- [ ] Key Lookup > 20%? → INCLUDE columns
- [ ] Eager Index Spool? → Create permanent index
- [ ] Sort > 20%? → Index on ORDER BY columns

### Bước 5: Row Estimates (Actual plan)
- [ ] Actual vs Estimated ratio > 10x hoặc < 0.1x?
- [ ] Nested Loops inner executed > 100K lần?
- [ ] Sort/Hash spill occurred?

### Bước 6: Memory (Actual plan)
- [ ] MaxUsed >= 90% Granted → Spill risk
- [ ] MaxUsed < 50% Granted → Overestimate, tốn RAM
- [ ] GrantWaitTime > 0 → Server memory pressure
- [ ] Granted >= 1GB → Large grant, cần investigate Sort/Hash

### Bước 7: Parallelism (Actual plan)
- [ ] Efficiency < 40%? → Parallel skew hoặc wait bottleneck
- [ ] Elapsed >> CPU? → Threads waiting (xem WaitStats)
- [ ] Thread skew > 50%? → Data distribution issue

### Bước 8: Code Anti-Patterns
- [ ] Scalar UDF? → Rewrite as iTVF
- [ ] Table variable trong large query? → #temp table
- [ ] CTE referenced > 1 lần? → #temp table
- [ ] NOT IN với nullable column? → NOT EXISTS
- [ ] Local variables (no compiled value)? → Parameters

---

## 21. XML Attributes Map — Quick Reference

### Statement-level (StmtSimple / QueryPlan):
```
StatementSubTreeCost, StatementType, StatementText
CardinalityEstimationModelVersion, QueryHash, QueryPlanHash
DegreeOfParallelism, NonParallelPlanReason
CompileTime, CompileCPU, CompileMemory, CachedPlanSize
StatementOptmLevel, StatementOptmEarlyAbortReason
```

### MemoryGrantInfo:
```
SerialRequiredMemory, SerialDesiredMemory
RequiredMemory, DesiredMemory, RequestedMemory
GrantedMemory, MaxUsedMemory, GrantWaitTime
IsMemoryGrantFeedbackAdjusted
```

### RelOp (mỗi operator):
```
NodeId, PhysicalOp, LogicalOp
EstimatedTotalSubtreeCost, EstimateRows
EstimateIO, EstimateCPU, AvgRowSize
EstimateRebinds, EstimateRewinds
TableCardinality, EstimatedRowsRead
EstimateRowsWithoutRowGoal
Parallel, EstimatedExecutionMode
IsAdaptive, AdaptiveThresholdRows
```

### RunTimeCountersPerThread (actual):
```
Thread, ActualRows, ActualExecutions, ActualRowsRead
ActualRebinds, ActualRewinds
ActualElapsedms, ActualCPUms
ActualLogicalReads, ActualPhysicalReads
ActualReadAheads, ActualScans
ActualSegmentReads, ActualSegmentSkips (columnstore)
UdfCpuTime, UdfElapsedTime
InputMemoryGrant, OutputMemoryGrant, UsedMemoryGrant
```

---

## 22. Severity Framework

| Severity | Màu | Khi nào |
|---|---|---|
| **Critical** | 🔴 | Impact trực tiếp, cần fix ngay: Eager Index Spool, Key Lookup chiếm > 20%, Spill > 50% elapsed, Scalar UDF > 1s, NL inner > 1M executions, Table variable DML |
| **Warning** | 🟡 | Có vấn đề nhưng chưa critical: Row estimate > 10x, Sort > 20%, Scan với predicate, Missing index > 25% impact, CTE multi-ref, Local variables |
| **Info** | 🔵 | Awareness: Row Goal, Low-impact index suggestion, CE model version, Optimization level TRIVIAL |

---

*Tài liệu này được tổng hợp từ analysis của `ShowPlanParser.cs` (1840 dòng), `PlanAnalyzer.cs` (1943 dòng), `PlanModels.cs` và JavaScript source của mssql.ee — bao gồm 33+ warning rules và toàn bộ ShowPlan XML schema.*
