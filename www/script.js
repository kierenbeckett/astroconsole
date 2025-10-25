// INDI
const wsUrl = `ws://${window.location.host}/ws`;
let ws;
let wsConnected = false;
let indiConnected;
const indiBuffer = [];
let config = {devices: {}};

// UI
let leftHanded = false;
let searchModal = false;
let finderscopeLastUpdated = 0;

// Mount
let mount;
let mountConnected;
let slewRates;
let slewIndex;
let lat;
let long;
let elevation;
let raHours;
let decDeg;
let parking;
let parked;
let motionNs;
let motionWe;
let doingGoto;
let gotoPos;
let tracking;
let pierSideWest;
let slewRateModal = false;

// Focuser
let focuser;
let focuserConnected;
let doingFocus;
let focusPosition;
let completeBacklashComp;
let focuserPositionModal = false;

// Gamepad
let gamepadActiveButtons = { 4: false, 5: false, 6: false, 7: false };
let gamepadActiveDirs = { left: false, right: false, up: false, down: false };
let gamepadFastRateIndex = null;
let gamepadPrevRateIndex = null;

/////////////////////////////////
// Helper functions
//////////////////////////////////

function deg2rad(d) { return d * Math.PI / 180; }

function rad2deg(r) { return r * 180 / Math.PI; }

