// INDI
const wsUrl = `ws://${window.location.hostname}:7626`;
let ws;
let wsConnected = false;
let indiConnected;
const indiBuffer = [];
let config = {devices: {}};

// Mount
let mount;
let mountConnected;
let slewRates;
let slewIndex;
let lat;
let long;
let ra;
let dec;
let parking;
let parked;
let motionNs;
let motionWe;
let doingGoto;
let gotoPos;
let tracking;
let pierSideWest;

// Focuser
let focuser;
let focuserConnected;
let doingFocus;
let focusPosition;

// Atlas
let aladin;
let scopeOverlay;
let scopeLocked = true;

/////////////////////////////////
// Helper functions
//////////////////////////////////

/**
 * Compute rectangle corners (with an outward arrow notch on the top edge)
 * around a center RA/Dec using tangent-plane + great-circle method.
 * Returns corners in clockwise order:
 *   bottom-left → bottom-right → top-right → notch-base-right → notch-peak → notch-base-left → top-left
 *
 * @param {number} ra0Deg      - Center RA in degrees (0–360)
 * @param {number} dec0Deg     - Center Dec in degrees (-90–90)
 * @param {number} widthArcmin - Rectangle width in arcminutes (east-west direction)
 * @param {number} heightArcmin- Rectangle height in arcminutes (north-south direction)
 * @param {number} paDeg       - Position angle in degrees (0 = north up, east left, positive = CCW)
 * @returns {Array<[number, number]>} Array of corners [RA_deg, Dec_deg], clockwise
 */
function rectangleCornersWithNotch(ra0Deg, dec0Deg, widthArcmin, heightArcmin, paDeg) {
  const ra0 = (ra0Deg * Math.PI) / 180.0;
  const dec0 = (dec0Deg * Math.PI) / 180.0;

  // convert to radians
  const w = (widthArcmin / 60.0) * (Math.PI / 180.0);  // width in radians
  const h = (heightArcmin / 60.0) * (Math.PI / 180.0); // height in radians
  const hw = w / 2.0; // half width
  const hh = h / 2.0; // half height

  const notchHW = 0.2 * hw;
  const notchH = 0.2 * hh;

  // Center unit vector
  const cx = Math.cos(dec0) * Math.cos(ra0);
  const cy = Math.cos(dec0) * Math.sin(ra0);
  const cz = Math.sin(dec0);

  // Local east (unit vector)
  const ex = -Math.sin(ra0);
  const ey = Math.cos(ra0);
  const ez = 0.0;

  // Local north (unit vector)
  const nx = -Math.cos(ra0) * Math.sin(dec0);
  const ny = -Math.sin(ra0) * Math.sin(dec0);
  const nz = Math.cos(dec0);

  // Rotation matrix in tangent plane
  const pa = (paDeg * Math.PI) / 180.0;
  const cosPA = Math.cos(pa);
  const sinPA = Math.sin(pa);
  function rotate(x, y) {
    return [x * cosPA - y * sinPA, x * sinPA + y * cosPA];
  }

  const corners = [];

  // define rectangle + notch offsets in **clockwise order**
  const offsets = [
    [-hw, -hh],               // bottom-left
    [ hw, -hh],               // bottom-right
    [ hw,  hh],               // top-right
    [ notchHW, hh],           // notch base right
    [ 0,      hh + notchH],   // notch peak (outward)
    [-notchHW, hh],           // notch base left
    [-hw,  hh],               // top-left
  ];

  for (const [x0, y0] of offsets) {
    // apply rotation in tangent plane
    const [x, y] = rotate(x0, y0);

    // Tangent-plane offset vector
    const dx = x * ex + y * nx;
    const dy = x * ey + y * ny;
    const dz = x * ez + y * nz;

    const sigma = Math.sqrt(dx * dx + dy * dy + dz * dz);

    let px, py, pz;
    if (sigma === 0) {
      // at the center
      px = cx; py = cy; pz = cz;
    } else {
      const s = Math.sin(sigma) / sigma;
      px = cx * Math.cos(sigma) + dx * s;
      py = cy * Math.cos(sigma) + dy * s;
      pz = cz * Math.cos(sigma) + dz * s;
    }

    // Convert back to RA, Dec
    let ra = Math.atan2(py, px) * 180.0 / Math.PI;
    if (ra < 0) ra += 360.0;
    const dec = Math.asin(pz) * 180.0 / Math.PI;

    corners.push([ra, dec]);
  }

  return corners;
}

