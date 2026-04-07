var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

// HiDPI
var dpr = window.devicePixelRatio || 1;
var CW = canvas.width, CH = canvas.height;
canvas.style.width = CW + "px";
canvas.style.height = CH + "px";
canvas.width = CW * dpr;
canvas.height = CH * dpr;
ctx.scale(dpr, dpr);

// --- COINS ---
function Coin(x, y, r, speed) {
	this.x = x;
	this.y = y;
	this.r = r;
	this.baseY = y;
	this.speed = speed;
	this.phase = Math.random() * Math.PI * 2;
	this.spinPhase = Math.random() * Math.PI * 2;
	this.spinSpeed = 0.02 + Math.random() * 0.03;
	this.bobAmp = 3 + Math.random() * 8;
	this.swayAmp = 2 + Math.random() * 4;
	this.isGold = Math.random() < 0.5;
	this.opacity = 0.3 + Math.random() * 0.7;
	this.pushX = 0;
	this.pushY = 0;
}

Coin.prototype.update = function () {
	this.phase += this.speed;

	// Mouse interaction
	var mx = Mouse.x;
	var my = Mouse.y + (window.SCROLL || 0) * 0.5;
	var dx = this.x - mx;
	var dy = this.y - my;
	var dist = Math.sqrt(dx * dx + dy * dy);

	// Spin faster when mouse is near, slower when far
	var spinProximity = Math.max(0, 1 - dist / 400); // 1 when close, 0 when far
	var spinRate = this.spinSpeed * (0.4 + spinProximity * 1.2);
	this.spinPhase += spinRate;
};

Coin.prototype.draw = function (ctx, scrollOffset) {
	var y = this.baseY + Math.sin(this.phase) * this.bobAmp + scrollOffset;
	var x = this.x + Math.cos(this.phase * 0.7) * this.swayAmp;

	// Spin effect: scale x to simulate 3D rotation
	var spin = Math.cos(this.spinPhase + this.phase * 0.3);
	var scaleX = Math.abs(spin);
	if (scaleX < 0.15) scaleX = 0.15;

	var showGold = spin > 0 ? this.isGold : !this.isGold;

	ctx.save();
	ctx.globalAlpha = this.opacity;
	ctx.translate(x, y);
	ctx.scale(scaleX, 1);

	// Coin body
	ctx.fillStyle = showGold ? "#f4d03f" : "#b8b8b8";
	ctx.beginPath();
	ctx.arc(0, 0, this.r, 0, Math.PI * 2);
	ctx.fill();

	// Inner ring
	ctx.strokeStyle = showGold ? "#d4a017" : "#888";
	ctx.lineWidth = Math.max(1, this.r * 0.08);
	ctx.beginPath();
	ctx.arc(0, 0, this.r * 0.8, 0, Math.PI * 2);
	ctx.stroke();

	// Dollar sign
	if (this.r > 8) {
		ctx.fillStyle = showGold ? "#9a7209" : "#555";
		ctx.font = "bold " + Math.round(this.r * 0.9) + "px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("$", 0, 1);
	}

	ctx.restore();
};

// --- PEOPLE FIGURES (scattered in background) ---
function Person(x, y, size, tier) {
	this.x = x;
	this.y = y;
	this.size = size;
	this.tier = tier; // 0=rich, 1=normal, 2=poor
	this.phase = Math.random() * Math.PI * 2;
	this.swingSpeed = 0.02 + Math.random() * 0.02;
	this.opacity = 0.25 + Math.random() * 0.25;
}

Person.prototype.update = function () {
	this.phase += this.swingSpeed;
};

