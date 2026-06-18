import { useTheme } from "../context/ThemeContext";
import { openCommandPalette } from "./CommandPalette";

const THEME_ICON: Record<string, string> = { light: "☀", dark: "☾", system: "◐" };
const THEME_LABEL: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export default function TitleBar() {
  const { mode, cycleMode } = useTheme();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-traffic-spacer" data-tauri-drag-region />
      <div className="titlebar-spacer" data-tauri-drag-region />
      <div className="titlebar-actions">
        <button
          className="titlebar-cmdk"
          onClick={() => openCommandPalette()}
          title="Command palette"
        >
          <span className="titlebar-cmdk-icon">⌘</span>K
        </button>
        <button
          className="titlebar-theme-toggle"
          onClick={cycleMode}
          title={`Theme: ${THEME_LABEL[mode]} (click to change)`}
        >
          {THEME_ICON[mode]}
        </button>
      </div>
    </div>
  );
}
