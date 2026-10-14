import * as THREE from 'three';

export class FreeFlightControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = false;
    this.keys = new Set();
    this.speed = 16;
    this.boost = 4;
    this.lookSensitivity = 0.0022;
    this.rollSpeed = 1.4;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.direction = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this._onClick = () => { if (!this.enabled) this.domElement.requestPointerLock?.(); };
    this._onLock = () => {
      const enabled = document.pointerLockElement === this.domElement;
      if (enabled !== this.enabled) this.keys.clear();
      this.enabled = enabled;
    };
    this._onMouse = e => {
      if (!this.enabled) return;
      this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.euler.y -= e.movementX * this.lookSensitivity;
      this.euler.x -= e.movementY * this.lookSensitivity;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
      this.camera.quaternion.setFromEuler(this.euler);
    };
    this._onKeyDown = e => {
      const key = e.key.toLowerCase();
      if ([' ', 'control', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
      this.keys.add(key);
    };
    this._onKeyUp = e => this.keys.delete(e.key.toLowerCase());
    this._onBlur = () => this.keys.clear();
    domElement.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onLock);
    document.addEventListener('mousemove', this._onMouse);
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  update(dt) {
    // Flight controls are active only while this canvas owns pointer lock.
    // Keyboard listeners remain global so key-up can be observed reliably,
    // but stale/held keys must never move the camera outside flight mode.
    if (!this.enabled) return;

    // Q/E roll around the camera's forward axis.
    const roll = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
    if (roll) {
      const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), roll * this.rollSpeed * dt);
      this.camera.quaternion.multiply(rollQ);
    }

    this.direction.set(
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0),
      (this.keys.has(' ') ? 1 : 0) - (this.keys.has('control') ? 1 : 0),
      (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0)
    );
    if (this.direction.lengthSq() === 0) return;
    this.direction.normalize();
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const move = new THREE.Vector3();
    move.addScaledVector(this.right, this.direction.x);
    move.addScaledVector(this.up, this.direction.y);
    move.addScaledVector(this.forward, -this.direction.z);
    const velocity = this.speed * (this.keys.has('shift') ? this.boost : 1) * dt;
    this.camera.position.addScaledVector(move.normalize(), velocity);
  }

  dispose() {
    this.enabled = false;
    this.keys.clear();
    this.domElement.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onLock);
    document.removeEventListener('mousemove', this._onMouse);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
