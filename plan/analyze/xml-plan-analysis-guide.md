# SQL Server Execution Plan XML â€” Bá»©c Tranh Tá»•ng QuÃ¡t PhÃ¢n TÃ­ch

> **Nguá»“n tham kháº£o:** PerformanceMonitor (`ShowPlanParser.cs`, `PlanAnalyzer.cs`, `PlanModels.cs`) + mssql.ee/tools/sql-plan-parser.html  
> **Ãp dá»¥ng cho:** SQL Server 2016+ (ShowPlan XML schema), tá»‘i Æ°u cho 2019 Enterprise Always On  

---

## 1. Cáº¥u TrÃºc Tá»•ng QuÃ¡t cá»§a Plan XML

```
ShowPlanXML
â””â”€â”€ BatchSequence
    â””â”€â”€ Batch (1..n)
        â””â”€â”€ Statements
            â”œâ”€â”€ StmtSimple          â† SELECT / INSERT / UPDATE / DELETE
            â”œâ”€â”€ StmtCond            â† IF/ELSE block
            â”œâ”€â”€ StmtCursor          â† Cursor operations
            â””â”€â”€ StmtUseDb           â† USE database
                â””â”€â”€ QueryPlan
                    â”œâ”€â”€ MemoryGrantInfo
                    â”œâ”€â”€ OptimizerHardwareDependentProperties
                    â”œâ”€â”€ OptimizerStatsUsage
                    â”œâ”€â”€ ParameterList
                    â”œâ”€â”€ WaitStats            â† Actual plan only
                    â”œâ”€â”€ QueryTimeStats       â† Actual plan only
                    â”œâ”€â”€ ThreadStat           â† Parallel actual plan
                    â”œâ”€â”€ MissingIndexes
                    â”œâ”€â”€ Warnings
                    â”œâ”€â”€ TraceFlags
                    â””â”€â”€ RelOp (root operator)
                        â””â”€â”€ [PhysicalOperator]
                            â””â”€â”€ RelOp (children...)
```

---

## 2. Metadata Cáº¥p Statement â€” Äá»c Äáº§u TiÃªn

### 2.1 ThÃ´ng tin cÆ¡ báº£n
| Attribute | Ã nghÄ©a | ChÃº Ã½ |
|---|---|---|
| `StatementText` | SQL text (truncate táº¡i ~3990 chars) | Kiá»ƒm tra truncation â†’ dÃ¹ng QueryHash Ä‘á»ƒ láº¥y full text |
| `StatementType` | SELECT / INSERT / UPDATE / DELETE / MERGE | |
| `StatementSubTreeCost` | Tá»•ng estimated cost | < 1: khÃ´ng thá»ƒ parallel; >= 5: heavy query |
| `StatementOptmLevel` | TRIVIAL / FULL / ... | TRIVIAL = optimizer khÃ´ng cá»‘ gáº¯ng tá»‘i Æ°u nhiá»u |
| `StatementOptmEarlyAbortReason` | LÃ½ do dá»«ng optimize sá»›m | `MemoryLimitExceeded` = plan suboptimal, cáº§n Ä‘Æ¡n giáº£n hoÃ¡ query |
| `CardinalityEstimationModelVersion` | CE version (70/120/130/150) | CE 70 (compat level 80) = cardinality estimates kÃ©m hÆ¡n |
| `QueryHash` | Fingerprint cá»§a query text | DÃ¹ng Ä‘á»ƒ lookup trong plan cache / Query Store |
| `QueryPlanHash` | Fingerprint cá»§a plan shape | Same query, different plan = plan instability |

### 2.2 Parallelism
| Attribute | Ã nghÄ©a | ChÃº Ã½ |
|---|---|---|
| `DegreeOfParallelism` | DOP thá»±c táº¿ | 0 hoáº·c 1 = serial plan |
| `NonParallelPlanReason` | LÃ½ do khÃ´ng parallel | Xem báº£ng phÃ¢n loáº¡i á»Ÿ má»¥c 6 |
| `EffectiveDegreeOfParallelism` | DOP sau DOP Feedback | SQL Server 2022+ |

