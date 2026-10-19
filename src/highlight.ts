import type { IProtyle } from "siyuan";

export interface ColorSpec {
    key: string;
    color: string;
}

export const COLORS: ColorSpec[] = [
    { key: "focus", color: "#e53935" },
    { key: "info", color: "#1e88e5" },
    { key: "todo", color: "#fb8c00" },
    { key: "conclusion", color: "#43a047" },
];

export const PROMPT = [
    "你是笔记高亮助手。输入是笔记里按顺序编号的段落，每行格式为「编号. 文本」。",
    "请挑出真正值得标记的重点，并为每处给出原文的逐字摘录。",
    "只输出一个 JSON 数组，不要输出任何其他文字：",
    '[{"line": 编号数字, "quote": "原文逐字片段", "color": "focus"}]',
    "color 只能取以下值之一：",
    "focus = 核心结论或最需要记住的判断（红色）；",
    "info = 重要事实、数据、定义、前提（蓝色）；",
    "todo = 行动项、待办、下一步（橙色）；",
    "conclusion = 总结、综上、最终结论（绿色）。",
    "要求：",
    "1. 每段最多 1 处，摘录不超过 40 个字，宁缺毋滥；没有值得标记的就返回 []。",
    "2. 不要整段照抄，不要标记普通连接词或常见词（例如「所以」「因此」「但是」「重要」「关键」「数据」「信息」「建议」）。",
    "3. quote 必须与原文完全一致，能在对应编号的文本里逐字找到；不要改写、不要省略中间的字符、不要添加或替换标点。",
    "只输出 JSON。",
].join("\n");

const NON_EDITOR = ".layout__dockl, .layout__dockr, .layout__dockb, .b3-dialog, .protyle-util, #commonMenu";
const TARGET_SELECTOR = '[data-type="NodeParagraph"], [data-type="NodeHeading"]';
const SKIP_SELECTOR = '[data-type="NodeBlockQueryEmbed"], [data-type="NodeWidget"], [data-type="NodeIFrame"], [data-type="NodeHTMLBlock"], [data-type="NodeCodeBlock"], [data-type="NodeMathBlock"]';
const LOCK_SELECTOR = 'code, [data-type="code"], .katex, [data-type="math"]';
const CHROME_SELECTOR = ".protyle-attr";
const TRANSIENT = ["protyle-wysiwyg--select", "protyle-wysiwyg--hl", "protyle-wysiwyg--allhide"];
const COLOR_RE = /(^|;)\s*color\s*:/i;

const ALIASES: Record<string, string> = {
    focus: "focus", highlight: "focus", red: "focus", "红": "focus", "红色": "focus",
    "核心重点": "focus", "重点": "focus", "核心": "focus", "关键": "focus",
    info: "info", information: "info", fact: "info", blue: "info", "蓝": "info", "蓝色": "info",
    "信息": "info", "事实": "info", "数据": "info", "定义": "info",
    todo: "todo", action: "todo", task: "todo", orange: "todo", "橙": "todo", "橙色": "todo",
    "待办": "todo", "行动": "todo", "任务": "todo", "下一步": "todo",
    conclusion: "conclusion", summary: "conclusion", green: "conclusion", "绿": "conclusion",
    "绿色": "conclusion", "结论": "conclusion", "总结": "conclusion", "综上": "conclusion",
};

export interface BlockTarget {
    element: HTMLElement;
    text: string;
}

export interface Hit {
    line: number;
    quote: string;
    color: string;
}

export function colorOf(value: unknown): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    const direct = COLORS.find((item) => lower === item.key || lower === item.color);
    if (direct) return direct.color;
    const key = ALIASES[raw] || ALIASES[lower];
    return COLORS.find((item) => item.key === key)?.color || "";
}

function isLocked(parent: Element | null): boolean {
    if (!parent) return true;
    if (parent.closest(CHROME_SELECTOR)) return true;
    if (parent.closest(LOCK_SELECTOR)) return true;
    let current: Element | null = parent;
    while (current) {
        const style = current.getAttribute?.("style") || "";
        if (style && COLOR_RE.test(style)) return true;
        current = current.parentElement;
    }
    return false;
}

export function readableText(root: HTMLElement): string {
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`${CHROME_SELECTOR}, ${LOCK_SELECTOR}`).forEach((element) => element.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

export function collectBlocks(protyle: IProtyle, range: Range | null): BlockTarget[] {
    const root = protyle?.wysiwyg?.element;
    if (!root) return [];
    const targets: BlockTarget[] = [];
    root.querySelectorAll<HTMLElement>(TARGET_SELECTOR).forEach((element) => {
        if (!element.isConnected) return;
        if (element.closest(NON_EDITOR) || element.closest(SKIP_SELECTOR)) return;
        if (range && !range.intersectsNode(element)) return;
        const text = readableText(element);
        if (text) targets.push({ element, text });
    });
    return targets;
}

export function buildInput(blocks: BlockTarget[]): string {
    return blocks.map((block, index) => `${index + 1}. ${block.text}`).join("\n");
}

export function parseHits(raw: string): Hit[] {
    let text = String(raw || "").trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    let data: any;
    try {
        data = JSON.parse(text);
    } catch (error) {
        return [];
    }
    if (!Array.isArray(data)) return [];
    const hits: Hit[] = [];
    for (const item of data) {
        const line = Number(item?.line);
        const quote = typeof item?.quote === "string" ? item.quote.trim() : "";
        const color = colorOf(item?.color);
        if (!Number.isInteger(line) || line < 1 || !quote || !color) continue;
        if (hits.some((hit) => hit.line === line && hit.quote === quote)) continue;
        hits.push({ line, quote, color });
    }
    return hits;
}

function textNodes(root: HTMLElement, range: Range | null): Text[] {
    const result: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const text = node.nodeValue || "";
        if (!text) continue;
        const parent = node.parentElement;
        if (isLocked(parent)) continue;
        if (range && !range.intersectsNode(node)) continue;
        result.push(node as Text);
    }
    return result;
}

export function applyHits(root: HTMLElement, hits: Hit[], range: Range | null): number {
    let applied = 0;
    for (const hit of hits) {
        const nodes = textNodes(root, range);
        for (const textNode of nodes) {
            const value = textNode.nodeValue || "";
            const index = value.indexOf(hit.quote);
            if (index < 0) continue;
            const parent = textNode.parentNode;
            if (!parent) continue;
            const span = document.createElement("span");
            span.setAttribute("style", `color: ${hit.color};`);
            span.textContent = hit.quote;
            if (index > 0) parent.insertBefore(document.createTextNode(value.slice(0, index)), textNode);
            parent.insertBefore(span, textNode);
            if (index + hit.quote.length < value.length) {
                parent.insertBefore(document.createTextNode(value.slice(index + hit.quote.length)), textNode);
            }
            parent.removeChild(textNode);
            applied += 1;
            break;
        }
    }
    return applied;
}

export function clearBlock(root: HTMLElement): number {
    let cleared = 0;
    root.querySelectorAll<HTMLElement>("span[style]").forEach((span) => {
        const style = (span.getAttribute("style") || "").toLowerCase();
        if (!COLORS.some((item) => style.includes(item.color.toLowerCase()))) return;
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        cleared += 1;
    });
    return cleared;
}

export function prepareBlockForSave(root: HTMLElement): string {
    TRANSIENT.forEach((name) => {
        root.classList.remove(name);
        root.querySelectorAll(`.${name}`).forEach((element) => element.classList.remove(name));
    });
    return root.outerHTML;
}
