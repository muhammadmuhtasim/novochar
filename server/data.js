// Seeded deterministic pseudo-random generator so the simulated data is stable
// across server restarts. Everything here is *placeholder/simulated* data meant
// to stand in for real NASA SPHEREx telemetry. Swap the generators with real
// API responses without changing the client contract.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = {
  TNO: 'Trans-Neptunian Object',
  AST: 'Asteroid',
  HPM: 'High Proper-Motion Star',
};

const PASS_NAMES = [
  'SPX-ORBIT-01',
  'SPX-ORBIT-02',
  'SPX-ORBIT-03',
  'SPX-ORBIT-04',
  'SPX-ORBIT-05',
  'SPX-ORBIT-06',
];

const TYPE_FONT = ['TNO', 'AST', 'HPM'];

// SPHEREx observes broad swaths of the ecliptic plane. We place our simulated
// survey field around a tract of sky so the sky viewer has a coherent region.
const FIELD = { raCenter: 84.0, decCenter: -58.0, raHalf: 14.0, decHalf: 9.0 };

export function generateSurvey() {
  const rand = mulberry32(0x53505845); // "SPX"
  const passes = [];

  // 6 months, ~ weekly passes => 24 passes
  for (let i = 0; i < 24; i++) {
    const passCount = i + 1;
    const dateEpoch = Date.UTC(2026, 0, 5) + Math.round(i * 8.5) * 86400;
    const progress = Math.min(1, i / 23);
    passes.push({
      id: `pass-${String(passCount).padStart(2, '0')}`,
      code: `P-${String(passCount).padStart(2, '0')}`,
      name: PASS_NAMES[i % PASS_NAMES.length],
      index: passCount,
      epochISO: new Date(dateEpoch).toISOString(),
      epochJD: 2461000 + i * 8.5,
      band: ['0.75-2.4 µm', '0.75-5 µm', '1.1-3.0 µm'][i % 3],
      ra: FIELD.raCenter + (rand() - 0.5) * FIELD.raHalf,
      dec: FIELD.decCenter + (rand() - 0.5) * FIELD.decHalf,
      fov: 0.43 + rand() * 0.2,
      expTime: 44.2 + rand() * 20,
      status: progress < 0.6 ? 'scheduled' : i % 3 === 0 ? 'processing' : 'complete',
      completion: Math.round(progress * 1000) / 10,
    });
  }

  // --- Candidate objects ---
  const objects = [];
  const names = [
    '2026 SX1', '2026 DB71', '2026 HM2', '2002 TC302 b', '2026 QJ5',
    '2026 AR13', '2025 VB9', '2026 LP4', '2004 XR190 c', '2026 MB3',
    '2026 KK1', '2007 OR10 a', '2026 ZD7', '2026 NT2', '2026 FG8',
    '2026 YX4', '2005 RM43', '2026 WA6', '2026 CJ9', '2026 BV5',
  ];

  const motionType = { TNO: [0.2, 2.5], AST: [8, 60], HPM: [60, 900] };

  for (let i = 0; i < 40; i++) {
    const type = TYPE_FONT[Math.floor(rand() * TYPE_FONT.length)];
    const id = `NC-${String(i + 1).padStart(3, '0')}`;
    const ra = FIELD.raCenter + (rand() - 0.5) * FIELD.raHalf * 2;
    const dec = FIELD.decCenter + (rand() - 0.5) * FIELD.decHalf * 2;
    const [mLo, mHi] = motionType[type];
    const motion = mLo + Math.pow(rand(), 1.6) * (mHi - mLo);
    const baseMag =
      type === 'TNO' ? 19 + rand() * 3.5 : type === 'AST' ? 15 + rand() * 4 : 4.5 + rand() * 10;
    const name = names[i % names.length];
    const discoveryPass = passes[Math.floor(rand() * passes.length)];

    objects.push({
      id,
      name,
      type,
      typeLabel: TYPES[type],
      ra,
      dec,
      mag: Math.round(baseMag * 10) / 10,
      motion: Math.round(motion * 100) / 100,
      motionUnits: 'mas/day',
      discovered: discoveryPass.code,
      epochOfDiscovery: discoveryPass.epochJD,
      flags: [
        ...(type === 'HPM' ? ['HPM'] : []),
        ...(motion > 40 ? ['FAST'] : []),
        ...(baseMag < 18 ? ['BRIGHT'] : []),
        ...(type === 'TNO' ? ['TNO'] : []),
      ],
      orbit: {
        a: Math.round((type === 'TNO' ? 34 + rand() * 60 : type === 'AST' ? 2.2 + rand() * 1.5 : 0) * 10) / 10,
        e: Math.round(rand() * 0.75 * 100) / 100,
        i: Math.round(rand() * 45 * 10) / 10,
      },
      note:
        type === 'TNO' ? 'Candidate detached TNO; blended flux across adjacent bands.' :
        type === 'AST' ? 'Main-belt candidate with measurable parallax between passes.' :
        'High proper-motion field star; constant flux, large angular drift.',
      status: rand() > 0.65 ? 'confirmed' : 'candidate',
      color: type === 'TNO' ? '#ff6a00' : type === 'AST' ? '#ff8618' : '#ffb454',
    });
  }

  return { survey: { field: FIELD, mission: 'SPHEREx' }, passes, objects };
}

