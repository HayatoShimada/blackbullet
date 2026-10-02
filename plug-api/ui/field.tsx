import { cloneElement, type ComponentChildren, type VNode } from "preact";
import { useId } from "preact/hooks";
import { cx } from "./cx.ts";
import { Checkbox } from "./checkbox.tsx";
import type { JSX } from "preact";

export type FieldProps = {
  label: ComponentChildren;
  children: VNode<any>;
  hint?: ComponentChildren;
  error?: ComponentChildren;
  class?: string;
};
export function Field({
  label,
  children,
  hint,
  error,
  class: extra,
}: FieldProps) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const description =
    [
      children.props["aria-describedby"],
      hint ? `${id}-hint` : undefined,
      error ? `${id}-error` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div class={cx("sb-field", extra)}>
      <label for={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": description,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })}
      {hint && (
        <span id={`${id}-hint`} class="sb-help-text">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} class="sb-field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export type CheckboxFieldProps = Omit<
  JSX.IntrinsicElements["input"],
  "type" | "class" | "size"
> & {
  label: ComponentChildren;
  hint?: ComponentChildren;
  class?: string;
};
export function CheckboxField({
  label,
  hint,
  class: extra,
  id: supplied,
  ...props
}: CheckboxFieldProps) {
  const generated = useId();
  const id = supplied ?? generated;
  return (
    <div class={cx("sb-checkbox-field", extra)}>
      <div class="sb-checkbox-field-line">
        <Checkbox
          {...props}
          id={id}
          aria-describedby={
            [props["aria-describedby"], hint ? `${id}-hint` : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        <label for={id}>{label}</label>
      </div>
      {hint && (
        <span id={`${id}-hint`} class="sb-help-text">
          {hint}
        </span>
      )}
    </div>
  );
}