function formatDegrees(decimalDegrees) {
  const degrees = Math.floor(decimalDegrees);
  const minutesFloat = (decimalDegrees - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.floor((minutesFloat - minutes) * 60);

  return `${degrees}° ${minutes}' ${seconds}"`;
}

function formatHours(decimalHours) {
  const hours = Math.floor(decimalHours);
  const minutesFloat = (decimalHours - hours) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.floor((minutesFloat - minutes) * 60);

  return `${hours}h ${minutes}m ${seconds}s`;
}

function raDecToAltAz(raHours, decDeg, latDeg, lonDeg, date = new Date()) {
    // this expects ra/dec as jnow, confirm that's what the mount is outputting

    const deg2rad = d => d * Math.PI / 180;
    const rad2deg = r => r * 180 / Math.PI;

    // Convert RA hours → degrees
    const raDeg = raHours * 15;

    // Convert longitude to -180..180 for sidereal time calc
    let lon = lonDeg > 180 ? lonDeg - 360 : lonDeg;

    // Julian Date
    const JD = (date.getTime() / 86400000) + 2440587.5;
    const T = (JD - 2451545.0) / 36525.0;

    // GMST in degrees
    let GMST = 280.46061837 +
               360.98564736629 * (JD - 2451545) +
               0.000387933 * T**2 -
               (T**3) / 38710000;
    GMST = ((GMST % 360) + 360) % 360;

    // LST in degrees
    let LST = (GMST + lon) % 360;
    if (LST < 0) LST += 360;

    // Hour Angle
    let HA = (LST - raDeg) % 360;
    if (HA < 0) HA += 360;

    // Convert to radians
    const HA_rad = deg2rad(HA);
    const dec_rad = deg2rad(decDeg);
    const lat_rad = deg2rad(latDeg);

    // Altitude
    const sinAlt = Math.sin(dec_rad) * Math.sin(lat_rad) +
                   Math.cos(dec_rad) * Math.cos(lat_rad) * Math.cos(HA_rad);
    const alt = rad2deg(Math.asin(sinAlt));

    // Azimuth (north=0°, east=90°)
    let cosAz = (Math.sin(dec_rad) - Math.sin(deg2rad(alt)) * Math.sin(lat_rad)) /
                (Math.cos(deg2rad(alt)) * Math.cos(lat_rad));
    cosAz = Math.max(-1, Math.min(1, cosAz)); // clamp to [-1, 1]
    let az = rad2deg(Math.acos(cosAz));

    // Instead of flipping, use HA to determine correct hemisphere
    if (Math.sin(HA_rad) > 0) {
        az = 360 - az; // ensures az=0 is north, 90 is east
    }

    return { az, alt };
}

/////////////////////////////////
// Drawing
//////////////////////////////////

function drawOverlays() {
  if (!wsConnected) {
    document.getElementById('overlayMessage').textContent = '🔌 Disconnected from webserver';
    document.getElementById('overlay').style.display = 'flex';
  }
  else if (!indiConnected) {
    document.getElementById('overlayMessage').textContent = '🔌 Disconnected from INDI';
    document.getElementById('overlay').style.display = 'flex';
  }
  else {
    document.getElementById('overlay').style.display = 'none';

    if (mountConnected == null) {
      document.getElementById('mountOverlayMessage').textContent = '🔌 Mount Not Found';
      document.getElementById('mountOverlay').style.display = 'flex';
    }
    else if (!mountConnected) {
      document.getElementById('mountOverlayMessage').textContent = '🔌 Mount Disconnected';
      document.getElementById('mountOverlay').style.display = 'flex';
    }
    else {
      document.getElementById('mountOverlay').style.display = 'none';
    }
    if (focuserConnected == null) {
      document.getElementById('focuserOverlayMessage').textContent = '🔌 Focuser Not Found';
      document.getElementById('focuserOverlay').style.display = 'flex';
    }
    else if (!focuserConnected) {
      document.getElementById('focuserOverlayMessage').textContent = '🔌 Focuser Disconnected';
      document.getElementById('focuserOverlay').style.display = 'flex';
    }
    else {
      document.getElementById('focuserOverlay').style.display = 'none';
    }
  }
}

function drawFinderscope() {
  const img = document.getElementById('finderscope');

  if (img.src == null ||! img.complete) {
    return;
  }

  let scopeRotation = config.finderscope?.rotation ?? 0;
  const scopeFlipPierEast = config.finderscope?.flipPierEast ?? false;
  if (!pierSideWest && scopeFlipPierEast) {
    scopeRotation = (scopeRotation + 180) % 360;
  }
  const rad = scopeRotation * Math.PI / 180;
  const card = img.parentElement;
  const rotatedHeight = Math.abs(img.width * Math.sin(rad)) + Math.abs(img.height * Math.cos(rad));
  img.style.transform = `translate(0px, ${(rotatedHeight - img.height)/2}px) rotate(${scopeRotation}deg)`;
  card.style.height = `${rotatedHeight}px`;

  const canvas = document.getElementById('finderscopeCanvas');
  canvas.width = card.clientWidth;
  canvas.height = card.clientHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  let drawReticle = true;

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
    const rectWidth  = img.width  * (cameraFovX / scopeFovX);
    const rectHeight = img.height * (cameraFovY / scopeFovY);
    const hw = rectWidth / 2;
    const hh = rectHeight / 2;
    const notchHW = 0.2 * hw;
    const notchH = 0.2 * hh;

    if (rectWidth < 50 || rectHeight < 50) {
      drawReticle = false;
    }

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
    ctx.rotate((cameraRotation - 180) * Math.PI / 180); // radians
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

  // Draw reticle
  if (drawReticle) {
    const gap = 5;
    const len = 10;
    ctx.strokeStyle = '#b232b2';
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

function drawAtlas() {
  if (aladin == null) {
    return;
  }

  if (!mountConnected || ra == null || dec == null) {
    scopeOverlay.hide();
    if (mountConnected == null) {
      document.getElementById('atlasButtonsOverlayMessage').textContent = '🔌 Mount Not Found';
    }
    else {
      document.getElementById('atlasButtonsOverlayMessage').textContent = '🔌 Mount Disconnected';
    }
    document.getElementById('atlasButtonsOverlay').style.display = 'flex';
    return;
  }

  if (parking) {
    document.getElementById('atlasButtonsOverlayMessage').textContent = '🚗 Parking';
    document.getElementById('atlasButtonsOverlay').style.display = 'flex';
  }
  else if (parked) {
    document.getElementById('atlasButtonsOverlayMessage').textContent = '🚗 Parked';
    document.getElementById('atlasButtonsOverlay').style.display = 'flex';
  }
  else if (doingGoto) {
    document.getElementById('atlasButtonsOverlayMessage').textContent = '🎯 Going to target';
    document.getElementById('atlasButtonsOverlay').style.display = 'flex';
  }
  else if (scopeLocked) {
    document.getElementById('atlasButtonsOverlayMessage').textContent = '🔒 Locked onto scope';
    document.getElementById('atlasButtonsOverlay').style.display = 'flex';
  }
  else {
    document.getElementById('atlasButtonsOverlay').style.display = 'none';
  }

  // convert jnow to ICRS?

  if (scopeLocked) {
    aladin.gotoRaDec(ra * 15, dec == 90 ? 89.9999 : dec);
    aladin.setRotation(0);
  }

  scopeOverlay.removeAll();
  const scopeFovX = config.finderscope?.fovx;
  const scopeFovY = config.finderscope?.fovy;
  if (scopeFovX && scopeFovY) {
    let scopeRotation = (config.finderscope?.rotation ?? 0);
    const scopeFlipPierEast = config.finderscope?.flipPierEast ?? false;
    if (!pierSideWest && scopeFlipPierEast) {
      scopeRotation = (scopeRotation + 180) % 360;
    }
    corners = rectangleCornersWithNotch(ra * 15, dec == 90 ? 89.9999 : dec, scopeFovX * 60, scopeFovY * 60, scopeRotation);
    scopeOverlay.add(A.polygon(corners));
  }
  const cameraFovX = config.camera?.fovx;
  const cameraFovY = config.camera?.fovy;
  if (cameraFovX && cameraFovY) {
    let cameraRotation = config.camera?.rotation ?? 0;
    const cameraFlipPierEast = config.camera?.flipPierEast ?? false;
    if (!pierSideWest && cameraFlipPierEast) {
      cameraRotation = (cameraRotation + 180) % 360;
    }
    corners = rectangleCornersWithNotch(ra * 15, dec == 90 ? 89.9999 : dec, cameraFovX * 60, cameraFovY * 60, cameraRotation);
    scopeOverlay.add(A.polygon(corners));
  }
  scopeOverlay.show();
}

function drawMountPosition() {
  if (ra == null || dec == null || lat == null || long == null) {
    return;
  }

  document.getElementById('ra').textContent = formatHours(ra);
  document.getElementById('dec').textContent = formatDegrees(dec);
  document.getElementById('long').textContent = formatDegrees(long > 180 ? (360 - long) : long) + (long > 180 ? ' W' : ' E');
  document.getElementById('lat').textContent = formatDegrees(Math.abs(lat)) + (lat > 0 ? ' N' : ' S');

  const result = raDecToAltAz(ra, dec, lat, long);
  document.getElementById('az').textContent = formatDegrees(result.az);
  document.getElementById('alt').textContent = formatDegrees(result.alt);

  const canvas = document.getElementById('coordsIndicator');
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
  const r = radius * (1 - result.alt / 90);
  const theta = (result.az / 360) * 2 * Math.PI - Math.PI / 2;
  ctx.fillStyle = '#f39c12';
  ctx.beginPath();
  ctx.arc(center + r * Math.cos(theta), center + r * Math.sin(theta), 5, 0, 2 * Math.PI);
  ctx.fill();

  if (!parking && doingGoto) {
    const gotoResult = raDecToAltAz(gotoPos[0] / 15, gotoPos[1], lat, long);
    const r = radius * (1 - gotoResult.alt / 90);
    const theta = (gotoResult.az / 360) * 2 * Math.PI - Math.PI / 2;
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
  const overlay = document.getElementById('slewOverlay');
  const overlayMessage = document.getElementById('slewOverlayMessage');
  const statusEl = document.getElementById('mountStatus');
  const trackingBtn = document.getElementById('toggleTracking');
  const unparkBtn = document.getElementById('unpark');
  const abortGotoBtn = document.getElementById('abortGoto');

  if (parking) {
    statusEl.textContent = '🚗 Parking';
    statusEl.style.color = '#f39c12';
    overlayMessage.textContent = '🚗 Parking';
    overlay.style.display = 'flex';
    unparkBtn.style.display = 'none';
    abortGotoBtn.style.display = 'flex';
  }
  else if (parked) {
    statusEl.textContent = '🚗 Parked';
    statusEl.style.color = '#ff4d4d';
    overlayMessage.textContent = '🚗 Parked';
    overlay.style.display = 'flex';
    unparkBtn.style.display = 'block';
    abortGotoBtn.style.display = 'none';
  }
  else if (motionNs || motionWe) {
    const movingAxes = [];
    if (motionNs) movingAxes.push('NS');
    if (motionWe) movingAxes.push('WE');
    statusEl.textContent = `🚀 Moving ${movingAxes.join(' & ')}`;
    statusEl.style.color = '#f39c12';
  }
  else if (doingGoto) {
    statusEl.textContent = '🎯 Going to target';
    statusEl.style.color = '#f39c12';
    overlayMessage.textContent = '🎯 Going to target';
    overlay.style.display = 'flex';
    unparkBtn.style.display = 'none';
    abortGotoBtn.style.display = 'flex';
  }
  else if (tracking) {
    statusEl.textContent = '🔒 Tracking';
    statusEl.style.color = '#2e7d32';
    trackingBtn.textContent = '🔓 Stop Tracking';
  }
  else {
    statusEl.textContent = 'Idle';
    statusEl.style.color = '#fff';
  }

  if (!parked && !parking && !doingGoto) {
    overlay.style.display = 'none';
  }

  if (!tracking) {
    trackingBtn.textContent = '🔒 Track';
  }

  if (slewRates != null && slewIndex != null) {
    document.getElementById('slewRate').value = slewIndex;
    document.getElementById('slewRate').max = slewRates.length - 1;
    document.getElementById('slewValue').textContent = slewRates[slewIndex].key;
  }
}

function drawFocuserUi() {
  const presetsLst = Object.entries(config.devices[focuser]?.presets ?? {}).map(([name, value]) => ({ name, value }));
  presetsLst.sort((a, b) => a.value - b.value);

  const focuserAbs = document.getElementById('focuserAbs');
  focuserAbs.innerHTML = "";
  presetsLst.forEach(preset => {
    const label = document.createElement('label');

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'focusAbs';
    input.value = preset.value;

    const valueSpan = document.createElement('span');
    valueSpan.textContent = preset.value;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'title';
    titleSpan.textContent = preset.name;

    label.appendChild(input);
    label.appendChild(valueSpan);
    label.appendChild(titleSpan);

    focuserAbs.appendChild(label);
  });

  document.querySelectorAll('input[name="focusAbs"]').forEach(radio => {
    radio.addEventListener('change', () => {
      sendIndiMsg({'cmd': 'number', 'device': focuser, 'name': 'ABS_FOCUS_POSITION', 'keys': [{'key': 'FOCUS_ABSOLUTE_POSITION', 'value': parseInt(radio.value)}] });
    });
  });

  if (doingFocus == null || focusPosition == null) {
    return;
  }

  const overlay = document.getElementById('focuserControlsOverlay');
  const statusElFocus = document.getElementById('focusStatus');

  if (doingFocus) {
    statusElFocus.textContent = '🚀 Moving';
    statusElFocus.style.color = '#ff4d4d';
    overlay.style.display = 'flex';
  }
  else {
    statusElFocus.textContent = 'Idle';
    statusElFocus.style.color = '#fff';
    overlay.style.display = 'none';
  }

  document.getElementById('focusPosition').textContent = focusPosition;
  document.querySelectorAll('input[name="focusAbs"]').forEach(radio => {
    radio.checked = parseInt(radio.value) == focusPosition;
  });
}

/////////////////////////////////
// Event handlers
//////////////////////////////////

document.getElementById('recenter').addEventListener('click', (event) => {
  scopeLocked = !scopeLocked;
  drawAtlas();
});

document.getElementById('sync').addEventListener('click', (event) => {
  const pos = aladin.getRaDec();
  // convert ICRS to jnow?
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'ON_COORD_SET', 'keys': [{'key': 'SYNC', 'value': true}] });
  sendIndiMsg({
    cmd: 'number',
    device: mount,
    name: 'EQUATORIAL_EOD_COORD',
    keys: [
      { key: 'RA', value: pos[0] / 15 },
      { key: 'DEC', value: pos[1] }
    ]
  });
});

document.getElementById('goto').addEventListener('click', (event) => {
  gotoPos = aladin.getRaDec();
  // convert ICRS to jnow?
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'ON_COORD_SET', 'keys': [{'key': 'TRACK', 'value': true}] });
  sendIndiMsg({
    cmd: 'number',
    device: mount,
    name: 'EQUATORIAL_EOD_COORD',
    keys: [
      { key: 'RA', value: gotoPos[0] / 15 },
      { key: 'DEC', value: gotoPos[1] }
    ]
  });
});

