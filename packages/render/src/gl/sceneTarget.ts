/**
 * Scene render target (colour + emissive RGBA8, optional depth) with a completeness ladder.
 * ANGLE/D3D11 on basic/virtual adapters (Microsoft Basic Render, SraKmd, WARP) can report FRAMEBUFFER_UNSUPPORTED for
 * some depth formats: try DEPTH_COMPONENT24 -> DEPTH_COMPONENT16 -> DEPTH24_STENCIL8 -> no depth (sprites are
 * painter-sorted, so the world still draws) before giving up. Every combination is verified with checkFramebufferStatus.
 */
export type SceneDepth = "DEPTH_COMPONENT24" | "DEPTH_COMPONENT16" | "DEPTH24_STENCIL8" | "none";
export interface SceneTarget { fbo: WebGLFramebuffer; depthRb: WebGLRenderbuffer | null; depth: SceneDepth; status: number; tried: string[] }

export function sceneDepthOrder(safe: boolean): SceneDepth[] {
  return safe ? ["DEPTH_COMPONENT16", "DEPTH_COMPONENT24", "DEPTH24_STENCIL8", "none"] : ["DEPTH_COMPONENT24", "DEPTH_COMPONENT16", "DEPTH24_STENCIL8", "none"];
}

/** Build the scene FBO on the given colour textures; returns the first complete combination (or the last attempt, incomplete). */
export function buildSceneTarget(gl: WebGL2RenderingContext, color: WebGLTexture, emis: WebGLTexture, w: number, h: number, safe: boolean): SceneTarget {
  const tried: string[] = [];
  let last: SceneTarget | null = null;
  for (const depth of sceneDepthOrder(safe)) {
    if (last) { if (last.depthRb) gl.deleteRenderbuffer(last.depthRb); gl.deleteFramebuffer(last.fbo); }
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emis, 0);
    let rb: WebGLRenderbuffer | null = null;
    if (depth !== "none") {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl[depth], w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depth === "DEPTH24_STENCIL8" ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    tried.push(`${depth}=0x${status.toString(16)}`);
    last = { fbo, depthRb: rb, depth, status, tried };
    if (status === gl.FRAMEBUFFER_COMPLETE) break;
  }
  return last!;
}

/** Software / basic / virtual GPU adapters: start them on the low-end path (?gl=lowend) automatically. */
export const BASIC_ADAPTER = /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|basic render driver|srakmd|\bwarp\b|vmware svga|virtualbox|parallels display|citrix|remotefx|indirect display/i;
export function isBasicAdapter(renderer: string): boolean { return BASIC_ADAPTER.test(renderer); }
