import { LOCAL_MODEL_ORIGINS, requestOrigins } from "../shared/access";
import { sendRuntimeMessage } from "../shared/messaging";
import { importModelFiles } from "./model-store";
import { getLocalModel, getLocalRoute, LOCAL_MODELS, LOCAL_RESOURCE_NOTICE, modelBytes, normalizeLocalLanguage, type LocalModelStatus } from "./models";
import "./control.css";

const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

export function setupLocalModelControl(container: HTMLElement, source: string, target: string): () => void {
  let route = "自动检测使用浏览器的本地语言识别。请预先准备可能用到的语言模型；源语言和目标语言都不是英语时，需要「源语言 → 英语」和「英语 → 目标语言」两个模型。短文本识别不准时，可手动选择源语言。";
  let selectedId = LOCAL_MODELS.find((model) => model.to === normalizeLocalLanguage(target))?.id ?? "en-zh-Hans";
  try {
    if (source !== "auto") {
      const models = getLocalRoute(source, target);
      route = models.length ? `当前方向需要：${models.map((model) => model.label).join(" + ")}。${models.length > 1 ? "经英语中转，两个模型都需准备。" : ""}` : "源语言和目标语言相同，无需翻译。";
      selectedId = models[0]?.id ?? selectedId;
    }
  } catch (error) { route = error instanceof Error ? error.message : String(error); }
  container.innerHTML = `
    <section class="local-model-control" aria-label="Firefox 本地模型">
      <p class="local-resource-notice"></p>
      <p class="local-route"></p>
      <label>语言模型 <select data-local="model"></select></label>
      <progress data-local="progress" value="0" max="1" hidden aria-label="模型下载进度"></progress>
      <p data-local="status" role="status" aria-live="polite">正在检查本地模型…</p>
      <div class="local-model-actions">
        <button type="button" data-local="download" disabled>下载模型</button>
        <button type="button" data-local="cancel" hidden>暂停下载</button>
        <button type="button" data-local="import">离线导入</button>
        <button type="button" data-local="remove" disabled>删除模型</button>
      </div>
      <input type="file" data-local="files" multiple accept=".bin,.spm" hidden />
      <details><summary>网络不畅或离线安装</summary>
        <p>下载会自动重试，暂停或中断后保留已完成的文件和每 1 MB 的进度。点击下载可继续；服务器不支持续传时会重新下载当前文件。</p>
        <p>也可在网络较好的设备上保存下列全部文件，复制到本机后点击「离线导入」。文件会按大小和校验值验证，可分次导入。下载来源为 Mozilla 官方 CDN。</p>
        <ul data-local="links"></ul>
      </details>
      <p class="local-model-note">实验功能：支持英语、简体中文、日语、德语、法语、西班牙语和俄语。复杂文本的质量可能低于在线服务。模型缺失或语言不支持时会提示处理方式，切换在线服务需手动选择。</p>
    </section>`;
  const query = <T extends HTMLElement>(key: string) => container.querySelector<T>(`[data-local='${key}']`)!;
  container.querySelector<HTMLElement>(".local-resource-notice")!.textContent = LOCAL_RESOURCE_NOTICE;
  container.querySelector<HTMLElement>(".local-route")!.textContent = route;
  const select = query<HTMLSelectElement>("model");
  const progress = query<HTMLProgressElement>("progress");
  const status = query<HTMLParagraphElement>("status");
  const download = query<HTMLButtonElement>("download");
  const cancel = query<HTMLButtonElement>("cancel");
  const remove = query<HTMLButtonElement>("remove");
  const importButton = query<HTMLButtonElement>("import");
  const input = query<HTMLInputElement>("files");
  let current: LocalModelStatus | undefined;
  let busy = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notice = "";
  select.replaceChildren(...LOCAL_MODELS.map((model) => new Option(`${model.label} · ${size(modelBytes(model))}`, model.id)));
  select.value = selectedId;

  function render(): void {
    if (disposed) return;
    const model = getLocalModel(select.value);
    const state = current?.models.find((entry) => entry.id === model.id);
    const downloading = current?.downloading === model.id;
    const labels = { ready: "已就绪", partial: "可继续下载", missing: "未安装", downloading: "下载中", error: "下载未完成" };
    for (const option of select.options) {
      const entry = getLocalModel(option.value);
      const value = current?.models.find((item) => item.id === option.value);
      option.textContent = `${entry.label} · ${size(modelBytes(entry))}${value ? ` · ${labels[value.state]}` : ""}`;
    }
    progress.hidden = !state || state.state === "ready" || state.downloaded === 0;
    progress.max = state?.total ?? 1;
    progress.value = state?.downloaded ?? 0;
    status.textContent = notice || (state?.state === "ready" ? "模型已就绪，可离线翻译。" : state?.error
      ?? (state ? `${downloading ? "正在下载" : state.downloaded ? "已保留" : "待下载"}：${size(state.downloaded)} / ${size(state.total)}。${downloading ? "可以关闭设置页，下载会继续。" : "模型准备完成前不会自动联网下载。"}` : "正在检查本地模型…"));
    download.disabled = busy || !state || !!current?.downloading || state.state === "ready";
    download.textContent = state?.state === "ready" ? "模型已安装" : state?.downloaded ? "继续下载" : `下载模型（${size(modelBytes(model))}）`;
    cancel.hidden = !downloading;
    cancel.disabled = busy;
    remove.disabled = busy || !state?.downloaded || !!current?.downloading;
    importButton.disabled = busy || !!current?.downloading;
    const links = query<HTMLUListElement>("links");
    links.replaceChildren(...model.files.map((file) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = file.url; link.textContent = `${file.name}（${size(file.bytes)}）`;
      link.target = "_blank"; link.rel = "noopener noreferrer"; link.download = file.name;
      li.append(link); return li;
    }));
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    clearTimeout(timer);
    try { current = await sendRuntimeMessage<LocalModelStatus>({ type: "GET_LOCAL_MODEL_STATUS" }); render(); }
    catch (error) { if (!disposed) status.textContent = error instanceof Error ? error.message : String(error); }
    if (!disposed) timer = setTimeout(() => void refresh(), current?.downloading ? 1000 : 5000);
  }

  async function act(task: () => Promise<unknown>): Promise<void> {
    busy = true; notice = ""; render();
    try { await task(); }
    catch (error) { notice = error instanceof Error ? error.message : String(error); }
    finally { busy = false; await refresh(); }
  }

  download.addEventListener("click", () => void act(async () => {
    if (!await requestOrigins(LOCAL_MODEL_ORIGINS)) throw new Error("没有获得下载翻译模型所需的访问权限。");
    await sendRuntimeMessage({ type: "INSTALL_LOCAL_MODEL", modelId: select.value });
  }));
  cancel.addEventListener("click", () => void act(() => sendRuntimeMessage({ type: "CANCEL_LOCAL_MODEL_DOWNLOAD" })));
  remove.addEventListener("click", () => void act(() => sendRuntimeMessage({ type: "REMOVE_LOCAL_MODEL", modelId: select.value })));
  importButton.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    const id = select.value;
    input.value = "";
    if (!files.length) return;
    void act(async () => {
      const imported = await importModelFiles(id, files);
      notice = `已验证并导入 ${imported} 个文件。全部文件就绪后即可离线翻译。`;
    });
  });
  select.addEventListener("change", () => { notice = ""; render(); });
  const dispose = () => { disposed = true; clearTimeout(timer); window.removeEventListener("pagehide", dispose); };
  window.addEventListener("pagehide", dispose);
  void refresh();
  return dispose;
}
