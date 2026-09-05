import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import QRCode from "qrcode";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { textareaStyle } from "./shared";

type PortTestResult = {
  host: string;
  port: number;
  reachable: boolean;
  latencyMs: number | null;
  remoteAddress: string | null;
  error: string | null;
};

export function PortTestTool() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("443");
  const [timeoutMs, setTimeoutMs] = useState("2000");
  const [result, setResult] = useState<PortTestResult | null>(null);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  const run = async () => {
    const numericPort = Number(port);
    const numericTimeout = Number(timeoutMs);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setError("ポート番号は1〜65535で入力してください");
      return;
    }
    setTesting(true);
    setResult(null);
    setError("");
    try {
      setResult(await invoke<PortTestResult>("tcp_port_test", { host, port: numericPort, timeoutMs: numericTimeout }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 120px 140px auto", gap: 8, alignItems: "end" }}>
        <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          ホスト名またはIPアドレス
          <input value={host} onChange={(event) => setHost(event.target.value)} onKeyDown={(event) => event.key === "Enter" && run()} placeholder="example.com" style={{ width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          ポート
          <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} style={{ width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          タイムアウト
          <select value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} style={{ width: "100%", marginTop: 4 }}>
            <option value="500">500ms</option>
            <option value="1000">1秒</option>
            <option value="2000">2秒</option>
            <option value="5000">5秒</option>
            <option value="10000">10秒</option>
          </select>
        </label>
        <button className="btn primary" onClick={run} disabled={testing || !host.trim()}>{testing ? "確認中…" : "疎通確認"}</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {[80, 443, 3000, 5432, 6379, 8080].map((commonPort) => (
          <button key={commonPort} className="btn" onClick={() => setPort(String(commonPort))}>{commonPort}</button>
        ))}
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 14 }}>{error}</div>}
      {result && (
        <div className="panel-card" style={{ padding: 14, marginTop: 14, borderColor: result.reachable ? "var(--success)" : "var(--danger)" }}>
          <div style={{ color: result.reachable ? "var(--success)" : "var(--danger)", fontWeight: 700 }}>
            {result.reachable ? "接続成功" : "接続できません"}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
            対象: {result.host}:{result.port}<br />
            接続先: {result.remoteAddress ?? "-"}<br />
            応答時間: {result.latencyMs === null ? "-" : `${result.latencyMs}ms`}
            {result.error && <><br />詳細: {result.error}</>}
          </div>
        </div>
      )}
    </div>
  );
}

