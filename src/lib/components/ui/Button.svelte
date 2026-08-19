<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		children: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		class: className = '',
		disabled = false,
		children,
		...rest
	}: Props = $props();

	const baseStyles = `
		inline-flex items-center justify-center font-ui font-semibold
		transition-all duration-150 ease-out
		focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary
		disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0
	`;

	const variants = {
		primary: 'bg-accent text-on-accent hover:bg-accent-hover shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:-translate-y-px',
		secondary: 'bg-bg-tertiary text-text-primary hover:bg-bg-elevated border border-border-subtle shadow-[var(--shadow-sm)] hover:border-border',
		ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border border-transparent',
		danger: 'bg-error text-on-error hover:opacity-90 shadow-[var(--shadow-sm)] hover:-translate-y-px'
	};

	const sizes = {
		sm: 'px-3 py-1.5 text-xs rounded-[var(--radius-md)] gap-1.5',
		md: 'px-4 py-2 text-sm rounded-[var(--radius-md)] gap-2',
		lg: 'px-6 py-3 text-sm rounded-[var(--radius-lg)] gap-2'
	};
</script>

<button
	type="button"
	class="{baseStyles} {variants[variant]} {sizes[size]} {className}"
	{disabled}
	{...rest}
>
	{@render children()}
</button>
