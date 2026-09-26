import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

/* ---------- 数据模型 ---------- */

type MetricKey =
  | "ph"
  | "ammonia"
  | "nitrite"
  | "nitrate"
  | "hardness"
  | "temperature"
  | "waterChange";

type Reading = Partial<Record<MetricKey, number>>;

interface TestRecord {
  id: string;
  tankId: string;
  /** 检测时间，ISO 字符串；最新状态只认它 */
  testedAt: string;
  /** 录入顺序，检测时间相同时后录入的排前面 */
  createdAt: string;
  reading: Reading;
  note?: string;
}

interface Tank {
  id: string;
  name: string;
  createdAt: string;
}

interface Store {
  tanks: Tank[];
  records: TestRecord[];
  selectedTankId: string | null;
}

/* ---------- 指标与阈值配置 ---------- */

const METRICS: {
  key: MetricKey;
  label: string;
  unit: string;
  step: string;
  placeholder: string;
}[] = [
  { key: "ph", label: "pH", unit: "", step: "0.1", placeholder: "如 6.8" },
  { key: "ammonia", label: "氨氮", unit: "ppm", step: "0.01", placeholder: "如 0.10" },
  { key: "nitrite", label: "亚硝酸盐", unit: "ppm", step: "0.01", placeholder: "如 0.05" },
  { key: "nitrate", label: "硝酸盐", unit: "ppm", step: "1", placeholder: "如 18" },
  { key: "hardness", label: "硬度", unit: "dGH", step: "1", placeholder: "如 8" },
  { key: "temperature", label: "温度", unit: "℃", step: "0.1", placeholder: "如 25.5" },
  { key: "waterChange", label: "换水量", unit: "%", step: "1", placeholder: "如 30" },
];

const METRIC_LABEL: Record<MetricKey, string> = Object.fromEntries(
  METRICS.map((m) => [m.key, m.label]),
) as Record<MetricKey, string>;

/** 超标判断：严格大于阈值才标红 */
const THRESHOLDS: Partial<Record<MetricKey, number>> = {
  ammonia: 0.5,
  nitrite: 0.2,
};

/* ---------- 本地存储 ---------- */

const STORAGE_KEY = "aquarium-ledger-v1";

function uid(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

function defaultStore(): Store {
  const tank: Tank = {
    id: uid(),
    name: "鱼缸 1",
    createdAt: new Date().toISOString(),
  };
  return { tanks: [tank], records: [], selectedTankId: tank.id };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed.tanks) || parsed.tanks.length === 0) {
      return defaultStore();
    }
    if (!parsed.tanks.some((t) => t.id === parsed.selectedTankId)) {
      parsed.selectedTankId = parsed.tanks[0].id;
    }
    if (!Array.isArray(parsed.records)) parsed.records = [];
    return parsed;
  } catch {
    return defaultStore();
  }
}

/* ---------- 工具函数 ---------- */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 转为 datetime-local 所需的本地时间格式 yyyy-MM-ddTHH:mm */
function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate(),
  )} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatValue(value: number | undefined): string {
  if (value === undefined) return "—";
  // 去掉 0.10000000000000009 之类的浮点尾巴
  return String(Math.round(value * 1000) / 1000);
}

function isOverLimit(key: MetricKey, value: number | undefined): boolean {
  const limit = THRESHOLDS[key];
  return limit !== undefined && value !== undefined && value > limit;
}

function abnormalEntries(reading: Reading): [MetricKey, number][] {
  return (Object.keys(THRESHOLDS) as MetricKey[])
    .filter((key) => isOverLimit(key, reading[key]))
    .map((key) => [key, reading[key] as number]);
}

/** 最新状态：只认检测时间较晚的一条；时间相同则后录入的胜出 */
function pickLatest(records: TestRecord[]): TestRecord | null {
  if (records.length === 0) return null;
  return records.reduce((latest, cur) => {
    if (cur.testedAt > latest.testedAt) return cur;
    if (cur.testedAt === latest.testedAt && cur.createdAt > latest.createdAt)
      return cur;
    return latest;
  });
}

