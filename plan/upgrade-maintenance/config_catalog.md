  Plan — Catalog Config CRUD UI

  Phân tích yêu cầu

  CatalogConfig có cấu trúc 3 cấp: Cluster → Database → Schema → (optional) Tables. UI cần cho phép:

  ┌───────────────┬────────────────────────────────────────────┐
  │   Thao tác    │                   Mô tả                    │
  ├───────────────┼────────────────────────────────────────────┤
  │ Add DB        │ Gõ tên database → thêm vào scope           │
  ├───────────────┼────────────────────────────────────────────┤
  │ Add Schema    │ Gõ tên schema → gắn vào DB đã có           │
  ├───────────────┼────────────────────────────────────────────┤
  │ Remove Schema │ Xóa 1 schema khỏi DB                       │
  ├───────────────┼────────────────────────────────────────────┤
  │ Remove DB     │ Xóa toàn bộ DB (kèm confirm nếu có schema) │
  ├───────────────┼────────────────────────────────────────────┤
  │ Save          │ PUT toàn bộ draft lên API                  │
  ├───────────────┼────────────────────────────────────────────┤
  │ Discard       │ Reset draft về server state                │
  └───────────────┴────────────────────────────────────────────┘

  ---
  UI Sketch

  ┌─────────────────────────────────────────────────────────────┐
  │ Configure Scope                                             │
  │ Catalog runner sẽ snapshot các DB/schema dưới đây          │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  Add database entry                                         │
  │  ┌─────────────────────┐  ┌──────────────────┐  ┌──────┐  │
  │  │ Database name        │  │ Schema name      │  │ + Add│  │
  │  └─────────────────────┘  └──────────────────┘  └──────┘  │
  │                                                             │
  ├─────────────────────────────────────────────────────────────┤
  │  Configured scope  (2 databases)                            │
  │                                                             │
  │  ┌─ YourDatabase ─────────────────────────────────────┐    │
  │  │  Schemas:  [dbo ×]  [hr ×]  [sales ×]             │    │
  │  │  ┌──────────────────┐  ┌─────────┐                 │    │
  │  │  │ Schema name      │  │ + Schema│                 │    │
  │  │  └──────────────────┘  └─────────┘                 │    │
  │  │                              [Remove database ×]   │    │
  │  └────────────────────────────────────────────────────┘    │
  │                                                             │
  │  ┌─ Reporting ────────────────────────────────────────┐    │
  │  │  Schemas:  [rpt ×]                                 │    │
  │  │  ...                                               │    │
  │  └────────────────────────────────────────────────────┘    │
  │                                                             │
  ├─────────────────────────────────────────────────────────────┤
  │  ● Unsaved changes                  [Discard]  [Save config]│
  └─────────────────────────────────────────────────────────────┘

  ---
  State Design

  // Draft — client-side editable copy
  const [draft, setDraft] = useState<CatalogConfig | null>(null);

  // Dirty flag — khi draft khác server state
  const isDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(config);
  }, [draft, config]);

  // Add DB form
  const [newDb, setNewDb] = useState("");
  const [newDbSchema, setNewDbSchema] = useState("");

  // Add schema per existing DB
  const [newSchema, setNewSchema] = useState<Record<string, string>>({});
  // key = database_name, value = input text

  ---
  Interaction Flows

  Add DB + Schema (lần đầu hoặc DB mới):
  Nhập "YourDatabase" + "dbo" → [+ Add]
  → Draft thêm { database_name: "YourDatabase", schemas: ["dbo"] }
  → Dirty indicator hiện
  → Input clear

  Add schema vào DB đã có:
  Gõ "hr" vào input trong card "YourDatabase" → Enter hoặc [+ Schema]
  → Draft thêm "hr" vào YourDatabase.schemas

  Remove schema:
  Bấm [×] trên chip "dbo"
  → Draft xóa "dbo" khỏi schemas
  → Nếu schemas còn lại = [] → cảnh báo inline "DB sẽ bị bỏ qua khi chạy catalog"

  Remove DB:
  Bấm [Remove database]
  → Nếu có ≥1 schema → confirm dialog nhỏ
  → Draft xóa toàn bộ DB

  Save:
  [Save config] → loading spinner
  → PUT /api/maintenance/catalog/config (full replace)
  → success toast "Catalog scope saved"
  → isDirty = false

  Discard:
  [Discard] → reset draft = server state

  ---
  UX Rules áp dụng

  ┌────────────────────────────────────────────────────┬─────────────────────────────────┐
  │                        Rule                        │          Áp dụng ở đâu          │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Label trên mỗi input (không dùng placeholder-only) │ DB name / Schema name inputs    │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Loading + disable button khi saving                │ [Save config]                   │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Enter key = submit                                 │ Add DB form + Add schema inline │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Cursor pointer trên chip [×] và nút Remove         │ Schema chips, Remove DB         │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Transition 150–200ms hover                         │ Chip hover, card hover          │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Error feedback gần vị trí lỗi                      │ Input rỗng → inline warning     │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Confirm trước destructive action                   │ Remove DB khi có schemas        │
  ├────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ Dirty indicator rõ ràng                            │ "● Unsaved changes" + footer    │
  └────────────────────────────────────────────────────┴─────────────────────────────────┘

  ---
  Files thay đổi

  ┌────────────────────────────────────────┬──────────────────────────────────────────────────┐
  │                  File                  │                     Thay đổi                     │
  ├────────────────────────────────────────┼──────────────────────────────────────────────────┤
  │ components/maintenance/CatalogView.tsx │ Thay phần "Configure Scope" bằng <ScopeEditor /> │
  ├────────────────────────────────────────┼──────────────────────────────────────────────────┤
  │ components/maintenance/ScopeEditor.tsx │ Mới — toàn bộ CRUD config logic                  │
  └────────────────────────────────────────┴──────────────────────────────────────────────────┘

  Không cần thay đổi:
  - API route (PUT đã đủ)
  - Hook useSaveCatalogConfig (đã đủ)
  - Types (đã đúng)

  ---
  Không implement (out of scope)

  - table_names[] per schema — giữ empty = all tables (đủ cho DBA)
  - Import từ file / bulk paste — không cần
  - Validate tên DB/schema với SQL Server — không có endpoint, không cần

  ---