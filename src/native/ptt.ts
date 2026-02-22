import { mainWindow } from "./window";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { uIOhook, UiohookKey } = require("uiohook-napi");

// Build reverse map from UiohookKey enum: keycode -> name
const KEY_NAMES = new Map<number, string>();
for (const [name, code] of Object.entries(UiohookKey)) {
  if (typeof code === "number") {
    KEY_NAMES.set(code, name);
  }
}

// Active PTT keybind (uiohook keycodes)
let pttKeybind: number[] = [];
let isRecording = false;

/**
 * Dispatch a CustomEvent into the renderer via executeJavaScript.
 * Bypasses the preload entirely to avoid styling issues.
 */
function dispatchToRenderer(eventName: string, detail: unknown) {
  try {
    mainWindow.webContents.executeJavaScript(
      `document.dispatchEvent(new CustomEvent('${eventName}', { detail: ${JSON.stringify(detail)} }))`,
    );
  } catch {
    // Window may not be ready yet
  }
}

/**
 * Sync the keybind from the renderer's window.__pttKeybind global.
 */
async function syncKeybind() {
  try {
    const keybind = await mainWindow.webContents.executeJavaScript(
      "window.__pttKeybind || []",
    );
    if (Array.isArray(keybind) && keybind.length > 0) {
      pttKeybind = keybind;
    }
  } catch {
    // Not ready yet
  }
}

/**
 * Check if the renderer has requested keybind recording.
 */
async function checkRecordingRequest() {
  try {
    const shouldRecord = await mainWindow.webContents.executeJavaScript(
      "(() => { const v = window.__pttStartRecording; window.__pttStartRecording = false; return v; })()",
    );
    if (shouldRecord) {
      isRecording = true;
    }
  } catch {
    // Not ready yet
  }
}

/**
 * Initialise push-to-talk support.
 * Uses executeJavaScript for all IPC to avoid modifying the preload.
 */
export function initPtt() {
  // Poll keybind and recording requests from the renderer every 500ms
  setInterval(() => {
    syncKeybind();
    checkRecordingRequest();
  }, 500);

  // Start the global keyboard hook
  uIOhook.on("keydown", (e: { keycode: number }) => {
    if (isRecording) {
      isRecording = false;
      const keycode = e.keycode;
      const name = KEY_NAMES.get(keycode) ?? `Key${keycode}`;
      dispatchToRenderer("ptt-keybind-recorded", {
        keycodes: [keycode],
        names: [name],
      });
      return;
    }

    if (pttKeybind.includes(e.keycode)) {
      dispatchToRenderer("ptt-status-change", { pressed: true });
    }
  });

  uIOhook.on("keyup", (e: { keycode: number }) => {
    if (pttKeybind.includes(e.keycode)) {
      dispatchToRenderer("ptt-status-change", { pressed: false });
    }
  });

  uIOhook.start();
}
