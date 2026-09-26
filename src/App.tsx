import { useEffect, useMemo, useState } from "react";
import "./styles.css";

const STORAGE_KEY = "hxwl-05-water-ledger-v1";

const METRICS = [
  { key: "ph", label: "pH", unit: "" },
  { key: "ammonia", label: "氨氮", unit: "mg/L" },
  { key: "nitrite", label: "亚硝酸盐", unit: "mg/L" },
  { key: "nitrate", label: "硝酸盐", unit: "mg/L" },
  { key: "hardness", label: "硬度", unit: "°dH" },
  { key: "temperature", label: "温度", unit: "°C" },
  { key: "waterChange", label: "换水量", unit: "%" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];
type MetricValues = Record<MetricKey, number | null>;

interface Tank {
  id: string;
  name: string;
  createdAt: number;
}

interface Reading {
  id: string;
  tankId: string;
  time: number;
  values: MetricValues;
}

interface LedgerState {
  tanks: Tank[];
  readings: Reading[];
  selectedTankId: string | null;
}

// 异常限值：氨氮 > 0.5，亚硝酸盐 > 0.2
const THRESHOLDS: ReadonlyArray<{ key: MetricKey; limit: number }> = [
  { key: "ammonia", limit: 0.5 },
  { key: "nitrite", limit: 0.2 },
];

const metricMeta = (key: MetricKey) => METRICS.find((m) => m.key === key)!;

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyValues(): MetricValues {
  return {
    ph: null,
    ammonia: null,
    nitrite: null,
    nitrate: null,
    hardness: null,
    temperature: null,
    waterChange: null,
  };
}

function emptyStrings(): Record<MetricKey, string> {
  return {
    ph: "",
    ammonia: "",
    nitrite: "",
    nitrate: "",
    hardness: "",
    temperature: "",
    waterChange: "",
  };
}

function defaultState(): LedgerState {
  const tank: Tank = { id: uid(), name: "草缸A", createdAt: Date.now() };
  return { tanks: [tank], readings: [], selectedTankId: tank.id };
}

function loadState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<LedgerState>;
    const tanks: Tank[] = Array.isArray(parsed.tanks)
      ? parsed.tanks.filter(
          (t): t is Tank =>
            !!t && typeof t.id === "string" && typeof t.name === "string"
        )
      : [];
    const readings: Reading[] = Array.isArray(parsed.readings)
      ? parsed.readings
          .filter(
            (r): r is Reading =>
              !!r &&
              typeof r.id === "string" &&
              typeof r.tankId === "string" &&
              typeof r.time === "number" &&
              !!r.values
          )
          .map((r) => {
            // 只保留合法数值，其余字段补空
            const values = emptyValues();
            for (const m of METRICS) {
              const v = (r.values as Record<string, unknown>)[m.key];
              values[m.key] =
                typeof v === "number" && Number.isFinite(v) ? v : null;
            }
            return { id: r.id, tankId: r.tankId, time: r.time, values };
          })
      : [];
    if (tanks.length === 0) return defaultState();
    const selectedTankId = tanks.some((t) => t.id === parsed.selectedTankId)
      ? (parsed.selectedTankId as string)
      : tanks[0].id;
    return { tanks, readings, selectedTankId };
  } catch {
    return defaultState();
  }
}

// 最新状态只认时间较晚的一条；时间相同时，后录入的一条为准
function pickLatest(readings: Reading[]): Reading | undefined {
  let latest: Reading | undefined;
  for (const reading of readings) {
    if (!latest || reading.time >= latest.time) latest = reading;
  }
  return latest;
}

interface Exceeded {
  key: MetricKey;
  label: string;
  unit: string;
  value: number;
  limit: number;
}

function findExceeded(reading: Reading | undefined): Exceeded[] {
  if (!reading) return [];
  const result: Exceeded[] = [];
  for (const threshold of THRESHOLDS) {
    const value = reading.values[threshold.key];
    if (value !== null && value > threshold.limit) {
      const meta = metricMeta(threshold.key);
      result.push({
        key: threshold.key,
        label: meta.label,
        unit: meta.unit,
        value,
        limit: threshold.limit,
      });
    }
  }
  return result;
}

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatTime = (time: number) => timeFormatter.format(new Date(time));

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface TankPanelProps {
  tanks: Tank[];
  selectedId: string | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
}

