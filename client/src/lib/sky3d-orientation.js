// Right-handed, east-left render basis for the inside-sphere sky.
//
// The shared raDecToSkyDirection contract is used by the 2D FIELD canvas and
// the space views. Seen from inside a sphere it puts increasing RA (east) on
// the right, mirroring the sky relative to the north-up/east-left rasters.
// Mirroring X here gives the 3D sphere a right-handed basis whose tangent
// planes, graticule and markers all agree with the source rasters.
//
// Camera convention: yaw is the right ascension the camera faces and pitch is
// the declination. Yaw increases eastward, which is screen-left.

import { raDecToSkyDirection } from './sky-coordinates.js';

const DEG = Math.PI / 180;

export function skyRenderDirection(raDeg, decDeg) {
  const [x, y, z] = raDecToSkyDirection(raDeg, decDeg);
  return [-x, y, z];
}

export function skyTangentBasis(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return {
    // d(skyRenderDirection)/d(RA), normalized.
    east: [-Math.cos(ra), 0, Math.sin(ra)],
    // d(skyRenderDirection)/d(Dec), normalized.
    north: [
      Math.sin(dec) * Math.sin(ra),
      Math.cos(dec),
      Math.sin(dec) * Math.cos(ra),
    ],
  };
}

export function raToYaw(raDeg) {
  return raDeg * DEG;
}

export function yawToRa(yawRad) {
  return (((yawRad / DEG) % 360) + 360) % 360;
}

// Camera axes for rotation order YXZ at (yaw, pitch), matching three.js.
export function cameraForward(yawRad, pitchRad) {
  const cosPitch = Math.cos(pitchRad);
  return [
    -cosPitch * Math.sin(yawRad),
    Math.sin(pitchRad),
    -cosPitch * Math.cos(yawRad),
  ];
}

export function cameraRight(yawRad) {
  return [Math.cos(yawRad), 0, -Math.sin(yawRad)];
}