Person.prototype.draw = function (ctx, scrollOffset) {
	var x = this.x;
	var y = this.y + scrollOffset;
	var s = this.size;
	var sway = Math.sin(this.phase) * 0.05;

	ctx.save();
	ctx.globalAlpha = this.opacity;
	ctx.translate(x, y);
	ctx.rotate(sway);

	var headR = s * 0.22;
	var headY = -s * 0.25;
	var colors;
	if (this.tier === 0) {
		colors = { skin: "#f4d03f", body: "#6b4423" };
	} else if (this.tier === 1) {
		colors = { skin: "#ffd9a8", body: "#5dadec" };
	} else {
		colors = { skin: "#c9a880", body: "#7a6548" };
	}

	// Head
	ctx.fillStyle = colors.skin;
	ctx.beginPath();
	ctx.arc(0, headY, headR, 0, Math.PI * 2);
	ctx.fill();

	// Body
	ctx.fillStyle = colors.body;
	ctx.fillRect(-s * 0.18, headY + headR - 2, s * 0.36, s * 0.42);

	// Top hat for rich
	if (this.tier === 0) {
		ctx.fillStyle = "#1a1a1a";
		var hatW = headR * 1.4;
		var hatH = headR * 1.1;
		ctx.fillRect(-hatW * 0.75, headY - headR - 1, hatW * 1.5, 2);
		ctx.fillRect(-hatW / 2, headY - headR - hatH, hatW, hatH);
	}


	ctx.restore();
};

// --- GENERATE SCENE ---
var coins = [];
var people = [];

// Scatter coins across the scene, denser at edges (like Nicky's polygon layout)
for (var i = 0; i < 1280; i += 40) {
	var t = (i - 640) / 640;
	var density = t * t; // more at edges
	var numCoins = Math.floor(density * 3) + 1;

	// Skip the center zone where text lives
	if (Math.abs(t) < 0.35) {
		numCoins = Math.max(1, Math.floor(density));
	}

	for (var j = 0; j < numCoins; j++) {
		var x = i + Math.random() * 30 - 15;
		var y = 50 + Math.random() * 450;

		// Avoid text zone (center)
		if (Math.abs(x - 640) < 280 && y > 100 && y < 350) continue;

		var r = 10 + Math.random() * 18;
		var speed = 0.015 + Math.random() * 0.02;
		coins.push(new Coin(x, y, r, speed));
	}
}

// Scatter people figures in background with a rich/poor split
// Left side: rich people. Right side: poor people. Middle: normal.
for (var i = 0; i < 40; i++) {
	var x = Math.random() * 1280;
	var y = 80 + Math.random() * 400;

	// Avoid center text
	if (Math.abs(x - 640) < 320 && y > 80 && y < 360) continue;

	var size = 25 + Math.random() * 20;
	// Tier based on horizontal position: left=rich, right=poor
	var xFrac = x / 1280; // 0=left, 1=right
	var tier;
	if (xFrac < 0.3) {
		tier = 0; // rich (left side)
	} else if (xFrac > 0.7) {
		tier = 2; // poor (right side)
	} else {
		// Middle zone: mix, slight gradient
		tier = (Math.random() < 0.5 - (xFrac - 0.5) * 0.8) ? 1 : 2;
	}
	people.push(new Person(x, y, size, tier));
}

// Sort each layer by Y for depth ordering within its layer
people.sort(function (a, b) { return a.y - b.y; });
coins.sort(function (a, b) { return a.y - b.y; });

// --- MOUSE ---
var Mouse = { x: 640, y: 275 };
document.addEventListener("mousemove", function (e) {
	Mouse.x = e.pageX;
	Mouse.y = e.pageY;
});
document.addEventListener("touchmove", function (e) {
	Mouse.x = e.changedTouches[0].clientX;
	Mouse.y = e.changedTouches[0].clientY;
});

// --- RENDER ---
window.SCROLL = 0;
function render() {
	if (window.SCROLL > 600) return;

	var scrollOffset = (window.SCROLL || 0) * 0.5;

	// Update
	for (var i = 0; i < coins.length; i++) coins[i].update();
	for (var i = 0; i < people.length; i++) people[i].update();

	// Draw: people behind, coins in front
	ctx.clearRect(0, 0, CW, CH);

	for (var i = 0; i < people.length; i++) people[i].draw(ctx, scrollOffset);
	for (var i = 0; i < coins.length; i++) coins[i].draw(ctx, scrollOffset);
}

// Animation loop
window.requestAnimFrame = window.requestAnimationFrame ||
	window.webkitRequestAnimationFrame ||
	window.mozRequestAnimationFrame ||
	function (cb) { window.setTimeout(cb, 1000 / 60); };
(function animloop() {
	requestAnimFrame(animloop);
	render();
})();
setInterval(function () { render(); }, 1000 / 60);
