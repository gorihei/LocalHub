// §5.1 下部ステータスバー: ローカル状態、プラグイン処理、エラー等。
type Props = {
  pluginsRunning: number;
  pluginsTotal: number;
  errorCount: number;
};

export default function StatusBar({ pluginsRunning, pluginsTotal, errorCount }: Props) {
  return (
    <footer className="statusbar">
      <div className="status-item">
        <span className="status-dot" />
        ローカルで実行中
      </div>
      <div className="status-item">
        プラグイン {pluginsRunning}/{pluginsTotal} 実行中
      </div>
      <div className="spacer" />
      {errorCount > 0 && (
        <div className="status-item err">
          <span className="status-dot" />
          エラー {errorCount}件
        </div>
      )}
    </footer>
  );
}