### 2.3 Compilation
| Attribute | Ã nghÄ©a | NgÆ°á»¡ng cáº£nh bÃ¡o |
|---|---|---|
| `CompileTime` | Thá»i gian compile (ms) | > 1000ms: query phá»©c táº¡p |
| `CompileCPU` | CPU Ä‘á»ƒ compile (ms) | > 1000ms â†’ Warning; > 5000ms â†’ Critical |
| `CompileMemory` | Bá»™ nhá»› compile (KB) | LiÃªn quan Ä‘áº¿n `MemoryLimitExceeded` |
| `CachedPlanSize` | KÃ­ch thÆ°á»›c plan trong cache (KB) | Plan ráº¥t lá»›n = nhiá»u operators |

---

## 3. Memory Grant â€” Bá»™ Nhá»› Cáº¥p Cho Query

> CÃ³ á»Ÿ **estimated vÃ  actual plan**. Actual plan cÃ³ thÃªm `MaxUsedMemory`.

```
MemoryGrantInfo:
  SerialRequiredMemory   â† KB cáº§n thiáº¿t tá»‘i thiá»ƒu (serial)
  SerialDesiredMemory    â† KB mong muá»‘n (serial)
  RequiredMemory         â† KB cáº§n (parallel)
  DesiredMemory          â† KB mong muá»‘n (parallel)
  RequestedMemory        â† KB Ä‘Ã£ yÃªu cáº§u vá»›i Memory Broker
  GrantedMemory          â† KB Ä‘Æ°á»£c cáº¥p thá»±c táº¿
  MaxUsedMemory          â† KB Ä‘Ã£ dÃ¹ng tá»‘i Ä‘a (actual plan)
  GrantWaitTime          â† ms chá» Ä‘Æ°á»£c cáº¥p memory
  IsMemoryGrantFeedbackAdjusted â† SQL Server tá»± Ä‘iá»u chá»‰nh (2019+)
```

### CÃ¡c pattern cáº§n phÃ¡t hiá»‡n:
| Pattern | Äiá»u kiá»‡n | Ã nghÄ©a |
|---|---|---|
| **Spill risk** | `MaxUsed >= Granted * 0.9` | Gáº§n trÃ n â†’ likely spill to TempDB |
| **Wasted grant** | `MaxUsed < Granted * 0.5` | Overestimate â†’ tá»‘n RAM server, giáº£m concurrency |
| **Memory pressure** | `Granted < Requested` | Server Ä‘ang thiáº¿u workspace memory |
| **Grant wait** | `GrantWaitTime > 0` | Query pháº£i chá» â†’ server memory pressure |
| **Large grant** | `Granted >= 1GB` | > 4GB â†’ Critical; 1-4GB â†’ Warning |
| **10x waste** | `Granted / MaxUsed >= 10` AND `Granted >= 1GB` | Excessive waste |

---

## 4. Wait Statistics â€” Actual Plan Only

```xml
<WaitStats>
  <Wait WaitType="PAGEIOLATCH_SH" WaitTimeMs="1234" WaitCount="56"/>
  <Wait WaitType="LCK_M_S" WaitTimeMs="800" WaitCount="3"/>
</WaitStats>
```

### PhÃ¢n loáº¡i wait types quan trá»ng:
| Wait Type | Danh má»¥c | Ã nghÄ©a & HÃ nh Ä‘á»™ng |
|---|---|---|
| `LCK_M_*` | **Blocking** | Lock contention â€” kiá»ƒm tra blocking sessions |
| `PAGEIOLATCH_SH/EX` | **Disk I/O** | Disk latency â€” cold cache hoáº·c thiáº¿u index |
| `CXPACKET`, `CXCONSUMER` | **Parallelism** | Thread coordination â€” thÆ°á»ng bÃ¬nh thÆ°á»ng vá»›i CXCONSUMER |
| `SOS_SCHEDULER_YIELD` | **CPU** | CPU pressure â€” query Ä‘ang tranh CPU |
| `RESOURCE_SEMAPHORE` | **Memory** | Waiting for memory grant |
| `ASYNC_IO_COMPLETION` | **I/O** | Async I/O completion waits |
| `WRITELOG` | **Log I/O** | Transaction log latency |

**Rule:** Náº¿u `ElapsedTime >> CpuTime` â†’ pháº§n lá»›n thá»i gian lÃ  waiting, khÃ´ng pháº£i CPU work.