function formatDegrees(decimalDegrees, showPlus=false) {
  const degrees = Math.floor(decimalDegrees);
  const minutesFloat = (decimalDegrees - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.floor((minutesFloat - minutes) * 60);
  const plus = showPlus && degrees >= 0 ? '+' : '';
  return `${plus}${degrees}° ${minutes}' ${seconds}"`;
}

function formatHours(decimalHours) {
  const hours = Math.floor(decimalHours);
  const minutesFloat = (decimalHours - hours) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.floor((minutesFloat - minutes) * 60);
  return `${hours}h ${minutes}m ${seconds}s`;
}

function parseRadec(input) {
  const sexagesimal = input.match(/^\s*(0*\d|1\d|2[0-3])h\s*(0*[0-9]|[1-5][0-9])m\s*(0*[0-9]|[1-5][0-9])s\s*,?\s*\+?(-?(?:0*[0-9]|[1-8][0-9]))°\s*(0*[0-9]|[1-5][0-9])'\s*(0*[0-9]|[1-5][0-9])"\s*$/i);
  if (sexagesimal) {
    const decSign = sexagesimal[4] > 0 ? 1 : -1;
    return {
      raHours: parseInt(sexagesimal[1]) + parseInt(sexagesimal[2]) / 60 + parseInt(sexagesimal[3]) / 3600,
      decDeg: parseInt(sexagesimal[4]) + decSign * parseInt(sexagesimal[5]) / 60 + decSign * parseInt(sexagesimal[6]) / 3600
    };
  }

  const decimal = input.match(/^\s*((?:0*\d|1\d|2[0-3])(?:\.\d+)?)h?\s*,?\s*\+?(-?(?:0*[0-9]|[1-8][0-9])(?:\.\d+)?)°?\s*$/i);
  if (decimal) {
    return {
      raHours: parseFloat(decimal[1]),
      decDeg: parseFloat(decimal[2])
    };
  }
}

function formatSlewRate(index) {
  const base = (index + 1) + 'x'
  if (base == slewRates[index].key) {
    return base
  }
  return base + ' (' + slewRates[index].key + ')'
}

function generatePlanets() {
  for (const key in CATALOG) {
    const entry = CATALOG[key];

    if (entry.type == 'sso') {
      const observer = new Astronomy.Observer(lat || 0, long || 0, elevation || 0);
      const j2000Pos = Astronomy.Equator(entry.name, new Date(), observer, false, true);
      entry.ra = j2000Pos.ra;
      entry.dec = j2000Pos.dec;
    }
  }
}

function generateFinderscopeUrl() {
  if (raHours == null || decDeg == null || config.finderscope?.url != null) {
    return;
  }

  if (Date.now() - finderscopeLastUpdated < 60000) {
    return;
  }

  let width = document.body.clientWidth;
  let height = document.body.clientHeight;
  const scale = Math.min(800 / width, 800 / height, 1);
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  (config.finderscope ??= {}).fovx = 5;
  (config.finderscope ??= {}).fovy = height * 5 / width;
  const fov = Math.max(config.finderscope?.fovx, config.finderscope?.fovy);
  (config.finderscope ??= {}).rotation = 0;
  (config.finderscope ??= {}).flipPierEast = false;
  const raDeg = raHours * 15;
  // TODO convert from jnow to ICRS
  document.getElementById('finderscope').src = `https://alasky.unistra.fr/hips-image-services/hips2fits?hips=CDS/P/DSS2/color&ra=${raDeg}&dec=${decDeg}&fov=${fov}&width=${width}&height=${height}&projection=TAN&format=png`;
  finderscopeLastUpdated = Date.now();
}

/////////////////////////////////
// Drawing
//////////////////////////////////

function drawOverlays() {
  if (!wsConnected) {
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('disconnectedModal').style.display = 'block';
    document.getElementById('disconnectedMessage').textContent = '🔌 Disconnected from webserver';
    document.getElementById('searchModal').style.display = 'none';
    document.getElementById('slewRateModal').style.display = 'none';
    document.getElementById('focuserPositionModal').style.display = 'none';
  }
  else if (!indiConnected) {
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('disconnectedModal').style.display = 'block';
    document.getElementById('disconnectedMessage').textContent = '🔌 Disconnected from INDI';
    document.getElementById('searchModal').style.display = 'none';
    document.getElementById('slewRateModal').style.display = 'none';
    document.getElementById('focuserPositionModal').style.display = 'none';
  }
  else if (searchModal) {
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('disconnectedModal').style.display = 'none';
    document.getElementById('searchModal').style.display = 'block';
    document.getElementById('slewRateModal').style.display = 'none';
    document.getElementById('focuserPositionModal').style.display = 'none';
  }
  else if (slewRateModal) {
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('disconnectedModal').style.display = 'none';
    document.getElementById('searchModal').style.display = 'none';
    document.getElementById('slewRateModal').style.display = 'block';
    document.getElementById('focuserPositionModal').style.display = 'none';
  }
  else if (focuserPositionModal) {
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('disconnectedModal').style.display = 'none';
    document.getElementById('searchModal').style.display = 'none';
    document.getElementById('slewRateModal').style.display = 'none';
    document.getElementById('focuserPositionModal').style.display = 'block';
  }
  else {
    document.getElementById('overlay').style.display = 'none';
  }
}

function drawFinderscope() {
  const img = document.getElementById('finderscope');

  if (!img.src || !img.complete) {
    return;
  }

  let scopeRotation = config.finderscope?.rotation ?? 0;
  const scopeFlipPierEast = config.finderscope?.flipPierEast ?? false;
  if (!pierSideWest && scopeFlipPierEast) {
    scopeRotation = (scopeRotation + 180) % 360;
  }
  const rad = deg2rad(scopeRotation);
  const card = img.parentElement;

  const rotatedWidth = Math.abs(img.naturalWidth * Math.cos(rad)) + Math.abs(img.naturalHeight * Math.sin(rad));
  const rotatedHeight = Math.abs(img.naturalWidth * Math.sin(rad)) + Math.abs(img.naturalHeight * Math.cos(rad));
  let scale = Math.min(card.clientWidth / rotatedWidth, card.clientHeight / rotatedHeight);
  img.style.transform = `translate(-50%, -50%) scale(${scale}) rotate(${scopeRotation}deg)`;
  img.style.display = 'block';

  const canvas = document.getElementById('finderscopeCanvas');
  canvas.width = card.clientWidth;
  canvas.height = card.clientHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Draw camera FOV
  const scopeFovX = config.finderscope?.fovx;
  const scopeFovY = config.finderscope?.fovy;
  const cameraFovX = config.camera?.fovx;
  const cameraFovY = config.camera?.fovy;
  if (scopeFovX && scopeFovY && cameraFovX && cameraFovX) {
    let cameraRotation = config.camera?.rotation ?? 0;
    const cameraFlipPierEast = config.camera?.flipPierEast ?? false;
    if (!pierSideWest && cameraFlipPierEast) {
      cameraRotation = (cameraRotation + 180) % 360;
    }
    const rectWidth  = scale * img.width  * (cameraFovX / scopeFovX);
    const rectHeight = scale * img.height * (cameraFovY / scopeFovY);
    const hw = rectWidth / 2;
    const hh = rectHeight / 2;
    const notchHW = 0.2 * hw;
    const notchH = 0.2 * hh;

    const offsets = [
      [-hw, -hh],               // bottom-left
      [ hw, -hh],               // bottom-right
      [ hw,  hh],               // top-right
      [ notchHW, hh],           // notch base right (on top edge)
      [ 0,      hh + notchH],   // notch peak (outward, above top edge)
      [-notchHW, hh],           // notch base left (on top edge)
      [-hw,  hh],               // top-left
    ];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(deg2rad(cameraRotation - 180));
    ctx.beginPath();
    ctx.moveTo(offsets[0][0], offsets[0][1]);
    for (let i = 1; i < offsets.length; i++) {
      ctx.lineTo(offsets[i][0], offsets[i][1]);
    }
    ctx.closePath();
    ctx.strokeStyle = "#f39c12";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  else {
    const gap = 5;
    const len = 10;
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - gap);
    ctx.lineTo(cx, cy - gap - len);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + gap + len);
    ctx.moveTo(cx - gap, cy);
    ctx.lineTo(cx - gap - len, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + gap + len, cy);
    ctx.stroke();
  }
}

function drawMountPosition() {
  if (raHours == null || decDeg == null || lat == null || long == null) {
    return;
  }

  document.getElementById('ra').textContent = formatHours(raHours);
  document.getElementById('dec').textContent = formatDegrees(decDeg, true);
  document.getElementById('long').textContent = formatDegrees(long > 180 ? (360 - long) : long) + (long > 180 ? ' W' : ' E');
  document.getElementById('lat').textContent = formatDegrees(Math.abs(lat)) + (lat > 0 ? ' N' : ' S');

  const observer = new Astronomy.Observer(lat, long, elevation);
  const result = Astronomy.Horizon(new Date(), observer, raHours, decDeg);
  document.getElementById('az').textContent = formatDegrees(result.azimuth);
  document.getElementById('alt').textContent = formatDegrees(result.altitude, true);

  const canvas = document.getElementById('compass');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const radius = size / 2 - 12;

  ctx.clearRect(0, 0, size, size);

  // Draw NSEW labels
  ctx.fillStyle = "black";
  ctx.font = "10px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#888888";
  ctx.fillText("N", center, center - radius - 7);
  ctx.fillText("S", center, center + radius + 7);
  ctx.fillText("W", center - radius - 7, center);
  ctx.fillText("E", center + radius + 7, center);

  // Draw outer circle background (Dec=0°)
  ctx.fillStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();

  // Draw Dec rings (0°, 30°, 60°)
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 1;
  [0, 30, 60].forEach(dec => {
    const r = radius * (1 - dec / 90);
    ctx.beginPath();
    ctx.arc(center, center, r, 0, 2 * Math.PI);
    ctx.stroke();
  });

  // Draw outer circle (Dec=0°)
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Draw RA tick marks (24 hours)
  for (let h = 0; h < 24; h++) {
    const angle = (h / 24) * 2 * Math.PI - Math.PI / 2;
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center + (radius - 5) * Math.cos(angle), center + (radius - 5) * Math.sin(angle));
    ctx.lineTo(center + radius * Math.cos(angle), center + radius * Math.sin(angle));
    ctx.stroke();
  }

  // Draw RA/Dec dot
  const r = radius * (1 - result.altitude / 90);
  const theta = (result.azimuth / 360) * 2 * Math.PI - Math.PI / 2;
  ctx.fillStyle = '#f39c12';
  ctx.beginPath();
  ctx.arc(center + r * Math.cos(theta), center + r * Math.sin(theta), 5, 0, 2 * Math.PI);
  ctx.fill();

  if (!parking && doingGoto) {
    const observer = new Astronomy.Observer(lat, long, elevation);
    const gotoResult = Astronomy.Horizon(new Date(), observer, gotoPos.ra, gotoPos.dec);
    const r = radius * (1 - gotoResult.altitude / 90);
    const theta = (gotoResult.azimuth / 360) * 2 * Math.PI - Math.PI / 2;
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 3;
    const x = center + r * Math.cos(theta);
    const y = center + r * Math.sin(theta);
    const size = 5;
    ctx.beginPath();
    // horizontal line
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    // vertical line
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
  }
}

