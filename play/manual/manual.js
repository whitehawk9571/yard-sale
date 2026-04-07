var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

// HiDPI scaling: keep CSS size, boost backing store
var dpr = window.devicePixelRatio || 1;
var W = canvas.width;  // 550
var H = canvas.height; // 500
canvas.style.width = W + "px";
canvas.style.height = H + "px";
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

// --- LAYOUT ---
var PERSON_A_X = W * 0.25;
var PERSON_B_X = W * 0.75;
var PERSON_Y = 80;

var BAR_WIDTH = 100;
var BAR_MAX_H = 120;
var BAR_TOP = 170;

var COIN_X = W / 2;
var COIN_Y = 95;
var COIN_R = 32;

var GRAPH_X = 30;
var GRAPH_Y = 350;
var GRAPH_W = W - 60;
var GRAPH_H = 120;

// --- SIM PARAMS ---
var START_WEALTH = 100;
var WIN_FRACTION = 0.20;
var LOSE_FRACTION = 1 / 6;

// --- STATE ---
var wealthA, wealthB;
var displayA, displayB; // smoothed for animation
var wHistory;
var flipCount;

// Animation
var coinFlipping = false;
var coinFrame = 0;
var COIN_FRAMES = 30;
var coinResult = 0; // 0=heads, 1=tails
var transferAnim = 0;
var transferAmount = 0;
var transferDir = 0; // 1 = A->B, -1 = B->A
var lastFlipMessage = "";
var messageAlpha = 0;

// Colors
var COLOR_A = "#5dadec";
var COLOR_A_DARK = "#3a7cbf";
var COLOR_B = "#e8b84b";
var COLOR_B_DARK = "#b8892a";

function reset() {
	wealthA = START_WEALTH;
	wealthB = START_WEALTH;
	displayA = START_WEALTH;
	displayB = START_WEALTH;
	wHistory = [{ a: wealthA, b: wealthB }];
	flipCount = 0;
	coinFlipping = false;
	coinFrame = 0;
	transferAnim = 0;
	lastFlipMessage = "";
	messageAlpha = 0;
}
reset();

// --- COIN FLIP ---
function doFlip() {
	if (coinFlipping) return;
	if (wealthA <= 0 || wealthB <= 0) return;

	coinFlipping = true;
	coinFrame = 0;
	coinResult = Math.random() < 0.5 ? 0 : 1;

	var poorer = Math.min(wealthA, wealthB);

	// When equal, pick random direction
	var aIsRicher = wealthA > wealthB || (wealthA === wealthB && Math.random() < 0.5);

	if (coinResult === 0) {
		// Heads: richer pays poorer
		transferAmount = WIN_FRACTION * poorer;
		transferDir = aIsRicher ? 1 : -1;
		lastFlipMessage = "HEADS! Richer pays poorer $" + transferAmount.toFixed(2);
	} else {
		// Tails: poorer pays richer
		transferAmount = LOSE_FRACTION * poorer;
		transferDir = aIsRicher ? -1 : 1;
		lastFlipMessage = "TAILS! Poorer pays richer $" + transferAmount.toFixed(2);
	}
	messageAlpha = 1;
}

function applyFlip() {
	if (transferDir === 1) {
		wealthA -= transferAmount;
		wealthB += transferAmount;
	} else {
		wealthB -= transferAmount;
		wealthA += transferAmount;
	}
	if (wealthA < 0) wealthA = 0;
	if (wealthB < 0) wealthB = 0;
	wHistory.push({ a: wealthA, b: wealthB });
	flipCount++;
}