---

## 5. Query Time Stats â€” Actual Plan Only

```
QueryTimeStats:
  CpuTime     â† Tá»•ng CPU ms (táº¥t cáº£ threads)
  ElapsedTime â† Wall clock ms
  UdfCpuTime     â† CPU trong scalar UDFs
  UdfElapsedTime â† Elapsed trong scalar UDFs
```

### Parallelism efficiency:
```
speedup    = CpuTime / ElapsedTime
efficiency = (speedup - 1) / (DOP - 1) * 100%
```
- `efficiency < 40%` â†’ Ineffective parallelism
- `speedup < 0.5` â†’ Parallel wait bottleneck (threads waiting, khÃ´ng lÃ m viá»‡c)

---

## 6. Serial Plan â€” NonParallelPlanReason

Khi cost >= 1.0 nhÆ°ng plan khÃ´ng parallel, cáº§n biáº¿t táº¡i sao:

### Actionable (cáº§n xá»­ lÃ½):
| Reason | Ã nghÄ©a |
|---|---|
| `MaxDOPSetToOne` | MAXDOP=1 (server/db/RG/hint) |
| `QueryHintNoParallelSet` | OPTION(MAXDOP 1) trong query |
| `TSQLUserDefinedFunctionsNotParallelizable` | Scalar T-SQL UDF â†’ rewrite thÃ nh iTVF |
| `CLRUserDefinedFunctionRequiresDataAccess` | CLR UDF vá»›i data access |
| `CouldNotGenerateValidParallelPlan` | Scalar UDF, table variable, system functions |
| `TableVariableTransactionsDoNotSupportParallelNestedTransaction` | Table variable â†’ Ä‘á»•i thÃ nh #temp |
| `UpdatingWritebackVariable` | Writeback variable |
| `DMLQueryReturnsOutputToClient` | DML + OUTPUT â†’ client |

### Passive (khÃ´ng cáº§n xá»­ lÃ½):
| Reason | Ã nghÄ©a |
|---|---|
| `EstimatedDOPIsOne` | Cost < CTFP â€” bÃ¬nh thÆ°á»ng |
| `NoParallelPlansInDesktopOrExpressEdition` | Edition limitation |

---

## 7. Parameters â€” Parameter Sniffing

```
ParameterList > ColumnReference:
  Column                 â† TÃªn parameter (@param)
  ParameterDataType      â† Kiá»ƒu dá»¯ liá»‡u
  ParameterCompiledValue â† GiÃ¡ trá»‹ lÃºc compile (sniffed)
  ParameterRuntimeValue  â† GiÃ¡ trá»‹ thá»±c táº¿ lÃºc cháº¡y (actual plan)
```

### CÃ¡c váº¥n Ä‘á»:
| Váº¥n Ä‘á» | Äiá»u kiá»‡n | Ã nghÄ©a |
|---|---|---|
| **Parameter sniffing mismatch** | `CompiledValue != RuntimeValue` | Plan Ä‘Æ°á»£c compile vá»›i giÃ¡ trá»‹ khÃ¡c â†’ wrong plan |
| **Local variables** | `CompiledValue` rá»—ng | Optimizer dÃ¹ng density estimate, khÃ´ng sniff Ä‘Æ°á»£c |
| **OPTIMIZE FOR UNKNOWN** | CÃ³ trong query text | DÃ¹ng average density â†’ cÃ³ thá»ƒ suboptimal vá»›i skewed data |

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

### ÄÃ¡nh giÃ¡ cháº¥t lÆ°á»£ng gá»£i Ã½:
| TiÃªu chÃ­ | NgÆ°á»¡ng | Cáº£nh bÃ¡o |
|---|---|---|
| Impact tháº¥p | < 25% | Overhead maintenance > lá»£i Ã­ch |
| Wide INCLUDE | > 5 columns | "Kitchen sink" index â€” quÃ¡ rá»™ng |
| Wide key | > 4 key columns | Index size lá»›n, maintenance Ä‘áº¯t |
| Duplicate suggestions | > 1 suggestion cÃ¹ng báº£ng | NÃªn consolidate |

**DDL tá»± Ä‘á»™ng:**
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

