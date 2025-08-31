const AU_KM = 149597870.7;

const PLANETS = {
  mercury: {
    a0: 0.38709927, e0: 0.20563593, I0: 7.00497902, L0: 252.25032350, W0: 77.45779628, O0: 48.33076593,
    at: 0.00000037, et: 0.00001906, It: -0.00594749, Lt: 149472.67411175, Wt: 0.16047689, Ot: -0.12534081,
    radiusAU: 2439.7 / AU_KM
  },
  venus: {
    a0: 0.72333566, e0: 0.00677672, I0: 3.39467605, L0: 181.97909950, W0: 131.60246718, O0: 76.67984255,
    at: 0.00000390, et: -0.00004107, It: -0.00078890, Lt: 58517.81538729, Wt: 0.00268329, Ot: -0.27769418,
    radiusAU: 6051.8 / AU_KM
  },
  "EM Bary": {
    a0: 1.00000261, e0: 0.01671123, I0: -0.00001531, L0: 100.46457166, W0: 102.93768193, O0: 0.0,
    at: 0.00000562, et: -0.00004392, It: -0.01294668, Lt: 35999.37244981, Wt: 0.32327364, Ot: 0.0,
    radiusAU: 6378.1 / AU_KM
  },
  mars: {
    a0: 1.52371034, e0: 0.09339410, I0: 1.84969142, L0: -4.55343205, W0: -23.94362959, O0: 49.55953891,
    at: 0.00001847, et: -0.00007882, It: -0.00813131, Lt: 19140.30268499, Wt: 0.44441088, Ot: -0.29257343,
    radiusAU: 3389.5 / AU_KM
  },
  jupiter: {
    a0: 5.20288700, e0: 0.04838624, I0: 1.30439695, L0: 34.39644051, W0: 14.72847983, O0: 100.47390909,
    at: -0.00011607, et: -0.00013253, It: -0.00183714, Lt: 3034.74612775, Wt: 0.21252668, Ot: 0.20469106,
    radiusAU: 69911 / AU_KM
  },
  saturn: {
    a0: 9.53667594, e0: 0.05386179, I0: 2.48599187, L0: 49.95424423, W0: 92.59887831, O0: 113.66242448,
    at: -0.00125060, et: -0.00050991, It: 0.00193609, Lt: 1222.49362201, Wt: -0.41897216, Ot: -0.28867794,
    radiusAU: 58232 / AU_KM
  },
  uranus: {
    a0: 19.18916464, e0: 0.04725744, I0: 0.77263783, L0: 313.23810451, W0: 170.95427630, O0: 74.01692503,
    at: -0.00196176, et: -0.00004397, It: -0.00242939, Lt: 428.48202785, Wt: 0.40805281, Ot: 0.04240589,
    radiusAU: 25362 / AU_KM
  },
  neptune: {
    a0: 30.06992276, e0: 0.00859048, I0: 1.77004347, L0: -55.12002969, W0: 44.96476227, O0: 131.78422574,
    at: 0.00026291, et: 0.00005105, It: 0.00035372, Lt: 218.45945325, Wt: -0.32241464, Ot: -0.00508664,
    radiusAU: 24622 / AU_KM
  }
};

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

// Focuser
let focuser;
let focuserConnected;
let doingFocus;
let focusPosition;
let completeBacklashComp;

// Atlas
let aladin;
let scopeOverlay;
let scopeLocked = true;

/////////////////////////////////
// Helper functions
//////////////////////////////////

function deg2rad(d) { return d * Math.PI / 180; }

function rad2deg(r) { return r * 180 / Math.PI; }

function julian2000Century(date) {
  const JD = (date.getTime() / 86400000) + 2440587.5;
  return (JD - 2451545.0) / 36525.0;
}

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

/**
 * Convert J2000 ecliptic coordinates to J2000 equatorial coordinates
 */
function eclipticToEquatorial(x, y, z) {
  const eps = deg2rad(23.439291)
  return {
    x: x,
    y: y * Math.cos(eps) - z * Math.sin(eps),
    z: y * Math.sin(eps) + z * Math.cos(eps)
  }
}

function cartesianToRadec(v) {
  const r = Math.sqrt(v.x**2 + v.y**2 + v.z**2);
  const ra = Math.atan2(v.y, v.x);
  const dec = Math.asin(v.z / r);
  let raDeg = (rad2deg(ra) + 360) % 360;
  return { raHours: raDeg / 15, decDeg: rad2deg(dec) };
}

function radecToCartesian(raHours, decDeg) {
  const a = deg2rad(raHours * 15);
  const d = deg2rad(decDeg);
  return { x: Math.cos(d)*Math.cos(a), y: Math.cos(d)*Math.sin(a), z: Math.sin(d) };
}

