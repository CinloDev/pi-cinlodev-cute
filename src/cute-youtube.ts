/**
 * Interactive YouTube Music Player Card for CUTE Sidebar.
 * Facade module re-exporting from domain modules in src/youtube/ for backwards compatibility.
 */

export {
	YOUTUBE_PLAYER_SYMBOL,
	type ClickableHitbox,
	type YouTubeTrack,
	type YouTubePlayerState,
	cleanTitle,
	cleanArtist,
} from "./youtube/youtube-types.ts";

export {
	getCoverData,
	type CoverData,
} from "./youtube/youtube-cover.ts";

export {
	CinlodevYouTubeCard,
} from "./youtube/youtube-card.ts";
