<script lang="ts">
	/**
	 * The raccoon in spectacles is the assistant's face, wherever the panel needs to name
	 * itself: the widget's header, a session tab, the empty state, and the closed launcher.
	 * It is chrome, never a status; the live indicator is the activity line's job and this
	 * never animates, because motion in this panel means work is happening.
	 *
	 * It fits a trash panda: the assistant's whole job is rummaging through the stack,
	 * through a chat, through a pile of cards. The app ships the same animal whole
	 * (static/mark.svg) and as a bare head (static/icon.svg, which every app icon is cut
	 * from); this is a third drawing of that animal, a head in reading glasses, so all
	 * three read as one character and the assistant is never mistaken for the app. It is
	 * self-contained: nothing here is shared with the other two, so redrawing either of
	 * them leaves this face alone.
	 *
	 * The artwork is line work, not a filled silhouette, so it needs more room than a solid
	 * shape would to stay readable: below roughly 20px the lenses close over the eye patches
	 * and it becomes a face-shaped smudge. At the two sizes that cross that line (the tab and
	 * the header) it sits beside its own label, so it may never be the only thing naming the
	 * panel. The nested transform is the drawing's own coordinate space (y-up, ten units to
	 * the point) and the winding inside it is what cuts the lenses and the pupils, so neither
	 * is safe to "tidy".
	 *
	 * It is a two-tone print, and **both tones are fixed**: ink on paper, neither of them
	 * the accent. Tinting the ink is the obvious idea and it fails: the paper below it is a
	 * constant near-white, so a pale accent (sage, silver) puts light lines on a light face
	 * and the whole drawing washes out. A pair only stays legible if both halves are pinned.
	 *
	 * Line work alone reads as a hole punched in a dark panel, so it sits on paper. Those
	 * three shapes are the face and the two ears, and they are NOT this drawing's own inner
	 * contours: its outline is two bands that enclose the face only together, so there is no
	 * inner edge here to lift. They are separate data, inset from THIS ink the whole way
	 * round, measured on every radius rather than eyeballed, so no cream can show past the
	 * line at any size. Redraw the ink and that measurement has to be taken again.
	 */
	/** A number of pixels, or any SVG length: the launcher passes a percentage so the face
	 *  tracks a button whose own size is responsive. */
	let { size = 32 }: { size?: number | string } = $props();
</script>

<svg
	class="mascot"
	width={size}
	height={size}
	viewBox="12 14 576 576"
	aria-hidden="true"
