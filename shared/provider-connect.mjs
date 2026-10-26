import { providerDefinitions, providerId } from "./providers.mjs";

export const providerConnectEvent = "splece:connect-provider";

export function connectionRequest(value = {}) {
  if (!value || typeof value !== "object") return null;
  const provider = providerId(value.provider);
  if (!providerDefinitions.some((item) => item.id === provider)) return null;
  return {
    provider,
    feature: typeof value.feature === "string" ? value.feature.slice(0, 120) : "",
    returnLabel: typeof value.returnLabel === "string" && value.returnLabel.trim()
      ? value.returnLabel.slice(0, 80)
      : "Back to my work",
  };
}

export function providerNeedsConnection(connections, provider, mode) {
  // Offline samples never depend on an external account. An existing, unverified
  // key remains usable; only absence or a known restriction requires setup.
  if (mode !== "live" && mode !== "venice") return false;
  if (!Array.isArray(connections)) return false;
  const id = providerId(provider);
  if (!providerDefinitions.some((item) => item.id === id)) return false;
  const connection = connections.find((item) => item.id === id);
  return !connection?.hasKey || connection.accessPermitted === false;
}