function drawMountUi() {
  const buttons = document.getElementById('slewButtons');
  const status = document.getElementById('slewStatus');
  const trackingBtn = document.getElementById('slewToggleTracking');
  const unparkBtn = document.getElementById('slewUnpark');
  const abortBtn = document.getElementById('slewAbort');

  if (mountConnected == null) {
    buttons.style.display = 'none';
    status.textContent = '🔌 Mount Not Found';
    status.style.display = 'block';
    abortBtn.style.display = 'none';
    unparkBtn.style.display = 'none';
  }
  else if (!mountConnected) {
    buttons.style.display = 'none';
    status.textContent = '🔌 Mount Disconnected';
    status.style.display = 'block';
    abortBtn.style.display = 'none';
    unparkBtn.style.display = 'none';
  }
  else if (parking) {
    buttons.style.display = 'none';
    status.textContent = '🚗 Parking';
    status.style.display = 'block';
    abortBtn.style.display = 'block';
    unparkBtn.style.display = 'none';
  }
  else if (parked) {
    buttons.style.display = 'none';
    status.style.display = 'none';
    abortBtn.style.display = 'none';
    unparkBtn.style.display = 'block';
  }
  else if (doingGoto) {
    buttons.style.display = 'none';
    status.textContent = '🎯 Going to target';
    status.style.display = 'block';
    abortBtn.style.display = 'block';
    unparkBtn.style.display = 'none';
  }
  else {
    buttons.style.display = 'grid';
    status.style.display = 'none';
    abortBtn.style.display = 'none';
    unparkBtn.style.display = 'none';
  }

  if (tracking) {
    trackingBtn.title = 'Tracking';
    trackingBtn.style.filter = '';
  }
  else {
    trackingBtn.title = 'Not Tracking';
    trackingBtn.style.filter = 'grayscale(100%)';
  }

  if (slewRates != null && slewIndex != null) {
    document.getElementById('slewRate').textContent = (slewIndex + 1) + 'x';
  }
}

