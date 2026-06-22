import type { TopicThresholdConfig } from "@/types";

interface GlossaryThresholdSource {
  topicId: string;
  metricKey: string;
  format: (threshold: TopicThresholdConfig) => string | null;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  threshold?: string;
  impact: string;
  formula?: string;
  thresholdSource?: GlossaryThresholdSource;
}

function formatWarningCriticalThreshold(
  threshold: TopicThresholdConfig,
  warningUnit: string,
  criticalUnit: string = warningUnit,
  transform?: (value: number) => string,
): string | null {
  if (threshold.warning == null || threshold.critical == null) return null;
  const toText = (value: number): string => transform ? transform(value) : value.toLocaleString();
  return `> ${toText(threshold.warning)} ${warningUnit} cảnh báo, > ${toText(threshold.critical)} ${criticalUnit} nghiêm trọng.`;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {

  // ── I/O ──────────────────────────────────────────────────────────────────
  logical_reads: {
    term: "Logical Reads",
    definition: "Số lần đọc trang 8KB từ buffer pool (bộ nhớ RAM). Không phân biệt trang đã cache sẵn hay vừa đọc từ đĩa lên.",
    threshold: "Không có ngưỡng tuyệt đối — so sánh giữa các lần chạy cùng query. Tăng đột biến bất thường cần điều tra.",
    impact: "Tăng CPU, gây áp lực buffer pool và giảm concurrency của toàn server.",
  },
  physical_reads: {
    term: "Physical Reads",
    definition: "Số lần đọc trang từ đĩa vào buffer pool. Xảy ra khi trang chưa được cache trong bộ nhớ.",
    threshold: "Sau khi cache warm-up, lý tưởng gần 0. Cao liên tục = buffer pool không đủ lớn.",
    impact: "Tăng độ trễ I/O đáng kể so với logical reads — đĩa chậm hơn RAM nhiều lần.",
  },
  read_ahead: {
    term: "Read Ahead (RA)",
    definition: "SQL Server tự động đọc trước các trang dự đoán sẽ cần trong lần scan tiếp theo.",
    threshold: "Bình thường với scan lớn. Rất cao trên index seek nhỏ là bất thường.",
    impact: "Tăng I/O tổng nhưng giảm latency nếu dự đoán đúng.",
  },
  scan_count: {
    term: "Scan Count",
    definition: "Số lần operator được thực thi. Với Nested Loops, bằng số lần inner table bị quét lại.",
    threshold: "Cao với inner input của Nested Loops = chi phí nhân lên theo số rows outer.",
    impact: "Là hệ số nhân cho mọi chi phí I/O phía inner input.",
  },

  // ── Row Estimation ────────────────────────────────────────────────────────
  estimated_rows: {
    term: "Estimated Rows",
    definition: "Số hàng optimizer ước lượng sẽ đi qua operator, dựa trên statistics.",
    threshold: "Lệch ≥ 10× so với actual rows là cảnh báo cần chú ý.",
    impact: "Estimate sai dẫn tới chọn join algorithm sai, memory grant sai và plan kém hiệu quả.",
  },
  actual_rows: {
    term: "Actual Rows",
    definition: "Số hàng thực tế xử lý lúc runtime. Chỉ có trong Actual Execution Plan.",
    threshold: "Dùng để so với estimated rows phát hiện cardinality mismatch.",
    impact: "Sai lệch lớn = optimizer đã dùng thông tin sai để build plan.",
  },
  row_est_ratio: {
    term: "Row Estimate Ratio",
    definition: "+N× = actual nhiều hơn estimate N lần (under-estimate). ÷N× = actual ít hơn N lần (over-estimate).",
    threshold: "≥ 10× hoặc ≤ 0.1× là đáng lo. ≥ 100× là nghiêm trọng.",
    impact: "Under-estimate thường dẫn tới Hash/Sort spill. Over-estimate dẫn tới memory overgrant.",
    formula: "actual_rows / estimated_rows",
  },

  // ── Memory ────────────────────────────────────────────────────────────────
  memory_grant: {
    term: "Memory Grant",
    definition: "Workspace memory được cấp phát trước khi query chạy, dùng cho Sort và Hash operations.",
    threshold: "Used ≥ 90% = nguy cơ spill xuống TempDB. Used < 20% = overgrant lãng phí.",
    impact: "Ảnh hưởng trực tiếp tốc độ query và khả năng chạy đồng thời nhiều query.",
    formula: "max_used_kb / granted_kb × 100%",
  },
  spill_to_tempdb: {
    term: "Spill to TempDB",
    definition: "Sort hoặc Hash tràn dữ liệu xuống TempDB do không đủ memory grant.",
    threshold: "Bất kỳ spill nào cũng cần theo dõi và xử lý.",
    impact: "Tăng I/O TempDB đáng kể, làm chậm query từ 10× đến 100×.",
  },
  resource_semaphore: {
    term: "RESOURCE_SEMAPHORE",
    definition: "Query đang chờ được cấp memory grant. Xảy ra khi server đã dùng hết workspace memory.",
    threshold: "Bất kỳ wait nào > 100ms là vấn đề.",
    impact: "Các query block lẫn nhau chờ memory, throughput giảm mạnh.",
  },

  // ── Index ─────────────────────────────────────────────────────────────────
  key_lookup: {
    term: "Key Lookup",
    definition: "Sau khi tìm row qua nonclustered index, SQL Server phải quay lại clustered index để lấy thêm cột không có trong nonclustered index.",
    threshold: "Số rows lookup × 2 logical reads per row. Nhiều rows = rất đắt.",
    impact: "Tăng logical reads và random I/O. Fix bằng cách INCLUDE thêm cột vào index.",
  },
  index_seek: {
    term: "Index Seek",
    definition: "Tìm kiếm có chọn lọc trong B-tree index theo predicate. Chỉ duyệt các trang cần thiết.",
    threshold: "Luôn tốt hơn scan khi selectivity cao.",
    impact: "I/O tối thiểu — operator lý tưởng nhất cho point query hoặc range query chọn lọc cao.",
  },
  index_scan: {
    term: "Index Scan",
    definition: "Đọc toàn bộ hoặc phần lớn index. Xảy ra khi không có predicate phù hợp hoặc selectivity thấp.",
    threshold: "Kết hợp Filter sau Scan thường chỉ ra predicate chưa được pushdown.",
    impact: "I/O cao, tăng áp lực buffer pool.",
  },

  // ── Join & Operators ──────────────────────────────────────────────────────
  hash_match: {
    term: "Hash Match",
    definition: "Join hoặc GROUP BY dùng hash table. Build phase tạo hash từ input nhỏ hơn, Probe phase quét input lớn hơn.",
    threshold: "Cần memory grant. Estimate sai có thể gây spill TempDB.",
    impact: "CPU cao hơn Nested Loops. Cân nhắc thêm index trên cột join.",
  },
  sort_op: {
    term: "Sort Operator",
    definition: "Sắp xếp dữ liệu cho ORDER BY, GROUP BY hoặc chuẩn bị cho Merge Join / Stream Aggregate.",
    threshold: "Cost cao = dữ liệu chưa có thứ tự sẵn. Index theo cột ORDER BY loại bỏ Sort.",
    impact: "CPU cao, cần memory grant, có thể spill xuống TempDB.",
  },
  parallelism_op: {
    term: "Parallelism (Exchange)",
    definition: "Operator phân phối hoặc thu thập data giữa các thread CPU — Repartition, Distribute, Gather Streams.",
    threshold: "Quá nhiều exchange operators = overhead synchronization tăng.",
    impact: "Cần thiết cho parallel plan nhưng có chi phí phối hợp giữa các thread.",
  },

  // ── Statistics ────────────────────────────────────────────────────────────
  statistics_modification_count: {
    term: "Statistics Modification Count",
    definition: "Số lần dữ liệu thay đổi (INSERT/UPDATE/DELETE) kể từ lần UPDATE STATISTICS gần nhất.",
    threshold: "Mặc định auto-update khi > 20% rows thay đổi. Bảng lớn nên manual update thường xuyên hơn.",
    impact: "Stats stale → cardinality estimate sai → plan kém.",
  },
  sampling_percent: {
    term: "Sampling Percent",
    definition: "Tỷ lệ phần trăm dữ liệu được sample khi cập nhật statistics.",
    threshold: "< 20% có thể không đại diện cho phân phối dữ liệu thực. FULLSCAN = 100%.",
    impact: "Sample thấp → histogram không chính xác → estimate sai.",
  },
  row_underestimate: {
    term: "Row Under-Estimate",
    definition: "Optimizer ước lượng ít hàng hơn thực tế → cấp memory grant nhỏ → Hash/Sort có thể spill ra TempDB.",
    threshold: "≥ 10× là warning. ≥ 100× là critical.",
    impact: "Spill TempDB làm chậm query 10–100×. Thường do stale statistics hoặc parameter sniffing.",
    formula: "ratio = actual_rows / estimated_rows ≥ 10",
  },
  row_overestimate: {
    term: "Row Over-Estimate",
    definition: "Optimizer ước lượng nhiều hàng hơn thực tế → cấp memory grant quá lớn → lãng phí workspace memory.",
    threshold: "≤ 0.1× (actual < 10% estimated) là warning. ≤ 0.01× là critical.",
    impact: "Memory overgrant giữ resource không cần thiết, giảm số query chạy đồng thời.",
    formula: "ratio = actual_rows / estimated_rows ≤ 0.1",
  },
  stale_stats: {
    term: "Stale Statistics",
    definition: "Statistics chưa được cập nhật trong khi dữ liệu đã thay đổi đáng kể.",
    threshold: "Modification count > 10% tổng rows là nên cập nhật.",
    impact: "Cardinality estimate sai dẫn tới plan suboptimal.",
  },

  // ── Parameters ────────────────────────────────────────────────────────────
  parameter_sniffing: {
    term: "Parameter Sniffing",
    definition: "SQL Server compile plan dựa trên giá trị parameter lần đầu tiên chạy. Plan đó được cache và tái dùng cho các giá trị khác.",
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
    definition: "Số thread CPU được dùng để thực thi query song song. DOP = 1 là serial.",
    threshold: "DOP quá cao gây contention giữa các query. DOP quá thấp với query lớn bỏ phí CPU.",
    impact: "DOP không phù hợp làm giảm throughput tổng thể.",
    formula: "Parallel efficiency = (serial_time / parallel_time) / DOP × 100%",
  },
  compile_cpu: {
    term: "Compile CPU",
    definition: "CPU time (ms) dùng để compile và optimize query plan.",
    threshold: "> 1000ms là cao — query phức tạp hoặc thiếu statistics.",
    impact: "Compile nặng tăng latency lần chạy đầu và gây CPU pressure dưới load.",
  },
  compile_memory: {
    term: "Compile Memory",
    definition: "Memory (KB) SQL Server dùng trong quá trình compile plan.",
    threshold: "> 10MB là rất cao — query cực phức tạp hoặc quá nhiều joins.",
    impact: "Compile memory cao cạnh tranh với workspace memory của các query khác.",
  },
  non_parallel_reason: {
    term: "Non-Parallel Plan Reason",
    definition: "Lý do SQL Server không tạo parallel plan: EstimatedDOPIsOne, NoParallelismEstimatedForConstraint, v.v.",
    threshold: "Nếu query lớn mà plan serial, kiểm tra MAXDOP setting và cost threshold for parallelism.",
    impact: "Query lớn chạy serial = không tận dụng được CPU đa lõi.",
  },
  optm_level: {
    term: "Optimization Level",
    definition: "Mức optimizer đã dùng: TRIVIAL (đơn giản, 1 plan rõ ràng) hoặc FULL (cost-based đầy đủ).",
    threshold: "TRIVIAL plan không tối ưu tốt với queries phức tạp.",
    impact: "TRIVIAL = optimizer bỏ qua nhiều plan alternatives.",
  },
  query_hash: {
    term: "Query Hash",
    definition: "Hash đại diện cho cấu trúc query — không phụ thuộc vào giá trị literal. Dùng để group các query tương tự.",
    impact: "Tra cứu trong Plan Cache và Query Store để xem lịch sử execution.",
  },
  plan_hash: {
    term: "Query Plan Hash",
    definition: "Hash đại diện cho shape của execution plan. Khác query_hash khi cùng query có nhiều plans khác nhau.",
    impact: "Dùng để phát hiện plan regression — cùng query nhưng plan đã thay đổi.",
  },

  // ── Lock Wait Types ───────────────────────────────────────────────────────
  lck_m_x: {
    term: "LCK_M_X — Exclusive Lock Wait",
    definition: "Session đang chờ lấy Exclusive lock (X) để ghi. X lock không tương thích với bất kỳ lock nào khác — cả read lẫn write đều bị chặn.",
    threshold: "Bất kỳ wait nào > 5s cần điều tra. Phổ biến nhất trong blocking chain.",
    impact: "Nguyên nhân gây blocking phổ biến nhất. Kiểm tra transaction giữ X lock có đang idle không.",
  },
  lck_m_u: {
    term: "LCK_M_U — Update Lock Wait",
    definition: "Session đang chờ lấy Update lock (U) — đọc để chuẩn bị ghi. U lock tương thích với S nhưng không tương thích với U hoặc X khác.",
    threshold: "Cao = nhiều UPDATE đồng thời trên cùng rows.",
    impact: "Phòng ngừa deadlock giữa các UPDATE. Nếu leo thang thành X thì gây blocking.",
  },
  lck_m_s: {
    term: "LCK_M_S — Shared Lock Wait",
    definition: "Session đang chờ lấy Shared lock (S) để đọc. S lock không tương thích với X hoặc IX.",
    threshold: "Cao = có transaction giữ X lock lâu dài chặn read.",
    impact: "Read bị chặn bởi write transaction đang mở. Kiểm tra transaction giữ X.",
  },
  lck_m_is: {
    term: "LCK_M_IS — Intent Shared Lock Wait",
    definition: "Session đang chờ lấy Intent Shared lock (IS) ở cấp cao hơn (table/page) để báo hiệu sẽ lấy S lock ở cấp dưới.",
    threshold: "Thường wait thời gian ngắn. Cao bất thường = lock escalation đang xảy ra.",
    impact: "Ít nghiêm trọng hơn LCK_M_S. Nếu cao = cơ chế leo thang lock đang kích hoạt.",
  },
  lck_m_ix: {
    term: "LCK_M_IX — Intent Exclusive Lock Wait",
    definition: "Session đang chờ lấy Intent Exclusive lock (IX) ở cấp table/page để báo hiệu sẽ ghi ở cấp row.",
    threshold: "Cao = nhiều writer đồng thời, lock escalation thường xuyên.",
    impact: "Nếu IX leo thang thành X ở cấp table = toàn bộ table bị lock.",
  },
  lck_m_six: {
    term: "LCK_M_SIX — Shared Intent Exclusive Lock Wait",
    definition: "Session đang chờ lấy SIX lock — đọc toàn bộ (S) nhưng sẽ ghi một phần (IX). Không tương thích với hầu hết lock modes.",
    threshold: "Ít gặp. Thường trong trigger hoặc merge statement phức tạp.",
    impact: "Chặn hầu hết concurrent access. Xem xét tách logic đọc/ghi.",
  },
  lck_m_sch_m: {
    term: "LCK_M_SCH_M — Schema Modification Lock Wait",
    definition: "Session đang chờ lấy Schema Modification lock để thay đổi cấu trúc object (ALTER TABLE, DROP INDEX, REBUILD INDEX...).",
    threshold: "Bất kỳ wait nào > 10s = có query dài đang giữ Sch-S lock.",
    impact: "ALTER/REBUILD không thể chạy khi có query đang truy cập table. Cần maintenance window.",
  },
  lck_m_sch_s: {
    term: "LCK_M_SCH_S — Schema Stability Lock Wait",
    definition: "Session đang chờ lấy Schema Stability lock — mọi query đọc/ghi đều cần Sch-S để đảm bảo schema không thay đổi trong lúc chạy.",
    threshold: "Cao khi có DDL (ALTER/REBUILD) đang giữ Sch-M lock.",
    impact: "DDL operation đang block toàn bộ query mới. Hoàn thành DDL càng sớm càng tốt.",
  },
  lck_m_bu: {
    term: "LCK_M_BU — Bulk Update Lock Wait",
    definition: "Session đang chờ lấy Bulk Update lock — dùng cho BULK INSERT hoặc bcp khi TABLOCK được chỉ định.",
    threshold: "Ít gặp ngoài ETL/import scenarios.",
    impact: "BU lock cho phép bulk insert đồng thời nhưng chặn read thông thường.",
  },
  lck_m_rin_nl: {
    term: "LCK_M_RIn_NL — Range Insert Null Lock Wait",
    definition: "Chờ range lock loại Null khi INSERT vào khoảng index — dùng để bảo vệ phantom read trong Serializable isolation.",
    threshold: "Ít gặp. Xuất hiện với Serializable isolation và index range scan đồng thời.",
    impact: "Isolation level Serializable gây lock range rộng hơn. Cân nhắc dùng Snapshot isolation.",
  },
  lck_m_rin_s: {
    term: "LCK_M_RIn_S — Range Insert Shared Lock Wait",
    definition: "Chờ range insert lock với Shared mode trong Serializable isolation.",
    threshold: "Xuất hiện với Serializable + concurrent INSERT/SELECT trên same range.",
    impact: "Xem xét giảm isolation level hoặc thiết kế lại access pattern.",
  },
  lck_m_rin_x: {
    term: "LCK_M_RIn_X — Range Insert Exclusive Lock Wait",
    definition: "Chờ range insert lock với Exclusive mode — gây blocking nặng trong Serializable isolation.",
    threshold: "Cao = nhiều INSERT đồng thời vào cùng key range với Serializable.",
    impact: "Có thể gây deadlock giữa các INSERT. Cân nhắc Snapshot isolation.",
  },
  lck_m_rx_x: {
    term: "LCK_M_RX_X — Range Exclusive Lock Wait",
    definition: "Chờ range lock Exclusive để ngăn phantom read khi xóa hoặc cập nhật key range trong Serializable.",
    threshold: "Cao = DELETE/UPDATE đồng thời trên cùng range với Serializable isolation.",
    impact: "Blocking nặng cho write operations. Xem xét Snapshot isolation.",
  },
  lck_m_rs_s: {
    term: "LCK_M_RS_S — Range Shared Lock Wait",
    definition: "Chờ range lock Shared — đọc một khoảng key trong Serializable isolation.",
    threshold: "Cao = nhiều scan đồng thời trong Serializable.",
    impact: "Ngăn phantom read nhưng giảm concurrency đáng kể.",
  },
  lck_m_rs_u: {
    term: "LCK_M_RS_U — Range Shared-Update Lock Wait",
    definition: "Chờ range lock dạng Shared-Update — đọc khoảng key chuẩn bị cập nhật trong Serializable.",
    threshold: "Ít gặp. Xuất hiện với UPDATE có range predicate trong Serializable.",
    impact: "Kết hợp đặc điểm của S và U trong phạm vi range.",
  },

  // ── Các wait type bổ sung ─────────────────────────────────────────────────
  resource_semaphore_query_compile: {
    term: "RESOURCE_SEMAPHORE_QUERY_COMPILE",
    definition: "Query đang chờ memory để compile plan — xảy ra khi server đang compile quá nhiều query phức tạp đồng thời.",
    threshold: "Xuất hiện = compile memory pressure. Ít phổ biến hơn RESOURCE_SEMAPHORE.",
    impact: "First-execution latency tăng. Xem xét plan caching và giảm ad-hoc query.",
  },
  async_io_completion: {
    term: "ASYNC_IO_COMPLETION",
    definition: "Chờ hoàn thành I/O bất đồng bộ — thường liên quan đến backup, restore hoặc database file operations.",
    threshold: "Cao trong giờ backup = bình thường. Cao thường xuyên = storage I/O là bottleneck.",
    impact: "Ảnh hưởng đến query nếu I/O bandwidth bị backup/restore chiếm dụng.",
  },
  log_rate_governor: {
    term: "LOG_RATE_GOVERNOR",
    definition: "SQL Server đang throttle tốc độ ghi transaction log để kiểm soát log generation rate.",
    threshold: "Xuất hiện = log flush không theo kịp tốc độ write, hoặc trong Azure SQL bị giới hạn tier.",
    impact: "Làm chậm write transaction trực tiếp. Kiểm tra storage log I/O hoặc service tier.",
  },
  sleep: {
    term: "SLEEP",
    definition: "Session đang sleep — thường từ WAITFOR DELAY hoặc thread pool idle.",
    threshold: "Không đáng lo nếu là background process. Đáng lo nếu có nhiều session sleeping với open transaction.",
    impact: "Session sleeping giữ lock = gây blocking. Kiểm tra ứng dụng không commit transaction trước khi sleep.",
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
    definition: "Thread đang chờ thread khác trong parallel plan — exchange synchronization.",
    threshold: "Cao và actual rows lệch nhiều giữa các thread = parallelism không đều.",
    impact: "Tổng elapsed time bị kéo dài bởi thread chậm nhất.",
  },
  pageiolatch_sh: {
    term: "PAGEIOLATCH_SH",
    definition: "Chờ đọc trang từ đĩa vào buffer pool (shared latch). Xảy ra khi physical read.",
    threshold: "Cao = buffer pool không đủ hoặc storage IOPS chậm.",
    impact: "Tăng query latency tỷ lệ thuận với tốc độ đĩa.",
  },
  pageiolatch_ex: {
    term: "PAGEIOLATCH_EX",
    definition: "Chờ ghi trang xuống đĩa (exclusive latch) — checkpoint hoặc dirty page flush.",
    threshold: "Cao = storage write throughput là bottleneck.",
    impact: "Ảnh hưởng nặng đến write-heavy workloads.",
  },
  io_completion: {
    term: "IO_COMPLETION",
    definition: "Chờ hoàn thành I/O không liên quan đến data pages thông thường — thường là TempDB spill hoặc sort.",
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
    impact: "Bottleneck trực tiếp cho mọi write transaction.",
  },
  async_network_io: {
    term: "ASYNC_NETWORK_IO",
    definition: "Server đang chờ client nhận kết quả. Client xử lý chậm hoặc network chậm.",
    threshold: "Cao = vấn đề phía client hoặc network, không phải server.",
    impact: "Query server-side đã xong nhưng phải chờ gửi data đi.",
  },
  latch_ex: {
    term: "LATCH_EX",
    definition: "Chờ non-page latch exclusive — thường trên cấu trúc nội bộ như free space info, allocation pages.",
    threshold: "Cao với INSERT workload = allocation contention (SGAM/PFS pages).",
    impact: "Fix bằng cách dùng multiple data files hoặc trace flag 1118/1117.",
  },
  latch_sh: {
    term: "LATCH_SH",
    definition: "Chờ non-page latch shared. Ít gây contention hơn LATCH_EX.",
    threshold: "Rất cao = cấu trúc nội bộ bị tranh chấp mạnh.",
    impact: "Thường ít nghiêm trọng hơn LATCH_EX.",
  },
  cxconsumer: {
    term: "CXCONSUMER",
    definition: "Consumer thread trong parallel plan đang chờ producer thread cung cấp data. Tách từ CXPACKET kể từ SQL Server 2016 SP2.",
    threshold: "Thường benign. CXCONSUMER >> CXPACKET = producer là bottleneck.",
    impact: "Ít lo ngại hơn CXPACKET. Nếu cao bất thường, xem data skew giữa các thread.",
  },
  memory_allocation_ext: {
    term: "MEMORY_ALLOCATION_EXT",
    definition: "Chờ cấp phát workspace memory cho operator (Sort, Hash Join...) từ memory grant đã được cấp. Xảy ra khi nhiều operator tranh nhau bên trong cùng query.",
    threshold: "Cao = memory grant tuy được cấp nhưng phân phối nội bộ chậm.",
    impact: "Tăng latency cho từng Sort/Hash operator. Cân nhắc tách query hoặc tối ưu plan.",
  },
  reserved_memory_allocation_ext: {
    term: "RESERVED_MEMORY_ALLOCATION_EXT",
    definition: "Chờ cấp phát phần memory đã reserved trong memory grant pool. Liên quan đến batch-mode execution và columnstore.",
    threshold: "Xuất hiện = query đang dùng batch mode hoặc columnstore với memory reservation cao.",
    impact: "Thường nhỏ. Nếu lớn, kiểm tra columnstore segment loading và batch mode memory pressure.",
  },
  pageiolatch_up: {
    term: "PAGEIOLATCH_UP",
    definition: "Chờ update latch trên page đang trong quá trình I/O từ đĩa. Ít phổ biến hơn SH/EX.",
    threshold: "Cao = storage contention khi nhiều process cùng đọc/ghi page.",
    impact: "Tương tự PAGEIOLATCH_SH nhưng cho update operations.",
  },
  pagelatch_sh: {
    term: "PAGELATCH_SH",
    definition: "Chờ shared latch trên page đã nằm trong buffer pool. Xảy ra khi nhiều thread đọc cùng một page trong memory.",
    threshold: "Cao = hot page contention trong memory. Phân biệt với PAGEIOLATCH (có disk I/O).",
    impact: "Thường do index hot spot (last-page insert, identity column). Fix: GUID key, partition.",
  },
  pagelatch_ex: {
    term: "PAGELATCH_EX",
    definition: "Chờ exclusive latch trên page trong buffer pool khi ghi. Phổ biến với concurrent INSERT vào cùng page.",
    threshold: "Cao với identity/sequence INSERT = hot page contention.",
    impact: "Fix: dùng GUID, phân tán INSERT sang nhiều partitions, hoặc fill factor thấp hơn.",
  },
  pagelatch_up: {
    term: "PAGELATCH_UP",
    definition: "Chờ update latch trên page trong buffer pool. Ít phổ biến nhất trong nhóm PAGELATCH.",
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
    threshold: "Thường nhỏ. Cao = có thread rất chậm trong parallel plan.",
    impact: "Gây ra serial bottleneck giữa các giai đoạn parallel.",
  },
  hadr_sync_commit: {
    term: "HADR_SYNC_COMMIT",
    definition: "Primary đang chờ secondary xác nhận đã hardened log (synchronous commit mode trong AlwaysOn AG). Phát sinh ngay khi COMMIT transaction.",
    threshold: "Cao = network latency đến secondary cao hoặc secondary disk I/O chậm.",
    impact: "Tăng trực tiếp commit latency cho mọi write transaction. Fix: network optimization, SSD cho secondary, xem xét async commit.",
  },
  hadr_work_queue: {
    term: "HADR_WORK_QUEUE",
    definition: "AlwaysOn AG background worker đang chờ task mới. Thường là idle-wait bình thường của AG thread pool.",
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
    definition: "Tổng số warning instances trong statement: stale statistics, key lookup, sort đắt, spill, implicit conversion...",
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
    threshold: "> 10% đáng cân nhắc. > 50% nên tạo sớm. > 90% = ưu tiên cao.",
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
    definition: "Tính toán biểu thức scalar theo từng row: hàm tích hợp, CAST/CONVERT, arithmetic, string function.",
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
    impact: "Cần thiết cho parallel plan nhưng có chi phí phối hợp giữa các thread.",
  },
  op_bitmap: {
    term: "Bitmap",
    definition: "Tạo bitmap filter để loại sớm rows không thỏa mãn điều kiện join trước khi gửi sang exchange operator.",
    threshold: "Thường tốt — giảm network/memory giữa các thread.",
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
    impact: "Có thể chuyển Index Seek thành Index Scan. Fix: đảm bảo kiểu dữ liệu khớp nhau.",
  },
  scalar_udf: {
    term: "Scalar UDF",
    definition: "Hàm scalar do user định nghĩa, thực thi riêng lẻ theo từng dòng (row-by-row).",
    threshold: "Có trong query lớn là cảnh báo.",
    impact: "Ngăn parallelism và pushdown optimization. Cân nhắc inline TVF hoặc rewrite.",
  },

  // ── AG Health ─────────────────────────────────────────────────────────────
  log_send_queue_size: {
    term: "Log Send Queue",
    definition: "Số KB log primary chưa gửi hết sang secondary. Queue tăng = primary đang ghi log nhanh hơn tốc độ gửi.",
    threshold: "> 500 KB cảnh báo, > 1000 KB nghiêm trọng.",
    impact: "Primary gửi log chậm hoặc secondary nhận log không kịp — tăng độ trễ đồng bộ.",
    thresholdSource: {
      topicId: "ag_health",
      metricKey: "log_send_queue_size",
      format: (threshold) => formatWarningCriticalThreshold(threshold, "KB"),
    },
  },
  log_send_rate: {
    term: "Log Send Rate",
    definition: "Tốc độ gửi log sang secondary, đơn vị KB/giây.",
    impact: "Tốc độ thấp khi queue đang tắc = network hoặc luồng HADR send đang nghẽn.",
  },
  redo_queue_size: {
    term: "Redo Queue",
    definition: "Số KB log secondary đã nhận nhưng chưa redo xong thành data pages.",
    threshold: "> 1000 KB cảnh báo, > 5000 KB nghiêm trọng.",
    impact: "Readable secondary trả data cũ hơn primary. Failover async có nguy cơ mất thêm giao dịch.",
    thresholdSource: {
      topicId: "ag_redo_secondary",
      metricKey: "redo_queue_size",
      format: (threshold) => formatWarningCriticalThreshold(threshold, "KB"),
    },
  },
  redo_rate: {
    term: "Redo Rate",
    definition: "Tốc độ secondary apply log vào data files, đơn vị KB/giây.",
    impact: "Tốc độ thấp khi redo queue cao = CPU/IO của secondary hoặc read workload đang cản redo.",
  },
  secondary_lag_seconds: {
    term: "Secondary Lag",
    definition: "Số giây secondary đang trễ so với primary — ước lượng RPO khi đọc trên secondary.",
    threshold: "> 30s cảnh báo, > 120s nghiêm trọng.",
    impact: "Read trên secondary thấy dữ liệu cũ. Failover async có thể mất tới gần bằng đó giây giao dịch.",
    thresholdSource: {
      topicId: "ag_redo_secondary",
      metricKey: "redo_lag_ms",
      format: (threshold) => formatWarningCriticalThreshold(threshold, "s", "s", (value) => `${Math.round(value / 1000)}`),
    },
  },
  synchronization_state_desc: {
    term: "Synchronization State",
    definition: "Trạng thái đồng bộ của replica/database: SYNCHRONIZED, SYNCHRONIZING hoặc NOT SYNCHRONIZING.",
    impact: "Cho biết replica đang bám kịp primary hay đang chậm/trục trặc.",
  },
  synchronization_health_desc: {
    term: "Synchronization Health",
    definition: "Đánh giá tổng hợp sức khỏe đồng bộ: HEALTHY, PARTIALLY_HEALTHY hoặc NOT_HEALTHY.",
    impact: "Là summary nhanh nhất để biết replica có an toàn cho failover/đọc hay không.",
  },
  is_suspended: {
    term: "Suspended",
    definition: "Data movement của database replica đang bị dừng (suspend). Khi đó secondary không nhận thêm log.",
    threshold: "1 = nghiêm trọng — cần resume ngay.",
    impact: "Khi suspend, lag sẽ tiếp tục tăng liên tục.",
  },
  suspend_reason_desc: {
    term: "Suspend Reason",
    definition: "Lý do data movement bị suspend: USER (dừng tay), PARTNER (partner cắt kết nối), REDO, RESTART.",
    impact: "Giúp phân biệt suspend do thao tác tay, do partner cắt kết nối hay do lỗi redo/apply pipeline.",
  },
  is_failover_ready: {
    term: "Failover Ready",
    definition: "Replica đã sẵn sàng cho failover an toàn (không mất dữ liệu) hay chưa.",
    threshold: "0 = không sẵn sàng — failover có thể mất dữ liệu.",
    impact: "Quyết định mức độ an toàn khi thực hiện failover.",
  },
  connected_state_desc: {
    term: "Connected State",
    definition: "Trạng thái kết nối giữa replica hiện tại và partner: CONNECTED hoặc DISCONNECTED.",
    threshold: "DISCONNECTED = nghiêm trọng.",
    impact: "Replica mất kết nối thì log không thể chuyển sang, queue sẽ phồng nhanh.",
  },
  operational_state_desc: {
    term: "Operational State",
    definition: "Trạng thái vận hành nội bộ của replica: ONLINE, PENDING hoặc FAILED.",
    impact: "Cho biết replica có thực sự hoạt động bình thường trong pipeline HADR hay không.",
  },
  replica_server_name: {
    term: "Replica Server",
    definition: "Tên SQL Server instance đang giữ replica được ghi nhận trong finding này.",
    impact: "Giúp xác định chính xác replica nào đang có vấn đề trong Availability Group.",
  },
  database_name: {
    term: "Database Name",
    definition: "Tên database thuộc Availability Group mà metric hiện tại áp dụng.",
    impact: "Quan trọng khi một AG chứa nhiều database nhưng chỉ một database bị lag hoặc suspend.",
  },
  role_desc: {
    term: "Replica Role",
    definition: "Vai trò hiện tại của replica: PRIMARY hoặc SECONDARY.",
    impact: "Giúp phân biệt sự cố đang xảy ra ở phía gửi log hay phía nhận và redo log.",
  },
  last_commit_time: {
    term: "Last Commit Time",
    definition: "Mốc thời gian commit gần nhất được ghi nhận từ phía replica liên quan.",
    impact: "Dùng để ước lượng dữ liệu mới nhất đã được commit trước khi lag hoặc ngắt kết nối tăng lên.",
  },
  last_redone_time: {
    term: "Last Redone Time",
    definition: "Mốc thời gian bản ghi log gần nhất đã được redo xong trên secondary.",
    impact: "Nếu quá cũ so với hiện tại hoặc so với last_commit_time, secondary đang chậm apply log.",
  },

  // ── CDC Health ────────────────────────────────────────────────────────────
  run_status: {
    term: "Run Status",
    definition: "Trạng thái chạy của SQL Agent job: 1 = Succeeded, 0 = Failed.",
    threshold: "0 = nghiêm trọng.",
    impact: "CDC job fail làm capture/cleanup ngừng, latency tăng và TempDB có thể phồng.",
  },
  job_name: {
    term: "Job Name",
    definition: "Tên SQL Agent job được kiểm tra, ví dụ CDC capture hoặc cleanup job.",
    impact: "Cho biết chính xác job nào đang fail để đối chiếu với SQL Agent và lịch chạy.",
  },
  run_duration: {
    term: "Run Duration",
    definition: "Thời gian chạy của lần thực thi job gần nhất.",
    impact: "Duration tăng bất thường = job bị kẹt, backlog lớn hoặc thao tác cleanup/capture chậm.",
  },
  message: {
    term: "Message",
    definition: "Thông điệp trạng thái hoặc lỗi trả về từ lần chạy job gần nhất.",
    impact: "Là nguồn thông tin nhanh nhất để thấy lỗi CDC/Agent cụ thể trước khi mở lịch sử job chi tiết.",
  },
  node_name: {
    term: "Node Name",
    definition: "Tên node hoặc SQL instance nơi finding được phát hiện.",
    impact: "Giúp định vị nhanh máy chủ cần kiểm tra khi cùng một AG trải trên nhiều node.",
  },

  // ── Blocking ──────────────────────────────────────────────────────────────
  head_blocker: {
    term: "Head Blocker Session",
    definition: "Session gốc đang giữ lock và gây ra toàn bộ blocking chain. Bản thân không bị chặn bởi session nào khác.",
    threshold: "Bất kỳ head blocker nào tồn tại > 30s cần xem xét.",
    impact: "Đây là session cần xử lý đầu tiên — kill hoặc điều tra transaction đang mở.",
  },
  blocked_session_count: {
    term: "Blocked Session Count",
    definition: "Tổng số session đang bị block trực tiếp hoặc gián tiếp bởi head blocker.",
    threshold: "> 5 sessions là đáng lo. > 20 sessions = sự cố nghiêm trọng.",
    impact: "Số lượng càng lớn, tác động đến throughput hệ thống càng nặng.",
    thresholdSource: {
      topicId: "blocking",
      metricKey: "blocked_session_count",
      format: (threshold) => formatWarningCriticalThreshold(threshold, "sessions", "sessions"),
    },
  },
  chain_depth: {
    term: "Blocking Chain Depth",
    definition: "Số cấp lồng nhau trong chuỗi blocking. Depth = 3 nghĩa là A → B → C → D.",
    threshold: "Depth > 3 cho thấy blocking đang lan truyền sâu.",
    impact: "Depth cao = tác động lan truyền rộng hơn, khó resolve hơn.",
    thresholdSource: {
      topicId: "blocking",
      metricKey: "chain_depth",
      format: (threshold) => formatWarningCriticalThreshold(threshold, "cấp", "cấp"),
    },
  },
  max_wait_sec: {
    term: "Max Wait",
    definition: "Thời gian chờ lâu nhất trong chuỗi blocking, tính bằng giây — từ session bị block lâu nhất.",
    threshold: "> 30s là đáng lo. > 120s = sự cố nghiêm trọng cần xử lý ngay.",
    impact: "Giúp ưu tiên mức nghiêm trọng — wait càng lâu, user càng bị ảnh hưởng.",
    thresholdSource: {
      topicId: "blocking",
      metricKey: "wait_sec",
      format: (threshold) => formatWarningCriticalThreshold(threshold, "s", "s"),
    },
  },
  idle_txn: {
    term: "Idle Transaction",
    definition: "Session đang IDLE (không chạy query) nhưng vẫn giữ open transaction và lock chưa commit.",
    threshold: "Idle transaction > 60s giữ lock là cần điều tra ngay.",
    impact: "Là nguyên nhân phổ biến nhất gây blocking kéo dài. Fix: commit/rollback transaction, hoặc kill session.",
  },
  lock_mode: {
    term: "Lock Mode",
    definition: "Chế độ lock SQL Server đặt trên tài nguyên:\n• X (Exclusive) — ghi độc quyền\n• IX (Intent Exclusive) — chuẩn bị ghi\n• U (Update) — đọc để chuẩn bị ghi\n• S (Shared) — đọc bình thường\n• IS (Intent Shared) — chuẩn bị đọc\n• SIX — shared + intent exclusive",
    threshold: "X và IX gây blocking nặng nhất. S tương thích với S khác nhưng không tương thích với X.",
    impact: "Hiểu lock mode giúp xác định loại thao tác nào đang bị chặn và bởi ai.",
  },

  // ── Deadlock ─────────────────────────────────────────────────────────────
  deadlock_victim: {
    term: "Deadlock Victim",
    definition: "Session bị SQL Server chọn để rollback nhằm phá vỡ deadlock cycle. Thường là session có transaction cost thấp hơn (ít undo work hơn).",
    threshold: "Cùng một query liên tục là victim = cần xem xét lại thứ tự truy cập tài nguyên.",
    impact: "Transaction của victim bị rollback hoàn toàn. Cần retry logic ở tầng application.",
  },
  deadlock_time: {
    term: "Deadlock Time",
    definition: "Thời điểm SQL Server phát hiện và giải quyết deadlock — victim bắt đầu bị rollback từ thời điểm này.",
    impact: "Giúp đối chiếu với error log, application log và workload cùng lúc để tìm query gây ra.",
  },

  // ── TempDB & Memory ───────────────────────────────────────────────────────
  page_life_expectancy: {
    term: "Page Life Expectancy (PLE)",
    definition: "Số giây trung bình một data page tồn tại trong buffer pool (RAM) trước khi bị đẩy ra đĩa. Giá trị càng cao = RAM càng dư dả, SQL Server ít phải đọc đĩa.",
    threshold: "Khuyến nghị: (RAM_GB / 4) × 300. Ví dụ 24 GB RAM → PLE nên ≥ 1800s. Ngưỡng cảnh báo hệ thống: < 1500s, nguy hiểm: < 600s.",
    impact: "PLE thấp = buffer pool liên tục bị churn → mọi query phải đọc đĩa thay vì đọc RAM → tăng PAGEIOLATCH wait, I/O cao, throughput giảm mạnh.",
  },
  numa_node: {
    term: "NUMA Node",
    definition: "Non-Uniform Memory Access: server multi-socket có nhiều CPU socket, mỗi socket có vùng RAM riêng (local memory). SQL Server cấp phát buffer pool riêng cho mỗi NUMA node để tối ưu băng thông memory.",
    threshold: "PLE chênh lệch lớn giữa các node (ví dụ Node 0: 6000s, Node 1: 800s) = workload đang phân bổ không đều hoặc một node đang bị memory pressure cục bộ.",
    impact: "PLE global có thể trông ổn trong khi một NUMA node đang bị churn nặng — cần xem PLE per node để phát hiện.",
  },
  version_store: {
    term: "Version Store",
    definition: "Vùng trong TempDB lưu phiên bản cũ của rows để phục vụ snapshot isolation và Change Data Capture (CDC). Mỗi lần row bị UPDATE/DELETE, bản cũ được ghi vào version store cho đến khi không còn transaction nào cần đọc nó.",
    threshold: "> 500 MB cảnh báo, > 1000 MB nghiêm trọng.",
    impact: "Version store phình to thường do: CDC job fail (không dọn được), snapshot isolation giữ transaction quá lâu, hoặc long-running query dùng READ COMMITTED SNAPSHOT. TempDB đầy sẽ làm lỗi query toàn server.",
  },
  baseline_deviation: {
    term: "Độ lệch so với Baseline",
    definition: "Phần trăm chênh lệch giữa giá trị hiện tại và trung bình lịch sử cùng thứ-và-giờ trong 4 tuần qua. Dương = đang tệ hơn bình thường; âm = đang tốt hơn bình thường.",
    threshold: "Alert khi lệch > 50% so với baseline. Ví dụ PLE bình thường 8000s, hôm nay 3500s → lệch 56% → cảnh báo.",
    impact: "Phát hiện workload bất thường sớm hơn threshold tuyệt đối: server 64GB RAM có thể không bao giờ chạm ngưỡng 1500s nhưng drop từ 10000s xuống 3000s là tín hiệu quan trọng.",
  },
};