### ChÃº Ã½:
- **ModificationCount cao** + **LastUpdate cÅ©** â†’ statistics stale â†’ row estimates sai
- **SamplingPercent tháº¥p** (< 20%) trÃªn báº£ng lá»›n â†’ estimates kÃ©m chÃ­nh xÃ¡c
- **LastUpdate = null** â†’ statistics chÆ°a tá»«ng Ä‘Æ°á»£c update

---

## 10. Operators â€” RelOp Node

### 10.1 ThÃ´ng tin cÆ¡ báº£n má»—i node:
```
RelOp:
  NodeId                      â† ID duy nháº¥t trong plan
  PhysicalOp                  â† Index Seek, Hash Match, Sort, ...
  LogicalOp                   â† Inner Join, Eager Spool, Top N Sort, ...
  EstimatedTotalSubtreeCost   â† Cost tÃ­ch luá»¹ (bao gá»“m children)
  EstimateRows                â† Sá»‘ rows optimizer dá»± Ä‘oÃ¡n
  EstimateIO / EstimateCPU    â† Breakdown cá»§a cost
  EstimateRebinds/Rewinds     â† Cho correlated subquery
  AvgRowSize                  â† KÃ­ch thÆ°á»›c trung bÃ¬nh 1 row (bytes)
  TableCardinality            â† Tá»•ng rows trong báº£ng/index
  EstimateRowsWithoutRowGoal  â† Estimate trÆ°á»›c khi Ã¡p dá»¥ng Row Goal
  Parallel                    â† true náº¿u operator cháº¡y parallel
```

### 10.2 Actual plan runtime stats (RunTimeCountersPerThread):
```
Tá»•ng há»£p qua táº¥t cáº£ threads:
  ActualRows          â† Rows output thá»±c táº¿
  ActualExecutions    â† Sá»‘ láº§n operator Ä‘Æ°á»£c gá»i
  ActualRowsRead      â† Rows Ä‘á»c tá»« storage (scan)
  ActualRebinds       â† Cache misses (correlated)
  ActualRewinds       â† Cache hits (correlated)
  ActualElapsedMs     â† Wall time (max across threads)
  ActualCPUms         â† CPU time (sum across threads)
  ActualLogicalReads  â† Buffer pool page reads
  ActualPhysicalReads â† Disk reads (0 sau warmup = tá»‘t)
  ActualReadAheads    â† Pre-fetched pages
  ActualScans         â† Sá»‘ láº§n scan
  ActualSegmentReads/Skips â† Columnstore segment elimination
  UdfCpuTime/ElapsedTime   â† Thá»i gian trong scalar UDFs
```

---

## 11. Operator Categories & Warning Rules

### 11.1 Data Access Operators

#### Index Seek âœ… (Tá»‘t)
- DÃ¹ng index vá»›i seek predicate
- Chi phÃ­ tháº¥p, chá»‰ Ä‘á»c rows cáº§n thiáº¿t
- **Xem:** SeekPredicates (range conditions)

#### Index Scan / Table Scan âš ï¸ (Cáº§n kiá»ƒm tra)
- Äá»c toÃ n bá»™ index/heap
- **Khi nÃ o OK:** Báº£ng nhá», khÃ´ng cÃ³ WHERE selective, hoáº·c fetch > ~20% rows
- **Khi nÃ o váº¥n Ä‘á»:** CÃ³ Predicate residual + báº£ng lá»›n â†’ thiáº¿u index

**Warnings cáº§n phÃ¡t hiá»‡n trÃªn Scan:**
| Pattern | XML Signal | Cáº£nh bÃ¡o |
|---|---|---|
| Residual predicate | `Predicate` element | Scan vá»›i filter sau â€” check index |
| Non-SARGable | `CONVERT_IMPLICIT` trong predicate | Kiá»ƒu dá»¯ liá»‡u khÃ´ng khá»›p â†’ khÃ´ng dÃ¹ng Ä‘Æ°á»£c index |
| Non-SARGable | `ISNULL`/`COALESCE` bá»c column | Rewrite predicate |
| Non-SARGable | Leading wildcard LIKE `'%text'` | Full-text index náº¿u cáº§n substring search |
| Non-SARGable | `CASE` expression trong predicate | TÃ¡ch thÃ nh multiple WHERE clauses |
| Non-SARGable | Function call trÃªn column | Move function sang parameter side |
| CE guess | EstimateRows â‰ˆ 30%/10%/9% cá»§a TableCardinality | Optimizer guessing, khÃ´ng cÃ³ statistics |
| Cardinality misestimate | EstimateRows >> ActualRows AND selectivity < 10% | Wrong plan choice (scan thay vÃ¬ seek) |

