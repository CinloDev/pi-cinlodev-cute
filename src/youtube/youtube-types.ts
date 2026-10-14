export const YOUTUBE_PLAYER_SYMBOL = Symbol.for("pi-youtube-player");

export interface ClickableHitbox {
	line: number;
	startX: number;
	endX: number;
	action: () => void;
}

export interface YouTubeTrack {
	title?: string;
	artist?: string;
	duration?: string;
	index?: number;
	isCurrent?: boolean;
	thumbnailUrl?: string;
}

export interface YouTubePlayerState {
	status?: "playing" | "paused" | "disconnected" | string;
	platform?: "youtube" | "music" | string;
	title?: string;
	artist?: string;
	currentTime?: number;
	duration?: number;
	volume?: number;
	repeatMode?: "NONE" | "ALL" | "ONE" | string;
	shuffle?: boolean;
	isPip?: boolean;
	connectedClients?: number;
	queue?: YouTubeTrack[];
	thumbnailPath?: string;
	thumbnailBase64?: string;
}

export function cleanTitle(t?: string): string {
	return (t || "")
		.replace(/[\u00A0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, " ")
		.replace(/\s+/g, " ")
		.toLowerCase()
		.trim();
}

export function cleanArtist(artist?: string, title?: string): string {
	if (!artist) return "YouTube Music";
	let clean = artist.trim();
	// Si viene con viñetas "Artista • Canción • Año" o "Artista • Álbum"
	const parts = clean.split(/\s+[•·]\s+/);
	if (parts.length > 1) {
		const curTitle = cleanTitle(title);
		const filtered = parts.filter((part) => {
			const p = cleanTitle(part);
			if (!p) return false;
			if (curTitle && (p === curTitle || curTitle.includes(p) || p.includes(curTitle))) {
				return false;
			}
			return true;
		});
		clean = filtered.length > 0 ? filtered[0] : parts[0];
	}
	return clean.trim() || artist.trim();
}
