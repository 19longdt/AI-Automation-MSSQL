export interface QpQueryActionContext {
  block?: HTMLElement;
  queryText?: string;
}

export interface QpWindowApi {
  __bundle?: string;
  showPlan(el: HTMLElement, xml: string): void;
  drawLines(el: HTMLElement): void;
  bindQueryActions(
    el: HTMLElement,
    cbs: {
      onOpenQueryPopup?(ctx: QpQueryActionContext): void;
      onShowPlanXml?(ctx: QpQueryActionContext): void;
      onCopyPlanXml?(ctx: QpQueryActionContext): void;
      onBeautify?(ctx: QpQueryActionContext): void;
    },
  ): void;
  buildXmlTreeHtml?(xml: string): string;
  beautifySqlWithFallback?(sql: string): Promise<string>;
  applyBeautifyToBlock?(block: HTMLElement): void;
}

declare global {
  interface Window {
    QP?: QpWindowApi;
  }
}
