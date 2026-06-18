import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/**
 * Fire a native OS notification. No-op (and silent) outside a Tauri window or
 * if the user declines permission — safe to call from any context.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch {
    /* not in a Tauri window — ignore */
  }
}
