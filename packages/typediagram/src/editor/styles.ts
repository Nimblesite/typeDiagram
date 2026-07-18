// [EDITOR-DESIGN] Shared Architectural Blueprint canvas styles for web + VS Code.
import { runWhen } from "./effects.js";
export const VISUAL_EDITOR_CSS = `
.td-visual-editor{--td-bg:#0b1326;--td-low:#131b2e;--td-high:#222a3d;--td-highest:#2d3449;--td-bright:#31394d;--td-text:#dae2fd;--td-muted:#87929a;--td-primary:#8ed5ff;--td-secondary:#ddb7ff;--td-tertiary:#45e3ce;position:relative;overflow:hidden;background-color:var(--td-bg);background-image:linear-gradient(rgba(142,213,255,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(142,213,255,.032) 1px,transparent 1px),radial-gradient(circle,rgba(142,213,255,.12) 1px,transparent 1.5px);background-size:40px 40px,40px 40px,8px 8px;color:var(--td-text);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;touch-action:none;cursor:grab}
.td-visual-editor.td-is-panning{cursor:grabbing}
.td-visual-editor .viewport-wrapper{position:absolute;inset:0 auto auto 0;will-change:transform}
.td-visual-editor svg{display:block;max-width:none;overflow:visible;user-select:none}
.td-visual-editor [data-decl]{cursor:move;filter:url(#td-ambient-shadow);transition:filter 140ms ease}
.td-visual-editor [data-decl]:hover{filter:url(#td-hover-shadow)}
.td-visual-editor [data-decl].td-selected>rect:first-of-type{stroke:var(--td-primary);stroke-width:1.5;stroke-opacity:.6}
.td-visual-editor .td-port{fill:var(--td-highest);stroke:var(--td-primary);stroke-width:1.5;opacity:0;cursor:crosshair;transition:opacity 120ms ease,fill 120ms ease,r 120ms ease}
.td-visual-editor [data-decl]:hover>.td-port,.td-visual-editor [data-decl].td-selected>.td-port{opacity:1}
.td-visual-editor .td-port:hover{fill:var(--td-primary);r:6}
.td-visual-editor .td-target-port{stroke:var(--td-tertiary)}
.td-visual-editor .td-connection-preview{fill:none;stroke:var(--td-tertiary);stroke-width:2;stroke-dasharray:5 4;pointer-events:none}
.td-canvas-toolbar{position:absolute;z-index:8;left:18px;bottom:18px;display:flex;align-items:center;gap:3px;padding:5px;background:rgba(34,42,61,.78);backdrop-filter:blur(12px);box-shadow:0 20px 40px rgba(0,0,0,.4);border-radius:6px}
.td-canvas-button{height:34px;min-width:34px;padding:0 9px;border:0;border-radius:3px;background:transparent;color:var(--td-text);font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}
.td-canvas-button:hover,.td-canvas-button[aria-pressed=true]{background:var(--td-bright);color:var(--td-primary)}
.td-canvas-button:focus-visible,.td-icon-button:focus-visible,.td-node-kind-button:focus-visible,.td-inspector-delete:focus-visible{outline:0;border-bottom:2px solid var(--td-primary)}
.td-zoom-value{min-width:50px;color:var(--td-muted);pointer-events:none}
.td-canvas-separator{width:1px;height:20px;margin:0 3px;background:rgba(135,146,154,.25)}
.td-node-creator{position:absolute;z-index:9;left:18px;bottom:64px;display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:6px;background:rgba(34,42,61,.92);backdrop-filter:blur(12px);box-shadow:0 20px 40px rgba(0,0,0,.4);border-radius:4px}.td-node-creator[hidden]{display:none}.td-node-kind-button{height:36px;padding:0 13px;border:0;border-radius:3px;background:var(--td-highest);color:var(--td-text);font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.td-node-kind-button:hover{background:var(--td-bright);color:var(--td-primary)}
.td-canvas-legend{position:absolute;z-index:7;right:18px;bottom:18px;display:flex;gap:14px;padding:9px 12px;background:rgba(34,42,61,.72);backdrop-filter:blur(12px);box-shadow:0 20px 40px rgba(0,0,0,.32);border-radius:3px;color:var(--td-muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
.td-legend-item{display:flex;align-items:center;gap:6px}.td-legend-swatch{width:3px;height:13px;background:var(--td-primary)}.td-legend-union{background:var(--td-secondary)}.td-legend-alias{background:var(--td-tertiary)}
.td-inspector{position:absolute;z-index:10;top:18px;right:18px;width:min(320px,calc(100% - 36px));max-height:calc(100% - 92px);overflow:auto;padding:16px;background:rgba(34,42,61,.88);backdrop-filter:blur(12px);box-shadow:0 20px 40px rgba(0,0,0,.4);border-radius:3px;color:var(--td-text)}
.td-inspector[hidden]{display:none}.td-inspector-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.td-inspector-kind{color:var(--td-primary);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.td-icon-button{display:inline-grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid rgba(135,146,154,.22);border-radius:4px;background:rgba(19,27,46,.72);color:var(--td-muted);cursor:pointer;transition:background 120ms ease,color 120ms ease,border-color 120ms ease}.td-icon-button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round}.td-icon-button:hover{border-color:rgba(142,213,255,.38);background:var(--td-bright);color:var(--td-text)}.td-inspector-close{flex:0 0 auto}
.td-inspector label{display:block;margin:10px 0 5px;color:var(--td-muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase}.td-inspector input{width:100%;height:34px;padding:0 9px;border:0;border-bottom:2px solid transparent;border-radius:2px;background:#131b2e;color:var(--td-text);font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;outline:0}.td-inspector input:focus{border-bottom-color:var(--td-primary)}
.td-inspector-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) 34px;gap:7px;align-items:end}.td-inspector-row--union{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) 34px}.td-inspector-remove{width:34px;height:34px}.td-inspector-remove:hover{border-color:rgba(255,180,171,.38);color:#ffb4ab}.td-inspector-add{width:100%;height:34px;margin-top:12px;border:0;border-radius:3px;background:#174966;color:var(--td-primary);font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.td-inspector-add:hover{background:#205c7d}.td-inspector-delete{width:100%;height:34px;margin-top:8px;border:0;border-radius:3px;background:rgba(255,180,171,.08);color:#ffb4ab;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.td-inspector-delete:hover{background:rgba(255,180,171,.16)}
.td-editor-toast{position:absolute;z-index:12;top:18px;left:50%;transform:translateX(-50%);padding:9px 12px;border-radius:3px;background:rgba(49,57,77,.9);box-shadow:0 14px 32px rgba(0,0,0,.32);color:#ffb4ab;font-size:11px;pointer-events:none}
@media(max-width:700px){.td-canvas-legend{display:none}.td-inspector{top:10px;right:10px}.td-canvas-toolbar{left:10px;bottom:10px}.td-node-creator{left:10px;bottom:56px}.td-canvas-button{min-width:32px;padding:0 7px}}
`;

export const installVisualEditorStyles = (doc: Document = document) => {
  const current = doc.querySelector("style[data-td-visual-editor]");
  const style = current ?? doc.createElement("style");
  style.setAttribute("data-td-visual-editor", "true");
  style.textContent = VISUAL_EDITOR_CSS;
  runWhen(current === null, () => {
    doc.head.appendChild(style);
  });
};
