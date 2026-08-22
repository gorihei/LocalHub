// ②種類ごとに見分けられるアイコン表示。
// app/fileはOSに埋め込まれた実際のアイコン(shortcut_icon)、folderは固有の
// フォルダーアイコン、urlはfavicon(取得できない場合は地球アイコン)を使う。
import { useEffect, useState } from "react";
import { getShortcutIcon, type Shortcut } from "./shortcuts";

function faviconUrl(target: string): string | null {
  try {
    const url = new URL(target);
    return `${url.protocol}//${url.host}/favicon.ico`;
  } catch {
    return null;
  }
}

const FOLDER_SVG = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 6a1 1 0 0 1 1-1h4l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
  </svg>
);

const FILE_SVG = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M6 3h6l3 3v11H6z" />
    <path d="M12 3v3h3" />
  </svg>
);

const GLOBE_SVG = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="10" cy="10" r="7" />
    <path d="M3 10h14M10 3c2.2 2 2.2 12 0 14M10 3c-2.2 2-2.2 12 0 14" />
  </svg>
);

const COMMAND_SVG = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M4 5h12v10H4z" />
    <path d="M6.5 8l2 2-2 2M10.5 12h3" />
  </svg>
);

type Props = { shortcut: Shortcut; size?: number };

export default function ShortcutIcon({ shortcut, size = 26 }: Props) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    setDataUri(null);
    if (shortcut.kind === "app" || shortcut.kind === "file") {
      getShortcutIcon(shortcut.target).then(setDataUri);
    }
  }, [shortcut.kind, shortcut.target]);

  const boxStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: size >= 26 ? 7 : 6,
    background: "var(--surface-raised)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--accent-strong)",
    overflow: "hidden",
    flexShrink: 0,
  };

  if ((shortcut.kind === "app" || shortcut.kind === "file") && dataUri) {
    return (
      <span style={boxStyle}>
        <img src={dataUri} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} />
      </span>
    );
  }

  if (shortcut.kind === "url") {
    const favicon = faviconUrl(shortcut.target);
    if (favicon && !faviconFailed) {
      return (
        <span style={boxStyle}>
          <img
            src={favicon}
            alt=""
            style={{ width: "62%", height: "62%", objectFit: "contain" }}
            onError={() => setFaviconFailed(true)}
          />
        </span>
      );
    }
    return (
      <span style={{ ...boxStyle, "--icon-size": `${size * 0.55}px` } as React.CSSProperties}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "55%", height: "55%" }}>
          {GLOBE_SVG.props.children}
        </svg>
      </span>
    );
  }

  const icon = shortcut.kind === "folder" ? FOLDER_SVG : shortcut.kind === "command" ? COMMAND_SVG : FILE_SVG;

  return (
    <span style={boxStyle}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "55%", height: "55%" }}>
        {icon.props.children}
      </svg>
    </span>
  );
}
