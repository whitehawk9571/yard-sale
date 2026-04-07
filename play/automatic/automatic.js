// ============================================================
// YARD SALE MODEL - Shared Automatic Simulation Engine
// ============================================================
// Configured by each HTML page via window.SIM_CONFIG before load

var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");
var stats_canvas = document.getElementById("stats_canvas");
var stats_ctx = stats_canvas.getContext("2d");

// HiDPI scaling: keep CSS size, boost backing store
var dpr = window.devicePixelRatio || 1;
var W = canvas.width;
var H = canvas.height;
canvas.style.width = W + "px";
canvas.style.height = H + "px";
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

var STATS_W = stats_canvas.width;
var STATS_H = stats_canvas.height;
stats_canvas.style.width = STATS_W + "px";
stats_canvas.style.height = STATS_H + "px";
stats_canvas.width = STATS_W * dpr;
stats_canvas.height = STATS_H * dpr;
stats_ctx.scale(dpr, dpr);

// --- CONFIG (overridden per page) ---
var NUM_PEOPLE = window.SIM_CONFIG ? window.SIM_CONFIG.numPeople : 2;
var START_WEALTH = 100;
var WIN_FRACTION = window.SIM_CONFIG ? (window.SIM_CONFIG.winFraction || 0.20) : 0.20;
var LOSE_FRACTION = window.SIM_CONFIG ? (window.SIM_CONFIG.loseFraction || (1/6)) : (1/6);
var WEALTH_TAX = window.SIM_CONFIG ? (window.SIM_CONFIG.wealthTax || 0) : 0;
var STARTING_INEQUALITY = window.SIM_CONFIG ? (window.SIM_CONFIG.startingInequality || 0) : 0; // 0-100%
var SHOW_BAR_CHART = NUM_PEOPLE > 2;
var VIEW_MODE = "grid"; // "grid" or "bars" (only relevant when SHOW_BAR_CHART)
var SORT_MODE = "fixed"; // "sorted" or "fixed" (grid order)
var SPEED = 60; // steps per second

// --- COLORS ---
var PERSON_COLORS = [
	"#5dadec", "#e8b84b", "#e86b6b", "#6be88a", "#c76be8",
	"#e8a86b", "#6bcde8", "#b8e86b", "#e86bb8", "#8a6be8"
];
var PERSON_DARK = [
	"#3a7cbf", "#b8892a", "#b84444", "#44b85a", "#9444b8",
	"#b87a44", "#449cb8", "#8ab844", "#b8448a", "#5a44b8"
];

// --- STATE ---
var wealth = [];
var wHistory = [];
var giniHistory = [];
var flipCount = 0;
var START_SIM = false;
var maxWealth = START_WEALTH * 2;

// Display smoothing for 2-person mode
var displayWealth = [];

// Helpers for generating distributions with target Gini
function _powerLawDist(alpha, n, total) {
	var raw = [], sum = 0;
	for (var i = 0; i < n; i++) {
		var rank = (n - i) / n;
		var v = Math.pow(rank, alpha);
		raw.push(v);
		sum += v;
	}
	var w = [];
	for (var i = 0; i < n; i++) w.push(raw[i] / sum * total);
	return w;
}
function _giniOf(w) {
	var n = w.length;
	if (n <= 1) return 0;
	var sorted = w.slice().sort(function (a, b) { return a - b; });
	var total = 0;
	for (var i = 0; i < n; i++) total += sorted[i];
	if (total === 0) return 0;
	var cum = 0, area = 0;
	for (var i = 0; i < n; i++) {
		var prev = cum / total;
		cum += sorted[i];
		var cur = cum / total;
		area += (prev + cur) / 2 * (1 / n);
	}
	return (1 - 2 * area) * n / (n - 1);
}

