/** Device-agnostic input: devices write actions; sim reads a per-tick InputFrame (serializable, sent to server). */
export const enum Action { MoveUp = 0, MoveDown, MoveLeft, MoveRight, Primary, Secondary, Interact, Build, Count }
export interface InputFrame { tick: number; buttons: number; aimX: number; aimY: number }
export class InputState {
  private buttons = 0; aimX = 0; aimY = 0;
  press(a: Action): void { this.buttons |= 1 << a; }
  release(a: Action): void { this.buttons &= ~(1 << a); }
  isDown(a: Action): boolean { return (this.buttons & (1 << a)) !== 0; }
  sample(tick: number): InputFrame { return { tick, buttons: this.buttons, aimX: this.aimX, aimY: this.aimY }; }
}