// Build a time-series of "blink frames" for one object across the survey passes.
// Frames simulate an astrometric centroid path plus Gaussian noise, so real
// differential motion emerges when frames are blinked. Deterministic per object.
export function buildFrames(object, passes, count = 18) {
  const idx = parseInt(object.id.slice(3), 10) || 1;
  const rand = mulberry32(idx * 7919 + 13);
  const frames = [];
  const total = Math.min(count, passes.length);
  for (let i = 0; i < total; i++) {
    const p = passes[i];
    const dtDays = i * 8.5;
    const dRA = (object.motion / 1000) * dtDays * 0.55;
    const dDec = (object.motion / 1000) * dtDays * 0.31;
    const noise = (rand() - 0.5) * object.motion * 0.18;

    frames.push({
      pass: p.id,
      passCode: p.code,
      epochISO: p.epochISO,
      epochJD: p.epochJD,
      ra: object.ra + dRA * 0.9 + noise * 0.35,
      dec: object.dec + dDec * 0.9 + noise * 0.35,
      measuredMag: object.mag + (rand() - 0.5) * 0.4,
      snr: Math.round((6 + Math.abs(rand()) * 9) * 10) / 10,
      flux: Math.round((4 + Math.abs(rand()) * 30) * 10) / 10,
      flagged: !!(rand() > 0.82),
      quality: ['G', 'G', 'G', 'C'][Math.min(3, Math.floor(rand() * 4))],
    });
  }
  return frames;
}

// Optional real-NASA integration. Without an API key we fall back to a small,
// static sample set so the feature works out of the box.
export async function fetchNEO(key) {
  if (!key) {
    return {
      source: 'fallback',
      note: 'No NASA API key configured — showing sample close-approach objects.',
      near_earth_objects: generateSampleNEO(),
    };
  }
  const url =
    `https://api.nasa.gov/neo/rest/v1/neo/browse?api_key=${encodeURIComponent(key)}&size=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA API returned ${res.status}`);
  const json = await res.json();
  return { source: 'nasa', near_earth_objects: json.near_earth_objects || json };
}

function generateSampleNEO() {
  const rand = mulberry32(99);
  const prefixes = ['2026', '2025', '2024'];
  const out = [];
  for (let i = 0; i < 6; i++) {
    out.push({
      neo_reference_id: String(3800000 + Math.floor(rand() * 90000)),
      name: `${prefixes[i % 3]} ${['XA', 'DB', 'QM', 'VL'][i % 4]}${Math.floor(rand() * 90 + 10)}`,
      absolute_magnitude_h: Math.round((14 + rand() * 8) * 10) / 10,
      estimated_diameter_max: Math.round((0.1 + rand() * 0.9) * 100) / 100,
      is_potentially_hazardous_asteroid: rand() > 0.5,
      close_approach: { distance_lunar: Math.round((1 + rand() * 18) * 10) / 10 },
    });
  }
  return out;
}