#### Key Lookup âš ï¸â†’ðŸ”´ (Cáº§n giáº£i quyáº¿t)
- SQL Server tÃ¬m row qua nonclustered index, rá»“i quay láº¡i clustered index Ä‘á»ƒ láº¥y thÃªm columns
- **Giáº£i phÃ¡p:** ThÃªm output columns vÃ o INCLUDE list cá»§a nonclustered index
- **Khi Critical:** Cost > 20% tá»•ng plan

#### RID Lookup âš ï¸ (Cáº§n giáº£i quyáº¿t)
- Báº£ng lÃ  Heap (khÃ´ng cÃ³ clustered index), lookup theo Row ID
- **Giáº£i phÃ¡p:** ThÃªm clustered index vÃ o báº£ng

### 11.2 Join Operators

#### Nested Loops
- **Tá»‘t khi:** Outer side nhá» (< vÃ i nghÃ¬n rows), inner side cÃ³ index seek
- **Váº¥n Ä‘á»:** Inner side executed > 100,000 láº§n â†’ nghiÃªm trá»ng
- **Root cause thÆ°á»ng gáº·p:** Row estimate sai á»Ÿ outer side â†’ optimizer chá»n NL sai
- **Xem:** ActualExecutions cá»§a inner child

#### Hash Match
- **Tá»‘t khi:** Cáº£ 2 sides lá»›n, khÃ´ng cÃ³ index phÃ¹ há»£p
- **Váº¥n Ä‘á»:** Memory grant lá»›n, cÃ³ thá»ƒ spill
- **Xem:** HashKeysBuild, HashKeysProbe, spill warnings

#### Merge Join
- **Tá»‘t khi:** Cáº£ 2 sides sorted trÃªn join column
- **Váº¥n Ä‘á» ManyToMany:** `ManyToMany="1"` â†’ dÃ¹ng TempDB worktable khi cÃ³ duplicate values

#### Join OR Clause âš ï¸
- Pattern: OR trong join predicate â†’ SQL Server expand thÃ nh Concatenation cá»§a Constant Scans
- **Giáº£i phÃ¡p:** Rewrite thÃ nh `UNION ALL`

### 11.3 Sort & Aggregate

#### Sort âš ï¸
- Explicit sort = ORDER BY, GROUP BY, hoáº·c Merge Join cáº§n sorted input
- **Váº¥n Ä‘á»:** Sort > 20% cost, Ä‘áº·c biá»‡t náº¿u spill
- **Giáº£i phÃ¡p:** Index khá»›p vá»›i sort order

#### Top Above Scan âš ï¸
- `TOP` + `ORDER BY` Ä‘ang scan toÃ n bá»™ báº£ng rá»“i sort
- **Giáº£i phÃ¡p:** Index trÃªn ORDER BY columns

#### Hash Aggregate vs Stream Aggregate
- Hash Aggregate: cáº§n memory, cÃ³ thá»ƒ spill
- Stream Aggregate: cáº§n input sorted, khÃ´ng cáº§n memory

### 11.4 Spool Operators

#### Eager Index Spool ðŸ”´ (Critical)
- SQL Server tá»± build temporary index trong TempDB **má»—i láº§n execute**
- **Giáº£i phÃ¡p:** Táº¡o permanent index theo gá»£i Ã½ trong `SuggestedIndex`

#### Lazy Table Spool (Cache miss ratio)
- Caches results cho correlated subquery reuse
- **Váº¥n Ä‘á»:** Rebinds >> Rewinds * 5 â†’ cache khÃ´ng hiá»‡u quáº£, tá»‘n overhead

#### Row Count Spool ðŸ”´
- Pattern `NOT IN` vá»›i nullable column
- **Giáº£i phÃ¡p:** DÃ¹ng `NOT EXISTS` hoáº·c thÃªm `WHERE column IS NOT NULL`

