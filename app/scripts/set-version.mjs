import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const requested = args.find((value) => !value.startsWith("--"));
const checkOnly = args.includes("--check");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const files = {
  packageJson: path.join(appDir, "package.json"),
  packageLock: path.join(appDir, "package-lock.json"),
  tauriConfig: path.join(appDir, "src-tauri", "tauri.conf.json"),
  cargoToml: path.join(appDir, "src-tauri", "Cargo.toml"),
  cargoLock: path.join(appDir, "src-tauri", "Cargo.lock"),
};

const [packageText, packageLockText, tauriText, cargoToml, cargoLock] = await Promise.all([
  readFile(files.packageJson, "utf8"),
  readFile(files.packageLock, "utf8"),
  readFile(files.tauriConfig, "utf8"),
  readFile(files.cargoToml, "utf8"),
  readFile(files.cargoLock, "utf8"),
]);

const packageJson = JSON.parse(packageText);
const packageLockJson = JSON.parse(packageLockText);
const tauriConfig = JSON.parse(tauriText);

function firstMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`${label}のバージョンを検出できませんでした。`);
  return match[1];
}

const cargoPackagePattern = /(^\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m;
const cargoLockPackagePattern = /(\[\[package\]\]\r?\nname = "app"\r?\nversion = ")([^"]+)(")/;
const versions = {
  "package.json": packageJson.version,
  "package-lock.json": packageLockJson.version,
  "package-lock.json packages[\"\"]": packageLockJson.packages?.[""]?.version,
  "tauri.conf.json": tauriConfig.version,
  "Cargo.toml": firstMatch(cargoToml, /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m, "Cargo.toml"),
  "Cargo.lock": firstMatch(cargoLock, /\[\[package\]\]\r?\nname = "app"\r?\nversion = "([^"]+)"/, "Cargo.lock"),
};

if (checkOnly) {
  const expected = requested || versions["package.json"];
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length > 0) {
    for (const [file, version] of mismatches) console.error(`${file}: ${version ?? "未設定"} (期待値: ${expected})`);
    process.exitCode = 1;
  } else {
    console.log(`全バージョンが${expected}で一致しています。`);
  }
} else {
  if (!requested || !semverPattern.test(requested)) {
    throw new Error("更新先をSemVer形式で指定してください。例: npm run version:set -- 0.2.0");
  }

  packageJson.version = requested;
  packageLockJson.version = requested;
  if (!packageLockJson.packages?.[""]) throw new Error("package-lock.jsonのルートパッケージを検出できませんでした。");
  packageLockJson.packages[""].version = requested;
  tauriConfig.version = requested;

  const nextCargoToml = cargoToml.replace(cargoPackagePattern, `$1${requested}$3`);
  const nextCargoLock = cargoLock.replace(cargoLockPackagePattern, `$1${requested}$3`);

  await Promise.all([
    writeFile(files.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(files.packageLock, `${JSON.stringify(packageLockJson, null, 2)}\n`),
    writeFile(files.tauriConfig, `${JSON.stringify(tauriConfig, null, 2)}\n`),
    writeFile(files.cargoToml, nextCargoToml),
    writeFile(files.cargoLock, nextCargoLock),
  ]);
  console.log(`Local Hubのバージョンを${requested}へ更新しました。`);
}
