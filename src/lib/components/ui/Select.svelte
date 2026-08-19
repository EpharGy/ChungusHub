<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	interface Props extends HTMLSelectAttributes {
		variant?: 'default' | 'compact';
		value?: string;
		children: Snippet;
	}

	let {
		variant = 'default',
		class: className = '',
		disabled = false,
		value = $bindable(''),
		children,
		...rest
	}: Props = $props();

	const baseStyles = `
		input-base font-ui text-text-primary cursor-pointer
		appearance-none pr-8 bg-no-repeat
		hover:bg-bg-elevated
		disabled:opacity-50 disabled:cursor-not-allowed
	`;

	const variants = {
		default: 'w-full px-4 py-2.5 text-sm',
		compact: 'text-xs px-2 py-1.5'
	};
</script>

<div class="relative inline-block {variant === 'default' ? 'w-full' : ''}">
	<select
		class="{baseStyles} {variants[variant]} {className}"
		{disabled}
		bind:value
		{...rest}
	>
		{@render children()}
	</select>
	<Icon
		name="chevronDown"
		class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
	/>
</div>