### 11.5 Parallelism (Exchange)
- `Gather Streams`: merge output tá»« nhiá»u threads
- `Repartition Streams`: redistribute rows giá»¯a threads
- `Broadcast`: copy rows Ä‘áº¿n táº¥t cáº£ threads

**Parallel Skew:** Má»™t thread xá»­ lÃ½ > 50% (DOP>2) hoáº·c > 80% (DOP=2) tá»•ng rows â†’ parallelism khÃ´ng hiá»‡u quáº£

### 11.6 Filter Operator âš ï¸
- Filter sau khi Ä‘Ã£ Ä‘á»c data â†’ rows bá»‹ discard muá»™n
- **Ideal:** Filter nÃªn xáº£y ra táº¡i storage layer (seek predicate hoáº·c residual trÃªn scan)
- **Xem:** Sá»‘ rows input vs output, logical reads bÃªn dÆ°á»›i

---

## 12. Scalar UDF â€” Worst Case

**Scalar T-SQL UDF lÃ  má»™t trong nhá»¯ng performance anti-patterns nguy hiá»ƒm nháº¥t:**

1. Cháº¡y **1 láº§n/row** (row-by-row execution, khÃ´ng set-based)
2. **NgÄƒn parallelism** â€” toÃ n bá»™ query forced serial
3. Optimizer khÃ´ng thá»ƒ "nhÃ¬n tháº¥y" bÃªn trong UDF â†’ estimate 1 row

**PhÃ¡t hiá»‡n:**
- `UserDefinedFunction` element trong plan operators
- `NonParallelPlanReason = "TSQLUserDefinedFunctionsNotParallelizable"`
- `UdfCpuTime > 0` trong RunTimeCounters

**Giáº£i phÃ¡p theo thá»© tá»± Æ°u tiÃªn:**
1. Rewrite thÃ nh inline TVF (RETURNS TABLE AS RETURN SELECT...)
2. SQL Server 2019+: Scalar UDF Inlining tá»± Ä‘á»™ng (kiá»ƒm tra `ContainsInlineScalarTsqlUdfs`)
3. Dump káº¿t quáº£ vÃ o #temp table rá»“i JOIN

---

## 13. Row Estimate Mismatch â€” NguyÃªn NhÃ¢n Má»i Váº¥n Äá»

Háº§u háº¿t performance problem Ä‘á»u báº¯t Ä‘áº§u tá»« **row estimate sai**:

```
ratio = ActualRows / (ActualExecutions || 1) / EstimateRows

ratio >= 10x  â†’ Underestimate (nhiá»u rows hÆ¡n dá»± Ä‘oÃ¡n) â†’ plan khÃ´ng Ä‘á»§ memory/index
ratio <= 0.1x â†’ Overestimate (Ã­t rows hÆ¡n dá»± Ä‘oÃ¡n) â†’ wrong join type, wrong access method
```

### Khi nÃ o estimate sai gÃ¢y háº¡i (cáº§n warn):
- Node lÃ  Sort/Hash Match (memory allocation sai â†’ spill)
- Node lÃ  inner side cá»§a Nested Loops (execution count sai)
- Node lÃ  root data access vá»›i cost > 50% cá»§a plan
- Scan vá»›i estimate >> actual + selectivity < 10% â†’ optimizer chá»n scan thay vÃ¬ seek

### NguyÃªn nhÃ¢n phá»• biáº¿n:
| NguyÃªn nhÃ¢n | Signal |
|---|---|
| Stale statistics | ModificationCount cao, LastUpdate cÅ© |
| Local variables | CompiledValue rá»—ng trong ParameterList |
| Implicit conversion | CONVERT_IMPLICIT trong predicate |
| Multi-predicate correlation | Optimizer assume independence |
| Skewed data distribution | Má»™t giÃ¡ trá»‹ chiáº¿m % lá»›n |
| CTE / subquery | SQL Server khÃ´ng materialize â†’ re-estimate tá»«ng láº§n |
| Table variable | LuÃ´n estimate 1 row (pre-2017) hoáº·c 100 rows (2017+) |

---

## 14. Table Variable vs #Temp Table

