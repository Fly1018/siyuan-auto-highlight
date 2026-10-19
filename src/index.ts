import { Plugin, Menu, showMessage, fetchSyncPost, getActiveEditor } from "siyuan";
import type { IProtyle } from "siyuan";
import { mount, unmount } from "svelte";
import ProgressToast from "@/components/ProgressToast.svelte";
import { progressState } from "@/progress-state.svelte";
import { requestChat } from "@/ai";
import {
    PROMPT,
    applyHits,
    buildInput,
    clearBlock,
    collectBlocks,
    parseHits,
    prepareBlockForSave,
    type BlockTarget,
} from "@/highlight";
import "./index.scss";

const ICON_SVG = '<symbol id="iconAutoHighlight" viewBox="0 0 32 32">' +
    '<path d="M21 5.5l5.5 5.5-12 12H9v-5.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M6 28h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>';

const SINGLE_MAX_CHARS = 12000;
const SINGLE_MAX_BLOCKS = 80;
const BATCH_MAX_BLOCKS = 60;
const BATCH_MAX_CHARS = 12000;
const AI_TIMEOUT = 120000;

export default class AutoHighlight extends Plugin {
    private disposed = false;
    private busy = false;
    private abortController: AbortController | null = null;
    private toastApp: ReturnType<typeof mount> | null = null;
    private toastContainer: HTMLDivElement | null = null;

    onload() {
        this.disposed = false;
        try {
            this.addIcons(ICON_SVG);
        } catch (error) {
            console.error("[siyuan-auto-highlight] addIcons failed", error);
        }
        (this.addTopBar as any)({
            icon: "iconAutoHighlight",
            title: this.t("topBarTitle", "Auto Highlight"),
            position: "right",
            callback: (event: MouseEvent) => this.showMenu(event),
        });
    }

    onLayoutReady() {
        if (this.disposed || this.toastApp) return;
        this.toastContainer = document.createElement("div");
        this.toastContainer.className = "ah-progress-root";
        document.body.appendChild(this.toastContainer);
        this.toastApp = mount(ProgressToast, {
            target: this.toastContainer,
            props: { state: progressState },
        });
    }

    onunload() {
        this.disposed = true;
        this.abortController?.abort();
        this.abortController = null;
        if (this.toastApp) {
            unmount(this.toastApp);
            this.toastApp = null;
        }
        this.toastContainer?.remove();
        this.toastContainer = null;
        progressState.visible = false;
    }

    private t(key: string, fallback: string): string {
        const value = (this.i18n as Record<string, unknown>)[key];
        return typeof value === "string" && value ? value : fallback;
    }

    private tf(key: string, fallback: string, ...values: unknown[]): string {
        let index = 0;
        return this.t(key, fallback).replace(/%[ds]/g, () => {
            const value = values[index];
            index += 1;
            return value === undefined ? "" : String(value);
        });
    }

    private showMenu(event: MouseEvent) {
        if (this.disposed) return;
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu("auto-highlight-menu");
        menu.addItem({
            icon: "iconHighlight",
            label: this.t("aiDoc", "AI highlight entire document"),
            click: () => void this.run(false),
        });
        menu.addItem({
            icon: "iconHighlight",
            label: this.t("aiSelection", "AI highlight selection"),
            click: () => void this.run(true),
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconTrashcan",
            label: this.t("clearDoc", "Clear highlights in this document"),
            click: () => void this.clearAll(),
        });
        menu.open({ x: event.clientX, y: event.clientY });
    }

    private getProtyle(): IProtyle | null {
        try {
            const editor = getActiveEditor();
            if (editor?.protyle?.block) return editor.protyle;
        } catch (error) {
            // no editor
        }
        return null;
    }

    private selectionRange(protyle: IProtyle): Range | null {
        try {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return null;
            const range = selection.getRangeAt(0);
            if (range.collapsed) return null;
            const root = protyle?.wysiwyg?.element;
            if (!root) return null;
            if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
            return range.cloneRange();
        } catch (error) {
            return null;
        }
    }