function reset() {
	wealth = [];
	displayWealth = [];

	var startIneq = window.STARTING_INEQUALITY;
	if (startIneq === undefined || startIneq === null) {
		startIneq = (window.SIM_CONFIG && window.SIM_CONFIG.startingInequality) ? window.SIM_CONFIG.startingInequality : 0;
	}
	if (startIneq > 0 && NUM_PEOPLE > 1) {
		var totalWealth = NUM_PEOPLE * START_WEALTH;

		if (startIneq >= 100) {
			// 100%: one person gets everything
			for (var i = 0; i < NUM_PEOPLE; i++) {
				wealth.push(i === 0 ? totalWealth : 0);
				displayWealth.push(i === 0 ? totalWealth : 0);
			}
		} else {
			// Binary search for the power-law alpha that produces
			// a Gini matching the slider value exactly
			var targetGini = startIneq / 100;
			var lo = 0, hi = 500;
			for (var iter = 0; iter < 40; iter++) {
				var mid = (lo + hi) / 2;
				var testW = _powerLawDist(mid, NUM_PEOPLE, totalWealth);
				var testG = _giniOf(testW);
				if (testG < targetGini) lo = mid; else hi = mid;
			}
			var finalW = _powerLawDist((lo + hi) / 2, NUM_PEOPLE, totalWealth);
			// Ensure no one shows $0.00 (min $0.01) except at 100%
			var floor = 0.01;
			var excess = 0;
			for (var i = 0; i < NUM_PEOPLE; i++) {
				if (finalW[i] < floor) { excess += floor - finalW[i]; finalW[i] = floor; }
			}
			finalW[0] -= excess; // take from richest
			for (var i = 0; i < NUM_PEOPLE; i++) {
				wealth.push(finalW[i]);
				displayWealth.push(finalW[i]);
			}
		}
	} else {
		for (var i = 0; i < NUM_PEOPLE; i++) {
			wealth.push(START_WEALTH);
			displayWealth.push(START_WEALTH);
		}
	}

	wHistory = [wealth.slice()];
	giniHistory = [calcGini()];
	flipCount = 0;
	START_SIM = false;
	twoPersonStopped = false;
	// Set maxWealth to actual max so bar chart doesn't slowly rezoom
	var resetMax = 0;
	for (var i = 0; i < NUM_PEOPLE; i++) {
		if (wealth[i] > resetMax) resetMax = wealth[i];
	}
	maxWealth = Math.max(resetMax * 1.2, START_WEALTH * 2);
	statsX = 0;
	if (stats_ctx) {
		stats_ctx.clearRect(0, 0, STATS_W, STATS_H);
	}
	updateButtons();
	window.writeStats();
	if (window.onSimReset) window.onSimReset();
}

// --- SIMULATION STEP ---
var twoPersonStopped = false;
function simStep() {
	// In 2-person mode, auto-pause once when someone displays as $0.00
	// User can still hit play to resume (flips will just be no-ops)
	if (NUM_PEOPLE === 2 && Math.min(wealth[0], wealth[1]) < 0.005 && !twoPersonStopped) {
		twoPersonStopped = true;
		START_SIM = false;
		updateButtons();
		return;
	}

	// Pick two random different people
	var a = Math.floor(Math.random() * NUM_PEOPLE);
	var b;
	do { b = Math.floor(Math.random() * NUM_PEOPLE); } while (b === a);

	var poorer = Math.min(wealth[a], wealth[b]);

	// Only trade if the poorer person has something to bet
	if (poorer > 0) {
		var stake;
		if (Math.random() < 0.5) {
			// Heads: richer pays poorer
			stake = WIN_FRACTION * poorer;
			if (wealth[a] > wealth[b] || (wealth[a] === wealth[b] && Math.random() < 0.5)) {
				wealth[a] -= stake;
				wealth[b] += stake;
			} else {
				wealth[b] -= stake;
				wealth[a] += stake;
			}
		} else {
			// Tails: poorer pays richer
			stake = LOSE_FRACTION * poorer;
			if (wealth[a] < wealth[b] || (wealth[a] === wealth[b] && Math.random() < 0.5)) {
				wealth[a] -= stake;
				wealth[b] += stake;
			} else {
				wealth[b] -= stake;
				wealth[a] += stake;
			}
		}
	}

	flipCount++;

	// Wealth tax (redistribution) - applied once every NUM_PEOPLE flips
	// so each person is effectively "touched" by a trade once between tax rounds
	if (WEALTH_TAX > 0 && flipCount % NUM_PEOPLE === 0) {
		var pool = 0;
		for (var i = 0; i < NUM_PEOPLE; i++) {
			var tax = wealth[i] * WEALTH_TAX;
			wealth[i] -= tax;
			pool += tax;
		}
		var share = pool / NUM_PEOPLE;
		for (var i = 0; i < NUM_PEOPLE; i++) {
			wealth[i] += share;
		}
	}
}

