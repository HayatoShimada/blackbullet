import { cx } from "./cx.ts";

export type TabItem = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  dirty?: boolean;
  href?: string;
  onSelect?: () => void;
};

export type TabsProps = {
  items: TabItem[];
  class?: string;
  label?: string;
};

export function Tabs({ items, class: extra, label }: TabsProps) {
  const navigation = items.some((item) => item.href !== undefined);
  const active = Math.max(
    items.findIndex((item) => !item.disabled),
    items.findIndex((item) => item.active && !item.disabled),
  );
  return (
    <div
      class={cx("sb-tabs", extra)}
      role={navigation ? "navigation" : "tablist"}
      aria-label={label}
      onKeyDown={(event) => {
        if (navigation || event.altKey || event.ctrlKey || event.metaKey)
          return;
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key)) return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const current = buttons.indexOf(event.target as HTMLButtonElement);
        if (current < 0 || !buttons.length) return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next].focus();
        buttons[next].click();
      }}
    >
      {items.map((t, index) =>
        t.href !== undefined ? (
          <a
            key={t.label}
            href={t.disabled ? undefined : t.href}
            aria-disabled={t.disabled || undefined}
            aria-current={t.active ? "page" : undefined}
            data-dirty={t.dirty || undefined}
            class={cx("sb-tab", t.active && "sb-active")}
          >
            {t.label}
          </a>
        ) : (
          <button
            key={t.label}
            type="button"
            role={navigation ? undefined : "tab"}
            aria-selected={navigation ? undefined : !!t.active}
            disabled={t.disabled}
            tabIndex={navigation ? undefined : index === active ? 0 : -1}
            data-dirty={t.dirty || undefined}
            class={cx("sb-tab", t.active && "sb-active")}
            onClick={t.onSelect}
          >
            {t.label}
          </button>
        ),
      )}
    </div>
  );
}
