import { describe, expect, test } from 'bun:test';
import { isDecorationColor, sanitizeDecorations } from './inline-decoration';

describe('what a preset may decorate', () => {
	test('the four properties survive', () => {
		expect(sanitizeDecorations('color:#3fa7c4')).toBe('color: #3fa7c4');
		expect(sanitizeDecorations('background-color: rgba(20,20,28,0.8)')).toBe(
			'background-color: rgba(20,20,28,0.8)'
		);
		expect(sanitizeDecorations('font-weight:bold')).toBe('font-weight: bold');
		expect(sanitizeDecorations('text-align: center')).toBe('text-align: center');
	});

	test('a panel header keeps its colour and loses its geometry', () => {
		// The shape a styled summary tends to arrive in: two decoration properties buried
		// in a pile of layout the app owns and will not hand over.
		const authored =
			'background:linear-gradient(90deg, #202433, #12141c);padding:12px 15px;' +
			'font-weight:bold;color:#dfe3ef;cursor:pointer;text-transform:uppercase;' +
			'letter-spacing:1px;list-style:none;border-bottom:2px solid #3fa7c4;border-radius:6px 6px 0 0;';
		expect(sanitizeDecorations(authored)).toBe('font-weight: bold; color: #dfe3ef');
	});

	// app.css reads this serialization back with attribute selectors, to decide that a
	// preset's colour outranks the app's own quote/strong/emphasis accents. It anchors on
	// the start of the attribute and on the `; ` between declarations, which is the only
	// thing keeping `background-color:` from being read as a text colour. Change the shape
	// here and coloured dialogue silently stops working.
	test('a surviving colour is serialized where the stylesheet can find it', () => {
		expect(sanitizeDecorations('color: #56b4e9')).toStartWith('color:');
		expect(sanitizeDecorations('background-color:#111;color:#56b4e9')).toBe(
			'background-color: #111; color: #56b4e9'
		);
		// The one shape that must NOT read as a text colour.
		expect(sanitizeDecorations('background-color:#111')).not.toStartWith('color:');
		expect(sanitizeDecorations('background-color:#111')).not.toInclude('; color:');
	});
});

describe('what it may not', () => {
	test('nothing that resizes or moves a block gets through', () => {
		const escape =
			'position:fixed;inset:0;top:0;left:0;width:100vw;height:100vh;' +
			'margin:0;padding:0;transform:scale(3);z-index:9999;display:flex;opacity:1';
		expect(sanitizeDecorations(escape)).toBe('');
	});

	test('nothing can reach off this machine', () => {
		expect(sanitizeDecorations('background-color:url(https://example.com/pixel.png)')).toBe('');
		expect(sanitizeDecorations('background-color:image-set("https://x/y.png" 1x)')).toBe('');
		expect(sanitizeDecorations('color:rgb(var(--leak))')).toBe('');
	});

	test('a gradient is not a colour: the shorthand it rides on is not allowed either', () => {
		expect(sanitizeDecorations('background:linear-gradient(90deg,#202433,#12141c)')).toBe('');
		expect(sanitizeDecorations('background-color:linear-gradient(90deg,#000,#fff)')).toBe('');
	});

	test('a value that is not the property it claims to be is dropped whole', () => {
		expect(sanitizeDecorations('font-weight:900px')).toBe('');
		expect(sanitizeDecorations('text-align:absolute')).toBe('');
		expect(sanitizeDecorations('color:')).toBe('');
	});

	test('!important cannot out-rank the app on a property it does own', () => {
		expect(sanitizeDecorations('color:#fff !important')).toBe('color: #fff');
	});

	test('output is rebuilt, so nothing unparsed rides along', () => {
		// A closing brace would end the app's own rule if the attribute were passed
		// through as written; re-serializing from the parsed pairs is what stops it.
		expect(sanitizeDecorations('color:red} .app{display:none')).toBe('');
		expect(sanitizeDecorations('color:red;} body{color:blue')).toBe('color: red');
	});

	test('an unknown property is dropped even when its value would be a fine colour', () => {
		expect(sanitizeDecorations('border-color:#c45a72;box-shadow:0 0 8px #c45a72')).toBe('');
	});
});

describe('the legacy font colour', () => {
	test('accepts colours and refuses everything else', () => {
		expect(isDecorationColor('#d8c37a')).toBe(true);
		expect(isDecorationColor(' rebeccapurple ')).toBe(true);
		expect(isDecorationColor('hsl(210 40% 50%)')).toBe(true);
		expect(isDecorationColor('url(https://example.com/x.png)')).toBe(false);
		expect(isDecorationColor('#fff; position: fixed')).toBe(false);
	});
});
