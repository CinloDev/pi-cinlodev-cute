import * as fs from "node:fs";
import * as path from "node:path";

export interface TaskManagerSummary {
	total: number;
	completed: number;
	inProgress: number;
	pending: number;
	currentTaskTitle?: string;
}

/**
 * Reads lightweight Task Manager status summary from project if available.
 */
export function getTaskManagerSummary(cwd?: string): TaskManagerSummary | null {
	const workingDir = cwd ?? process.cwd();
	const candidatePaths = [
		path.join(workingDir, ".pi", "task-manager.json"),
		path.join(workingDir, "task-manager.json"),
	];
	for (const p of candidatePaths) {
		if (fs.existsSync(p)) {
			try {
				const raw = fs.readFileSync(p, "utf-8");
				const data = JSON.parse(raw);
				const todos = Array.isArray(data.todos) ? data.todos : [];
				if (todos.length === 0) continue;
				const total = todos.length;
				const completed = todos.filter((t: any) => t.status === "completed" || t.done || t.completed).length;
				const inProgress = todos.filter((t: any) => t.status === "in_progress" || t.status === "running").length;
				const pending = total - completed - inProgress;
				const activeItem = todos.find((t: any) => t.status === "in_progress" || t.status === "running");
				return {
					total,
					completed,
					inProgress,
					pending,
					currentTaskTitle: activeItem?.title || activeItem?.text,
				};
			} catch {}
		}
	}
	return null;
}
