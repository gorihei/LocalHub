import { useState } from "react";
import { CopyButton } from "./shared";

const PASSWORD_CHARS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{}",
};

function generatePassword(length: number, useLower: boolean, useUpper: boolean, useDigits: boolean, useSymbols: boolean): string {
  let pool = "";
  if (useLower) pool += PASSWORD_CHARS.lower;
  if (useUpper) pool += PASSWORD_CHARS.upper;
  if (useDigits) pool += PASSWORD_CHARS.digits;
  if (useSymbols) pool += PASSWORD_CHARS.symbols;
  if (!pool) return "";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => pool[b % pool.length]).join("");
}

function passwordStrength(length: number, poolSize: number): { label: string; color: string } {
  const entropyBits = length * Math.log2(Math.max(poolSize, 1));
  if (entropyBits < 40) return { label: "弱い", color: "var(--danger)" };
  if (entropyBits < 70) return { label: "普通", color: "var(--warning)" };
  if (entropyBits < 100) return { label: "強い", color: "var(--success)" };
  return { label: "非常に強い", color: "var(--accent)" };
}

export function PasswordTool() {
  const [length, setLength] = useState(20);
  const [useLower, setUseLower] = useState(true);
  const [useUpper, setUseUpper] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [password, setPassword] = useState(() => generatePassword(20, true, true, true, true));

  const regenerate = () => setPassword(generatePassword(length, useLower, useUpper, useDigits, useSymbols));

  const poolSize =
    (useLower ? PASSWORD_CHARS.lower.length : 0) +
    (useUpper ? PASSWORD_CHARS.upper.length : 0) +
    (useDigits ? PASSWORD_CHARS.digits.length : 0) +
    (useSymbols ? PASSWORD_CHARS.symbols.length : 0);
  const strength = passwordStrength(length, poolSize);

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
        crypto.getRandomValuesによる暗号学的乱数でパスワードを生成します(すべてローカル処理)
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input readOnly value={password} style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 14 }} />
        <CopyButton text={password} />
        <button className="btn" onClick={regenerate}>
          再生成
        </button>
      </div>
      <div style={{ marginBottom: 14, fontSize: 12, color: strength.color, fontWeight: 600 }}>強度: {strength.label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11.5, color: "var(--text-faint)", width: 60 }}>文字数</span>
        <input
          type="range"
          min={6}
          max={64}
          value={length}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLength(v);
            setPassword(generatePassword(v, useLower, useUpper, useDigits, useSymbols));
          }}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, width: 28, textAlign: "right" }}>{length}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {(
          [
            ["英小文字", useLower, setUseLower],
            ["英大文字", useUpper, setUseUpper],
            ["数字", useDigits, setUseDigits],
            ["記号", useSymbols, setUseSymbols],
          ] as [string, boolean, (v: boolean) => void][]
        ).map(([label, checked, setter]) => (
          <label key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                setter(e.target.checked);
                setPassword(
                  generatePassword(
                    length,
                    label === "英小文字" ? e.target.checked : useLower,
                    label === "英大文字" ? e.target.checked : useUpper,
                    label === "数字" ? e.target.checked : useDigits,
                    label === "記号" ? e.target.checked : useSymbols
                  )
                );
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

type UnitCategory = "temperature" | "length" | "weight" | "volume";

const UNIT_DEFS: Record<UnitCategory, { label: string; units: Record<string, number> }> = {
  temperature: { label: "温度", units: {} }, // 個別処理(線形変換ではないため下のtemperatureConvertで扱う)
  length: {
    label: "長さ",
    units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.344, yard: 0.9144, ft: 0.3048, inch: 0.0254 },
  },
  weight: { label: "重量", units: { kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.45359237, oz: 0.028349523125 } },
  volume: { label: "容量", units: { L: 1, mL: 0.001, "m3": 1000, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365 } },
};

const TEMPERATURE_UNITS = ["℃", "℉", "K"] as const;

function temperatureToCelsius(value: number, unit: string): number {
  if (unit === "℃") return value;
  if (unit === "℉") return ((value - 32) * 5) / 9;
  return value - 273.15; // K
}

function celsiusTo(value: number, unit: string): number {
  if (unit === "℃") return value;
  if (unit === "℉") return (value * 9) / 5 + 32;
  return value + 273.15; // K
}

export function UnitTool() {
  const [category, setCategory] = useState<UnitCategory>("length");
  const [fromUnit, setFromUnit] = useState("m");
  const [toUnit, setToUnit] = useState("km");
  const [tempFrom, setTempFrom] = useState<(typeof TEMPERATURE_UNITS)[number]>("℃");
  const [tempTo, setTempTo] = useState<(typeof TEMPERATURE_UNITS)[number]>("℉");
  const [input, setInput] = useState("1");

  const n = parseFloat(input);
  const valid = !Number.isNaN(n);

  let result = "";
  if (valid) {
    if (category === "temperature") {
      result = celsiusTo(temperatureToCelsius(n, tempFrom), tempTo).toFixed(4).replace(/\.?0+$/, "");
    } else {
      const units = UNIT_DEFS[category].units;
      const base = n * units[fromUnit];
      result = (base / units[toUnit]).toPrecision(10).replace(/\.?0+$/, "").replace(/\.?0+e/, "e");
    }
  }

  const categoryUnits = category === "temperature" ? TEMPERATURE_UNITS : Object.keys(UNIT_DEFS[category].units);

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(Object.keys(UNIT_DEFS) as UnitCategory[]).map((c) => (
          <button
            key={c}
            className="btn"
            style={c === category ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => {
              setCategory(c);
              const units = c === "temperature" ? TEMPERATURE_UNITS : Object.keys(UNIT_DEFS[c].units);
              if (c === "temperature") {
                setTempFrom("℃");
                setTempTo("℉");
              } else {
                setFromUnit(units[0]);
                setToUnit(units[1] ?? units[0]);
              }
            }}
          >
            {UNIT_DEFS[c].label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 120, fontFamily: "var(--font-mono)" }} />
        <select
          value={category === "temperature" ? tempFrom : fromUnit}
          onChange={(e) => (category === "temperature" ? setTempFrom(e.target.value as (typeof TEMPERATURE_UNITS)[number]) : setFromUnit(e.target.value))}
        >
          {categoryUnits.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <span style={{ color: "var(--text-faint)" }}>=</span>
        <input readOnly value={valid ? result : "無効な値です"} style={{ width: 160, fontFamily: "var(--font-mono)" }} />
        <select
          value={category === "temperature" ? tempTo : toUnit}
          onChange={(e) => (category === "temperature" ? setTempTo(e.target.value as (typeof TEMPERATURE_UNITS)[number]) : setToUnit(e.target.value))}
        >
          {categoryUnits.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {valid && <CopyButton text={result} />}
      </div>
    </div>
  );
}


