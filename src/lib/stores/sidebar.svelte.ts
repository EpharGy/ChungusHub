const STORAGE_KEY = 'chungushub-sidebar-collapsed';

class SidebarStore {
	collapsed = $state(false);

	constructor() {
		// Load from localStorage on init
		if (typeof window !== 'undefined') {
			const stored = localStorage.getItem(STORAGE_KEY);
			this.collapsed = stored === 'true';
		}
	}

	toggle() {
		this.collapsed = !this.collapsed;
		this.persist();
	}

	expand() {
		this.collapsed = false;
		this.persist();
	}

	collapse() {
		this.collapsed = true;
		this.persist();
	}

	private persist() {
		if (typeof window !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, String(this.collapsed));
		}
	}
}

export const sidebarStore = new SidebarStore();
