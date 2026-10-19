type TSettingItemType = "checkbox" | "select" | "textinput" | "textarea" | "number" | "slider" | "button" | "hint" | "custom";

interface ISettingItemCore {
    type: TSettingItemType;
    key: string;
    value: any;
    placeholder?: string;
    password?: boolean;
    spellcheck?: boolean;
    slider?: { min: number; max: number; step: number };
    options?: { [key: string | number]: string };
    number?: { min?: number; max?: number; step?: number };
    button?: { label: string; callback?: () => void };
    createElement?: (currentVal: any) => HTMLElement;
    getEleVal?: (ele: HTMLElement) => any;
    setEleVal?: (ele: HTMLElement, value: any) => void;
}

interface ISettingItem extends ISettingItemCore {
    title: string;
    description: string;
    direction?: "row" | "column";
}

interface ISettingUtilsItem extends ISettingItem {
    action?: { callback: () => void };
}