// --- GINI COEFFICIENT (Lorenz curve / trapezoidal method) ---
function calcGini() {
	var n = wealth.length;
	if (n <= 1) return 0;

	// Sort ascending
	var sorted = wealth.slice().sort(function (a, b) { return a - b; });

	var totalWealth = 0;
	for (var i = 0; i < n; i++) totalWealth += sorted[i];
	if (totalWealth === 0) return 0;

	// Build Lorenz curve points and integrate area under it (trapezoidal rule)
	// x-axis: cumulative population share (0 to 1)
	// y-axis: cumulative wealth share (0 to 1)
	var cumWealth = 0;
	var area = 0;
	for (var i = 0; i < n; i++) {
		var prevShare = cumWealth / totalWealth;
		cumWealth += sorted[i];
		var curShare = cumWealth / totalWealth;
		// Trapezoid between population (i/n) and ((i+1)/n)
		area += (prevShare + curShare) / 2 * (1 / n);
	}

	// Gini = (1 - 2 * area) * n/(n-1)
	// The n/(n-1) correction makes Gini reach 1.0 for finite samples
	return (1 - 2 * area) * n / (n - 1);
}

// --- DRAWING: 2-PERSON MODE ---
function drawRoundedRect(cx, x, y, w, h, r) {
	cx.beginPath();
	cx.moveTo(x + r, y);
	cx.lineTo(x + w - r, y);
	cx.quadraticCurveTo(x + w, y, x + w, y + r);
	cx.lineTo(x + w, y + h - r);
	cx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	cx.lineTo(x + r, y + h);
	cx.quadraticCurveTo(x, y + h, x, y + h - r);
	cx.lineTo(x, y + r);
	cx.quadraticCurveTo(x, y, x + r, y);
	cx.closePath();
}

