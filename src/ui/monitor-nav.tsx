import type { PluginSurfaceContext } from "@ericsanchezok/synergy-plugin";
import MonitorPanel from "./monitor-panel";

/**
 * Sidebar navigation page for the Research Monitor.
 *
 * The host passes the full PluginSurfaceContext directly as component props
 * (createComponent(loaded.default, context)), so this wrapper spreads the
 * context through to the shared MonitorPanel implementation.
 */
export default function MonitorNavigation(context: PluginSurfaceContext) {
  return <MonitorPanel {...context} />;
}