document.getElementById('mountReconnect').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'CONNECTION', 'keys': [{'key': 'DISCONNECT', 'value': true}] });
});

document.querySelectorAll('[data-direction]').forEach((button) => {
  let isPressed = false;

  function send(state) {
    const reverseRa = config.devices[mount]?.reverseRa ?? false;
    const reverseDec = (pierSideWest ? config.devices[mount]?.reverseDecPierWest : config.devices[mount]?.reverseDecPierEast) ?? false;
    let axis;
    let key;
    let keyOpp;

    if (button.dataset.direction == 'up') {
      axis = 'TELESCOPE_MOTION_NS';
      key = reverseDec ? 'MOTION_SOUTH' : 'MOTION_NORTH';
      keyOpp = reverseDec ? 'MOTION_NORTH' : 'MOTION_SOUTH';
    }
    else if (button.dataset.direction == 'down') {
      axis = 'TELESCOPE_MOTION_NS';
      key = reverseDec ? 'MOTION_NORTH' : 'MOTION_SOUTH';
      keyOpp = reverseDec ? 'MOTION_SOUTH' : 'MOTION_NORTH';
    }
    else if (button.dataset.direction == 'left') {
      axis = 'TELESCOPE_MOTION_WE';
      key = reverseRa ? 'MOTION_EAST' : 'MOTION_WEST';
      keyOpp = reverseRa ? 'MOTION_WEST' : 'MOTION_EAST';
    }
    else if (button.dataset.direction == 'right') {
      axis = 'TELESCOPE_MOTION_WE';
      key = reverseRa ? 'MOTION_WEST' : 'MOTION_EAST';
      keyOpp = reverseRa ? 'MOTION_EAST' : 'MOTION_WEST';
    }
    else {
      console.log(`Unknown direction ${button.dataset.direction}`);
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

  function start(event) {
    if (!isPressed) {
      isPressed = true;
      send(true);
    }
  }

  function stop(event) {
    if (isPressed) {
      isPressed = false;
      send(false);
    }
  }

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointercancel', stop);
});

document.getElementById('slewRate').addEventListener('input', () => {
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_SLEW_RATE', 'keys': [{'key': slewRates[parseInt(document.getElementById('slewRate').value, 10)].key, 'value': true}] });
});

document.getElementById('toggleTracking').addEventListener('click', (event) => {
  const key = tracking ? 'TRACK_OFF' : 'TRACK_ON';
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_TRACK_STATE', 'keys': [{'key': key, 'value': true}] });
});

document.getElementById('park').addEventListener('click', (event) => {
  scopeLocked = false;
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_PARK', 'keys': [{'key': 'PARK', 'value': true}] });
});

document.getElementById('unpark').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_PARK', 'keys': [{'key': 'UNPARK', 'value': true}] });
});

