/// <reference types="vite/client" />

import qpSpriteUrl from "../../../../../css/qp_icons.png";

const iconModules = import.meta.glob("../../../../../assets/ssms-icons-ver17/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

export const qpSpriteAssetUrl = qpSpriteUrl;

export const qpBundledIconUrls = new Map<string, string>(
  Object.entries(iconModules).map(([path, url]) => [path.split("/").pop() ?? "", url]),
);