function TankPanel({
  tanks,
  selectedId,
  counts,
  onSelect,
  onAdd,
  onRename,
}: TankPanelProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const submitAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    onAdd(name);
    setNewName("");
  };

  const submitRename = (id: string) => {
    const name = editingName.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  };

  return (
    <>
      <div className="tank-list">
        {tanks.map((tank) => {
          const isActive = tank.id === selectedId;
          return (
            <div
              key={tank.id}
              className={"tank-item" + (isActive ? " active" : "")}
            >
              {editingId === tank.id ? (
                <input
                  className="rename-input"
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitRename(tank.id);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="tank-select"
                  onClick={() => onSelect(tank.id)}
                >
                  <span className="tank-name">{tank.name}</span>
                  <span className="tank-count">{counts[tank.id] ?? 0} 次</span>
                </button>
              )}
              {editingId === tank.id ? (
                <div className="tank-actions">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => submitRename(tank.id)}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => setEditingId(null)}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => {
                    setEditingId(tank.id);
                    setEditingName(tank.name);
                  }}
                >
                  改名
                </button>
              )}
            </div>
          );
        })}
      </div>
      <form className="add-tank" onSubmit={submitAdd}>
        <input
          placeholder="新鱼缸名称，如 海缸B"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" className="primary-action">
          新增鱼缸
        </button>
      </form>
    </>
  );
}

interface ReadingFormProps {
  tankName: string;
  onSubmit: (values: MetricValues, time: number) => void;
}

