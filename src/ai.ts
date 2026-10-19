export const AI_ENDPOINT = "/api/ai/editor/chat";

export interface ChatOptions {
    input: string;
    action: string;
    signal: AbortSignal;
    onToken?: (length: number) => void;
    failedMessage: string;
}

async function readJson(response: Response): Promise<any> {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

async function readStream(response: Response, onToken?: (length: number) => void): Promise<string> {
    if (!response.body || typeof response.body.getReader !== "function") {
        return await response.text();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let content = "";
    let received = 0;

    const handleLine = (rawLine: string) => {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (!line) {
            eventName = "";
            return;
        }
        if (line.startsWith(":")) return;
        if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            return;
        }
        if (!line.startsWith("data:")) return;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") {
            eventName = "";
            return;
        }
        let payload: any;
        try {
            payload = JSON.parse(raw);
        } catch (error) {
            eventName = "";
            return;
        }
        const name = eventName || "message";
        eventName = "";
        if (name === "error") throw new Error(payload.message || payload.msg || "AI stream error");
        let token = "";
        if (name === "content" && typeof payload.token === "string") {
            token = payload.token;
        } else if (name === "message") {
            if (typeof payload.token === "string") {
                token = payload.token;
            } else if (payload.message || payload.msg) {
                throw new Error(payload.message || payload.msg);
            }
        }
        if (token) {
            content += token;
            received += token.length;
            onToken?.(received);
        }
    };

    try {
        for (;;) {
            const result = await reader.read();
            if (result.done) {
                buffer += decoder.decode();
                break;
            }
            buffer += decoder.decode(result.value, { stream: true });
            let index = buffer.indexOf("\n");
            while (index >= 0) {
                handleLine(buffer.slice(0, index));
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf("\n");
            }
        }
        if (buffer) handleLine(buffer);
    } finally {
        try {
            reader.cancel();
        } catch (error) {
            // already gone
        }
    }
    return content;
}

export async function requestChat(options: ChatOptions): Promise<string> {
    let response: Response;
    try {
        response = await fetch(AI_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                taskID: "auto-highlight-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
                input: options.input,
                action: options.action,
                history: [],
            }),
            signal: options.signal,
        });
    } catch (error) {
        if (options.signal.aborted) throw new Error("cancelled");
        throw new Error(options.failedMessage);
    }
    if (options.signal.aborted) throw new Error("cancelled");

    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
        const data = await readJson(response);
        if (data && typeof data.code === "number" && data.code !== 0) {
            throw new Error(data.msg || data.message || options.failedMessage);
        }
        if (!response.ok) {
            throw new Error((data && (data.msg || data.message)) || options.failedMessage);
        }
        const content = data
            ? (typeof data.content === "string" ? data.content : (typeof data.data === "string" ? data.data : ""))
            : "";
        if (!content.trim()) throw new Error(options.failedMessage);
        return content;
    }

    if (!response.ok) {
        throw new Error(options.failedMessage);
    }
    const content = await readStream(response, options.onToken);
    if (!content.trim()) throw new Error(options.failedMessage);
    return content;
}