function drawFocuserUi() {
  const buttons = document.getElementById('focuserButtons');
  const status = document.getElementById('focuserStatus');
  const abortBtn = document.getElementById('focuserAbort');

  if (focuserConnected == null) {
    buttons.style.display = 'none';
    status.textContent = '🔌 Focuser Not Found';
    status.style.display = 'block';
    abortBtn.style.display = 'none';
  }
  else if (!focuserConnected) {
    buttons.style.display = 'none';
    status.textContent = '🔌 Focuser Disconnected';
    status.style.display = 'block';
    abortBtn.style.display = 'none';
  }
  else if (doingFocus) {
    buttons.style.display = 'none';
    status.textContent = '🚀 Focusing';
    status.style.display = 'block';
    abortBtn.style.display = 'block';
  }
  else {
    buttons.style.display = 'block';
    status.style.display = 'none';
    abortBtn.style.display = 'none';
  }

  document.getElementById('focuserPosition').textContent = focusPosition;
  document.querySelectorAll('input[name="focusAbs"]').forEach(radio => {
    radio.checked = parseInt(radio.value) == focusPosition;
  });
}

/////////////////////////////////
// Event handlers
//////////////////////////////////

document.getElementById('fullscreen').addEventListener('click', (event) => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error(`Error attempting fullscreen: ${err.message}`);
    });
  }
  else {
    document.exitFullscreen();
  }
});

document.getElementById('search').addEventListener('click', (event) => {
  searchModal = true;
  drawOverlays();
  document.getElementById('searchValue').focus();
});

document.getElementById('searchValue').addEventListener('input', (event) => {
  const search = document.getElementById('searchValue').value.trim().toLowerCase();

  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = "";

  if (search.length < 3 || search == 'ngc') {
    return;
  }

  const pos = parseRadec(search);
  if (pos) {
    const label = document.createElement('button');
    label.dataset.raHours = pos.raHours;
    label.dataset.decDeg = pos.decDeg;
    label.textContent = '🧭 ' + formatHours(pos.raHours) + ', ' + formatDegrees(pos.decDeg);

    resultsDiv.appendChild(label);
  }

  for (const key in CATALOG) {
    const entry = CATALOG[key];

    if (entry.alt.some(n => n.toLowerCase().includes(search))) {
      const label = document.createElement('button');
      label.dataset.raHours = entry.ra;
      label.dataset.decDeg = entry.dec;
      let icon = '🌌';
      if (entry.name == 'Sun') {
        icon = '☀️';
      }
      else if (entry.name == 'Moon') {
        icon = '🌕';
      }
      else if (entry.type == 'sso') {
        icon = '🪐';
      }
      else if (entry.type == 'star') {
        icon = '⭐';
      }
      label.textContent = icon + ' ' + entry.name;

      resultsDiv.appendChild(label);

      if (resultsDiv.children.length >= 7) {
        break;
      }
    }
  }

  document.querySelectorAll('[data-ra-hours]').forEach(button => {
    button.addEventListener('click', () => {
      // TODO convert from ICRS to jnow
      gotoPos = {ra: parseFloat(button.dataset.raHours), dec: parseFloat(button.dataset.decDeg)}
      sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'ON_COORD_SET', 'keys': [{'key': 'TRACK', 'value': true}] });
      sendIndiMsg({
        cmd: 'number',
        device: mount,
        name: 'EQUATORIAL_EOD_COORD',
        keys: [
          { key: 'RA', value: gotoPos.ra },
          { key: 'DEC', value: gotoPos.dec }
        ]
      });

      searchModal = false;
      drawOverlays();
    });
  });
});