    private async run(selectionOnly: boolean) {
        if (this.disposed || this.busy) {
            showMessage(this.t("running", "Processing, please wait…"), 2500);
            return;
        }
        const protyle = this.getProtyle();
        if (!protyle) {
            showMessage(this.t("noEditor", "Open a document first"), 4000);
            return;
        }
        const range = selectionOnly ? this.selectionRange(protyle) : null;
        if (selectionOnly && !range) {
            showMessage(this.t("needSelection", "Select some text in the editor first"), 4000);
            return;
        }
        const blocks = collectBlocks(protyle, range);
        if (!blocks.length) {
            showMessage(this.t("none", "No highlightable text was found"), 4000);
            return;
        }

        this.busy = true;
        this.showProgress(this.t("running", "Processing, please wait…"));
        const controller = new AbortController();
        this.abortController = controller;
        const timeout = window.setTimeout(() => controller.abort(), AI_TIMEOUT);
        let applied = 0;

        try {
            const batches = this.makeBatches(blocks);
            for (let index = 0; index < batches.length; index += 1) {
                if (this.disposed || controller.signal.aborted) break;
                const batch = batches[index];
                this.showProgress(batches.length > 1
                    ? this.tf("aiProgress", "Asking the AI (batch %d/%d)…", index + 1, batches.length)
                    : this.t("aiOnce", "Asking the AI…"));
                const raw = await requestChat({
                    input: buildInput(batch),
                    action: PROMPT,
                    signal: controller.signal,
                    failedMessage: this.t("aiFailed", "AI request failed"),
                });
                const hits = parseHits(raw);
                const result = this.applyBatch(batch, hits, range);
                for (const element of result.changed) {
                    await this.saveBlock(element);
                }
                applied += result.count;
            }
            if (this.disposed) return;
            if (controller.signal.aborted) {
                showMessage(this.t("aiTimeout", "Timed out or cancelled"), 5000);
                return;
            }
            try {
                (protyle as any).reload?.(false);
            } catch (error) {
                // reload is best-effort
            }
            showMessage(applied > 0
                ? this.tf("done", "Highlighted %d passages", applied)
                : this.t("none", "No highlightable text was found"), 4000);
        } catch (error: any) {
            if (this.disposed) return;
            if (controller.signal.aborted) {
                showMessage(this.t("aiTimeout", "Timed out or cancelled"), 5000);
            } else {
                showMessage(`${this.t("aiFailed", "AI request failed")}: ${error?.message || error}`, 6000, "error");
            }
        } finally {
            window.clearTimeout(timeout);
            if (this.abortController === controller) this.abortController = null;
            this.busy = false;
            progressState.visible = false;
        }
    }

    private makeBatches(blocks: BlockTarget[]): BlockTarget[][] {
        if (blocks.length <= SINGLE_MAX_BLOCKS &&
            blocks.reduce((sum, block) => sum + block.text.length, 0) <= SINGLE_MAX_CHARS) {
            return [blocks];
        }
        const batches: BlockTarget[][] = [];
        let current: BlockTarget[] = [];
        let chars = 0;
        for (const block of blocks) {
            if (current.length >= BATCH_MAX_BLOCKS || chars + block.text.length > BATCH_MAX_CHARS) {
                if (current.length) batches.push(current);
                current = [];
                chars = 0;
            }
            current.push(block);
            chars += block.text.length;
        }
        if (current.length) batches.push(current);
        return batches;
    }

    private applyBatch(batch: BlockTarget[], hits: ReturnType<typeof parseHits>, range: Range | null): { changed: HTMLElement[]; count: number } {
        const changed = new Set<HTMLElement>();
        let count = 0;
        for (const hit of hits) {
            const block = batch[hit.line - 1];
            if (!block) continue;
            const applied = applyHits(block.element, [hit], range);
            if (applied > 0) {
                changed.add(block.element);
                count += applied;
            }
        }
        return { changed: [...changed], count };
    }

    private async saveBlock(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        if (!id) return;
        const data = prepareBlockForSave(element);
        const response = await fetchSyncPost("/api/block/updateBlock", {
            id,
            dataType: "dom",
            data,
        });
        if (!response || response.code !== 0) {
            throw new Error(response?.msg || "updateBlock");
        }
    }

    private async clearAll() {
        if (this.disposed || this.busy) return;
        const protyle = this.getProtyle();
        if (!protyle) {
            showMessage(this.t("noEditor", "Open a document first"), 4000);
            return;
        }
        const blocks = collectBlocks(protyle, null);
        if (!blocks.length) {
            showMessage(this.t("clearNone", "This document has no highlights from this plugin"), 4000);
            return;
        }
        this.busy = true;
        let cleared = 0;
        try {
            for (const block of blocks) {
                if (this.disposed) return;
                const count = clearBlock(block.element);
                if (count > 0) {
                    await this.saveBlock(block.element);
                    cleared += count;
                }
            }
            try {
                (protyle as any).reload?.(false);
            } catch (error) {
                // best-effort
            }
            showMessage(cleared > 0
                ? this.tf("cleared", "Cleared %d highlights", cleared)
                : this.t("clearNone", "This document has no highlights from this plugin"), 4000);
        } catch (error: any) {
            showMessage(`${this.t("failed", "Some blocks could not be written")}: ${error?.message || error}`, 6000, "error");
        } finally {
            this.busy = false;
        }
    }

    private showProgress(text: string) {
        progressState.text = text;
        progressState.visible = true;
    }
}
