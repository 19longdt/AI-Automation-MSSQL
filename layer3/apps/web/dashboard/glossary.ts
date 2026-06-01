export interface GlossaryEntry {
  term: string;
  definition: string;
  threshold?: string;
  impact: string;
  formula?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ── I/O ──────────────────────────────────────────────────────────────────
  logical_reads: {
    term: "Logical Reads",
    definition: "Số lần đọc trang 8KB từ buffer pool (bộ nhớ RAM). Không phân biệt trang đã cache hay mới từ đĩa.",
    threshold: "Không có ngưỡng tuyệt đối — so sánh giữa các lần chạy cùng query. Tăng bất thường cần điều tra.",
    impact: "Tăng CPU, áp lực buffer pool, và giảm concurrency.",
  },
  physical_reads: {
    term: "Physical Reads",
    definition: "Số lần đọc trang từ đĩa vào buffer pool. Xảy ra khi trang chưa được cache.",
    threshold: "Sau khi warm-up cache lý tưởng gần 0. Cao liên tục = buffer pool quá nhỏ.",
    impact: "Tăng độ trễ I/O đáng kể so với logical reads.",
  },
  read_ahead: {
    term: "Read Ahead (RA)",
    definition: "SQL Server tự động đọc trước các trang dự đoán sẽ cần trong lần scan tiếp theo.",
    threshold: "Thường bình thường với scan lớn. Rất cao trên index seek nhỏ = bất thường.",
    impact: "Tăng I/O nhưng giảm latency nếu dự đoán đúng.",
  },
  scan_count: {
    term: "Scan Count",
    definition: "Số lần operator được thực thi (executions). Với Nested Loops, = số lần inner table bị quét.",
    threshold: "Cao với inner input của Nested Loops = chi phí nhân lên theo số rows outer.",
    impact: "Multiplier cho mọi chi phí I/O phía inner.",
  },

  // ── Row Estimation ────────────────────────────────────────────────────────
  estimated_rows: {
    term: "Estimated Rows",
    definition: "Số hàng optimizer ước lượng tại output của operator dựa trên statistics.",
    threshold: "Lệch ≥10× so với actual_rows là cảnh báo cần chú ý.",
    impact: "Estimate sai dẫn tới chọn plan kém, memory grant sai, và join algorithm không phù hợp.",
  },
  actual_rows: {
    term: "Actual Rows",
    definition: "Số hàng thực tế xử lý lúc runtime. Chỉ có trong Actual Execution Plan.",
    threshold: "Dùng để so với estimated_rows phát hiện cardinality mismatch.",
    impact: "Sai lệch lớn = optimizer đã dùng thông tin sai để build plan.",
  },
  row_est_ratio: {
    term: "Row Estimate Ratio",
    definition: "+N× = actual nhiều hơn estimate N lần (under-estimate). ÷N× = actual ít hơn N lần (over-estimate).",
    threshold: "≥10× hoặc ≤0.1× là đáng lo. ≥100× là nghiêm trọng.",
    impact: "Under-estimate thường dẫn tới Hash/Sort spill. Over-estimate dẫn tới memory overgrant.",
    formula: "actual_rows / estimated_rows",
  },

  // ── Memory ────────────────────────────────────────────────────────────────
  memory_grant: {
    term: "Memory Grant",
    definition: "Workspace memory được cấp phát trước khi query chạy, dùng cho Sort và Hash operations.",
    threshold: "Used ≥90% = nguy cơ spill. Used <20% = overgrant lãng phí.",
    impact: "Ảnh hưởng trực tiếp tốc độ query và concurrency.",
    formula: "max_used_kb / granted_kb × 100%",
  },
  spill_to_tempdb: {
    term: "Spill to TempDB",
    definition: "Sort hoặc Hash tràn dữ liệu xuống TempDB do không đủ memory grant.",
    threshold: "Bất kỳ spill nào cũng cần theo dõi.",
    impact: "Tăng I/O TempDB đáng kể, làm chậm query 10–100×.",
  },
  resource_semaphore: {
    term: "RESOURCE_SEMAPHORE",
    definition: "Query đang chờ memory grant. Xảy ra khi server hết workspace memory.",
    threshold: "Bất kỳ wait nào >100ms là vấn đề.",
    impact: "Query block nhau, throughput giảm mạnh.",
  },

  // ── Index ─────────────────────────────────────────────────────────────────
  key_lookup: {
    term: "Key Lookup",
    definition: "Sau khi tìm row qua nonclustered index, SQL Server phải quay lại clustered index để lấy thêm cột không có trong nonclustered index.",
    threshold: "Số rows lookup × 2 logical reads per row. Nhiều rows = rất đắt.",
    impact: "Tăng logical reads và random I/O. Có thể fix bằng cách INCLUDE thêm cột vào index.",
  },
  index_seek: {
    term: "Index Seek",
    definition: "Tìm kiếm có chọn lọc trong B-tree index theo predicate. Chỉ duyệt các trang cần thiết.",
    threshold: "Luôn tốt hơn scan khi selectivity cao.",
    impact: "I/O tối thiểu, hiệu quả nhất.",
  },
  index_scan: {
    term: "Index Scan",
    definition: "Đọc toàn bộ hoặc một phần lớn index. Xảy ra khi không có predicate phù hợp hoặc selectivity thấp.",
    threshold: "Kết hợp với predicate filter = có thể optimize thành seek.",
    impact: "I/O cao, tăng buffer pool pressure.",
  },

  // ── Join & Operators ──────────────────────────────────────────────────────
  hash_match: {
    term: "Hash Match",
    definition: "Join algorithm dùng hash table. Build phase tạo hash từ input nhỏ hơn, Probe phase quét input lớn hơn.",
    threshold: "Cần memory grant. Estimate sai có thể gây spill.",
    impact: "CPU cao hơn Nested Loops. Cân nhắc index trên cột join.",
  },
  sort_op: {
    term: "Sort Operator",
    definition: "Sắp xếp dữ liệu theo ORDER BY, GROUP BY, hoặc chuẩn bị cho Merge Join/Stream Aggregate.",
    threshold: "Cost cao = dữ liệu chưa được sắp xếp sẵn. Index theo ORDER BY loại bỏ Sort.",
    impact: "CPU cao, cần memory, có thể spill TempDB.",
  },
  parallelism_op: {
    term: "Parallelism (Exchange)",
    definition: "Operator phân phối hoặc thu thập data giữa các thread. Repartition Streams, Distribute Streams, Gather Streams.",
    threshold: "Quá nhiều = overhead synchronization tăng.",
    impact: "Cần thiết cho parallel plan nhưng có chi phí coordination.",
  },

  // ── Statistics ────────────────────────────────────────────────────────────
  statistics_modification_count: {
    term: "Statistics Modification Count",
    definition: "Số lần dữ liệu thay đổi (INSERT/UPDATE/DELETE) từ lần UPDATE STATISTICS gần nhất.",
    threshold: "Mặc định auto-update khi >20% rows thay đổi (threshold cũ). Bảng lớn cần manual update thường xuyên hơn.",
    impact: "Stats stale → cardinality estimate sai → plan kém.",
  },
  sampling_percent: {
    term: "Sampling Percent",
    definition: "Tỷ lệ phần trăm dữ liệu được sample khi cập nhật statistics.",
    threshold: "<20% có thể không đại diện cho phân phối dữ liệu thực. FULLSCAN = 100%.",
    impact: "Sample thấp → histogram không chính xác → estimate sai.",
  },
  row_underestimate: {
    term: "Row Under-Estimate",
    definition: "Optimizer ước lượng ít hàng hơn thực tế → cấp memory grant nhỏ → Hash/Sort có thể spill ra TempDB.",
    threshold: "≥10× là warning. ≥100× là critical.",
    impact: "Spill TempDB làm chậm query 10–100×. Thường do stale statistics hoặc parameter sniffing.",
    formula: "ratio = actual_rows / estimated_rows ≥ 10",
  },
  row_overestimate: {
    term: "Row Over-Estimate",
    definition: "Optimizer ước lượng nhiều hàng hơn thực tế → cấp memory grant quá lớn → lãng phí workspace memory, giảm concurrency.",
    threshold: "≤0.1× (actual < 10% estimated) là warning. ≤0.01× là critical.",
    impact: "Memory overgrant giữ resource không cần thiết, giảm số query chạy đồng thời.",
    formula: "ratio = actual_rows / estimated_rows ≤ 0.1",
  },
  stale_stats: {
    term: "Stale Statistics",
    definition: "Statistics chưa được cập nhật trong khi dữ liệu đã thay đổi đáng kể.",
    threshold: "modification_count > 10% tổng rows là cần update.",
    impact: "Cardinality estimate sai, plan suboptimal.",
  },

  // ── Parameters ────────────────────────────────────────────────────────────
  parameter_sniffing: {
    term: "Parameter Sniffing",
    definition: "SQL Server compile plan dựa trên giá trị parameter lần đầu tiên chạy. Plan này được cache và tái dùng cho các giá trị khác.",
    threshold: "Compiled value ≠ Runtime value = nguy cơ plan không tối ưu cho giá trị hiện tại.",
    impact: "Performance dao động mạnh theo giá trị tham số. Fix: OPTIMIZE FOR, local variable, hoặc RECOMPILE.",
  },

  // ── Compilation ───────────────────────────────────────────────────────────
  cardinality_estimation: {
    term: "Cardinality Estimation (CE)",
    definition: "Model ước lượng số rows tại mỗi operator. CE70 = SQL Server 2012 legacy. CE120+ = modern.",
    threshold: "CE70 dễ sai với dữ liệu có correlations. Nên dùng CE120+ (COMPATIBILITY_LEVEL ≥ 120).",
    impact: "CE model sai dẫn tới toàn bộ plan shape kém.",
  },
  dop: {
    term: "Degree of Parallelism (DOP)",
    definition: "Số thread CPU được dùng để thực thi query parallel. DOP=1 là serial.",
    threshold: "DOP quá cao gây contention. DOP quá thấp với query lớn bỏ phí CPU.",
    impact: "Không phù hợp làm giảm throughput tổng thể.",
    formula: "Parallel efficiency = (serial_time / parallel_time) / DOP × 100%",
  },
  compile_cpu: {
    term: "Compile CPU",
    definition: "CPU time (ms) dùng để compile và optimize query plan.",
    threshold: ">1000ms là cao — query phức tạp hoặc thiếu statistics.",
    impact: "Compile nặng tăng first-execution latency và CPU pressure dưới load.",
  },
  compile_memory: {
    term: "Compile Memory",
    definition: "Memory (KB) dùng trong quá trình compile plan.",
    threshold: ">10MB là rất cao — query cực phức tạp hoặc nhiều joins.",
    impact: "Compile memory cao cạnh tranh với workspace memory của queries khác.",
  },
  non_parallel_reason: {
    term: "Non-Parallel Plan Reason",
    definition: "Lý do SQL Server không tạo parallel plan: EstimatedDOPIsOne, NoParallelismEstimatedForConstraint, v.v.",
    threshold: "Nếu query lớn mà plan serial, kiểm tra MAXDOP setting và cost threshold.",
    impact: "Query lớn chạy serial = không tận dụng được CPU đa lõi.",
  },
  optm_level: {
    term: "Optimization Level",
    definition: "Mức optimizer đã dùng: TRIVIAL (đơn giản, 1 plan), FULL (đầy đủ cost-based optimization).",
    threshold: "TRIVIAL plan không tối ưu tốt với queries phức tạp.",
    impact: "TRIVIAL = optimizer bỏ qua nhiều alternatives.",
  },
  query_hash: {
    term: "Query Hash",
    definition: "Hash đại diện cho cấu trúc query (không phụ thuộc giá trị literal). Dùng để group queries tương tự.",
    impact: "Tra cứu trong Plan Cache và Query Store để xem lịch sử execution.",
  },
  plan_hash: {
    term: "Query Plan Hash",
    definition: "Hash đại diện cho shape của execution plan. Khác query_hash khi cùng query có nhiều plans khác nhau.",
    impact: "Dùng để detect plan regression — cùng query nhưng plan thay đổi.",
  },

  // ── Wait Statistics ───────────────────────────────────────────────────────
  wait_stat: {
    term: "Wait Statistics",
    definition: "Thời gian query phải chờ tài nguyên (CPU, I/O, lock, memory, network...) trong khi thực thi.",
    threshold: "Tổng wait time bất thường so với elapsed time = có bottleneck.",
    impact: "Cho biết bottleneck nằm ở đâu để tối ưu đúng hướng.",
  },
  cxpacket: {
    term: "CXPACKET",
    definition: "Thread đang chờ thread khác trong parallel plan. Packet exchange synchronization.",
    threshold: "Cao + skewed actual rows giữa threads = parallelism không đều.",
    impact: "Tổng elapsed time bị kéo dài bởi thread chậm nhất.",
  },
  pageiolatch_sh: {
    term: "PAGEIOLATCH_SH",
    definition: "Chờ đọc trang từ đĩa vào buffer pool (shared latch). Xảy ra khi physical read.",
    threshold: "Cao = buffer pool không đủ hoặc storage IOPS chậm.",
    impact: "Tăng query latency theo tốc độ đĩa.",
  },
  pageiolatch_ex: {
    term: "PAGEIOLATCH_EX",
    definition: "Chờ ghi trang vào đĩa (exclusive latch). Xảy ra khi checkpoint hoặc dirty page flush.",
    threshold: "Cao = storage write throughput là bottleneck.",
    impact: "Ảnh hưởng write-heavy workloads.",
  },
  io_completion: {
    term: "IO_COMPLETION",
    definition: "Chờ hoàn thành I/O không liên quan đến data pages (thường là TempDB spill, sort).",
    threshold: "Cao cùng với spill = memory grant không đủ.",
    impact: "Gián tiếp chỉ ra memory pressure.",
  },
  sos_scheduler_yield: {
    term: "SOS_SCHEDULER_YIELD",
    definition: "Thread tự nguyện nhường CPU scheduler để tránh chiếm dụng quá lâu.",
    threshold: "Cao = CPU pressure hoặc long-running CPU-bound operations.",
    impact: "CPU utilization cao, latency tăng.",
  },
  writelog: {
    term: "WRITELOG",
    definition: "Chờ transaction log được flush xuống đĩa (log hardening).",
    threshold: "Cao = storage write latency cao hoặc transaction log trên đĩa chậm.",
    impact: "Bottleneck cho write transactions.",
  },
  async_network_io: {
    term: "ASYNC_NETWORK_IO",
    definition: "Server đang chờ client nhận kết quả. Client xử lý chậm hoặc network chậm.",
    threshold: "Cao = client-side bottleneck, không phải server.",
    impact: "Query server-side đã xong nhưng phải chờ gửi data.",
  },
  latch_ex: {
    term: "LATCH_EX",
    definition: "Chờ non-page latch exclusive — thường trên cấu trúc nội bộ (free space info, allocation).",
    threshold: "Cao với INSERT workload = allocation contention (thường trên SGAM/PFS pages).",
    impact: "Có thể fix bằng cách dùng multiple data files hoặc trace flag 1118/1117.",
  },
  latch_sh: {
    term: "LATCH_SH",
    definition: "Chờ non-page latch shared. Ít gây contention hơn LATCH_EX nhưng nhiều waiter cùng lúc vẫn có thể thành vấn đề.",
    threshold: "Rất cao = cấu trúc nội bộ bị tranh chấp mạnh.",
    impact: "Thường ít nghiêm trọng hơn LATCH_EX.",
  },
  cxconsumer: {
    term: "CXCONSUMER",
    definition: "Consumer thread trong parallel plan đang chờ producer thread cung cấp data. Tách từ CXPACKET kể từ SQL Server 2016 SP2.",
    threshold: "Thường benign — bình thường với parallel queries. Cao bất thường = producer chậm hoặc data skew.",
    impact: "Ít lo ngại hơn CXPACKET. Nếu CXCONSUMER >> CXPACKET = producer là bottleneck.",
  },
  memory_allocation_ext: {
    term: "MEMORY_ALLOCATION_EXT",
    definition: "Chờ cấp phát workspace memory cho operator (Sort, Hash Join, Hash Aggregate) từ memory grant đã được cấp. Xảy ra khi nhiều operator cùng tranh workspace memory trong cùng query.",
    threshold: "Cao = memory grant tuy được cấp nhưng phân phối nội bộ chậm. Thường đi kèm với query phức tạp có nhiều Sort/Hash.",
    impact: "Tăng latency cho từng Sort/Hash operator. Cân nhắc tách query hoặc tối ưu plan để giảm số operator cần memory.",
  },
  reserved_memory_allocation_ext: {
    term: "RESERVED_MEMORY_ALLOCATION_EXT",
    definition: "Chờ cấp phát phần memory đã được reserved (dự trữ) trong memory grant pool. Liên quan đến batch-mode execution và columnstore.",
    threshold: "Xuất hiện = query đang dùng batch mode hoặc columnstore với memory reservation cao.",
    impact: "Thường nhỏ. Nếu lớn, kiểm tra columnstore segment loading và batch mode memory pressure.",
  },
  pageiolatch_up: {
    term: "PAGEIOLATCH_UP",
    definition: "Chờ update latch trên page đang trong quá trình I/O (đọc từ đĩa). Ít phổ biến hơn SH/EX.",
    threshold: "Cao = storage contention khi nhiều process cùng đọc/ghi page.",
    impact: "Tương tự PAGEIOLATCH_SH nhưng cho update operations.",
  },
  pagelatch_sh: {
    term: "PAGELATCH_SH",
    definition: "Chờ shared latch trên page đã nằm trong buffer pool (không liên quan I/O). Xảy ra khi nhiều thread đọc cùng một page trong memory.",
    threshold: "Cao = hot page contention trong memory. Phân biệt với PAGEIOLATCH (có disk I/O).",
    impact: "Thường do index hot spot (last-page insert, identity column). Fix: GUID key, partition, hay sắp xếp data.",
  },
  pagelatch_ex: {
    term: "PAGELATCH_EX",
    definition: "Chờ exclusive latch trên page trong buffer pool khi ghi. Phổ biến với concurrent INSERT vào cùng page (last-page contention).",
    threshold: "Cao với identity/sequence INSERT = hot page. Nghiêm trọng hơn PAGELATCH_SH.",
    impact: "Fix: dùng GUID, phân tán INSERT sang nhiều partitions, hay fill factor thấp hơn.",
  },
  pagelatch_up: {
    term: "PAGELATCH_UP",
    definition: "Chờ update latch trên page trong buffer pool cho lần đọc-sửa. Ít phổ biến nhất trong nhóm PAGELATCH.",
    impact: "Thường liên quan đến GAM/SGAM/PFS page khi cấp phát extent mới.",
  },
  threadpool: {
    term: "THREADPOOL",
    definition: "Không có worker thread khả dụng để thực thi task. SQL Server thread pool đã cạn kiệt.",
    threshold: "Bất kỳ giá trị nào = nghiêm trọng. Server đang overload hoặc worker threads bị leak/block.",
    impact: "Queries bị xếp hàng chờ thread. Fix: tăng max worker threads, kill blocking sessions, scale up.",
  },
  logbuffer: {
    term: "LOGBUFFER",
    definition: "Chờ log buffer được flush để ghi log record. Xảy ra khi log buffer đầy hoặc flush chưa xong.",
    threshold: "Cao = log I/O không đủ nhanh so với tốc độ write của workload.",
    impact: "Bottleneck cho mọi write transaction. Liên quan chặt với WRITELOG.",
  },
  execsync: {
    term: "EXECSYNC",
    definition: "Chờ đồng bộ hóa trong parallel execution — thường tại Gather Streams khi tất cả threads cần sync trước bước tiếp theo.",
    threshold: "Thường nhỏ và bình thường. Cao = có thread rất chậm trong parallel plan.",
    impact: "Gây ra serial bottleneck giữa các giai đoạn parallel.",
  },
  hadr_sync_commit: {
    term: "HADR_SYNC_COMMIT",
    definition: "Primary đang chờ secondary xác nhận đã hardened log (synchronous commit mode trong AlwaysOn AG). Phát sinh ngay khi COMMIT transaction.",
    threshold: "Cao = network latency đến secondary cao hoặc secondary disk I/O chậm.",
    impact: "Tăng trực tiếp commit latency cho mọi write transaction. Fix: network optimization, SSD cho secondary, xem xét async commit cho secondary xa.",
  },
  hadr_work_queue: {
    term: "HADR_WORK_QUEUE",
    definition: "AlwaysOn AG background worker đang chờ task mới. Thường idle-wait bình thường của AG thread pool.",
    threshold: "Xuất hiện trong query wait stats là bất thường — có thể AG redo thread bị chậm.",
    impact: "Liên quan đến AG redo lag nếu cao bất thường.",
  },

  // ── Analysis Groups ───────────────────────────────────────────────────────
  group_orientation: {
    term: "Orientation",
    definition: "Nhóm định hướng — đọc đầu tiên trước khi phân tích sâu hơn.",
    impact: "Query Text cho biết SQL đang chạy. Warnings tổng hợp mọi vấn đề optimizer phát hiện theo mức độ nghiêm trọng.",
  },
  group_cost: {
    term: "Cost Analysis",
    definition: "Phân tích chi phí thực tế của plan: operator nào tốn nhất, estimate có sai không, I/O đang ở đâu.",
    threshold: "Top Expensive Operations > 70% total cost = bottleneck rõ ràng cần xử lý.",
    impact: "Xác định đúng operator gây chậm trước khi quyết định giải pháp tối ưu.",
  },
  group_actionable: {
    term: "Actionable",
    definition: "Các mục có thể hành động ngay: tạo index, update statistics, kiểm tra parameter sniffing.",
    threshold: "Missing index impact > 10% hoặc stale stats > 20% rows thay đổi = cần xử lý sớm.",
    impact: "Giải quyết nhóm này trực tiếp cải thiện hiệu năng mà không cần thay đổi code.",
  },
  group_context: {
    term: "Context",
    definition: "Thông tin ngữ cảnh bổ sung: index nào đang được dùng, join algorithm, memory cấp phát, wait types.",
    impact: "Giúp hiểu tại sao plan hoạt động theo cách đó và xác nhận giải pháp từ nhóm Actionable.",
  },
  group_deepdive: {
    term: "Deep Dive",
    definition: "Chi tiết kỹ thuật cấp thấp: CE model version, DOP, compile cost, query hash để tra Plan Cache / Query Store.",
    impact: "Dùng khi cần debug plan regression, so sánh plan hash, hoặc điều tra compile overhead.",
  },

  // ── Summary Bar ───────────────────────────────────────────────────────────
  actual_elapsed: {
    term: "Actual Elapsed Time",
    definition: "Thời gian thực tế query chạy từ đầu đến cuối (wall-clock time). Chỉ có trong Actual Execution Plan.",
    threshold: "< 1s bình thường. 1–10s cần xem xét. > 10s cần tối ưu.",
    impact: "Metric trực tiếp nhất về hiệu năng query từ góc nhìn người dùng.",
  },
  cpu_time: {
    term: "CPU Time",
    definition: "Tổng CPU time tiêu thụ bởi tất cả threads. Với parallel plan, CPU time > elapsed time do nhiều threads chạy song song.",
    threshold: "cpu_time >> elapsed_time = parallel plan hiệu quả. cpu_time ≈ elapsed_time = serial plan.",
    impact: "Cao bất thường = query CPU-bound, xem xét plan và index.",
    formula: "CPU efficiency = elapsed_time / cpu_time × DOP",
  },
  total_cost: {
    term: "Estimated Total Cost",
    definition: "Tổng chi phí optimizer ước lượng cho toàn bộ plan, tính bằng đơn vị nội bộ (không phải giây). Dùng để so sánh tương đối giữa các plans.",
    threshold: "Không có ngưỡng tuyệt đối. Tăng đột biến so với baseline = có gì thay đổi.",
    impact: "Là metric chính optimizer dùng khi chọn plan tối ưu.",
  },
  statement_type: {
    term: "Statement Type",
    definition: "Loại câu lệnh SQL trong plan: SELECT, INSERT, UPDATE, DELETE, MERGE...",
    impact: "Ảnh hưởng đến loại lock và cách optimizer chọn plan.",
  },
  warnings_count: {
    term: "Plan Warnings",
    definition: "Số lượng cảnh báo optimizer phát hiện: stale statistics, key lookup, sort đắt, spill, implicit conversion...",
    threshold: "Bất kỳ warning nào cũng đáng xem xét.",
    impact: "Mỗi warning là một cơ hội cải thiện hiệu năng.",
  },
  mem_used: {
    term: "Memory Used",
    definition: "Lượng workspace memory thực tế dùng lúc runtime cho Sort/Hash. Chỉ có trong Actual Execution Plan.",
    threshold: "Gần bằng granted = có thể spill. Rất thấp so với granted = overgrant.",
    impact: "Thực tế dùng bao nhiêu so với những gì được cấp phát.",
    formula: "max_used_kb / granted_kb × 100%",
  },

  // ── Missing Index ─────────────────────────────────────────────────────────
  missing_index_impact: {
    term: "Missing Index Impact",
    definition: "Điểm ước lượng lợi ích (0–100%) nếu tạo index này, tính từ số query và chi phí tiết kiệm được.",
    threshold: ">10% đáng cân nhắc. >50% nên tạo sớm. >90% = ưu tiên cao.",
    impact: "Chỉ là ước lượng — kiểm tra cardinality và workload thực tế trước khi tạo.",
  },
  idx_equality_col: {
    term: "Equality Columns",
    definition: "Cột dùng trong điều kiện bằng (=) trong WHERE/JOIN. Nên đứng đầu trong key columns của index.",
    impact: "Cho phép index seek thay vì scan.",
  },
  idx_inequality_col: {
    term: "Inequality Columns",
    definition: "Cột dùng trong điều kiện phạm vi (>, <, >=, <=, BETWEEN) trong WHERE. Đứng sau equality columns trong key.",
    impact: "Giúp range scan hiệu quả hơn.",
  },
  idx_include_col: {
    term: "Include Columns",
    definition: "Cột thêm vào leaf level của index (không phải key) để tránh Key Lookup. Không ảnh hưởng seek order.",
    impact: "Loại bỏ Key Lookup — giảm đáng kể logical reads với covering index.",
  },

  // ── Join Types ────────────────────────────────────────────────────────────
  nested_loops: {
    term: "Nested Loops",
    definition: "Join algorithm: với mỗi row của outer input, tìm matching rows trong inner input. Hiệu quả khi outer nhỏ và inner có index.",
    threshold: "Inner input quét nhiều lần = scan_count cao = tốn I/O.",
    impact: "Tốt cho selective queries. Kém khi cả hai inputs lớn.",
  },
  merge_join: {
    term: "Merge Join",
    definition: "Join algorithm dùng khi cả hai inputs đã được sắp xếp theo cột join. Đọc tuần tự, không cần hash table.",
    threshold: "Cần dữ liệu đã sort — có thể có Sort operator phía trước.",
    impact: "Hiệu quả với large sorted inputs. Sort thêm = chi phí tăng.",
  },

  // ── Operators (Top Expensive Operations) ─────────────────────────────────
  op_sort: {
    term: "Sort",
    definition: "Sắp xếp dữ liệu theo ORDER BY, GROUP BY hoặc chuẩn bị cho Merge Join / Stream Aggregate.",
    threshold: "Cost cao = dữ liệu chưa có thứ tự sẵn. Index theo cột ORDER BY loại bỏ Sort.",
    impact: "CPU cao, cần memory grant, có thể spill xuống TempDB.",
  },
  op_filter: {
    term: "Filter",
    definition: "Lọc rows theo điều kiện sau khi đã đọc dữ liệu. Nếu đứng sau Scan thường có thể optimize thành Seek.",
    threshold: "Selectivity thấp sau Filter = nên push predicate vào Seek.",
    impact: "Tăng số rows phải xử lý trước khi loại bỏ.",
  },
  op_top: {
    term: "Top",
    definition: "Giới hạn số rows trả về (TOP N, FETCH NEXT). Dừng sớm khi đủ rows.",
    impact: "Thường hiệu quả, nhưng Sort trước Top vẫn xử lý toàn bộ data.",
  },
  op_compute_scalar: {
    term: "Compute Scalar",
    definition: "Tính toán biểu thức scalar: hàm tích hợp, CAST/CONVERT, arithmetic, string function — chạy theo từng row.",
    threshold: "Scalar UDF trong đây = rất nguy hiểm, chặn parallelism.",
    impact: "Overhead per-row tích lũy lớn với nhiều rows.",
  },
  op_stream_aggregate: {
    term: "Stream Aggregate",
    definition: "GROUP BY / aggregate (SUM, COUNT...) trên data đã được sort sẵn theo cột GROUP BY.",
    threshold: "Không cần memory grant. Hiệu quả hơn Hash Aggregate khi data đã sort.",
    impact: "Nếu cần Sort trước = cân nhắc index covering.",
  },
  op_hash_match: {
    term: "Hash Match (Join / Aggregate)",
    definition: "Join hoặc GROUP BY dùng hash table. Build phase tạo hash từ input nhỏ hơn, Probe phase scan input lớn hơn.",
    threshold: "Cần memory grant. Estimate sai → spill TempDB.",
    impact: "CPU cao hơn Nested Loops. Xem xét index trên cột join/group.",
  },
  op_nested_loops: {
    term: "Nested Loops",
    definition: "Join lặp: với mỗi row của outer input, tìm matching rows trong inner input.",
    threshold: "Inner được scan N lần (N = rows outer). Inner phải có index để hiệu quả.",
    impact: "Tốt khi outer nhỏ + inner có index seek. Kém khi cả hai lớn.",
  },
  op_merge_join: {
    term: "Merge Join",
    definition: "Join tuần tự hai input đã sort theo cột join. Đọc cả hai song song theo thứ tự.",
    threshold: "Nếu cần Sort trước = cân nhắc index đã sort sẵn.",
    impact: "Không cần memory/hash. Hiệu quả với large sorted inputs.",
  },
  op_index_seek: {
    term: "Index Seek",
    definition: "Tìm kiếm có chọn lọc trong B-tree index theo predicate cụ thể. Chỉ duyệt các trang cần thiết.",
    threshold: "Tốt nhất khi selectivity cao. Range seek rộng = cân nhắc filter index.",
    impact: "I/O tối thiểu — lý tưởng cho point query hoặc selective range.",
  },
  op_index_scan: {
    term: "Index Scan",
    definition: "Đọc phần lớn hoặc toàn bộ nonclustered index. Xảy ra khi không có seek predicate phù hợp.",
    threshold: "Kết hợp Filter sau Scan = có thể optimize thành Seek + index adjustment.",
    impact: "I/O cao, tăng buffer pool pressure.",
  },
  op_clustered_index_scan: {
    term: "Clustered Index Scan",
    definition: "Scan toàn bộ clustered index — tương đương table scan. Đọc mọi trang dữ liệu.",
    threshold: "Trên bảng lớn = nghiêm trọng. Luôn cần WHERE predicate và index phù hợp.",
    impact: "Logical reads = toàn bộ bảng. Rất tốn kém.",
  },
  op_table_scan: {
    term: "Table Scan",
    definition: "Scan toàn bộ heap table (bảng không có clustered index). Đọc từng page theo thứ tự allocation.",
    threshold: "Heap lớn không có clustered index = xem xét tạo.",
    impact: "Tương tự Clustered Index Scan nhưng không có thứ tự.",
  },
  op_key_lookup: {
    term: "Key Lookup",
    definition: "Sau khi tìm qua nonclustered index, SQL Server quay lại clustered index để lấy cột không có trong index.",
    threshold: "Nhiều rows × 2 reads/row = rất đắt. INCLUDE thêm cột vào index để loại bỏ.",
    impact: "Double I/O cho mỗi row. Thường là nguyên nhân chính của logical reads cao.",
  },
  op_rid_lookup: {
    term: "RID Lookup",
    definition: "Lookup row từ heap table bằng Row Identifier. Tương tự Key Lookup nhưng trên bảng không có clustered index.",
    threshold: "Nhiều rows = rất tốn. Tạo clustered index để chuyển thành Key Lookup hoặc loại bỏ.",
    impact: "Random I/O trên heap, không có thứ tự.",
  },
  op_parallelism: {
    term: "Parallelism (Exchange)",
    definition: "Phân phối (Repartition/Distribute Streams) hoặc thu thập (Gather Streams) data giữa các thread CPU.",
    threshold: "Quá nhiều exchange operators = overhead synchronization lớn.",
    impact: "Cần thiết cho parallel plan nhưng có chi phí coordination giữa threads.",
  },
  op_bitmap: {
    term: "Bitmap",
    definition: "Tạo bitmap filter để loại sớm rows không thỏa mãn điều kiện join trước khi gửi sang exchange operator.",
    threshold: "Thường tốt — giảm network/memory giữa threads.",
    impact: "Hỗ trợ tối ưu parallel hash join với early row elimination.",
  },
  op_spool: {
    term: "Spool (Lazy/Eager/Table)",
    definition: "Lưu kết quả tạm thời vào work table trong TempDB. Eager Spool đọc toàn bộ ngay, Lazy Spool đọc khi cần.",
    threshold: "Xuất hiện với correlated subquery hoặc index spool = xem xét index phù hợp hơn.",
    impact: "Thêm I/O TempDB. Index Spool = optimizer tự tạo index tạm — thiếu index thật.",
  },
  op_window_spool: {
    term: "Window Spool",
    definition: "Tính toán window functions (ROW_NUMBER, RANK, SUM OVER, LAG...). Có thể ghi dữ liệu xuống TempDB.",
    threshold: "Partition/order lớn = memory pressure.",
    impact: "Phụ thuộc vào kích thước window frame và số partitions.",
  },
  op_concatenation: {
    term: "Concatenation",
    definition: "Gộp nhiều input thành một output (UNION ALL). Không sort, không loại bỏ duplicate.",
    impact: "Chi phí = tổng chi phí tất cả inputs. Thường không phải bottleneck.",
  },
  op_assert: {
    term: "Assert",
    definition: "Kiểm tra ràng buộc toàn vẹn: FK, CHECK, UNIQUE, NOT NULL. Raise error nếu vi phạm.",
    impact: "Thường nhỏ. Nếu lớn = nhiều constraint check trên bảng lớn.",
  },
  op_remote: {
    term: "Remote Query / Remote Scan",
    definition: "Truy vấn sang server khác qua Linked Server hoặc distributed query.",
    threshold: "Chi phí không phản ánh đúng thực tế — network latency không được tính.",
    impact: "Phụ thuộc hoàn toàn vào network và remote server performance.",
  },

  // ── Implicit Conversion ───────────────────────────────────────────────────
  implicit_conversion: {
    term: "CONVERT_IMPLICIT",
    definition: "SQL Server tự ép kiểu dữ liệu ngầm trong predicate do kiểu cột và tham số khác nhau.",
    threshold: "Xuất hiện trên cột JOIN hoặc WHERE = không dùng index được.",
    impact: "Có thể chuyển Index Seek thành Index Scan. Fix: đảm bảo kiểu khớp.",
  },
  scalar_udf: {
    term: "Scalar UDF",
    definition: "Hàm scalar do user định nghĩa, thực thi theo từng dòng riêng biệt (row-by-row).",
    threshold: "Có trong query lớn là cảnh báo.",
    impact: "Ngăn parallelism và pushdown optimization. Cân nhắc inline TVF hoặc rewrite.",
  },
};