document.getElementById('abortGoto').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'TELESCOPE_ABORT_MOTION', 'keys': [{'key': 'ABORT', 'value': true}] });
});

document.getElementById('focuserReconnect').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': focuser, 'name': 'CONNECTION', 'keys': [{'key': 'DISCONNECT', 'value': true}] });
});

document.querySelectorAll('[data-focus]').forEach((button) => {
  // TODO backlash compensation
  button.addEventListener('click', () => {
    sendIndiMsg({'cmd': 'switch', 'device': focuser, 'name': 'FOCUS_MOTION', 'keys': [{'key': button.dataset.focus, 'value': true}] });
    sendIndiMsg({'cmd': 'number', 'device': focuser, 'name': 'REL_FOCUS_POSITION', 'keys': [{'key': 'FOCUS_RELATIVE_POSITION', 'value': button.dataset.amount}] });
  });
});

document.getElementById('abortFocus').addEventListener('click', (event) => {
  sendIndiMsg({'cmd': 'switch', 'device': focuser, 'name': 'FOCUS_ABORT_MOTION', 'keys': [{'key': 'ABORT', 'value': true}] });
});

/////////////////////////////////
// INDI
//////////////////////////////////

function sendIndiMsg(msg) {
  if (ws.readyState !== WebSocket.OPEN) {
    console.log('WebSocket is not connected.');
    return;
  }
  ws.send(JSON.stringify(msg));
}