| | Table Variable (@t) | Temp Table (#t) |
|---|---|---|
| Statistics | âŒ KhÃ´ng cÃ³ column-level stats | âœ… CÃ³, auto-update |
| Row estimate | âŒ LuÃ´n 1 (pre-2017) / 100 (2017+) | âœ… Dá»±a trÃªn data thá»±c |
| Parallelism | âŒ DML báº¯t buá»™c serial | âœ… CÃ³ thá»ƒ parallel |
| Spill to log | âŒ KhÃ´ng (Ã­t I/O cho small tables) | âœ… CÃ³ (I/O overhead) |
| Scope | Function/procedure | Procedure + child calls |

**Rule:** DÃ¹ng #temp table khi table variable Ä‘Æ°á»£c JOIN hoáº·c cÃ³ nhiá»u rows.

---

## 15. CTE â€” Common Table Expression

**CTE KHÃ”NG Ä‘Æ°á»£c materialize** â€” SQL Server re-execute má»—i láº§n reference:

```sql
WITH cte AS (SELECT ... FROM BigTable WHERE ...)
SELECT a.*, b.*
FROM cte a       -- Execute 1 láº§n
JOIN cte b ON ... -- Execute thÃªm 1 láº§n ná»¯a!
```

**Giáº£i phÃ¡p:** Dump CTE vÃ o #temp table khi Ä‘Æ°á»£c reference > 1 láº§n.

---

## 16. Spill to TempDB â€” Critical Performance Issue

Xáº£y ra khi operator (Sort, Hash Match, Exchange) Ä‘Æ°á»£c cáº¥p Ã­t memory hÆ¡n cáº§n thiáº¿t:

```xml
<SpillToTempDb SpillLevel="1" SpilledGroups="234"/>
```

| Loáº¡i Spill | Operator | NguyÃªn nhÃ¢n |
|---|---|---|
| Sort Spill | Sort | Row estimate tháº¥p â†’ memory grant nhá» |
| Hash Spill | Hash Match / Hash Aggregate | Probe side lá»›n hÆ¡n build side dá»± Ä‘oÃ¡n |
| Exchange Spill | Parallelism | Thread producer nhanh hÆ¡n consumer |

**Severity dá»±a trÃªn % elapsed time:**
- Spill chiáº¿m > 50% elapsed â†’ Critical
- Spill chiáº¿m 10-50% elapsed â†’ Warning

---

## 17. Row Goal â€” Optimizer Short-Circuit

```
EstimateRowsWithoutRowGoal > EstimateRows
```

Row Goal xáº£y ra khi cÃ³ `TOP`, `EXISTS`, `IN`, `FAST N` â€” optimizer giáº£ Ä‘á»‹nh query sáº½ dá»«ng sá»›m:

- **Náº¿u query thá»±c sá»± dá»«ng sá»›m** â†’ Row Goal hoáº¡t Ä‘á»™ng Ä‘Ãºng
- **Náº¿u query Ä‘á»c háº¿t data** â†’ Plan bá»‹ suboptimal (chá»n Nested Loops thay vÃ¬ Hash Join)

---

## 18. Per-Thread Analysis (Actual Parallel Plans)

```
RunTimeCountersPerThread (Thread=0 lÃ  coordinator):
  Thread  ActualRows  ActualElapsedMs  ActualLogicalReads
  0       0           123              0
  1       450000      890              12345
  2       450050      892              12367
  3       12           891              123      â† Skewed!
```

**Parallel Skew:** Thread 3 chá»‰ xá»­ lÃ½ 12 rows trong khi cÃ¡c thread khÃ¡c xá»­ lÃ½ 450K â†’ parallelism khÃ´ng giÃºp nhiá»u.

**NguyÃªn nhÃ¢n:** Uneven data distribution trÃªn partition key hoáº·c hash bucket.

---

## 19. Parameter Sensitive Plan (PSP) â€” SQL Server 2022

```xml
<Dispatcher>
  <ParameterSensitivePredicate LowBoundary="0" HighBoundary="1000">
    <Predicate>...</Predicate>
  </ParameterSensitivePredicate>
</Dispatcher>
```

SQL Server 2022 tá»± Ä‘á»™ng táº¡o nhiá»u plan cho cÃ¹ng 1 query vá»›i range khÃ¡c nhau â†’ giáº£m parameter sniffing issues.

---

## 20. Checklist PhÃ¢n TÃ­ch Plan â€” Thá»© Tá»± Æ¯u TiÃªn

### BÆ°á»›c 1: Statement Overview
- [ ] Total cost > 5? DOP bao nhiÃªu?
- [ ] CÃ³ `NonParallelPlanReason`? â†’ Xem má»¥c 6
- [ ] `CompileCPUMs` > 1000ms? â†’ Query quÃ¡ phá»©c táº¡p
- [ ] `StatementOptmEarlyAbortReason = MemoryLimitExceeded`? â†’ Critical

### BÆ°á»›c 2: Missing Indexes
- [ ] Impact > 50%? â†’ Táº¡o ngay
- [ ] Nhiá»u suggestions cÃ¹ng báº£ng? â†’ Consolidate
- [ ] Include columns > 5? â†’ Evaluate

### BÆ°á»›c 3: Warnings tá»« Plan XML
- [ ] Implicit conversion (Ä‘áº·c biá»‡t Seek Blocked)?
- [ ] Spill to TempDB?
- [ ] No Join Predicate (cross join)?
- [ ] Memory grant warning?

### BÆ°á»›c 4: Top Operators
- [ ] Operator nÃ o chiáº¿m > 30% cost / elapsed?
- [ ] Scan thay vÃ¬ Seek? â†’ Residual predicate? Non-SARGable?
- [ ] Key Lookup > 20%? â†’ INCLUDE columns
- [ ] Eager Index Spool? â†’ Create permanent index
- [ ] Sort > 20%? â†’ Index on ORDER BY columns

### BÆ°á»›c 5: Row Estimates (Actual plan)
- [ ] Actual vs Estimated ratio > 10x hoáº·c < 0.1x?
- [ ] Nested Loops inner executed > 100K láº§n?
- [ ] Sort/Hash spill occurred?

### BÆ°á»›c 6: Memory (Actual plan)
- [ ] MaxUsed >= 90% Granted â†’ Spill risk
- [ ] MaxUsed < 50% Granted â†’ Overestimate, tá»‘n RAM
- [ ] GrantWaitTime > 0 â†’ Server memory pressure
- [ ] Granted >= 1GB â†’ Large grant, cáº§n investigate Sort/Hash

### BÆ°á»›c 7: Parallelism (Actual plan)
- [ ] Efficiency < 40%? â†’ Parallel skew hoáº·c wait bottleneck
- [ ] Elapsed >> CPU? â†’ Threads waiting (xem WaitStats)
- [ ] Thread skew > 50%? â†’ Data distribution issue

### BÆ°á»›c 8: Code Anti-Patterns
- [ ] Scalar UDF? â†’ Rewrite as iTVF
- [ ] Table variable trong large query? â†’ #temp table
- [ ] CTE referenced > 1 láº§n? â†’ #temp table
- [ ] NOT IN vá»›i nullable column? â†’ NOT EXISTS
- [ ] Local variables (no compiled value)? â†’ Parameters

---

## 21. XML Attributes Map â€” Quick Reference

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

### RelOp (má»—i operator):
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

| Severity | MÃ u | Khi nÃ o |
|---|---|---|
| **Critical** | ðŸ”´ | Impact trá»±c tiáº¿p, cáº§n fix ngay: Eager Index Spool, Key Lookup chiáº¿m > 20%, Spill > 50% elapsed, Scalar UDF > 1s, NL inner > 1M executions, Table variable DML |
| **Warning** | ðŸŸ¡ | CÃ³ váº¥n Ä‘á» nhÆ°ng chÆ°a critical: Row estimate > 10x, Sort > 20%, Scan vá»›i predicate, Missing index > 25% impact, CTE multi-ref, Local variables |
| **Info** | ðŸ”µ | Awareness: Row Goal, Low-impact index suggestion, CE model version, Optimization level TRIVIAL |

---

*TÃ i liá»‡u nÃ y Ä‘Æ°á»£c tá»•ng há»£p tá»« analysis cá»§a `ShowPlanParser.cs` (1840 dÃ²ng), `PlanAnalyzer.cs` (1943 dÃ²ng), `PlanModels.cs` vÃ  JavaScript source cá»§a mssql.ee â€” bao gá»“m 33+ warning rules vÃ  toÃ n bá»™ ShowPlan XML schema.*