// --- DRAW HELPERS ---
function drawRoundedRect(x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

function drawPerson(x, y, color, darkColor, wealth, displayWealth, label) {
	// Head
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(x, y - 20, 20, 0, Math.PI * 2);
	ctx.fill();

	// Body
	drawRoundedRect(x - 15, y + 2, 30, 35, 8);
	ctx.fill();

	// Eyes (white)
	ctx.fillStyle = "#fff";
	ctx.beginPath();
	ctx.arc(x - 6, y - 23, 4.5, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(x + 6, y - 23, 4.5, 0, Math.PI * 2);
	ctx.fill();

	// Pupils
	ctx.fillStyle = "#333";
	ctx.beginPath();
	ctx.arc(x - 5, y - 22, 2, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(x + 7, y - 22, 2, 0, Math.PI * 2);
	ctx.fill();

	// Mouth
	ctx.strokeStyle = "#333";
	ctx.lineWidth = 2;
	ctx.beginPath();
	var ratio = wealth / START_WEALTH;
	if (ratio > 0.5) {
		ctx.arc(x, y - 12, 7, 0.3, Math.PI - 0.3);
	} else if (ratio > 0.2) {
		ctx.moveTo(x - 5, y - 10);
		ctx.lineTo(x + 5, y - 10);
	} else {
		ctx.arc(x, y - 5, 7, Math.PI + 0.3, -0.3);
	}
	ctx.stroke();

	// Label
	ctx.fillStyle = "#999";
	ctx.font = "bold 13px sans-serif";
	ctx.textAlign = "center";
	ctx.fillText(label, x, y - 48);

	// --- Wealth bar ---
	var barX = x - BAR_WIDTH / 2;
	var barH = (displayWealth / (START_WEALTH * 2)) * BAR_MAX_H;
	if (barH < 1) barH = 1;

	// Bar background
	ctx.fillStyle = "#1a1a1a";
	drawRoundedRect(barX, BAR_TOP, BAR_WIDTH, BAR_MAX_H, 4);
	ctx.fill();

	// Bar fill
	ctx.fillStyle = darkColor;
	ctx.save();
	ctx.beginPath();
	drawRoundedRect(barX, BAR_TOP, BAR_WIDTH, BAR_MAX_H, 4);
	ctx.clip();
	ctx.fillRect(barX, BAR_TOP + BAR_MAX_H - barH, BAR_WIDTH, barH);
	ctx.restore();

	// Bar outline
	ctx.strokeStyle = "#444";
	ctx.lineWidth = 1;
	drawRoundedRect(barX, BAR_TOP, BAR_WIDTH, BAR_MAX_H, 4);
	ctx.stroke();

	// Wealth number
	ctx.fillStyle = "#ddd";
	ctx.font = "bold 20px sans-serif";
	ctx.textAlign = "center";
	ctx.fillText("$" + displayWealth.toFixed(0), x, BAR_TOP + BAR_MAX_H + 25);
}

function drawCoin(x, y) {
	var scale = 1;
	var showSide = coinResult;
	var drawY = y;

	if (coinFlipping) {
		var t = coinFrame / COIN_FRAMES;
		drawY += -Math.sin(t * Math.PI) * 50;
		var spin = Math.cos(coinFrame * 10 * Math.PI / COIN_FRAMES);
		if (t < 0.8) {
			showSide = spin > 0 ? 0 : 1;
		} else {
			showSide = coinResult;
		}
		scale = Math.abs(spin);
		if (scale < 0.12) scale = 0.12;
	}

	ctx.save();
	ctx.translate(x, drawY);
	ctx.scale(scale, 1);

	// Shadow
	ctx.fillStyle = "rgba(0,0,0,0.3)";
	ctx.beginPath();
	ctx.ellipse(0, COIN_R + 5, COIN_R * 0.7, 6, 0, 0, Math.PI * 2);
	ctx.fill();

	// Coin body
	var gold = showSide === 0;
	ctx.fillStyle = gold ? "#f4d03f" : "#b8b8b8";
	ctx.beginPath();
	ctx.arc(0, 0, COIN_R, 0, Math.PI * 2);
	ctx.fill();

	// Inner ring
	ctx.strokeStyle = gold ? "#d4a017" : "#888";
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.arc(0, 0, COIN_R - 4, 0, Math.PI * 2);
	ctx.stroke();

	// Letter
	ctx.fillStyle = gold ? "#9a7209" : "#555";
	ctx.font = "bold 26px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(gold ? "H" : "T", 0, 1);

	ctx.restore();

	// Prompt
	if (!coinFlipping && flipCount === 0) {
		var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
		ctx.globalAlpha = 0.4 + pulse * 0.6;
		ctx.fillStyle = "#ccc";
		ctx.font = "bold 15px sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("\u2B06 click to flip! \u2B06", x, y + COIN_R + 24);
		ctx.globalAlpha = 1;
	}
}

function drawTransfer() {
	if (transferAnim <= 0) return;

	var t = 1 - (transferAnim / 25);
	var fromX = transferDir === 1 ? PERSON_A_X : PERSON_B_X;
	var toX = transferDir === 1 ? PERSON_B_X : PERSON_A_X;
	var curX = fromX + (toX - fromX) * t;
	var curY = BAR_TOP + BAR_MAX_H / 2 - Math.sin(t * Math.PI) * 40;

	ctx.globalAlpha = Math.min(1, transferAnim / 10);
	ctx.fillStyle = "#5f5";
	ctx.font = "bold 18px sans-serif";
	ctx.textAlign = "center";
	ctx.fillText("$" + transferAmount.toFixed(2), curX, curY);
	ctx.globalAlpha = 1;
}

function drawMessage() {
	if (!lastFlipMessage || messageAlpha <= 0) return;
	ctx.globalAlpha = Math.min(1, messageAlpha);
	ctx.fillStyle = coinResult === 0 ? "#f4d03f" : "#bbb";
	ctx.font = "bold 15px sans-serif";
	ctx.textAlign = "center";
	ctx.fillText(lastFlipMessage, W / 2, BAR_TOP + BAR_MAX_H + 55);
	ctx.globalAlpha = 1;
}

function drawGraph() {
	var x = GRAPH_X, y = GRAPH_Y, w = GRAPH_W, h = GRAPH_H;

	// Background
	ctx.fillStyle = "#151515";
	drawRoundedRect(x, y, w, h, 6);
	ctx.fill();
	ctx.strokeStyle = "#333";
	ctx.lineWidth = 1;
	drawRoundedRect(x, y, w, h, 6);
	ctx.stroke();

	// Center line
	ctx.strokeStyle = "#333";
	ctx.setLineDash([3, 3]);
	ctx.beginPath();
	ctx.moveTo(x + 5, y + h / 2);
	ctx.lineTo(x + w - 5, y + h / 2);
	ctx.stroke();
	ctx.setLineDash([]);

	if (wHistory.length < 2) {
		ctx.fillStyle = "#555";
		ctx.font = "13px sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("wealth over time", x + w / 2, y + h / 2 + 5);
		return;
	}

	var maxPts = Math.floor(w - 20);
	var startIdx = Math.max(0, wHistory.length - maxPts);
	var numPts = wHistory.length - startIdx;
	var total = START_WEALTH * 2;
	var pad = 10;

	// A line
	ctx.strokeStyle = COLOR_A;
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (var i = startIdx; i < wHistory.length; i++) {
		var px = x + pad + ((i - startIdx) / Math.max(1, numPts - 1)) * (w - pad * 2);
		var py = y + h - pad - (wHistory[i].a / total) * (h - pad * 2);
		if (i === startIdx) ctx.moveTo(px, py); else ctx.lineTo(px, py);
	}
	ctx.stroke();

	// B line
	ctx.strokeStyle = COLOR_B;
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (var i = startIdx; i < wHistory.length; i++) {
		var px = x + pad + ((i - startIdx) / Math.max(1, numPts - 1)) * (w - pad * 2);
		var py = y + h - pad - (wHistory[i].b / total) * (h - pad * 2);
		if (i === startIdx) ctx.moveTo(px, py); else ctx.lineTo(px, py);
	}
	ctx.stroke();

	// Labels
	ctx.fillStyle = "#555";
	ctx.font = "11px sans-serif";
	ctx.textAlign = "left";
	ctx.fillText("$" + total, x + 6, y + 14);
	ctx.fillText("$0", x + 6, y + h - 4);
	ctx.textAlign = "right";
	ctx.fillText("flip #" + flipCount, x + w - 8, y + 14);
}

// --- INPUT ---
function isOverCoin(mx, my) {
	var dx = mx - COIN_X;
	var dy = my - COIN_Y;
	return dx * dx + dy * dy < (COIN_R + 12) * (COIN_R + 12);
}

var lastPressed = false;
function handleInput() {
	if (Mouse.pressed && !lastPressed) {
		if (isOverCoin(Mouse.x, Mouse.y)) {
			doFlip();
		}
	}
	lastPressed = Mouse.pressed;
	document.body.style.cursor = (isOverCoin(Mouse.x, Mouse.y) && !coinFlipping) ? "pointer" : "default";
}

// --- MAIN LOOP ---
function render() {
	ctx.clearRect(0, 0, W, H);

	// Coin animation
	if (coinFlipping) {
		coinFrame++;
		if (coinFrame >= COIN_FRAMES) {
			coinFlipping = false;
			applyFlip();
			transferAnim = 25;
		}
	}
	if (transferAnim > 0) transferAnim--;

	// Smooth wealth display
	displayA += (wealthA - displayA) * 0.15;
	displayB += (wealthB - displayB) * 0.15;

	// Message fade
	if (!coinFlipping && transferAnim <= 0 && messageAlpha > 0) {
		messageAlpha -= 0.005;
	}

	handleInput();

	drawPerson(PERSON_A_X, PERSON_Y, COLOR_A, COLOR_A_DARK, wealthA, displayA, "Alice");
	drawPerson(PERSON_B_X, PERSON_Y, COLOR_B, COLOR_B_DARK, wealthB, displayB, "Bob");
	drawCoin(COIN_X, COIN_Y);
	drawTransfer();
	drawMessage();
	drawGraph();
}

window.requestAnimFrame = window.requestAnimationFrame ||
	window.webkitRequestAnimationFrame ||
	window.mozRequestAnimationFrame ||
	function (callback) { window.setTimeout(callback, 1000 / 60); };
(function animloop() {
	requestAnimFrame(animloop);
	if (window.IS_IN_SIGHT) render();
})();
// Fallback: also run via setInterval in case rAF is throttled
setInterval(function () {
	if (window.IS_IN_SIGHT) render();
}, 1000 / 60);
window.IS_IN_SIGHT = true;
