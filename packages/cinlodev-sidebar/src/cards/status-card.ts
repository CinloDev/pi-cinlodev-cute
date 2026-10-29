import cp from "node:child_process";
import path from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { renderBoxCard, type CardTheme } from "../card-frame.ts";

export class SimpleStatusCard implements Component {
	private readonly cwd: string;
	private readonly theme?: CardTheme;
	private branch = "";

	constructor(cwd: string, theme?: CardTheme) {
		this.cwd = cwd;
		this.theme = theme;
		this.readBranch();
	}

	invalidate(): void {
		this.readBranch();
	}

	digest(): string {
		return `${this.branch}`;
	}

	private readBranch(): void {
		try {
			const b = cp.execFileSync("git", ["branch", "--show-current"], {
				cwd: this.cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1000,
			}).trim();
			this.branch = b;
		} catch {
			this.branch = "";
		}
	}

	render(width: number): string[] {
		const projectName = path.basename(this.cwd);
		const body: string[] = [
			`Carpeta: ${projectName}`,
			this.branch ? `Rama: ${this.branch}` : "Sin git activo",
		];
		return renderBoxCard("Status", body, width, this.theme);
	}
}
