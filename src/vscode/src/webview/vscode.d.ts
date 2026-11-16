// [VSCODE-WEBVIEW-TYPES] VS Code webview API globals.
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