document.getElementById('compass').addEventListener('click', (event) => {
  document.getElementById('compass').style.display = 'none';
  document.getElementById('stats').style.display = 'grid';
});

document.getElementById('stats').addEventListener('click', (event) => {
  document.getElementById('stats').style.display = 'none';
  document.getElementById('compass').style.display = 'block';
});

document.getElementById('overlay').addEventListener('click', (event) => {
  if (document.getElementById('overlay') == event.target) {
    searchModal = false;
    slewRateModal = false;
    focuserPositionModal = false;
    drawOverlays();
  }
});

document.querySelectorAll('[data-direction]').forEach((button) => {
  let isPressed = false;

  function start(event) {
    if (!isPressed) {
      isPressed = true;
      sendMotionCommand(button.dataset.direction, true);
    }
  }

  function stop(event) {
    if (isPressed) {
      isPressed = false;
      sendMotionCommand(button.dataset.direction, false);
    }
  }

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointercancel', stop);
});

document.getElementById('slewRate').addEventListener('click', (event) => {
  const slewRate = document.getElementById('slewRateNew');
  slewRate.value = slewIndex;
  slewRate.max = slewRates.length - 1;
  document.getElementById('slewRateValue').textContent = formatSlewRate(slewIndex);
  slewRateModal = true;
  drawOverlays();
});

document.getElementById('slewRateNew').addEventListener('input', () => {
  const newIndex = parseInt(document.getElementById('slewRateNew').value, 10);
  document.getElementById('slewRateValue').textContent = formatSlewRate(newIndex);
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_SLEW_RATE', 'keys': [{'key': slewRates[newIndex].key, 'value': true}] });
});

document.getElementById('slewToggleTracking').addEventListener('click', (event) => {
  const key = tracking ? 'TRACK_OFF' : 'TRACK_ON';
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_TRACK_STATE', 'keys': [{'key': key, 'value': true}] });
});

document.getElementById('slewPark').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_PARK', 'keys': [{'key': 'PARK', 'value': true}] });
});

document.getElementById('slewUnpark').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_PARK', 'keys': [{'key': 'UNPARK', 'value': true}] });
});

document.getElementById('slewAbort').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_ABORT_MOTION', 'keys': [{'key': 'ABORT', 'value': true}] });
});

document.querySelectorAll('[data-focus]').forEach(button => {
  button.addEventListener('click', () => {
    sendFocuserCommand(button.dataset.focus, parseInt(button.dataset.amount));
  });
});

document.getElementById('focuserPosition').addEventListener('click', (event) => {
  const focusPos = document.getElementById('focuserPositionNew');
  focusPos.style.borderColor = '#555555';
  focusPos.value = focusPosition;

  const presetsLst = Object.entries(config.devices[focuser]?.presets ?? {}).map(([name, value]) => ({ name, value }));
  presetsLst.sort((a, b) => a.value - b.value);

  const presetsDiv = document.getElementById('focuserPresets');
  presetsDiv.innerHTML = "";
  presetsLst.forEach(preset => {
    const label = document.createElement('button');
    label.dataset.preset = preset.value;
    label.textContent = preset.value + ' - ' + preset.name;

    presetsDiv.appendChild(label);
  });

  document.querySelectorAll('[data-preset]').forEach(button => {
    button.addEventListener('click', () => {
      sendIndiMsg({
        'cmd': 'number',
        'device': focuser,
        'name': 'ABS_FOCUS_POSITION',
        'keys': [{'key': 'FOCUS_ABSOLUTE_POSITION', 'value': button.dataset.preset}]
      });
      focuserPositionModal = false;
      drawOverlays();
    });
  });

  focuserPositionModal = true;
  drawOverlays();
  focusPos.focus();
});

document.getElementById('focuserPositionSubmit').addEventListener('click', (event) => {
  const focusPos = document.getElementById('focuserPositionNew');
  focusPos.style.borderColor = '#555555';
  const focusPosVal = parseInt(focusPos.value.trim());
  if (isNaN(focusPosVal)) {
    focusPos.style.borderColor = '#ff4d4d';
  }
  else {
    sendIndiMsg({
      cmd: 'number',
      device: focuser,
      name: 'ABS_FOCUS_POSITION',
      keys: [{ key: 'FOCUS_ABSOLUTE_POSITION', value: focusPosVal }]
    });
    focuserPositionModal = false;
    drawOverlays();
  }
});

