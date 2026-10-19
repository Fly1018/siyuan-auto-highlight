<script lang="ts">
    interface Props {
        state: { visible: boolean; text: string };
    }

    let { state }: Props = $props();
</script>

{#if state.visible}
    <div class="ah-progress" role="status" aria-live="polite">
        <span class="ah-progress__dot"></span>
        <span>{state.text}</span>
    </div>
{/if}

<style>
    .ah-progress {
        position: fixed;
        left: 50%;
        bottom: 28px;
        z-index: 50;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: min(520px, calc(100vw - 40px));
        padding: 8px 14px;
        border: 1px solid var(--b3-border-color);
        border-radius: 18px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
        font-size: 12px;
        transform: translateX(-50%);
    }

    .ah-progress__dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--b3-theme-primary);
        animation: ah-pulse 1s ease-in-out infinite;
    }

    @keyframes ah-pulse {
        0%, 100% { opacity: 0.35; transform: scale(0.8); }
        50% { opacity: 1; transform: scale(1); }
    }
</style>
