<!--
  The two brand marks the app draws. They are deliberately not members of ui/Icon: that set
  is one stroke language at one weight, drawn on a 24px grid the app owns, while a brand mark
  is a filled shape belonging to somebody else that nobody may redraw to match. Two surfaces
  show them, the welcome landing and Settings → About, which is why they live in one file
  rather than twice in markup.
-->
<script lang="ts">
	interface Props {
		name: 'github' | 'discord';
		class?: string;
	}

	let { name, class: className = '' }: Props = $props();

	const PATHS: Record<Props['name'], string> = {
		github:
			'M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.73-1.34-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.23-3.17-.12-.3-.53-1.52.12-3.16 0 0 1-.32 3.3 1.21a11.6 11.6 0 0 1 6 0c2.3-1.53 3.3-1.21 3.3-1.21.65 1.64.24 2.86.12 3.16.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.52-5.49 5.81.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56A12.04 12.04 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z',
		discord:
			'M20.317 4.369A19.79 19.79 0 0 0 16.558 3a13.6 13.6 0 0 0-.642 1.317 18.27 18.27 0 0 0-5.834 0A13.2 13.2 0 0 0 9.44 3a19.74 19.74 0 0 0-3.76 1.37C2.31 9.36 1.39 14.22 1.85 19.01a19.9 19.9 0 0 0 6.01 3.04c.49-.66.92-1.36 1.29-2.09-.71-.27-1.39-.6-2.03-.99.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.09 0c.16.13.33.26.5.38-.64.39-1.32.72-2.03.99.37.73.8 1.43 1.29 2.09a19.84 19.84 0 0 0 6.01-3.04c.55-5.55-.94-10.37-3.96-14.64zM8.02 16.05c-1.18 0-2.16-1.08-2.16-2.41 0-1.33.95-2.41 2.16-2.41 1.21 0 2.18 1.09 2.16 2.41 0 1.33-.95 2.41-2.16 2.41zm7.96 0c-1.18 0-2.16-1.08-2.16-2.41 0-1.33.95-2.41 2.16-2.41 1.21 0 2.18 1.09 2.16 2.41 0 1.33-.94 2.41-2.16 2.41z'
	};
</script>

<svg class={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
	<path d={PATHS[name]} />
</svg>