document.getElementById('focuserAbort').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': focuser, 'name': 'FOCUS_ABORT_MOTION', 'keys': [{'key': 'ABORT', 'value': true}] });
});

/////////////////////////////////
// Gamepad
//////////////////////////////////

setInterval(() => {
  const gamepads = navigator.getGamepads();
  if (!gamepads) return;

  const gp = gamepads[0];
  if (!gp) return;

  const x = gp.axes[config.gamepad?.directionX ?? 2];
  const y = gp.axes[config.gamepad?.directionY ?? 3];
  const magnitude = Math.sqrt(x*x + y*y);

  let stickDirs = { up: false, down: false, left: false, right: false };

  if (magnitude >= 0.2) {
    if (gamepadFastRateIndex == null) {
      gamepadFastRateIndex = slewIndex;
    }
    const slowIndex = Math.floor(gamepadFastRateIndex / 2);
    const rateIndex = magnitude > 0.6 ? gamepadFastRateIndex : slowIndex;

    if (rateIndex != gamepadPrevRateIndex) {
      // Stop all active directions before changing rate
      Object.keys(gamepadActiveDirs).forEach(dir => {
        if (gamepadActiveDirs[dir]) {
          sendMotionCommand(dir, false);
          gamepadActiveDirs[dir] = false;
        }
      });

      sendIndiMsg({
        cmd: "switch",
        device: mount,
        name: "TELESCOPE_SLEW_RATE",
        keys: [{ key: slewRates[rateIndex].key, value: true }]
      });
      gamepadPrevRateIndex = rateIndex;
    }

    const angle = Math.atan2(y, x);
    const sector = Math.round(angle / (Math.PI / 4)) & 7;
    const dirMap = [
      ["right"],         // 0 = 0° (east)
      ["right", "down"], // 1 = 45° (southeast)
      ["down"],          // 2 = 90° (south)
      ["left", "down"],  // 3 = 135° (southwest)
      ["left"],          // 4 = 180° (west)
      ["left", "up"],    // 5 = 225° (northwest)
      ["up"],            // 6 = 270° (north)
      ["right", "up"]    // 7 = 315° (northeast)
    ];
    dirMap[sector].forEach(dir => stickDirs[dir] = true);
  }
  else {
    if (gamepadFastRateIndex != null) {
      sendIndiMsg({
        cmd: "switch",
        device: mount,
        name: "TELESCOPE_SLEW_RATE",
        keys: [{ key: slewRates[gamepadFastRateIndex].key, value: true }]
      });
    }
    gamepadPrevRateIndex = null;
    gamepadFastRateIndex = null;
  }

  const dpadMapping = [
    { button: config.gamepad?.directionUp ?? 12, direction: "up" },
    { button: config.gamepad?.directionDown ?? 13, direction: "down" },
    { button: config.gamepad?.directionLeft ?? 14, direction: "left" },
    { button: config.gamepad?.directionRight ?? 15, direction: "right" },
  ];

  let dpadDirs = { up: false, down: false, left: false, right: false };
  dpadMapping.forEach(({ button, direction }) => {
    dpadDirs[direction] = gp.buttons[button].pressed;
  });

  Object.keys(gamepadActiveDirs).forEach(dir => {
    const shouldBeActive = stickDirs[dir] || dpadDirs[dir];
    if (shouldBeActive && !gamepadActiveDirs[dir]) {
      document.querySelectorAll('[data-direction="' + dir + '"]').forEach(button => {
        button.style.backgroundColor = '#f39c12';
      });

      sendMotionCommand(dir, true);
      gamepadActiveDirs[dir] = true;
    }
    else if (!shouldBeActive && gamepadActiveDirs[dir]) {
      document.querySelectorAll('[data-direction="' + dir + '"]').forEach(button => {
        button.style.backgroundColor = '';
      });

      sendMotionCommand(dir, false);
      gamepadActiveDirs[dir] = false;
    }
  });

  const focuserMapping = [
    { button: config.gamepad?.focusInSmall ?? 4, direction: 'FOCUS_INWARD',  amount: 10 },
    { button: config.gamepad?.focusOutSmall ?? 5, direction: 'FOCUS_OUTWARD', amount: 10 },
    { button: config.gamepad?.focusInLarge ?? 6, direction: 'FOCUS_INWARD',  amount: 100 },
    { button: config.gamepad?.focusOutLarge ?? 7, direction: 'FOCUS_OUTWARD', amount: 100 }
  ];

  focuserMapping.forEach(({ button, direction, amount }) => {
    const pressed = gp.buttons[button]?.pressed || false;

    if (pressed && !gamepadActiveButtons[button]) {
      document.querySelectorAll('[data-focus="' + direction + '"][data-amount="' + amount + '"]').forEach(button => {
        button.style.backgroundColor = '#f39c12';

        setTimeout(() => {
          button.style.backgroundColor = '';
        }, 300);
      });

      sendFocuserCommand(direction, amount);
    }

    gamepadActiveButtons[button] = pressed;
  });

}, 100);

