/// <reference types="vite/client" />

import qpModernIconsCss from "../../../../../css/qp-modern-icons.css?raw";
import { qpBundledIconUrls, qpSpriteAssetUrl } from "./asset-manifest";

export function getBundledQpStylesheetText() {
  let cssText = qpModernIconsCss.replace(/url\((['"]?)qp_icons\.png\1\)/g, `url("${qpSpriteAssetUrl}")`);

  cssText = cssText.replace(
    /url\((['"]?)\.\.\/assets\/ssms-icons-ver17\/([^'")]+)\1\)/g,
    (_match, _quote, fileName: string) => {
      const bundledUrl = qpBundledIconUrls.get(fileName);
      return bundledUrl ? `url("${bundledUrl}")` : "none";
    },
  );

  return cssText;
}