>
	<g transform="translate(0 600) scale(0.1 -0.1)">
		<g class="paper">
			<path d="M3236 4749 c396 -38 745 -171 1054 -401 52 -39 154 -130 225 -202 200 -201 358 -424 488 -688 88 -179 115 -249 217 -558 116 -354 211 -543 363 -722 l57 -67 -46 -68 c-82 -119 -136 -185 -239 -292 -470 -487 -1159 -781 -2060 -876 -508 -54 -1242 63 -1764 281 -225 95 -492 251 -661 387 -170 138 -336 315 -450 482 l-59 87 55 65 c165 195 263 393 379 766 70 225 117 344 211 532 80 160 186 328 293 465 87 112 284 310 391 392 318 246 683 383 1115 421 93 8 330 6 431 -4z" />
			<path d="M1225 5076 c158 -56 337 -158 480 -277 77 -63 202 -186 194 -192 -2 -2 -30 -18 -61 -36 -32 -18 -92 -57 -134 -87 -63 -45 -79 -53 -89 -42 -7 7 -44 49 -82 93 -162 186 -375 310 -488 285 -175 -40 -193 -409 -36 -735 27 -55 62 -120 79 -145 28 -40 30 -47 17 -65 -8 -11 -40 -62 -71 -112 -31 -51 -59 -93 -63 -93 -23 0 -143 244 -191 389 -60 177 -83 325 -83 516 0 181 16 263 77 391 34 71 62 99 128 129 56 25 224 15 323 -19z" />
			<path d="M5116 5086 c57 -27 82 -54 119 -131 118 -249 87 -691 -75 -1060 -31 -72 -120 -225 -130 -225 -5 0 -17 15 -26 32 -10 18 -41 69 -69 114 l-53 81 33 49 c124 185 196 429 182 618 -11 152 -55 234 -136 256 -113 30 -343 -105 -502 -296 -40 -49 -75 -91 -77 -94 -1 -2 -9 0 -16 5 -57 42 -197 135 -223 149 -18 9 -33 22 -33 29 0 14 117 130 200 199 106 88 301 203 415 245 158 59 304 70 391 29z" />
		</g>
		<path d="M890 5254 c-142 -38 -235 -137 -296 -316 -123 -362 -28 -935 220 -1318 25 -39 46 -74 46 -78 0 -5 -22 -58 -49 -118 -27 -60 -48 -110 -46 -112 2 -2 14 3 27 12 12 8 53 20 90 26 l67 12 60 118 c326 642 818 1061 1426 1214 218 55 562 80 790 57 359 -36 682 -146 953 -325 332 -219 627 -563 822 -963 l50 -102 48 -6 c26 -3 68 -14 94 -24 l47 -19 -13 31 c-8 18 -30 69 -51 114 l-37 82 50 83 c140 234 223 468 257 725 37 280 6 530 -88 707 -130 246 -420 280 -802 96 -183 -89 -395 -244 -517 -380 l-53 -58 -113 44 c-532 210 -1242 208 -1759 -6 l-97 -39 -63 68 c-166 182 -453 368 -678 441 -161 51 -281 62 -385 34z m284 -164 c132 -34 316 -128 466 -239 71 -53 260 -227 260 -240 0 -3 -26 -20 -58 -38 -32 -17 -93 -56 -135 -87 -77 -55 -97 -65 -97 -47 0 5 -34 48 -76 95 -204 233 -451 348 -551 255 -144 -135 -92 -558 105 -848 l29 -43 -63 -102 c-35 -55 -67 -108 -73 -116 -13 -21 -28 0 -100 140 -178 347 -236 762 -146 1046 57 184 127 244 280 244 49 0 113 -8 159 -20z m3942 -4 c81 -38 127 -113 164 -269 74 -307 -8 -749 -199 -1076 -23 -39 -46 -71 -50 -71 -5 0 -30 35 -55 78 -26 42 -58 93 -71 113 l-24 36 35 52 c155 229 221 542 160 746 -19 61 -69 113 -121 125 -116 26 -344 -111 -497 -299 -40 -49 -76 -90 -80 -90 -4 -1 -42 24 -85 55 -43 31 -102 70 -130 86 -29 17 -53 35 -53 42 0 14 113 125 200 197 106 88 277 190 400 240 161 64 315 78 406 35z" />
		<path d="M1655 3746 c-211 -55 -379 -168 -511 -342 -31 -42 -68 -80 -81 -85 -14 -5 -60 -14 -102 -20 -116 -15 -128 -18 -155 -46 -25 -24 -26 -31 -26 -129 0 -126 12 -146 104 -169 32 -9 63 -18 67 -21 5 -3 9 -38 9 -78 0 -249 105 -486 294 -663 293 -274 724 -324 1075 -126 106 60 244 189 311 291 92 141 150 323 150 478 l0 71 63 29 c54 25 74 29 152 29 80 0 97 -3 150 -30 l60 -30 3 -88 c13 -396 310 -752 703 -847 105 -25 286 -27 397 -4 277 57 510 240 638 499 62 127 99 295 93 418 l-3 51 39 12 c22 7 52 15 68 18 57 13 67 35 67 154 0 146 -12 160 -145 177 -139 17 -152 23 -203 94 -128 181 -325 312 -538 362 -81 18 -114 21 -237 17 -157 -6 -248 -28 -377 -93 -209 -106 -386 -309 -455 -525 -10 -30 -20 -58 -24 -62 -3 -3 -37 4 -76 17 -99 35 -219 34 -322 0 -42 -14 -76 -24 -78 -23 -1 2 -15 43 -33 91 -88 249 -302 462 -552 549 -159 55 -368 65 -525 24z m411 -147 c40 -10 105 -34 145 -55 405 -204 548 -685 320 -1079 -46 -80 -180 -212 -266 -263 -184 -108 -404 -135 -606 -76 -216 64 -410 241 -496 456 -123 305 -17 683 249 883 195 146 421 193 654 134z m2230 6 c187 -42 360 -161 470 -324 99 -147 148 -348 125 -516 -29 -212 -142 -404 -306 -520 -145 -103 -277 -146 -450 -147 -135 -1 -217 18 -340 78 -183 90 -327 254 -393 449 -24 73 -26 93 -27 235 0 148 2 159 31 242 134 376 508 587 890 503z m-3306 -434 c13 -25 13 -27 -6 -45 -18 -18 -85 -21 -115 -6 -21 12 -25 40 -7 58 7 7 36 12 65 12 41 0 54 -4 63 -19z m4144 13 c19 -7 21 -45 4 -62 -16 -16 -100 -16 -116 0 -33 33 -4 68 54 68 23 0 49 -3 58 -6z" />
		<path d="M1500 3287 c-62 -15 -123 -42 -141 -63 -10 -12 -4 -13 32 -8 24 3 54 2 67 -3 22 -9 20 -12 -40 -53 -35 -25 -102 -83 -149 -130 -80 -79 -87 -89 -93 -135 -8 -56 5 -163 30 -245 60 -204 235 -382 449 -457 73 -25 92 -28 220 -27 125 0 149 3 221 27 308 103 520 431 478 740 -6 41 -9 45 -25 37 -26 -14 -80 -12 -130 5 -24 8 -156 71 -294 140 -267 134 -363 169 -495 179 -46 3 -96 0 -130 -7z m296 -141 c38 -13 93 -35 123 -50 l53 -28 -35 -36 c-58 -61 -81 -117 -80 -197 0 -82 18 -128 71 -187 131 -145 370 -107 451 72 12 25 21 67 21 94 0 40 3 47 16 42 9 -3 36 -6 61 -6 l46 0 -5 -72 c-17 -241 -227 -438 -467 -438 -127 0 -242 49 -336 144 -149 149 -185 361 -94 551 27 59 83 135 98 135 4 0 39 -11 77 -24z m284 -176 c26 -49 -11 -120 -63 -120 -81 0 -108 114 -34 145 36 15 82 3 97 -25z" />
		<path d="M4318 3289 c-104 -15 -239 -68 -443 -174 -278 -144 -362 -174 -414 -145 -16 8 -20 5 -25 -22 -12 -61 -6 -176 14 -254 54 -211 183 -371 376 -465 262 -128 581 -77 789 125 140 137 204 276 213 464 l5 112 -94 93 c-52 51 -122 114 -157 139 l-62 47 45 7 c25 3 54 4 65 1 33 -8 23 8 -18 31 -46 25 -152 52 -202 51 -19 -1 -61 -5 -92 -10z m9 -162 c187 -249 105 -601 -172 -738 -68 -34 -95 -42 -161 -46 -139 -10 -250 29 -351 120 -100 92 -163 219 -163 332 l0 55 44 0 c24 0 51 3 59 6 11 4 15 -7 19 -48 8 -101 71 -188 166 -230 56 -25 168 -22 227 7 98 48 161 160 152 271 -5 70 -43 151 -89 189 l-29 24 43 22 c54 28 188 78 208 78 8 0 29 -19 47 -42z m-517 -207 c25 -25 26 -71 1 -101 -40 -50 -131 -17 -131 47 0 18 11 29 48 48 58 31 57 31 82 6z" />
		<path d="M656 3010 c-124 -394 -225 -589 -398 -776 -67 -73 -70 -78 -65 -116 4 -27 28 -74 73 -142 277 -417 667 -728 1194 -954 424 -182 1061 -313 1525 -314 209 -1 348 11 604 53 455 73 777 171 1126 343 455 224 814 538 1049 916 65 105 63 121 -23 216 -177 193 -270 376 -397 779 l-48 150 -7 -75 c-8 -88 -18 -117 -52 -148 l-25 -24 48 -143 c81 -237 193 -443 326 -600 l54 -64 -56 -83 c-76 -112 -172 -224 -290 -338 -446 -431 -1065 -693 -1891 -802 -221 -29 -551 -31 -763 -5 -887 110 -1539 394 -1995 868 -109 114 -145 157 -224 273 l-60 88 55 65 c142 168 243 356 333 620 l41 117 -24 26 c-37 40 -47 65 -54 148 l-7 77 -49 -155z" />
		<path d="M892 2703 c-6 -11 -21 -58 -34 -104 -18 -67 -23 -110 -23 -209 0 -111 3 -135 29 -214 70 -212 248 -395 446 -457 36 -11 102 -25 148 -32 185 -25 417 43 637 187 39 25 67 46 63 46 -4 0 -35 -7 -70 -14 -331 -76 -689 35 -925 287 -119 128 -193 265 -238 440 -19 77 -24 87 -33 70z" />
		<path d="M5081 2625 c-122 -508 -650 -835 -1160 -719 -35 8 -66 13 -68 10 -2 -2 27 -24 64 -49 207 -137 442 -204 625 -180 176 24 294 81 412 198 205 202 268 487 172 772 l-22 65 -23 -97z" />
		<path d="M2832 2175 c-120 -34 -182 -98 -182 -188 1 -92 124 -223 253 -268 l39 -14 -4 -71 c-3 -59 -8 -77 -31 -108 -36 -47 -96 -77 -167 -83 -102 -10 -182 32 -225 117 -27 54 -58 70 -94 50 -65 -34 25 -186 149 -251 39 -21 59 -24 145 -24 93 0 105 2 167 33 37 18 78 46 92 63 l26 31 26 -31 c14 -17 56 -45 92 -63 62 -30 75 -33 167 -33 82 0 109 4 146 21 61 28 125 93 154 155 25 55 23 84 -7 100 -35 19 -66 2 -89 -46 -41 -88 -124 -132 -230 -122 -70 6 -130 36 -166 83 -23 31 -28 49 -31 109 l-4 71 42 14 c106 35 231 155 246 236 16 87 -36 167 -134 205 -74 29 -297 37 -380 14z m306 -78 c17 -10 32 -23 32 -31 0 -77 -287 -89 -334 -14 -13 22 -2 35 50 54 53 20 207 14 252 -9z" />
	</g>
</svg>

<style>
	.mascot {
		flex: 0 0 auto;
		display: block;
		/* The app's own printing pair, both from the Parchment palette: its paper and the
		   ink it sets text in. Warm enough not to glare on a dark panel, and on a light one
		   the paper is the page itself, so the drawing reads as plain line work again.
		   Re-tone them together on any ancestor, never one without the other. */
		--mascot-paper: #f7f2ea;
		--mascot-ink: #2f2620;
		fill: var(--mascot-ink);
	}

	.paper {
		fill: var(--mascot-paper);
	}
</style>
