/**
 * Single global portrait viewer. Clicking a message avatar opens the original
 * (full-size) image in a bottom-left panel; clicking the same portrait again
 * (or the close button) dismisses it.
 */
class PortraitViewerStore {
	imagePath = $state<string | null>(null);
	name = $state<string | null>(null);

	isOpen = $derived(this.imagePath !== null);

	toggle(imagePath: string, name: string): void {
		if (this.imagePath === imagePath) {
			this.close();
			return;
		}
		this.imagePath = imagePath;
		this.name = name;
	}

	close(): void {
		this.imagePath = null;
		this.name = null;
	}
}

export const portraitViewerStore = new PortraitViewerStore();
