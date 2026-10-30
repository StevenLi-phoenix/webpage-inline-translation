import { hasOrigins, providerOrigins } from "../shared/access";
import { ProviderError } from "../shared/errors";
import type { ExtensionSettings } from "../shared/types";

/**
 * Network access to a translation service is granted by the user on a click. Without it the
 * browser reports an opaque CORS failure, so say what to do instead.
 */
export async function assertProviderAccess(settings: ExtensionSettings, providerId = settings.activeProviderId): Promise<void> {
  const origins = providerOrigins(settings.providers.find(provider => provider.id === providerId));
  if (await hasOrigins(origins)) return;
  const hosts = origins.map(origin => origin.replace(/^https?:\/\//u, "").replace(/\/\*$/u, "")).join("、");
  throw new ProviderError(`需要先授权访问 ${hosts}：请点击扩展图标，在弹窗里翻译一次并允许访问。`, "permission-required");
}