function initFinderscope() {
  const url = config.finderscope?.url;
  if (url != null) {
    console.log(`Setting finderscope url to ${url}`);

    const img = document.getElementById('finderscope');
    img.src = url;
    img.addEventListener("load", drawFinderscope);
    const observer = new ResizeObserver(drawFinderscope);
    observer.observe(img);

    document.getElementById('finderscopeCard').style.display = 'block';
  }
}

function initAladin() {
  A.init.then(() => {
    const scopeFovX = config.finderscope?.fovx;
    const cameraFovX = config.camera?.fovx;

    aladin = A.aladin('#aladin', {
      fov: scopeFovX * 1.5 || cameraFovX * 15 || 6,
      showProjectionControl: false,
      showFullscreenControl: false,
      showLayersControl: false,
      showFrame: false,
      showCooLocation: false,
      showZoomControl: false,
      reticleColor: '#b232b2'
    });

    scopeOverlay = A.graphicOverlay({color: '#f39c12', lineWidth: 1});
    aladin.addOverlay(scopeOverlay);

    aladin.on('positionChanged', function(posChanged) {
      if (posChanged.dragging) {
        aladin.setRotation(0);
        scopeLocked = false;
        drawAtlas();
      }
    });

    drawAtlas();
  });
}

function initMount() {
  if (mount == null) {
    return;
  }

  document.getElementById('mountTitle').textContent = mount;
  document.getElementById('mountCard').style.display = 'block';
  document.getElementById('atlasMountControls').style.display = 'flex';
  setInterval(drawMountPosition, 1000);
}