/////////////////////////////////
// INDI
//////////////////////////////////

function sendMotionCommand(direction, state) {
  const reverseRa = config.devices[mount]?.reverseRa ?? false;
  const reverseDec = (pierSideWest ? config.devices[mount]?.reverseDecPierWest : config.devices[mount]?.reverseDecPierEast) ?? false;
  let axis;
  let key;
  let keyOpp;

  if (direction == 'up' || direction == 12) {
    axis = 'TELESCOPE_MOTION_NS';
    key = reverseDec ? 'MOTION_SOUTH' : 'MOTION_NORTH';
    keyOpp = reverseDec ? 'MOTION_NORTH' : 'MOTION_SOUTH';
  }
  else if (direction == 'down' || direction == 13) {
    axis = 'TELESCOPE_MOTION_NS';
    key = reverseDec ? 'MOTION_NORTH' : 'MOTION_SOUTH';
    keyOpp = reverseDec ? 'MOTION_SOUTH' : 'MOTION_NORTH';
  }
  else if (direction == 'left' || direction == 14) {
    axis = 'TELESCOPE_MOTION_WE';
    key = reverseRa ? 'MOTION_EAST' : 'MOTION_WEST';
    keyOpp = reverseRa ? 'MOTION_WEST' : 'MOTION_EAST';
  }
  else if (direction == 'right' || direction == 15) {
    axis = 'TELESCOPE_MOTION_WE';
    key = reverseRa ? 'MOTION_WEST' : 'MOTION_EAST';
    keyOpp = reverseRa ? 'MOTION_EAST' : 'MOTION_WEST';
  }
  else {
    console.log(`Unknown direction ${direction}`);
    return;
  }

  sendIndiMsg({
    cmd: 'switch',
    device: mount,
    name: axis,
    keys: [
      { key: key, value: state },
      { key: keyOpp, value: false }
    ]
  });
}

function sendFocuserCommand(direction, amount) {
  const backlashComp = config.devices[focuser]?.backlashComp ?? 0;

  sendIndiMsg({
    cmd: 'switch',
    device: focuser,
    name: 'FOCUS_MOTION',
    keys: [{ key: direction, value: true }]
  });

  if (direction === 'FOCUS_OUTWARD' && backlashComp) {
    sendIndiMsg({
      cmd: 'number',
      device: focuser,
      name: 'REL_FOCUS_POSITION',
      keys: [{ key: 'FOCUS_RELATIVE_POSITION', value: amount + backlashComp }]
    });
    completeBacklashComp = backlashComp;
  } else {
    sendIndiMsg({
      cmd: 'number',
      device: focuser,
      name: 'REL_FOCUS_POSITION',
      keys: [{ key: 'FOCUS_RELATIVE_POSITION', value: amount }]
    });
  }
}

function sendIndiMsg(msg) {
  if (ws.readyState !== WebSocket.OPEN) {
    console.log('WebSocket is not connected.');
    return;
  }
  ws.send(JSON.stringify(msg));
}