function rotVectorX(v) {
  const c = Math.cos(v)
  const s = Math.sin(v);
  return [[1,0,0], [0,c,-s], [0,s,c]];
}

function rotVectorZ(v) {
  const c = Math.cos(v)
  const s = Math.sin(v);
  return [[c,-s,0], [s,c,0], [0,0,1]];
}

function multiplyMatrix(A, B) {
  const R = [];
  for(let i = 0; i < 3; i++) {
    R[i] = [];
    for(let j = 0; j < 3; j++){
      R[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return R;
}

function transposeMatrix(M) {
  return [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]]
  ];
}

function applyMatrix(M, v) {
  return {
    x: M[0][0] * v.x + M[0][1] * v.y + M[0][2] * v.z,
    y: M[1][0] * v.x + M[1][1] * v.y + M[1][2] * v.z,
    z: M[2][0] * v.x + M[2][1] * v.y + M[2][2] * v.z
  };
}

function solveKeplerEquation(M, e) {
	let e1 = rad2deg(e);
	let E0 = M + e1 * Math.sin(deg2rad(M));
	let tolerance = 10e-6;
	let dE;
	let dM;
	let E1 = E0;
	let E2 = 0;
	let difE1E2 = 1;

	for (let i = 0; (i < 1000) && (difE1E2 > tolerance); i++){
		dM = M - (E1 - e1 * Math.sin(deg2rad(E1)));
		dE = dM / (1 - e * Math.cos(deg2rad(E1)));
		E2 = E1 + dE;
		difE1E2 = Math.abs(E1 - E2);
	}
	return E2;
}

/**
 * Calculate the cartesian heliocentric coordinates of a planet on the J2000 ecliptic plane, with the x-axis aligned toward the equinox
 *
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 */
function getPlanetPosition(name, date=new Date()) {
  const el = PLANETS[name];
  const T = julian2000Century(date);

  const a = el.a0 + el.at * T;
  const e = el.e0 + el.et * T;
  const I = el.I0 + el.It * T;
  const L = el.L0 + el.Lt * T;
  const W = el.W0 + el.Wt * T;
  const O = el.O0 + el.Ot * T;

  const w = W - O;

  let M = L - W;
  if(M < -180 || M > 180) M = M % 360;

  const E = solveKeplerEquation(M, e);

  const x1 = a * (Math.cos(deg2rad(E)) - e);
  const y1 = a * Math.sqrt(1 - (e * e)) * Math.sin(deg2rad(E));

  const cosw = Math.cos(deg2rad(w)), sinw = Math.sin(deg2rad(w));
  const cosO = Math.cos(deg2rad(O)), sinO = Math.sin(deg2rad(O));
  const cosI = Math.cos(deg2rad(I)), sinI = Math.sin(deg2rad(I));

  const Xecl = (cosw * cosO - sinw * sinO * cosI) * x1 + (-sinw * cosO - cosw * sinO * cosI) * y1;
  const Yecl = (cosw * sinO + sinw * cosO * cosI) * x1 + (-sinw * sinO + cosw * cosO * cosI) * y1;
  const Zecl = (sinw * sinI) * x1 + (cosw * sinI) * y1;

  return {x: Xecl, y: Yecl, z: Zecl};
}

function recalulatePlanets() {
  const earthVec = getPlanetPosition("EM Bary");

  Object.keys(PLANETS).forEach(name => {
    if (name == 'EM Bary') return;

    const vec = getPlanetPosition(name);
    // convert to be geocentric J2000 equatorial coordinates
    const dx = vec.x - earthVec.x;
    const dy = vec.y - earthVec.y;
    const dz = vec.z - earthVec.z;
    const eq = eclipticToEquatorial(dx, dy, dz);
    const pos = cartesianToRadec(eq);

    PLANETS[name].raHours = pos.raHours;
    PLANETS[name].decDeg = pos.decDeg;
    PLANETS[name].distance = Math.sqrt(dx**2 + dy**2 + dz**2);
    PLANETS[name].size = rad2deg(3600 * 2 * PLANETS[name].radiusAU / PLANETS[name].distance);
  });
}

function rectangleCornersWithNotch(raDeg, decDeg, widthArcmin, heightArcmin, rotation) {
  const center = radecToCartesian(raDeg / 15, decDeg);

  const ra0 = deg2rad(raDeg);
  const dec0 = deg2rad(decDeg);
  const east  = { x: -Math.sin(ra0), y:  Math.cos(ra0), z: 0 };
  const north = { x: -Math.cos(ra0) * Math.sin(dec0), y: -Math.sin(ra0) * Math.sin(dec0), z:  Math.cos(dec0) };

  const w  = deg2rad(widthArcmin / 60.0);
  const h  = deg2rad(heightArcmin / 60.0);
  const hw = w / 2.0;
  const hh = h / 2.0;
  const notchHW = 0.2 * hw;
  const notchH  = 0.2 * hh;

  const pa = deg2rad(rotation);
  const cosPA = Math.cos(pa), sinPA = Math.sin(pa);
  function rotate(x, y) {
    return [x * cosPA - y * sinPA, x * sinPA + y * cosPA];
  }

  const offsets = [
    [-hw, -hh],              // bottom-left
    [ hw, -hh],              // bottom-right
    [ hw,  hh],              // top-right
    [ notchHW, hh],          // notch base right
    [ 0,       hh + notchH], // notch peak
    [-notchHW, hh],          // notch base left
    [-hw,  hh],              // top-left
  ];

  const corners = [];
  for (const [x0, y0] of offsets) {
    const [x, y] = rotate(x0, y0);

    const dx = x * east.x + y * north.x;
    const dy = x * east.y + y * north.y;
    const dz = x * east.z + y * north.z;

    const sigma = Math.sqrt(dx**2 + dy**2 + dz**2);

    let point;
    if (sigma === 0) {
      point = {x: center.x, y: center.y, z: center.z};
    }
    else {
      const s = Math.sin(sigma) / sigma;
      const c = Math.cos(sigma);
      point = {
        x: center.x * c + dx * s,
        y: center.y * c + dy * s,
        z: center.z * c + dz * s,
      }
    }

    const radec = cartesianToRadec(point);
    corners.push([radec.raHours * 15, radec.decDeg]);
  }

  return corners;
}

/**
 * Convert EOD equatorial coordinates to Alt/Az
 */
function raDecToAltAz(raHours, decDeg, latDeg, lonDeg, date = new Date()) {
    // Convert longitude to -180..180 for sidereal time calc
    let lon = lonDeg > 180 ? lonDeg - 360 : lonDeg;

    const T = julian2000Century(date);

    // GMST in degrees
    let GMST = 280.46061837 +
               360.98564736629 * (T * 36525) +
               0.000387933 * T**2 -
               (T**3) / 38710000;
    GMST = ((GMST % 360) + 360) % 360;

    // LST in degrees
    let LST = (GMST + lon) % 360;
    if (LST < 0) LST += 360;

    // Hour Angle
    let HA = (LST - raHours * 15) % 360;
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

/**
 * IAU2006 (P03) precession matrix builder (flip X-rotation signs)
 */
function precessionMatrix2006(T) {
  const psiA = 5038.481507*T - 1.0790069*T*T - 0.00114045*Math.pow(T,3) + 0.000132851*Math.pow(T,4) - 0.0000000951*Math.pow(T,5);
  const omegaA = 84381.406 - 0.025754*T + 0.0512623*T*T - 0.00772503*Math.pow(T,3) - 0.000000467*Math.pow(T,4) + 0.0000003337*Math.pow(T,5);
  const chiA = 10.556403*T - 2.3814292*T*T - 0.00121197*Math.pow(T,3) + 0.000170663*Math.pow(T,4) - 0.0000000560*Math.pow(T,5);

  const psi = deg2rad(psiA/3600);
  const omg = deg2rad(omegaA/3600);
  const chi = deg2rad(chiA/3600);
  const eps0 = deg2rad(-84381.406/3600);

  let P = rotVectorX(eps0);
  P = multiplyMatrix(rotVectorZ(-psi), P);
  P = multiplyMatrix(rotVectorX(+omg), P);
  P = multiplyMatrix(rotVectorZ(chi), P);
  return P;
}

function precessEodToJ2000(raHours, decDeg, date=new Date()) {
  const T = julian2000Century(date);
  const P = precessionMatrix2006(T);
  const v = radecToCartesian(raHours, decDeg);
  return cartesianToRadec(applyMatrix(P, v));
}

function precessJ2000ToEod(raHours, decDeg, date=new Date()) {
  const T = julian2000Century(date);
  const P = precessionMatrix2006(T);
  const Pt = transposeMatrix(P);
  const v = radecToCartesian(raHours, decDeg);
  return cartesianToRadec(applyMatrix(Pt, v));
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
  const rad = deg2rad(scopeRotation);
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

  // TODO show planets

  if (!mountConnected || raHours == null || decDeg == null) {
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

  const j2000Pos = precessEodToJ2000(raHours, decDeg);

  if (scopeLocked) {
    aladin.gotoRaDec(j2000Pos.raHours * 15, j2000Pos.decDeg == 90 ? 89.9999 : j2000Pos.decDeg);
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
    corners = rectangleCornersWithNotch(j2000Pos.raHours * 15, j2000Pos.decDeg == 90 ? 89.9999 : j2000Pos.decDeg, scopeFovX * 60, scopeFovY * 60, scopeRotation);
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
    corners = rectangleCornersWithNotch(j2000Pos.raHours * 15, j2000Pos.decDeg == 90 ? 89.9999 : j2000Pos.decDeg, cameraFovX * 60, cameraFovY * 60, cameraRotation);
    scopeOverlay.add(A.polygon(corners));
  }
  scopeOverlay.show();
}

function drawMountPosition() {
  if (raHours == null || decDeg == null || lat == null || long == null) {
    return;
  }

  document.getElementById('ra').textContent = formatHours(raHours);
  document.getElementById('dec').textContent = formatDegrees(decDeg, true);
  document.getElementById('long').textContent = formatDegrees(long > 180 ? (360 - long) : long) + (long > 180 ? ' W' : ' E');
  document.getElementById('lat').textContent = formatDegrees(Math.abs(lat)) + (lat > 0 ? ' N' : ' S');

  const result = raDecToAltAz(raHours, decDeg, lat, long);
  document.getElementById('az').textContent = formatDegrees(result.az);
  document.getElementById('alt').textContent = formatDegrees(result.alt, true);

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
    const gotoResult = raDecToAltAz(gotoPos.raHours, gotoPos.decDeg, lat, long);
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

document.getElementById('atlasSearch').addEventListener('submit', (event) => {
  event.preventDefault();

  const search = document.getElementById('searchText');
  search.style.borderColor = '#555555';
  const searchVal = search.value.trim().toLowerCase();
  if (searchVal) {
    const planet = PLANETS?.[searchVal] ?? null;
    if (planet) {
      aladin.gotoRaDec(planet.raHours * 15, planet.decDeg);
      aladin.setRotation(0);
      scopeLocked = false;
      drawAtlas();
    }
    else {
      aladin.gotoObject(searchVal, {success: function(raDec) {
        scopeLocked = false;
        drawAtlas();
      }, error: function() {
        search.style.borderColor = '#ff4d4d';
      }});
    }
  }
});

document.getElementById('recenter').addEventListener('click', (event) => {
  scopeLocked = !scopeLocked;
  drawAtlas();
});

document.getElementById('sync').addEventListener('click', (event) => {
  const j2000Pos = aladin.getRaDec();
  const pos = precessJ2000ToEod(j2000Pos[0] / 15, j2000Pos[1]);
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'ON_COORD_SET', 'keys': [{'key': 'SYNC', 'value': true}] });
  sendIndiMsg({
    cmd: 'number',
    device: mount,
    name: 'EQUATORIAL_EOD_COORD',
    keys: [
      { key: 'RA', value: pos.raHours },
      { key: 'DEC', value: pos.decDeg }
    ]
  });
});

document.getElementById('goto').addEventListener('click', (event) => {
  const j2000Pos = aladin.getRaDec();
  gotoPos = precessJ2000ToEod(j2000Pos[0] / 15, j2000Pos[1]);
  sendIndiMsg({'cmd': 'switch', 'device': mount, 'name': 'ON_COORD_SET', 'keys': [{'key': 'TRACK', 'value': true}] });
  sendIndiMsg({
    cmd: 'number',
    device: mount,
    name: 'EQUATORIAL_EOD_COORD',
    keys: [
      { key: 'RA', value: gotoPos.raHours },
      { key: 'DEC', value: gotoPos.decDeg }
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
  button.addEventListener('click', () => {
    const backlashComp = config.devices[focuser]?.backlashComp ?? 0;
    sendIndiMsg({'cmd': 'switch', 'device': focuser, 'name': 'FOCUS_MOTION', 'keys': [{'key': button.dataset.focus, 'value': true}] });
    if (button.dataset.focus == 'FOCUS_OUTWARD' && backlashComp) {
      sendIndiMsg({'cmd': 'number', 'device': focuser, 'name': 'REL_FOCUS_POSITION', 'keys': [{'key': 'FOCUS_RELATIVE_POSITION', 'value': parseInt(button.dataset.amount) + backlashComp}] });
      completeBacklashComp = backlashComp;
    }
    else {
      sendIndiMsg({'cmd': 'number', 'device': focuser, 'name': 'REL_FOCUS_POSITION', 'keys': [{'key': 'FOCUS_RELATIVE_POSITION', 'value': button.dataset.amount}] });
    }
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
      document.getElementById('aladinPos').textContent = `${formatHours(posChanged.ra / 15)} ${formatDegrees(posChanged.dec, true)}`;

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
      recalulatePlanets();
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
      raHours = data.keys.find(item => item.key == 'RA').value;
      decDeg = data.keys.find(item => item.key == 'DEC').value;
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
    drawOverlays();
    drawAtlas();
    setTimeout(connect, 3000);
  };

  ws.onerror = (err) => {
    console.log('WebSocket error: ' + err.message);
  };
}

connect();