/* ---------- 组件 ---------- */

function MetricCard({
  label,
  unit,
  value,
  danger,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  danger: boolean;
}) {
  return (
    <article className={`metric-card${danger ? " metric-danger" : ""}`}>
      <span>{label}</span>
      <strong>
        {formatValue(value)}
        {value !== undefined && unit ? <em>{unit}</em> : null}
      </strong>
      <i className={danger ? "status-danger" : "status-ok"} />
    </article>
  );
}

function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [newTankName, setNewTankName] = useState("");
  const [addingTank, setAddingTank] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // 录入表单
  const now = new Date();
  const [testedAt, setTestedAt] = useState(toLocalInputValue(now));
  const [formValues, setFormValues] = useState<Record<MetricKey, string>>(
    {} as Record<MetricKey, string>,
  );
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const selectedTank =
    store.tanks.find((t) => t.id === store.selectedTankId) ?? store.tanks[0];

  const tankRecords = useMemo(
    () =>
      store.records
        .filter((r) => r.tankId === selectedTank.id)
        .sort((a, b) =>
          b.testedAt === a.testedAt
            ? b.createdAt.localeCompare(a.createdAt)
            : b.testedAt.localeCompare(a.testedAt),
        ),
    [store.records, selectedTank.id],
  );

  const latest = pickLatest(tankRecords);
  const abnormals = latest ? abnormalEntries(latest.reading) : [];

  // 按检测日期分组（同一天重复检测保留为两条）
  const dayGroups = useMemo(() => {
    const groups: { day: string; records: TestRecord[] }[] = [];
    for (const record of tankRecords) {
      const day = formatDay(record.testedAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.records.push(record);
      else groups.push({ day, records: [record] });
    }
    return groups;
  }, [tankRecords]);

  const noticeTimer = useRef<number | undefined>(undefined);
  function flashNotice(text: string) {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2600);
  }

  /* ----- 鱼缸操作 ----- */

  function selectTank(id: string) {
    setStore((s) => ({ ...s, selectedTankId: id }));
  }

  function addTank() {
    const name = newTankName.trim();
    if (!name) return;
    const tank: Tank = {
      id: uid(),
      name,
      createdAt: new Date().toISOString(),
    };
    setStore((s) => ({
      ...s,
      tanks: [...s.tanks, tank],
      selectedTankId: tank.id,
    }));
    setNewTankName("");
    setAddingTank(false);
  }

  function startRename(tank: Tank) {
    setRenamingId(tank.id);
    setRenameValue(tank.name);
  }

  function commitRename() {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    setStore((s) => ({
      ...s,
      tanks: s.tanks.map((t) =>
        t.id === renamingId ? { ...t, name } : t,
      ),
    }));
    setRenamingId(null);
  }

  /* ----- 检测录入 ----- */

  function updateForm(key: MetricKey, raw: string) {
    setFormValues((v) => ({ ...v, [key]: raw }));
  }

  function parseReading(): Reading | null {
    const reading: Reading = {};
    for (const metric of METRICS) {
      const raw = formValues[metric.key]?.trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setFormError(`「${metric.label}」需要填写不小于 0 的数字`);
        return null;
      }
      reading[metric.key] = value;
    }
    if (Object.keys(reading).length === 0) {
      setFormError("请至少填写一项检测指标");
      return null;
    }
    if (!testedAt) {
      setFormError("请选择检测时间");
      return null;
    }
    const ts = new Date(testedAt).getTime();
    if (Number.isNaN(ts)) {
      setFormError("检测时间格式不正确");
      return null;
    }
    setFormError("");
    return reading;
  }

  function submitRecord() {
    const reading = parseReading();
    if (!reading) return;
    const record: TestRecord = {
      id: uid(),
      tankId: selectedTank.id,
      testedAt: new Date(testedAt).toISOString(),
      createdAt: new Date().toISOString(),
      reading,
    };
    setStore((s) => ({ ...s, records: [...s.records, record] }));
    setFormValues({} as Record<MetricKey, string>);
    setTestedAt(toLocalInputValue(new Date()));
    const hits = abnormalEntries(reading);
    flashNotice(
      hits.length > 0
        ? `已保存，但「${hits
            .map(([key]) => METRIC_LABEL[key])
            .join("、")}」超标，请注意换水`
        : "检测记录已保存",
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">鱼缸水质台账 · 本地保存</p>
          <h1>{selectedTank.name}</h1>
          <p className="subtitle">
            按鱼缸录入每日检测数据，最新状态只取检测时间最晚的一条；氨氮 &gt;
            0.5 ppm 或亚硝酸盐 &gt; 0.2 ppm 自动标红提醒。
          </p>
        </div>
        <div className="stack-card">
          <span>本缸记录</span>
          <strong>{tankRecords.length} 次检测</strong>
          <span className="stack-sub">
            {latest
              ? `最新检测：${formatDateTime(latest.testedAt)}`
              : "还没有检测记录"}
          </span>
        </div>
      </section>

      {notice ? (
        <div
          className={`notice-banner${
            abnormals.length > 0 && notice.includes("超标")
              ? " notice-danger"
              : ""
          }`}
        >
          {notice}
        </div>
      ) : null}

      <section className="workspace">
        <aside className="panel narrow">
          <div className="section-heading">
            <h2>我的鱼缸</h2>
          </div>
          <div className="tank-list">
            {store.tanks.map((tank) => {
              const count = store.records.filter(
                (r) => r.tankId === tank.id,
              ).length;
              const active = tank.id === selectedTank.id;
              return (
                <div
                  key={tank.id}
                  className={`tank-row${active ? " tank-active" : ""}`}
                >
                  {renamingId === tank.id ? (
                    <input
                      className="rename-input"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <button
                      className="tank-select"
                      onClick={() => selectTank(tank.id)}
                      title={`查看${tank.name}`}
                    >
                      <span className="tank-name">{tank.name}</span>
                      <span className="tank-count">{count} 次</span>
                    </button>
                  )}
                  {renamingId !== tank.id ? (
                    <button
                      className="rename-btn"
                      title="改名"
                      onClick={() => startRename(tank)}
                    >
                      ✎
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {addingTank ? (
            <div className="add-tank-form">
              <input
                placeholder="输入鱼缸名称"
                value={newTankName}
                autoFocus
                onChange={(e) => setNewTankName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTank();
                  if (e.key === "Escape") {
                    setAddingTank(false);
                    setNewTankName("");
                  }
                }}
              />
              <div className="add-tank-actions">
                <button className="primary-action" onClick={addTank}>
                  确定
                </button>
                <button
                  onClick={() => {
                    setAddingTank(false);
                    setNewTankName("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              className="add-tank-btn"
              onClick={() => setAddingTank(true)}
            >
              + 新增鱼缸
            </button>
          )}
        </aside>

        <section className="panel main-panel">
          <div className="section-heading">
            <div>
              <p>最新状态</p>
              <h2>概览</h2>
            </div>
            {latest ? (
              <span className="latest-time">
                取 {formatDateTime(latest.testedAt)} 的检测
              </span>
            ) : null}
          </div>

          {latest ? (
            <>
              <div className="metrics-grid metrics-grid-ledger">
                {METRICS.map((metric) => (
                  <MetricCard
                    key={metric.key}
                    label={metric.label}
                    unit={metric.unit}
                    value={latest.reading[metric.key]}
                    danger={isOverLimit(metric.key, latest.reading[metric.key])}
                  />
                ))}
              </div>

              <div
                className={`alert-box${
                  abnormals.length > 0 ? " alert-danger" : " alert-ok"
                }`}
              >
                {abnormals.length > 0 ? (
                  <>
                    <strong>异常提醒：</strong>
                    {abnormals.map(([key, value]) => (
                      <span key={key} className="alert-chip">
                        {METRIC_LABEL[key]}{" "}
                        {formatValue(value)}
                        {METRICS.find((m) => m.key === key)?.unit
                          ? " " +
                            METRICS.find((m) => m.key === key)?.unit
                          : ""}{" "}
                        （阈值 {"<="} {THRESHOLDS[key]} ppm）
                      </span>
                    ))}
                    <span className="alert-hint">
                      建议尽快换水并复测，旧检测结果不会覆盖本条状态。
                    </span>
                  </>
                ) : (
                  <>
                    <strong>最新检测全部正常</strong>
                    <span className="alert-hint">
                      氨氮与亚硝酸盐均在安全范围内。
                    </span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="empty-block">
              <p>
                「{selectedTank.name}」还没有检测记录，先在下方录入第一次检测。
              </p>
            </div>
          )}

          <div className="section-heading entry-heading">
            <div>
              <p>检测录入</p>
              <h2>新增检测</h2>
            </div>
          </div>
          <div className="entry-meta">
            <label className="datetime-field">
              <span>检测时间</span>
              <input
                type="datetime-local"
                value={testedAt}
                onChange={(e) => setTestedAt(e.target.value)}
              />
            </label>
            <span className="entry-tip">
              同一天可多次检测，两次都会保留，概览只认时间最晚的一条。
            </span>
          </div>
          <div className="field-grid">
            {METRICS.map((metric) => (
              <label key={metric.key}>
                <span>
                  {metric.label}
                  {metric.unit ? `（${metric.unit}）` : ""}
                  {THRESHOLDS[metric.key] !== undefined ? (
                    <em className="threshold-hint">
                      阈值 ≤ {THRESHOLDS[metric.key]}
                    </em>
                  ) : null}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step={metric.step}
                  placeholder={metric.placeholder}
                  value={formValues[metric.key] ?? ""}
                  onChange={(e) => updateForm(metric.key, e.target.value)}
                />
              </label>
            ))}
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="entry-actions">
            <button className="primary-action" onClick={submitRecord}>
              保存检测记录
            </button>
          </div>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>{selectedTank.name}</p>
            <h2>检测明细</h2>
          </div>
          <span className="record-count">共 {tankRecords.length} 条</span>
        </div>

        {tankRecords.length === 0 ? (
          <div className="empty-block">
            <p>暂无明细，录入检测后会按时间倒序显示在这里。</p>
          </div>
        ) : (
          <div className="record-list">
            {dayGroups.map((group) => (
              <div key={group.day} className="day-group">
                <div className="day-header">{group.day}</div>
                {group.records.map((record) => {
                  const hits = abnormalEntries(record.reading);
                  const isLatest = latest?.id === record.id;
                  return (
                    <article
                      key={record.id}
                      className={`record-card${
                        hits.length > 0 ? " record-danger" : ""
                      }`}
                    >
                      <div className="record-time">
                        <strong>
                          {formatDateTime(record.testedAt).slice(11)}
                        </strong>
                        {isLatest ? (
                          <span className="latest-tag">最新</span>
                        ) : (
                          <span className="history-tag">历史</span>
                        )}
                      </div>
                      <div className="record-body">
                        <div className="reading-grid">
                          {METRICS.filter(
                            (m) => record.reading[m.key] !== undefined,
                          ).map((m) => (
                            <span
                              key={m.key}
                              className={
                                isOverLimit(m.key, record.reading[m.key])
                                  ? "reading-danger"
                                  : ""
                              }
                            >
                              {m.label}
                              <b>
                                {formatValue(record.reading[m.key])}
                                {m.unit}
                              </b>
                            </span>
                          ))}
                        </div>
                        {hits.length > 0 ? (
                          <p className="record-alert">
                            超标指标：
                            {hits
                              .map(([key, value]) => {
                                const metric = METRICS.find(
                                  (m) => m.key === key,
                                );
                                return `${METRIC_LABEL[key]} ${formatValue(value)}${metric?.unit ?? ""}（阈值 ≤ ${THRESHOLDS[key]} ppm）`;
                              })
                              .join("；")}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