function handleIndiProp(data) {
    if (data.name == null) {
      config = data;
      mount = config.mount?.name;
      focuser = config.focuser?.name;

      const img = document.getElementById('finderscope');
      if (config.finderscope?.url != null) {
        console.log(`Setting finderscope url to ${config.finderscope?.url}`);
        img.src = config.finderscope?.url;
      }
      img.addEventListener("load", drawFinderscope);
      const observer = new ResizeObserver(drawFinderscope);
      observer.observe(img.parentElement);

      if (config.webui?.leftHanded && !leftHanded) {
        document.querySelectorAll('*').forEach(el => {
          if (el.style.left) {
            el.style.right = el.style.left;
            el.style.left = null;
          }
          else if (el.style.right) {
            el.style.left = el.style.right;
            el.style.right = null;
          }
        });
        leftHanded = true;
      }
      return;
    }

    if (mount == null && data.name == 'EQUATORIAL_EOD_COORD') {
      mount = data.device;
      console.log(`Detected mount ${mount}`);
      indiBuffer.forEach(handleIndiProp);
    }

    if (focuser == null && data.name == 'ABS_FOCUS_POSITION') {
      focuser = data.device;
      console.log(`Detected focuser ${focuser}`);
      indiBuffer.forEach(handleIndiProp);
    }

    if (indiBuffer.length >= 50) {
      indiBuffer.shift();
    }
    indiBuffer.push(data);

    if (data.name == 'CONNECTION') {
      const connected = data.keys.find(item => item.key == 'CONNECT').value;
      if (data.device == 'proxy') {
        indiConnected = connected;
        if (!connected) {
          mountConnected = null;
          focuserConnected = null;
          indiBuffer.length = 0;
        }
        drawOverlays();
        drawFinderscope();
        drawMountUi();
        drawFocuserUi();
      }
      else if (data.device == mount) {
        mountConnected = connected;
        drawFinderscope();
        drawMountUi();
      }
      else if (data.device == focuser) {
        focuserConnected = connected;
        drawFocuserUi();
      }
    }

    if (data.device == mount && data.name == 'TELESCOPE_PARK') {
      parking = data.state == 'Busy';
      parked = data.keys.find(item => item.key == 'PARK').value;
      drawMountUi();
    }

    if (data.device == mount && data.name == 'TELESCOPE_TRACK_STATE') {
      tracking = data.state == 'Busy';
      drawMountUi();
    }

    if (data.device == mount && data.name == 'TELESCOPE_SLEW_RATE') {
      slewRates = data.keys;
      slewIndex = slewRates.findIndex(item => item.value);
      drawMountUi();
    }

    if (data.device == mount && data.name == 'GEOGRAPHIC_COORD') {
      long = data.keys.find(item => item.key == 'LONG').value;
      lat = data.keys.find(item => item.key == 'LAT').value;
      elevation = data.keys.find(item => item.key == 'ELEV').value;
      generatePlanets();
      drawMountPosition();
    }

    if (data.device == mount && data.name == 'EQUATORIAL_EOD_COORD') {
      doingGoto = data.state == 'Busy';
      raHours = data.keys.find(item => item.key == 'RA').value;
      decDeg = data.keys.find(item => item.key == 'DEC').value;
      drawMountUi();
      drawMountPosition();
      generateFinderscopeUrl();
    }

    if (data.device == mount && data.name == 'TELESCOPE_MOTION_NS') {
      motionNs = data.state == 'Busy';
      drawMountUi();
    }

    if (data.device == mount && data.name == 'TELESCOPE_MOTION_WE') {
      motionWe = data.state == 'Busy';
      drawMountUi();
    }

    if (data.device == mount && data.name == 'TELESCOPE_PIER_SIDE') {
      pierSideWest = data.keys.find(item => item.key == 'PIER_WEST').value;
      drawFinderscope();
    }

    if (data.device == focuser && data.name == 'ABS_FOCUS_POSITION') {
      doingFocus = data.state == 'Busy';
      if (!doingFocus) {
        if (completeBacklashComp) {
          sendIndiMsg({'cmd': 'switch', 'device': focuser, 'name': 'FOCUS_MOTION', 'keys': [{'key': 'FOCUS_INWARD', 'value': true}] });
          sendIndiMsg({'cmd': 'number', 'device': focuser, 'name': 'REL_FOCUS_POSITION', 'keys': [{'key': 'FOCUS_RELATIVE_POSITION', 'value': completeBacklashComp}] });
        }
        completeBacklashComp = 0;
      }
      focusPosition = data.keys.find(item => item.key == 'FOCUS_ABSOLUTE_POSITION').value;
      drawFocuserUi();
    }
}

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected to ' + wsUrl);
    wsConnected = true;
    drawOverlays();
  }

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    }
    catch (e) {
      console.log('Received non-JSON message:', event.data);
    }

    handleIndiProp(data);
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed. Reconnecting...');
    wsConnected = false;
    indiConnected = null;
    mountConnected = null;
    focuserConnected = null;
    drawFinderscope();
    drawOverlays();
    drawMountUi();
    drawFocuserUi();
    setTimeout(connect, 3000);
  };

  ws.onerror = (err) => {
    console.log('WebSocket error: ' + err.message);
  };
}

generatePlanets();
connect();
setInterval(drawMountPosition, 1000);