type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export function QrCodeTool() {
  const [input, setInput] = useState("");
  const [size, setSize] = useState(512);
  const [errorCorrectionLevel, setErrorCorrectionLevel] = useState<QrErrorCorrectionLevel>("M");
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    if (!input) {
      setDataUrl("");
      setError("QRコードにするテキストまたはURLを入力してください");
      return;
    }
    try {
      const generated = await QRCode.toDataURL(input, {
        errorCorrectionLevel,
        width: size,
        margin: 4,
        color: { dark: "#000000ff", light: "#ffffffff" },
      });
      setDataUrl(generated);
      setError("");
    } catch (cause) {
      setDataUrl("");
      setError(`QRコードを生成できませんでした: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const download = async () => {
    if (!dataUrl || saving) return;
    const destination = await save({
      defaultPath: "qrcode.png",
      filters: [{ name: "PNG画像", extensions: ["png"] }],
    });
    if (!destination) return;

    setSaving(true);
    setError("");
    try {
      const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      await writeFile(destination, bytes);
    } catch (cause) {
      setError(`PNGの保存に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>テキストまたはURL</label>
      <textarea
        style={{ ...textareaStyle, minHeight: 110 }}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="https://example.com"
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 0 14px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          誤り訂正
          <select value={errorCorrectionLevel} onChange={(event) => setErrorCorrectionLevel(event.target.value as QrErrorCorrectionLevel)}>
            <option value="L">L（約7%）</option>
            <option value="M">M（約15%）</option>
            <option value="Q">Q（約25%）</option>
            <option value="H">H（約30%）</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          PNGサイズ
          <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
            {[256, 512, 1024].map((value) => <option key={value} value={value}>{value}×{value}px</option>)}
          </select>
        </label>
        <button className="btn primary" onClick={generate} disabled={!input}>
          QRコードを生成
        </button>
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div
        style={{
          minHeight: 300,
          display: "grid",
          placeItems: "center",
          padding: 18,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-s)",
          background: "#fff",
        }}
      >
        {dataUrl ? (
          <img src={dataUrl} alt="生成したQRコード" style={{ width: "min(100%, 320px)", imageRendering: "pixelated" }} />
        ) : (
          <span style={{ color: "#707070", fontSize: 12 }}>生成したQRコードがここに表示されます</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="btn" onClick={download} disabled={!dataUrl || saving}>
          {saving ? "保存中…" : "PNGを保存"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>入力内容は外部へ送信されません</span>
      </div>
    </div>
  );
}

export function BackgroundRemovalTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inputUrl, setInputUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("画像を選択してください");
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (inputUrl) URL.revokeObjectURL(inputUrl);
  }, [inputUrl]);

  useEffect(() => () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }, [outputUrl]);

  const selectFile = (nextFile: File | undefined) => {
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) {
      setError("画像ファイルを選択してください");
      return;
    }

    if (inputUrl) URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(nextFile);
    setInputUrl(URL.createObjectURL(nextFile));
    setOutputUrl("");
    setOutputBlob(null);
    setProgress(0);
    setStatus("処理を開始できます");
    setError("");
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files[0]);
  };

  const removeImageBackground = async () => {
    if (!file || processing) return;
    setProcessing(true);
    setProgress(0);
    setError("");
    setStatus("AIモデルを準備しています…");

    try {
      // 重いONNXランタイムを、機能が実行されるまでメインバンドルへ読み込まない。
      const { removeBackground } = await import("@imgly/background-removal");
      const result = await removeBackground(file, {
        model: "isnet_quint8",
        device: "cpu",
        output: { format: "image/png", quality: 1, type: "foreground" },
        progress: (_key, current, total) => {
          if (total > 0) setProgress(Math.min(100, Math.round((current / total) * 100)));
          setStatus("AIモデルをダウンロードしています…");
        },
      });

      if (outputUrl) URL.revokeObjectURL(outputUrl);
      setOutputBlob(result);
      setOutputUrl(URL.createObjectURL(result));
      setProgress(100);
      setStatus("背景透過が完了しました");
    } catch (cause) {
      setError(`背景透過に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
      setStatus("処理に失敗しました");
    } finally {
      setProcessing(false);
    }
  };

  const download = async () => {
    if (!outputBlob || !file || saving) return;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const destination = await save({
      defaultPath: `${baseName}-transparent.png`,
      filters: [{ name: "PNG画像", extensions: ["png"] }],
    });
    if (!destination) return;

    setSaving(true);
    setError("");
    setStatus("PNGを保存しています…");
    try {
      await writeFile(destination, new Uint8Array(await outputBlob.arrayBuffer()));
      setStatus(`PNGを保存しました: ${destination}`);
    } catch (cause) {
      setError(`PNGの保存に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
      setStatus("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-card background-removal-tool">
      <div>
        <h2>画像背景透過</h2>
        <p className="background-removal-note">
          画像は端末内で処理され、外部へ送信されません。初回のみAIモデル（約40MB）をIMG.LYからダウンロードします。
        </p>
      </div>

      <label className="background-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <input type="file" accept="image/*" onChange={onFileChange} disabled={processing} />
        <span>{file ? file.name : "画像を選択、またはここへドロップ"}</span>
        <small>PNG、JPEG、WebPなど</small>
      </label>

      {(inputUrl || outputUrl) && (
        <div className="background-preview-grid">
          <figure>
            <figcaption>元画像</figcaption>
            {inputUrl && <img src={inputUrl} alt="背景透過前" />}
          </figure>
          <figure className="transparent-preview">
            <figcaption>透過結果</figcaption>
            {outputUrl ? <img src={outputUrl} alt="背景透過後" /> : <div className="background-preview-empty">処理後の画像が表示されます</div>}
          </figure>
        </div>
      )}

      <div className="background-removal-actions">
        <button className="btn primary" onClick={removeImageBackground} disabled={!file || processing}>
          {processing ? "処理中…" : "背景を透過する"}
        </button>
        <button className="btn" onClick={download} disabled={!outputBlob || processing || saving}>
          {saving ? "保存中…" : "PNGを保存"}
        </button>
        <span>{status}</span>
      </div>

      {processing && <progress className="background-removal-progress" max={100} value={progress} />}
      {error && <div className="background-removal-error">{error}</div>}
    </div>
  );
}


