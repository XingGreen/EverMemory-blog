export interface StandardizedPlaylist {
	id: string;
	name: string;
	cover: string;
	description: string;
	trackCount: number;
	playCount: number;
	creator?: string;
}