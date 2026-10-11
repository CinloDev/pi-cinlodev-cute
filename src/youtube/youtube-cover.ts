import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { getPngDimensions, allocateImageId } from "@earendil-works/pi-tui";
import type { YouTubePlayerState } from "./youtube-types.ts";

export interface CoverData {
	base64: string;
	dimensions: { widthPx: number; heightPx: number };
	imageId?: number;
}

let cachedPngBase64: string | null = null;
let cachedSourceKey = "";
let currentImageId: number | undefined = undefined;

/**
 * Resuelve y transcodifica la portada del álbum para el protocolo Kitty Graphics en Ghostty.
 * Soporta archivos temporales locales, base64 directo, y convierte JPEG a PNG con caché.
 */
export function getCoverData(state: YouTubePlayerState | any): CoverData | null {
	try {
		let sourceBuf: Buffer | null = null;
		let sourceKey = "";

		const filePath =
			state?.thumbnailPath && typeof state.thumbnailPath === "string" && fs.existsSync(state.thumbnailPath)
				? state.thumbnailPath
				: fs.existsSync("/tmp/pi-yt-current-cover.png")
					? "/tmp/pi-yt-current-cover.png"
					: null;

		if (filePath) {
			const stat = fs.statSync(filePath);
			sourceKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
			if (sourceKey === cachedSourceKey && cachedPngBase64) {
				const dims = getPngDimensions(cachedPngBase64);
				if (dims) return { base64: cachedPngBase64, dimensions: dims, imageId: currentImageId };
			}
			sourceBuf = fs.readFileSync(filePath);
		} else if (state?.thumbnailBase64 && typeof state.thumbnailBase64 === "string" && state.thumbnailBase64.length > 0) {
			sourceKey = state.thumbnailBase64.slice(0, 32);
			if (sourceKey === cachedSourceKey && cachedPngBase64) {
				const dims = getPngDimensions(cachedPngBase64);
				if (dims) return { base64: cachedPngBase64, dimensions: dims, imageId: currentImageId };
			}
			sourceBuf = Buffer.from(state.thumbnailBase64, "base64");
		}

		if (!sourceBuf || sourceBuf.length === 0) return null;

		// Si ya es un PNG válido
		if (sourceBuf[0] === 0x89 && sourceBuf[1] === 0x50) {
			cachedSourceKey = sourceKey;
			cachedPngBase64 = sourceBuf.toString("base64");
			currentImageId = allocateImageId();
			const dims = getPngDimensions(cachedPngBase64);
			return dims ? { base64: cachedPngBase64, dimensions: dims, imageId: currentImageId } : null;
		}

		// Si es JPEG (formato que devuelve YouTube Music), convertir a PNG para Kitty
		const tmpJpeg = "/tmp/pi-yt-raw-cover.jpg";
		const tmpPng = "/tmp/pi-yt-cover-cache.png";
		fs.writeFileSync(tmpJpeg, sourceBuf);

		try {
			execSync(`magick "${tmpJpeg}" -resize 128x128 PNG:"${tmpPng}"`, { timeout: 1000, stdio: "ignore" });
		} catch {
			try {
				execSync(`convert "${tmpJpeg}" -resize 128x128 PNG:"${tmpPng}"`, { timeout: 1000, stdio: "ignore" });
			} catch {
				try {
					execSync(`ffmpeg -y -i "${tmpJpeg}" -vf scale=128:128 "${tmpPng}"`, { timeout: 1000, stdio: "ignore" });
				} catch {}
			}
		}

		if (fs.existsSync(tmpPng)) {
			const pngBuf = fs.readFileSync(tmpPng);
			if (pngBuf[0] === 0x89 && pngBuf[1] === 0x50) {
				cachedSourceKey = sourceKey;
				cachedPngBase64 = pngBuf.toString("base64");
				currentImageId = allocateImageId();
				const dims = getPngDimensions(cachedPngBase64);
				return dims ? { base64: cachedPngBase64, dimensions: dims, imageId: currentImageId } : null;
			}
		}
	} catch {}
	return null;
}
