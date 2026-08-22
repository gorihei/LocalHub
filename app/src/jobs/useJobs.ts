// §6.9 バックグラウンドジョブの進捗・キャンセル。job://progressイベントを
// 購読し、実行中のジョブ一覧を保持する小さなフック。
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { executeCommand } from "../commandBus/commandBus";

export type JobProgress = {
  id: string;
  label: string;
  percent: number;
  done: boolean;
  cancelled: boolean;
};

export function useJobs() {
  const [jobs, setJobs] = useState<Record<string, JobProgress>>({});

  useEffect(() => {
    const unlisten = listen<JobProgress>("job://progress", (event) => {
      const p = event.payload;
      setJobs((prev) => {
        const next = { ...prev, [p.id]: p };
        if (p.done) {
          // 完了/キャンセル後もしばらく結果を見せてから一覧から外す
          setTimeout(() => {
            setJobs((cur) => {
              const { [p.id]: _removed, ...rest } = cur;
              return rest;
            });
          }, 4000);
        }
        return next;
      });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // §12.4: コマンドバス経由(jobs.rescanPlugins)で実行する。
  const rescanPlugins = () => executeCommand<{ jobId: string }>("jobs.rescanPlugins");
  const cancelJob = (id: string) => invoke("job_cancel", { id });

  return { jobs: Object.values(jobs), rescanPlugins, cancelJob };
}