function initFocuser() {
  if (focuser == null) {
    return;
  }

  document.getElementById('focuserTitle').textContent = focuser;
  document.getElementById('focuserCard').style.display = 'block';
  drawFocuserUi();
}

function handleIndiProp(data) {
    if (data.name == null) {
      config = data;
      initAladin();
      initFinderscope();
      mount = config.mount?.name;
      initMount();
      focuser = config.focuser?.name;
      initFocuser();
      return;
    }

    if (mount == null && data.name == 'EQUATORIAL_EOD_COORD') {
      mount = data.device;
      console.log(`Detected mount ${mount}`);
      indiBuffer.forEach(handleIndiProp);
      initMount();
    }

    if (focuser == null && data.name == 'ABS_FOCUS_POSITION') {
      focuser = data.device;
      console.log(`Detected focuser ${focuser}`);
      indiBuffer.forEach(handleIndiProp);
      initFocuser();
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
        drawAtlas();
        drawOverlays();
      }
      else if (data.device == mount) {
        mountConnected = connected;
        drawAtlas();
        drawOverlays();
      }
      else if (data.device == focuser) {
        focuserConnected = connected;
        drawOverlays();
      }
    }

    if (data.device == mount && data.name == 'TELESCOPE_PARK') {
      parking = data.state == 'Busy';
      parked = data.keys.find(item => item.key == 'PARK').value;
      drawMountUi();
      drawAtlas();
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
      drawMountPosition();
    }

    if (data.device == mount && data.name == 'EQUATORIAL_EOD_COORD') {
      doingGoto = data.state == 'Busy';
      ra = data.keys.find(item => item.key == 'RA').value;
      dec = data.keys.find(item => item.key == 'DEC').value;
      drawMountPosition();
      drawMountUi();
      drawAtlas();
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
      drawAtlas();
    }

    if (data.device == focuser && data.name == 'ABS_FOCUS_POSITION') {
      doingFocus = data.state == 'Busy';
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
    drawOverlays();
    drawAtlas();
    setTimeout(connect, 3000);
  };

  ws.onerror = (err) => {
    console.log('WebSocket error: ' + err.message);
  };
}

connect();