function drawPerson2(x, y, color, w, label) {
	// Head
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(x, y - 20, 20, 0, Math.PI * 2);
	ctx.fill();
	// Body
	drawRoundedRect(ctx, x - 15, y + 2, 30, 35, 8);
	ctx.fill();
	// Eyes
	ctx.fillStyle = "#fff";
	ctx.beginPath(); ctx.arc(x - 6, y - 23, 4.5, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.arc(x + 6, y - 23, 4.5, 0, Math.PI * 2); ctx.fill();
	ctx.fillStyle = "#333";
	ctx.beginPath(); ctx.arc(x - 5, y - 22, 2, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.arc(x + 7, y - 22, 2, 0, Math.PI * 2); ctx.fill();
	// Mouth
	ctx.strokeStyle = "#333"; ctx.lineWidth = 2; ctx.beginPath();
	var ratio = w / START_WEALTH;
	if (ratio > 0.5) ctx.arc(x, y - 12, 7, 0.3, Math.PI - 0.3);
	else if (ratio > 0.2) { ctx.moveTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 10); }
	else ctx.arc(x, y - 5, 7, Math.PI + 0.3, -0.3);
	ctx.stroke();
	// Label
	ctx.fillStyle = "#999"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
	ctx.fillText(label, x, y - 48);
}

function drawTwoPerson() {
	var ax = W * 0.25, bx = W * 0.75, py = 80;
	var barW = 100, barH = 150, barTop = 160;

	// Smooth display
	displayWealth[0] += (wealth[0] - displayWealth[0]) * 0.15;
	displayWealth[1] += (wealth[1] - displayWealth[1]) * 0.15;

	drawPerson2(ax, py, PERSON_COLORS[0], wealth[0], "Alice");
	drawPerson2(bx, py, PERSON_COLORS[1], wealth[1], "Bob");

	// Bars
	var total = START_WEALTH * 2;
	for (var p = 0; p < 2; p++) {
		var cx = p === 0 ? ax : bx;
		var col = PERSON_DARK[p];
		var dw = displayWealth[p];
		var bh = (dw / total) * barH;
		if (bh < 1) bh = 1;

		ctx.fillStyle = "#1a1a1a";
		drawRoundedRect(ctx, cx - barW/2, barTop, barW, barH, 4);
		ctx.fill();
		ctx.fillStyle = col;
		ctx.save();
		drawRoundedRect(ctx, cx - barW/2, barTop, barW, barH, 4);
		ctx.clip();
		ctx.fillRect(cx - barW/2, barTop + barH - bh, barW, bh);
		ctx.restore();
		ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
		drawRoundedRect(ctx, cx - barW/2, barTop, barW, barH, 4);
		ctx.stroke();

		ctx.fillStyle = "#ddd"; ctx.font = "bold 20px sans-serif"; ctx.textAlign = "center";
		ctx.fillText("$" + dw.toFixed(0), cx, barTop + barH + 25);
	}

	// Flip count
	ctx.fillStyle = "#666"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
	ctx.fillText("flip #" + flipCount, W/2, barTop + barH + 50);
}

// --- DRAWING: PEOPLE GRID MODE ---
// Draws each person as a little figure with appearance based on wealth rank,
// plus a gold bag that scales with their actual wealth.
function drawPersonFigure(cx, cy, size, wealthVal, maxW) {
	// Classification by absolute wealth:
	//   Rich:   > $500 (top hat, gold suit)
	//   Normal: $100 - $500 (blue shirt, neutral)
	//   Poor:   < $100 (brown rags, sad)
	// size: target pixel size of figure

	var isRich = wealthVal >= 300;
	var isMid = wealthVal > 50 && wealthVal < 300;
	var isPoor = wealthVal <= 50;

	// Colors per tier
	var bodyColor, skinColor;
	if (isRich) {
		bodyColor = "#6b4423";     // fancy dark brown suit
		skinColor = "#f4d03f";     // gold-ish glow
	} else if (isMid) {
		bodyColor = "#5dadec";     // regular blue
		skinColor = "#ffd9a8";     // neutral
	} else {
		bodyColor = "#7a6548";     // drab brown/grey rags
		skinColor = "#c9a880";     // dull
	}

	var headR = size * 0.22;
	var headY = cy - size * 0.25;

	// Head
	ctx.fillStyle = skinColor;
	ctx.beginPath();
	ctx.arc(cx, headY, headR, 0, Math.PI * 2);
	ctx.fill();

	// Body
	ctx.fillStyle = bodyColor;
	var bodyW = size * 0.36, bodyH = size * 0.42;
	drawRoundedRect(ctx, cx - bodyW / 2, headY + headR - 2, bodyW, bodyH, size * 0.08);
	ctx.fill();

	// Top hat for rich
	if (isRich) {
		ctx.fillStyle = "#1a1a1a";
		var hatW = headR * 1.4;
		var hatH = headR * 1.1;
		// brim
		ctx.fillRect(cx - hatW * 0.75, headY - headR - 1, hatW * 1.5, 2);
		// crown
		ctx.fillRect(cx - hatW / 2, headY - headR - hatH, hatW, hatH);
	}

	// Ragged edges for poor (zigzag bottom on body)
	if (isPoor) {
		ctx.fillStyle = "#1a1a1a";
		var jagY = headY + headR - 2 + bodyH;
		var jagCount = 5;
		var jagW = bodyW / jagCount;
		for (var j = 0; j < jagCount; j++) {
			if (j % 2 === 0) {
				ctx.fillRect(cx - bodyW / 2 + j * jagW, jagY - 2, jagW, 2);
			}
		}
	}

	// Face - tiny dots for eyes
	ctx.fillStyle = "#333";
	var eyeR = Math.max(1, size * 0.025);
	ctx.beginPath(); ctx.arc(cx - headR * 0.35, headY - headR * 0.1, eyeR, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.arc(cx + headR * 0.35, headY - headR * 0.1, eyeR, 0, Math.PI * 2); ctx.fill();

	// Mouth
	if (size > 22) {
		ctx.strokeStyle = "#333";
		ctx.lineWidth = Math.max(1, size * 0.025);
		ctx.beginPath();
		if (isRich) {
			// big grin (wider arc)
			ctx.arc(cx, headY + headR * 0.05, headR * 0.55, 0.15, Math.PI - 0.15);
		} else if (isPoor) {
			// frown
			ctx.arc(cx, headY + headR * 0.5, headR * 0.4, Math.PI + 0.2, -0.2);
		} else {
			// small smile
			ctx.arc(cx, headY + headR * 0.15, headR * 0.35, 0.3, Math.PI - 0.3);
		}
		ctx.stroke();
	}

	// Gold bag: size scales with absolute wealth ($0 tiny, $1000+ huge)
	// sqrt scaling so small wealth differences are visible but big fortunes stand out
	var BAG_REF = 1000;
	var wealthRatio = Math.min(Math.sqrt(Math.max(wealthVal, 0) / BAG_REF), 1);
	var bagBaseR = size * 0.04;
	var bagR = bagBaseR + wealthRatio * size * 0.45;
	var bagX = cx + bodyW * 0.7;
	var bagY = headY + headR + bodyH * 0.6;

	if (wealthVal > 0.01) {
		// Bag body
		ctx.fillStyle = "#c9941c";
		ctx.beginPath();
		ctx.arc(bagX, bagY, bagR, 0, Math.PI * 2);
		ctx.fill();
		// Bag tie (darker top)
		ctx.fillStyle = "#8a6412";
		ctx.fillRect(bagX - bagR * 0.4, bagY - bagR - bagR * 0.25, bagR * 0.8, bagR * 0.3);
		// $ sign (always shown, with minimum legible font size)
		ctx.fillStyle = "#5a3f08";
		var fontSize = Math.max(6, Math.round(bagR * 1.2));
		ctx.font = "bold " + fontSize + "px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("$", bagX, bagY + 1);
	} else {
		// Empty pocket: small dark circle
		ctx.fillStyle = "#333";
		ctx.beginPath();
		ctx.arc(bagX, bagY, bagBaseR * 0.5, 0, Math.PI * 2);
		ctx.fill();
	}
}

function drawPeopleGrid() {
	var pad = 20;
	var topPad = 30;
	var bottomPad = 10;
	var areaW = W - pad * 2;
	var areaH = H - topPad - bottomPad;

	// Sort by wealth descending to get rank
	var indices = [];
	for (var i = 0; i < NUM_PEOPLE; i++) indices.push(i);
	indices.sort(function (a, b) { return wealth[b] - wealth[a]; });

	// Find max wealth for bag scaling
	var curMax = 0;
	for (var i = 0; i < NUM_PEOPLE; i++) {
		if (wealth[i] > curMax) curMax = wealth[i];
	}
	// Smooth maxWealth for stable bag sizing
	maxWealth += (Math.max(curMax * 1.1, START_WEALTH) - maxWealth) * 0.05;

	// Grid layout: pick rows/cols that fit the area's aspect ratio
	var cols = Math.ceil(Math.sqrt(NUM_PEOPLE * areaW / areaH));
	var rows = Math.ceil(NUM_PEOPLE / cols);
	// Refine if overshooting
	while ((rows - 1) * cols >= NUM_PEOPLE) rows--;

	var cellW = areaW / cols;
	var cellH = areaH / rows;
	var cellSize = Math.min(cellW, cellH);

	// Title
	ctx.fillStyle = "#888"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
	var titleText = SORT_MODE === "sorted"
		? "Wealth Distribution (richest \u2192 poorest)"
		: "Wealth Distribution (fixed positions)";
	ctx.fillText(titleText, W / 2, 18);
	ctx.fillStyle = "#666"; ctx.font = "11px sans-serif";
	ctx.textAlign = "right";
	ctx.fillText("flip #" + flipCount, W - pad, 18);

	// Draw people: "sorted" uses rank order (richest at top-left),
	// "fixed" keeps each person at their original index position.
	for (var k = 0; k < NUM_PEOPLE; k++) {
		var idx = (SORT_MODE === "sorted") ? indices[k] : k;
		var col = k % cols;
		var row = Math.floor(k / cols);
		var cx = pad + col * cellW + cellW / 2;
		var cy = topPad + row * cellH + cellH / 2;

		drawPersonFigure(cx, cy, cellSize * 0.85, wealth[idx], maxWealth);
	}
}

// --- DRAWING: BAR CHART MODE ---
function drawBarChart() {
	var leftPad = 45; // extra room for $-value labels
	var rightPad = 20;
	var barAreaW = W - leftPad - rightPad;
	var barAreaH = H - 60;
	var barTop = 40;
	var pad = leftPad; // alias used below

	// Sort indices by wealth descending
	var indices = [];
	for (var i = 0; i < NUM_PEOPLE; i++) indices.push(i);
	indices.sort(function (a, b) { return wealth[b] - wealth[a]; });

	// Find max for scaling
	var curMax = 0;
	for (var i = 0; i < NUM_PEOPLE; i++) {
		if (wealth[i] > curMax) curMax = wealth[i];
	}
	maxWealth += (Math.max(curMax * 1.2, START_WEALTH * 2) - maxWealth) * 0.05;

	// Always fill the full bar area. Use gap=1 if bars are wide enough,
	// otherwise drop the gap and make bars as wide as needed to fill.
	var gap = 1;
	var slot = barAreaW / NUM_PEOPLE; // width per person including gap
	var barW;
	if (slot >= 3) {
		barW = slot - gap;
	} else {
		gap = 0;
		barW = slot;
	}

	// Horizontal gridlines at quantized dollar amounts
	// Pick a nice round step that gives ~5 lines
	function niceStep(range) {
		var rough = range / 5;
		var pow10 = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
		var norm = rough / pow10;
		var nice;
		if (norm < 1.5) nice = 1;
		else if (norm < 3.5) nice = 2;
		else if (norm < 7.5) nice = 5;
		else nice = 10;
		return nice * pow10;
	}
	var step = niceStep(maxWealth);
	ctx.strokeStyle = "#2a2a2a";
	ctx.lineWidth = 1;
	ctx.fillStyle = "#666";
	ctx.font = "11px sans-serif";
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	for (var v = step; v < maxWealth; v += step) {
		var gy = barTop + barAreaH - (v / maxWealth) * barAreaH;
		ctx.beginPath();
		ctx.moveTo(pad, gy);
		ctx.lineTo(pad + barAreaW, gy);
		ctx.stroke();
		ctx.fillText("$" + v, pad - 3, gy);
	}
	ctx.textBaseline = "alphabetic";

	// Bars
	for (var k = 0; k < NUM_PEOPLE; k++) {
		var idx = indices[k];
		var x = pad + k * (barW + gap);
		var bh = (wealth[idx] / maxWealth) * barAreaH;
		if (bh < 1) bh = 1;

		var ci = idx % PERSON_COLORS.length;
		ctx.fillStyle = PERSON_DARK[ci];
		ctx.fillRect(x, barTop + barAreaH - bh, barW, bh);
	}

	// Baseline axis
	ctx.strokeStyle = "#666"; ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(pad, barTop + barAreaH);
	ctx.lineTo(pad + barAreaW, barTop + barAreaH);
	ctx.stroke();

	// Title + flip count + $0 baseline label
	ctx.fillStyle = "#888"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
	ctx.fillText("Wealth Distribution (sorted richest \u2192 poorest)", W/2, 20);
	ctx.fillStyle = "#888"; ctx.font = "11px sans-serif";
	ctx.textAlign = "right";
	ctx.textBaseline = "top";
	ctx.fillText("$0", pad - 3, barTop + barAreaH + 3);
	ctx.textBaseline = "alphabetic";
	ctx.fillStyle = "#666";
	ctx.fillText("flip #" + flipCount, pad + barAreaW, barTop + 10);
}

// --- STATS GRAPH ---
var statsX = 0;

function drawStats() {
	if (!stats_canvas) return;

	if (SHOW_BAR_CHART) {
		// Gini over time
		drawGiniGraph();
	} else {
		// Wealth over time for 2 people
		drawWealthGraph();
	}
}

function drawWealthGraph() {
	stats_ctx.clearRect(0, 0, STATS_W, STATS_H);

	// Background
	stats_ctx.fillStyle = "#151515";
	drawRoundedRect(stats_ctx, 0, 0, STATS_W, STATS_H, 6);
	stats_ctx.fill();
	stats_ctx.strokeStyle = "#333"; stats_ctx.lineWidth = 1;
	drawRoundedRect(stats_ctx, 0, 0, STATS_W, STATS_H, 6);
	stats_ctx.stroke();

	// Center line
	stats_ctx.strokeStyle = "#333";
	stats_ctx.setLineDash([3, 3]);
	stats_ctx.beginPath();
	stats_ctx.moveTo(5, STATS_H / 2);
	stats_ctx.lineTo(STATS_W - 5, STATS_H / 2);
	stats_ctx.stroke();
	stats_ctx.setLineDash([]);

	if (wHistory.length < 1) return;

	var pad = 10;
	var maxPts = STATS_W - pad * 2;
	var startIdx = Math.max(0, wHistory.length - maxPts);
	var numPts = wHistory.length - startIdx;
	var total = START_WEALTH * NUM_PEOPLE;

	for (var p = 0; p < 2; p++) {
		stats_ctx.strokeStyle = PERSON_COLORS[p];
		stats_ctx.lineWidth = 2;
		stats_ctx.beginPath();
		for (var i = startIdx; i < wHistory.length; i++) {
			var px = pad + ((i - startIdx) / Math.max(1, numPts - 1)) * (STATS_W - pad * 2);
			var py = STATS_H - pad - (wHistory[i][p] / total) * (STATS_H - pad * 2);
			if (i === startIdx) stats_ctx.moveTo(px, py); else stats_ctx.lineTo(px, py);
		}
		stats_ctx.stroke();
	}

	stats_ctx.fillStyle = "#555"; stats_ctx.font = "11px sans-serif";
	stats_ctx.textAlign = "left";
	stats_ctx.fillText("$" + total, 5, 13);
	stats_ctx.fillText("$0", 5, STATS_H - 4);
	stats_ctx.textAlign = "right";
	stats_ctx.fillText("flip #" + flipCount, STATS_W - 5, 13);
}

function drawGiniGraph() {
	stats_ctx.clearRect(0, 0, STATS_W, STATS_H);

	stats_ctx.fillStyle = "#151515";
	drawRoundedRect(stats_ctx, 0, 0, STATS_W, STATS_H, 6);
	stats_ctx.fill();
	stats_ctx.strokeStyle = "#333"; stats_ctx.lineWidth = 1;
	drawRoundedRect(stats_ctx, 0, 0, STATS_W, STATS_H, 6);
	stats_ctx.stroke();

	if (giniHistory.length < 1) return;

	var pad = 10;
	var maxPts = STATS_W - pad * 2;
	var startIdx = Math.max(0, giniHistory.length - maxPts);
	var numPts = giniHistory.length - startIdx;

	stats_ctx.strokeStyle = "#cc2727";
	stats_ctx.lineWidth = 2;
	stats_ctx.beginPath();
	for (var i = startIdx; i < giniHistory.length; i++) {
		var px = pad + ((i - startIdx) / Math.max(1, numPts - 1)) * (STATS_W - pad * 2);
		var py = STATS_H - pad - giniHistory[i] * (STATS_H - pad * 2);
		if (i === startIdx) stats_ctx.moveTo(px, py); else stats_ctx.lineTo(px, py);
	}
	stats_ctx.stroke();

	// "Perfect equality" line at 0
	stats_ctx.strokeStyle = "#444";
	stats_ctx.setLineDash([3, 3]);
	stats_ctx.beginPath();
	stats_ctx.moveTo(pad, STATS_H - pad);
	stats_ctx.lineTo(STATS_W - pad, STATS_H - pad);
	stats_ctx.stroke();
	stats_ctx.setLineDash([]);

	stats_ctx.fillStyle = "#555"; stats_ctx.font = "11px sans-serif";
	stats_ctx.textAlign = "left";
	stats_ctx.fillText("100% (max)", 5, 13);
	stats_ctx.fillText("0% (equal)", 5, STATS_H - 4);
	stats_ctx.textAlign = "right";
	stats_ctx.fillText("flip #" + flipCount, STATS_W - 5, 13);
}

// --- BUTTONS ---
function updateButtons() {
	var btn = document.getElementById("moving");
	if (btn) {
		btn.textContent = START_SIM ? "\u23F8 pause" : "\u25B6 play";
		btn.className = START_SIM ? "btn active" : "btn";
	}
	var viewBtn = document.getElementById("view_toggle");
	if (viewBtn) {
		viewBtn.textContent = VIEW_MODE === "grid" ? "\u2630 bars" : "\u263A people";
	}
	var sortBtn = document.getElementById("sort_toggle");
	if (sortBtn) {
		sortBtn.textContent = SORT_MODE === "sorted" ? "\u2195 sorted" : "\u2195 fixed";
		sortBtn.style.display = (VIEW_MODE === "grid") ? "" : "none";
	}
}

function toggleView() {
	VIEW_MODE = (VIEW_MODE === "grid") ? "bars" : "grid";
	updateButtons();
}

function toggleSort() {
	SORT_MODE = (SORT_MODE === "sorted") ? "fixed" : "sorted";
	updateButtons();
}

window.writeStats = function () {
	var statsText = document.getElementById("stats_text");
	if (!statsText) return;
	if (SHOW_BAR_CHART) {
		var g = calcGini();
		statsText.innerHTML = "Inequality: <b>" + (g * 100).toFixed(1) + "%</b>";
	} else {
		statsText.innerHTML = "Alice: <b>$" + wealth[0].toFixed(2) + "</b> &nbsp; Bob: <b>$" + wealth[1].toFixed(2) + "</b>";
	}
};

// --- MAIN RENDER ---
var recordInterval = 0;
var stepAccumulator = 0;
var lastTime = 0;
function render() {
	var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
	var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
	lastTime = now;

	// Run simulation steps at SPEED steps per second
	if (START_SIM) {
		stepAccumulator += dt * SPEED;
		// Cap per-frame steps to avoid freezing on huge speeds
		var stepsThisFrame = Math.min(Math.floor(stepAccumulator), 10000);
		stepAccumulator -= stepsThisFrame;
		for (var s = 0; s < stepsThisFrame; s++) {
			simStep();
		}

		if (stepsThisFrame > 0) {
			recordInterval += stepsThisFrame;
			// Record history periodically
			var recordRate = NUM_PEOPLE > 10 ? 5 : 1;
			if (recordInterval >= recordRate) {
				recordInterval = 0;
				wHistory.push(wealth.slice());
				giniHistory.push(calcGini());
			}
			window.writeStats();
		}
	} else {
		stepAccumulator = 0;
	}

	// Smooth display
	for (var i = 0; i < NUM_PEOPLE; i++) {
		displayWealth[i] += (wealth[i] - displayWealth[i]) * 0.15;
	}

	// Draw main canvas
	ctx.clearRect(0, 0, W, H);
	if (SHOW_BAR_CHART) {
		if (VIEW_MODE === "grid") {
			drawPeopleGrid();
		} else {
			drawBarChart();
		}
	} else {
		drawTwoPerson();
	}

	// Draw stats
	drawStats();
}

// --- INIT ---
reset();

window.requestAnimFrame = window.requestAnimationFrame ||
	window.webkitRequestAnimationFrame ||
	window.mozRequestAnimationFrame ||
	function (cb) { window.setTimeout(cb, 1000 / 60); };
(function animloop() {
	requestAnimFrame(animloop);
	if (window.IS_IN_SIGHT) render();
})();
setInterval(function () {
	if (window.IS_IN_SIGHT) render();
}, 1000 / 60);
window.IS_IN_SIGHT = true;