function ReadingForm({ tankName, onSubmit }: ReadingFormProps) {
  const [time, setTime] = useState(() => toLocalInputValue(new Date()));
  const [fields, setFields] = useState<Record<MetricKey, string>>(emptyStrings);
  const [error, setError] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const values = emptyValues();
    let hasAny = false;
    for (const metric of METRICS) {
      const raw = fields[metric.key].trim();
      if (raw === "") continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        setError(`「${metric.label}」需要填写数字`);
        return;
      }
      values[metric.key] = num;
      hasAny = true;
    }
    if (!hasAny) {
      setError("请至少填写一项检测指标");
      return;
    }
    const timestamp = new Date(time).getTime();
    if (!Number.isFinite(timestamp)) {
      setError("请选择检测时间");
      return;
    }
    onSubmit(values, timestamp);
    setFields(emptyStrings());
    setTime(toLocalInputValue(new Date()));
    setError("");
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="field-grid">
        <label className="time-field">
          <span>检测时间</span>
          <input
            type="datetime-local"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />
        </label>
        {METRICS.map((metric) => (
          <label key={metric.key}>
            <span>
              {metric.label}
              {metric.unit ? `（${metric.unit}）` : ""}
            </span>
            <input
              type="number"
              step="any"
              inputMode="decimal"
              placeholder={"填写" + metric.label}
              value={fields[metric.key]}
              onChange={(event) =>
                setFields((prev) => ({
                  ...prev,
                  [metric.key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary-action">
          保存到「{tankName}」
        </button>
        <span className="hint">
          同一天可重复检测，记录都会保留；最新状态以时间较晚的一条为准。
        </span>
      </div>
    </form>
  );
}

interface ReadingCardProps {
  reading: Reading;
  isLatest: boolean;
}

function ReadingCard({ reading, isLatest }: ReadingCardProps) {
  const exceeded = findExceeded(reading);
  const exceededKeys = new Set(exceeded.map((item) => item.key));
  const filled = METRICS.filter((metric) => reading.values[metric.key] !== null);

  return (
    <article className={"record-card" + (exceeded.length ? " danger" : "")}>
      <div className="record-time">
        <strong>{formatTime(reading.time)}</strong>
        <div className="record-badges">
          {isLatest && <span className="badge badge-latest">最新状态</span>}
          {exceeded.length > 0 && (
            <span className="badge badge-danger">
              异常：{exceeded.map((item) => item.label).join("、")}
            </span>
          )}
        </div>
      </div>
      <div className="record-values">
        {filled.length === 0 ? (
          <span className="empty">该条记录没有填写指标</span>
        ) : (
          filled.map((metric) => {
            const value = reading.values[metric.key];
            return (
              <span
                key={metric.key}
                className={
                  "value-chip" +
                  (exceededKeys.has(metric.key) ? " bad" : "")
                }
              >
                <em>{metric.label}</em>
                <strong>
                  {value}
                  {metric.unit ? ` ${metric.unit}` : ""}
                </strong>
              </span>
            );
          })
        )}
      </div>
    </article>
  );
}

function App() {
  const [state, setState] = useState<LedgerState>(loadState);

  // 数据保存在本机，重新打开仍能看到
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时保留内存中的数据，不影响本次使用
    }
  }, [state]);

  const selectedTank =
    state.tanks.find((tank) => tank.id === state.selectedTankId) ??
    state.tanks[0] ??
    null;

  const tankReadings = useMemo(
    () =>
      selectedTank
        ? state.readings.filter((reading) => reading.tankId === selectedTank.id)
        : [],
    [state.readings, selectedTank]
  );

  // 最新状态：只取时间最晚的一条，旧记录不会盖回
  const latest = useMemo(() => pickLatest(tankReadings), [tankReadings]);
  const exceeded = useMemo(() => findExceeded(latest), [latest]);

  const sortedReadings = useMemo(
    () =>
      tankReadings
        .map((reading, index) => ({ reading, index }))
        .sort(
          (a, b) =>
            b.reading.time - a.reading.time || b.index - a.index
        ),
    [tankReadings]
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const reading of state.readings) {
      map[reading.tankId] = (map[reading.tankId] ?? 0) + 1;
    }
    return map;
  }, [state.readings]);

  const addTank = (name: string) => {
    const tank: Tank = { id: uid(), name, createdAt: Date.now() };
    setState((prev) => ({
      ...prev,
      tanks: [...prev.tanks, tank],
      selectedTankId: tank.id,
    }));
  };

  const renameTank = (id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      tanks: prev.tanks.map((tank) =>
        tank.id === id ? { ...tank, name } : tank
      ),
    }));
  };

  const selectTank = (id: string) => {
    setState((prev) => ({ ...prev, selectedTankId: id }));
  };

  const addReading = (values: MetricValues, time: number) => {
    if (!selectedTank) return;
    const reading: Reading = {
      id: uid(),
      tankId: selectedTank.id,
      time,
      values,
    };
    setState((prev) => ({ ...prev, readings: [...prev.readings, reading] }));
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-05 · 水质台账</p>
          <h1>水族箱水质监测台账</h1>
          <p className="subtitle">
            按鱼缸录入每日检测指标，记录保存在本机，重新打开仍可查看。
          </p>
        </div>
        <div className="stack-card">
          <span>当前鱼缸</span>
          <strong>{selectedTank ? selectedTank.name : "尚未建立鱼缸"}</strong>
          <span>
            {selectedTank
              ? `共 ${tankReadings.length} 次检测 · 最新 ${
                  latest ? formatTime(latest.time) : "暂无"
                }`
              : "请先新增一个鱼缸"}
          </span>
        </div>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>鱼缸列表</h2>
          <TankPanel
            tanks={state.tanks}
            selectedId={selectedTank?.id ?? null}
            counts={counts}
            onSelect={selectTank}
            onAdd={addTank}
            onRename={renameTank}
          />
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>录入检测</p>
              <h2>
                {selectedTank
                  ? `为「${selectedTank.name}」新增记录`
                  : "新增记录"}
              </h2>
            </div>
          </div>
          {selectedTank ? (
            <ReadingForm
              tankName={selectedTank.name}
              onSubmit={addReading}
            />
          ) : (
            <p className="empty">请先在左侧新增鱼缸。</p>
          )}
        </section>
      </section>

      {selectedTank && latest && exceeded.length > 0 && (
        <section className="alert-panel">
          <h2>⚠ 异常提醒 · {selectedTank.name}</h2>
          <p>
            最新检测（{formatTime(latest.time)}）有 {exceeded.length}{" "}
            项指标超过安全限值：
          </p>
          <ul>
            {exceeded.map((item) => (
              <li key={item.key}>
                <strong>{item.label}</strong> 当前 {item.value} {item.unit}
                ，超过限值 {item.limit} {item.unit}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overview panel">
        <div className="section-heading">
          <div>
            <p>最新概览</p>
            <h2>
              {selectedTank ? selectedTank.name : "暂无鱼缸"}
              {latest ? ` · ${formatTime(latest.time)}` : ""}
            </h2>
          </div>
        </div>
        <div className="metrics-grid">
          {METRICS.map((metric) => {
            const value = latest ? latest.values[metric.key] : null;
            const danger = exceeded.some((item) => item.key === metric.key);
            return (
              <article
                key={metric.key}
                className={"metric-card" + (danger ? " danger" : "")}
              >
                <span>
                  {metric.label}
                  {metric.unit ? `（${metric.unit}）` : ""}
                </span>
                <strong>{value === null ? "—" : value}</strong>
                <i
                  className={
                    danger
                      ? "status-danger"
                      : value === null
                        ? "status-watch"
                        : "status-ok"
                  }
                />
              </article>
            );
          })}
        </div>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>检测明细</p>
            <h2>
              {selectedTank
                ? `「${selectedTank.name}」共 ${sortedReadings.length} 条记录`
                : "检测明细"}
            </h2>
          </div>
        </div>
        {sortedReadings.length === 0 ? (
          <p className="empty">暂无检测记录，录入第一条吧。</p>
        ) : (
          <div className="record-list">
            {sortedReadings.map(({ reading }) => (
              <ReadingCard
                key={reading.id}
                reading={reading}
                isLatest={latest?.id === reading.id}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
